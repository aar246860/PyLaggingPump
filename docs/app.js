// Lagwell Explorer front-end logic
// ---------------------------------
// This script orchestrates the in-browser pumping test workflow. It loads
// metadata about the analytical models, persists the user's session, drives the
// Pyodide-powered solver, renders interactive plots, and manages the PDF
// exporter.

// -----------------------------------------------------------------------------
// DOM helpers and element references
// -----------------------------------------------------------------------------
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const SESSION_KEY = 'lagwellSession';

// Core controls
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

// File + example data
const fileInput = $('#csvFile');
const exampleBtn = $('#loadExample');

// Report modal
const reportModal = $('#reportModal');
const reportModalContent = $('#reportModalContent');
const generateReportBtn = $('#generateReportBtn');
const cancelReportBtn = $('#cancelReportBtn');
const reportProjectNameInput = $('#reportProjectName');
const reportClientInput = $('#reportClient');
const reportLocationInput = $('#reportLocation');

// Fit history widgets
const fitHistoryContainer = $('#fitHistory');
const clearHistoryBtn = $('#clearHistoryBtn');

// -----------------------------------------------------------------------------
// Runtime state
// -----------------------------------------------------------------------------
let fitHistory = [];
let lastModelSelection = modelSelect?.value ?? 'lagging';
let modelsCache = null;
let currentModelMeta = null;
let modelDetailsRenderToken = 0;
let pyodideInstance = null;
let solverLoaded = false;

// -----------------------------------------------------------------------------
// Utility helpers
// -----------------------------------------------------------------------------
const clampDigits = (value, digits = 3) => {
  if (value == null || !Number.isFinite(value)) return '—';
  const absVal = Math.abs(value);
  if (absVal !== 0 && (absVal < 1e-3 || absVal > 1e4)) {
    return Number(value).toExponential(digits);
  }
  return Number(value).toFixed(digits);
};

const fmtDec = (value, digits = 4) => {
  if (value == null || !Number.isFinite(value)) return '—';
  return Number(value).toFixed(digits);
};

const fmtExp = (value, digits = 3) => {
  if (value == null || !Number.isFinite(value)) return '—';
  const absVal = Math.abs(value);
  if (absVal !== 0 && (absVal < 1e-3 || absVal > 1e4)) {
    return Number(value).toExponential(digits);
  }
  return Number(value).toFixed(digits + 1);
};

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

function latexToPlain(text) {
  if (typeof text !== 'string') return '';
  return text
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

function showStatus(message) {
  if (!statusEl) return;
  statusEl.textContent = message || '';
}

function showErrorToast(message) {
  const id = 'lagwell-toast-root';
  let container = document.getElementById(id);
  if (!container) {
    container = document.createElement('div');
    container.id = id;
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
  toast.textContent = message || 'Unexpected error';
  toast.setAttribute('role', 'alert');
  toast.style.background = 'rgba(239, 68, 68, 0.92)';
  toast.style.color = '#fff';
  toast.style.padding = '0.75rem 1.2rem';
  toast.style.borderRadius = '0.75rem';
  toast.style.boxShadow = '0 18px 45px rgba(0,0,0,0.35)';
  toast.style.backdropFilter = 'saturate(120%) blur(6px)';
  toast.style.fontWeight = '600';
  toast.style.fontSize = '0.95rem';
  toast.style.pointerEvents = 'auto';
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
  }, 4800);
}

// -----------------------------------------------------------------------------
// Session persistence
// -----------------------------------------------------------------------------
function getStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    console.warn('localStorage unavailable:', err);
    return null;
  }
}

function saveSession() {
  const storage = getStorage();
  if (!storage) return;
  const payload = {
    r: radiusInput?.value ?? '',
    Q: qInput?.value ?? '',
    model: modelSelect?.value ?? '',
    conf: confSelect?.value ?? '',
    nBoot: nBootSelect?.value ?? '',
    raw: rawInput?.value ?? '',
  };
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Unable to persist session:', err);
  }
}

function loadSession() {
  const storage = getStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (radiusInput && payload.r != null) radiusInput.value = payload.r;
    if (qInput && payload.Q != null) qInput.value = payload.Q;
    if (confSelect && payload.conf != null) confSelect.value = payload.conf;
    if (nBootSelect && payload.nBoot != null) nBootSelect.value = payload.nBoot;
    if (rawInput && typeof payload.raw === 'string') rawInput.value = payload.raw;
    if (modelSelect && payload.model) {
      modelSelect.value = payload.model;
      lastModelSelection = payload.model;
    }
  } catch (err) {
    console.warn('Unable to restore session:', err);
  }
}

function registerSessionListeners() {
  [radiusInput, qInput, modelSelect, confSelect, nBootSelect, rawInput].forEach((el) => {
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, saveSession);
  });
}

// -----------------------------------------------------------------------------
// Model metadata + descriptions
// -----------------------------------------------------------------------------
async function loadModelMetadata() {
  if (modelsCache) return modelsCache;
  const response = await fetch('./models.json');
  if (!response.ok) {
    throw new Error(`Unable to load model metadata (${response.status})`);
  }
  modelsCache = await response.json();
  return modelsCache;
}

function getModelParamKeySet(meta) {
  const params = Array.isArray(meta?.parameters) ? meta.parameters : [];
  const keys = params
    .map((param) => (typeof param.key === 'string' ? param.key : param.symbol))
    .filter((key) => typeof key === 'string' && key.trim().length > 0);
  return new Set(keys);
}

function filterParamsForModel(rawParams, rawCi, modelMeta, rawSamples) {
  const allowed = getModelParamKeySet(modelMeta);
  if (!allowed.size) {
    return {
      params: rawParams || {},
      ci: rawCi || {},
      samples: rawSamples || {},
    };
  }

  const params = {};
  const ci = {};
  const samples = {};

  Object.entries(rawParams || {}).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    params[key] = value;
    if (Array.isArray(rawCi?.[key])) {
      ci[key] = [...rawCi[key]];
    }
  });

  Object.entries(rawSamples || {}).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    samples[key] = Array.isArray(value) ? [...value] : value;
  });

  return { params, ci, samples };
}

async function renderModelDetails(modelId) {
  if (!modelDetailsEl) return;
  const token = ++modelDetailsRenderToken;
  try {
    const models = await loadModelMetadata();
    if (token !== modelDetailsRenderToken) return;

    const model = models?.[modelId];
    currentModelMeta = model || null;

    if (!model) {
      modelDetailsEl.innerHTML = '<p class="text-sm text-zinc-400">Model metadata unavailable.</p>';
      return;
    }

    const paramsHtml = (model.parameters || [])
      .map((param) => {
        const latex = param.latex || param.symbol || param.key || '';
        const labelPlain = latexToPlain(latex);
        const units = param.units ? `<div class="math text-xs text-zinc-400">${param.units}</div>` : '';
        const description = param.desc || param.description || '';
        const estimated = Boolean(param.estimated ?? param.estimate);
        const badge = estimated
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/20 text-indigo-200">Estimated</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[10px] bg-zinc-700/40 text-zinc-300">Fixed</span>';
        return `
          <div class="grid grid-cols-[auto_1fr] gap-3 items-start">
            <div class="math text-lg font-semibold text-indigo-100" aria-label="${labelPlain}">${latex}</div>
            <div class="space-y-1">
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-medium text-zinc-100">${description}</span>
                ${badge}
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

    const formula = model.formula
      ? `<div class="math-block text-indigo-100/90">${model.formula}</div>`
      : '<p class="text-sm text-zinc-400">Formula not provided.</p>';

    modelDetailsEl.innerHTML = `
      <div class="space-y-5">
        <div class="space-y-2">
          <h3 class="text-lg font-semibold text-zinc-100">${model.name}</h3>
          ${formula}
        </div>
        <div class="space-y-2">
          <h4 class="text-xs uppercase tracking-[0.2em] text-zinc-500">Parameters</h4>
          <div class="space-y-3">${paramsHtml || '<p class="text-sm text-zinc-400">No parameter metadata.</p>'}</div>
        </div>
        <div class="space-y-2">
          <h4 class="text-xs uppercase tracking-[0.2em] text-zinc-500">Assumptions</h4>
          <ul class="list-disc list-inside text-sm text-zinc-300">${assumptionsHtml || '<li>Not documented.</li>'}</ul>
        </div>
      </div>
    `;

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
    lastModelSelection = selected;
    renderModelDetails(selected);
    saveSession();
  });
}

// -----------------------------------------------------------------------------
// Data parsing helpers
// -----------------------------------------------------------------------------
function parseCsvOrText(raw, defaultR, defaultQ) {
  const trimmed = (raw || '').trim();
  if (!trimmed.length) {
    return { data: [], times: [], draws: [], _r: defaultR, _Q: defaultQ };
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { data: [], times: [], draws: [], _r: defaultR, _Q: defaultQ };
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const idxT = headers.findIndex((h) => /time(_min)?/i.test(h));
  const idxS = headers.findIndex((h) => /drawdown(_m)?/i.test(h));
  const idxR = headers.findIndex((h) => /^r(_m)?$/i.test(h));
  const idxQ = headers.findIndex((h) => /^q(_m3ph)?$/i.test(h));

  if (idxT === -1 || idxS === -1) {
    throw new Error('CSV must include time_min and drawdown_m columns.');
  }

  let r = Number.isFinite(defaultR) ? defaultR : NaN;
  let Q = Number.isFinite(defaultQ) ? defaultQ : NaN;
  const data = [];
  const times = [];
  const draws = [];

  for (let i = 1; i < lines.length; i += 1) {
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

// -----------------------------------------------------------------------------
// Pyodide bootstrap solver
// -----------------------------------------------------------------------------
async function ensurePyodide() {
  if (pyodideInstance && solverLoaded) return pyodideInstance;
  if (typeof loadPyodide !== 'function') {
    throw new Error('Pyodide runtime is not available.');
  }

  if (!pyodideInstance) {
    try {
      if (pyStatus) {
        pyStatus.textContent = 'Loading Pyodide runtime…';
        pyStatus.classList.remove('ready');
      }
      pyodideInstance = await loadPyodide();
      if (pyStatus) {
        pyStatus.textContent = 'Fetching scientific packages…';
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
      if (pyStatus) pyStatus.textContent = 'Loading analytical solver…';
      const code = await (await fetch('./py/solver.py')).text();
      await pyodideInstance.runPythonAsync(code);
      solverLoaded = true;
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

window.addEventListener('unload', () => {
  if (!pyodideInstance) return;
  try {
    const fitProxy = pyodideInstance.globals.get('fit_with_ci');
    if (fitProxy && typeof fitProxy.destroy === 'function') fitProxy.destroy();
  } catch (err) {
    console.warn('Unable to destroy fit_with_ci proxy:', err);
  }
});

// -----------------------------------------------------------------------------
// Render helpers (params, metrics, history, chart)
// -----------------------------------------------------------------------------
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
        <svg class="mx-auto h-12 w-12 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" /></svg>
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
    const rmse = Number.isFinite(fit.metrics?.rmse) ? clampDigits(fit.metrics.rmse) : '—';
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
    chartEl.classList.add('flex', 'items-center', 'justify-center', 'text-sm', 'text-zinc-500');
    chartEl.innerHTML = `<div class="px-6 text-center">${message}</div>`;
    if (window.Plotly && typeof window.Plotly.purge === 'function') {
      try {
        window.Plotly.purge(chartEl);
      } catch (err) {
        console.warn('Plotly purge failed:', err);
      }
    }
  };

  if (!window.Plotly) {
    showMessage('Plotting library failed to load. Refresh the page and try again.');
    return;
  }

  if (!fitsToRender.length) {
    showMessage('Observed vs. fitted curves will render here.');
    return;
  }

  chartEl.classList.remove('flex', 'items-center', 'justify-center', 'text-sm', 'text-zinc-500');
  chartEl.innerHTML = '';

  const palette = ['#22d3ee', '#a855f7', '#f97316', '#38bdf8', '#f43f5e', '#14b8a6'];
  const bootstrapTraces = [];
  const primaryTraces = [];

  const baseFit = fitsToRender[0];
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

  fitsToRender.forEach((fit, idx) => {
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

  const traces = [...bootstrapTraces, ...primaryTraces];

  try {
    const maybePromise = plotter(chartEl, traces, layout, config);
    if (maybePromise && typeof maybePromise.then === 'function') {
      await maybePromise;
    }
    chartEl.dataset.hasPlot = '1';
  } catch (err) {
    console.error('Plotly render failed:', err);
    showMessage('Unable to render plot. Check the console for details and retry.');
  }
}

// -----------------------------------------------------------------------------
// PDF report generation
// -----------------------------------------------------------------------------
async function exportPdfReport() {
  if (!window._lastFit) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('jsPDF failed to load. Please try again.');
    return;
  }

  const projectName = reportProjectNameInput?.value?.trim() || 'Sample Project';
  const clientName = reportClientInput?.value?.trim() || 'N/A';
  const siteLocation = reportLocationInput?.value?.trim() || 'N/A';

  const { model, r, Q, params, metrics, conf, nBoot, ci, curves } = window._lastFit;
  const modelLabel = window._lastFit?.modelLabel || currentModelMeta?.name || model.toUpperCase();
  const confPercent = Math.round((conf || 0) * 100);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Header
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Pumping Test Analysis Report', 105, 20, { align: 'center' });

  // Project info
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
  let y = doc.previousAutoTable.finalY + 10;

  // Analysis settings
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Analysis Settings', 14, y);
  y += 6;
  const settingsBody = [
    ['Model', modelLabel],
    ['Observation Radius r (m)', clampDigits(r, 3)],
    ['Pumping Rate Q (m³/h)', clampDigits(Q, 3)],
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

  // Parameters
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Parameter Estimates', 14, y);
  y += 6;
  const paramBody = Object.keys(params || {}).map((key) => {
    const ciPair = Array.isArray(ci?.[key]) ? `[${clampDigits(ci[key][0])}, ${clampDigits(ci[key][1])}]` : '—';
    return [key, clampDigits(params[key]), ciPair];
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

  // Metrics
  const metricsBody = [
    ['Root Mean Square Error (RMSE)', Number.isFinite(metrics?.rmse) ? clampDigits(metrics.rmse) : 'N/A'],
    ['Coefficient of Determination (R²)', Number.isFinite(metrics?.r2) ? fmtDec(metrics.r2, 4) : 'N/A'],
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

  // Chart export
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
      line: { color: '#f97316', width: 2.5 },
      x: fittedPoints.map((d) => d[0]),
      y: fittedPoints.map((d) => d[1]),
    };

    try {
      const imageData = await window.Plotly.toImage({
        data: [exportObsTrace, exportFitTrace],
        layout: exportLayout,
        config: { displayModeBar: false },
      }, { format: 'png', height: 500, width: 700 });
      const imgProps = doc.getImageProperties(imageData);
      const pdfWidth = doc.internal.pageSize.getWidth() - 28;
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      doc.addImage(imageData, 'PNG', 14, y, pdfWidth, imgHeight, undefined, 'FAST');
      doc.setFontSize(10);
      doc.text('Figure 1: Observed drawdown vs. fitted analytical model.', 105, y + imgHeight + 5, { align: 'center' });
      y += imgHeight + 20;
    } catch (err) {
      console.warn('Plot export failed:', err);
    }
  }

  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('Generated with Lagwell Explorer · https://github.com/aar246860/PyLaggingPump', 14, 290);

  doc.save(`lagwell-report-${Date.now()}.pdf`);
}

// -----------------------------------------------------------------------------
// Event handlers
// -----------------------------------------------------------------------------
if (exampleBtn) {
  exampleBtn.addEventListener('click', () => {
    const demo = `time_min,drawdown_m,r_m,Q_m3ph\n0.1,0.02,30,120\n0.2,0.05,30,120\n0.5,0.12,30,120\n1.0,0.18,30,120\n2.0,0.24,30,120\n3.5,0.30,30,120\n5.0,0.36,30,120`;
    if (rawInput) {
      rawInput.value = demo;
      saveSession();
      showStatus('Example dataset loaded. Adjust values and press “Fit Model”.');
    }
  });
}

if (fileInput) {
  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (rawInput) rawInput.value = text;
    saveSession();
    showStatus(`Loaded ${file.name}. Review and press “Fit Model”.`);
  });
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
      opacity: 0.85;
    }
    @keyframes fit-btn-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

async function runFit() {
  if (!fitBtn) return;
  ensureLoadingStyles();
  saveSession();
  showStatus('Parsing data…');
  if (pdfBtn) pdfBtn.disabled = true;

  const nBoot = parseInt(nBootSelect?.value ?? '100', 10) || 100;
  const originalLabel = fitBtn.textContent?.trim() || 'Fit Model';
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

    showStatus('Initializing Python runtime…');
    fitBtn.textContent = 'Initializing Python…';
    const py = await ensurePyodide();

    showStatus(`Running bootstrap fits (N=${nBoot})…`);
    fitBtn.textContent = `Running bootstrap (N=${nBoot})…`;

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
      fitBtn.textContent = 'Processing results…';
      renderParams(resultObj);
      renderMetrics(resultObj);
      fitHistory.push(resultObj);
      fitHistory = fitHistory.map((fit, idx) => ({ ...fit, selected: idx === fitHistory.length - 1 }));
      renderFitHistory();
      await renderChart(getSelectedFits());
      if (pdfBtn) pdfBtn.disabled = false;
      showStatus(`Fit complete. Bootstrap N=${nBoot}.`);
      fitBtn.textContent = 'Fit complete';
    } finally {
      if (py && py.ffi && typeof py.ffi.destroy_proxies === 'function') {
        py.ffi.destroy_proxies(pyproxies);
      } else {
        pyproxies.forEach((proxy) => {
          if (proxy && typeof proxy.destroy === 'function') proxy.destroy();
        });
      }
      if (resultPy && typeof resultPy.destroy === 'function') resultPy.destroy();
      if (fitPy && typeof fitPy.destroy === 'function') fitPy.destroy();
      if (timesProxy && typeof timesProxy.destroy === 'function') timesProxy.destroy();
      if (drawsProxy && typeof drawsProxy.destroy === 'function') drawsProxy.destroy();
    }
  } catch (err) {
    console.error(err);
    showErrorToast(err.message);
    showStatus('Error encountered. See notification for details.');
  } finally {
    fitBtn.disabled = false;
    fitBtn.classList.remove('is-loading');
    fitBtn.removeAttribute('aria-busy');
    const original = fitBtn.dataset.originalLabel || 'Fit Model';
    fitBtn.textContent = original;
  }
}

if (fitBtn) {
  fitBtn.addEventListener('click', () => {
    runFit().catch((err) => {
      console.error('Fit failed:', err);
    });
  });
}

if (pdfBtn) {
  pdfBtn.addEventListener('click', () => {
    if (!window._lastFit) return;
    if (reportModal) {
      reportModal.classList.remove('hidden');
      reportModal.classList.add('flex');
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

if (reportModal) {
  reportModal.addEventListener('click', (event) => {
    if (event.target === reportModal) {
      closeReportModal();
    }
  });
}

if (reportModalContent) {
  reportModalContent.addEventListener('click', (event) => {
    event.stopPropagation();
  });
}

if (generateReportBtn) {
  generateReportBtn.addEventListener('click', async () => {
    await exportPdfReport();
    closeReportModal();
  });
}

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
    showStatus('History cleared. Ready for new fit.');
  });
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  loadSession();
  registerSessionListeners();
  lastModelSelection = modelSelect?.value ?? lastModelSelection;
  renderFitHistory();
});

