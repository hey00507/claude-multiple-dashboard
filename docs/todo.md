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
- [x] Vitest 테스트 35개 (session-store, log-store, event-bus, API)
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

---

## Phase 2: 웹 대시보드 완성

### 2-1. 세션 상세 뷰
- [ ] 세션 카드 클릭 → 사이드 패널 또는 확장 영역
- [ ] 타임라인 뷰: 프롬프트(💬), 응답(🤖), 도구 사용, Stop 이벤트 시간순 표시
- [ ] 해당 세션의 로그만 필터링 조회

### 2-2. 히스토리 개선
- [ ] 날짜 선택 드롭다운 (최근 7일)
- [ ] 페이지네이션 또는 무한 스크롤

### 2-3. UI 다듬기
- [ ] 세션 카드 정렬: active → waiting → ended, 같은 상태 내 최근 활동순
- [ ] 빈 상태 메시지 개선 (첫 사용 가이드)
- [ ] 로딩/에러 상태 처리

---

## Phase 3: 안정화 & 고도화

### 3-1. 로그 관리
- [ ] `claude-dash clean --before YYYY-MM-DD` CLI 명령
- [ ] logRetentionDays 기반 자동 정리 (서버 시작 시)

### 3-2. 검색 & 필터
- [ ] 프로젝트명/도구명 필터
- [ ] 프롬프트/파일명 텍스트 검색

### 3-3. UX 고도화
- [ ] 키보드 단축키 (j/k 이동, Enter 상세, Esc 닫기)
- [ ] 반응형 레이아웃
- [ ] 알림 뱃지 (permission_prompt 대기 세션 수)
- [ ] 데스크톱 알림 (Notification API — 세션 idle 임계치 초과 시)

### 3-4. npm 배포
- [ ] `bin` 필드 복원 + 빌드 파이프라인 구성
- [ ] `npx claude-dash` 실행 지원
- [ ] npm publish
