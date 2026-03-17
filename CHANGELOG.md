# Changelog

## v0.3.1 (2026-03-17)

### New Features
- **Copy Button**: One-click clipboard copy on prompts/responses with toast notification
- **30-Day Date Picker**: Extended from 7 to 30 days
- **Session Pinning**: Pin important sessions to the top (POST /api/sessions/:id/pin)
- **Model & Context Display**: Session cards show model name, context usage (ctx: N%), and elapsed time
- **Transcript Export**: "MD" button in detail panel exports full conversation as Markdown
- **Activity Heatmap**: 24-hour grid showing event density per hour
- **Real-time Stats**: Stats update live via SSE (500ms debounce)
- **Clickable Stat Cards**: Click prompts/responses count to filter history

### Improvements
- **Atomic Writes**: Session files use temp→rename; log append uses fd open/write/close
- **Log Compression**: Logs older than 30 days auto-compressed to .gz on server startup
- **Server-side Search**: GET /api/logs?search= parameter
- **Corrupted Line Skip**: Malformed JSONL lines silently skipped instead of crashing
- **Delete Refresh**: Session delete now refreshes history + stats immediately
- **i18n README**: English (primary) + Korean translation

## v0.3.0 (2026-03-17)

### New Features
- **History Export**: Download filtered history as JSON or CSV
- **Session + Log Bulk Delete**: Delete session and all associated logs together; "Delete All" button for inactive sessions
- **Project Grouping**: Sessions with the same working directory are grouped together with collapsible headers
- **Dark/Light Theme**: System preference detection + manual toggle button, persisted in localStorage
- **Enter Key Fullview**: Press Enter on selected session to toggle detail panel between side panel and fullview
- **Stats Dashboard**: Daily summary cards (events, prompts, responses, sessions, avg idle time) and top 10 tool usage bar chart
- **Keyboard Shortcuts Help**: Press `?` or click the `?` button to see all available keyboard shortcuts

### Improvements
- **Module Split**: Refactored 973-line app.js into 7 ES modules for better maintainability
- **GET /api/stats**: New API endpoint for aggregated daily statistics
- **DELETE /api/sessions**: New bulk delete API for inactive sessions
- **deleteLogsBySessionId**: Session delete now cascades to logs across all date directories

### Tests
- Added tests for `deleteLogsBySessionId`, bulk delete API, and stats API (41 total)

## v0.2.1 (2026-03-16)

- Collapsible inactive sessions group

## v0.2.0 (2026-03-15)

- Phase 2-3 complete: UI polish, history filters, search, keyboard shortcuts, responsive layout, session management

## v0.1.0 (2026-03-14)

- Initial npm publish
- Phase 1: Data collection infrastructure + 35 tests
- Phase 2: Web dashboard with session monitoring, history, detail panel
