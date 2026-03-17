# Troubleshooting

## Hook이 동작하지 않을 때

### 증상: 세션이 대시보드에 나타나지 않음

1. **hook 등록 확인**
   ```bash
   cat ~/.claude/settings.json | jq '.hooks'
   ```
   `dashboard-hook.sh` 경로가 모든 이벤트(SessionStart, Stop, PostToolUse 등)에 등록되어 있어야 함.

2. **hook 스크립트 확인**
   ```bash
   ls -la ~/.claude/hooks/dashboard-hook.sh
   # 실행 권한 필요: -rwxr-xr-x
   chmod +x ~/.claude/hooks/dashboard-hook.sh
   ```

3. **jq 설치 확인**
   ```bash
   which jq || echo "jq가 설치되어 있지 않습니다"
   # macOS: brew install jq
   ```

4. **서버 실행 확인**
   ```bash
   claude-dash status
   # 또는: curl -s http://localhost:7420/api/sessions | jq .
   ```

5. **수동 이벤트 테스트**
   ```bash
   curl -X POST http://localhost:7420/api/events \
     -H "Content-Type: application/json" \
     -d '{"session_id":"test-001","cwd":"/tmp","hook_event_name":"SessionStart","source":"startup"}'
   ```
   → `{"ok":true,"status":"active"}` 응답이 오면 서버는 정상.

6. **hook 재등록**
   ```bash
   claude-dash init
   ```

---

## 서버 시작 실패

### "EADDRINUSE" — 포트 충돌
```bash
# 해당 포트를 사용 중인 프로세스 확인
lsof -i :7420
# 기존 서버 종료
claude-dash stop
# 다른 포트로 시작
claude-dash start -p 7777
```

### "EACCES" — 권한 문제
```bash
# 1024 이하 포트는 root 필요. 기본 포트(7420) 사용 권장.
claude-dash start -p 7420
```

### 서버가 즉시 종료됨
```bash
# 로그 확인
cat ~/.claude-dashboard/server.log
# Node.js 버전 확인 (v20+ 필요)
node --version
```

---

## 로그/데이터 관련

### 로그 디스크 사용량이 크다
```bash
# 현재 사용량 확인
du -sh ~/.claude-dashboard/
# 30일 이전 로그 삭제
claude-dash clean --days 30
# 특정 날짜 이전 삭제
claude-dash clean --before 2026-03-01
```

### 로그 파일이 깨졌다 (JSON 파싱 에러)
```bash
# 해당 날짜의 깨진 파일 확인
cd ~/.claude-dashboard/logs/2026-03-17/
# 각 JSONL 파일에서 깨진 라인 찾기
for f in *.jsonl; do
  echo "--- $f ---"
  while IFS= read -r line; do
    echo "$line" | jq . > /dev/null 2>&1 || echo "BAD: $line"
  done < "$f"
done
```

### 세션 메타데이터 초기화
```bash
# 세션 파일 삭제 (로그는 유지)
rm ~/.claude-dashboard/sessions/*.json
```

---

## SSE/실시간 갱신 관련

### 대시보드에 실시간 업데이트가 안 됨
- 브라우저 개발자 도구 → Network 탭 → "stream" 또는 "EventSource" 필터
- `http://localhost:7420/api/events/stream` 연결 상태 확인
- "pending" 상태면 정상 (SSE는 long-polling)
- 연결이 없으면 서버 재시작: `claude-dash stop && claude-dash start`

### 브라우저 탭을 오래 열어두면 끊김
- SSE는 자동 재연결 (3초 후). 네트워크 탭에서 재연결 확인 가능.
- macOS 절전 모드에서 복귀 시 1~2회 재연결 발생 (정상 동작).

---

## 설정 관련

### config.json 위치 및 기본값
```bash
cat ~/.claude-dashboard/config.json
```

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `port` | 7420 | 서버 포트 |
| `logRetentionDays` | 30 | 자동 정리 기준 (서버 시작 시) |

### 포트 변경
```bash
# config.json 수정
echo '{"port": 7777}' > ~/.claude-dashboard/config.json
# 또는 CLI 옵션
claude-dash start -p 7777
```
