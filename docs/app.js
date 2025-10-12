const $ = (sel) => document.querySelector(sel);

const pyStatus = $('#pyStatus');
const modelSelect = $('#model');
const modelDetailsEl = $('#modelDetails');
const statusEl = $('#status');
const fitBtn = $('#fitBtn');
const pdfBtn = $('#pdfBtn');
const nBootSelect = $('#nBoot');

let modelsCache = null;
let currentModelMeta = null;
let modelDetailsRenderToken = 0;
let pyodideInstance = null;
let solverLoaded = false;

async function typesetNow(node) {
  if (!node || !window.MathJax) return;
  try {
    if (window.MathJax.startup?.promise) {
      await window.MathJax.startup.promise;
    }
    if (typeof window.MathJax.typesetPromise === 'function') {
      await window.MathJax.typesetPromise([node]);
    }
  } catch (err) {
    console.warn('MathJax typeset failed:', err);
  }
}

function latexToPlain(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\s+/g, ' ')
    .replace(/^\s*\\\[(.*)\\\]\s*$/s, '$1')
    .replace(/^\s*\\\((.*)\\\)\s*$/s, '$1')
    .replace(/^\s*\${1,2}(.*)\${1,2}\s*$/s, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\tau/g, 'τ')
    .replace(/\\pi/g, 'π')
    .replace(/\\,/g, ' ')
    .replace(/\\/g, '')
    .trim();
}

async function loadModelMetadata() {
  if (modelsCache) return modelsCache;
  const response = await fetch('./models.json');
  if (!response.ok) {
    throw new Error(`Unable to load model metadata (${response.status})`);
  }
  modelsCache = await response.json();
  return modelsCache;
}

async function renderModelDetails(modelId) {
  if (!modelDetailsEl) return;
  const token = ++modelDetailsRenderToken;
  try {
    const models = await loadModelMetadata();
    if (token !== modelDetailsRenderToken) {
      return;
    }
    const model = models?.[modelId];
    currentModelMeta = model || null;
    if (!model) {
      modelDetailsEl.innerHTML = '<p class="text-sm text-zinc-400">Model metadata unavailable.</p>';
      return;
    }

    const paramsHtml = (model.parameters || [])
      .map((param) => {
        const latex = param.latex || param.symbol || param.key || '';
        const units = param.units
          ? `<div class="math text-xs text-zinc-400">${param.units}</div>`
          : '';
        const desc = param.desc || param.description || '';
        const estimated = Boolean(param.estimated ?? param.estimate);
        const badgeLabel = estimated ? 'Estimated' : 'Fixed';
        const badgeClass = estimated ? 'badge estimate' : 'badge fixed';
        return `
          <div class="param-row grid grid-cols-[auto_1fr] items-start gap-3">
            <div class="math text-lg font-semibold text-indigo-100/90 leading-tight">${latex}</div>
            <div class="space-y-1">
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-medium text-zinc-100">${desc}</span>
                <span class="${badgeClass}">${badgeLabel}</span>
              </div>
              ${units}
            </div>
          </div>
        `;
      })
      .join('');

    const assumptionsHtml = (model.assumptions || [])
      .map((item) => `<li>${item}</li>`)
      .join('');

    const formulaBlock = model.formula
      ? `<div class="math-block text-indigo-100/90">${model.formula}</div>`
      : '';

    if (token !== modelDetailsRenderToken) {
      return;
    }

    modelDetailsEl.innerHTML = `
      <div class="space-y-5">
        <div class="space-y-2">
          <h3 class="text-lg font-semibold text-zinc-100">${model.name}</h3>
          ${formulaBlock || '<p class="text-sm text-zinc-400">Formula not provided.</p>'}
        </div>
        <div class="space-y-2">
          <h4 class="text-xs uppercase tracking-[0.2em] text-zinc-500">Parameters</h4>
          <div class="space-y-3">${paramsHtml || '<p class="text-sm text-zinc-400">No parameter metadata.</p>'}</div>
        </div>
        <div class="space-y-2">
          <h4 class="text-xs uppercase tracking-[0.2em] text-zinc-500">Assumptions</h4>
          <ul class="model-assumptions">${assumptionsHtml || '<li>Not documented.</li>'}</ul>
        </div>
      </div>
    `;

    const detailsList = modelDetailsEl.querySelectorAll('details');
    detailsList.forEach((detailsEl) => {
      detailsEl.addEventListener('toggle', async () => {
        if (detailsEl.open) {
          await typesetNow(detailsEl);
        }
      });
    });

    const parentDetails = modelDetailsEl.closest('details');
    if (parentDetails && !parentDetails.open) {
      const handler = async () => {
        if (parentDetails.open) {
          parentDetails.removeEventListener('toggle', handler);
          await typesetNow(modelDetailsEl);
        }
      };
      parentDetails.addEventListener('toggle', handler);
      return;
    }

    await typesetNow(modelDetailsEl);
  } catch (err) {
    console.error(err);
    modelDetailsEl.innerHTML = `<p class="text-sm text-rose-300">Failed to load model metadata: ${err.message}</p>`;
  }
}

if (modelSelect) {
  renderModelDetails(modelSelect.value);
  modelSelect.addEventListener('change', (event) => {
    renderModelDetails(event.target.value);
  });
}

async function ensurePyodide() {
  if (pyodideInstance && solverLoaded) {
    return pyodideInstance;
  }
  if (typeof loadPyodide !== 'function') {
    throw new Error('Pyodide runtime not available');
  }

  if (!pyodideInstance) {
    try {
      if (pyStatus) {
        pyStatus.textContent = 'Loading Pyodide runtime…';
        pyStatus.classList.remove('ready');
      }
      pyodideInstance = await loadPyodide();
      if (pyStatus) {
        pyStatus.textContent = 'Fetching scientific packages (NumPy · SciPy)…';
      }
      await pyodideInstance.loadPackage(['numpy', 'scipy']);
    } catch (err) {
      if (pyStatus) {
        pyStatus.textContent = `Failed to load Python runtime: ${err.message}`;
        pyStatus.classList.remove('ready');
      }
      throw err;
    }
  }

  if (!solverLoaded) {
    try {
      if (pyStatus) {
        pyStatus.textContent = 'Loading analytical solver…';
      }
      const code = await (await fetch('./py/solver.py')).text();
      await pyodideInstance.runPythonAsync(code);
      solverLoaded = true;
      const fitProxy = pyodideInstance.globals.get('fit_with_ci');
      if (fitProxy && typeof fitProxy.destroy === 'function') fitProxy.destroy();
      if (pyStatus) {
        pyStatus.textContent = 'Python ready';
        pyStatus.classList.add('ready');
      }
    } catch (err) {
      if (pyStatus) {
        pyStatus.textContent = `Failed to load solver: ${err.message}`;
        pyStatus.classList.remove('ready');
      }
      throw err;
    }
  }

  return pyodideInstance;
}

const exampleBtn = $('#loadExample');
if (exampleBtn) {
  exampleBtn.addEventListener('click', () => {
    const demo = `time_min,drawdown_m,r_m,Q_m3ph\n0.1,0.02,30,120\n0.2,0.05,30,120\n0.5,0.12,30,120\n1.0,0.18,30,120\n2.0,0.24,30,120\n3.5,0.30,30,120\n5.0,0.36,30,120`;
    const raw = $('#raw');
    if (raw) {
      raw.value = demo;
      if (statusEl) statusEl.textContent = 'Example dataset loaded. Adjust values and press “Fit model”.';
    }
  });
}

const fileInput = $('#csvFile');
if (fileInput) {
  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const txt = await file.text();
    const raw = $('#raw');
    if (raw) raw.value = txt;
    if (statusEl) statusEl.textContent = `Loaded ${file.name}. Review and press “Fit model”.`;
  });
}

if (fitBtn) {
  fitBtn.addEventListener('click', async () => {
    if (statusEl) statusEl.textContent = 'Parsing data…';
    if (pdfBtn) pdfBtn.disabled = true;

    const nBoot = parseInt(nBootSelect?.value ?? '100', 10) || 100;
    const originalLabel = fitBtn.textContent?.trim() || 'Fit model';
    fitBtn.disabled = true;
    fitBtn.dataset.originalLabel = originalLabel;
    fitBtn.textContent = `Fitting… (Bootstrap N=${nBoot})`;

    try {
      const rInput = parseFloat($('#r')?.value ?? 'NaN');
      const qInput = parseFloat($('#Q')?.value ?? 'NaN');
      const model = modelSelect?.value ?? 'lagging';
      const conf = parseFloat($('#conf')?.value ?? '0.95');
      const rawText = $('#raw')?.value ?? '';
      const parsed = parseCsvOrText(rawText, rInput, qInput);
      const { times, draws, _r, _Q } = parsed;
      if (!times.length) {
        throw new Error('No valid observations found.');
      }

      if (statusEl) statusEl.textContent = 'Initialising Python runtime…';
      const py = await ensurePyodide();
      if (statusEl) statusEl.textContent = `Running bootstrap fits (N=${nBoot})…`;

      const timesProxy = py.toPy(Array.from(times));
      const drawsProxy = py.toPy(Array.from(draws));

      let fitPy = null;
      let resultPy = null;
      const pyproxies = [];

      try {
        fitPy = py.globals.get('fit_with_ci');
        if (!fitPy || typeof fitPy.callKwargs !== 'function') {
          throw new Error('fit_with_ci is not available.');
        }
        const priors = null;
        resultPy = fitPy.callKwargs({
          times: timesProxy,
          draws: drawsProxy,
          model_name: model,
          r: _r,
          Q: _Q,
          priors,
          conf,
          n_boot: nBoot,
        });
        const fitResult = resultPy.toJs({ pyproxies, dict_converter: Object.fromEntries });
        const [params = {}, metrics = {}, fitted = [], ci = {}] = Array.isArray(fitResult) ? fitResult : [];
        const resultObj = {
          params: params || {},
          metrics: metrics || {},
          ci: ci || {},
          curves: {
            observed: times.map((t, idx) => [t, draws[idx]]),
            fitted: Array.isArray(fitted) ? fitted : [],
          },
          model,
          r: _r,
          Q: _Q,
          conf,
          nBoot,
          mode: 'pyodide',
        };

        window._lastFit = resultObj;
        renderParams(resultObj);
        renderMetrics(resultObj);
        renderChart(resultObj);
        if (pdfBtn) pdfBtn.disabled = false;
        if (statusEl) statusEl.textContent = `Fit complete. Bootstrap N=${nBoot}.`;
      } finally {
        if (py && py.ffi && typeof py.ffi.destroy_proxies === 'function') {
          py.ffi.destroy_proxies(pyproxies);
        } else {
          for (const proxy of pyproxies) {
            if (proxy && typeof proxy.destroy === 'function') proxy.destroy();
          }
        }
        if (resultPy && typeof resultPy.destroy === 'function') resultPy.destroy();
        if (fitPy && typeof fitPy.destroy === 'function') fitPy.destroy();
        if (timesProxy && typeof timesProxy.destroy === 'function') timesProxy.destroy();
        if (drawsProxy && typeof drawsProxy.destroy === 'function') drawsProxy.destroy();
      }
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    } finally {
      fitBtn.disabled = false;
      const original = fitBtn.dataset.originalLabel || 'Fit model';
      fitBtn.textContent = original;
    }
  });
}

if (pdfBtn) {
  pdfBtn.addEventListener('click', async () => {
    if (!window._lastFit) return;
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('jsPDF failed to load. Please try again.');
      return;
    }
    const doc = new window.jspdf.jsPDF();
    const { model, r, Q, params, metrics, conf, nBoot, ci } = window._lastFit;
    const modelLabel = currentModelMeta?.name || model.toUpperCase();
    doc.setFontSize(18);
    doc.text('Lagwell Pump Test Report', 14, 20);
    doc.setFontSize(12);
    let y = 32;
    doc.text(`Model: ${modelLabel}`, 14, y);
    y += 8;
    doc.text(`Radius r (m): ${formatNumber(r, 3)}`, 14, y);
    y += 8;
    doc.text(`Pumping rate Q (m³/h): ${formatNumber(Q, 3)}`, 14, y);
    y += 8;
    const confPercent = Math.round((conf || 0) * 100);
    doc.text(`Confidence level: ${confPercent}%`, 14, y);
    y += 8;
    if (Number.isFinite(nBoot)) {
      doc.text(`Bootstrap samples: ${nBoot}`, 14, y);
      y += 8;
    }
    doc.text('Computation: Pyodide (in-browser)', 14, y);
    y += 14;

    doc.setFontSize(14);
    doc.text(`Parameters (${confPercent}% CI)`, 14, y);
    y += 8;
    doc.setFontSize(12);
    const paramKeys = Object.keys(params || {});
    if (!paramKeys.length) {
      doc.text('No parameter estimates available.', 18, y);
      y += 7;
    } else {
      paramKeys.forEach((key) => {
        const estimate = formatNumber(params[key]);
        const ciPair = Array.isArray(ci?.[key]) && ci[key].length === 2
          ? `[${formatNumber(ci[key][0])}, ${formatNumber(ci[key][1])}]`
          : '—';
        doc.text(`${key}: ${estimate}   ${confPercent}% CI: ${ciPair}`, 18, y);
        y += 7;
      });
    }

    y += 5;
    doc.setFontSize(14);
    doc.text('Fit metrics', 14, y);
    y += 8;
    doc.setFontSize(12);
    let metricsPrinted = false;
    if (metrics) {
      if (typeof metrics.rmse === 'number') {
        doc.text(`RMSE = ${formatNumber(metrics.rmse)}`, 18, y);
        y += 7;
        metricsPrinted = true;
      }
      if (typeof metrics.r2 === 'number') {
        doc.text(`R² = ${formatNumber(metrics.r2, 4)}`, 18, y);
        y += 7;
        metricsPrinted = true;
      }
    }
    if (!metricsPrinted) {
      doc.text('No metrics available.', 18, y);
      y += 7;
    }

    const chartEl = document.getElementById('chart');
    if (window.Plotly && chartEl && chartEl.data && chartEl.data.length) {
      try {
        const png = await window.Plotly.toImage(chartEl, { format: 'png', width: 900, height: 520 });
        const imgWidth = 180;
        const imgHeight = (imgWidth * 520) / 900;
        if (y + imgHeight + 16 > 280) {
          doc.addPage();
          y = 20;
        } else {
          y += 8;
        }
        doc.setFontSize(14);
        doc.text('Observed vs fitted drawdown', 14, y);
        y += 6;
        doc.addImage(png, 'PNG', 14, y, imgWidth, imgHeight);
        y += imgHeight + 6;
      } catch (imgErr) {
        console.warn('Unable to export plot image:', imgErr);
      }
    }

    doc.save('lagwell_report.pdf');
  });
}

function parseCsvOrText(txt, defaultR, defaultQ) {
  const lines = (txt || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { data: [], times: [], draws: [], _r: defaultR, _Q: defaultQ };
  const headers = lines[0].split(',').map((h) => h.trim());
  const idxT = headers.findIndex((h) => /time_min/i.test(h));
  const idxS = headers.findIndex((h) => /drawdown_m/i.test(h));
  const idxR = headers.findIndex((h) => /r(_m)?/i.test(h));
  const idxQ = headers.findIndex((h) => /Q(_m3ph)?/i.test(h));
  if (idxT === -1 || idxS === -1) {
    throw new Error('CSV must include time_min and drawdown_m columns.');
  }

  let r = Number.isFinite(defaultR) ? defaultR : NaN;
  let Q = Number.isFinite(defaultQ) ? defaultQ : NaN;

  const data = [];
  const times = [];
  const draws = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map((value) => value.trim());
    if (!row.length || row[0] === '') continue;
    const t = parseFloat(row[idxT]);
    const s = parseFloat(row[idxS]);
    if (!Number.isFinite(t) || !Number.isFinite(s)) continue;
    data.push({ t, s });
    times.push(t);
    draws.push(s);
    if (idxR !== -1 && !Number.isFinite(r)) r = parseFloat(row[idxR]);
    if (idxQ !== -1 && !Number.isFinite(Q)) Q = parseFloat(row[idxQ]);
  }
  if (!Number.isFinite(r)) r = defaultR;
  if (!Number.isFinite(Q)) Q = defaultQ;
  return { data, times, draws, _r: r, _Q: Q };
}

const fmtExp = (value) => {
  if (value == null || !Number.isFinite(value)) return '—';
  const absVal = Math.abs(value);
  if (absVal !== 0 && (absVal < 1e-3 || absVal > 1e4)) {
    return Number(value).toExponential(3);
  }
  return Number(value).toFixed(4);
};

const fmtDec = (value, digits = 4) => {
  if (value == null || !Number.isFinite(value)) return '—';
  return Number(value).toFixed(digits);
};

function renderParams(result) {
  const container = $('#params');
  if (!container) return;
  const params = result.params || {};
  const ci = result.ci || {};
  const metaParams = currentModelMeta?.parameters || [];
  const confLabel = `${Math.round((result.conf ?? 0) * 100)}% CI`;

  const rows = Object.keys(params).map((key) => {
    const meta = metaParams.find((p) => p.key === key || p.symbol === key);
    const descriptionText = meta?.desc || meta?.description;
    const description = descriptionText
      ? `<div class="text-xs text-zinc-500 mt-1">${descriptionText}</div>`
      : '';
    const unitsText = meta?.units ? latexToPlain(meta.units) : '';
    const units = unitsText ? ` <span class="text-xs font-normal text-zinc-500">(${unitsText})</span>` : '';
    const labelLatex = meta?.latex || meta?.symbol;
    const label = labelLatex ? latexToPlain(labelLatex) : key;
    const ciPair = Array.isArray(ci[key]) && ci[key].length === 2
      ? `[${fmtExp(ci[key][0])}, ${fmtExp(ci[key][1])}]`
      : '—';
    return `
      <tr>
        <td class="px-4 py-3 align-top">
          <div class="font-semibold text-zinc-100">${label}${units}</div>
          ${description}
        </td>
        <td class="px-4 py-3 font-mono text-sm text-indigo-100">${fmtExp(params[key])}</td>
        <td class="px-4 py-3 font-mono text-sm text-zinc-200">${ciPair}</td>
      </tr>
    `;
  });

  if (!rows.length) {
    container.innerHTML = '<div class="p-4 text-sm text-zinc-400">Run a fit to see parameter estimates.</div>';
    return;
  }

  container.innerHTML = `
    <table class="min-w-full divide-y divide-zinc-800 text-sm">
      <thead class="bg-zinc-900/80 text-zinc-300">
        <tr>
          <th class="px-4 py-3 text-left font-semibold">Parameter</th>
          <th class="px-4 py-3 text-left font-semibold">Estimate</th>
          <th class="px-4 py-3 text-left font-semibold">${confLabel}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-zinc-800/60">
        ${rows.join('')}
      </tbody>
    </table>
  `;
}

function renderMetrics(result) {
  const container = $('#metrics');
  if (!container) return;
  const metrics = result.metrics || {};
  const entries = [];

  if (Number.isFinite(metrics.rmse)) {
    entries.push({ label: 'RMSE', value: fmtExp(metrics.rmse) });
  }
  if (Number.isFinite(metrics.r2)) {
    entries.push({ label: 'R²', value: fmtDec(metrics.r2, 4) });
  }
  entries.push({ label: 'Confidence level', value: `${Math.round((result.conf || 0) * 100)}%` });
  if (Number.isFinite(result.nBoot)) {
    entries.push({ label: 'Bootstrap samples', value: result.nBoot });
  }
  entries.push({ label: 'Runtime', value: 'Pyodide (browser)' });

  if (!entries.length) {
    container.innerHTML = '<div class="text-sm text-zinc-400">Run a fit to see metrics.</div>';
    return;
  }

  const html = entries
    .map(
      (entry) => `
        <div class="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
          <div class="text-xs uppercase tracking-[0.2em] text-zinc-500">${entry.label}</div>
          <div class="mt-1 text-sm font-semibold text-zinc-100">${entry.value}</div>
        </div>
      `
    )
    .join('');

  container.innerHTML = `<div class="grid gap-3 sm:grid-cols-2">${html}</div>`;
}

function renderChart(result) {
  const chartEl = $('#chart');
  if (!chartEl) return;
  const obs = result.curves?.observed || [];
  const fit = result.curves?.fitted || [];
  if (!obs.length && !fit.length) {
    if (window.Plotly && chartEl.data) {
      window.Plotly.purge(chartEl);
    }
    chartEl.classList.add('flex', 'items-center', 'justify-center', 'text-sm', 'text-zinc-500');
    chartEl.innerHTML = '<div class="p-6">Observed and fitted curves will appear here after calibration.</div>';
    return;
  }

  chartEl.classList.remove('flex', 'items-center', 'justify-center', 'text-sm', 'text-zinc-500');
  chartEl.innerHTML = '';
  const sortedObs = [...obs].sort((a, b) => a[0] - b[0]);
  const sortedFit = [...fit].sort((a, b) => a[0] - b[0]);
  const obsTrace = {
    x: sortedObs.map((d) => d[0]),
    y: sortedObs.map((d) => d[1]),
    name: 'Observed',
    mode: 'markers',
    type: 'scatter',
    marker: { color: '#818cf8', size: 8, opacity: 0.85 },
  };
  const fitTrace = {
    x: sortedFit.map((d) => d[0]),
    y: sortedFit.map((d) => d[1]),
    name: 'Fitted',
    mode: 'lines',
    type: 'scatter',
    line: { color: '#22d3ee', width: 3 },
  };
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#e4e4e7' },
    margin: { l: 60, r: 24, t: 24, b: 48 },
    xaxis: {
      title: 'time (min)',
      gridcolor: 'rgba(113,113,122,0.35)',
      zerolinecolor: 'rgba(113,113,122,0.35)',
    },
    yaxis: {
      title: 'drawdown (m)',
      gridcolor: 'rgba(113,113,122,0.35)',
      zerolinecolor: 'rgba(113,113,122,0.35)',
    },
    legend: { orientation: 'h', y: -0.25 },
  };
  const config = { displayModeBar: false, responsive: true };
  Plotly.react(chartEl, [obsTrace, fitTrace], layout, config);
}

function formatNumber(value, digits = 3) {
  if (value == null || !Number.isFinite(value)) return '-';
  const absVal = Math.abs(value);
  if (absVal !== 0 && (absVal < 1e-3 || absVal > 1e4)) {
    return Number(value).toExponential(digits);
  }
  return Number(value).toFixed(digits);
}

window.addEventListener('unload', () => {
  if (!pyodideInstance) return;
  try {
    const fitProxy = pyodideInstance.globals.get('fit_with_ci');
    if (fitProxy && typeof fitProxy.destroy === 'function') fitProxy.destroy();
  } catch (err) {
    console.warn('Unable to destroy fit_with_ci proxy:', err);
  }
});
