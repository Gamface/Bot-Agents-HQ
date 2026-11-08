#!/usr/bin/env node
// Mission Control local server — no dependencies, just Node 18+.
// Serves the dashboard and keeps its data in ./data on this computer.
//
//   node server.js            → http://localhost:4000
//   PORT=5000 node server.js  → another port
//   HOST=0.0.0.0 node server.js → also reachable from other devices on your network (no login — only on networks you trust)

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createMcp } = require('./mcp');

const ROOT = __dirname;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const BACKUPS = path.join(DATA, 'backups');
const STATE = path.join(DATA, 'state.json');
const EVENTS = path.join(DATA, 'events.json');
const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 10 * 1024 * 1024;
const KEEP_BACKUPS = 72;     // hourly snapshots kept (3 days)
const KEEP_EVENTS = 2000;    // newest agent events kept

fs.mkdirSync(BACKUPS, { recursive: true });

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJSON = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); };

let meta = { rev: 0, savedAt: null };
if (fs.existsSync(STATE)) { const s = readJSON(STATE, null); meta = { rev: (s && s._rev) || 0, savedAt: fs.statSync(STATE).mtime.toISOString() }; }
let events = readJSON(EVENTS, []);
let nextEventId = events.length ? events[events.length - 1].id + 1 : 1;

function backup() {
  try { backupNow(); } catch (err) { console.warn('Backup skipped:', err.message); }
}
function backupNow() {
  if (!fs.existsSync(STATE)) return;
  fs.mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 13).replace(/:/g, '-'); // one file per hour
  const file = path.join(BACKUPS, `state-${stamp}.json`);
  fs.copyFileSync(STATE, file);
  const all = fs.readdirSync(BACKUPS).filter(f => f.startsWith('state-')).sort();
  all.slice(0, Math.max(0, all.length - KEEP_BACKUPS)).forEach(f => fs.unlinkSync(path.join(BACKUPS, f)));
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); } });
  req.on('error', reject);
});

const EVENT_TYPES = new Set(['activity', 'agent', 'intel', 'approval', 'action', 'priority', 'meeting', 'note', 'project', 'decision']);

// Queue agent events for the dashboard to apply. Checks the whole batch first, so a rejected batch saves nothing.
function addEvents(list) {
  if (list.some(e => !e || !EVENT_TYPES.has(e.type))) throw Object.assign(new Error('Unknown event type. Use one of: ' + [...EVENT_TYPES].join(', ')), { code: 400 });
  const added = [];
  for (const e of list) {
    const ev = { ...e, id: nextEventId++, at: new Date().toISOString() };
    events.push(ev); added.push(ev.id);
  }
  if (events.length > KEEP_EVENTS) events = events.slice(-KEEP_EVENTS);
  writeJSON(EVENTS, events);
  return added;
}

// When the dashboard page last checked for events (browsers send Sec-Fetch-* headers; scripts don't).
let dashboardSeenAt = 0;

const mcp = createMcp({
  readState: () => (fs.existsSync(STATE) ? readJSON(STATE, null) : null),
  addEvents,
  dashboardSeenAt: () => dashboardSeenAt,
});

// Requests that change data must come from this dashboard or a script — not from another website open in your browser.
function sameOriginOrScript(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl, scripts, agents
  try { const o = new URL(origin); return o.host === req.headers.host; } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, fs.readFileSync(path.join(ROOT, 'index.html')), 'text/html; charset=utf-8');
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

    if (p.startsWith('/api/') && req.method !== 'GET' && !sameOriginOrScript(req)) return send(res, 403, { error: 'Cross-site request blocked' });

    if (p === '/api/meta' && req.method === 'GET') return send(res, 200, { ok: true, ...meta, lastEventId: nextEventId - 1 });

    if (p === '/api/state' && req.method === 'GET') {
      if (!fs.existsSync(STATE)) return send(res, 200, { empty: true });
      return send(res, 200, fs.readFileSync(STATE));
    }
    if (p === '/api/state' && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body || body.v !== 1 || !body.settings) return send(res, 400, { error: 'Not a Mission Control state' });
      body._rev = meta.rev + 1;
      writeJSON(STATE, body);
      meta = { rev: body._rev, savedAt: new Date().toISOString() };
      backup();
      return send(res, 200, meta);
    }

    if (p === '/api/events' && req.method === 'GET') {
      if (req.headers['sec-fetch-site']) dashboardSeenAt = Date.now();
      const after = Number(url.searchParams.get('after')) || 0;
      return send(res, 200, { events: events.filter(e => e.id > after), lastEventId: nextEventId - 1 });
    }
    if (p === '/api/events' && req.method === 'POST') {
      const body = await readBody(req);
      return send(res, 201, { ok: true, ids: addEvents(Array.isArray(body) ? body : [body]) });
    }

    // MCP (Model Context Protocol) over Streamable HTTP: one JSON-RPC message or batch per POST, JSON reply.
    if (p === '/mcp') {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
      if (!sameOriginOrScript(req)) return send(res, 403, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Cross-site request blocked' } });
      let body;
      try { body = await readBody(req); } catch (err) { return send(res, err.code === 413 ? 413 : 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } }); }
      const reply = await mcp.handle(body);
      if (!reply) { res.writeHead(202); return res.end(); }
      return send(res, 200, reply);
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, err.code === 413 || err.code === 400 ? err.code : 500, { error: err.message });
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Try: PORT=${PORT + 1} node server.js\n`);
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '127.0.0.1' ? 'localhost' : HOST;
  console.log(`\n  Mission Control is running → http://${shown}:${PORT}\n  Data folder: ${DATA}\n  Press Ctrl+C to stop.\n`);
});
