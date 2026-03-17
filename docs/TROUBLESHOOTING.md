# Troubleshooting

## Hooks Not Working

### Symptom: Sessions don't appear on the dashboard

1. **Check hook registration**
   ```bash
   cat ~/.claude/settings.json | jq '.hooks'
   ```
   Verify `dashboard-hook.sh` is registered for all events (SessionStart, Stop, PostToolUse, etc.).

2. **Check hook script**
   ```bash
   ls -la ~/.claude/hooks/dashboard-hook.sh
   # Must have execute permission: -rwxr-xr-x
   chmod +x ~/.claude/hooks/dashboard-hook.sh
   ```

3. **Check jq installation**
   ```bash
   which jq || echo "jq is not installed"
   # macOS: brew install jq
   ```

4. **Check server is running**
   ```bash
   claude-dash status
   # or: curl -s http://localhost:7420/api/sessions | jq .
   ```

5. **Manual event test**
   ```bash
   curl -X POST http://localhost:7420/api/events \
     -H "Content-Type: application/json" \
     -d '{"session_id":"test-001","cwd":"/tmp","hook_event_name":"SessionStart","source":"startup"}'
   ```
   If you get `{"ok":true,"status":"active"}`, the server is working fine.

6. **Re-register hooks**
   ```bash
   claude-dash init
   ```

---

## Server Won't Start

### "EADDRINUSE" — Port conflict
```bash
# Find process using the port
lsof -i :7420
# Stop existing server
claude-dash stop
# Use a different port
claude-dash start -p 7777
```

### "EACCES" — Permission denied
```bash
# Ports below 1024 require root. Use default port (7420).
claude-dash start -p 7420
```

### Server exits immediately
```bash
# Check logs
cat ~/.claude-dashboard/server.log
# Check Node.js version (v20+ required)
node --version
```

---

## Logs & Data

### Log disk usage is too large
```bash
# Check current usage
du -sh ~/.claude-dashboard/
# Delete logs older than 30 days
claude-dash clean --days 30
# Delete logs before a specific date
claude-dash clean --before 2026-03-01
```

### Corrupted log files (JSON parse errors)
```bash
# Find corrupted lines in a date's log files
cd ~/.claude-dashboard/logs/2026-03-17/
for f in *.jsonl; do
  echo "--- $f ---"
  while IFS= read -r line; do
    echo "$line" | jq . > /dev/null 2>&1 || echo "BAD: $line"
  done < "$f"
done
```
Note: As of v0.3.1, corrupted lines are automatically skipped during reads.

### Reset session metadata
```bash
# Delete session files (logs are preserved)
rm ~/.claude-dashboard/sessions/*.json
```

---

## SSE / Real-time Updates

### Dashboard not updating in real-time
- Open browser DevTools → Network tab → filter by "stream" or "EventSource"
- Check `http://localhost:7420/api/events/stream` connection status
- "pending" status is normal (SSE is a long-lived connection)
- If no connection exists, restart: `claude-dash stop && claude-dash start`

### Connection drops after long idle
- SSE auto-reconnects after 3 seconds. Check Network tab for reconnection.
- After macOS sleep/wake, 1-2 reconnections are normal behavior.

---

## Configuration

### config.json location and defaults
```bash
cat ~/.claude-dashboard/config.json
```

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | 7420 | Server port |
| `logRetentionDays` | 30 | Auto-cleanup threshold (checked on server start) |

### Change port
```bash
# Edit config.json
echo '{"port": 7777}' > ~/.claude-dashboard/config.json
# Or use CLI option
claude-dash start -p 7777
```
