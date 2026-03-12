# Claude Multiple Dashboard — Implementation PRD

## 1. 개요

Claude Code를 병렬로 여러 세션 띄워 작업할 때, **모든 세션의 상태를 한눈에 모니터링**하는 대시보드.
응답 완료 후 입력 대기 중인 세션의 **idle time을 실시간 카운트**하여, 어떤 세션이 주의를 기다리고 있는지 즉시 파악 가능.

### 핵심 가치

- **병렬 작업 가시성**: 여러 세션을 동시에 돌릴 때 어디에 입력이 필요한지 한 화면에서 확인
- **Idle Time 추적**: 응답 대기 상태 진입 시점부터 실시간 카운트 → 세션 방치 방지
- **추적성**: 세션이 끊긴 후에도 이전 작업 내용·프롬프트를 조회
- **생산성**: Jenkins 스타일의 Job 관리로 멀티 세션 워크플로우 최적화

---

## 2. 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code Sessions                  │
│  (세션 A)        (세션 B)        (세션 C)                │
└────┬──────────────┬──────────────┬───────────────────────┘
     │              │              │
     │  hooks (JSON stdin)         │
     ▼              ▼              ▼
┌─────────────────────────────────────────────────────────┐
│              Hook Scripts (Bash)                         │
│  dashboard-hook.sh — 모든 이벤트를 HTTP POST로 전달     │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP POST
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Dashboard Server (Node.js)                  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ REST API │  │ SSE 스트림│  │ Static File Server  │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│        │              │                                  │
│        ▼              │                                  │
│  ┌──────────────┐     │                                  │
│  │ 로컬 파일 DB │     │                                  │
│  │ (JSON/JSONL) │     │                                  │
│  └──────────────┘     │                                  │
└───────────────────────┼─────────────────────────────────┘
                        │ SSE
                        ▼
┌─────────────────────────────────────────────────────────┐
│              Web UI (브라우저)                            │
│  세션 카드 목록 | 히스토리 | 세션 상세                    │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 데이터 수집 — Claude Code Hooks

### 3.1 활용할 Hook 이벤트

| Event | 용도 | 수집 데이터 |
|-------|------|------------|
| `SessionStart` | 세션 생성/재개 감지 | `session_id`, `cwd`, `source` (startup/resume/clear) |
| `SessionEnd` | 세션 종료 감지 | `session_id`, `reason` (logout/exit/clear) |
| `UserPromptSubmit` | 사용자 프롬프트 내용 기록 | `session_id`, `cwd`, 프롬프트 텍스트 |
| `Stop` | 응답 완료 감지 → 입력대기 전환 | `session_id`, `cwd`, `stop_hook_active` |
| `PostToolUse` | 도구 사용 추적 | `session_id`, `tool_name`, `tool_input` |
| `Notification` | 알림/권한 요청 감지 | `session_id`, `notification_type` |

### 3.2 Hook 입력 데이터 구조

모든 hook은 stdin으로 JSON을 수신:

```json
{
  "session_id": "abc123",
  "cwd": "/Users/ethankim/daily-mail",
  "hook_event_name": "Stop"
}
```

이벤트별 추가 필드:

```json
// SessionStart
{ "source": "startup" | "resume" | "clear" | "compact" }

// SessionEnd
{ "reason": "clear" | "logout" | "prompt_input_exit" | "other" }

// UserPromptSubmit — 사용자가 입력한 프롬프트 텍스트
// stdin의 message 필드 또는 content 필드에 프롬프트 내용 포함
// hook이 exit 0 + stdout 텍스트를 반환하면 Claude 컨텍스트에 추가됨 (대시보드에서는 사용하지 않음)

// PostToolUse
{ "tool_name": "Bash", "tool_input": { "command": "npm test" } }

// Notification
{ "notification_type": "permission_prompt" | "idle_prompt" }

// Stop
{ "stop_hook_active": false }
```

### 3.3 Hook 스크립트 설계

**`~/.claude/hooks/dashboard-hook.sh`**

```bash
#!/bin/bash
INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

# Stop 이벤트 무한 루프 방지
if [ "$EVENT" = "Stop" ] && [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# 대시보드 서버로 이벤트 전달 (non-blocking)
curl -s -X POST "http://localhost:7420/api/events" \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  --connect-timeout 1 \
  --max-time 2 &

exit 0
```

- 서버가 꺼져 있어도 Claude Code에 영향 없음 (non-blocking + timeout)
- `stop_hook_active` 체크로 무한 루프 방지

### 3.4 Hook 등록 (`~/.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "~/.claude/hooks/dashboard-hook.sh" }]
    }],
    "SessionEnd": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "~/.claude/hooks/dashboard-hook.sh" }]
    }],
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "~/.claude/hooks/dashboard-hook.sh" }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "~/.claude/hooks/dashboard-hook.sh" }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "~/.claude/hooks/dashboard-hook.sh" }]
    }],
    "Notification": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "~/.claude/hooks/dashboard-hook.sh" }]
    }]
  }
}
```

> 기존 알림 hooks(`notify-stop.sh`, Notification)은 유지하면서 dashboard hook을 추가 등록.

---

## 4. 로컬 저장소 구조

```
~/.claude-dashboard/
├── config.json                    # 대시보드 설정
├── sessions/
│   └── {session-id}.json          # 세션 메타데이터 (최신 상태)
└── logs/
    └── {YYYY-MM-DD}/
        └── {session-id}.jsonl     # 이벤트 로그 (append-only)
```

### 4.1 세션 메타데이터 (`sessions/{id}.json`)

세션의 최신 상태를 유지. 이벤트 수신 시 upsert.

```json
{
  "sessionId": "abc123",
  "cwd": "/Users/ethankim/daily-mail",
  "projectName": "daily-mail",
  "status": "waiting_input",
  "startedAt": "2026-03-13T09:00:00+09:00",
  "lastActivityAt": "2026-03-13T10:30:00+09:00",
  "lastEvent": "Stop",
  "lastPrompt": "테스트도 작성해줘",
  "lastToolUsed": "Edit",
  "idleSince": "2026-03-13T10:30:00+09:00",
  "endedAt": null,
  "endReason": null,
  "totalEvents": 42
}
```

**상태 전이 규칙:**

```
SessionStart (source: startup)     → status: "active", idleSince: null
SessionStart (source: resume)      → status: "active", idleSince: null
UserPromptSubmit                   → status: "active", idleSince: null, lastPrompt 갱신
PostToolUse                        → status: "active", idleSince: null, lastToolUsed 갱신
Stop                               → status: "waiting_input", idleSince: now()
Notification (idle_prompt)         → status: "waiting_input", idleSince 유지 (이미 설정된 경우)
Notification (permission_prompt)   → status: "waiting_permission", idleSince: now()
SessionEnd                         → status: "ended", idleSince: null
프로세스 미감지 (PID check 실패)    → status: "disconnected", idleSince: null
```

**Idle Time 계산:**
- `idleSince`는 세션이 응답 대기(`waiting_input`) 또는 권한 대기(`waiting_permission`) 상태에 진입한 시각
- 프론트엔드에서 `now() - idleSince`를 1초 간격으로 렌더링 → 실시간 카운트 표시
- `active` 또는 `ended` 상태에서는 `idleSince: null` → idle time 미표시
- 서버는 시각만 제공하고, 실시간 카운트 계산은 프론트엔드에서 수행 (SSE 트래픽 절약)

### 4.2 이벤트 로그 (`logs/{date}/{id}.jsonl`)

모든 이벤트를 시간순으로 append. 히스토리 조회용.

```jsonl
{"ts":"2026-03-13T09:00:00+09:00","event":"SessionStart","source":"startup","cwd":"/Users/ethankim/daily-mail"}
{"ts":"2026-03-13T09:00:05+09:00","event":"UserPromptSubmit","prompt":"메일 발송 서비스 리팩터링해줘"}
{"ts":"2026-03-13T09:00:15+09:00","event":"PostToolUse","tool":"Read","input":{"file_path":"src/index.ts"}}
{"ts":"2026-03-13T09:01:30+09:00","event":"PostToolUse","tool":"Edit","input":{"file_path":"src/index.ts"}}
{"ts":"2026-03-13T09:02:00+09:00","event":"Stop"}
{"ts":"2026-03-13T09:05:00+09:00","event":"UserPromptSubmit","prompt":"테스트도 작성해줘"}
{"ts":"2026-03-13T09:05:10+09:00","event":"PostToolUse","tool":"Write","input":{"file_path":"src/tests/mail.test.ts"}}
{"ts":"2026-03-13T09:05:30+09:00","event":"PostToolUse","tool":"Bash","input":{"command":"npm test"}}
{"ts":"2026-03-13T09:06:00+09:00","event":"Stop"}
{"ts":"2026-03-13T10:00:00+09:00","event":"SessionEnd","reason":"prompt_input_exit"}
```

### 4.3 설정 (`config.json`)

```json
{
  "port": 7420,
  "logRetentionDays": 30,
  "autoOpenBrowser": true,
  "sessionTimeoutMinutes": 60
}
```

---

## 5. 백엔드 서버

### 5.1 기술 스택

| 구성 | 선택 | 이유 |
|------|------|------|
| 런타임 | Node.js | Claude Code 생태계와 일관, hooks 스크립트와 연계 용이 |
| 언어 | TypeScript | 타입 안정성, 데이터 구조 명확화 |
| 프레임워크 | Fastify | Express 대비 경량·고성능, JSON 스키마 검증 내장 |
| 실시간 | SSE (Server-Sent Events) | WebSocket 대비 단순, 단방향 스트림에 적합 |
| 저장소 | 로컬 파일시스템 (JSON/JSONL) | DB 설치 불필요, 이식성, 사람이 읽기 가능 |

### 5.2 API 설계

#### 이벤트 수신 (hooks → 서버)

```
POST /api/events
Body: hook stdin JSON (session_id, hook_event_name, cwd, ...)
Response: 200 OK
```

처리 흐름:
1. 이벤트 JSON 파싱
2. 타임스탬프 추가
3. `sessions/{id}.json` upsert (상태 전이 규칙 적용)
4. `logs/{date}/{id}.jsonl` append
5. SSE로 연결된 클라이언트에 브로드캐스트

#### 세션 목록 조회

```
GET /api/sessions
Query: ?status=active,waiting_input (선택)
Response: Session[] (최신순)
```

#### 세션 상세 조회

```
GET /api/sessions/:sessionId
Response: Session 메타데이터
```

#### 히스토리 조회

```
GET /api/logs
Query: ?date=2026-03-13 (기본: 오늘)
       &sessionId=abc123 (선택)
       &limit=100 (기본: 100)
       &offset=0
Response: LogEvent[]
```

#### 로그 삭제

```
DELETE /api/logs
Query: ?before=2026-03-01 (해당 날짜 이전 로그 삭제)
Response: { deletedDays: 10, deletedFiles: 25 }
```

#### 실시간 스트림

```
GET /api/events/stream
Response: SSE stream
  event: session_update
  data: { sessionId, status, lastEvent, ... }
```

### 5.3 프로세스 스캐너

세션이 실제로 살아있는지 주기적으로 확인하는 백그라운드 태스크.

```typescript
// 30초마다 실행
async function scanProcesses() {
  // 1. 실행 중인 claude 프로세스 조회
  const procs = execSync("ps aux | grep 'claude' | grep -v grep")

  // 2. sessions/ 디렉토리의 active/waiting_input 세션 목록
  const activeSessions = getSessionsByStatus(["active", "waiting_input"])

  // 3. PID가 없는 세션 → status: "disconnected"
  for (const session of activeSessions) {
    if (!isProcessAlive(session)) {
      updateSessionStatus(session.sessionId, "disconnected")
    }
  }
}
```

> hooks가 SessionEnd를 놓칠 수 있으므로 (강제 종료 등) 프로세스 스캐너가 보완.

---

## 6. 프론트엔드 UI

### 6.1 기술 스택

| 구성 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | Vanilla JS + Web Components | 의존성 최소화, 빠른 로딩 |
| 스타일 | CSS Variables + 다크 테마 | 터미널 친화적, 가벼움 |
| 번들러 | 없음 (ES Modules) | 빌드 단계 제거, 서버에서 직접 서빙 |
| 실시간 | EventSource (SSE) | 네이티브 브라우저 API |

> React는 이 규모에서 과도. 순수 JS로 충분하고 빌드 의존성 없이 유지 가능.

### 6.2 화면 구성

#### 메인 화면 — 세션 목록

```
┌─────────────────────────────────────────────────────┐
│  Claude Dashboard              [오늘 ▼]  [⚙ 설정]  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟢 daily-mail                                   │ │
│  │    ~/daily-mail                                 │ │
│  │    Tool: Edit → src/service/mail.ts             │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟡 garlic-portal            ⏱ idle 3:42       │ │
│  │    ~/projects/garlic                            │ │
│  │    💬 "API 엔드포인트 리팩터링해줘"              │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟠 smartfarm                 ⏱ idle 0:15       │ │
│  │    ~/IdeaProjects/smartfarm                     │ │
│  │    🔒 권한 승인 대기                             │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ ⚪ claude-productivity             20분 전      │ │
│  │    ~/claude-productivity                        │ │
│  │    세션 종료                                     │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
├─────────────────────────────────────────────────────┤
│  📋 오늘의 활동 (15건)                   [전체삭제] │
│                                                      │
│  10:30  daily-mail     Edit src/service/mail.ts    │
│  10:29  daily-mail     Bash npm test               │
│  10:25  garlic-portal  Write src/api/endpoint.ts   │
│  10:20  garlic-portal  Read  src/config.ts         │
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

#### 세션 상세 — 클릭 시 확장 또는 사이드패널

```
┌──────────────────────────────────────────┐
│ daily-mail                      [닫기]   │
├──────────────────────────────────────────┤
│ 상태: 🟢 작업중                          │
│ 시작: 09:00  |  경과: 1시간 30분         │
│ 경로: ~/daily-mail                       │
│ 이벤트: 42건                             │
├──────────────────────────────────────────┤
│ 타임라인                                  │
│                                           │
│ 10:30  Stop                              │
│ 10:29  Edit  src/service/mail.ts         │
│ 10:28  Read  src/service/mail.ts         │
│ 10:25  💬 "테스트도 작성해줘"             │
│ 10:20  Stop                              │
│ 10:18  Bash  npm test                    │
│ 10:15  Edit  src/service/mail.ts         │
│ 10:10  💬 "메일 발송 서비스 리팩터링해줘" │
│ ...                                       │
└──────────────────────────────────────────┘
```

### 6.3 상태 아이콘 매핑

| 상태 | 아이콘 | 색상 | 설명 |
|------|--------|------|------|
| `active` | 🟢 | `#22c55e` | Claude가 응답 생성 중 / 도구 실행 중 |
| `waiting_input` | 🟡 | `#eab308` | 사용자 입력 대기 |
| `waiting_permission` | 🟠 | `#f97316` | 권한 승인 대기 |
| `ended` | ⚪ | `#9ca3af` | 정상 종료 |
| `disconnected` | 🔴 | `#ef4444` | 프로세스 감지 불가 (강제 종료 등) |

---

## 7. CLI 인터페이스

### 7.1 명령어

```bash
# 대시보드 서버 시작 + 브라우저 오픈
claude-dash

# 서버만 시작 (백그라운드)
claude-dash start --port 7420

# 서버 종료
claude-dash stop

# 현재 세션 상태 (터미널 출력)
claude-dash status

# 출력 예시:
# 🟢 daily-mail        ~/daily-mail           방금    Edit src/service/mail.ts
# 🟡 garlic-portal     ~/projects/garlic      3분 전  응답 완료
# ⚪ claude-productivity ~/claude-productivity  20분 전 세션 종료

# 히스토리 조회
claude-dash logs                    # 오늘
claude-dash logs --date 2026-03-12  # 특정일
claude-dash logs --session abc123   # 특정 세션

# 로그 정리
claude-dash clean --before 2026-03-01

# hooks 자동 설정
claude-dash init
```

### 7.2 `claude-dash init`

hooks를 자동으로 `~/.claude/settings.json`에 등록해주는 셋업 명령.

```
$ claude-dash init

✓ hook 스크립트 생성: ~/.claude/hooks/dashboard-hook.sh
✓ settings.json에 hooks 등록 완료
  - SessionStart, SessionEnd, UserPromptSubmit, Stop, PostToolUse, Notification
✓ 데이터 디렉토리 생성: ~/.claude-dashboard/
✓ 설정 파일 생성: ~/.claude-dashboard/config.json

대시보드 준비 완료! `claude-dash` 로 시작하세요.
```

---

## 8. 디렉토리 구조 (프로젝트)

```
claude-multiple-dashboard/
├── package.json
├── tsconfig.json
├── bin/
│   └── claude-dash.ts         # CLI 엔트리포인트
├── src/
│   ├── server.ts              # Fastify 서버 메인
│   ├── routes/
│   │   ├── events.ts          # POST /api/events (hook 수신)
│   │   ├── sessions.ts        # GET /api/sessions
│   │   ├── logs.ts            # GET /api/logs, DELETE /api/logs
│   │   └── stream.ts          # GET /api/events/stream (SSE)
│   ├── services/
│   │   ├── session-store.ts   # 세션 메타데이터 CRUD
│   │   ├── log-store.ts       # 이벤트 로그 read/append
│   │   ├── process-scanner.ts # 프로세스 생존 확인
│   │   └── event-bus.ts       # 내부 이벤트 → SSE 브로드캐스트
│   └── types.ts               # 공유 타입 정의
├── public/                    # 정적 웹 파일
│   ├── index.html
│   ├── app.js                 # 메인 JS (ES Module)
│   ├── components/
│   │   ├── session-card.js
│   │   ├── session-detail.js
│   │   ├── history-list.js
│   │   └── header.js
│   └── styles/
│       └── main.css
├── hooks/
│   └── dashboard-hook.sh      # init 시 복사될 hook 스크립트
├── docs/
│   └── prd.md                 # 이 문서
└── README.md
```

---

## 9. 구현 단계

### Phase 1: 데이터 수집 인프라 (MVP)

목표: hook → 서버 → 파일 저장 파이프라인 완성, CLI로 확인 가능

**Step 1.1 — 프로젝트 초기화**
- [ ] `package.json` 초기화
- [ ] TypeScript 설정 (`tsconfig.json`)
- [ ] 의존성 설치: `fastify`, `commander`, `open`
- [ ] 공유 타입 정의 (`types.ts`: Session, LogEvent, HookInput 등)

**Step 1.2 — Hook 스크립트**
- [ ] `dashboard-hook.sh` 작성 (stdin 읽기 → HTTP POST → exit 0)
- [ ] `stop_hook_active` 무한 루프 방지 처리
- [ ] 서버 미실행 시 graceful 실패 (timeout 1초)

**Step 1.3 — 이벤트 수신 API**
- [ ] `POST /api/events` 엔드포인트 구현
- [ ] hook 입력 JSON 파싱 및 검증
- [ ] 타임스탬프 추가

**Step 1.4 — 저장소 서비스**
- [ ] `session-store.ts`: 세션 메타데이터 upsert (상태 전이 규칙 적용)
- [ ] `log-store.ts`: JSONL append, 날짜별 디렉토리 자동 생성
- [ ] `~/.claude-dashboard/` 디렉토리 자동 초기화

**Step 1.5 — CLI 기본 명령**
- [ ] `claude-dash init`: hook 등록 + 디렉토리 생성
- [ ] `claude-dash start`: 서버 시작
- [ ] `claude-dash stop`: 서버 종료
- [ ] `claude-dash status`: 세션 목록 터미널 출력

**Step 1.6 — 검증**
- [ ] Claude Code 세션 시작 → SessionStart 이벤트 수신 확인
- [ ] 프롬프트 입력 → UserPromptSubmit 이벤트로 프롬프트 텍스트 기록 확인
- [ ] 도구 사용 → PostToolUse 이벤트 로깅 확인
- [ ] 응답 완료 → Stop 이벤트로 상태 전환 확인
- [ ] 세션 종료 → SessionEnd 이벤트 수신 확인
- [ ] `claude-dash status`로 세션 목록 확인

### Phase 2: 웹 대시보드

목표: 브라우저에서 실시간 세션 모니터링 가능

**Step 2.1 — 정적 파일 서빙**
- [ ] Fastify에 `@fastify/static` 플러그인 추가
- [ ] `public/index.html` 기본 레이아웃 (다크 테마)
- [ ] CSS 변수 기반 테마 시스템

**Step 2.2 — 세션 카드 컴포넌트**
- [ ] `session-card.js`: 상태 아이콘, 프로젝트명, 마지막 활동
- [ ] 상태별 색상 매핑
- [ ] **Idle Time 실시간 카운트**: `idleSince` 기반 `⏱ idle MM:SS` 1초 간격 렌더링
- [ ] idle 상태(`waiting_input`, `waiting_permission`)에서만 카운트 표시, `active`/`ended`에서는 숨김

**Step 2.3 — SSE 실시간 업데이트**
- [ ] `GET /api/events/stream` SSE 엔드포인트
- [ ] `event-bus.ts`: 이벤트 수신 → SSE 브로드캐스트
- [ ] 프론트엔드 EventSource 연결 → 세션 카드 자동 갱신
- [ ] 연결 끊김 시 자동 재연결

**Step 2.4 — 히스토리 목록**
- [ ] `GET /api/logs` 엔드포인트
- [ ] `history-list.js`: 날짜별 이벤트 목록
- [ ] 날짜 선택 드롭다운
- [ ] 무한 스크롤 또는 페이지네이션

**Step 2.5 — 세션 상세 뷰**
- [ ] `GET /api/sessions/:id` 엔드포인트
- [ ] `session-detail.js`: 타임라인 뷰 (이벤트 목록)
- [ ] 세션 카드 클릭 → 사이드 패널 확장

**Step 2.6 — 자동 브라우저 오픈**
- [ ] `claude-dash` (인수 없음) → 서버 시작 + `open` 패키지로 브라우저 실행
- [ ] 이미 서버가 실행 중이면 브라우저만 오픈

### Phase 3: 안정화 & 고도화

목표: 실사용 편의성 강화

**Step 3.1 — 프로세스 스캐너**
- [ ] `process-scanner.ts`: 30초 간격으로 `ps aux` 기반 claude 프로세스 확인
- [ ] active/waiting 세션 중 프로세스 없는 세션 → `disconnected` 전환
- [ ] SSE로 상태 변경 브로드캐스트

**Step 3.2 — 로그 관리**
- [ ] `DELETE /api/logs?before=YYYY-MM-DD` 구현
- [ ] `claude-dash clean --before YYYY-MM-DD` CLI
- [ ] 설정의 `logRetentionDays` 기반 자동 정리 (서버 시작 시)

**Step 3.3 — 검색**
- [ ] 히스토리에서 프로젝트명/도구명으로 필터링
- [ ] 텍스트 검색 (tool_input 내 파일명, 커맨드 등)

**Step 3.4 — UX 개선**
- [ ] 세션 카드 정렬 (활성 → 대기 → 종료, 최근 활동순)
- [ ] 키보드 단축키 (j/k 세션 이동, Enter 상세, Esc 닫기)
- [ ] 반응형 레이아웃 (모바일 대응)
- [ ] 알림 뱃지 (permission_prompt 대기 중인 세션 수)

**Step 3.5 — npm 글로벌 설치**
- [ ] `bin` 필드 설정 → `npm install -g` 또는 `npx` 실행 지원
- [ ] `claude-dash` 글로벌 커맨드 등록

---

## 10. 제약사항 & 주의사항

| 항목 | 설명 | 대응 |
|------|------|------|
| 공식 API 부재 | Claude Code 세션 데이터에 공식 API 없음 | hooks + 프로세스 감지로 우회 |
| hooks 포맷 변경 | 향후 hook 입력 JSON 구조가 변경될 수 있음 | 타입 검증 + 버전 체크 로직 |
| 강제 종료 감지 | `kill -9` 등으로 종료 시 SessionEnd 미발생 | 프로세스 스캐너가 보완 |
| PID 재사용 | 세션 재시작 시 새 session_id 부여됨 | session_id 기반 추적 (PID 보조) |
| 기존 hooks 공존 | 사용자의 기존 hooks와 충돌 가능 | 기존 hooks 배열에 append, 덮어쓰지 않음 |
| 디스크 사용량 | JSONL 로그 무한 증가 | logRetentionDays 자동 정리 |

---

## 11. 기술 스택 요약

| 구성요소 | 기술 |
|----------|------|
| Hook 스크립트 | Bash + jq + curl |
| 서버 런타임 | Node.js (v20+) |
| 서버 언어 | TypeScript |
| HTTP 프레임워크 | Fastify |
| 실시간 통신 | SSE (Server-Sent Events) |
| 프론트엔드 | Vanilla JS + Web Components + CSS |
| 저장소 | 로컬 파일시스템 (JSON + JSONL) |
| CLI | Commander.js |
| 빌드 | tsx (TypeScript 직접 실행) |
| 패키지 관리 | npm |

---

## 12. 성공 지표

- [ ] Claude Code 세션 시작/종료가 5초 이내에 대시보드에 반영
- [ ] 3개 이상의 동시 세션을 안정적으로 모니터링
- [ ] 7일간의 히스토리를 1초 이내에 로딩
- [ ] 서버 미실행 시 Claude Code 성능에 영향 없음 (hook timeout 2초)
- [ ] `claude-dash init` 한 번으로 셋업 완료
