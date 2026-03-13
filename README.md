# Claude Multiple Dashboard

Claude Code를 **병렬로 여러 세션** 띄워 작업할 때, 모든 세션의 상태를 **한눈에 모니터링**하는 대시보드입니다.

## 왜 필요한가?

- Claude Code를 프로젝트별로 동시에 3~5개 세션을 띄워 사용
- 어떤 세션이 작업 중이고, 어디에 입력이 필요한지 파악하기 어려움
- 응답 완료 후 방치되는 세션을 놓치면 생산성 낭비

## 핵심 기능

- **실시간 세션 모니터링** — 🟢 작업중 / 🟡 입력대기 / 🟠 권한대기 / ⚪ 종료 / 🔴 연결끊김
- **Idle Time 실시간 카운트** — 응답 대기 상태 진입 시점부터 `⏱ idle MM:SS` 실시간 표시
- **프롬프트 & 응답 추적** — 사용자 프롬프트와 Claude의 마지막 응답을 대시보드에서 확인
- **작업 로그 적재** — Claude Code hooks를 통해 세션 이벤트를 자동 수집 (JSONL)
- **실시간 히스토리** — SSE 기반으로 세션 카드와 활동 로그가 실시간 갱신
- **하이브리드 UI** — `claude-dash` CLI + 웹 대시보드

## 설치 & 설정

### 1. 프로젝트 클론 & 의존성 설치

```bash
git clone https://github.com/hey00507/claude-multiple-dashboard.git
cd claude-multiple-dashboard
npm install
```

### 2. 초기화

```bash
npm run dash init
```

이 명령은 다음을 자동으로 수행합니다:

- `~/.claude/hooks/dashboard-hook.sh` — hook 스크립트 복사 (실행 권한 설정)
- `~/.claude/settings.json` — 6개 이벤트에 dashboard hook 등록 (기존 hooks 유지)
  - `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `PostToolUse`, `Notification`
- `~/.claude-dashboard/` — 데이터 디렉토리 생성 (sessions, logs, config.json)

### 3. 대시보드 서버 시작

```bash
# 서버 시작 (기본 포트: 7420)
npm run dash start

# 또는 서버 시작 + 브라우저 자동 열기
npm run dash open

# 포트 변경
npm run dash start -- -p 8080
```

### 4. 사용하기

서버가 실행된 상태에서 Claude Code를 사용하면, hook이 자동으로 이벤트를 대시보드 서버에 전달합니다.

- **웹 대시보드**: http://localhost:7420 에서 실시간 모니터링
- **터미널**: `npm run dash status` 로 세션 상태 확인

### 5. 서버 종료

```bash
npm run dash stop
```

## CLI 명령어

| 명령 | 설명 |
|------|------|
| `npm run dash init` | hooks 등록 및 데이터 디렉토리 초기화 |
| `npm run dash start` | 대시보드 서버 시작 |
| `npm run dash stop` | 대시보드 서버 종료 |
| `npm run dash status` | 터미널에서 세션 상태 확인 |
| `npm run dash open` | 서버 시작 + 브라우저 열기 |

## 데이터 저장 위치

```
~/.claude-dashboard/
├── sessions/          # 세션 메타데이터 (JSON)
├── logs/
│   └── YYYY-MM-DD/    # 날짜별 이벤트 로그 (JSONL)
└── config.json        # 설정
```

## 개발

```bash
npm run dev          # 개발 서버 (watch mode)
npm test             # 테스트 실행
npx tsc --noEmit     # 타입 체크
```

## 기술 스택

- **Runtime**: Node.js
- **Language**: TypeScript (strict)
- **Server**: Fastify 5
- **Frontend**: Vanilla JS (빌드 도구 없음)
- **Real-time**: SSE (Server-Sent Events)
- **Test**: Vitest

## 동작 원리

```
Claude Code Session
    ↓ (hook event)
dashboard-hook.sh
    ↓ (curl POST, non-blocking)
Dashboard Server (Fastify)
    ↓ (SSE broadcast)
Web Dashboard (브라우저)
```

1. Claude Code의 hook 시스템이 세션 이벤트 발생 시 `dashboard-hook.sh` 실행
2. hook 스크립트가 JSON 데이터를 대시보드 서버에 POST (1초 timeout, non-blocking)
3. 서버가 세션 상태 갱신 + 로그 저장 + SSE로 브라우저에 실시간 전달
4. 서버가 꺼져 있어도 Claude Code에 영향 없음 (hook이 실패해도 무시)

## License

MIT
