# Claude Multiple Dashboard — Development Guide

## Principles

1. **Remove unused resources** — dead imports, empty dirs, unnecessary dependencies
2. **Extract after 3 repetitions** — duplicate code → shared function/utility
3. **Write tests for features** — not full TDD, but every feature must have accompanying tests

## Tech Stack

- **Runtime**: Node.js v25 (LTS)
- **Language**: TypeScript 5.9 (strict mode)
- **Server**: Fastify 5
- **Static Files**: @fastify/static 9
- **CLI**: Commander 14
- **Terminal**: node-pty 1.1 + xterm.js 5 (CDN) + @fastify/websocket 11
- **Dev**: tsx (watch mode), tsc (type check)

## Project Structure

```
src/
  server.ts              — Fastify server entry
  types.ts               — Shared types (Session, HookInput, LogEvent)
  routes/                — API endpoints
    events.ts            — POST /api/events (hook receiver)
    sessions.ts          — GET/PATCH/DELETE /api/sessions
    logs.ts              — GET/DELETE /api/logs, GET /api/stats
    stream.ts            — GET /api/events/stream (SSE)
    terminal.ts          — GET /ws/terminal/:ptyId (WebSocket)
  services/              — Business logic
    session-store.ts     — Session CRUD + state transitions
    log-store.ts         — JSONL log read/append/compress
    process-scanner.ts   — Process liveness check
    event-bus.ts         — SSE broadcast
    pty-manager.ts       — PTY lifecycle (node-pty spawn/kill/resize/scrollback)
public/                  — Web dashboard (Vanilla JS, no build)
  js/                    — ES Modules (state, sessions, history, detail, terminal, terminal-grid, sse, theme, utils)
bin/                     — CLI entrypoint
hooks/                   — Claude Code hook script
docs/                    — PRD, TODO, troubleshooting
```

## Commands

```bash
npm run dev       # Dev server (tsx watch)
npm run build     # TypeScript build
npm run dash      # CLI via tsx
npx tsc --noEmit  # Type check only
npm test          # Run tests
```

## Data Storage

- `~/.claude-dashboard/sessions/` — Session metadata (JSON)
- `~/.claude-dashboard/logs/{YYYY-MM-DD}/` — Event logs (JSONL, auto .gz after 30 days)
- `~/.claude-dashboard/config.json` — Config

## State Transitions

```
SessionStart       → active, idleSince: null
UserPromptSubmit   → active, idleSince: null
PostToolUse        → active, idleSince: null
Stop               → waiting_input, idleSince: now()
Notification       → waiting_input/waiting_permission, idleSince: now()
SessionEnd         → ended, idleSince: null
Process not found  → disconnected, idleSince: null
```

## Code Guidelines

- Frontend uses Vanilla JS (ES Modules) under `public/` — no build tools
- Hook script (`hooks/dashboard-hook.sh`) must not affect Claude Code when server is down (non-blocking, timeout)
- SSE idle time counter is calculated on the frontend (saves SSE traffic)
- Session writes use atomic temp→rename pattern for crash safety
- Logs older than 30 days are auto-compressed to .gz on server startup
