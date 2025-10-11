
const API_BASE = localStorage.getItem('lagwell_api') || 'http://localhost:8000';

const $ = (sel) => document.querySelector(sel);

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
