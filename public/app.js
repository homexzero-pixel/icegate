'use strict';

const $ = (id) => document.getElementById(id);
const state = { days: 90, metric: 'count', dir: 'exports', data: null, limit: 25, actionsAll: false };

const SB_COLOR = 'var(--series-1)';
const BE_COLOR = 'var(--series-2)';
const STATUS_KIND = {
  'LEO granted': 'good', 'EGM filed': 'good', 'Out of charge': 'good', 'Duty paid': 'neutral',
  'Duty pending': 'warning', 'Query raised': 'critical', Filed: 'neutral', Assessed: 'neutral',
};
const ICON = { good: '✓', warning: '!', critical: '×', neutral: '•', info: 'i' };
const PORT_NAMES = {};

// ---------- formatting ----------
const nf = new Intl.NumberFormat('en-IN');
function inr(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e9 ? 0 : 2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${nf.format(Math.round(n))}`;
}
function inrAxis(n) {
  if (n >= 1e7) return `₹${+(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${+(n / 1e5).toFixed(0)}L`;
  return `₹${nf.format(n)}`;
}
const daysFmt = (v) => (v == null ? '—' : v < 1 ? `${Math.round(v * 24)} h` : `${v.toFixed(1)} d`);
const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) =>
  new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dot = (kind) => `<span class="status ${kind}"><span class="dot">${ICON[kind]}</span></span>`;
const rangeLabel = () => ({ 30: '30 days', 90: '90 days', 180: '6 months', 365: '12 months' }[state.days]);

// ---------- data ----------
async function load() {
  setSeg('[data-days]', 'days', state.days);
  try {
    const res = await fetch(`/api/dashboard?days=${state.days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.limit = 25;
    render();
  } catch (err) {
    $('notice').hidden = false;
    $('notice').textContent = `Could not load dashboard data: ${err.message}`;
  }
}

function setSeg(sel, key, val) {
  document.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-checked', String(String(b.dataset[key]) === String(val))));
}

function render() {
  const d = state.data;
  d.clearance.byPort.forEach((p) => { PORT_NAMES[p.code] = p.name; });
  const src = $('source');
  src.hidden = false;
  src.className = `badge ${d.source}`;
  src.textContent = d.source === 'live' ? 'Live' : 'Demo data';
  $('notice').hidden = !d.notice;
  $('notice').textContent = d.notice || '';
  const long = { day: 'numeric', month: 'short', year: 'numeric' };
  $('updated').textContent = `${fmtDate(d.range.start, long)} – ${fmtDate(d.range.end, long)} · compared with the previous ${rangeLabel()} · data as of ${new Date(d.generatedAt).toLocaleString('en-IN')}`;

  renderKpis(d.kpis);
  renderInsights(d.insights);
  renderActions(d.actions);
  renderTrend();
  renderHistogram(d.clearance.histogram);
  renderQueryAging(d.queries);
  renderPorts(d.clearance.byPort);
  renderRefunds(d.refunds);
  renderMix();
  renderFilterOptions(d.documents);
  renderDocs();
}

// ---------- KPIs ----------
function delta(k, fmt = (x) => x) {
  if (k.previous == null || k.value == null) return '<div class="delta">&nbsp;</div>';
  const pct = k.previous ? ((k.value - k.previous) / k.previous) * 100 : 0;
  const flat = Math.abs(pct) < 0.5;
  const good = k.better ? (k.better === 'up' ? pct > 0 : pct < 0) : null;
  const cls = flat || good == null ? '' : good ? 'up' : 'down';
  const arrow = flat ? '' : pct > 0 ? '▲' : '▼';
  return `<div class="delta ${cls}">${arrow} ${flat ? 'No change' : Math.abs(pct).toFixed(1) + '%'} <span class="muted">from ${fmt(k.previous)}</span></div>`;
}

function tile(label, value, extra = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${extra}</div>`;
}

function renderKpis(k) {
  $('kpis-volume').innerHTML = [
    tile('Shipping bills', nf.format(k.shippingBills.value), delta(k.shippingBills, nf.format)),
    tile('Bills of entry', nf.format(k.billsOfEntry.value), delta(k.billsOfEntry, nf.format)),
    tile('Export value (FOB)', inr(k.exportFobInr.value), delta(k.exportFobInr, inr)),
    tile('Import value', inr(k.importValueInr.value), delta(k.importValueInr, inr)),
    tile('Duty paid', inr(k.dutyPaidInr.value), delta(k.dutyPaidInr, inr)),
  ].join('');
  const d1 = (v) => (v == null ? '—' : `${v}<small>days</small>`);
  $('kpis-perf').innerHTML = [
    tile('Export clearance (median)', d1(k.exportClearMedianDays.value), delta(k.exportClearMedianDays, (v) => `${v} d`)),
    tile('Import clearance (median)', d1(k.importClearMedianDays.value), delta(k.importClearMedianDays, (v) => `${v} d`)),
    tile('Query rate', k.queryRatePct.value == null ? '—' : `${k.queryRatePct.value}<small>%</small>`, delta(k.queryRatePct, (v) => `${v}%`)),
    tile('Refund turnaround (median)', d1(k.refundTatMedianDays.value), delta(k.refundTatMedianDays, (v) => `${v} d`)),
    tile('IGST refund outstanding', inr(k.igstRefundPendingInr.value), `<div class="sub">${nf.format(k.igstRefundPendingInr.count)} shipping bills · as of today</div>`),
  ].join('');
}

// ---------- insights & actions ----------
function renderInsights(list) {
  $('insights').innerHTML = list.length
    ? list.map((i) => `<li>${dot(i.severity)}<div><b>${esc(i.title)}</b><p>${esc(i.detail)}</p></div></li>`).join('')
    : '<li class="muted">Nothing unusual in this period.</li>';
}

function renderActions(list) {
  const shown = state.actionsAll ? list : list.slice(0, 6);
  $('actions-count').textContent = list.length ? `${list.length}${list.length >= 50 ? '+' : ''} items` : '';
  $('actions').innerHTML = shown.length ? shown.map((a) => `
    <li>${dot(a.severity)}
      <div><div class="what">${esc(a.action)}</div>
        <div class="meta">${esc(a.doc.type)} ${esc(a.doc.number)} · ${esc(PORT_NAMES[a.doc.port] || a.doc.port)}${a.detail ? ' · ' + esc(a.detail) : ''}</div></div>
      <div class="age">${Math.floor(a.ageDays)} days<small>${a.amountInr ? inr(a.amountInr) : ''}</small></div>
    </li>`).join('') : `<li>${dot('good')}<div>Nothing waiting on you.</div><div></div></li>`;
  $('actions-more').hidden = list.length <= 6;
  $('actions-more').textContent = state.actionsAll ? 'Show fewer' : `Show all ${list.length}`;
}

// ---------- trend (line chart) ----------
function renderTrend() {
  const t = state.data.trend;
  const value = state.metric === 'value';
  const series = value
    ? [{ key: 'exportFobInr', label: 'Export FOB', color: SB_COLOR }, { key: 'importValueInr', label: 'Import value', color: BE_COLOR }]
    : [{ key: 'shippingBills', label: 'Shipping bills', color: SB_COLOR }, { key: 'billsOfEntry', label: 'Bills of entry', color: BE_COLOR }];
  setSeg('[data-metric]', 'metric', state.metric);
  $('trend-title').textContent = `${value ? 'Trade value' : 'Filings'} per ${t.granularity}`;
  $('trend-legend').innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  const partial = t.points.some((p) => p.partial);
  $('trend-note').textContent = partial ? 'Partial first and last weeks are drawn dashed.' : '';
  const fmt = value ? inr : nf.format;
  $('trend-table').innerHTML = `<div class="table-wrap"><table><thead><tr><th>${t.granularity === 'week' ? 'Week of' : 'Date'}</th>${series.map((s) => `<th class="num">${s.label}</th>`).join('')}</tr></thead><tbody>${
    t.points.map((p) => `<tr><td>${fmtDate(p.start, { day: 'numeric', month: 'short', year: 'numeric' })}${p.partial ? ' (partial)' : ''}</td>${series.map((s) => `<td class="num">${fmt(p[s.key])}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
  lineChart($('trend-chart'), t.points, series, { yFmt: value ? inrAxis : (v) => nf.format(v), tipFmt: fmt, weekly: t.granularity === 'week' });
}

function lineChart(host, pts, series, { yFmt, tipFmt, weekly }) {
  const W = Math.max(300, host.clientWidth);
  const H = W < 560 ? 220 : 280;
  const m = { t: 12, r: W < 560 ? 12 : 96, b: 26, l: 52 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxY = niceMax(Math.max(1, ...pts.flatMap((p) => series.map((s) => p[s.key]))));
  const x = (i) => m.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v) => m.t + ih - (v / maxY) * ih;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => maxY * f).map((v) =>
    `<line class="grid-line" x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`).join('');
  const nLabels = W < 560 ? 4 : 7;
  const step = Math.max(1, Math.ceil(pts.length / nLabels));
  const xl = pts.map((p, i) => (i % step === 0 && pts.length - 1 - i >= step * 0.8) || i === pts.length - 1
    ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === pts.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${fmtDate(p.start)}</text>` : '').join('');

  // Partial weeks at either end are drawn dashed so they don't read as a real dip.
  const a = weekly && pts.length > 2 && pts[0].partial ? 1 : 0;
  const b = weekly && pts.length > 2 && pts[pts.length - 1].partial ? pts.length - 2 : pts.length - 1;
  const lines = series.map((s) => {
    const path = (from, to) => pts.slice(from, to + 1).map((p, k) => `${k ? 'L' : 'M'}${x(from + k).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('');
    const dash = (from, to) => `<path d="${path(from, to)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>`;
    let out = `<path d="${path(a, b)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (a) out += dash(0, 1);
    if (b < pts.length - 1) out += dash(b, pts.length - 1);
    return out;
  }).join('');

  let labels = '';
  if (m.r > 20) {
    const last = pts[pts.length - 1];
    let ys = series.map((s) => y(last[s.key]));
    if (Math.abs(ys[0] - ys[1]) < 14) { const mid = (ys[0] + ys[1]) / 2, up = ys[0] <= ys[1] ? -1 : 1; ys = [mid + up * 7, mid - up * 7]; }
    labels = series.map((s, i) => `<text x="${x(pts.length - 1) + 8}" y="${ys[i] + 4}" style="fill:var(--ink-2)">${s.label}</text>`).join('');
  }

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((s) => s.label).join(' and ')} over time">
    ${grid}<line class="base-line" x1="${m.l}" x2="${m.l + iw}" y1="${y(0)}" y2="${y(0)}"/>${xl}${lines}${labels}
    <g class="hover" visibility="hidden"><line class="crosshair" y1="${m.t}" y2="${m.t + ih}"/>
      ${series.map((s) => `<circle r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g>
    <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;

  const svg = host.querySelector('svg');
  const hover = svg.querySelector('.hover');
  svg.onpointermove = (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - m.l) / iw) * (pts.length - 1))));
    const p = pts[i];
    hover.setAttribute('visibility', 'visible');
    const ln = hover.querySelector('line');
    ln.setAttribute('x1', x(i)); ln.setAttribute('x2', x(i));
    hover.querySelectorAll('circle').forEach((c, k) => { c.setAttribute('cx', x(i)); c.setAttribute('cy', y(p[series[k].key])); });
    const head = weekly
      ? `Week of ${fmtDate(p.start, { day: 'numeric', month: 'short', year: 'numeric' })}${p.partial ? ' (partial)' : ''}`
      : fmtDate(p.start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    $('tooltip').innerHTML = `<div class="t-date">${head}</div>${series.map((s) => `<div class="t-row"><span><i style="background:${s.color}"></i>${s.label}</span><b>${tipFmt(p[s.key])}</b></div>`).join('')}`;
    showTip(e);
  };
  svg.onpointerleave = () => { hover.setAttribute('visibility', 'hidden'); $('tooltip').hidden = true; };
}

// ---------- histogram (grouped columns) ----------
function renderHistogram(hist) {
  const series = [{ key: 'shippingBills', label: 'Exports', color: SB_COLOR }, { key: 'billsOfEntry', label: 'Imports', color: BE_COLOR }];
  $('hist-legend').innerHTML = series.map((s) => `<span><i class="sq" style="background:${s.color}"></i>${s.label}</span>`).join('');
  const host = $('hist-chart');
  const W = Math.max(280, host.clientWidth), H = 230;
  const m = { t: 18, r: 4, b: 26, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxY = niceMax(Math.max(1, ...hist.flatMap((h) => series.map((s) => h[s.key]))));
  const band = iw / hist.length, gap = 2;
  const bw = Math.min(28, (band * 0.7 - gap) / 2);
  const y = (v) => m.t + ih - (v / maxY) * ih;
  const totals = series.map((s) => hist.reduce((acc, h) => acc + h[s.key], 0));
  const grid = [0, 0.5, 1].map((f) => maxY * f).map((v) => `<line class="grid-line" x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>`).join('');
  const bars = hist.map((h, i) => {
    const cx = m.l + band * i + band / 2;
    const cols = series.map((s, k) => {
      const v = h[s.key];
      const bx = cx - bw - gap / 2 + k * (bw + gap);
      const top = y(v), hh = Math.max(0, y(0) - top);
      const r = Math.min(4, hh, bw / 2);
      const d = hh ? `M${bx},${y(0)}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + bw - r}Q${bx + bw},${top} ${bx + bw},${top + r}V${y(0)}Z` : '';
      return `<path d="${d}" fill="${s.color}"/>`;
    }).join('');
    const tip = esc(`<div class="t-date">Cleared in ${h.label}</div>${series.map((s, k) => `<div class="t-row"><span><i style="background:${s.color}"></i>${s.label}</span><b>${nf.format(h[s.key])} · ${totals[k] ? Math.round((h[s.key] / totals[k]) * 100) : 0}%</b></div>`).join('')}`);
    return `<g data-tip="${tip}">${cols}<rect x="${cx - band / 2}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"/>
      <text x="${cx}" y="${H - 6}" text-anchor="middle">${h.label.replace(' days', 'd').replace(' day', 'd')}</text></g>`;
  }).join('');
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of clearance times">${grid}<line class="base-line" x1="${m.l}" x2="${m.l + iw}" y1="${y(0)}" y2="${y(0)}"/>${bars}</svg>`;
  bindTips(host);
}

// ---------- bar lists ----------
function barList(rows, { color = SB_COLOR, value, sub, name, icon, wide, colorOf }) {
  const max = Math.max(1, ...rows.map(value));
  return `<div class="bars">${rows.map((r) => `
    <div class="bar-row${wide ? ' wide' : ''}" data-tip="${esc(r.tip || '')}">
      <span class="name">${icon ? icon(r) : ''}${esc(name(r))}</span>
      <span class="track"><span class="fill" style="width:${(value(r) / max) * 100}%;background:${colorOf ? colorOf(r) : color}"></span></span>
      <span class="val">${sub(r)}</span>
    </div>`).join('')}</div>`;
}

function renderQueryAging(q) {
  $('queries-open').textContent = `${q.open} open`;
  $('query-aging').innerHTML = barList(q.aging.map((a, i) => ({ ...a, sev: i >= 2 ? 'critical' : i === 1 ? 'warning' : null })), {
    name: (r) => r.label, value: (r) => r.count, sub: (r) => nf.format(r.count),
    icon: (r) => (r.sev ? dot(r.sev) : ''),
    colorOf: (r) => (r.sev === 'critical' ? 'var(--critical)' : SB_COLOR),
  });
}

function renderPorts(ports) {
  const ex = ports.map((p) => p.exportMedianDays).filter((v) => v != null);
  const im = ports.map((p) => p.importMedianDays).filter((v) => v != null);
  const exMed = median(ex), imMed = median(im);
  const maxEx = Math.max(...ex, 0.1), maxIm = Math.max(...im, 0.1);
  const qr = median(ports.map((p) => p.queryRatePct));
  const cell = (v, max, slow) => `<td class="num${slow ? ' slow' : ''}">${daysFmt(v)}${max && v != null ? `<span class="cellbar" style="width:${(v / max) * 48}px"></span>` : ''}</td>`;
  $('ports').innerHTML = ports.map((p) => `<tr>
    <td>${esc(p.name)} <span class="muted small">${esc(p.code)}</span></td>
    <td class="num">${nf.format(p.documents)}</td>
    ${cell(p.exportMedianDays, maxEx, p.exportMedianDays > exMed * 1.4)}${cell(p.exportP90Days)}
    ${cell(p.importMedianDays, maxIm, p.importMedianDays > imMed * 1.4)}${cell(p.importP90Days)}
    <td class="num${p.queryRatePct > qr * 1.4 ? ' slow' : ''}">${p.queryRatePct}%</td></tr>`).join('');
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((p, q) => p - q), h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function renderRefunds(r) {
  // Credited dwarfs the outstanding stages, so it gets a summary line instead of a bar.
  const credited = r.stages.find((s) => s.name === 'Credited');
  const outstanding = r.stages.filter((s) => s.name !== 'Credited');
  $('refund-stages').innerHTML = `<p class="credited">${dot('good')} <b>${inr(credited.amountInr)}</b> credited in this period <span class="muted">· ${nf.format(credited.count)} shipping bills</span></p>
    <p class="muted small">Outstanding by stage</p>` + barList(outstanding.map((s) => ({
    ...s, tip: `<div class="t-date">${esc(s.name)}</div><div class="t-row"><span>Shipping bills</span><b>${nf.format(s.count)}</b></div><div class="t-row"><span>Amount</span><b>${inr(s.amountInr)}</b></div>`,
  })), {
    name: (s) => s.name, value: (s) => s.amountInr, sub: (s) => `${inr(s.amountInr)}<small>${nf.format(s.count)}</small>`,
    icon: (s) => (s.name === 'Validation error' ? dot('critical') : ''),
    colorOf: (s) => (s.name === 'Validation error' ? 'var(--critical)' : SB_COLOR),
  });
  $('refund-errors').innerHTML = r.errors.length ? barList(r.errors.map((e) => ({
    ...e, tip: `<div class="t-date">${esc(e.code)} · ${esc(e.description)}</div><div class="t-row"><span>Shipping bills</span><b>${nf.format(e.count)}</b></div><div class="t-row"><span>Blocked</span><b>${inr(e.amountInr)}</b></div>`,
  })), {
    name: (e) => `${e.code} ${e.description}`, value: (e) => e.amountInr, sub: (e) => `${inr(e.amountInr)}<small>${e.count}</small>`, color: 'var(--critical)', wide: true,
  }) : `<p>${dot('good')} No refunds blocked.</p>`;
  $('refund-aging').innerHTML = barList(r.aging.map((a, i) => ({
    ...a, sev: i >= 2 ? 'warning' : null,
    tip: `<div class="t-date">Waiting ${esc(a.label)}</div><div class="t-row"><span>Shipping bills</span><b>${nf.format(a.count)}</b></div><div class="t-row"><span>Amount</span><b>${inr(a.amountInr)}</b></div>`,
  })), {
    name: (a) => a.label, value: (a) => a.amountInr, sub: (a) => `${inr(a.amountInr)}<small>${a.count}</small>`,
    icon: (a) => (a.sev ? dot(a.sev) : ''),
  });
  ['refund-stages', 'refund-errors', 'refund-aging'].forEach((id) => bindTips($(id)));
  $('refund-note').textContent = `${r.note} Small numbers beside amounts are shipping-bill counts.`;
}

function renderMix() {
  const mix = state.data.tradeMix[state.dir];
  setSeg('[data-dir]', 'dir', state.dir);
  $('mix-country-title').textContent = state.dir === 'exports' ? 'By destination' : 'By origin';
  const color = state.dir === 'exports' ? SB_COLOR : BE_COLOR;
  const chg = (r) => (r.changePct == null ? '' : ` <small class="chg ${r.changePct >= 0 ? 'up' : 'down'}">${r.changePct >= 0 ? '▲' : '▼'}${Math.abs(r.changePct)}%</small>`);
  const opts = (label) => ({
    name: label, value: (r) => r.valueInr, color, wide: true,
    sub: (r) => `${inr(r.valueInr)}<small>${r.sharePct}%</small>${chg(r)}`,
  });
  const tip = (r, title) => `<div class="t-date">${esc(title)}</div><div class="t-row"><span>Value</span><b>${inr(r.valueInr)}</b></div><div class="t-row"><span>Share</span><b>${r.sharePct}%</b></div>${r.changePct == null ? '' : `<div class="t-row"><span>vs previous</span><b>${r.changePct >= 0 ? '+' : ''}${r.changePct}%</b></div>`}`;
  $('mix-hs').innerHTML = barList(mix.hs.map((r) => ({ ...r, tip: tip(r, `Ch. ${r.code} · ${r.name}`) })), opts((r) => `${r.code} ${r.name}`));
  $('mix-country').innerHTML = barList(mix.countries.map((r) => ({ ...r, tip: tip(r, r.name) })), opts((r) => r.name));
  bindTips($('mix-hs'));
  bindTips($('mix-country'));
}

// ---------- documents ----------
function renderFilterOptions(docs) {
  const fill = (id, values, label, nameOf = (v) => v) => {
    const sel = $(id), cur = sel.value;
    sel.innerHTML = `<option value="">${label}</option>` + values.map((v) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(nameOf(v))}</option>`).join('');
  };
  fill('f-status', [...new Set(docs.map((d) => d.status))].sort(), 'All statuses');
  fill('f-port', [...new Set(docs.map((d) => d.port))].sort(), 'All ports', (c) => PORT_NAMES[c] || c);
}

function renderDocs() {
  const docs = state.data?.documents || [];
  const type = $('f-type').value, status = $('f-status').value, port = $('f-port').value, q = $('f-q').value.trim();
  const rows = docs.filter((d) => (!type || d.type === type) && (!status || d.status === status) && (!port || d.port === port) && (!q || d.number.includes(q)));
  $('docs').innerHTML = rows.slice(0, state.limit).map((d) => {
    const kind = STATUS_KIND[d.status] || 'neutral';
    const money = d.type === 'Bill of Entry' ? (d.dutyInr ? `${inr(d.dutyInr)} duty` : '—') : (d.igstRefundInr ? `${inr(d.igstRefundInr)} · ${esc(d.refundStage)}` : '—');
    return `<tr><td>${esc(d.type)}</td><td>${esc(d.number)}</td><td>${fmtDate(d.filedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td title="${esc(PORT_NAMES[d.port] || '')}">${esc(d.port)}</td><td>${esc(d.country)}</td><td>${esc(d.hsChapter)}</td>
      <td><span class="status ${kind}"><span class="dot">${ICON[kind]}</span>${esc(d.status)}</span></td>
      <td class="num">${daysFmt(d.clearDays)}</td><td class="num">${inr(d.valueInr)}</td><td class="num">${money}</td></tr>`;
  }).join('') || '<tr><td colspan="10" class="muted">No matching documents</td></tr>';
  $('more').hidden = rows.length <= state.limit;
  $('docs-count').textContent = `Showing ${Math.min(rows.length, state.limit)} of ${nf.format(rows.length)} matching${docs.length >= 500 ? ' · most recent 500 in range loaded' : ''}`;
}

// ---------- shared ----------
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10) * p;
}

function showTip(e) {
  const tip = $('tooltip');
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = e.clientX + 14, top = e.clientY - h - 10;
  if (left + w > window.innerWidth - 8) left = e.clientX - w - 14;
  if (left < 8) left = 8;
  if (top < 8) top = e.clientY + 16;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function bindTips(root) {
  root.querySelectorAll('[data-tip]').forEach((el) => {
    if (!el.dataset.tip) return;
    el.onpointermove = (e) => { $('tooltip').innerHTML = el.dataset.tip; showTip(e); };
    el.onpointerleave = () => { $('tooltip').hidden = true; };
  });
}

// ---------- wiring ----------
document.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { state.days = Number(b.dataset.days); load(); }));
document.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => { state.metric = b.dataset.metric; renderTrend(); }));
document.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { state.dir = b.dataset.dir; renderMix(); }));
$('refresh').addEventListener('click', load);
$('actions-more').addEventListener('click', () => { state.actionsAll = !state.actionsAll; renderActions(state.data.actions); });
const resetDocs = () => { state.limit = 25; renderDocs(); };
['f-type', 'f-status', 'f-port'].forEach((id) => $(id).addEventListener('change', resetDocs));
$('f-q').addEventListener('input', resetDocs);
$('more').addEventListener('click', () => { state.limit += 25; renderDocs(); });
let rt;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => { if (state.data) { renderTrend(); renderHistogram(state.data.clearance.histogram); } }, 120);
});
load();
