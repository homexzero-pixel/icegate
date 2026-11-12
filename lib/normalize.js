// Accepts the live API payload and returns a documents array, failing loudly
// (so the server falls back to demo data) when the shape is wrong.
'use strict';

const TYPES = new Set(['Shipping Bill', 'Bill of Entry']);

function normalize(payload) {
  const body = payload && typeof payload === 'object' && payload.data !== undefined ? payload.data : payload;
  const docs = Array.isArray(body) ? body : body && body.documents;
  if (!Array.isArray(docs)) throw new Error('response has no documents array');
  if (!docs.length) throw new Error('response contains no documents');
  const bad = docs.findIndex((d) => !d || !TYPES.has(d.type) || !d.number || !(d.filedAt || d.date));
  if (bad !== -1) throw new Error(`document ${bad} needs type ("Shipping Bill"/"Bill of Entry"), number and filedAt`);
  return docs;
}

module.exports = { normalize };
