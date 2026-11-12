// Deterministic demo documents in the same shape a live API should return
// (see README "Data contract"). Two years are generated so every range has a
// previous period to compare against.
'use strict';

const DAY = 864e5;
const HOUR = 36e5;

const PORT_PROFILE = {
  // weight, clearance speed factor (higher = slower), query probability, refund error probability
  INNSA1: { w: 0.32, slow: 1.0, q: 0.07, err: 0.08 },
  INMUN1: { w: 0.24, slow: 1.7, q: 0.12, err: 0.14 },
  INMAA1: { w: 0.14, slow: 1.1, q: 0.06, err: 0.07 },
  INBOM4: { w: 0.16, slow: 0.5, q: 0.05, err: 0.05 },
  INDEL4: { w: 0.14, slow: 0.6, q: 0.09, err: 0.06 },
};
const EXPORT_HS = [['30', 0.22], ['84', 0.17], ['62', 0.16], ['85', 0.14], ['71', 0.13], ['87', 0.1], ['29', 0.08]];
const IMPORT_HS = [['85', 0.26], ['84', 0.2], ['27', 0.14], ['39', 0.12], ['72', 0.11], ['29', 0.1], ['71', 0.07]];
const DESTS = [['US', 0.28], ['AE', 0.17], ['GB', 0.12], ['DE', 0.11], ['NL', 0.1], ['BD', 0.12], ['SG', 0.1]];
const ORIGINS = [['CN', 0.36], ['AE', 0.14], ['US', 0.12], ['SA', 0.1], ['DE', 0.1], ['KR', 0.1], ['JP', 0.08]];
const ERR_CODES = [['SB005', 0.38], ['SB003', 0.27], ['SB006', 0.2], ['SB002', 0.15]];

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

function weighted(r, pairs) {
  let x = r() * pairs.reduce((a, p) => a + p[1], 0);
  for (const [v, w] of pairs) if ((x -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
}

const iso = (t) => (t == null ? null : new Date(t).toISOString());

function buildDemoDocuments(now = Date.now()) {
  const r = rng(20261112);
  const ports = Object.entries(PORT_PROFILE).map(([code, p]) => [code, p.w]);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const docs = [];
  let sbNo = 8_100_000;
  let beNo = 5_600_000;
  const DAYS = 730;
  const at = (t) => (t <= now ? t : null);

  for (let i = DAYS - 1; i >= 0; i--) {
    const day = today.getTime() - i * DAY;
    const dow = new Date(day).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const growth = 0.75 + ((DAYS - i) / DAYS) * 0.45;
    const season = 1 + 0.15 * Math.sin(((DAYS - i) / 365) * 2 * Math.PI);
    const nSb = Math.round(((weekend ? 3 : 11) + r() * (weekend ? 3 : 7)) * growth * season);
    const nBe = Math.round(((weekend ? 2 : 7) + r() * (weekend ? 2 : 5)) * growth);

    for (let k = 0; k < nSb + nBe; k++) {
      const isSb = k < nSb;
      const port = weighted(r, ports);
      const prof = PORT_PROFILE[port];
      const filed = day + (9 + r() * 10) * HOUR;
      if (filed > now) continue;

      let t = filed;
      let queryRaisedAt = null;
      let queryResolvedAt = null;
      if (r() < prof.q) {
        queryRaisedAt = t + (4 + r() * 30) * HOUR;
        queryResolvedAt = queryRaisedAt + (1 + r() * r() * 18) * DAY;
        t = queryResolvedAt;
      }
      const assessedAt = t + (2 + r() * 20) * HOUR * prof.slow;

      const doc = {
        type: isSb ? 'Shipping Bill' : 'Bill of Entry',
        number: String(isSb ? sbNo++ : beNo++),
        filedAt: iso(filed),
        port,
        country: weighted(r, isSb ? DESTS : ORIGINS),
        hsChapter: weighted(r, isSb ? EXPORT_HS : IMPORT_HS),
        valueInr: Math.round((isSb ? 2 + r() * 60 : 1 + r() * 45) * 100000),
        queryRaisedAt: iso(at(queryRaisedAt ?? Infinity)),
        queryResolvedAt: iso(at(queryResolvedAt ?? Infinity)),
        assessedAt: iso(at(assessedAt)),
      };

      if (isSb) {
        const leo = assessedAt + (1 + r() * 14) * HOUR * prof.slow;
        const egm = leo + (1 + r() * 4) * DAY;
        doc.leoAt = iso(at(leo));
        doc.egmAt = iso(at(egm));
        if (r() < 0.62) {
          doc.igstRefundInr = Math.round(doc.valueInr * 0.18);
          // Some refunds hit a validation error; most get corrected 1-6 weeks later.
          const err = r() < prof.err ? weighted(r, ERR_CODES) : null;
          const fixedAt = err ? egm + (5 + r() * 40) * DAY : egm;
          if (err && egm <= now && fixedAt > now) {
            doc.refundErrorCode = err;
          } else {
            const scroll = fixedAt + (2 + r() * 8 * prof.slow) * DAY;
            const credit = scroll + (1 + r() * 5) * DAY;
            doc.refundScrollAt = iso(at(scroll));
            doc.refundCreditedAt = iso(at(credit));
          }
        }
        doc.drawbackInr = Math.round(doc.valueInr * (0.01 + r() * 0.02));
      } else {
        const dutyInr = Math.round(doc.valueInr * (0.08 + r() * 0.22));
        const paid = assessedAt + (2 + r() * r() * 90) * HOUR;
        const ooc = paid + (3 + r() * 40) * HOUR * prof.slow;
        doc.dutyInr = dutyInr;
        doc.dutyPaidAt = iso(at(paid));
        doc.oocAt = iso(at(ooc));
      }
      docs.push(doc);
    }
  }
  return docs;
}

module.exports = { buildDemoDocuments };
