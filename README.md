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

Also: **⌘K / Ctrl+K** searches everything, and **Settings** (gear icon) sets your name, accent color, goals, the AI runner, data sources, phone alerts and access from other devices.

## Run it on your computer (recommended)

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else to install. To use Claude as the AI runner, also run `npm install` once.

1. Download the repo: **Code → Download ZIP** and unzip it, or `git clone https://github.com/Gamface/Bot-Agents-HQ.git`
2. Start it:
   - **Mac / Linux:** open a terminal in the folder and run `./start.sh`
   - **Windows:** double-click `start.bat`
   - **Or anywhere:** `npm start` (same as `node server.js`)
3. Your browser opens **http://localhost:4000**. Keep the terminal window open while you use it; press **Ctrl+C** to stop.

The top bar shows **Saved to this computer** when it's connected.

Options: `PORT=5000 ./start.sh` uses another port. To use it from your phone, see [Use it on your phone](#use-it-on-your-phone).

## Your data

- When running locally, everything is saved in the **`data/` folder** next to `server.js`: `data/state.json`, plus hourly snapshots in `data/backups/` (the last 3 days are kept). The folder is ignored by git, so it never gets pushed.
- Every browser that opens it sees the same data, live: a change on one device shows up on the others right away.
- Keys and secret addresses for data sources are kept in `data/sources.json`, and the access token in `data/auth.json`. Neither is part of the dashboard data, backups or exports.
- On first run it starts with **sample data**. Open Settings (gear icon) → **Start empty** to clear it (your settings are kept), or **Reload sample data** to bring it back.
- Settings → **Export backup** / **Import backup** moves data between computers, or between the local server and a hosted copy.
- If the server stops, the page keeps saving in the browser and the top bar turns amber. Restart the server and it picks up again.

You can also just double-click `index.html` without the server. It works the same, but data stays in that browser only and agents can't send updates.

## Connecting real agents

While the server is running, any agent or script can send updates to **`POST http://localhost:4000/api/events`**. The open dashboard shows them right away. Try `sh examples/send-events.sh` to see each kind.

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
| `client` | `ext` (your id for it), `name`, `v` (monthly $), `status` (Active/Pending/Churned), `since` | Revenue clients, updated by `ext` |
| `youtube` | `subs` | YouTube subscriber count |
| `brief` | `date` (YYYY-MM-DD), `items` [{`title`, `summary`, `imp`}] | Daily brief for that day |

`meeting` also takes an `ext` id: sending the same `ext` again updates that meeting instead of adding another, and `{"ext": …, "cancelled": true}` removes it.

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

Changes made through MCP go through the same queue as `/api/events`, so they appear in the open dashboard right away. If the dashboard isn't open, they're applied the next time you open it, and tool results say so. Try asking Claude: *"Check Mission Control, then add yourself as a coworker and log what you're working on."*

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

## Data sources: screens that fill themselves

Set these up in **Settings → Data sources**. Each one syncs on its own, and **Sync now** runs it right away. The line under each source shows when it last synced and what it found, or what went wrong.

| Source | What you need | Fills | How often |
|---|---|---|---|
| **Google Calendar** (or any calendar with an iCal link) | Google Calendar → Settings → your calendar → **Secret address in iCal format** | Meetings for the next 14 days. Repeating meetings, moved instances and cancellations are handled; your prep notes and agenda are kept. | 15 min |
| **Stripe** | A **restricted key** with Read access to Subscriptions and Customers | Revenue clients and MRR. Yearly and weekly plans are converted to monthly. | 30 min |
| **YouTube** | A YouTube Data API v3 key and your @handle or channel ID | Subscriber count | hourly |
| **RSS / Atom feeds** | Feed addresses, one per line | Intel. When the AI runner is on, its model ranks each new item hot / notable / reference, picks a category and says why it matters to you, based on your priorities and projects. | 30 min |
| **Daily brief** | The AI runner turned on | Each morning at the hour you pick, the model writes your top 3 for the day from meetings, priorities, approvals and intel. It replaces the automatic brief on the Dashboard and Intel screens for that day. | daily |

No Stripe? On the **Revenue** screen, **Import CSV** takes a file with a name column and a monthly value column (status and start date are optional; "trial" counts as Pending and "cancelled" as Churned). Clients with the same name are updated.

## Use it on your phone

**1. Let your phone reach it, with a token.** Every device other than this computer has to sign in with an access token. Requests from this computer never need one.

- **Same Wi-Fi:** start with `HOST=0.0.0.0 ./start.sh` (Windows: `set HOST=0.0.0.0` then `start.bat`). The first time, a token is created and the terminal prints a sign-in link for your phone. The link is also in **Settings → Other devices**, with **Copy** buttons.
- **From anywhere, with https (recommended):** keep it on this computer and use [Tailscale](https://tailscale.com): `tailscale serve 4000`, then open the https address it shows on your phone. Create a token first in **Settings → Other devices** (traffic through a tunnel always needs one).
- **Make a new token** signs every other device out. Scripts and agents on other machines send `Authorization: Bearer <token>`.

**2. Install it.** Open it in your phone's browser and choose **Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: ⋮ → Install app). It opens full-screen like an app, and still opens with your last data when you're offline.

**3. Turn on alerts.** In **Settings → Phone alerts**, tap **Turn on for this device**, then **Send a test alert**. You'll get a notification whenever an agent is waiting for your approval, even when the app is closed. Tapping it opens the approval. On iPhone this works from the Home Screen app (iOS 16.4 or newer).

Installing and alerts need a secure address: https (such as the Tailscale one) or http://localhost. A plain `http://192.168…` address works for viewing and editing, but phones won't install it or allow alerts.

### Other ways to host

- **GitHub Pages:** repo Settings → Pages → `main` / root. It serves `index.html` only, so data stays in each browser and the agent API isn't available.
- **Any always-on machine** (home server, Raspberry Pi, VPS): copy the folder and run `node server.js` there. It needs the access token from any other device. For access over the internet, use https (Tailscale, or a reverse proxy with TLS) so the token isn't sent in the clear.

## Customize

The whole dashboard is `index.html`, and the local server is `server.js` (about 130 lines, Node built-ins only):
- Colors and spacing are CSS variables at the top of the `<style>` block.
- Sample data is in the `seed()` function.
- Each screen is a function in `VIEWS` (for example `VIEWS.revenue`).
