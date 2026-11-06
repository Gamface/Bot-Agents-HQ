#!/usr/bin/env node
// A Mission Control agent backed by a local LLM (Ollama, Podman AI Lab, LM Studio,
// or anything with an OpenAI-compatible /v1/chat/completions). No dependencies, Node 18+.
//
//   node examples/llm-agent.js                 → watch: answers tasks you send this agent
//                                                from Command Center → "Send task"
//   node examples/llm-agent.js "your task"     → run one task and exit
//
// Settings (environment variables):
//   LLM_URL     default http://localhost:11434/v1   (Ollama; Podman AI Lab: http://localhost:<port>/v1)
//   LLM_MODEL   default llama3.2                     (any model the server has; see GET $LLM_URL/models)
//   LLM_API_KEY optional, for servers that want one
//   MC_URL      default http://localhost:4000        (Mission Control)
//   AGENT_NAME  default Scout                        (an existing coworker, or a new one is added)
//   AGENT_ROLE  default "Local LLM agent"
//   SYSTEM      optional system prompt
//   POLL_MS     default 3000

'use strict';
const LLM_URL = (process.env.LLM_URL || 'http://localhost:11434/v1').replace(/\/+$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'llama3.2';
const MC_URL = (process.env.MC_URL || 'http://localhost:4000').replace(/\/+$/, '');
const NAME = process.env.AGENT_NAME || 'Scout';
const ROLE = process.env.AGENT_ROLE || 'Local LLM agent';
const POLL_MS = Number(process.env.POLL_MS) || 3000;
const SYSTEM = process.env.SYSTEM ||
  `You are ${NAME}, an AI coworker on a small team. Do the task you are given. ` +
  'Be concise and practical. Use short paragraphs or "-" bullet lists.';

const TASK_PREFIX = 'Task received: ';

async function post(events) {
  const r = await fetch(MC_URL + '/api/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(events),
  });
  if (!r.ok) throw new Error(`Mission Control said ${r.status}: ${await r.text()}`);
}

async function ask(task) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.LLM_API_KEY) headers.Authorization = 'Bearer ' + process.env.LLM_API_KEY;
  let r;
  try {
    r = await fetch(LLM_URL + '/chat/completions', {
      method: 'POST', headers,
      body: JSON.stringify({
        model: LLM_MODEL, stream: false,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: task }],
      }),
    });
  } catch {
    throw new Error(`can’t reach the LLM server at ${LLM_URL}. Is Ollama (or your model service) running?`);
  }
  if (!r.ok) throw new Error(`LLM server said ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!text) throw new Error('LLM server sent no answer');
  return text.trim();
}

const short = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function runTask(task) {
  console.log(`→ ${NAME}: ${task}`);
  const steps = ['Read the task', `Ask ${LLM_MODEL}`, 'Post the answer'];
  await post({ type: 'agent', agent: NAME, status: 'Busy', log: `Working on: ${short(task)}`,
    session: { url: LLM_URL, title: 'Working on: ' + short(task), target: `asking ${LLM_MODEL}`, steps, cur: 1 } });
  const started = Date.now();
  try {
    const answer = await ask(task);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    await post([
      { type: 'note', body: `# ${NAME}: ${short(task, 60)}\n\n${answer}\n\n- Task: ${task}\n- Model: ${LLM_MODEL} (${secs}s)` },
      { type: 'activity', who: NAME, what: `finished “${short(task, 50)}” (answer in Notes)` },
      { type: 'agent', agent: NAME, status: 'Online', log: `Done in ${secs}s: ${short(task)} (answer in Notes)`,
        session: { url: LLM_URL, title: 'Done: ' + short(task), target: 'idle', steps, cur: 2 } },
    ]);
    console.log(`✓ done in ${secs}s, answer saved to Notes\n`);
  } catch (err) {
    console.error('✗ ' + err.message + '\n');
    await post([
      { type: 'agent', agent: NAME, status: 'Online', log: `Failed: ${short(err.message, 90)}` },
      { type: 'activity', who: NAME, what: `couldn’t finish “${short(task, 40)}”: ${short(err.message, 60)}` },
    ]).catch(() => {});
  }
}

// Tasks typed into "Send task" are saved as "Task received: …" lines in the agent's log.
async function newTasks(since, seen) {
  const r = await fetch(MC_URL + '/api/state');
  if (!r.ok) throw new Error('Mission Control said ' + r.status);
  const s = await r.json();
  const agent = (s.agents || []).find(a => (a.name || '').toLowerCase() === NAME.toLowerCase());
  if (!agent) return [];
  return (agent.log || [])
    .filter(l => l.t > since && typeof l.x === 'string' && l.x.startsWith(TASK_PREFIX) && !seen.has(l.t + l.x))
    .sort((a, b) => a.t - b.t)
    .map(l => { seen.add(l.t + l.x); return l.x.slice(TASK_PREFIX.length).trim(); })
    .filter(Boolean);
}

async function main() {
  const oneShot = process.argv.slice(2).join(' ').trim();
  await post({ type: 'agent', agent: NAME, role: ROLE, model: LLM_MODEL, status: 'Online',
    caps: ['Answers tasks', 'Local LLM'], log: `Connected to ${LLM_MODEL} at ${LLM_URL}` });

  if (oneShot) return runTask(oneShot);

  console.log(`${NAME} is watching ${MC_URL}. Send it a task from Command Center → ${NAME} → "Send task".`);
  console.log(`Model: ${LLM_MODEL} at ${LLM_URL}. Press Ctrl+C to stop.\n`);
  const since = Date.now() - 5000; // ignore older tasks
  const seen = new Set();
  let warned = false;
  for (;;) {
    try {
      for (const task of await newTasks(since, seen)) await runTask(task);
      warned = false;
    } catch (err) {
      if (!warned) console.error('Waiting for Mission Control: ' + err.message);
      warned = true;
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

process.on('SIGINT', async () => {
  await post({ type: 'agent', agent: NAME, status: 'Offline', log: 'Stopped' }).catch(() => {});
  process.exit(0);
});

main().catch(err => { console.error(err.message); process.exit(1); });
