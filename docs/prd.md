# Claude Multiple Dashboard — PRD

> 최종 업데이트: 2026-03-13
> 상태: Phase 1 완료, Phase 2~3 진행 예정

## 1. 개요

Claude Code를 병렬로 여러 세션 띄워 작업할 때, **모든 세션의 상태를 한눈에 모니터링**하는 대시보드.
응답 완료 후 입력 대기 중인 세션의 **idle time을 실시간 카운트**하여, 어떤 세션이 주의를 기다리고 있는지 즉시 파악 가능.

### 핵심 가치

- **병렬 작업 가시성**: 여러 세션을 동시에 돌릴 때 어디에 입력이 필요한지 한 화면에서 확인
- **Idle Time 추적**: 응답 대기 상태 진입 시점부터 실시간 카운트 → 세션 방치 방지
- **프롬프트 & 응답 추적**: 사용자 프롬프트와 Claude의 마지막 응답을 대시보드에서 확인
- **추적성**: 세션이 끊긴 후에도 이전 작업 내용을 조회
- **생산성**: 멀티 세션 워크플로우 최적화

---

## 2. 아키텍처

```
Claude Code Sessions (A, B, C, ...)
    │  hooks (JSON stdin)
    ▼
dashboard-hook.sh
    │  curl POST (non-blocking, 1s timeout)
    ▼
Dashboard Server (Fastify 5, Node.js)
    ├── REST API (세션/로그 CRUD)
    ├── SSE Stream (session_update, log_update)
    └── Static File Server (public/)
         │
         ├── sessions/*.json   (세션 메타데이터)
         └── logs/YYYY-MM-DD/  (이벤트 로그 JSONL)
              │  SSE
              ▼
Web Dashboard (브라우저)
```

**핵심 설계 원칙:**
- 서버가 꺼져 있어도 Claude Code에 영향 없음 (hook이 실패해도 무시)
- idle time은 프론트엔드에서 계산 (SSE 트래픽 절약)
- 데이터는 로컬 파일시스템에 저장 (DB 불필요)

---

## 3. 데이터 수집 — Claude Code Hooks

### 3.1 활용하는 Hook 이벤트 (6개)

| Event | 용도 | 주요 필드 |
|-------|------|-----------|
| `SessionStart` | 세션 생성/재개 | `source` (startup/resume) |
| `SessionEnd` | 세션 종료 | `reason` (prompt_input_exit 등) |
| `UserPromptSubmit` | 사용자 입력 기록 | `prompt` (프롬프트 텍스트) |
| `Stop` | 응답 완료 → 입력대기 | `last_assistant_message` (응답 텍스트), `stop_hook_active` |
| `PostToolUse` | 도구 사용 추적 | `tool_name`, `tool_input` |
| `Notification` | 알림/권한 요청 | `notification_type` (permission_prompt/idle_prompt) |

### 3.2 실제 Hook 입력 데이터 구조

모든 hook은 stdin으로 JSON을 수신. 공통 필드:

```json
{
  "session_id": "0883d020-c2d3-4bde-8f42-29c73317802c",
  "transcript_path": "/Users/.../{session-id}.jsonl",
  "cwd": "/Users/ethankim/my-project",
  "permission_mode": "default",
  "hook_event_name": "Stop"
}
```

이벤트별 추가 필드 (실제 확인된 구조):

```json
// UserPromptSubmit — 프롬프트는 "prompt" 필드로 전달 (message 아님)
{ "prompt": "테스트 코드 작성해줘" }

// Stop — Claude의 마지막 응답 포함
{ "last_assistant_message": "테스트 코드를 작성했습니다...", "stop_hook_active": false }

// PostToolUse
{ "tool_name": "Bash", "tool_input": { "command": "npm test", "description": "Run tests" } }

// SessionStart
{ "source": "startup" }

// SessionEnd
{ "reason": "prompt_input_exit" }

// Notification
{ "notification_type": "permission_prompt" }
```

### 3.3 Hook 스크립트

**`~/.claude/hooks/dashboard-hook.sh`** — `claude-dash init` 시 자동 복사

```bash
#!/bin/bash
INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')
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

### 3.4 Hook 등록

`claude-dash init`이 `~/.claude/settings.json`에 자동 등록.
기존 hooks(알림 등)를 유지하면서 dashboard hook을 append하고, 중복 등록을 방지.

---

## 4. 데이터 모델

### 4.1 세션 메타데이터 (`~/.claude-dashboard/sessions/{id}.json`)

```typescript
interface Session {
  sessionId: string;
  cwd: string;
  projectName: string;       // 기본: path.basename(cwd), 사용자 커스텀 가능
  customName: boolean;        // true면 SessionStart로 덮어쓰이지 않음
  status: SessionStatus;
  startedAt: string;
  lastActivityAt: string;
  lastEvent: string;
  lastPrompt: string | null;
  lastResponse: string | null; // Stop 이벤트의 last_assistant_message
  lastToolUsed: string | null;
  idleSince: string | null;    // waiting 상태 진입 시각 (프론트엔드에서 카운트)
  endedAt: string | null;
  endReason: string | null;
  totalEvents: number;
}

type SessionStatus = 'active' | 'waiting_input' | 'waiting_permission' | 'ended' | 'disconnected';
```

**상태 전이 규칙:**

```
SessionStart       → active, idleSince: null
UserPromptSubmit   → active, idleSince: null, lastPrompt 갱신
PostToolUse        → active, idleSince: null, lastToolUsed 갱신
Stop               → waiting_input, idleSince: now(), lastResponse 갱신
Notification       → waiting_input/waiting_permission, idleSince: now()
SessionEnd         → ended, idleSince: null
프로세스 미감지     → disconnected
```

### 4.2 이벤트 로그 (`~/.claude-dashboard/logs/{YYYY-MM-DD}/{id}.jsonl`)

```typescript
interface LogEvent {
  ts: string;
  event: string;
  sessionId: string;
  cwd?: string;
  source?: string;
  reason?: string;
  tool?: string;
  input?: Record<string, unknown>;
  prompt?: string;
  response?: string;           // Stop 시 Claude 응답
  notificationType?: string;
}
```

---

## 5. API

### 구현 완료

| Method | Endpoint | 설명 |
|--------|----------|------|
| `POST` | `/api/events` | Hook 이벤트 수신. 세션 upsert + 로그 append + SSE 브로드캐스트 |
| `GET` | `/api/sessions` | 세션 목록 (query: `?status=active,waiting_input`) |
| `GET` | `/api/sessions/:id` | 세션 상세 |
| `PATCH` | `/api/sessions/:id` | 세션 이름 변경 (`{ projectName: "..." }`) |
| `GET` | `/api/logs` | 로그 조회 (query: `?date=`, `?sessionId=`, `?limit=`, `?offset=`) |
| `DELETE` | `/api/logs` | 로그 삭제 (query: `?before=YYYY-MM-DD`) |
| `GET` | `/api/events/stream` | SSE 스트림 (`session_update`, `log_update` 이벤트) |

---

## 6. 프론트엔드 (현재 상태)

### 6.1 구현된 기능

- **세션 카드**: 상태 아이콘, 프로젝트명, cwd, 마지막 활동
- **Idle Time 실시간 카운트**: `idleSince` 기반 `⏱ idle MM:SS` (1초 간격, 프론트엔드 계산)
- **응답 표시**: waiting_input 상태에서 Claude의 마지막 응답 표시 (`🤖 "..."`)
- **view 모달**: 긴 응답/프롬프트를 view 버튼으로 전체 보기
- **커스텀 세션 이름**: ✏️ 버튼으로 세션 이름 변경
- **히스토리**: 프로젝트명 + 상태 아이콘으로 표시, 실시간 SSE 갱신
- **SSE 자동 재연결**: 연결 끊김 시 3초 후 재시도
- **다크 테마**: CSS Variables 기반

### 6.2 상태 아이콘

| 상태 | 아이콘 | 색상 | 설명 |
|------|--------|------|------|
| `active` | 🟢 | `#22c55e` | Claude가 응답 생성 중 / 도구 실행 중 |
| `waiting_input` | 🟡 | `#eab308` | 사용자 입력 대기 |
| `waiting_permission` | 🟠 | `#f97316` | 권한 승인 대기 |
| `ended` | ⚪ | `#9ca3af` | 정상 종료 |
| `disconnected` | 🔴 | `#ef4444` | 프로세스 감지 불가 |

---

## 7. CLI

### 구현된 명령어

| 명령 | 설명 |
|------|------|
| `claude-dash init` | hooks 등록 + hook 스크립트 복사 + 데이터 디렉토리 생성 |
| `claude-dash start [-p port]` | 대시보드 서버 시작 (기본: 7420) |
| `claude-dash stop` | PID 파일 기반 서버 종료 |
| `claude-dash status` | 터미널에서 세션 상태 확인 |
| `claude-dash open [-p port]` | 서버 시작 + 브라우저 자동 열기 |

### 미구현 CLI

| 명령 | 설명 |
|------|------|
| `claude-dash clean --before YYYY-MM-DD` | 특정 날짜 이전 로그 삭제 |
| `claude-dash logs [--date] [--session]` | 터미널에서 로그 조회 |

---

## 8. 프로젝트 구조

```
claude-multiple-dashboard/
├── bin/
│   └── claude-dash.ts           # CLI 엔트리포인트 (Commander)
├── src/
│   ├── server.ts                # Fastify 서버 (createServer export)
│   ├── config.ts                # 데이터 디렉토리 경로 (env override 가능)
│   ├── types.ts                 # 공유 타입
│   ├── routes/
│   │   ├── events.ts            # POST /api/events
│   │   ├── sessions.ts          # GET/PATCH /api/sessions
│   │   ├── logs.ts              # GET/DELETE /api/logs
│   │   └── stream.ts            # SSE (session_update + log_update)
│   └── services/
│       ├── session-store.ts     # 세션 CRUD + 상태 전이 + rename
│       ├── log-store.ts         # JSONL append/read/delete + SSE broadcast
│       ├── event-bus.ts         # EventEmitter (session_update, log_update)
│       └── process-scanner.ts   # 30s 간격 프로세스 생존 확인
├── public/
│   ├── index.html               # 대시보드 HTML (모달 포함)
│   ├── app.js                   # 메인 JS (Vanilla, ES Module)
│   └── styles/main.css          # 다크 테마 CSS
├── hooks/
│   └── dashboard-hook.sh        # init 시 ~/.claude/hooks/ 에 복사
├── tests/
│   ├── session-store.test.ts    # 상태 전이 테스트
│   ├── log-store.test.ts        # JSONL read/write 테스트
│   ├── event-bus.test.ts        # 브로드캐스트 테스트
│   └── api.test.ts              # Fastify inject 통합 테스트
├── docs/
│   ├── prd.md                   # 이 문서
│   └── todo.md                  # 작업 추적
├── CLAUDE.md                    # 개발 가이드 + 원칙
└── README.md                    # 설치 & 사용법
```

---

## 9. 남은 작업

### Phase 2: 웹 대시보드 완성

**2-1. 세션 상세 뷰**
- 세션 카드 클릭 → 사이드 패널 열기
- 타임라인 형태로 프롬프트(💬), 응답(🤖), 도구 사용, Stop 이벤트를 시간순 표시
- 해당 세션의 로그만 API에서 필터링 조회 (`GET /api/logs?sessionId=...`)
- 프롬프트/응답 쌍을 대화 형태로 시각화

**2-2. 히스토리 개선**
- 날짜 선택 드롭다운 (최근 7일)
- 페이지네이션 또는 무한 스크롤 (현재 50개 고정)

**2-3. UI 다듬기**
- 세션 카드 정렬: active → waiting → ended, 같은 상태 내 최근 활동순
- 빈 상태 메시지 개선 (첫 사용 시 `claude-dash init` 안내)
- API 호출 로딩/에러 상태 처리

### Phase 3: 안정화 & 고도화

**3-1. 로그 관리**
- `claude-dash clean --before YYYY-MM-DD` CLI 명령
- `logRetentionDays` 기반 자동 정리 (서버 시작 시 체크)

**3-2. 검색 & 필터**
- 히스토리에서 프로젝트명/도구명으로 필터링 UI
- 프롬프트/파일명 텍스트 검색

**3-3. UX 고도화**
- 키보드 단축키 (j/k 세션 이동, Enter 상세, Esc 닫기)
- 반응형 레이아웃 (모바일/태블릿 대응)
- 알림 뱃지 (permission_prompt 대기 세션 수를 탭 타이틀에 표시)
- 데스크톱 알림 (Notification API — 세션이 일정 시간 이상 idle 시)

**3-4. 세션 관리 (생성/종료)**

대시보드에서 세션을 모니터링하는 것을 넘어, 직접 생성/종료할 수 있는 기능.

*세션 종료:*
- `POST /api/sessions/:id/kill` — 프로세스 탐색 후 SIGTERM 전송
- `transcript_path` 또는 `session_id`로 `ps aux | grep {session_id}` → PID 획득 → kill
- 대시보드 세션 카드에 ✕ 종료 버튼 추가

*새 세션 열기:*
- `POST /api/sessions/launch` — 새 터미널 창에서 Claude Code 실행
- macOS: `osascript`로 Terminal.app 또는 iTerm2에 `cd {path} && claude` 전달
- 대시보드 헤더에 "+ 새 세션" 버튼, 프로젝트 경로 입력

*알려진 이슈 & 제약:*

| 이슈 | 설명 | 대응 방안 |
|------|------|-----------|
| 프로세스 식별 | `session_id`로 PID를 찾으려면 `ps aux` 출력에서 매칭해야 함. Claude Code가 session_id를 프로세스 인자로 노출하지 않을 수 있음 | `transcript_path` 경로로 `lsof`/`fuser`를 통해 해당 파일을 열고 있는 프로세스를 역추적 |
| 비정상 종료 | SIGTERM으로 종료 시 Claude Code의 정상 종료 흐름(세션 저장 등)을 타지 않을 수 있음 | SIGTERM 먼저 시도 → 5초 대기 → 응답 없으면 사용자에게 강제 종료(SIGKILL) 확인 |
| 터미널 종속 | 새 세션은 터미널 앱에 의존. iTerm2/Terminal.app/Warp 등 사용자 환경에 따라 osascript가 다름 | 설정에서 터미널 앱 선택 가능하게 하거나, `TERM_PROGRAM` 환경변수로 자동 감지 |
| macOS 전용 | osascript는 macOS 전용. Linux에서는 다른 방식 필요 | macOS: osascript, Linux: `gnome-terminal`/`xterm` 등 분기 처리. 플랫폼 감지 |
| 권한 이슈 | 대시보드 서버가 다른 사용자의 프로세스를 kill할 수 없음 | 같은 사용자(로컬) 환경 전제. 원격 접근 시 인증 필요 (현재 스코프 외) |
| SessionEnd 미발생 | SIGTERM으로 종료 시 Claude Code가 SessionEnd hook을 발생시키지 않을 수 있음 | 프로세스 스캐너(30s)가 disconnected로 전환하여 보완 |

**3-5. npm 배포**
- `bin` 필드 + 빌드 파이프라인 구성
- `npx claude-dash` 글로벌 실행 지원
- npm publish

---

## 10. 기술 스택

| 구성요소 | 기술 | 버전 |
|----------|------|------|
| Runtime | Node.js | v25 |
| Language | TypeScript (strict) | 5.9 |
| Server | Fastify | 5 |
| Static Files | @fastify/static | 9 |
| CLI | Commander | 14 |
| Test | Vitest | 4 |
| Dev Runner | tsx | latest |
| Real-time | SSE (EventSource) | native |
| Frontend | Vanilla JS (ES Module) | no build |
| Storage | Local filesystem (JSON + JSONL) | — |
| Hook Script | Bash + jq + curl | — |

---

## 11. 제약사항 & 주의사항

| 항목 | 설명 | 대응 |
|------|------|------|
| hooks 입력 구조 | Claude Code 업데이트 시 필드명 변경 가능 | 실제 데이터 기반 타입 정의, 옵셔널 처리 |
| 강제 종료 감지 | `kill -9` 시 SessionEnd 미발생 | 프로세스 스캐너가 보완 (30s 간격) |
| 기존 hooks 공존 | 사용자의 기존 hooks와 충돌 가능 | 기존 배열에 append, 덮어쓰지 않음 |
| 디스크 사용량 | JSONL 로그 무한 증가 | logRetentionDays 자동 정리 (Phase 3) |
| 서버 미실행 | hook이 POST 실패 → 이벤트 유실 | 의도된 동작. 1s timeout으로 Claude에 영향 없음 |
| CRLF 이슈 | Windows에서 hook 스크립트 생성 시 | init 시 LF 강제 적용 필요 (경험적 이슈) |
| 세션 종료 | SIGTERM 시 정상 종료 흐름 미보장 | 단계적 종료(SIGTERM → 대기 → 확인) + 프로세스 스캐너 보완 |
| 세션 생성 | 터미널 앱/OS 종속적 | 플랫폼별 분기 처리, 설정으로 터미널 앱 선택 가능 |

---

## 12. 성공 지표

- [x] Claude Code 세션 시작/종료가 즉시 대시보드에 반영
- [x] 3개 이상의 동시 세션을 안정적으로 모니터링
- [x] 서버 미실행 시 Claude Code 성능에 영향 없음
- [x] `claude-dash init` 한 번으로 셋업 완료
- [x] 사용자 프롬프트와 Claude 응답을 대시보드에서 확인 가능
- [ ] 세션 상세 타임라인에서 전체 대화 흐름 파악 가능
- [ ] 7일간의 히스토리를 1초 이내에 로딩
- [ ] npm 글로벌 설치로 어디서든 사용 가능
