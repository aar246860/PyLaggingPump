const $ = (sel) => document.querySelector(sel);
const SESSION_KEY = 'lagwellSession';

const pyStatus = $('#pyStatus');
const modelSelect = $('#model');
const modelDetailsEl = $('#modelDetails');
const statusEl = $('#status');
const fitBtn = $('#fitBtn');
const pdfBtn = $('#pdfBtn');
const nBootSelect = $('#nBoot');
const radiusInput = $('#r');
const qInput = $('#Q');
const confSelect = $('#conf');
const rawInput = $('#raw');

let cachedStorage = null;
let storageChecked = false;

function getSessionStorage() {
  if (storageChecked) return cachedStorage;
  storageChecked = true;
  try {
    cachedStorage = window.localStorage || null;
  } catch (err) {
    console.warn('localStorage is not available:', err);
    cachedStorage = null;
  }
  return cachedStorage;
}

function ensureLoadingStyles() {
  if (document.getElementById('fit-btn-loading-styles')) return;
  const style = document.createElement('style');
  style.id = 'fit-btn-loading-styles';
  style.textContent = `
    #fitBtn.is-loading {
      position: relative;
      padding-left: 2.5rem;
      cursor: progress;
    }
    #fitBtn.is-loading::before {
      content: '';
      position: absolute;
      left: 0.85rem;
      top: 50%;
      width: 1rem;
      height: 1rem;
      margin-top: -0.5rem;
      border-radius: 9999px;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #ffffff;
      animation: fit-btn-spin 0.85s linear infinite;
    }
    #fitBtn.is-loading:disabled {
      opacity: 0.8;
    }
    @keyframes fit-btn-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

function saveSession() {
  const storage = getSessionStorage();
  if (!storage) return;
  const data = {
    r: radiusInput?.value ?? '',
    Q: qInput?.value ?? '',
    model: modelSelect?.value ?? '',
    conf: confSelect?.value ?? '',
    nBoot: nBootSelect?.value ?? '',
    raw: rawInput?.value ?? '',
  };
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Unable to persist session:', err);
  }
}

function loadSession() {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    const payload = storage.getItem(SESSION_KEY);
    if (!payload) return;
    const data = JSON.parse(payload);
    if (radiusInput && data.r != null) radiusInput.value = data.r;
    if (qInput && data.Q != null) qInput.value = data.Q;
    if (confSelect && data.conf != null && `${data.conf}`.length) confSelect.value = data.conf;
    if (nBootSelect && data.nBoot != null && `${data.nBoot}`.length) nBootSelect.value = data.nBoot;
    if (rawInput && typeof data.raw === 'string') rawInput.value = data.raw;
    if (modelSelect && data.model != null && `${data.model}`.length) {
      modelSelect.value = data.model;
      renderModelDetails(data.model);
    }
  } catch (err) {
    console.warn('Unable to restore previous session:', err);
  }
}

function registerSessionListeners() {
  const bindings = [
    [radiusInput, 'input'],
    [qInput, 'input'],
    [confSelect, 'change'],
    [nBootSelect, 'change'],
    [rawInput, 'input'],
  ];
  bindings.forEach(([element, evt]) => {
    if (!element) return;
    element.addEventListener(evt, saveSession);
  });
}

function showErrorToast(message) {
  const containerId = 'lagwell-toast-root';
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.style.position = 'fixed';
    container.style.top = '1.5rem';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '0.75rem';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.setAttribute('role', 'alert');
  toast.textContent = message || 'An unexpected error occurred.';
  toast.style.background = 'rgba(239, 68, 68, 0.9)';
  toast.style.color = '#fff';
  toast.style.padding = '0.75rem 1.25rem';
  toast.style.borderRadius = '0.75rem';
  toast.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.35)';
  toast.style.backdropFilter = 'saturate(120%) blur(6px)';
  toast.style.pointerEvents = 'auto';
  toast.style.fontSize = '0.95rem';
  toast.style.fontWeight = '500';
  toast.style.maxWidth = '26rem';
  toast.style.textAlign = 'center';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(-12px)';
  toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-12px)';
    setTimeout(() => {
      toast.remove();
      if (!container.childElementCount) {
        container.remove();
      }
    }, 320);
  }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
  ensureLoadingStyles();
  loadSession();
  registerSessionListeners();
});

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
    saveSession();
  });
}

function getModelParamKeySet(modelMeta) {
  const paramList = Array.isArray(modelMeta?.parameters) ? modelMeta.parameters : [];
  const keys = paramList
    .map((param) => (param && typeof param.key === 'string' ? param.key : param?.symbol))
    .filter((key) => typeof key === 'string' && key.trim().length > 0);
  return new Set(keys);
}

function filterParamsForModel(rawParams, rawCi, modelMeta) {
  const params = rawParams && typeof rawParams === 'object' ? rawParams : {};
  const ci = rawCi && typeof rawCi === 'object' ? rawCi : {};
  const allowed = getModelParamKeySet(modelMeta);
  if (!allowed.size) {
    return { params, ci };
  }

  const filteredParams = {};
  const filteredCi = {};
  Object.keys(params).forEach((key) => {
    if (!allowed.has(key)) return;
    filteredParams[key] = params[key];
    if (Object.prototype.hasOwnProperty.call(ci, key)) {
      filteredCi[key] = ci[key];
    }
  });
  return { params: filteredParams, ci: filteredCi };
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
    if (rawInput) {
      rawInput.value = demo;
      saveSession();
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
    if (rawInput) rawInput.value = txt;
    saveSession();
    if (statusEl) statusEl.textContent = `Loaded ${file.name}. Review and press “Fit model”.`;
  });
}

if (fitBtn) {
  fitBtn.addEventListener('click', async () => {
    ensureLoadingStyles();
    saveSession();
    if (statusEl) statusEl.textContent = 'Parsing data…';
    if (pdfBtn) pdfBtn.disabled = true;

    const nBoot = parseInt(nBootSelect?.value ?? '100', 10) || 100;
    const originalLabel = fitBtn.textContent?.trim() || 'Fit model';
    fitBtn.disabled = true;
    fitBtn.dataset.originalLabel = originalLabel;
    fitBtn.classList.add('is-loading');
    fitBtn.setAttribute('aria-busy', 'true');
    fitBtn.textContent = 'Parsing data…';

    try {
      const rValue = parseFloat(radiusInput?.value ?? 'NaN');
      const qValue = parseFloat(qInput?.value ?? 'NaN');
      const model = modelSelect?.value ?? 'lagging';
      const conf = parseFloat(confSelect?.value ?? '0.95');
      const rawText = rawInput?.value ?? '';
      const parsed = parseCsvOrText(rawText, rValue, qValue);
      const { times, draws, _r, _Q } = parsed;
      if (!times.length) {
        throw new Error('No valid observations found.');
      }

      if (statusEl) statusEl.textContent = 'Initializing Python runtime…';
      fitBtn.textContent = 'Initializing Python...';
      const py = await ensurePyodide();
      if (statusEl) statusEl.textContent = `Running bootstrap fits (N=${nBoot})…`;
      fitBtn.textContent = `Running bootstrap (N=${nBoot})...`;

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
        const { params: filteredParams, ci: filteredCi } = filterParamsForModel(params, ci, currentModelMeta);
        const metricsObj = metrics && typeof metrics === 'object' ? metrics : {};
        const resultObj = {
          params: filteredParams,
          metrics: metricsObj,
          ci: filteredCi,
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
        fitBtn.textContent = 'Processing results...';
        renderParams(resultObj);
        renderMetrics(resultObj);
        renderChart(resultObj);
        if (pdfBtn) pdfBtn.disabled = false;
        if (statusEl) statusEl.textContent = `Fit complete. Bootstrap N=${nBoot}.`;
        fitBtn.textContent = 'Fit complete';
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
      showErrorToast(err.message);
      if (statusEl) statusEl.textContent = 'Error encountered. See notification for details.';
    } finally {
      fitBtn.disabled = false;
      fitBtn.classList.remove('is-loading');
      fitBtn.removeAttribute('aria-busy');
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

  const showMessage = (message) => {
    if (window.Plotly && typeof window.Plotly.purge === 'function') {
      try {
        window.Plotly.purge(chartEl);
      } catch (purgeErr) {
        console.warn('Plotly purge failed:', purgeErr);
      }
    }
    delete chartEl.dataset.hasPlot;
    chartEl.classList.add('flex', 'items-center', 'justify-center', 'text-sm', 'text-zinc-500');
    chartEl.innerHTML = `<div class="p-6">${message}</div>`;
  };

  const obs = result.curves?.observed || [];
  const fit = result.curves?.fitted || [];
  if (!obs.length && !fit.length) {
    showMessage('Observed and fitted curves will appear here after calibration.');
    return;
  }

  if (!window.Plotly || (typeof window.Plotly.newPlot !== 'function' && typeof window.Plotly.react !== 'function')) {
    showMessage('Plotting library failed to load. Refresh the page and try again.');
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

  const plotter = chartEl.dataset.hasPlot === '1' && typeof window.Plotly.react === 'function'
    ? window.Plotly.react
    : window.Plotly.newPlot;

  const handleError = (err) => {
    console.error('Plotly render failed:', err);
    showMessage('Unable to render plot. Check the console for details and retry.');
  };

  try {
    const maybePromise = plotter(chartEl, [obsTrace, fitTrace], layout, config);
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise
        .then(() => {
          chartEl.dataset.hasPlot = '1';
        })
        .catch(handleError);
    } else {
      chartEl.dataset.hasPlot = '1';
    }
  } catch (err) {
    handleError(err);
  }
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
