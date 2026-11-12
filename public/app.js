'use strict';

const $ = (id) => document.getElementById(id);
const state = { days: 30, data: null, limit: 25 };

const STATUS_KIND = {
  'LEO granted': 'good', 'EGM filed': 'good', 'Out of charge': 'good',
  'Duty pending': 'warning', 'Query raised': 'critical',
  Filed: 'neutral', Assessed: 'neutral',
};
const STATUS_ICON = { good: '✓', warning: '!', critical: '×', neutral: '•' };

const SERIES = [
  { key: 'shippingBills', label: 'Shipping bills', color: 'var(--series-1)' },
  { key: 'billsOfEntry', label: 'Bills of entry', color: 'var(--series-2)' },
];

// ---------- formatting ----------
const nf = new Intl.NumberFormat('en-IN');
function inr(n) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e9 ? 0 : 2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${nf.format(Math.round(n))}`;
}
const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- data ----------
async function load() {
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.days) === state.days)));
  try {
    const res = await fetch(`/api/dashboard?days=${state.days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    render();
  } catch (err) {
    $('notice').hidden = false;
    $('notice').textContent = `Could not load dashboard data: ${err.message}`;
  }
}

function render() {
  const d = state.data;
  const src = $('source');
  src.hidden = false;
  src.className = `badge ${d.source}`;
  src.textContent = d.source === 'live' ? 'Live' : 'Demo data';
  $('notice').hidden = !d.notice;
  $('notice').textContent = d.notice || '';
  $('updated').textContent = `Last ${d.days} days · updated ${new Date(d.generatedAt).toLocaleString('en-IN')}`;

  renderKpis(d.kpis);
  renderFilings(d.daily);
  renderRefunds(d.refundStages);
  renderPorts(d.ports);
  renderStatusOptions(d.documents);
  renderDocs();
}

// ---------- KPIs ----------
function delta(k) {
  if (k.previous == null || k.previous === 0) return '<div class="delta">&nbsp;</div>';
  const pct = ((k.value - k.previous) / k.previous) * 100;
  const cls = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : '';
  const arrow = pct > 0.5 ? '▲' : pct < -0.5 ? '▼' : '';
  return `<div class="delta ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}% vs previous ${state.days} days</div>`;
}

function renderKpis(k) {
  const tiles = [
    { label: 'Shipping bills filed', value: nf.format(k.shippingBills.value), extra: delta(k.shippingBills) },
    { label: 'Bills of entry filed', value: nf.format(k.billsOfEntry.value), extra: delta(k.billsOfEntry) },
    { label: 'Export FOB value', value: inr(k.exportFobInr.value), extra: delta(k.exportFobInr) },
    {
      label: 'Open queries', value: nf.format(k.queriesOpen.value),
      extra: k.queriesOpen.value
        ? '<div class="delta"><span class="status critical flag"><span class="dot">×</span>Needs response</span></div>'
        : '<div class="delta"><span class="status good flag"><span class="dot">✓</span>None open</span></div>',
    },
    { label: 'Import duty pending', value: inr(k.dutyPendingInr.value), extra: '<div class="delta">Awaiting payment</div>' },
    { label: 'IGST refund pending', value: inr(k.igstRefundPendingInr.value), extra: `<div class="delta">${inr(k.igstRefundCreditedInr.value)} credited</div>` },
  ];
  $('kpis').innerHTML = tiles.map((t) => `
    <div class="kpi"><div class="label">${t.label}</div><div class="value">${t.value}</div>${t.extra}</div>`).join('');
}

// ---------- line chart ----------
function renderFilings(daily) {
  $('filings-legend').innerHTML = SERIES.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  $('filings-table').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th>${SERIES.map((s) => `<th class="num">${s.label}</th>`).join('')}</tr></thead><tbody>${
    daily.map((r) => `<tr><td>${fmtDate(r.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>${SERIES.map((s) => `<td class="num">${r[s.key]}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;

  const host = $('filings-chart');
  const W = Math.max(320, host.clientWidth);
  const H = W < 560 ? 220 : 280;
  const m = { t: 12, r: 96, b: 26, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxY = niceMax(Math.max(...daily.flatMap((r) => SERIES.map((s) => r[s.key]))));
  const x = (i) => m.l + (daily.length === 1 ? iw / 2 : (i / (daily.length - 1)) * iw);
  const y = (v) => m.t + ih - (v / maxY) * ih;

  const ticks = [0, maxY / 2, maxY].map((v) => `<line class="grid-line" x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const step = Math.ceil(daily.length / (W < 560 ? 4 : 7));
  const xl = daily.map((r, i) => (i % step === 0 || i === daily.length - 1) && (i === daily.length - 1 || daily.length - 1 - i >= step * 0.8)
    ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${fmtDate(r.date)}</text>` : '').join('');
  const lines = SERIES.map((s) => {
    const d = daily.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[s.key]).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  // direct end labels, nudged apart if they collide
  const last = daily[daily.length - 1];
  let ys = SERIES.map((s) => y(last[s.key]));
  if (Math.abs(ys[0] - ys[1]) < 14) { const mid = (ys[0] + ys[1]) / 2, up = ys[0] <= ys[1] ? -1 : 1; ys = [mid + up * 7, mid - up * 7]; }
  const labels = SERIES.map((s, i) => `<text x="${x(daily.length - 1) + 8}" y="${ys[i] + 4}" style="fill:var(--ink-2)">${s.label}</text>`).join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily shipping bills and bills of entry filed">
    ${ticks}<line class="base-line" x1="${m.l}" x2="${m.l + iw}" y1="${y(0)}" y2="${y(0)}"/>${xl}${lines}${labels}
    <g id="hover" visibility="hidden"><line class="crosshair" y1="${m.t}" y2="${m.t + ih}"/>
      ${SERIES.map((s) => `<circle r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g>
    <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;

  const svg = host.querySelector('svg');
  const hover = svg.querySelector('#hover');
  const tip = $('tooltip');
  svg.onpointermove = (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(daily.length - 1, Math.round(((px - m.l) / iw) * (daily.length - 1))));
    const r = daily[i];
    hover.setAttribute('visibility', 'visible');
    hover.querySelector('line').setAttribute('x1', x(i));
    hover.querySelector('line').setAttribute('x2', x(i));
    hover.querySelectorAll('circle').forEach((c, k) => { c.setAttribute('cx', x(i)); c.setAttribute('cy', y(r[SERIES[k].key])); });
    tip.innerHTML = `<div class="t-date">${fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>${
      SERIES.map((s) => `<div class="t-row"><span><i style="background:${s.color}"></i>${s.label}</span><b>${r[s.key]}</b></div>`).join('')}`;
    showTip(e);
  };
  svg.onpointerleave = () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * p;
}

function showTip(e) {
  const tip = $('tooltip');
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = e.clientX + 14, top = e.clientY - h - 10;
  if (left + w > window.innerWidth - 8) left = e.clientX - w - 14;
  if (top < 8) top = e.clientY + 16;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function bindTips(root) {
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.onpointermove = (e) => { $('tooltip').innerHTML = el.dataset.tip; showTip(e); };
    el.onpointerleave = () => { $('tooltip').hidden = true; };
  });
}

// ---------- refund pipeline ----------
function renderRefunds(stages) {
  const max = Math.max(1, ...stages.map((s) => s.amountInr));
  $('refunds').innerHTML = `<div class="bars">${stages.map((s) => {
    const err = /error/i.test(s.name);
    const done = /credited/i.test(s.name);
    const color = err ? 'var(--critical)' : done ? 'var(--good)' : 'var(--series-1)';
    const icon = err ? '<span class="status critical"><span class="dot">×</span></span>' : done ? '<span class="status good"><span class="dot">✓</span></span>' : '';
    const tip = esc(`<div class="t-date">${s.name}</div><div class="t-row"><span>Claims</span><b>${nf.format(s.count)}</b></div><div class="t-row"><span>Amount</span><b>${inr(s.amountInr)}</b></div>`);
    return `<div class="bar-row" data-tip="${tip}"><span class="name">${icon}${esc(s.name)}</span>
      <span class="track"><span class="fill" style="width:${(s.amountInr / max) * 100}%;background:${color}"></span></span>
      <span class="val">${inr(s.amountInr)}<small>${nf.format(s.count)}</small></span></div>`;
  }).join('')}</div><p class="muted small">Amount by stage · count of shipping bills on the right</p>`;
  bindTips($('refunds'));
}

// ---------- ports ----------
function renderPorts(ports) {
  $('ports-legend').innerHTML = SERIES.map((s) => `<span><i class="sq" style="background:${s.color}"></i>${s.label}</span>`).join('');
  const max = Math.max(1, ...ports.flatMap((p) => [p.shippingBills, p.billsOfEntry]));
  $('ports').innerHTML = `<div class="bars">${ports.map((p) => {
    const tip = esc(`<div class="t-date">${p.name} (${p.code})</div>${SERIES.map((s) => `<div class="t-row"><span><i style="background:${s.color}"></i>${s.label}</span><b>${nf.format(p[s.key])}</b></div>`).join('')}`);
    return `<div class="bar-row pair" data-tip="${tip}"><span class="name">${esc(p.name)}</span>
      <span class="track">${SERIES.map((s) => `<span class="fill" style="width:${(p[s.key] / max) * 100}%;background:${s.color}"></span>`).join('')}</span>
      <span class="val">${nf.format(p.shippingBills)} / ${nf.format(p.billsOfEntry)}</span></div>`;
  }).join('')}</div>`;
  bindTips($('ports'));
}

// ---------- documents ----------
function renderStatusOptions(docs) {
  const sel = $('f-status');
  const cur = sel.value;
  const statuses = [...new Set(docs.map((d) => d.status))].sort();
  sel.innerHTML = '<option value="">All statuses</option>' + statuses.map((s) => `<option${s === cur ? ' selected' : ''}>${esc(s)}</option>`).join('');
}

function renderDocs() {
  const docs = state.data?.documents || [];
  const type = $('f-type').value, status = $('f-status').value, q = $('f-q').value.trim().toLowerCase();
  const rows = docs.filter((d) => (!type || d.type === type) && (!status || d.status === status)
    && (!q || d.number.includes(q) || d.port.toLowerCase().includes(q)));
  $('docs').innerHTML = rows.slice(0, state.limit).map((d) => {
    const kind = STATUS_KIND[d.status] || 'neutral';
    const money = d.type === 'Bill of Entry' ? (d.dutyInr ? `${inr(d.dutyInr)} duty` : '—') : (d.igstRefundInr ? `${inr(d.igstRefundInr)} refund` : '—');
    return `<tr><td>${esc(d.type)}</td><td>${esc(d.number)}</td><td>${fmtDate(d.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${esc(d.port)}</td>
      <td><span class="status ${kind}"><span class="dot">${STATUS_ICON[kind]}</span>${esc(d.status)}</span></td>
      <td class="num">${inr(d.valueInr)}</td><td class="num">${money}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">No matching documents</td></tr>';
  $('more').hidden = rows.length <= state.limit;
  $('docs-count').textContent = `Showing ${Math.min(rows.length, state.limit)} of ${rows.length} matching documents${docs.length >= 250 ? ' (most recent 250 loaded)' : ''}`;
}

// ---------- wiring ----------
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { state.days = Number(b.dataset.days); load(); }));
$('refresh').addEventListener('click', load);
const resetDocs = () => { state.limit = 25; renderDocs(); };
['f-type', 'f-status'].forEach((id) => $(id).addEventListener('change', resetDocs));
$('f-q').addEventListener('input', resetDocs);
$('more').addEventListener('click', () => { state.limit += 25; renderDocs(); });
let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => state.data && renderFilings(state.data.daily), 120); });
load();
