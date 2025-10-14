const $ = (sel) => document.querySelector(sel);
const SESSION_KEY = 'lagwellSession';
const TOUR_STORAGE_KEY = 'lagwellOnboardingTour_v1';

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
const reportModal = $('#reportModal');
const generateReportBtn = $('#generateReportBtn');
const cancelReportBtn = $('#cancelReportBtn');
const reportProjectNameInput = $('#reportProjectName');
const reportClientInput = $('#reportClient');
const reportLocationInput = $('#reportLocation');
const fitHistoryContainer = $('#fitHistory');
const clearHistoryBtn = $('#clearHistoryBtn');

let lastModelSelection = modelSelect?.value ?? 'lagging';

let cachedStorage = null;
let storageChecked = false;
let fitHistory = [];

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
      const restoredModel = data.model;
      if (restoredModel === 'fractured') {
        modelSelect.value = 'lagging';
        renderModelDetails('lagging');
      } else {
        modelSelect.value = restoredModel;
        renderModelDetails(restoredModel);
      }
    }
  } catch (err) {
    console.warn('Unable to restore previous session:', err);
  }
}

function registerSessionListeners() {
  const bindings = [
    [radiusInput, 'input'],
    [qInput, 'input'],
    [modelSelect, 'change'],
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
  lastModelSelection = modelSelect?.value ?? lastModelSelection;
  initOnboardingTour();
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
    const selected = event.target.value;
    if (selected === 'fractured') {
      showUpgradeModal('Fractured Aquifer Model');
      event.target.value = lastModelSelection;
      renderModelDetails(event.target.value);
      saveSession();
      return;
    }
    lastModelSelection = selected;
    renderModelDetails(selected);
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

function filterParamsForModel(rawParams, rawCi, modelMeta, rawSamples) {
  const params = rawParams && typeof rawParams === 'object' ? rawParams : {};
  const ci = rawCi && typeof rawCi === 'object' ? rawCi : {};
  const samples = rawSamples && typeof rawSamples === 'object' ? rawSamples : {};
  const allowed = getModelParamKeySet(modelMeta);
  if (!allowed.size) {
    return { params, ci, samples };
  }

  const filteredParams = {};
  const filteredCi = {};
  const filteredSamples = {};
  Object.keys(params).forEach((key) => {
    if (!allowed.has(key)) return;
    filteredParams[key] = params[key];
    if (Object.prototype.hasOwnProperty.call(ci, key)) {
      filteredCi[key] = ci[key];
    }
  });
  Object.keys(samples).forEach((key) => {
    if (!allowed.has(key)) return;
    const values = samples[key];
    filteredSamples[key] = Array.isArray(values) ? [...values] : values;
  });

  console.debug('[Lagwell] filterParamsForModel allowed keys:', Array.from(allowed));
  console.debug('[Lagwell] filterParamsForModel filtered params:', filteredParams);

  return { params: filteredParams, ci: filteredCi, samples: filteredSamples };
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
        const [params = {}, metrics = {}, fitted = [], ci = {}, samples = {}] = Array.isArray(fitResult) ? fitResult : [];
        const { params: filteredParams, ci: filteredCi, samples: filteredSamples } = filterParamsForModel(
          params,
          ci,
          currentModelMeta,
          samples,
        );
        const metricsObj = metrics && typeof metrics === 'object' ? metrics : {};
        const createdAt = new Date();
        const modelLabel = currentModelMeta?.name || model.toUpperCase();
        const runLabel = `Fit ${fitHistory.length + 1}`;
        const resultObj = {
          params: filteredParams,
          metrics: metricsObj,
          ci: filteredCi,
          curves: {
            observed: times.map((t, idx) => [t, draws[idx]]),
            fitted: Array.isArray(fitted) ? fitted : [],
          },
          samples: filteredSamples,
          model,
          r: _r,
          Q: _Q,
          conf,
          nBoot,
          mode: 'pyodide',
          modelLabel,
          id: `fit-${createdAt.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: createdAt.toISOString(),
          selected: true,
          runLabel,
        };

        window._lastFit = resultObj;
        fitBtn.textContent = 'Processing results...';
        renderParams(resultObj);
        renderMetrics(resultObj);
        fitHistory.push(resultObj);
        renderFitHistory();
        await renderChart(getSelectedFits());
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
  pdfBtn.addEventListener('click', () => {
    if (!reportModal) return;
    reportModal.classList.remove('hidden');
    reportModal.classList.add('flex');
    if (!window._lastFit && statusEl) {
      statusEl.textContent = 'Configure report details after running a fit to enable export.';
    }
  });
}

function closeReportModal() {
  if (!reportModal) return;
  reportModal.classList.add('hidden');
  reportModal.classList.remove('flex');
}

if (cancelReportBtn) {
  cancelReportBtn.addEventListener('click', closeReportModal);
}

if (generateReportBtn) {
  generateReportBtn.addEventListener('click', async () => {
    if (!window._lastFit) return;
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('jsPDF failed to load. Please try again.');
      return;
    }

    const projectName = reportProjectNameInput?.value?.trim() || 'Sample Project';
    const clientName = reportClientInput?.value?.trim() || 'N/A';
    const siteLocation = reportLocationInput?.value?.trim() || 'N/A';

    // --- START: Professional PDF Generation Logic ---
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const { model, r, Q, params, metrics, conf, nBoot, ci, curves } = window._lastFit;
    const modelLabel = window._lastFit?.modelLabel || currentModelMeta?.name || model.toUpperCase();
    const confPercent = Math.round((conf || 0) * 100);
    let y = 0; // Y-position tracker

    // --- 1. Report Header ---
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('Pumping Test Analysis Report', 105, 20, { align: 'center' });

    // --- 2. Project Information Table ---
    const projectInfo = [
      ['Project:', projectName],
      ['Client:', clientName],
      ['Location:', siteLocation],
      ['Test Date:', new Date().toLocaleDateString()],
    ];
    doc.autoTable({
      body: projectInfo,
      theme: 'plain',
      startY: 30,
      styles: { fontSize: 10 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 } },
    });
    y = doc.previousAutoTable.finalY + 10;

    // --- 3. Analysis Settings Table ---
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Analysis Settings', 14, y);
    y += 6;
    const settingsBody = [
      ['Model', modelLabel],
      ['Observation Radius r (m)', formatNumber(r, 3)],
      ['Pumping Rate Q (m³/h)', formatNumber(Q, 3)],
      ['Confidence Level', `${confPercent}%`],
      ['Bootstrap Samples', nBoot],
      ['Computation Runtime', 'Pyodide (In-Browser)'],
    ];
    doc.autoTable({
      head: [['Setting', 'Value']],
      body: settingsBody,
      startY: y,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] },
      didDrawPage: (data) => {
        y = data.cursor.y;
      },
    });
    y = doc.previousAutoTable.finalY + 15;

    // --- 4. Parameter Estimates Table ---
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Parameter Estimates', 14, y);
    y += 6;
    const paramBody = Object.keys(params || {}).map((key) => {
      const ciPair = Array.isArray(ci?.[key]) ? `[${formatNumber(ci[key][0])}, ${formatNumber(ci[key][1])}]` : '—';
      return [key, formatNumber(params[key]), ciPair];
    });
    doc.autoTable({
      head: [['Parameter', 'Estimated Value', `${confPercent}% Confidence Interval`]],
      body: paramBody,
      startY: y,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] },
      didDrawPage: (data) => {
        y = data.cursor.y;
      },
    });
    y = doc.previousAutoTable.finalY + 15;

    // --- 5. Fit Metrics Table ---
    const metricsBody = [
      ['Root Mean Square Error (RMSE)', typeof metrics?.rmse === 'number' ? formatNumber(metrics.rmse) : 'N/A'],
      ['Coefficient of Determination (R²)', typeof metrics?.r2 === 'number' ? formatNumber(metrics.r2, 4) : 'N/A'],
    ];
    doc.autoTable({
      head: [['Metric', 'Value']],
      body: metricsBody,
      startY: y,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] },
      didDrawPage: (data) => {
        y = data.cursor.y;
      },
    });
    y = doc.previousAutoTable.finalY + 10;

    // --- 6. High-Contrast Chart Generation ---
    const chartEl = document.getElementById('chart');
    if (window.Plotly && chartEl && chartEl.data && chartEl.data.length) {
      const observedPoints = Array.isArray(curves?.observed) ? curves.observed : [];
      const fittedPoints = Array.isArray(curves?.fitted) ? curves.fitted : [];
      const exportLayout = {
        paper_bgcolor: 'rgba(255,255,255,1)',
        plot_bgcolor: 'rgba(255,255,255,1)',
        font: { color: '#000000', size: 10 },
        margin: { l: 60, r: 24, t: 40, b: 50 },
        title: { text: 'Time-Drawdown Curve Fit', font: { size: 16 } },
        xaxis: {
          title: 'Time (min)',
          gridcolor: '#e0e0e0',
          zerolinecolor: '#bdbdbd',
        },
        yaxis: {
          title: 'Drawdown (m)',
          gridcolor: '#e0e0e0',
          zerolinecolor: '#bdbdbd',
        },
        legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
      };

      // Re-map curve data to the correct format for Plotly
      const exportObsTrace = {
        name: 'Observed',
        mode: 'markers',
        type: 'scatter',
        marker: { color: '#0d47a1', size: 5 },
        x: observedPoints.map((d) => d[0]),
        y: observedPoints.map((d) => d[1]),
      };
      const exportFitTrace = {
        name: 'Fitted',
        mode: 'lines',
        type: 'scatter',
        line: { color: '#b71c1c', width: 1.5 },
        x: fittedPoints.map((d) => d[0]),
        y: fittedPoints.map((d) => d[1]),
      };

      try {
        const png = await window.Plotly.toImage(chartEl, {
          format: 'png',
          width: 1000,
          height: 550,
          data: [exportObsTrace, exportFitTrace],
          layout: exportLayout,
        });

        const imgWidth = 180;
        const imgHeight = (imgWidth * 550) / 1000;
        if (y + imgHeight + 20 > 280) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Graphical Analysis', 14, y);
        y += 8;
        doc.addImage(png, 'PNG', 14, y, imgWidth, imgHeight);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.text('Figure 1: Observed drawdown vs. fitted analytical model.', 105, y + imgHeight + 5, { align: 'center' });
      } catch (imgErr) {
        console.warn('Unable to export plot image:', imgErr);
        doc.addPage();
        doc.setFontSize(10);
        doc.setTextColor(255, 0, 0);
        doc.text('Error: Could not generate plot image for the report.', 14, 20);
      }
    }

    // --- START: Watermark Addition ---
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(150);
      doc.text('Generated with Lagwell Explorer - Community Edition', 105, 290, { align: 'center' });
    }
    doc.addPage();
    doc.setFontSize(10);
    doc.setTextColor(40);
    doc.text('Upgrade to Lagwell Professional to remove this watermark and add your own company logo.', 14, 20);
    doc.text('Visit our website to learn more.', 14, 26);
    // --- END: Watermark Addition ---

    doc.save(`Lagwell_Report_${model}_${new Date().toISOString().slice(0, 10)}.pdf`);
    // --- END: Professional PDF Generation Logic ---
    closeReportModal();
  });
}

if (reportModal) {
  reportModal.addEventListener('click', (event) => {
    if (event.target === reportModal) {
      closeReportModal();
    }
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
    const unitsLatex = typeof meta?.units === 'string' ? meta.units : '';
    const unitsPlain = unitsLatex ? latexToPlain(unitsLatex) : '';
    const units = unitsLatex
      ? ` <span class="text-xs font-normal text-zinc-500 math" aria-label="${unitsPlain}">(${unitsLatex})</span>`
      : '';
    const labelLatex = typeof meta?.latex === 'string' ? meta.latex : meta?.symbol;
    const labelPlain = labelLatex ? latexToPlain(labelLatex) : latexToPlain(key);
    const label = labelLatex
      ? `<span class="math" aria-label="${labelPlain}">${labelLatex}</span>`
      : `<span>${labelPlain}</span>`;
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

  typesetNow(container);
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

function formatFitTimestamp(isoString) {
  if (!isoString) return 'Just now';
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Just now';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (err) {
    console.warn('Unable to format timestamp', err);
    return 'Just now';
  }
}

function getSelectedFits() {
  return fitHistory.filter((fit) => fit && fit.selected);
}

function renderFitHistory() {
  if (!fitHistoryContainer) return;

  if (clearHistoryBtn) {
    clearHistoryBtn.disabled = fitHistory.length === 0;
  }

  if (!fitHistory.length) {
    fitHistoryContainer.innerHTML = `
      <div class="p-6 text-sm text-zinc-400/80 text-center">
        <svg class="mx-auto h-12 w-12 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h12M3.75 3h16.5M3.75 3v.75A2.25 2.25 0 011.5 6v.75m19.5 0v.75a2.25 2.25 0 01-2.25 2.25h-1.5m-15 4.5h16.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H3.75m16.5 4.5v8.25c0 .621-.504 1.125-1.125 1.125H5.625a1.125 1.125 0 01-1.125-1.125V10.5m16.5 4.5h.75a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H3.75" /></svg>
        <p class="mt-4 font-semibold">No fits yet</p>
        <p class="mt-1 text-zinc-500">Your analysis results will appear here.</p>
      </div>
    `;
    return;
  }

  const list = document.createElement('div');
  list.className = 'fit-history-list divide-y divide-zinc-800/60';

  fitHistory.forEach((fit) => {
    const item = document.createElement('label');
    item.className = 'fit-history-item flex items-center justify-between gap-4 px-4 py-3 transition-colors';
    item.classList.toggle('is-selected', !!fit.selected);

    const info = document.createElement('div');
    info.className = 'space-y-1';

    const title = document.createElement('div');
    title.className = 'text-sm font-semibold text-zinc-100';
    const titleParts = [fit.runLabel, fit.modelLabel];
    title.textContent = titleParts.filter(Boolean).join(' • ') || 'Fit';
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'text-xs text-zinc-400 fit-history-meta';
    const r2 = Number.isFinite(fit.metrics?.r2) ? fmtDec(fit.metrics.r2, 4) : '—';
    const rmse = Number.isFinite(fit.metrics?.rmse) ? formatNumber(fit.metrics.rmse) : '—';
    meta.innerHTML = `
      <span class="font-medium text-zinc-300">${formatFitTimestamp(fit.createdAt)}</span>
      · R² <span class="font-mono text-indigo-200">${r2}</span>
      · RMSE <span class="font-mono text-sky-200">${rmse}</span>
    `;
    info.appendChild(meta);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'fit-history-checkbox h-4 w-4';
    checkbox.checked = !!fit.selected;
    checkbox.addEventListener('change', () => {
      fit.selected = checkbox.checked;
      item.classList.toggle('is-selected', !!fit.selected);
      renderChart(getSelectedFits()).catch((err) => {
        console.error('Failed to refresh chart selection:', err);
      });
    });

    item.appendChild(info);
    item.appendChild(checkbox);
    list.appendChild(item);
  });

  fitHistoryContainer.innerHTML = '';
  fitHistoryContainer.appendChild(list);
}

async function renderChart(fitsToRender = []) {
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

  const hasExplicitArgument = arguments.length > 0;
  const fits = Array.isArray(fitsToRender) ? fitsToRender.filter(Boolean) : [];
  if (!fits.length && !hasExplicitArgument && window._lastFit) {
    fits.push(window._lastFit);
  }

  if (!fits.length) {
    showMessage('Observed and fitted curves will appear here after calibration.');
    return;
  }

  if (!window.Plotly || (typeof window.Plotly.newPlot !== 'function' && typeof window.Plotly.react !== 'function')) {
    showMessage('Plotting library failed to load. Refresh the page and try again.');
    return;
  }

  chartEl.classList.remove('flex', 'items-center', 'justify-center', 'text-sm', 'text-zinc-500');
  chartEl.innerHTML = '';

  const palette = ['#22d3ee', '#a855f7', '#f97316', '#38bdf8', '#f43f5e', '#14b8a6'];
  const bootstrapTraces = [];
  const primaryTraces = [];

  const baseFit = fits[0];
  const observed = Array.isArray(baseFit?.curves?.observed) ? [...baseFit.curves.observed] : [];
  if (observed.length) {
    const sortedObs = observed.sort((a, b) => a[0] - b[0]);
    primaryTraces.push({
      x: sortedObs.map((d) => d[0]),
      y: sortedObs.map((d) => d[1]),
      name: 'Observed',
      mode: 'markers',
      type: 'scatter',
      marker: { color: '#94a3b8', size: 8, opacity: 0.85 },
    });
  }

  const baseFitted = Array.isArray(baseFit?.curves?.fitted)
    ? [...baseFit.curves.fitted].sort((a, b) => a[0] - b[0])
    : [];

  const sampleEntries = baseFit?.samples && typeof baseFit.samples === 'object'
    ? Object.entries(baseFit.samples)
    : [];

  if (baseFitted.length && sampleEntries.length) {
    try {
      const validSamples = sampleEntries.filter(([, values]) => Array.isArray(values) && values.length);
      if (validSamples.length) {
        const sampleLengths = validSamples.map(([, values]) => values.length);
        const totalSamples = sampleLengths.length ? Math.max(...sampleLengths) : 0;
        const limit = Math.min(totalSamples, 50);
        if (limit > 0) {
          const times = baseFitted.map((d) => d[0]);
          const py = await ensurePyodide();
          const drawdownName = baseFit.model === 'theis' ? 'theis_drawdown' : 'lagging_drawdown_time';
          const drawdownFunc = py.globals.get(drawdownName);
          if (!drawdownFunc) {
            console.warn(`Missing drawdown function: ${drawdownName}`);
          } else {
            const proxies = [];
            try {
              const timeProxy = py.toPy(times);
              proxies.push(timeProxy);
              for (let idx = 0; idx < limit; idx += 1) {
                const paramSet = {};
                let skip = false;
                validSamples.forEach(([key, values]) => {
                if (skip) return;
                if (idx >= values.length) {
                  skip = true;
                  return;
                }
                const value = values[idx];
                if (value == null || Number.isNaN(value)) {
                  skip = true;
                  return;
                }
                paramSet[key] = Number(value);
              });
              if (skip) continue;

              let curveProxy = null;
              if (baseFit.model === 'theis') {
                const Tval = Number.isFinite(paramSet.T) ? paramSet.T : Number(baseFit.params?.T);
                const Sval = Number.isFinite(paramSet.S) ? paramSet.S : Number(baseFit.params?.S);
                if (!Number.isFinite(Tval) || !Number.isFinite(Sval)) continue;
                curveProxy = drawdownFunc(timeProxy, Tval, Sval, Number(baseFit.r), Number(baseFit.Q));
              } else {
                const Tval = Number.isFinite(paramSet.T) ? paramSet.T : Number(baseFit.params?.T);
                const Sval = Number.isFinite(paramSet.S) ? paramSet.S : Number(baseFit.params?.S);
                const tauQ = Number.isFinite(paramSet.tau_q) ? paramSet.tau_q : Number(baseFit.params?.tau_q);
                const tauS = Number.isFinite(paramSet.tau_s) ? paramSet.tau_s : Number(baseFit.params?.tau_s);
                const jVal = Number.isFinite(paramSet.j) ? paramSet.j : Number(baseFit.params?.j ?? 0);
                if (![Tval, Sval, tauQ, tauS].every(Number.isFinite)) continue;
                curveProxy = drawdownFunc(timeProxy, Tval, Sval, tauQ, tauS, Number(baseFit.r), Number(baseFit.Q), jVal);
              }
              if (!curveProxy) continue;
              proxies.push(curveProxy);
              const jsValues = curveProxy.toJs();
              const yValues = Array.isArray(jsValues) ? jsValues : Array.from(jsValues ?? []);
              if (!yValues.length) continue;
                bootstrapTraces.push({
                  x: times,
                  y: yValues,
                  mode: 'lines',
                  type: 'scatter',
                  line: { color: 'rgba(113, 113, 122, 0.2)', width: 1 },
                  hoverinfo: 'skip',
                  name: 'Bootstrap samples',
                  showlegend: idx === 0,
                });
              }
            } catch (err) {
              console.warn('Bootstrap curve rendering failed:', err);
            } finally {
              proxies.forEach((proxy) => {
                if (proxy && typeof proxy.destroy === 'function') {
                  proxy.destroy();
                }
              });
              if (drawdownFunc && typeof drawdownFunc.destroy === 'function') {
                drawdownFunc.destroy();
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Unable to compute bootstrap samples:', err);
    }
  }

  fits.forEach((fit, idx) => {
    const sortedFit = Array.isArray(fit.curves?.fitted) ? [...fit.curves.fitted].sort((a, b) => a[0] - b[0]) : [];
    if (!sortedFit.length) return;
    const color = palette[idx % palette.length];
    const r2 = Number.isFinite(fit.metrics?.r2) ? fmtDec(fit.metrics.r2, 3) : null;
    const legendLabelParts = [fit.runLabel, fit.modelLabel];
    if (r2 != null) {
      legendLabelParts.push(`R² ${r2}`);
    }
    primaryTraces.push({
      x: sortedFit.map((d) => d[0]),
      y: sortedFit.map((d) => d[1]),
      name: legendLabelParts.filter(Boolean).join(' • '),
      mode: 'lines',
      type: 'scatter',
      line: { color, width: 3 },
    });
  });

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
  const config = {
    responsive: true,
    scrollZoom: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'sendDataToCloud'],
    displaylogo: false,
  };

  const plotter = chartEl.dataset.hasPlot === '1' && typeof window.Plotly.react === 'function'
    ? window.Plotly.react
    : window.Plotly.newPlot;

  const handleError = (err) => {
    console.error('Plotly render failed:', err);
    showMessage('Unable to render plot. Check the console for details and retry.');
  };

  const traces = [...bootstrapTraces, ...primaryTraces];

  try {
    const maybePromise = plotter(chartEl, traces, layout, config);
    if (maybePromise && typeof maybePromise.then === 'function') {
      await maybePromise;
    }
    chartEl.dataset.hasPlot = '1';
  } catch (err) {
    handleError(err);
  }
}

function initOnboardingTour() {
  if (typeof Shepherd === 'undefined') return;
  const storage = getSessionStorage();
  if (storage?.getItem(TOUR_STORAGE_KEY)) return;

  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      classes: 'bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-2xl rounded-2xl max-w-sm',
      cancelIcon: { enabled: true },
      scrollTo: { behavior: 'smooth', block: 'center' },
    },
  });

  const steps = [
    {
      id: 'welcome',
      title: 'Welcome to Lagwell',
      text: 'Analyze pumping tests privately in your browser with no uploads required.',
      attachTo: { element: '#heroValue', on: 'bottom' },
    },
    {
      id: 'data',
      title: 'Load sample data',
      text: 'Try the explorer instantly by loading the example dataset or importing your CSV.',
      attachTo: { element: '#loadExample', on: 'bottom' },
    },
    {
      id: 'model',
      title: 'Choose your model',
      text: 'Compare Theis and Lagging responses. Professional plans unlock fractured models.',
      attachTo: { element: '#model', on: 'bottom' },
    },
    {
      id: 'report',
      title: 'Export branded reports',
      text: 'Fit the model, review metrics, and generate a polished PDF with one click.',
      attachTo: { element: '#pdfBtn', on: 'top' },
    },
  ];

  steps.forEach((step, index) => {
    const hasTarget = step.attachTo?.element && document.querySelector(step.attachTo.element);
    tour.addStep({
      id: step.id,
      title: step.title,
      text: step.text,
      attachTo: hasTarget ? step.attachTo : undefined,
      buttons: [
        {
          text: 'Skip',
          classes: 'shepherd-button-secondary',
          action: () => tour.cancel(),
        },
        {
          text: index === steps.length - 1 ? 'Finish' : 'Next',
          classes: 'shepherd-button-primary bg-indigo-500 hover:bg-indigo-600 text-white',
          action: () => (index === steps.length - 1 ? tour.complete() : tour.next()),
        },
      ],
    });
  });

  if (!tour.steps?.length) return;

  const markComplete = () => {
    try {
      getSessionStorage()?.setItem(TOUR_STORAGE_KEY, '1');
    } catch (err) {
      console.warn('Unable to persist onboarding completion', err);
    }
  };

  tour.on('complete', markComplete);
  tour.on('cancel', markComplete);

  setTimeout(() => {
    tour.start();
  }, 600);
}

function showUpgradeModal(featureName) {
  const modalId = 'upgradeModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm hidden items-center justify-center';
    modal.innerHTML = `
      <div class="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-xl w-full max-w-md p-6 m-4 space-y-4 text-center">
        <h2 class="text-2xl font-semibold">Unlock Advanced Analysis with Professional</h2>
        <p class="text-zinc-300">The <strong>"Feature"</strong> feature is part of our Professional plan. Upgrade to save time and unlock powerful tools like derivative analysis and custom-branded reports.</p>
        <div class="flex gap-4 pt-4">
          <button id="closeUpgradeModalBtn" class="w-full inline-flex items-center justify-center px-4 py-2 rounded-lg border border-zinc-700 text-sm font-semibold text-zinc-200 hover:bg-zinc-800/60 transition">Maybe Later</button>
          <a href="./pricing.html" class="w-full inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-500 text-sm font-semibold text-white hover:bg-indigo-600 transition">View Pricing</a>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const closeBtn = modal.querySelector('#closeUpgradeModalBtn');
    const hideModal = () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    };
    if (closeBtn) {
      closeBtn.addEventListener('click', hideModal);
    }
    modal.addEventListener('click', (event) => {
      if (event.target === modal) hideModal();
    });
  }

  const description = modal.querySelector('p strong');
  if (description) {
    description.textContent = `"${featureName}"`;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

const proFeatureDatalogger = document.getElementById('proFeatureDatalogger');
if (proFeatureDatalogger) {
  proFeatureDatalogger.addEventListener('click', () => {
    showUpgradeModal('Import from Datalogger');
  });
}

renderFitHistory();

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', async () => {
    fitHistory = [];
    window._lastFit = null;
    renderFitHistory();
    try {
      await renderChart([]);
    } catch (err) {
      console.error('Failed to clear chart:', err);
    }
    if (pdfBtn) pdfBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'History cleared. Ready for new fit.';
  });
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
