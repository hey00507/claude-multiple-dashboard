# Claude Multiple Dashboard

[English](README.md) | **한국어**

Claude Code를 **병렬로 여러 세션** 띄워 작업할 때, 모든 세션의 상태를 **한눈에 모니터링**하는 웹 대시보드입니다.

![세션 색상 적용 대시보드](docs/screenshots/session-colors.png)

---

## 핵심 기능

| 기능 | 설명 |
|------|------|
| **실시간 세션 모니터링** | 🟢 작업중 / 🟡 입력대기 / 🟠 권한대기 / ⚪ 종료 / 🔴 연결끊김 |
| **세션 색상** | 인라인 컬러 피커 + `/session-setting` 연동 |
| **알림 시스템** | 상태 변경, 권한 요청, idle 임계 초과 등 조건별 알림 + 사운드 |
| **Idle Time 카운트** | 응답 대기 시점부터 `⏱ idle MM:SS` 실시간 표시 |
| **모델 & 컨텍스트** | 세션 카드에 모델명, 컨텍스트 사용률(ctx: N%), 경과 시간 |
| **세션 메모** | 세션별 한줄 메모로 작업 내용 기록 |
| **색상 필터** | 원클릭 색상 dot으로 세션 필터링 |
| **세션 프리셋** | 프로젝트별 이름/색상 기본값 저장, 다음 세션에 자동 적용 |
| **통계 대시보드** | 이벤트/프롬프트/응답 수 + 도구 사용 Top 10 + 시간대별 히트맵 |
| **프로젝트 그룹핑** | 같은 디렉토리의 세션을 자동 그룹화 |
| **프롬프트 & 응답** | 사용자 프롬프트와 Claude 응답을 대시보드에서 확인 |
| **다크/라이트 테마** | 시스템 설정 연동 + 수동 토글 |
| **키보드 단축키** | j/k 탐색, / 검색, Enter 풀뷰, ? 도움말 |
| **데이터 내보내기** | 히스토리 JSON/CSV + 세션 트랜스크립트 Markdown |

### 다크 모드 + 상세 패널

![Dark Mode with Detail](docs/screenshots/dark-detail.png)

### 키보드 단축키

<img src="docs/screenshots/shortcuts.png" width="300" alt="키보드 단축키">

---

## 설치

### 전제 조건

- **Node.js** v20+
- **jq** (macOS: `brew install jq`)
- **Claude Code** CLI

### npm 글로벌 설치 (권장)

```bash
npm install -g claude-multiple-dashboard
```

### 설정 & 실행

```bash
# 1. 초기화 (hooks 등록 + 데이터 디렉토리 생성)
claude-dash init

# 2. 서버 시작 + 브라우저 열기
claude-dash open

# 3. Claude Code를 평소처럼 사용하면 자동으로 모니터링됩니다
```

### 소스에서 실행

```bash
git clone https://github.com/hey00507/claude-multiple-dashboard.git
cd claude-multiple-dashboard
npm install
npm run dash init
npm run dash open
```

---

## CLI 명령어

| 명령 | 설명 |
|------|------|
| `claude-dash init` | hooks 등록 및 데이터 디렉토리 초기화 |
| `claude-dash start [-p port]` | 대시보드 서버 시작 (기본: 7420) |
| `claude-dash stop` | 대시보드 서버 종료 |
| `claude-dash status` | 터미널에서 세션 상태 확인 |
| `claude-dash open [-p port]` | 서버 시작 + 브라우저 열기 |
| `claude-dash clean` | 오래된 로그 정리 (`--days N` 또는 `--before YYYY-MM-DD`) |

---

## 세션 프리셋 & 색상

스킬 파일을 Claude Code 명령어 디렉토리에 복사합니다:

```bash
cp commands/session-setting.md ~/.claude/commands/
```

사용법:

```bash
/session-setting name:대시보드 color:red             # 현재 세션만
/session-setting name:대시보드 color:red --save       # + 프로젝트 기본값으로 저장
/session-setting --list                              # 저장된 기본값 목록
/session-setting --remove                            # 현재 디렉토리 기본값 삭제
```

지원 색상: `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`

대시보드에서도 세션 카드의 색상 dot을 클릭하면 직접 색상을 변경할 수 있습니다.

프로젝트 기본값은 `~/.claude-dashboard/config.json`에 저장되며, 세션 시작 시 자동 적용됩니다.

---

## 아키텍처

```
Claude Code Sessions (A, B, C, ...)
    │  hook event (JSON stdin)
    ▼
dashboard-hook.sh (non-blocking, 1s timeout)
    │  curl POST
    ▼
Dashboard Server (Fastify 5)
    ├── REST API (세션/로그 CRUD + 통계)
    ├── SSE Stream (실시간 업데이트)
    └── Static Files (웹 대시보드)
         │
         ├── sessions/*.json    (세션 메타데이터)
         ├── logs/YYYY-MM-DD/   (JSONL, 30일+ 자동 .gz 압축)
         └── config.json        (세션 프리셋)
```

- 서버가 꺼져 있어도 Claude Code에 영향 없음
- 로컬 파일시스템 저장 (별도 DB 불필요)
- 30일 이상 로그 자동 gzip 압축
- 세션 이름은 3-tier fallback으로 유지 (/tmp → 세션 JSON → config 기본값)

---

## API 레퍼런스

### 이벤트

| Method | Endpoint | 설명 | 응답 |
|--------|----------|------|------|
| `POST` | `/api/events` | Claude Code hook 이벤트 수신 | `{ ok, sessionId, status }` |

### 세션

| Method | Endpoint | 설명 | 응답 |
|--------|----------|------|------|
| `GET` | `/api/sessions` | 세션 목록 (`?status=active,waiting_input`) | `Session[]` |
| `GET` | `/api/sessions/:id` | 세션 상세 | `Session` |
| `PATCH` | `/api/sessions/:id` | 이름/색상/메모 변경 (`{ projectName?, color?, memo? }`) | `Session` |
| `POST` | `/api/sessions/:id/kill` | 세션 종료 | `{ ok, method }` |
| `POST` | `/api/sessions/:id/pin` | 핀 토글 | `Session` |
| `DELETE` | `/api/sessions/:id` | 세션 + 로그 삭제 | `{ ok, logsDeleted }` |
| `DELETE` | `/api/sessions` | 비활성 세션 일괄 삭제 | `{ ok, deletedSessions, deletedLogs }` |
| `POST` | `/api/sessions/launch` | 새 세션 시작 (`{ cwd, terminalApp? }`) | `{ ok, cwd, terminal }` |
| `POST` | `/api/sessions/cleanup` | 비활성 세션 정리 | `{ ok, checked, ended, disconnected }` |

### 세션 기본값

| Method | Endpoint | 설명 | 응답 |
|--------|----------|------|------|
| `GET` | `/api/session-defaults` | 프로젝트별 기본값 목록 | `{ cwd: { name?, color? } }` |
| `PUT` | `/api/session-defaults` | 기본값 저장 (`{ cwd, name?, color? }`) | `{ ok, cwd }` |
| `DELETE` | `/api/session-defaults` | 기본값 삭제 (`{ cwd }`) | `{ ok, cwd }` |

### 로그 & 통계

| Method | Endpoint | 설명 | 응답 |
|--------|----------|------|------|
| `GET` | `/api/logs` | 로그 조회 (`?date=&sessionId=&search=&limit=&offset=`) | `LogEvent[]` |
| `DELETE` | `/api/logs` | 로그 삭제 (`?before=YYYY-MM-DD`) | `{ ok, deleted }` |
| `GET` | `/api/stats` | 일별 통계 (`?date=`) | `{ totalEvents, prompts, responses, sessions, tools }` |

### 실시간

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/events/stream` | SSE 스트림 (`session_update`, `log_update`) |

---

## 기술 스택

| 구성요소 | 기술 |
|----------|------|
| Runtime | Node.js v20+ |
| Language | TypeScript (strict) |
| Server | Fastify 5 |
| Frontend | Vanilla JS (ES Modules, 빌드 도구 없음) |
| Real-time | SSE |
| Storage | Local filesystem (JSON + JSONL + gzip) |
| Test | Vitest (76개) |
| CLI | Commander |

---

## 개발

```bash
npm run dev          # 개발 서버 (tsx watch mode)
npm test             # Vitest 테스트 실행
npx tsc --noEmit     # 타입 체크
npm run build        # TypeScript 빌드
```

---

## 프로젝트 상태

이 프로젝트는 **v0.5.0**에서 기능 완성 상태에 도달했으며, 유지보수 모드로 전환되었습니다.

[JetBrains Air](https://blog.jetbrains.com/ko/air/2026/03/air-launches-as-public-preview/) 등 IDE 통합 AI 에이전트 도구의 등장으로, 멀티 세션 관제 니즈가 IDE 네이티브 기능으로 자연스럽게 해소되고 있습니다 — 병렬 태스크 실행, 통합 대시보드, 내장 알림 시스템 등.

Claude Multiple Dashboard는 Claude Code CLI의 가벼운 독립형 세션 모니터링이 필요한 분들을 위해 현재 상태 그대로 계속 사용 가능합니다.

---

## 트러블슈팅

[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) 참조

---

## License

MIT
