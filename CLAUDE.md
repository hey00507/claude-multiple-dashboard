# Claude Multiple Dashboard — Development Guide

## 개발 원칙

1. **쓰지 않는 자원은 없앤다** — 미사용 import, 빈 디렉토리, 불필요한 의존성은 즉시 제거
2. **3번 이상 반복되면 메서드로 분리한다** — 중복 코드를 발견하면 공통 함수/유틸로 추출
3. **기능에는 테스트 코드를 작성한다** — TDD까지는 아니어도, 구현한 기능에 대한 테스트를 반드시 동반

## 기술 스택

- **Runtime**: Node.js v25 (LTS)
- **Language**: TypeScript 5.9 (strict mode)
- **Server**: Fastify 5
- **Static Files**: @fastify/static 9
- **CLI**: Commander 14
- **Dev**: tsx (watch mode), tsc (type check)

## 프로젝트 구조

```
src/
  server.ts              — Fastify 서버 메인
  types.ts               — 공유 타입 (Session, HookInput, LogEvent)
  routes/                — API 엔드포인트
    events.ts            — POST /api/events (hook 수신)
    sessions.ts          — GET /api/sessions
    logs.ts              — GET/DELETE /api/logs
    stream.ts            — GET /api/events/stream (SSE)
  services/              — 비즈니스 로직
    session-store.ts     — 세션 메타데이터 CRUD + 상태 전이
    log-store.ts         — JSONL 로그 read/append
    process-scanner.ts   — 프로세스 생존 확인
    event-bus.ts         — SSE 브로드캐스트
public/                  — 웹 대시보드 (Vanilla JS, 빌드 없음)
bin/                     — CLI 엔트리포인트
hooks/                   — Claude Code hook 스크립트
docs/                    — PRD 등 설계 문서
```

## 명령어

```bash
npm run dev       # 개발 서버 (tsx watch)
npm run build     # TypeScript 빌드
npm run dash      # CLI 실행 (tsx)
npx tsc --noEmit  # 타입 체크만
npm test          # 테스트 실행
```

## 데이터 저장 위치

- `~/.claude-dashboard/sessions/` — 세션 메타데이터 (JSON)
- `~/.claude-dashboard/logs/{YYYY-MM-DD}/` — 이벤트 로그 (JSONL)
- `~/.claude-dashboard/config.json` — 설정

## 상태 전이 규칙

```
SessionStart       → active, idleSince: null
UserPromptSubmit   → active, idleSince: null
PostToolUse        → active, idleSince: null
Stop               → waiting_input, idleSince: now()
Notification       → waiting_input/waiting_permission, idleSince: now()
SessionEnd         → ended, idleSince: null
프로세스 미감지     → disconnected, idleSince: null
```

## 코드 작성 시 주의사항

- 프론트엔드는 빌드 도구 없이 Vanilla JS (ES Module) — `public/` 아래에 직접 작성
- hook 스크립트(`hooks/dashboard-hook.sh`)는 서버 미실행 시에도 Claude Code에 영향 없어야 함 (non-blocking, timeout)
- SSE 스트림의 idle time 카운트는 서버가 아닌 프론트엔드에서 계산 (SSE 트래픽 절약)
