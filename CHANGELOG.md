# Changelog

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
