# Bot Agents HQ — Mission Control

A personal command center for running a small team of AI agents. Run it on your own computer with one command. It saves to a folder on your machine and gives your agents an address to send updates to. No build step and nothing required to install (using Claude as the AI runner needs one optional `npm install`).

## Screens

| Tab | What it does |
|---|---|
| **Dashboard** | Greeting and live clock, goal / projects / tasks / days-to-goal metrics, editable top priorities, activity feed, agent status, today's meetings, daily brief |
| **Projects** | Kanban board (Backlog → In Progress → Done) — add, edit, move, delete |
| **Timeline** | Phases with date ranges and milestones; the current phase glows; overall progress |
| **Command Center** | Agent cards with status, details, capabilities and activity log · send tasks · live browser view with Pause / Take control · visible plan · background tasks run by the AI runner (pause/resume/stop/retry) · follow-up queue · executive decisions log |
| **Meetings** | Today's meetings with live countdowns, expandable prep cards (agenda checklist, notes that save as you type, action items), upcoming list, automatic archive |
| **Revenue** | MRR from active clients, goal ring, run rate, monthly growth needed, 6-month chart with goal line, client list with status and filters, "Close month" to save history |
| **YouTube** | Subscriber level with XP bar and milestones, 5-stage idea pipeline, monthly content calendar |
| **Intel** | Daily brief (top 3), feed with category and importance filters, add form |
| **Notes** | Multiple notes, autosave, character/word count, Write / Preview (`#` headings, `-` bullets) |
| **Stack** | The coworker stack (Hermes, OpenBot, OpenDots, OpenMuse, Cua Driver) with your specialist coworkers listed under OpenDots, how an action flows, approval cards and the action log |

Also: **⌘K / Ctrl+K** searches everything, and **Settings** (gear icon) sets your name, accent color, revenue goal and goal date.

## Run it on your computer (recommended)

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else to install. To use Claude as the AI runner, also run `npm install` once.

1. Download the repo: **Code → Download ZIP** and unzip it, or `git clone https://github.com/Gamface/Bot-Agents-HQ.git`
2. Start it:
   - **Mac / Linux:** open a terminal in the folder and run `./start.sh`
   - **Windows:** double-click `start.bat`
   - **Or anywhere:** `npm start` (same as `node server.js`)
3. Your browser opens **http://localhost:4000**. Keep the terminal window open while you use it; press **Ctrl+C** to stop.

The top bar shows **Saved to this computer** when it's connected.

Options: `PORT=5000 ./start.sh` uses another port. `HOST=0.0.0.0 node server.js` lets other devices on your Wi-Fi open it at `http://<your-computer's-IP>:4000`. There's no login, so only do that on a network you trust.

## Your data

- When running locally, everything is saved in the **`data/` folder** next to `server.js`: `data/state.json`, plus hourly snapshots in `data/backups/` (the last 3 days are kept). The folder is ignored by git, so it never gets pushed.
- Any browser on this computer that opens http://localhost:4000 sees the same data.
- On first run it starts with **sample data**. Open Settings (gear icon) → **Start empty** to clear it (your settings are kept), or **Reload sample data** to bring it back.
- Settings → **Export backup** / **Import backup** moves data between computers, or between the local server and a hosted copy.
- If the server stops, the page keeps saving in the browser and the top bar turns amber. Restart the server and it picks up again.

You can also just double-click `index.html` without the server. It works the same, but data stays in that browser only and agents can't send updates.

## Connecting real agents

While the server is running, any agent or script can send updates to **`POST http://localhost:4000/api/events`**. The open dashboard picks them up within about 5 seconds. Try `sh examples/send-events.sh` to see each kind.

```sh
curl -X POST http://localhost:4000/api/events -H 'Content-Type: application/json' \
  -d '{"type":"activity","who":"Scout","what":"found 12 new dental clinics"}'
```

| `type` | Fields | Shows up in |
|---|---|---|
| `activity` | `who`, `what` | Dashboard activity feed |
| `agent` | `agent` (name), optional `status` (Online/Busy/Offline), `log`, `role`, `model`, `caps`, `specialist` (true/false), `session` {`url`,`title`,`target`,`steps`,`cur`} | Command Center: an unknown name adds a new coworker |
| `intel` | `title`, `summary`, `source`, `cat`, `imp` (hot/notable/ref) | Intel feed and daily brief |
| `approval` | `who`, `what`, `rule`, `ref` | Approval card on the Stack screen |
| `action` | `who`, `outcome` (ALLOW/ASK/REFUSE), `what` | Stack action log |
| `priority` | `text`, `tag` | Dashboard priorities |
| `meeting` | `title`, `start` (ISO date), `dur`, `mtype`, `attendees`, `agenda` [ ] | Meetings |
| `note` | `body` | Notes |
| `project` | `title`, `desc`, `priority` (HIGH/MEDIUM/LOW), `col` (0 Backlog, 1 In Progress, 2 Done) | Projects board |
| `decision` | `q` (question), `d` (decision), `who` | Executive decisions log |
| `task` | `ref`, `name`, `who`, `state` (queued/running/paused/waiting/done/stopped/failed), `note` | Background tasks: a new `ref` adds one, a known `ref` updates it |

You can send one event or an array of them. To find out whether you approved something, an agent reads `GET /api/state` and looks for the matching `approvals[].ref`, whose `state` is `pending`, `approved` or `denied`.

The live browser view shows whatever an agent reports in `session`. Streaming a real browser picture needs OpenMuse.

### Connect Claude and other AI tools (MCP)

Mission Control is also an **MCP server**, so Claude Code, Claude Desktop, Cursor and other MCP clients can use it directly, without curl. Your agents can then report their status, save results, plan work, and ask you before doing anything sensitive. Keep `server.js` running.

**Claude Code** (or any client that supports Streamable HTTP):

```sh
claude mcp add --transport http mission-control http://localhost:4000/mcp
```

**Claude Desktop, Cursor, and other clients that start a local command** use the included bridge. Add this to the client's MCP config (for Claude Desktop: Settings → Developer → Edit Config), with the full path to your copy:

```json
{
  "mcpServers": {
    "mission-control": {
      "command": "node",
      "args": ["C:/path/to/Bot-Agents-HQ/mcp-stdio.js"]
    }
  }
}
```

Set `"env": { "MC_URL": "http://localhost:5000" }` if you changed the port.

| Tool | What it does |
|---|---|
| `get_overview` | Goal, revenue progress, priorities, projects by column, agents, pending approvals, upcoming meetings |
| `get_section` | Full contents of one part: priorities, projects, agents, approvals, meetings, intel, notes, decisions, activity, clients, timeline, tasks, queue |
| `get_my_tasks` | Tasks you sent an agent from **Command Center → Send task**, plus its follow-up queue |
| `update_agent` | Create or update a coworker: status, log line, role, live browser view |
| `log_activity` · `log_action` · `log_decision` | Activity feed · Stack action log · decisions log |
| `add_priority` · `add_project` · `add_note` · `add_intel` · `add_meeting` | Add to those screens |
| `request_approval` | Puts an approval card on the dashboard and **waits for you** to click Approve or Deny (up to 110 seconds), then tells the agent the answer |
| `check_approval` | Look up or keep waiting on an approval by its `ref` |

Changes made through MCP go through the same queue as `/api/events`, so they appear in the open dashboard within about 5 seconds. If the dashboard isn't open, they're applied the next time you open it, and tool results say so. Try asking Claude: *"Check Mission Control, then add yourself as a coworker and log what you're working on."*

## The AI runner: tasks that actually get done

Turn it on in **Settings → AI runner**. From then on, a task you send from **Command Center → Send task** is worked on by a model. The coworker shows up as Busy, the live view shows each step, and the answer is saved to **Notes**.

Pick the model provider:

- **Claude (Anthropic API).** One-time setup: run `npm install` in the Mission Control folder. That installs the official Anthropic SDK, the only dependency, and it's optional. Then start Mission Control with your key: `ANTHROPIC_API_KEY=sk-ant-... ./start.sh` (Windows: `set ANTHROPIC_API_KEY=sk-ant-...` then `start.bat`), or sign in once with `ant auth login`. The default model is `claude-opus-5-5`; type another model name in Settings to change it. Your key is never saved in the dashboard, and usage is billed to your Anthropic account.
- **Local model (Ollama, Podman AI Lab, LM Studio…).** Any server with an OpenAI-style `/v1/chat/completions` API. The default address is Ollama's, `http://localhost:11434/v1`. For a Podman AI Lab model service, use the port it shows. Pick a model that supports tool calling (for example `llama3.2` or `qwen2.5`). Models without it still answer, just without tools. If the server wants a key, set `LLM_API_KEY`. To run Ollama with Podman: `podman run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama docker.io/ollama/ollama`, then `podman exec ollama ollama pull llama3.2`.

### Rules and approvals

Every tool the runner uses has a rule, which you set on the **Stack** screen:

| Tool | Default | What it does |
|---|---|---|
| Read a web page | ALLOW | Fetches a public web page. Addresses on this computer or your private network are always blocked. |
| Save a note · Add intel | ALLOW | Adds to Notes or the Intel feed |
| Add a priority · Add a project · Log a decision | ASK | Changes your plan |
| Send a message | ASK | Posts `{"text": …}` to your webhook (Slack, n8n, Zapier…). Only available when `MC_WEBHOOK_URL` is set. |

- **ALLOW** runs right away and is logged in the action log.
- **ASK** puts an approval card on the Stack screen, and **the coworker waits** until you click Approve or Deny. Deny means it continues without that step. After 30 minutes with no answer, it's treated as denied.
- **REFUSE** blocks the tool, and the coworker is told not to try it.

In **Background tasks** on the Command Center you can **Pause** a task (it stops before its next step), **Resume** it, **Stop** it (■), or **Retry** a failed one. Pause on the live view pauses that coworker's task too. Each coworker works on one task at a time; others queue. If Mission Control restarts mid-task, the task is marked Failed so you can retry it.

### Other ways to host

- **GitHub Pages:** repo Settings → Pages → `main` / root. It serves `index.html` only, so data stays in each browser and the agent API isn't available.
- **Any always-on machine** (home server, Raspberry Pi, VPS): copy the folder and run `node server.js` there. If it's reachable from the internet, put it behind a login (a reverse proxy with auth, Tailscale, or similar), because the server has no accounts of its own.

## Customize

The whole dashboard is `index.html`, and the local server is `server.js` (about 130 lines, Node built-ins only):
- Colors and spacing are CSS variables at the top of the `<style>` block.
- Sample data is in the `seed()` function.
- Each screen is a function in `VIEWS` (for example `VIEWS.revenue`).
