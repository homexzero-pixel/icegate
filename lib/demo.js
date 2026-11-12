// Deterministic demo data shaped like the dashboard contract (see README).
'use strict';

const PORTS = [
  { code: 'INNSA1', name: 'Nhava Sheva' },
  { code: 'INMUN1', name: 'Mundra' },
  { code: 'INMAA1', name: 'Chennai Sea' },
  { code: 'INBOM4', name: 'Mumbai Air' },
  { code: 'INDEL4', name: 'Delhi Air' },
];
const EXPORT_STATUSES = ['Filed', 'Assessed', 'LEO granted', 'EGM filed', 'Query raised'];
const IMPORT_STATUSES = ['Filed', 'Assessed', 'Duty pending', 'Out of charge', 'Query raised'];
const EXPORT_W = [0.12, 0.13, 0.35, 0.33, 0.07];
const IMPORT_W = [0.1, 0.14, 0.1, 0.58, 0.08];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(r, items, weights) {
  let x = r();
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function buildDemo(days) {
  const r = rng(20261112);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daily = [];
  const documents = [];
  let sbNo = 8_412_000;
  let beNo = 5_903_000;

  // Always generate 90 days so shorter ranges are consistent slices.
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const trend = 1 + (89 - i) / 300;
    const sb = Math.round((weekend ? 3 : 11) * trend + r() * (weekend ? 3 : 7));
    const be = Math.round((weekend ? 2 : 7) * trend + r() * (weekend ? 2 : 5));
    const date = isoDay(d);
    daily.push({ date, shippingBills: sb, billsOfEntry: be });

    const ageFactor = Math.min(1, i / 10); // recent docs are less progressed
    for (let k = 0; k < sb; k++) {
      const status = i < 3 && r() > ageFactor ? pick(r, EXPORT_STATUSES.slice(0, 2), [0.5, 0.5]) : pick(r, EXPORT_STATUSES, EXPORT_W);
      const fob = Math.round((2 + r() * 60) * 100000);
      documents.push({
        type: 'Shipping Bill', number: String(sbNo++), date, port: pick(r, PORTS, [0.35, 0.25, 0.15, 0.15, 0.1]).code,
        status, valueInr: fob,
        igstRefundInr: Math.round(fob * 0.18 * (r() > 0.4 ? 1 : 0)),
        drawbackInr: Math.round(fob * (0.01 + r() * 0.02)),
      });
    }
    for (let k = 0; k < be; k++) {
      const status = i < 3 && r() > ageFactor ? pick(r, IMPORT_STATUSES.slice(0, 3), [0.4, 0.3, 0.3]) : pick(r, IMPORT_STATUSES, IMPORT_W);
      const av = Math.round((1 + r() * 40) * 100000);
      documents.push({
        type: 'Bill of Entry', number: String(beNo++), date, port: pick(r, PORTS, [0.4, 0.2, 0.15, 0.15, 0.1]).code,
        status, valueInr: av, dutyInr: Math.round(av * (0.1 + r() * 0.2)),
      });
    }
  }

  const cutoff = daily[daily.length - days].date;
  const inRange = documents.filter((d) => d.date >= cutoff);
  const prevCutoff = days * 2 <= 90 ? daily[daily.length - days * 2].date : null;
  const prev = prevCutoff ? documents.filter((d) => d.date >= prevCutoff && d.date < cutoff) : null;

  const sbs = inRange.filter((d) => d.type === 'Shipping Bill');
  const bes = inRange.filter((d) => d.type === 'Bill of Entry');
  const count = (list, type) => list.filter((d) => d.type === type).length;
  const sum = (list, key) => list.reduce((a, d) => a + (d[key] || 0), 0);

  // IGST refund pipeline over shipping bills with a refund claim.
  const claims = sbs.filter((d) => d.igstRefundInr > 0);
  const r2 = rng(days * 7 + 3);
  const stage = (d) => {
    if (d.status === 'Filed' || d.status === 'Assessed' || d.status === 'Query raised') return 'Awaiting LEO';
    if (d.status === 'LEO granted') return 'Awaiting EGM';
    const x = r2();
    return x < 0.15 ? 'Validation error' : x < 0.35 ? 'Scroll pending' : 'Credited';
  };
  const stageNames = ['Awaiting LEO', 'Awaiting EGM', 'Scroll pending', 'Credited', 'Validation error'];
  const refundStages = stageNames.map((name) => ({ name, count: 0, amountInr: 0 }));
  for (const c of claims) {
    const name = stage(c);
    const s = refundStages.find((x) => x.name === name);
    s.count++;
    s.amountInr += c.igstRefundInr;
  }

  const statuses = [...new Set([...EXPORT_STATUSES, ...IMPORT_STATUSES])];
  const statusBreakdown = statuses.map((status) => ({
    status,
    shippingBills: sbs.filter((d) => d.status === status).length,
    billsOfEntry: bes.filter((d) => d.status === status).length,
  }));

  const ports = PORTS.map((p) => ({
    code: p.code, name: p.name,
    shippingBills: sbs.filter((d) => d.port === p.code).length,
    billsOfEntry: bes.filter((d) => d.port === p.code).length,
  }));

  return {
    kpis: {
      shippingBills: { value: sbs.length, previous: prev ? count(prev, 'Shipping Bill') : null },
      billsOfEntry: { value: bes.length, previous: prev ? count(prev, 'Bill of Entry') : null },
      queriesOpen: { value: inRange.filter((d) => d.status === 'Query raised').length },
      dutyPendingInr: { value: sum(bes.filter((d) => d.status === 'Duty pending'), 'dutyInr') },
      igstRefundPendingInr: { value: refundStages.filter((s) => s.name !== 'Credited').reduce((a, s) => a + s.amountInr, 0) },
      igstRefundCreditedInr: { value: refundStages.find((s) => s.name === 'Credited').amountInr },
      exportFobInr: { value: sum(sbs, 'valueInr'), previous: prev ? sum(prev.filter((d) => d.type === 'Shipping Bill'), 'valueInr') : null },
    },
    daily: daily.slice(-days),
    refundStages,
    statusBreakdown,
    ports,
    documents: inRange.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 250),
  };
}

module.exports = { buildDemo };
