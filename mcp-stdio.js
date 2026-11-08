#!/usr/bin/env node
// Bridges Mission Control's MCP endpoint to stdio, for MCP clients that start a local
// command (Claude Desktop, Cursor, …). Mission Control (server.js) must be running.
//
//   node mcp-stdio.js                 → talks to http://localhost:4000/mcp
//   MC_URL=http://localhost:5000 node mcp-stdio.js

'use strict';
const readline = require('readline');
const MC_URL = (process.env.MC_URL || 'http://localhost:4000').replace(/\/+$/, '');

const write = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const idsOf = m => (Array.isArray(m) ? m : [m]).filter(x => x && x.method && x.id !== undefined && x.id !== null).map(x => x.id);

// One message at a time, in order, so an agent's writes land in the order it sent them.
let queue = Promise.resolve();

async function forward(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  try {
    const r = await fetch(MC_URL + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: line });
    if (r.status === 202) return;
    const text = await r.text();
    if (text) process.stdout.write(text.trim() + '\n');
  } catch (err) {
    const message = `Mission Control isn't running at ${MC_URL}. Start it with "npm start" (or start.bat / start.sh) and try again.`;
    for (const id of idsOf(msg)) write({ jsonrpc: '2.0', id, error: { code: -32000, message } });
    process.stderr.write(message + ' (' + err.message + ')\n');
  }
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  if (line.trim()) queue = queue.then(() => forward(line));
}).on('close', () => queue.then(() => process.exit(0)));
