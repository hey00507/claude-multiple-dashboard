# TODO

## 완료된 작업

### Phase 1: 데이터 수집 인프라 + 테스트 ✅

- [x] 프로젝트 초기화 (package.json, tsconfig, 의존성)
- [x] 타입 정의 (Session, HookInput, LogEvent)
- [x] Hook 스크립트 작성 (dashboard-hook.sh)
- [x] 이벤트 수신 API (POST /api/events)
- [x] 세션 저장소 (session-store.ts — upsert, 상태 전이)
- [x] 로그 저장소 (log-store.ts — JSONL append/read)
- [x] SSE 스트림 (GET /api/events/stream + event-bus)
- [x] 세션 목록 API (GET /api/sessions)
- [x] 로그 조회 API (GET /api/logs)
- [x] 프로세스 스캐너 기본 구현
- [x] CLI (init, start, stop, status, open)
- [x] Vitest 테스트 35개 → 55개 (session-store, log-store, event-bus, API, pty-manager)
- [x] E2E 검증 (실제 Claude Code 세션 이벤트 수신 확인)

### 추가 구현 완료 ✅

- [x] `prompt` 필드 수정 (Claude Code는 `message`가 아닌 `prompt`로 전달)
- [x] `lastResponse` — Stop 이벤트의 `last_assistant_message` 필드로 응답 추적
- [x] 히스토리 실시간 SSE 갱신 (log_update 이벤트)
- [x] view 모달 — 긴 응답/프롬프트 전체 보기
- [x] 커스텀 세션 이름 (PATCH /api/sessions/:id, ✏️ rename 버튼)
- [x] 히스토리 프로젝트명 + 상태 아이콘 표시 (sessionId → projectName)
- [x] 히스토리 테이블 정렬 수정 (time/project/detail 고정 그리드)
- [x] README 설치 가이드 작성
- [x] 히스토리 이벤트 타입 필터 (전체/프롬프트/응답/도구/세션)
- [x] 히스토리 프로젝트별 필터 드롭다운
- [x] README 상세 리뉴얼 (아키텍처, 화면 구성, FAQ, 스크린샷 자리)

---

## Phase 2: 웹 대시보드 완성

### 2-1. 세션 상세 뷰 ✅
- [x] 세션 카드 클릭 → 사이드 패널 (420px)
- [x] 타임라인 뷰: 프롬프트(💬), 응답(🤖), 도구 사용, Stop 이벤트 시간순 표시
- [x] 해당 세션의 로그만 필터링 조회 (GET /api/logs?sessionId=...)
- [x] 메타 정보 (상태, 디렉토리, 시작/종료 시간, 총 이벤트)
- [x] 삭제 버튼 (비활성 세션만)
- [x] SSE 실시간 타임라인 갱신
- [x] 긴 내용 view full 버튼

### 2-2. 히스토리 개선 ✅
- [x] 날짜 선택 드롭다운 (최근 7일)
- [x] 페이지네이션 (더 보기 버튼, 50개 단위)
- [x] SSE 실시간 갱신은 오늘 날짜 조회 시에만 동작

### 2-3. UI 다듬기 ✅
- [x] 세션 카드 정렬: active → waiting_permission → waiting_input → disconnected → ended
- [x] 빈 상태 메시지 개선 (첫 사용 가이드: claude-dash init 안내)
- [x] 로딩/에러 상태 처리 (세션, 히스토리 모두)
- [x] 헤더에 활성 세션 수 표시
- [x] Esc 키: 모달 열려있으면 모달 닫기, 아니면 디테일 패널 닫기

---

## Phase 3: 안정화 & 고도화

### 3-1. 로그 관리 ✅
- [x] `claude-dash clean --before YYYY-MM-DD` CLI 명령
- [x] `claude-dash clean --days N` (기본 30일)
- [x] logRetentionDays 기반 자동 정리 (서버 시작 시)

### 3-2. 검색 & 필터 ✅
- [x] 이벤트 타입 필터 (프롬프트/응답/도구/세션) — Phase 2에서 완료
- [x] 프로젝트별 필터 드롭다운 — Phase 2에서 완료
- [x] 텍스트 검색 (프롬프트/응답/도구명/파일경로/명령어, 디바운스 200ms)

### 3-3. UX 고도화 ✅
- [x] 키보드 단축키 (j/k 세션 이동, / 검색 포커스, Esc 닫기)
- [x] 알림 뱃지 — 탭 타이틀에 대기 세션 수 표시 `(N) Claude Dashboard`
- [x] 데스크톱 알림 (Notification API — 세션이 active→waiting 전환 시, 백그라운드일 때만)
- [x] 반응형 레이아웃 (1024px 이하: 패널 오버레이, 768px 이하: 스택 레이아웃, 480px 이하: 모바일)

### 3-4. 세션 관리 (생성/종료) ✅
- [x] 세션 종료: POST /api/sessions/:id/kill — ps+grep로 프로세스 탐색 → SIGTERM, 못 찾으면 ended 처리
- [x] 새 세션 열기: POST /api/sessions/launch — osascript(macOS) / x-terminal-emulator(Linux)
- [x] 대시보드 UI: 상세 패널에 ⏹ 종료 버튼 (활성 세션만), 헤더에 "+ 새 세션" 버튼

### 3-5. npm 배포 ✅
- [x] `bin` 필드 설정 (`dist/bin/claude-dash.js`)
- [x] `files` 필드 (`dist/`, `public/`, `hooks/`)
- [x] 빌드 파이프라인 (tsc + postbuild shebang/chmod)
- [x] dev/dist 경로 호환 (hooks, public 양방향 resolve)
- [x] `npm pack` → 글로벌 설치 테스트 통과
- [x] `claude-dash` 글로벌 명령어 동작 확인 (init, start, stop, status, clean)
- [x] npm publish (v0.1.0 배포 완료)

---

## Phase 4: v0.3.0 — 데이터 관리 & UX 확장

### 4-1. 데이터 내보내기 + 세션 삭제 + 프로젝트 그룹핑 ✅
- [x] **히스토리 내보내기** — 현재 필터 기준으로 JSON/CSV 다운로드 버튼
- [x] **세션 + 로그 통합 삭제** — 세션 삭제 시 관련 로그도 함께 제거, 비활성 세션 일괄 삭제 버튼
- [x] **프로젝트 디렉토리별 세션 그룹핑** — 같은 cwd의 세션을 그룹으로 묶어서 표시

### 4-2. 테마 & 키보드 확장 ✅
- [x] **다크/라이트 테마 토글** — 시스템 설정 연동 + 수동 토글 버튼, localStorage 저장
- [x] **Enter 키 활용** — 선택된 세션에서 Enter → 세션 상세 풀뷰 전환 (사이드패널 → 전체화면)

### 4-3. 통계 & 코드 구조 ✅
- [x] **세션 통계 대시보드** — GET /api/stats API + 통계 카드 + 도구 사용 Top 10 바 차트
- [x] **app.js 모듈 분리** — 973줄 → 7개 ES Module (state/utils/sessions/history/detail/sse/theme)

### 4-4. 배포 ✅
- [x] version bump → 0.3.0
- [x] CHANGELOG 작성
- [x] 키보드 단축키 도움말 패널 (`?` 키 / 버튼)
- [x] npm publish (v0.3.0)
- [x] GitHub release + tag

### 4-5. 추가 개선 ✅
- [x] 트러블슈팅 가이드 (`docs/TROUBLESHOOTING.md`)
- [x] 통계 실시간 갱신 (SSE log_update → 디바운스 500ms)
- [x] 통계 카드 클릭 → 히스토리 필터 연동 + 스크롤
- [x] PAGE_SIZE 50 → 200 (필터 시 충분한 양 표시)
- [x] 삭제 후 히스토리 + 통계 즉시 갱신

---

## Phase 5: 브라우저 터미널 — v0.4.0

대시보드 안에서 Claude Code 세션을 직접 실행하고 상호작용하는 핵심 기능.

### 5-1. 터미널 백엔드 ✅
- [x] `node-pty` ^1.1.0 + `@fastify/websocket` ^11.2.0 의존성 추가
- [x] WebSocket 엔드포인트 (`GET /ws/terminal/:ptyId`)
- [x] PTY 생성/관리 서비스 (`pty-manager.ts`)
  - spawn `claude` 프로세스 (login shell), PTY ↔ WebSocket 브릿지
  - 세션 종료 시 PTY 정리 (30s linger + 자동 cleanup)
  - DA1/DA2/Kitty keyboard protocol 자동 응답
  - scrollback buffer (MAX_SCROLLBACK 5000 chunks)
  - `linkSessionToPty` — hook session_id ↔ PTY cwd 매칭
- [x] 세션 런치 모달 — PTY (브라우저) vs 외부 터미널 (Ghostty, iTerm2, Warp, Alacritty) 선택

### 5-2. 터미널 프론트엔드 ✅
- [x] `xterm.js` v5 + `xterm-addon-fit` 통합 (CDN)
- [x] 상세 패널에 "타임라인 / 터미널" 탭 전환 UI + 연결 상태 표시
- [x] 터미널 크기 자동 조정 (fit addon + resize 이벤트)
- [x] 연결 끊김 시 자동 재연결 (2s 간격) + 상태 표시 (한국어)

### 5-3. 멀티 터미널 ✅
- [x] 터미널 그리드 뷰 — 전체 PTY 세션을 동시에 표시 (1→1col, 2~4→2col, 5+→3col)
- [x] 각 셀 독립 xterm.js 인스턴스 + WebSocket 연결
- [x] 비활성 PTY 백그라운드 유지

### 5-4. 추가 구현 ✅
- [x] 세션 정리 버튼 — 프로세스 없는 세션 일괄 종료
- [x] 강제 종료 — 프로세스 못 찾아도 ended 처리 + toast 피드백
- [x] Session 타입에 `source: 'hook' | 'pty'`, `ptyId` 필드 추가

### 5-5. 안정화 ✅
- [x] PTY ↔ 그리드 전환 시 xterm 이중연결 방지
- [x] 외부 터미널 세션 상태 표시 정확도 개선
- [x] 세션 색상 지원 (Session.color, PATCH API, CSS data-color 틴트)
- [x] /session-setting 스킬 연동 (대시보드 세션 파일 원자적 업데이트)
- [ ] 전체 E2E 테스트 보강

### 5-6. 보안 (미구현)
- [ ] API Key 인증 (config.json에 설정, 헤더/쿠키로 검증)
- [ ] localhost 외 접근 시 인증 필수 강제
- [ ] WebSocket 연결 시 인증 검증

---

## Phase 6: 안정성 & 데이터 무결성 ✅

### 6-1. 파일 I/O 안정화 ✅
- [x] JSONL 원자적 쓰기 — fd open/write/close + 세션은 temp→rename
- [x] 깨진 JSONL 라인 자동 스킵 (크래시 복구)

### 6-2. 스토리지 최적화 ✅
- [x] 로그 압축 — 30일+ 로그 .gz 자동 압축 (서버 시작 시) + 투명한 .gz 읽기
- [x] 서버사이드 검색 — GET /api/logs?search= 파라미터 추가

---

## Phase 7: UX 개선

### 7-1. 즉시 적용 ✅
- [x] 응답/프롬프트 복사 버튼 (원클릭 클립보드 + toast)
- [x] 날짜 선택 확장 — 7일 → 30일
- [x] 세션 즐겨찾기/핀 — POST /api/sessions/:id/pin + 상단 고정 정렬

### 7-2. 데이터 활용 ✅
- [x] 세션 트랜스크립트 Markdown 내보내기 — 상세 패널 "MD" 버튼, 메타데이터 + 대화 전체
- [x] 활동 히트맵 — 24시간 격자, 시간대별 이벤트 밀도 시각화 (실시간 갱신)

---

## Phase 8: 세션 프리셋 & 자동화 — v0.5.0

### 8-1. 프로젝트별 세션 기본값 (sessionDefaults) ✅
- [x] config.json에 `sessionDefaults` 매핑 구조 추가
- [x] SessionStart 이벤트 처리 시 cwd→sessionDefaults 매칭하여 name/color 자동 적용
- [x] 홈 디렉토리(`~/`) 같은 범용 경로 매칭 제외 로직
- [x] customName=true인 기존 세션은 덮어쓰지 않음
- [x] REST API: GET/PUT/DELETE /api/session-defaults

### 8-2. /session-setting 확장 ✅
- [x] `--save` 플래그: 현재 cwd를 config.json sessionDefaults에 저장
- [x] `--list` 플래그: 저장된 기본값 목록 조회
- [x] `--remove` 플래그: 현재 cwd의 기본값 삭제
- [x] 색상 검증: 허용되지 않는 색상 거부
- [x] 환경변수 전달 방식으로 따옴표 안전성 보장

### 8-3. 실시간 반영 ✅
- [x] statusline.sh 3-tier fallback: /tmp → 대시보드 세션 JSON → config.json sessionDefaults
- [x] Tier 2에서 /tmp 파일 자가 복구 (다음 호출부터 빠른 경로)

---

## Phase 9: CLI 확장

- [ ] `claude-dash tail [sessionId]` — 터미널에서 세션 실시간 모니터링
- [ ] `claude-dash config get/set` — CLI에서 설정 조회/변경
- [ ] `claude-dash export [sessionId]` — 세션 트랜스크립트 CLI export
- [ ] `claude-dash status --filter active` — 상태별 필터

---

## Backlog (낮은 우선순위)

- [ ] ARIA 라벨 + 접근성 (스크린 리더 지원, 모달 포커스 트랩)
- [ ] API 문서 (REST 엔드포인트 명세)
- [ ] 프론트엔드 테스트 (jsdom 기반 JS 모듈 테스트)
- [ ] Webhook/Slack 알림 연동
