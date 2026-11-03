# Bot Agents HQ — Mission Control

A personal command center for running a small team of AI agents. Run it on your own computer with one command. It saves to a folder on your machine and gives your agents an address to send updates to. No build step, no dependencies.

## Screens

| Tab | What it does |
|---|---|
| **Dashboard** | Greeting and live clock, goal / projects / tasks / days-to-goal metrics, editable top priorities, activity feed, agent status, today's meetings, daily brief |
| **Projects** | Kanban board (Backlog → In Progress → Done) — add, edit, move, delete |
| **Timeline** | Phases with date ranges and milestones; the current phase glows; overall progress |
| **Command Center** | Agent cards with status, details, capabilities and activity log · send tasks · live browser view with Pause / Take control · visible plan · background tasks (pause/resume/retry) · follow-up queue · executive decisions log |
| **Meetings** | Today's meetings with live countdowns, expandable prep cards (agenda checklist, notes that save as you type, action items), upcoming list, automatic archive |
| **Revenue** | MRR from active clients, goal ring, run rate, monthly growth needed, 6-month chart with goal line, client list with status and filters, "Close month" to save history |
| **YouTube** | Subscriber level with XP bar and milestones, 5-stage idea pipeline, monthly content calendar |
| **Intel** | Daily brief (top 3), feed with category and importance filters, add form |
| **Notes** | Multiple notes, autosave, character/word count, Write / Preview (`#` headings, `-` bullets) |
| **Stack** | The coworker stack (Hermes, OpenBot, OpenDots, OpenMuse, Cua Driver), how an action flows, approval cards and the action log |

Also: **⌘K / Ctrl+K** searches everything, and **Settings** (gear icon) sets your name, accent color, revenue goal and goal date.

## Run it on your computer (recommended)

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else to install.

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
| `agent` | `agent` (name), optional `status` (Online/Busy/Offline), `log`, `role`, `model`, `caps`, `session` {`url`,`title`,`target`,`steps`,`cur`} | Command Center: an unknown name adds a new coworker |
| `intel` | `title`, `summary`, `source`, `cat`, `imp` (hot/notable/ref) | Intel feed and daily brief |
| `approval` | `who`, `what`, `rule`, `ref` | Approval card on the Stack screen |
| `action` | `who`, `outcome` (ALLOW/ASK/REFUSE), `what` | Stack action log |
| `priority` | `text`, `tag` | Dashboard priorities |
| `meeting` | `title`, `start` (ISO date), `dur`, `mtype`, `attendees`, `agenda` [ ] | Meetings |
| `note` | `body` | Notes |

You can send one event or an array of them. To find out whether you approved something, an agent reads `GET /api/state` and looks for the matching `approvals[].ref`, whose `state` is `pending`, `approved` or `denied`.

The live browser view shows whatever an agent reports in `session`. Streaming a real browser picture needs OpenMuse.

### Other ways to host

- **GitHub Pages:** repo Settings → Pages → `main` / root. It serves `index.html` only, so data stays in each browser and the agent API isn't available.
- **Any always-on machine** (home server, Raspberry Pi, VPS): copy the folder and run `node server.js` there. If it's reachable from the internet, put it behind a login (a reverse proxy with auth, Tailscale, or similar), because the server has no accounts of its own.

## Customize

The whole dashboard is `index.html`, and the local server is `server.js` (about 130 lines, Node built-ins only):
- Colors and spacing are CSS variables at the top of the `<style>` block.
- Sample data is in the `seed()` function.
- Each screen is a function in `VIEWS` (for example `VIEWS.revenue`).
