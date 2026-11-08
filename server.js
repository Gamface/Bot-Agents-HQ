#!/usr/bin/env node
// Mission Control local server — no required dependencies, just Node 18+.
// Serves the dashboard and keeps its data in ./data on this computer.
//
//   node server.js              → http://localhost:4000
//   PORT=5000 node server.js    → another port
//   HOST=0.0.0.0 node server.js → also reachable from other devices on your network. They sign in
//                                 with an access token (created on first start and printed below).

'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMcp } = require('./mcp');
const { createRunner } = require('./runner');
const { createAuth } = require('./auth');
const { createPush } = require('./push');
const { createSources } = require('./sources');
const pwa = require('./pwa');

const ROOT = __dirname;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const BACKUPS = path.join(DATA, 'backups');
const STATE = path.join(DATA, 'state.json');
const EVENTS = path.join(DATA, 'events.json');
const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK_ONLY = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const MAX_BODY = 10 * 1024 * 1024;
const KEEP_BACKUPS = 72;     // hourly snapshots kept (3 days)
const KEEP_EVENTS = 2000;    // newest agent events kept

fs.mkdirSync(BACKUPS, { recursive: true });

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJSON = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); };
const readState = () => (fs.existsSync(STATE) ? readJSON(STATE, null) : null);

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

const send = (res, code, body, type = 'application/json; charset=utf-8', headers = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); } });
  req.on('error', reject);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- live updates (Server-Sent Events) ---------- */
const streams = new Set();
function broadcast(name, data) {
  const msg = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) res.write(msg);
}
setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 25000).unref();

/* ---------- agent events ---------- */
const EVENT_TYPES = new Set(['activity', 'agent', 'intel', 'approval', 'action', 'priority', 'meeting', 'note', 'project', 'decision', 'task', 'client', 'youtube', 'brief']);

let push; // set below; addEvents uses it for approval alerts

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
  broadcast('events', { lastEventId: nextEventId - 1 });
  // Phone alert when someone is waiting for your approval.
  for (const e of list) if (e.type === 'approval' && !e.state && push) {
    push.send({ title: `${e.who || e.agent || 'An agent'} needs your OK`, body: String(e.what || 'Approval requested'), url: '/#stack', tag: 'approval-' + (e.ref || Date.now()), sticky: true }).catch(() => {});
  }
  return added;
}

// When the dashboard page last checked for events (browsers send Sec-Fetch-* headers; scripts don't).
let dashboardSeenAt = 0;

const auth = createAuth({ dataDir: DATA, readJSON, writeJSON });
push = createPush({ dataDir: DATA, readJSON, writeJSON });
const mcp = createMcp({ readState, addEvents, dashboardSeenAt: () => (streams.size ? Date.now() : dashboardSeenAt) });
const runner = createRunner({ readState, addEvents });
runner.recover(events);
const sources = createSources({ dataDir: DATA, readJSON, writeJSON, readState, addEvents, complete: runner.complete });
sources.start();

if (!LOOPBACK_ONLY && !auth.token) auth.rotate(); // reachable from the network: never without a token

// Requests that change data must come from this dashboard or a script — not from another website open in your browser.
function sameOriginOrScript(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl, scripts, agents
  try { const o = new URL(origin); return o.host === req.headers.host; } catch { return false; }
}

const lanAddresses = () => Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    /* public: the page, the app shell and sign-in. None of these contain your data. */
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, fs.readFileSync(path.join(ROOT, 'index.html')), 'text/html; charset=utf-8', { 'Referrer-Policy': 'no-referrer' });
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p === '/manifest.webmanifest') return send(res, 200, JSON.stringify(pwa.manifest), 'application/manifest+json');
    if (p === '/sw.js') return send(res, 200, fs.readFileSync(path.join(ROOT, 'sw.js')), 'text/javascript; charset=utf-8');
    const png = req.method === 'GET' && pwa.iconFor(p);
    if (png) return send(res, 200, png, 'image/png', { 'Cache-Control': 'public, max-age=86400' });

    if ((p.startsWith('/api/') || p === '/mcp') && req.method !== 'GET' && !sameOriginOrScript(req)) {
      return send(res, 403, p === '/mcp' ? { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Cross-site request blocked' } } : { error: 'Cross-site request blocked' });
    }

    if (p === '/api/auth' && req.method === 'GET') {
      const info = auth.info(req);
      if (info.local) Object.assign(info, { token: auth.token, port: PORT, reachable: !LOOPBACK_ONLY, addresses: LOOPBACK_ONLY ? [] : lanAddresses() });
      return send(res, 200, info);
    }
    if (p === '/api/login' && req.method === 'POST') {
      const { token } = await readBody(req);
      if (!auth.token || !auth.check(token)) { await sleep(800); return send(res, 401, { error: 'That access token isn\'t right.' }); }
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': auth.cookieHeader(req, auth.token) });
    }
    if (p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': auth.cookieHeader(req, null) });

    /* everything below needs this computer, or the access token */
    if ((p.startsWith('/api/') || p === '/mcp') && !auth.allowed(req)) {
      return send(res, 401, p === '/mcp' ? { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Access token required' } } : { error: 'Sign in with your access token.' }, undefined, { 'WWW-Authenticate': 'Bearer' });
    }

    if (p === '/api/auth/rotate' && req.method === 'POST') {
      if (!auth.isLocal(req)) return send(res, 403, { error: 'A new token can only be made on the computer running Mission Control.' });
      const token = auth.rotate();
      return send(res, 200, { token }, undefined, { 'Set-Cookie': auth.cookieHeader(req, token) });
    }

    if (p === '/api/meta' && req.method === 'GET') return send(res, 200, { ok: true, ...meta, lastEventId: nextEventId - 1 });

    if (p === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ lastEventId: nextEventId - 1, rev: meta.rev })}\n\n`);
      streams.add(res);
      req.on('close', () => { streams.delete(res); dashboardSeenAt = Date.now(); });
      return;
    }

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
      broadcast('state', { rev: meta.rev, by: String(req.headers['x-client-id'] || '') });
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

    // Built-in agent runner: start, pause, resume and stop tasks.
    if (p === '/api/runner' && req.method === 'GET') return send(res, 200, runner.status());
    if (p === '/api/tasks' && req.method === 'POST') return send(res, 201, runner.submit(await readBody(req)));
    const m = p.match(/^\/api\/tasks\/([\w-]+)\/(pause|resume|stop)$/);
    if (m && req.method === 'POST') return send(res, 200, runner.control(m[1], m[2]));

    // Phone alerts (Web Push)
    if (p === '/api/push' && req.method === 'GET') return send(res, 200, { publicKey: push.publicKey, devices: push.devices().map(d => ({ label: d.label, added: d.added, endpoint: d.endpoint })) });
    if (p === '/api/push/subscribe' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, push.subscribe(b.subscription, b.label)); }
    if (p === '/api/push/unsubscribe' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, push.unsubscribe(b.endpoint)); }
    if (p === '/api/push/test' && req.method === 'POST') return send(res, 200, await push.send({ title: 'Mission Control', body: 'Alerts are on. You\'ll hear from me when an agent needs your OK.', url: '/#stack', tag: 'test' }));

    // Data sources
    if (p === '/api/sources' && req.method === 'GET') return send(res, 200, sources.view());
    if (p === '/api/sources' && req.method === 'POST') return send(res, 200, sources.update(await readBody(req)));
    const sm = p.match(/^\/api\/sources\/(\w+)\/sync$/);
    if (sm && req.method === 'POST') return send(res, 200, await sources.run(sm[1]));

    // MCP (Model Context Protocol) over Streamable HTTP: one JSON-RPC message or batch per POST, JSON reply.
    if (p === '/mcp') {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
      let body;
      try { body = await readBody(req); } catch (err) { return send(res, err.code === 413 ? 413 : 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } }); }
      const reply = await mcp.handle(body);
      if (!reply) { res.writeHead(202); return res.end(); }
      return send(res, 200, reply);
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, [400, 404, 409, 413].includes(err.code) ? err.code : 500, { error: err.message });
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Try: PORT=${PORT + 1} node server.js\n`);
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`\n  Mission Control is running → http://localhost:${PORT}\n  Data folder: ${DATA}`);
  if (!LOOPBACK_ONLY) {
    console.log('\n  Other devices can open it with this sign-in link (keep it private):');
    for (const ip of lanAddresses()) console.log(`    http://${ip}:${PORT}/#token=${auth.token}`);
    console.log('  The link is also in Settings → Other devices.');
  }
  console.log('  Press Ctrl+C to stop.\n');
});
