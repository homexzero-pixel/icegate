// Turns a flat list of ICEGATE documents into everything the dashboard shows.
// Runs server-side so the browser only receives aggregates plus recent rows.
'use strict';

const { PORTS, HS_CHAPTERS, COUNTRIES, REFUND_ERRORS } = require('./reference');

const DAY = 864e5;
const SB = 'Shipping Bill';
const BE = 'Bill of Entry';
const REFUND_STAGES = ['Awaiting LEO', 'Awaiting EGM', 'Scroll pending', 'Scroll generated', 'Credited', 'Validation error'];

const ts = (v) => (v ? Date.parse(v) : null);
const sum = (list, f) => list.reduce((a, d) => a + (f(d) || 0), 0);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

// ---- per-document derived fields ----
function enrich(raw, now) {
  const d = { ...raw };
  d.filed = ts(d.filedAt ?? d.date);
  const q0 = ts(d.queryRaisedAt);
  const q1 = ts(d.queryResolvedAt);
  d.hadQuery = q0 != null;
  d.queryOpen = q0 != null && q1 == null;
  d.queryAgeDays = d.queryOpen ? (now - q0) / DAY : null;

  if (d.type === SB) {
    d.cleared = ts(d.leoAt);
    d.status ??= d.queryOpen ? 'Query raised' : !d.assessedAt ? 'Filed' : !d.leoAt ? 'Assessed' : !d.egmAt ? 'LEO granted' : 'EGM filed';
    if (d.igstRefundInr > 0) {
      d.refundStage ??= d.refundErrorCode ? 'Validation error'
        : d.refundCreditedAt ? 'Credited'
        : d.refundScrollAt ? 'Scroll generated'
        : d.egmAt ? 'Scroll pending'
        : d.leoAt ? 'Awaiting EGM' : 'Awaiting LEO';
      const egm = ts(d.egmAt);
      const credited = ts(d.refundCreditedAt);
      d.refundTatDays = egm && credited ? (credited - egm) / DAY : null;
      d.refundWaitDays = egm && !credited ? (now - egm) / DAY : null;
    }
  } else {
    d.cleared = ts(d.oocAt);
    d.status ??= d.queryOpen ? 'Query raised' : !d.assessedAt ? 'Filed' : !d.dutyPaidAt ? 'Duty pending' : !d.oocAt ? 'Duty paid' : 'Out of charge';
    const assessed = ts(d.assessedAt);
    d.dutyPendingDays = assessed && !d.dutyPaidAt ? (now - assessed) / DAY : null;
  }
  d.clearDays = d.cleared && d.filed ? (d.cleared - d.filed) / DAY : null;
  return d;
}

// ---- main ----
function analyze(rawDocs, days, now = Date.now()) {
  const all = rawDocs.map((d) => enrich(d, now)).filter((d) => d.filed);
  const start = now - days * DAY;
  const prevStart = start - days * DAY;
  const earliest = all.reduce((a, d) => Math.min(a, d.filed), Infinity);
  const hasPrev = earliest <= prevStart + DAY;

  const cur = all.filter((d) => d.filed >= start);
  const prev = hasPrev ? all.filter((d) => d.filed >= prevStart && d.filed < start) : null;
  const sbs = (l) => l.filter((d) => d.type === SB);
  const bes = (l) => l.filter((d) => d.type === BE);

  const metrics = (l) => ({
    shippingBills: sbs(l).length,
    billsOfEntry: bes(l).length,
    exportFobInr: sum(sbs(l), (d) => d.valueInr),
    importValueInr: sum(bes(l), (d) => d.valueInr),
    dutyPaidInr: sum(bes(l).filter((d) => d.dutyPaidAt), (d) => d.dutyInr),
    exportClearMedianDays: round1(quantile(sbs(l).map((d) => d.clearDays).filter((v) => v != null), 0.5)),
    importClearMedianDays: round1(quantile(bes(l).map((d) => d.clearDays).filter((v) => v != null), 0.5)),
    queryRatePct: l.length ? round1((l.filter((d) => d.hadQuery).length / l.length) * 100) : null,
    refundTatMedianDays: round1(quantile(sbs(l).map((d) => d.refundTatDays).filter((v) => v != null), 0.5)),
  });
  const m = metrics(cur);
  const pm = prev ? metrics(prev) : {};

  // Pending refunds and open queries are "as of now", not range-bound.
  const refundDocs = sbs(all).filter((d) => d.refundStage);
  const pendingRefunds = refundDocs.filter((d) => d.refundStage !== 'Credited');
  const openQueries = all.filter((d) => d.queryOpen);

  const kpi = (key, better) => ({ value: m[key], previous: pm[key] ?? null, better });
  const kpis = {
    shippingBills: kpi('shippingBills', 'up'),
    billsOfEntry: kpi('billsOfEntry', 'up'),
    exportFobInr: kpi('exportFobInr', 'up'),
    importValueInr: kpi('importValueInr', 'up'),
    dutyPaidInr: kpi('dutyPaidInr', null),
    exportClearMedianDays: kpi('exportClearMedianDays', 'down'),
    importClearMedianDays: kpi('importClearMedianDays', 'down'),
    queryRatePct: kpi('queryRatePct', 'down'),
    refundTatMedianDays: kpi('refundTatMedianDays', 'down'),
    igstRefundPendingInr: { value: sum(pendingRefunds, (d) => d.igstRefundInr), count: pendingRefunds.length },
    openQueries: { value: openQueries.length },
  };

  return {
    range: { days, start: new Date(start).toISOString(), end: new Date(now).toISOString(), hasPrevious: hasPrev },
    kpis,
    trend: trend(cur, start, now, days),
    clearance: clearance(cur),
    queries: queryAging(openQueries),
    refunds: refunds(refundDocs, sbs(cur)),
    tradeMix: tradeMix(cur, prev),
    insights: insights({ m, pm, cur, prev, openQueries, refundDocs, pendingRefunds, all }),
    actions: actions(all),
    documents: cur.sort((a, b) => b.filed - a.filed).slice(0, 500).map(publicDoc),
  };
}

function trend(cur, start, now, days) {
  const granularity = days <= 31 ? 'day' : 'week';
  const step = granularity === 'day' ? DAY : 7 * DAY;
  const first = new Date(start);
  first.setUTCHours(0, 0, 0, 0);
  if (granularity === 'week') first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7)); // Monday
  const points = [];
  for (let t = first.getTime(); t <= now; t += step) {
    points.push({ start: new Date(t).toISOString().slice(0, 10), shippingBills: 0, billsOfEntry: 0, exportFobInr: 0, importValueInr: 0 });
  }
  for (const d of cur) {
    const p = points[Math.floor((d.filed - first.getTime()) / step)];
    if (!p) continue;
    if (d.type === SB) { p.shippingBills++; p.exportFobInr += d.valueInr || 0; } else { p.billsOfEntry++; p.importValueInr += d.valueInr || 0; }
  }
  // A partial first/last week would read as a dip; flag it so the UI can say so.
  if (granularity === 'week' && points.length) {
    points[0].partial = first.getTime() < start;
    points[points.length - 1].partial = points[points.length - 1].start > new Date(now - 7 * DAY).toISOString().slice(0, 10);
  }
  return { granularity, points };
}

function clearance(cur) {
  const buckets = [
    { label: '< 1 day', max: 1 }, { label: '1–2 days', max: 2 }, { label: '2–3 days', max: 3 },
    { label: '3–5 days', max: 5 }, { label: '5–10 days', max: 10 }, { label: '10+ days', max: Infinity },
  ];
  const histogram = buckets.map((b) => ({ label: b.label, shippingBills: 0, billsOfEntry: 0 }));
  for (const d of cur) {
    if (d.clearDays == null) continue;
    const i = buckets.findIndex((b) => d.clearDays < b.max);
    histogram[i][d.type === SB ? 'shippingBills' : 'billsOfEntry']++;
  }
  const codes = [...new Set(cur.map((d) => d.port))];
  const byPort = codes.map((code) => {
    const l = cur.filter((d) => d.port === code);
    const sbT = l.filter((d) => d.type === SB && d.clearDays != null).map((d) => d.clearDays);
    const beT = l.filter((d) => d.type === BE && d.clearDays != null).map((d) => d.clearDays);
    return {
      code, name: PORTS[code] || code, documents: l.length,
      exportMedianDays: round1(quantile(sbT, 0.5)), exportP90Days: round1(quantile(sbT, 0.9)),
      importMedianDays: round1(quantile(beT, 0.5)), importP90Days: round1(quantile(beT, 0.9)),
      queryRatePct: round1((l.filter((d) => d.hadQuery).length / l.length) * 100),
    };
  }).sort((a, b) => b.documents - a.documents);
  return { histogram, byPort };
}

function queryAging(open) {
  const buckets = [['0–2 days', 2], ['3–7 days', 7], ['8–14 days', 14], ['15+ days', Infinity]];
  return {
    open: open.length,
    aging: buckets.map(([label, max], i) => ({
      label,
      count: open.filter((d) => d.queryAgeDays < max && d.queryAgeDays >= (i ? buckets[i - 1][1] : -1)).length,
    })),
  };
}

function refunds(refundDocs, sbsInRange) {
  const stages = REFUND_STAGES.map((name) => {
    const l = refundDocs.filter((d) => d.refundStage === name && (name !== 'Credited' || sbsInRange.includes(d)));
    return { name, count: l.length, amountInr: sum(l, (d) => d.igstRefundInr) };
  });
  const errDocs = refundDocs.filter((d) => d.refundStage === 'Validation error');
  const errors = [...new Set(errDocs.map((d) => d.refundErrorCode))].map((code) => {
    const l = errDocs.filter((d) => d.refundErrorCode === code);
    return { code, description: REFUND_ERRORS[code] || 'Other', count: l.length, amountInr: sum(l, (d) => d.igstRefundInr) };
  }).sort((a, b) => b.amountInr - a.amountInr);
  const waiting = refundDocs.filter((d) => d.refundWaitDays != null && d.refundStage !== 'Validation error');
  const agingBuckets = [['< 7 days', 7], ['7–14 days', 14], ['15–30 days', 30], ['30+ days', Infinity]];
  const aging = agingBuckets.map(([label, max], i) => {
    const l = waiting.filter((d) => d.refundWaitDays < max && d.refundWaitDays >= (i ? agingBuckets[i - 1][1] : 0));
    return { label, count: l.length, amountInr: sum(l, (d) => d.igstRefundInr) };
  });
  return { stages, errors, aging, note: 'Pending stages and errors are as of today; Credited is for the selected range.' };
}

function tradeMix(cur, prev) {
  const group = (l, key, names, prevL) => {
    const m = new Map();
    for (const d of l) m.set(d[key], (m.get(d[key]) || 0) + (d.valueInr || 0));
    const pmap = new Map();
    for (const d of prevL || []) pmap.set(d[key], (pmap.get(d[key]) || 0) + (d.valueInr || 0));
    const total = sum(l, (d) => d.valueInr);
    return [...m.entries()].map(([code, valueInr]) => ({
      code, name: names[code] || code, valueInr,
      sharePct: total ? round1((valueInr / total) * 100) : 0,
      changePct: prevL && pmap.get(code) ? round1(((valueInr - pmap.get(code)) / pmap.get(code)) * 100) : null,
    })).sort((a, b) => b.valueInr - a.valueInr).slice(0, 8);
  };
  const ex = cur.filter((d) => d.type === SB);
  const im = cur.filter((d) => d.type === BE);
  const pex = prev && prev.filter((d) => d.type === SB);
  const pim = prev && prev.filter((d) => d.type === BE);
  return {
    exports: { hs: group(ex, 'hsChapter', HS_CHAPTERS, pex), countries: group(ex, 'country', COUNTRIES, pex) },
    imports: { hs: group(im, 'hsChapter', HS_CHAPTERS, pim), countries: group(im, 'country', COUNTRIES, pim) },
  };
}

function insights({ m, pm, cur, prev, openQueries, refundDocs, pendingRefunds }) {
  const out = [];
  const inr = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);
  const pctChange = (a, b) => (b ? ((a - b) / b) * 100 : null);

  // Slowest port vs overall, exports
  const ports = clearance(cur).byPort.filter((p) => p.documents >= 20 && p.exportMedianDays != null);
  if (ports.length > 1 && m.exportClearMedianDays) {
    const slow = ports.reduce((a, b) => (b.exportMedianDays > a.exportMedianDays ? b : a));
    const ratio = slow.exportMedianDays / m.exportClearMedianDays;
    if (ratio >= 1.3) {
      out.push({ severity: ratio >= 1.8 ? 'critical' : 'warning', title: `${slow.name} is the slowest port for exports`,
        detail: `Median ${slow.exportMedianDays} days from filing to LEO, ${ratio.toFixed(1)}× the all-port median of ${m.exportClearMedianDays} days. Its query rate is ${slow.queryRatePct}%.` });
    }
  }
  // Query rate trend
  if (pm.queryRatePct != null && m.queryRatePct != null) {
    const diff = m.queryRatePct - pm.queryRatePct;
    if (Math.abs(diff) >= 1) {
      out.push({ severity: diff > 0 ? 'warning' : 'good', title: `Query rate ${diff > 0 ? 'rose' : 'fell'} to ${m.queryRatePct}%`,
        detail: `${Math.abs(diff).toFixed(1)} percentage points ${diff > 0 ? 'higher' : 'lower'} than the previous period (${pm.queryRatePct}%).` });
    }
  }
  // Old open queries
  const old = openQueries.filter((d) => d.queryAgeDays >= 7);
  if (old.length) {
    out.push({ severity: 'critical', title: `${old.length} quer${old.length === 1 ? 'y has' : 'ies have'} been open 7+ days`,
      detail: `Oldest: ${old.reduce((a, b) => (b.queryAgeDays > a.queryAgeDays ? b : a)).number} at ${Math.floor(Math.max(...old.map((d) => d.queryAgeDays)))} days. Unanswered queries hold up both clearance and IGST refunds.` });
  }
  // Refund errors
  const errs = refundDocs.filter((d) => d.refundStage === 'Validation error');
  if (errs.length) {
    const byCode = {};
    for (const d of errs) byCode[d.refundErrorCode] = (byCode[d.refundErrorCode] || 0) + d.igstRefundInr;
    const [code, amt] = Object.entries(byCode).sort((a, b) => b[1] - a[1])[0];
    out.push({ severity: 'critical', title: `${inr(sum(errs, (d) => d.igstRefundInr))} of IGST refunds blocked by validation errors`,
      detail: `${errs.length} shipping bills. Largest cause: ${code} (${REFUND_ERRORS[code] || 'other'}), ${inr(amt)}. Fixing these needs a correction at the GST or shipping bill end; they will not clear on their own.` });
  }
  // Refunds waiting long
  const slowRefunds = pendingRefunds.filter((d) => d.refundWaitDays >= 15 && d.refundStage !== 'Validation error');
  if (slowRefunds.length) {
    out.push({ severity: 'warning', title: `${slowRefunds.length} refund${slowRefunds.length === 1 ? '' : 's'} waiting 15+ days after EGM`,
      detail: `${inr(sum(slowRefunds, (d) => d.igstRefundInr))} outstanding. Median turnaround in this period is ${m.refundTatMedianDays ?? '—'} days.` });
  }
  // Export value change
  const vc = pctChange(m.exportFobInr, pm.exportFobInr);
  if (vc != null && Math.abs(vc) >= 3) {
    out.push({ severity: vc > 0 ? 'good' : 'warning', title: `Export value ${vc > 0 ? 'up' : 'down'} ${Math.abs(vc).toFixed(1)}%`,
      detail: `${inr(m.exportFobInr)} FOB vs ${inr(pm.exportFobInr)} in the previous period.` });
  }
  // Concentration
  const mix = tradeMix(cur, prev);
  const topDest = mix.exports.countries[0];
  if (topDest && topDest.sharePct >= 25) {
    out.push({ severity: 'info', title: `${topDest.name} takes ${topDest.sharePct}% of export value`,
      detail: `Your largest destination${topDest.changePct != null ? `, ${topDest.changePct >= 0 ? 'up' : 'down'} ${Math.abs(topDest.changePct)}% on the previous period` : ''}.` });
  }
  const topOrigin = mix.imports.countries[0];
  if (topOrigin && topOrigin.sharePct >= 25) {
    out.push({ severity: 'info', title: `${topOrigin.name} supplies ${topOrigin.sharePct}% of import value`,
      detail: 'A single-origin dependency worth watching for supply or duty changes.' });
  }
  const order = { critical: 0, warning: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

function actions(all) {
  const out = [];
  for (const d of all) {
    if (d.queryOpen && d.queryAgeDays >= 3) {
      out.push({ severity: d.queryAgeDays >= 7 ? 'critical' : 'warning', action: 'Reply to query', ageDays: d.queryAgeDays, doc: d });
    }
    if (d.refundStage === 'Validation error') {
      out.push({ severity: 'critical', action: `Fix refund error ${d.refundErrorCode}`, detail: REFUND_ERRORS[d.refundErrorCode], ageDays: (Date.now() - ts(d.egmAt)) / DAY, amountInr: d.igstRefundInr, doc: d });
    }
    if (d.dutyPendingDays != null && d.dutyPendingDays >= 1) {
      out.push({ severity: d.dutyPendingDays >= 3 ? 'critical' : 'warning', action: 'Pay duty', detail: 'Delays risk demurrage', ageDays: d.dutyPendingDays, amountInr: d.dutyInr, doc: d });
    }
    if (d.type === SB && d.leoAt && !d.egmAt && (Date.now() - ts(d.leoAt)) / DAY >= 7) {
      out.push({ severity: 'warning', action: 'Chase EGM filing', detail: 'Refund cannot start until EGM is filed', ageDays: (Date.now() - ts(d.leoAt)) / DAY, doc: d });
    }
  }
  const order = { critical: 0, warning: 1 };
  return out
    .sort((a, b) => order[a.severity] - order[b.severity] || b.ageDays - a.ageDays)
    .slice(0, 50)
    .map((a) => ({ ...a, ageDays: round1(a.ageDays), doc: { type: a.doc.type, number: a.doc.number, port: a.doc.port } }));
}

function publicDoc(d) {
  return {
    type: d.type, number: d.number, filedAt: d.filedAt, port: d.port, country: d.country, hsChapter: d.hsChapter,
    status: d.status, valueInr: d.valueInr, dutyInr: d.dutyInr ?? null, igstRefundInr: d.igstRefundInr ?? null,
    refundStage: d.refundStage ?? null, clearDays: round1(d.clearDays),
  };
}

module.exports = { analyze };
