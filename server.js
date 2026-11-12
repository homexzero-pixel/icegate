// ICEGATE dashboard server.
// Serves the dashboard from ./public and exposes GET /api/dashboard?days=N.
// The API key is read from the environment and only ever used server-side;
// it is never sent to the browser or written to disk.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { buildDemoDocuments } = require('./lib/demo');
const { analyze } = require('./lib/analytics');
const { normalize } = require('./lib/normalize');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_BASE = (process.env.ICEGATE_API_BASE || '').replace(/\/+$/, '');
const API_KEY = process.env.ICEGATE_API_KEY || '';
const API_KEY_HEADER = process.env.ICEGATE_API_KEY_HEADER || 'Authorization';
const API_KEY_PREFIX = process.env.ICEGATE_API_KEY_PREFIX ?? 'Bearer';
const API_PATH = process.env.ICEGATE_API_PATH || '/documents';
const CACHE_MS = (Number(process.env.CACHE_SECONDS) || 60) * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOWED_DAYS = new Set([30, 90, 180, 365]);

let docCache = null;

// Fetch (or build) the document list once per CACHE_SECONDS; every range is
// analysed from the same list so switching ranges is instant and consistent.
async function getDocuments() {
  if (docCache && Date.now() - docCache.at < CACHE_MS) return docCache;
  let entry;
  if (API_BASE && API_KEY) {
    try {
      entry = { docs: normalize(await fetchLive()), source: 'live' };
    } catch (err) {
      console.error(`[icegate] live fetch failed: ${err.message}`);
      entry = { docs: buildDemoDocuments(), source: 'demo', notice: `Live API unavailable (${err.message}). Showing demo data.` };
    }
  } else {
    entry = { docs: buildDemoDocuments(), source: 'demo', notice: 'ICEGATE_API_BASE / ICEGATE_API_KEY not set. Showing demo data.' };
  }
  docCache = { ...entry, at: Date.now() };
  return docCache;
}

async function getDashboard(days) {
  const { docs, source, notice, at } = await getDocuments();
  return { ...analyze(docs, days), source, notice, generatedAt: new Date(at).toISOString() };
}

async function fetchLive() {
  const url = `${API_BASE}${API_PATH}`;
  const headers = { Accept: 'application/json' };
  headers[API_KEY_HEADER] = API_KEY_PREFIX ? `${API_KEY_PREFIX} ${API_KEY}` : API_KEY;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/dashboard') {
      const days = Number(url.searchParams.get('days')) || 90;
      if (!ALLOWED_DAYS.has(days)) return send(res, 400, { error: 'days must be 30, 90, 180 or 365' });
      return send(res, 200, await getDashboard(days));
    }
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, live: Boolean(API_BASE && API_KEY) });

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'internal error' });
  }
});

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ICEGATE dashboard on http://localhost:${PORT} (${API_BASE && API_KEY ? 'live API' : 'demo data'})`);
  });
}

module.exports = { server, getDashboard };
