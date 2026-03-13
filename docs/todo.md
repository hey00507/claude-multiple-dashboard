# TODO

## 완료된 작업

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
- [x] CLI 기본 (start, status, open)
- [x] 웹 대시보드 기본 (세션 카드, idle time 카운트, 히스토리, SSE)

---

## Phase 1: 테스트 + Hook 연동 검증

보일러플레이트는 갖춰졌지만, 실제로 동작하는지 검증이 안 된 상태.
테스트 코드 작성 → hook 연동 → 실사용 검증 순서로 진행.

### 1-1. 테스트 환경 구축 ✅
- [x] 테스트 프레임워크 설치 (vitest)
- [x] 테스트 스크립트 등록 (`npm test`)

### 1-2. 서비스 테스트 ✅
- [x] `session-store` 테스트 — 이벤트별 상태 전이 검증
- [x] `log-store` 테스트 — append, read, delete 동작 검증
- [x] `event-bus` 테스트 — broadcast → listener 수신 확인

### 1-3. API 테스트 ✅
- [x] POST /api/events — 유효 이벤트 → 200, 세션 생성 확인
- [x] POST /api/events — 필수 필드 누락 → 400
- [x] POST /api/events — Stop + stop_hook_active:true → skip
- [x] GET /api/sessions — 세션 목록 반환
- [x] GET /api/sessions/:id — 존재/미존재 케이스
- [x] GET /api/logs — 날짜별 조회

### 1-4. CLI `init` 명령 구현 ✅
- [x] `~/.claude/settings.json` 읽기 → 기존 hooks 유지하면서 dashboard hook append
- [x] `~/.claude/hooks/dashboard-hook.sh` 복사 + 실행 권한
- [x] `~/.claude-dashboard/` 디렉토리 + config.json 생성
- [x] 이미 등록된 경우 중복 방지

### 1-5. CLI `stop` 명령 구현 ✅
- [x] PID 파일 기반 서버 프로세스 종료
- [x] `start` 시 PID 파일 기록 (`~/.claude-dashboard/server.pid`)

### 1-6. 실사용 검증 (E2E) ✅
- [x] `claude-dash init` → hook 등록 확인 (기존 hooks 유지 + 6개 추가)
- [x] `claude-dash start` → 서버 기동
- [x] 이벤트 수신 확인 (SessionStart → UserPromptSubmit → PostToolUse → Stop 전체 플로우)
- [x] API 응답 확인 (세션 상태 전이, 로그 기록, idle time 설정)
- [x] 브라우저에서 대시보드 확인 (세션 카드 + idle time)

---

## Phase 2: 웹 대시보드 완성

### 2-1. 세션 상세 뷰
- [ ] 세션 카드 클릭 → 사이드 패널 또는 확장 영역
- [ ] 타임라인 뷰: 프롬프트(💬), 도구 사용, Stop 이벤트 시간순 표시
- [ ] 해당 세션의 로그만 필터링 조회

### 2-2. 히스토리 개선
- [ ] 날짜 선택 드롭다운 (최근 7일)
- [ ] 세션별 프로젝트명 표시 (현재 sessionId 앞 8자리 → projectName으로 변경)
- [ ] 페이지네이션 또는 무한 스크롤

### 2-3. UI 다듬기
- [ ] 세션 카드 정렬: active → waiting → ended, 같은 상태 내 최근 활동순
- [ ] 빈 상태 메시지 개선 (첫 사용 가이드)
- [ ] 로딩/에러 상태 처리

---

## Phase 3: 안정화 & 고도화

### 3-1. 로그 관리
- [ ] DELETE /api/logs?before=YYYY-MM-DD 구현
- [ ] `claude-dash clean --before YYYY-MM-DD` CLI
- [ ] logRetentionDays 기반 자동 정리 (서버 시작 시)

### 3-2. 검색
- [ ] 프로젝트명/도구명 필터
- [ ] 프롬프트/파일명 텍스트 검색

### 3-3. UX 고도화
- [ ] 키보드 단축키 (j/k 이동, Enter 상세, Esc 닫기)
- [ ] 반응형 레이아웃
- [ ] 알림 뱃지 (permission_prompt 대기 세션 수)

### 3-4. npm 배포
- [ ] `bin` 필드 복원 + 빌드 파이프라인 구성
- [ ] `npx claude-dash` 실행 지원
- [ ] npm publish
