#!/bin/bash
INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

# Stop 이벤트 무한 루프 방지
if [ "$EVENT" = "Stop" ] && [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# config.json에서 포트 읽기 (없으면 기본값 7420)
CONFIG="$HOME/.claude-dashboard/config.json"
if [ -f "$CONFIG" ]; then
  PORT=$(jq -r '.port // 7420' "$CONFIG")
else
  PORT=7420
fi

# 대시보드 서버로 이벤트 전달 (non-blocking)
curl -s -X POST "http://localhost:${PORT}/api/events" \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  --connect-timeout 1 \
  --max-time 2 &

exit 0
