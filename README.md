# Bot Agents HQ — Mission Control

A personal command center for running a small team of AI agents, in one file. Open `index.html` in a browser and it works — no install, no build, no server.

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

## Your data

- Everything is saved in your browser's local storage, on this device only.
- It starts with **sample data** so you can see how it works. Open Settings → **Start empty** to clear it (your settings are kept), or **Reload sample data** to bring it back.
- Use Settings → **Export backup** regularly. **Import backup** restores a file on any device.
- Clearing your browser's site data deletes it — export first.

## Run it

**Locally:** download `index.html` and double-click it.

**GitHub Pages (free):** repo **Settings → Pages → Deploy from a branch → `main` / root → Save**. Your dashboard will be at `https://<user>.github.io/Bot-Agents-HQ/`.

**Vercel / Netlify:** import the repo — no build command, output directory is the root.

> Data is stored per browser and per address, so the local file and the hosted site keep separate data. Move it with Export / Import.

## Connecting real agents

The agent screens are wired to local data today. The live browser view is a preview until you connect OpenMuse, and agent statuses, logs and tasks change only when you edit them. To feed in real activity, have your agent harness (OpenClaw, Hermes, Claude Code…) write to the same JSON shape that **Export backup** produces, then import it, or extend `index.html` to poll a small local server.

## Customize

Everything lives in `index.html`:
- Colors and spacing are CSS variables at the top of the `<style>` block.
- Sample data is in the `seed()` function.
- Each screen is a function in `VIEWS` (for example `VIEWS.revenue`).
