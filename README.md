# Claude Multiple Dashboard

[한국어](README.ko.md) | **English**

A real-time web dashboard for monitoring **multiple Claude Code sessions** in parallel.

---

## The Problem

When running 3-5 Claude Code sessions simultaneously, every terminal looks the same — same header, same prompt. You can't tell which session is which without switching into each one.

![All sessions look identical](docs/screenshots/problem-no-labels.png)

## The Solution

This dashboard puts all sessions on one screen with real-time status, idle time tracking, session colors, and full activity history.

![Dashboard with session colors](docs/screenshots/session-colors.png)

Name your sessions with `/session-setting` and the colors show up in both the terminal statusline and the dashboard:

```bash
/session-setting name:Dashboard color:red
/session-setting name:CloudPocket color:blue
```

![Terminal sessions with names](docs/screenshots/terminal-sessions.png)

---

## Features

| Feature | Description |
|---------|-------------|
| **Real-time Monitoring** | 🟢 Active / 🟡 Waiting Input / 🟠 Waiting Permission / ⚪ Ended / 🔴 Disconnected |
| **Session Colors** | Color-coded session cards — name and color your sessions for instant recognition |
| **Idle Time Counter** | Live `⏱ idle MM:SS` from the moment a session starts waiting |
| **Model & Context** | Model name, context usage (ctx: N%), elapsed time on each card |
| **Browser Terminal** | Run Claude Code directly in the dashboard via xterm.js + node-pty |
| **Terminal Grid** | View all PTY sessions simultaneously in a responsive grid |
| **Stats Dashboard** | Event/prompt/response counts + top 10 tool usage chart + hourly activity heatmap |
| **Project Grouping** | Sessions in the same directory are automatically grouped |
| **Session Presets** | Save name/color per project directory — auto-applied on next session |
| **Prompt & Response** | View user prompts and Claude's last response directly on the dashboard |
| **Dark/Light Theme** | Auto-detects system preference + manual toggle |
| **Keyboard Shortcuts** | j/k navigate, / search, Enter fullview, ? help |
| **Data Export** | History as JSON/CSV + session transcript as Markdown |

### Dark Mode + Detail Panel

![Dark Mode with Detail](docs/screenshots/dark-detail.png)

### Keyboard Shortcuts

<img src="docs/screenshots/shortcuts.png" width="300" alt="Keyboard Shortcuts">

---

## Installation

### Prerequisites

- **Node.js** v20+
- **jq** (macOS: `brew install jq`)
- **Claude Code** CLI

### npm Global Install (Recommended)

```bash
npm install -g claude-multiple-dashboard
```

### Setup & Run

```bash
# 1. Initialize (register hooks + create data directory)
claude-dash init

# 2. Start server + open browser
claude-dash open

# 3. Use Claude Code as usual — sessions are monitored automatically
```

### Run from Source

```bash
git clone https://github.com/hey00507/claude-multiple-dashboard.git
cd claude-multiple-dashboard
npm install
npm run dash init
npm run dash open
```

---

## Update

```bash
# npm global install
npm update -g claude-multiple-dashboard

# From source
git pull && npm install && npm run build
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `claude-dash init` | Register hooks and initialize data directory |
| `claude-dash start [-p port]` | Start dashboard server (default: 7420) |
| `claude-dash stop` | Stop dashboard server |
| `claude-dash status` | Check session status in terminal |
| `claude-dash open [-p port]` | Start server + open browser |
| `claude-dash clean` | Clean old logs (`--days N` or `--before YYYY-MM-DD`) |

---

## Session Presets & Colors

Name and color your sessions for quick identification. Colors show up in both the terminal statusline and the dashboard.

### Setup

Copy the skill to your Claude Code commands directory:

```bash
cp commands/session-setting.md ~/.claude/commands/
```

### Usage

```bash
/session-setting name:Dashboard color:red           # Current session only
/session-setting name:Dashboard color:red --save     # + Save as default for this project
/session-setting --list                              # List saved defaults
/session-setting --remove                            # Remove default for current directory
```

Supported colors: `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`

**Project defaults** are saved in `~/.claude-dashboard/config.json` and automatically applied when a new session starts in the same directory. Generic paths like `~/` are excluded from matching.

---

## Architecture

```
Claude Code Sessions (A, B, C, ...)
    │  hook event (JSON stdin)
    ▼
dashboard-hook.sh (non-blocking, 1s timeout)
    │  curl POST
    ▼
Dashboard Server (Fastify 5)
    ├── REST API (session/log CRUD + stats)
    ├── SSE Stream (real-time updates)
    ├── WebSocket (/ws/terminal/:ptyId)
    ├── PTY Manager (node-pty)
    └── Static Files (web dashboard)
         │
         ├── sessions/*.json    (session metadata)
         ├── logs/YYYY-MM-DD/   (JSONL, auto .gz after 30 days)
         └── config.json        (session presets)
              │  SSE + WebSocket
              ▼
Web Dashboard (browser, Vanilla JS ES Modules)
```

- **Zero impact** on Claude Code even if server is down
- Data stored on **local filesystem** (no database required)
- Logs older than 30 days are **auto-compressed** to gzip
- Session names survive context compaction via **3-tier fallback** (/tmp → session JSON → config defaults)

---

## API Reference

### Events

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| `POST` | `/api/events` | Receive hook event from Claude Code | `{ ok, sessionId, status }` |

### Sessions

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| `GET` | `/api/sessions` | List all sessions (`?status=active,waiting_input`) | `Session[]` |
| `GET` | `/api/sessions/:id` | Get session detail | `Session` |
| `PATCH` | `/api/sessions/:id` | Update name/color (`{ projectName?, color? }`) | `Session` |
| `POST` | `/api/sessions/:id/kill` | Terminate session (SIGTERM or force end) | `{ ok, method }` |
| `POST` | `/api/sessions/:id/pin` | Toggle pin | `Session` |
| `DELETE` | `/api/sessions/:id` | Delete session + associated logs | `{ ok, logsDeleted }` |
| `DELETE` | `/api/sessions` | Bulk delete all inactive sessions | `{ ok, deletedSessions, deletedLogs }` |
| `POST` | `/api/sessions/launch` | Launch new session (`{ cwd, mode, terminalApp? }`) | `{ ok, ptyId?, mode }` |
| `POST` | `/api/sessions/cleanup` | Scan & clean stale sessions | `{ ok, checked, ended, disconnected }` |

### Session Defaults (Presets)

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| `GET` | `/api/session-defaults` | List all project defaults | `{ cwd: { name?, color? } }` |
| `PUT` | `/api/session-defaults` | Save default (`{ cwd, name?, color? }`) | `{ ok, cwd, name?, color? }` |
| `DELETE` | `/api/session-defaults` | Remove default (`{ cwd }`) | `{ ok, cwd }` |

### Logs & Stats

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| `GET` | `/api/logs` | Query logs (`?date=&sessionId=&search=&limit=&offset=`) | `LogEvent[]` |
| `DELETE` | `/api/logs` | Delete logs (`?before=YYYY-MM-DD`) | `{ ok, deleted }` |
| `GET` | `/api/stats` | Daily stats (`?date=`) | `{ totalEvents, prompts, responses, sessions, tools, avgIdleMs }` |

### Real-time

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/events/stream` | SSE stream (`session_update`, `log_update`) |
| `WS` | `/ws/terminal/:ptyId` | Terminal WebSocket (input/resize → output/exit) |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js v20+ |
| Language | TypeScript (strict) |
| Server | Fastify 5 |
| Frontend | Vanilla JS (ES Modules, no build tools) |
| Real-time | SSE + WebSocket (terminal) |
| Terminal | node-pty + xterm.js (CDN v5) |
| Storage | Local filesystem (JSON + JSONL + gzip) |
| Test | Vitest (90 tests) |
| CLI | Commander |

---

## Development

```bash
npm run dev          # Dev server (tsx watch mode)
npm test             # Run Vitest tests
npx tsc --noEmit     # Type check
npm run build        # TypeScript build
```

---

## Blog Posts

- [Claude Multiple Dashboard — 멀티 세션 관제탑 만들기](https://hey00507.github.io/posts/dev/claude-dashboard) (v0.3.0)
- [Claude Dashboard v0.4.0 — 세션 프리셋과 3-tier Fallback](https://hey00507.github.io/posts/dev/dashboard-v040-presets) (v0.4.0)

---

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## License

MIT
