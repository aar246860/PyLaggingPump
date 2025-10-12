const $ = (sel) => document.querySelector(sel);

const pyStatus = $('#pyStatus');
let pyodideInstance = null;
let solverLoaded = false;
let fitPy = null;

async function ensurePyodide() {
  if (pyodideInstance && solverLoaded) {
    return pyodideInstance;
  }
  if (typeof loadPyodide !== 'function') {
    throw new Error('Pyodide 未載入');
  }

  if (!pyodideInstance) {
    try {
      if (pyStatus) {
        pyStatus.textContent = 'Python 核心載入中（首次啟動需一點時間）...';
        pyStatus.classList.remove('ready');
      }
      pyodideInstance = await loadPyodide();
      if (pyStatus) {
        pyStatus.textContent = '載入科學套件（NumPy / SciPy）...';
      }
      await pyodideInstance.loadPackage(['numpy', 'scipy']);
    } catch (err) {
      if (pyStatus) {
        pyStatus.textContent = 'Python 載入失敗：' + err.message;
        pyStatus.classList.remove('ready');
      }
      throw err;
    }
  }

  if (!solverLoaded) {
    try {
      if (pyStatus) {
        pyStatus.textContent = '載入 Lagging 求解器...';
      }
      const code = await (await fetch('./py/solver.py')).text();
      await pyodideInstance.runPythonAsync(code);
      solverLoaded = true;
      if (fitPy && typeof fitPy.destroy === 'function') {
        fitPy.destroy();
      }
      fitPy = pyodideInstance.globals.get('fit_model');
      if (pyStatus) {
        pyStatus.textContent = 'Python ready（瀏覽器端運算）';
        pyStatus.classList.add('ready');
      }
    } catch (err) {
      if (pyStatus) {
        pyStatus.textContent = '載入求解器失敗：' + err.message;
        pyStatus.classList.remove('ready');
      }
      throw err;
    }
  }

  if (!fitPy) {
    fitPy = pyodideInstance.globals.get('fit_model');
  }

  return pyodideInstance;
}

$('#loadExample').addEventListener('click', () => {
  const demo = `time_min,drawdown_m,r_m,Q_m3ph
0.1,0.02,30,120
0.2,0.05,30,120
0.5,0.12,30,120
1.0,0.18,30,120
2.0,0.24,30,120
3.5,0.30,30,120
5.0,0.36,30,120`;
  $('#raw').value = demo;
});

$('#csvFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const txt = await f.text();
  $('#raw').value = txt;
});

$('#fitBtn').addEventListener('click', async () => {
  $('#status').textContent = '解析資料中...';
  $('#pdfBtn').disabled = true;
  try {
    const rInput = parseFloat($('#r').value);
    const qInput = parseFloat($('#Q').value);
    const model = $('#model').value;
    const conf = parseFloat($('#conf').value);
    const parsed = parseCsvOrText($('#raw').value, rInput, qInput);
    const { data, times, draws, _r, _Q } = parsed;
    if (!times.length) {
      throw new Error('沒有有效的觀測資料');
    }

    $('#status').textContent = '初始化 Python（Pyodide）...';
    const py = await ensurePyodide();
    $('#status').textContent = '擬合中（瀏覽器端 Python）...';

    const pyTimes = py.toPy(Array.from(times));
    const pyDraws = py.toPy(Array.from(draws));

    let pyResult = null;
    const pyproxies = [];
    try {
      if (!fitPy || typeof fitPy.call !== 'function') {
        fitPy = py.globals.get('fit_model');
      }
      if (!fitPy || typeof fitPy.call !== 'function') {
        throw new Error('fit_model 尚未載入');
      }
      pyResult = fitPy(pyTimes, pyDraws, model, _r, _Q);
      const fitResult = pyResult.toJs({ pyproxies, dict_converter: Object.fromEntries });
      try {
        const [params = {}, metrics = {}, fitted = []] = Array.isArray(fitResult) ? fitResult : [];
        const resultObj = {
          params: params || {},
          metrics: metrics || {},
          ci: {},
          curves: {
            observed: times.map((t, idx) => [t, draws[idx]]),
            fitted: Array.isArray(fitted) ? fitted : [],
          },
          model,
          r: _r,
          Q: _Q,
          conf,
          mode: 'pyodide',
        };

        window._lastFit = resultObj;
        renderParams(resultObj);
        renderChart(resultObj);
        $('#pdfBtn').disabled = false;
        $('#status').textContent = '完成（瀏覽器端 Python）';
      } finally {
        for (const p of pyproxies) {
          if (p && typeof p.destroy === 'function') p.destroy();
        }
        if (pyResult && typeof pyResult.destroy === 'function') pyResult.destroy();
      }
    } finally {
      if (pyTimes && typeof pyTimes.destroy === 'function') pyTimes.destroy();
      if (pyDraws && typeof pyDraws.destroy === 'function') pyDraws.destroy();
    }

  } catch (err) {
    console.error(err);
    $('#status').textContent = '錯誤：' + err.message;
  }
});

$('#pdfBtn').addEventListener('click', async () => {
  if (!window._lastFit) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('jsPDF 載入失敗，請稍後再試');
    return;
  }
  const doc = new window.jspdf.jsPDF();
  const { model, r, Q, params, metrics, conf } = window._lastFit;
  doc.setFontSize(18);
  doc.text('Lagwell 抽水試驗報告', 14, 20);
  doc.setFontSize(12);
  doc.text(`模型：${model.toUpperCase()}`, 14, 32);
  doc.text(`半徑 r (m)：${formatNumber(r, 3)}`, 14, 40);
  doc.text(`抽水率 Q (m³/h)：${formatNumber(Q, 3)}`, 14, 48);
  doc.text(`信賴水準：${Math.round((conf || 0) * 100)}%`, 14, 56);
  doc.text('計算模式：瀏覽器端 Python (Pyodide)', 14, 64);

  let y = 78;
  doc.setFontSize(14);
  doc.text('參數估計', 14, y);
  y += 8;
  doc.setFontSize(12);
  Object.entries(params || {}).forEach(([key, value]) => {
    doc.text(`${key} = ${formatNumber(value)}`, 18, y);
    y += 7;
  });
  if (!Object.keys(params || {}).length) {
    doc.text('（無資料）', 18, y);
    y += 7;
  }
  y += 3;
  doc.setFontSize(14);
  doc.text('統計指標', 14, y);
  y += 8;
  doc.setFontSize(12);
  if (metrics) {
    if (typeof metrics.rmse === 'number') {
      doc.text(`RMSE = ${formatNumber(metrics.rmse)}`, 18, y);
      y += 7;
    }
    if (typeof metrics.r2 === 'number') {
      doc.text(`R² = ${formatNumber(metrics.r2, 4)}`, 18, y);
      y += 7;
    }
  }
  if (!metrics || (typeof metrics.rmse !== 'number' && typeof metrics.r2 !== 'number')) {
    doc.text('（無資料）', 18, y);
    y += 7;
  }

  doc.save('lagwell_report.pdf');
});

function parseCsvOrText(txt, defaultR, defaultQ) {
  const lines = txt.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { data: [], times: [], draws: [], _r: defaultR, _Q: defaultQ };
  const headers = lines[0].split(',').map(h => h.trim());
  const idxT = headers.findIndex(h => /time_min/i.test(h));
  const idxS = headers.findIndex(h => /drawdown_m/i.test(h));
  const idxR = headers.findIndex(h => /r(_m)?/i.test(h));
  const idxQ = headers.findIndex(h => /Q(_m3ph)?/i.test(h));
  if (idxT === -1 || idxS === -1) throw new Error('需要欄位 time_min, drawdown_m');

  let r = isFinite(defaultR) ? defaultR : NaN;
  let Q = isFinite(defaultQ) ? defaultQ : NaN;

  const data = [];
  const times = [];
  const draws = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map(x => x.trim());
    if (!row.length || row[0] === '') continue;
    const t = parseFloat(row[idxT]);
    const s = parseFloat(row[idxS]);
    if (!isFinite(t) || !isFinite(s)) continue;
    data.push({ t, s });
    times.push(t);
    draws.push(s);
    if (idxR !== -1 && !isFinite(r)) r = parseFloat(row[idxR]);
    if (idxQ !== -1 && !isFinite(Q)) Q = parseFloat(row[idxQ]);
  }
  if (!isFinite(r)) r = defaultR;
  if (!isFinite(Q)) Q = defaultQ;
  return { data, times, draws, _r: r, _Q: Q };
}

function renderParams(result) {
  const p = result.params || {};
  const ci = result.ci || {};
  const metrics = result.metrics || {};
  const fmtExp = (x) => (x == null || !isFinite(x) ? '-' : Number(x).toExponential(3));
  const fmtDec = (x) => (x == null || !isFinite(x) ? '-' : Number(x).toFixed(4));
  const rows = Object.keys(p).map(k => {
    const ciPair = (ci[k] && ci[k].length === 2) ? ` [${fmtExp(ci[k][0])}, ${fmtExp(ci[k][1])}]` : '';
    return `<div><strong>${k}</strong></div><div>${fmtExp(p[k])}${ciPair}</div>`;
  });
  const metricsRows = [];
  if (typeof metrics.rmse === 'number') {
    metricsRows.push(`<div><strong>RMSE</strong></div><div>${fmtExp(metrics.rmse)}</div>`);
  }
  if (typeof metrics.r2 === 'number') {
    metricsRows.push(`<div><strong>R²</strong></div><div>${fmtDec(metrics.r2)}</div>`);
  }
  metricsRows.push(`<div><strong>運算環境</strong></div><div>Pyodide（瀏覽器端）</div>`);
  metricsRows.push(`<div><strong>信賴水準</strong></div><div>${Math.round((result.conf || 0) * 100)}%</div>`);
  const html = [...rows, ...metricsRows].join('');
  $('#params').innerHTML = html || '<em>尚無參數</em>';
}

function renderChart(result) {
  const obs = result.curves?.observed || [];
  const fit = result.curves?.fitted || [];
  if (!obs.length && !fit.length) {
    $('#chart').innerHTML = '<em>尚無資料</em>';
    return;
  }
  const sortedObs = [...obs].sort((a, b) => a[0] - b[0]);
  const sortedFit = [...fit].sort((a, b) => a[0] - b[0]);
  const obsTrace = { x: sortedObs.map(d => d[0]), y: sortedObs.map(d => d[1]), name: 'Observed', mode: 'markers', type: 'scatter' };
  const fitTrace = { x: sortedFit.map(d => d[0]), y: sortedFit.map(d => d[1]), name: 'Fitted', mode: 'lines', type: 'scatter' };
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#eaeefb' },
    xaxis: { title: 'time (min)' },
    yaxis: { title: 'drawdown (m)' },
    legend: { orientation: 'h' }
  };
  Plotly.newPlot('chart', [obsTrace, fitTrace], layout, { displayModeBar: false });
}

function formatNumber(value, digits = 3) {
  if (value == null || !isFinite(value)) return '-';
  const absVal = Math.abs(value);
  if (absVal !== 0 && (absVal < 1e-3 || absVal > 1e4)) {
    return Number(value).toExponential(digits);
  }
  return Number(value).toFixed(digits);
}

window.addEventListener('unload', () => {
  if (fitPy && typeof fitPy.destroy === 'function') {
    fitPy.destroy();
  }
  fitPy = null;
});
