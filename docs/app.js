
const $ = (sel) => document.querySelector(sel);

const apiDisplay = $('#apiDisplay');
const apiInput = $('#apiBaseInput');
const apiStatus = $('#apiStatus');
const saveBtn = $('#saveApiBase');
let mixedContentWarning = false;

function resolveApiBase() {
  const url = new URL(window.location.href);
  const p = url.searchParams.get('api');
  if (p) {
    localStorage.setItem('lagwell_api', p);
  }
  const stored = localStorage.getItem('lagwell_api');
  const fallback = window.location.protocol === 'https:' ? '' : 'http://localhost:8000';
  return stored || fallback;
}

let API_BASE = resolveApiBase();

function updateApiUi() {
  if (apiDisplay) {
    apiDisplay.textContent = API_BASE || '(未設定)';
  }
  if (apiInput && apiInput.value !== (API_BASE || '')) {
    apiInput.value = API_BASE || '';
  }
}

function warnMixed() {
  if (!apiStatus) return;
  mixedContentWarning = false;
  if (!API_BASE) {
    apiStatus.textContent = '';
    return;
  }
  try {
    const parsed = new URL(API_BASE);
    if (window.location.protocol === 'https:' && parsed.protocol === 'http:') {
      mixedContentWarning = true;
      apiStatus.textContent = '⚠️ 你在 HTTPS 頁面使用 HTTP API，瀏覽器會封鎖（Mixed Content）。請改用 HTTPS 後端或本機前端。';
    }
  } catch (err) {
    apiStatus.textContent = '';
    // ignore invalid URL parsing here; testApi will surface errors
  }
}

async function testApi() {
  warnMixed();
  if (!apiStatus) return;
  if (!API_BASE) {
    apiStatus.textContent = '請在上方設定 API 位址（HTTPS 建議）';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(res.status);
    apiStatus.textContent = `✅ 已連線：${API_BASE}`;
  } catch (err) {
    if (!mixedContentWarning) {
      apiStatus.textContent = `❌ 無法連線：${API_BASE}（${err}）`;
    }
  }
}

updateApiUi();
testApi();

if (saveBtn) {
  saveBtn.addEventListener('click', () => {
    const value = (apiInput?.value || '').trim();
    if (!value) {
      alert('請輸入 API Base，例如 https://your-backend.example.com');
      return;
    }
    localStorage.setItem('lagwell_api', value);
    API_BASE = value;
    updateApiUi();
    testApi();
  });
}

$('#loadExample').addEventListener('click', () => {
  const demo = `time_min,drawdown_m,r_m,Q_m3ph
0.1,0.02,30,120
0.2,0.05,30,120
0.5,0.12,30,120
1.0,0.18,30,120`;
  $('#raw').value = demo;
});

$('#csvFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const txt = await f.text();
  $('#raw').value = txt;
});

$('#fitBtn').addEventListener('click', async () => {
  try {
    if (!API_BASE) {
      $('#status').textContent = '請先在連線設定中設定 API Base';
      return;
    }
    $('#status').textContent = '擬合中...';
    $('#pdfBtn').disabled = true;
    const r = parseFloat($('#r').value);
    const Q = parseFloat($('#Q').value);
    const model = $('#model').value;
    const conf = parseFloat($('#conf').value);
    const { data, _r, _Q } = parseCsvOrText($('#raw').value, r, Q);
    const payload = { r: _r, Q: _Q, data, model, conf };

    const res = await fetch(`${API_BASE}/fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Fit API error: ' + res.status);
    const j = await res.json();

    renderParams(j);
    renderChart(j);
    window._lastFit = j;
    $('#pdfBtn').disabled = false;
    $('#status').textContent = '完成';
  } catch (err) {
    console.error(err);
    $('#status').textContent = '錯誤：' + err.message;
  }
});

$('#pdfBtn').addEventListener('click', async () => {
  if (!window._lastFit) return;
  const model = $('#model').value;
  const r = parseFloat($('#r').value);
  const Q = parseFloat($('#Q').value);
  const conf = parseFloat($('#conf').value);
  const body = {
    model, Q, r, conf,
    params: window._lastFit.params,
    ci: window._lastFit.ci,
    plot_base64: null,
    license_sn: 'DEMO-0000'
  };
  if (!API_BASE) {
    alert('請先設定 API Base');
    return;
  }
  const res = await fetch(`${API_BASE}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) return alert('Report API 失敗');
  const j = await res.json();
  const pdfB64 = j.pdf_base64;
  const link = document.createElement('a');
  link.href = 'data:application/pdf;base64,' + pdfB64;
  link.download = 'lagwell_report.pdf';
  link.click();
});

function parseCsvOrText(txt, defaultR, defaultQ) {
  const lines = txt.trim().split(/\r?\n/);
  if (!lines.length) throw new Error('沒有資料');
  const headers = lines[0].split(',').map(h => h.trim());
  const idxT = headers.findIndex(h => /time_min/i.test(h));
  const idxS = headers.findIndex(h => /drawdown_m/i.test(h));
  const idxR = headers.findIndex(h => /r(_m)?/i.test(h));
  const idxQ = headers.findIndex(h => /Q(_m3ph)?/i.test(h));
  if (idxT === -1 || idxS === -1) throw new Error('需要欄位 time_min, drawdown_m');

  let r = isNaN(defaultR) ? null : defaultR;
  let Q = isNaN(defaultQ) ? null : defaultQ;

  const data = [];
  for (let i=1;i<lines.length;i++) {
    const row = lines[i].split(',').map(x => x.trim());
    if (!row.length || row[0]==="") continue;
    const t = parseFloat(row[idxT]);
    const s = parseFloat(row[idxS]);
    if (!isFinite(t) || !isFinite(s)) continue;
    data.push({ t, s });
    if (idxR!==-1 && !isFinite(r)) r = parseFloat(row[idxR]);
    if (idxQ!==-1 && !isFinite(Q)) Q = parseFloat(row[idxQ]);
  }
  if (!isFinite(r)) r = defaultR;
  if (!isFinite(Q)) Q = defaultQ;
  return { data, _r: r, _Q: Q };
}

function renderParams(j) {
  const p = j.params || {};
  const ci = j.ci || {};
  const fmt = (x) => (x==null?'-':Number(x).toExponential(3));
  const html = Object.keys(p).map(k => {
    const ciPair = (ci[k] && ci[k].length===2) ? ` [${fmt(ci[k][0])}, ${fmt(ci[k][1])}]` : '';
    return `<div><strong>${k}</strong></div><div>${fmt(p[k])}${ciPair}</div>`;
  }).join('');
  $('#params').innerHTML = html || '<em>尚無參數</em>';
}

function renderChart(j) {
  const obs = j.curves?.observed || [];
  const fit = j.curves?.fitted || [];
  const obsTrace = { x: obs.map(d=>d[0]), y: obs.map(d=>d[1]), name:'Observed', mode:'markers', type:'scatter' };
  const fitTrace = { x: fit.map(d=>d[0]), y: fit.map(d=>d[1]), name:'Fitted', mode:'lines', type:'scatter' };
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#eaeefb' },
    xaxis: { title: 'time (min)' },
    yaxis: { title: 'drawdown (m)' },
    legend: { orientation:'h' }
  };
  Plotly.newPlot('chart', [obsTrace, fitTrace], layout, {displayModeBar:false});
}
