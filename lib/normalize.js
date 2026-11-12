// Validates a live API payload against the dashboard contract so a partial or
// differently-shaped response fails loudly (and falls back to demo data)
// instead of rendering a half-empty dashboard.
'use strict';

const REQUIRED = ['kpis', 'daily', 'refundStages', 'statusBreakdown', 'ports', 'documents'];

function normalize(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('response is not a JSON object');
  const body = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const missing = REQUIRED.filter((k) => !(k in body));
  if (missing.length) throw new Error(`response missing: ${missing.join(', ')}`);
  for (const k of REQUIRED.slice(1)) {
    if (!Array.isArray(body[k])) throw new Error(`${k} must be an array`);
  }
  const out = {};
  for (const k of REQUIRED) out[k] = body[k];
  return out;
}

module.exports = { normalize };
