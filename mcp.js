// Mission Control as an MCP server (Model Context Protocol), no dependencies.
// server.js serves it at POST /mcp (Streamable HTTP, JSON responses).
// mcp-stdio.js bridges it for clients that only start local commands.
//
// Writes go through the same event queue as POST /api/events, so the open
// dashboard applies them within a few seconds. Reads come from the saved state.

'use strict';

const SERVER_INFO = { name: 'mission-control', title: 'Bot Agents HQ — Mission Control', version: '1.2.0' };
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS =
  'Mission Control is the user\'s dashboard for their AI agent team. Use it to report what you are doing ' +
  '(update_agent, log_activity), record results (add_note, add_intel, log_decision), plan work (add_priority, add_project), ' +
  'and ask the user before sensitive actions (request_approval, then wait for approved/denied). ' +
  'Call get_overview first to see goals, priorities, projects and agents. Pick one agent name for yourself and use it consistently.';

const COLUMNS = ['Backlog', 'In Progress', 'Done'];
const TASK_PREFIX = 'Task received: ';
const str = { type: 'string' };
const tool = (name, title, description, properties = {}, required = [], extra = {}) =>
  ({ name, title, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, ...extra });
const READ = { annotations: { readOnlyHint: true, openWorldHint: false } };
const WRITE = { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } };

const TOOLS = [
  tool('get_overview', 'Get overview', 'Summary of the dashboard: owner and goal, revenue progress, top priorities, projects by column, agents and their status, pending approvals, upcoming meetings.', {}, [], READ),
  tool('get_section', 'Read a section', 'Full contents of one part of the dashboard.', {
    section: { type: 'string', enum: ['priorities', 'projects', 'agents', 'approvals', 'meetings', 'intel', 'notes', 'decisions', 'activity', 'clients', 'timeline', 'tasks', 'queue'] },
    limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Newest/first N items (default 50)' },
  }, ['section'], READ),
  tool('get_my_tasks', 'Get my tasks', 'Tasks the user sent to an agent from Command Center → "Send task", newest first, plus follow-ups queued for it.', {
    agent: { ...str, description: 'Agent name' },
  }, ['agent'], READ),
  tool('log_activity', 'Log activity', 'Add a line to the Dashboard activity feed.', {
    who: { ...str, description: 'Your agent name' }, what: { ...str, description: 'What happened, e.g. "found 12 new dental clinics"' },
  }, ['who', 'what'], WRITE),
  tool('update_agent', 'Update agent', 'Create or update a coworker card in Command Center: status, a log line, and optionally the live browser view.', {
    agent: { ...str, description: 'Agent name (a new name adds a coworker)' },
    status: { type: 'string', enum: ['Online', 'Busy', 'Offline'] },
    log: { ...str, description: 'Log line, also shown in the activity feed' },
    role: str, model: str, desc: str,
    caps: { type: 'array', items: str, description: 'Capabilities' },
    specialist: { type: 'boolean' },
    session: { type: 'object', description: 'Live view: {url, title, target, steps: [..], cur: index of current step}', properties: { url: str, title: str, target: str, steps: { type: 'array', items: str }, cur: { type: 'integer' } } },
  }, ['agent'], WRITE),
  tool('add_priority', 'Add priority', 'Add an item to Top priorities on the Dashboard.', {
    text: str, tag: { type: 'string', enum: ['GENERAL', 'SALES', 'CONTENT', 'INTEL', 'FINANCE', 'MEETING'] },
  }, ['text'], WRITE),
  tool('add_project', 'Add project', 'Add a card to the Projects kanban board.', {
    title: str, desc: str, priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    column: { type: 'string', enum: COLUMNS, description: 'Default Backlog' }, who: { ...str, description: 'Your agent name' },
  }, ['title'], WRITE),
  tool('add_note', 'Add note', 'Save a note (Markdown-ish: "#" headings, "-" bullets). Good for reports and results.', { body: str }, ['body'], WRITE),
  tool('add_intel', 'Add intel', 'Add an item to the Intel feed.', {
    title: str, summary: str, source: str, cat: { ...str, description: 'Category, e.g. AI News, Competitors, Market' },
    imp: { type: 'string', enum: ['hot', 'notable', 'ref'] },
  }, ['title'], WRITE),
  tool('add_meeting', 'Add meeting', 'Add a meeting with an optional agenda.', {
    title: str, start: { ...str, description: 'ISO 8601 date-time' }, dur: { type: 'integer', description: 'Minutes (default 30)' },
    mtype: { ...str, description: 'Zoom, Call, In person…' }, attendees: str, agenda: { type: 'array', items: str },
  }, ['title', 'start'], WRITE),
  tool('log_decision', 'Log decision', 'Record a decision in the Executive decisions log.', {
    question: str, decision: str, who: str,
  }, ['question', 'decision'], WRITE),
  tool('log_action', 'Log action', 'Record an action in the Stack action log with its policy outcome.', {
    who: str, what: str, outcome: { type: 'string', enum: ['ALLOW', 'ASK', 'REFUSE'] },
  }, ['who', 'what'], WRITE),
  tool('request_approval', 'Request approval', 'Ask the user to approve an action. Shows an approval card on the dashboard. Waits up to wait_seconds for the answer; if still pending, call check_approval later. Do not do the action unless the state is "approved".', {
    who: { ...str, description: 'Your agent name' }, what: { ...str, description: 'The action, e.g. "send the invoice to Oakline"' },
    rule: { ...str, description: 'Why it needs approval (default "ask first")' },
    wait_seconds: { type: 'integer', minimum: 0, maximum: 110, description: 'How long to wait for an answer (default 60)' },
  }, ['who', 'what'], { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }),
  tool('check_approval', 'Check approval', 'Look up an approval by its ref: pending, approved or denied. Optionally wait for it to change.', {
    ref: str, wait_seconds: { type: 'integer', minimum: 0, maximum: 110 },
  }, ['ref'], READ),
];

const RESOURCES = [
  { uri: 'mission-control://overview', name: 'overview', title: 'Mission Control overview', mimeType: 'application/json', description: 'Same as get_overview' },
  { uri: 'mission-control://state', name: 'state', title: 'Full dashboard state', mimeType: 'application/json', description: 'Everything the dashboard has saved' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
const fmt = t => (t ? new Date(t).toISOString() : null);

function createMcp({ readState, addEvents, dashboardSeenAt }) {
  const state = () => {
    const s = readState();
    if (!s) throw new ToolError('The dashboard has not saved anything yet. Open http://localhost:4000 once so it can create its data.');
    return s;
  };

  function overview() {
    const s = state();
    const mrr = (s.clients || []).filter(c => c.status === 'Active').reduce((a, c) => a + Number(c.v || 0), 0);
    const now = Date.now();
    return {
      owner: s.settings?.name, goal: { mrr: Number(s.settings?.goalMrr) || null, date: s.settings?.goalDate, currentMrr: mrr },
      priorities: (s.priorities || []).map(p => ({ text: p.text, tag: p.tag, done: !!p.done })),
      projects: Object.fromEntries(COLUMNS.map((c, i) => [c, (s.projects || []).filter(p => p.col === i).map(p => clean({ title: p.title, priority: p.priority, desc: p.desc }))])),
      agents: (s.agents || []).map(a => clean({ name: a.name, role: a.role, status: a.status, specialist: a.specialist || undefined, lastSeen: fmt(a.last) })),
      pendingApprovals: (s.approvals || []).filter(a => a.state === 'pending').map(a => clean({ ref: a.ref, who: a.who, what: a.what })),
      upcomingMeetings: (s.meetings || []).filter(m => m.start + m.dur * 60000 > now).sort((a, b) => a.start - b.start).slice(0, 5).map(m => ({ title: m.title, start: fmt(m.start), minutes: m.dur })),
      dashboard: dashboardStatus(),
    };
  }

  function dashboardStatus() {
    const t = dashboardSeenAt();
    return t && Date.now() - t < 20000 ? 'open' : 'closed (changes appear when it is next opened)';
  }

  function section({ section, limit = 50 }) {
    const s = state();
    const take = arr => (arr || []).slice(0, limit);
    switch (section) {
      case 'priorities': return take(s.priorities).map(p => ({ text: p.text, tag: p.tag, done: !!p.done }));
      case 'projects': return take(s.projects).map(p => clean({ title: p.title, desc: p.desc, priority: p.priority, column: COLUMNS[p.col], created: fmt(p.created) }));
      case 'agents': return take(s.agents).map(a => clean({ name: a.name, role: a.role, status: a.status, model: a.model, desc: a.desc, caps: a.caps, specialist: a.specialist, lastSeen: fmt(a.last), recentLog: (a.log || []).slice(0, 10).map(l => `${fmt(l.t)} ${l.x}`) }));
      case 'approvals': return take([...(s.approvals || [])].reverse()).map(a => clean({ ref: a.ref, who: a.who, what: a.what, rule: a.rule, state: a.state }));
      case 'meetings': return take([...(s.meetings || [])].sort((a, b) => a.start - b.start)).map(m => clean({ title: m.title, start: fmt(m.start), minutes: m.dur, type: m.type, attendees: m.attendees, agenda: (m.agenda || []).map(x => (x.done ? '[x] ' : '[ ] ') + x.text), notes: m.notes, actions: (m.actions || []).map(x => x.text || x) }));
      case 'intel': return take(s.intel).map(i => clean({ title: i.title, summary: i.summary, source: i.source, cat: i.cat, imp: i.imp, date: fmt(i.date) }));
      case 'notes': return take(s.notes).map(n => ({ saved: fmt(n.saved), body: n.body }));
      case 'decisions': return take(s.decisions).map(d => clean({ date: fmt(d.date), question: d.q, decision: d.d, who: d.who }));
      case 'activity': return take(s.activity).map(a => `${fmt(a.t)} ${a.who}: ${a.what}`);
      case 'clients': return take(s.clients).map(c => clean({ name: c.name, mrr: c.v, status: c.status, since: c.since }));
      case 'timeline': return take(s.phases);
      case 'tasks': return take(s.tasks).map(t => clean({ name: t.name, who: t.who, state: t.state, note: t.note }));
      case 'queue': return take(s.queue).map(q => ({ to: q.to, text: q.text }));
      default: throw new ToolError('Unknown section: ' + section);
    }
  }

  function myTasks({ agent }) {
    const s = state();
    const x = String(agent).toLowerCase();
    const a = (s.agents || []).find(g => g.name.toLowerCase() === x || g.id === x);
    if (!a) return { agent, known: false, tasks: [], note: 'No coworker with that name yet. update_agent adds one.' };
    return {
      agent: a.name, status: a.status,
      tasks: (a.log || []).filter(l => String(l.x).startsWith(TASK_PREFIX)).slice(0, 20).map(l => ({ received: fmt(l.t), task: l.x.slice(TASK_PREFIX.length) })),
      followUps: (s.queue || []).filter(q => String(q.to).toLowerCase() === a.name.toLowerCase()).map(q => q.text),
    };
  }

  async function waitApproval(ref, waitSeconds) {
    const until = Date.now() + Math.min(110, Math.max(0, waitSeconds)) * 1000;
    for (;;) {
      const s = readState();
      const a = s && (s.approvals || []).find(x => x.ref === ref);
      const st = a ? a.state : 'pending';
      if (st !== 'pending' || Date.now() >= until) {
        const out = { ref, state: st };
        if (st === 'pending') out.note = dashboardStatus() === 'open'
          ? 'Still waiting for the user. Call check_approval with this ref to wait again. Do not proceed yet.'
          : 'The dashboard is not open, so the user has not seen this yet. Call check_approval later. Do not proceed yet.';
        if (st === 'denied') out.note = 'The user denied this. Do not do it.';
        return out;
      }
      await sleep(1500);
    }
  }

  const ok = (msg, extra = {}) => ({ ok: true, message: msg, dashboard: dashboardStatus(), ...extra });

  const handlers = {
    get_overview: overview,
    get_section: section,
    get_my_tasks: myTasks,
    log_activity: a => (addEvents([{ type: 'activity', who: a.who, what: a.what }]), ok('Added to the activity feed.')),
    update_agent: a => (addEvents([clean({ type: 'agent', ...a })]), ok(`Updated ${a.agent}.`)),
    add_priority: a => (addEvents([clean({ type: 'priority', text: a.text, tag: a.tag })]), ok('Priority added.')),
    add_project: a => (addEvents([clean({ type: 'project', title: a.title, desc: a.desc, priority: a.priority, col: COLUMNS.indexOf(a.column || 'Backlog'), who: a.who })]), ok(`Project added to ${a.column || 'Backlog'}.`)),
    add_note: a => (addEvents([{ type: 'note', body: a.body }]), ok('Note saved.')),
    add_intel: a => (addEvents([clean({ type: 'intel', ...a })]), ok('Intel added.')),
    add_meeting: a => {
      if (isNaN(new Date(a.start).getTime())) throw new ToolError('start must be an ISO 8601 date-time, e.g. 2026-11-10T15:00:00-05:00');
      addEvents([clean({ type: 'meeting', ...a })]); return ok('Meeting added.');
    },
    log_decision: a => (addEvents([clean({ type: 'decision', q: a.question, d: a.decision, who: a.who })]), ok('Decision logged.')),
    log_action: a => (addEvents([clean({ type: 'action', who: a.who, what: a.what, outcome: a.outcome })]), ok('Action logged.')),
    request_approval: async a => {
      const ref = 'mcp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      addEvents([clean({ type: 'approval', who: a.who, what: a.what, rule: a.rule, ref })]);
      return waitApproval(ref, a.wait_seconds ?? 60);
    },
    check_approval: a => waitApproval(a.ref, a.wait_seconds ?? 0),
  };

  function checkArgs(t, args) {
    const { properties, required } = t.inputSchema;
    for (const k of required) if (args[k] === undefined || args[k] === null || args[k] === '') throw new ToolError(`Missing required argument: ${k}`);
    for (const [k, v] of Object.entries(args)) {
      const p = properties[k];
      if (!p) throw new ToolError(`Unknown argument: ${k}`);
      if (p.enum && !p.enum.includes(v)) throw new ToolError(`${k} must be one of: ${p.enum.join(', ')}`);
      const type = Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
      if (p.type && p.type !== type && !(p.type === 'number' && type === 'integer')) throw new ToolError(`${k} must be ${p.type === 'array' ? 'an array' : 'a ' + p.type}`);
    }
  }

  async function callTool(params) {
    const t = TOOLS.find(x => x.name === params?.name);
    if (!t) throw Object.assign(new Error('Unknown tool: ' + params?.name), { rpc: -32602 });
    const args = params.arguments || {};
    try {
      checkArgs(t, args);
      const result = await handlers[t.name](args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result && typeof result === 'object' && !Array.isArray(result) ? result : { items: result } };
    } catch (err) {
      if (!(err instanceof ToolError)) console.warn('MCP tool error:', err);
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  }

  function readResource(params) {
    const uri = params?.uri;
    let data;
    if (uri === 'mission-control://overview') data = overview();
    else if (uri === 'mission-control://state') data = state();
    else throw Object.assign(new Error('Unknown resource: ' + uri), { rpc: -32002 });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  async function dispatch(msg) {
    const { method, params } = msg;
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: SERVER_INFO, instructions: INSTRUCTIONS,
        };
      }
      case 'ping': return {};
      case 'tools/list': return { tools: TOOLS };
      case 'tools/call': return callTool(params);
      case 'resources/list': return { resources: RESOURCES };
      case 'resources/templates/list': return { resourceTemplates: [] };
      case 'resources/read': return readResource(params);
      case 'prompts/list': return { prompts: [] };
      default: throw Object.assign(new Error('Method not found: ' + method), { rpc: -32601 });
    }
  }

  // Handles one JSON-RPC message or a batch. Returns the reply, or null when nothing should be sent back.
  async function handle(body) {
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(handleOne))).filter(Boolean);
      return out.length ? out : null;
    }
    return handleOne(body);
  }

  async function handleOne(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (msg && msg.jsonrpc === '2.0' && ('result' in msg || 'error' in msg)) return null; // a client response; we never ask for any
      return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    }
    const isNotification = msg.id === undefined || msg.id === null;
    try {
      const result = await dispatch(msg);
      return isNotification ? null : { jsonrpc: '2.0', id: msg.id, result };
    } catch (err) {
      if (isNotification) return null;
      return { jsonrpc: '2.0', id: msg.id, error: { code: err.rpc || -32603, message: err.message } };
    }
  }

  return { handle, tools: TOOLS };
}

class ToolError extends Error {}

module.exports = { createMcp, PROTOCOLS };
