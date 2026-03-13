# Claude Multiple Dashboard

Claude Code를 **병렬로 여러 세션** 띄워 작업할 때, 모든 세션의 상태를 **한눈에 모니터링**하는 웹 대시보드입니다.

<!-- 스크린샷: 대시보드 메인 화면 -->
<!-- ![Dashboard](docs/screenshots/dashboard-main.png) -->

---

## 왜 필요한가?

Claude Code를 프로젝트별로 3~5개 세션을 동시에 띄워 작업할 때:

- 어떤 세션이 작업 중이고, 어디에 **입력이 필요한지** 파악하기 어렵다
- 응답 완료 후 **방치되는 세션**을 놓치면 생산성이 낭비된다
- 각 세션에서 **어떤 작업이 진행됐는지** 추적하기 어렵다

이 대시보드는 모든 Claude Code 세션을 한 화면에서 실시간으로 모니터링하고, 세션별 활동 히스토리를 추적합니다.

---

## 핵심 기능

| 기능 | 설명 |
|------|------|
| **실시간 세션 모니터링** | 🟢 작업중 / 🟡 입력대기 / 🟠 권한대기 / ⚪ 종료 / 🔴 연결끊김 |
| **Idle Time 카운트** | 응답 대기 상태 진입 시점부터 `⏱ idle MM:SS` 실시간 표시 |
| **프롬프트 & 응답 추적** | 사용자 프롬프트와 Claude의 마지막 응답을 대시보드에서 확인 |
| **세션 상세 타임라인** | 세션 카드 클릭 → 사이드 패널에서 전체 활동 타임라인 조회 |
| **활동 히스토리** | 날짜별 조회 (최근 7일) + 이벤트/프로젝트 필터링 |
| **커스텀 세션 이름** | 세션 이름을 직접 변경 가능 (✏️ 버튼) |
| **실시간 갱신** | SSE 기반으로 세션 카드, 히스토리, 타임라인 모두 실시간 반영 |
| **CLI 지원** | 터미널에서도 세션 상태 확인 가능 |

---

## 아키텍처

```
┌─────────────────────────────────┐
│  Claude Code Sessions (A,B,C…)  │
│  (각각 독립된 터미널에서 실행)     │
└──────────┬──────────────────────┘
           │  hook event (JSON via stdin)
           ▼
┌─────────────────────────────────┐
│  dashboard-hook.sh              │
│  curl POST → localhost:7420     │
│  (non-blocking, 1s timeout)     │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  Dashboard Server (Fastify 5)   │
│  ├── POST /api/events ← 수신    │
│  ├── session-store (JSON 파일)   │
│  ├── log-store (JSONL 파일)      │
│  └── SSE broadcast ──────────┐  │
└──────────────────────────────┼──┘
                               │
                               ▼
                  ┌────────────────────┐
                  │  Web Dashboard     │
                  │  (브라우저)         │
                  │  localhost:7420    │
                  └────────────────────┘
```

**핵심 원칙:**
- 서버가 꺼져 있어도 Claude Code에 **영향 없음** (hook 실패 시 무시)
- idle time은 **프론트엔드에서 계산** (SSE 트래픽 절약)
- 데이터는 **로컬 파일시스템**에 저장 (별도 DB 불필요)

---

## 설치 & 설정

### 전제 조건

- **Node.js** v20 이상
- **jq** — JSON 파싱용 (macOS: `brew install jq`, 대부분 기본 설치됨)
- **curl** — HTTP 전송용 (대부분 기본 설치됨)
- **Claude Code** — CLI 버전이 설치되어 있어야 함

### 방법 1. npm 글로벌 설치 (권장)

```bash
npm install -g claude-multiple-dashboard
```

```bash
# 초기화 (hooks 등록 + 데이터 디렉토리 생성)
claude-dash init

# 서버 시작
claude-dash start

# 서버 시작 + 브라우저 자동 열기
claude-dash open
```

### 방법 2. 소스에서 직접 실행

```bash
git clone https://github.com/hey00507/claude-multiple-dashboard.git
cd claude-multiple-dashboard
npm install
```

```bash
npm run dash init
npm run dash start
# 또는
npm run dash open
```

### 초기화 (`init`)

`claude-dash init` (또는 `npm run dash init`) 명령 하나로 다음이 **자동 처리**됩니다:

| 작업 | 상세 |
|------|------|
| Hook 스크립트 복사 | `hooks/dashboard-hook.sh` → `~/.claude/hooks/dashboard-hook.sh` (실행 권한 설정) |
| Hook 이벤트 등록 | `~/.claude/settings.json`에 6개 이벤트 등록 (기존 hooks 유지, 중복 방지) |
| 데이터 디렉토리 생성 | `~/.claude-dashboard/` (sessions, logs, config.json) |

등록되는 6개 Hook 이벤트:

| Event | 역할 |
|-------|------|
| `SessionStart` | 세션 시작/재개 감지 |
| `SessionEnd` | 세션 종료 감지 |
| `UserPromptSubmit` | 사용자 프롬프트 기록 |
| `Stop` | Claude 응답 완료 → idle 상태 진입 |
| `PostToolUse` | 도구 사용 추적 (Bash, Read, Edit 등) |
| `Notification` | 알림/권한 요청 감지 |

### 사용하기

서버가 실행된 상태에서 **Claude Code를 평소처럼 사용**하면 됩니다.
Hook이 자동으로 이벤트를 대시보드 서버에 전달합니다.

- **웹 대시보드**: http://localhost:7420
- **터미널**: `claude-dash status`

<!-- 스크린샷: 세션 카드 + 사이드 패널 -->
<!-- ![Session Detail](docs/screenshots/session-detail.png) -->

### 서버 종료

```bash
claude-dash stop
```

---

## 대시보드 화면 구성

### 세션 카드

<!-- 스크린샷: 세션 카드 영역 -->
<!-- ![Session Cards](docs/screenshots/session-cards.png) -->

- 상태 아이콘 + 프로젝트명 + 작업 디렉토리
- idle time 실시간 카운트 (응답 대기 시)
- 마지막 프롬프트/응답 미리보기
- ✏️ 세션 이름 변경 가능
- 카드 클릭 → 우측 상세 패널 오픈

### 세션 상세 (사이드 패널)

<!-- 스크린샷: 상세 패널 -->
<!-- ![Detail Panel](docs/screenshots/detail-panel.png) -->

- 세션 메타 정보 (상태, 디렉토리, 시작/종료 시간, 총 이벤트 수)
- 타임라인: 프롬프트(💬), 응답(🤖), 도구 사용(🔧), 세션 이벤트를 시간순 표시
- 긴 내용은 "view full" 버튼으로 모달에서 전체 확인

### 활동 히스토리

<!-- 스크린샷: 히스토리 필터 -->
<!-- ![History](docs/screenshots/history-filters.png) -->

- 날짜 선택 (최근 7일 드롭다운)
- 이벤트 타입 필터: 전체 / 💬 프롬프트 / 🤖 응답 / 🔧 도구 / 세션
- 프로젝트별 필터
- 50개 단위 페이지네이션 ("더 보기" 버튼)

---

## CLI 명령어

| 명령 | 설명 |
|------|------|
| `claude-dash init` | hooks 등록 및 데이터 디렉토리 초기화 |
| `claude-dash start` | 대시보드 서버 시작 (기본: 포트 7420) |
| `claude-dash stop` | 대시보드 서버 종료 |
| `claude-dash status` | 터미널에서 세션 상태 확인 |
| `claude-dash open` | 서버 시작 + 브라우저 열기 |
| `claude-dash clean` | 오래된 로그 정리 (`--days N` 또는 `--before YYYY-MM-DD`) |

> 소스에서 실행 시 `claude-dash` 대신 `npm run dash`를 사용합니다.

```bash
# 포트 변경
claude-dash start -p 8080

# hook 스크립트가 config.json에서 포트를 자동으로 읽으므로 별도 수정 불필요
```

---

## 데이터 저장 위치

```
~/.claude-dashboard/
├── sessions/              # 세션 메타데이터 (JSON, 세션당 1파일)
├── logs/
│   └── YYYY-MM-DD/        # 날짜별 이벤트 로그 (JSONL, 세션당 1파일)
└── config.json            # 설정 (포트, 로그 보관 기간 등)
```

- 종료된 세션은 서버 시작 시 **24시간 후 자동 정리**
- 로그는 날짜별 디렉토리에 JSONL 형식으로 저장

---

## 개발

```bash
npm run dev          # 개발 서버 (tsx watch mode)
npm test             # Vitest 테스트 실행
npx tsc --noEmit     # 타입 체크
```

### 프로젝트 구조

```
claude-multiple-dashboard/
├── bin/
│   └── claude-dash.ts           # CLI 엔트리포인트 (Commander)
├── src/
│   ├── server.ts                # Fastify 서버
│   ├── config.ts                # 데이터 경로, 포트 설정
│   ├── types.ts                 # 공유 타입 (Session, HookInput, LogEvent)
│   ├── routes/
│   │   ├── events.ts            # POST /api/events (hook 수신)
│   │   ├── sessions.ts          # GET/PATCH/DELETE /api/sessions
│   │   ├── logs.ts              # GET/DELETE /api/logs
│   │   └── stream.ts            # SSE 스트림 (session_update, log_update)
│   └── services/
│       ├── session-store.ts     # 세션 CRUD + 상태 전이
│       ├── log-store.ts         # JSONL read/append
│       ├── event-bus.ts         # SSE 브로드캐스트
│       └── process-scanner.ts   # 프로세스 생존 확인 (30s 간격)
├── public/
│   ├── index.html               # 대시보드 HTML
│   ├── app.js                   # 프론트엔드 JS (Vanilla, ES Module)
│   └── styles/main.css          # 다크 테마 CSS
├── hooks/
│   └── dashboard-hook.sh        # Claude Code hook 스크립트
├── tests/                       # Vitest 테스트 (35개)
└── docs/
    ├── prd.md                   # PRD (설계 문서)
    └── todo.md                  # 작업 추적
```

### 기술 스택

| 구성요소 | 기술 |
|----------|------|
| Runtime | Node.js |
| Language | TypeScript (strict) |
| Server | Fastify 5 |
| Frontend | Vanilla JS (빌드 도구 없음) |
| Real-time | SSE (Server-Sent Events) |
| Storage | Local filesystem (JSON + JSONL) |
| Test | Vitest |
| CLI | Commander |

---

## 상태 아이콘 가이드

| 상태 | 아이콘 | 색상 | 의미 |
|------|--------|------|------|
| `active` | 🟢 | 초록 | Claude가 응답 생성 중 / 도구 실행 중 |
| `waiting_input` | 🟡 | 노랑 | 응답 완료, 사용자 입력 대기 |
| `waiting_permission` | 🟠 | 주황 | 권한 승인 대기 (도구 실행 허가 등) |
| `ended` | ⚪ | 회색 | 세션 정상 종료 |
| `disconnected` | 🔴 | 빨강 | 프로세스 감지 불가 (비정상 종료 등) |

---

## FAQ

### Q. 서버를 안 켜면 Claude Code에 영향이 있나요?
**아닙니다.** hook 스크립트가 `--connect-timeout 1`로 POST를 시도하고, 실패하면 무시합니다. Claude Code 성능에 전혀 영향 없습니다.

### Q. 포트를 변경하고 싶어요
`claude-dash start -p 8080`처럼 `-p` 옵션만 주면 됩니다. hook 스크립트가 `config.json`에서 포트를 자동으로 읽으므로 별도 수정이 필요 없습니다.

### Q. 기존에 쓰던 Claude hooks가 있는데 충돌하나요?
`claude-dash init`은 기존 hooks를 **유지**하면서 dashboard hook을 추가합니다. 중복 등록도 방지합니다.

### Q. 데이터를 초기화하고 싶어요
```bash
rm -rf ~/.claude-dashboard
npm run dash init    # 재초기화
```

---

## License

MIT
