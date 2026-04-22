# Hooks

## 목적

Claude Code 이벤트(PreToolUse, PostToolUse, Stop, SessionStart 등)에 반응하는 자동화 훅 시스템. `run-with-flags.js`가 모든 훅의 단일 진입점으로, 프로파일 게이팅과 in-process 실행 최적화를 담당한다. 훅은 개발 흐름을 절대 블록하지 않는다 — 비즈니스 로직 오류 시 항상 exit 0.

## 진입점

- `hooks/hooks.json` — 훅 레지스트리. 이벤트 타입별 커맨드 배열 정의
- `scripts/hooks/run-with-flags.js` — 모든 훅의 실행 게이트웨이. 프로파일 체크, in-process vs spawn 결정, 결과 직렬화 담당
- `scripts/lib/hook-flags.js` — `isHookEnabled(hookId, options)` 구현. `ECC_HOOK_PROFILE`, `ECC_DISABLED_HOOKS` 환경변수 파싱
- `scripts/lib/ontology-packet.js` — ontology detail에서 profile별 context packet 생성.
  오래된 decision/failure residue를 필터링하고 최신 active 신호를 우선 주입
- `scripts/lib/ontology-routing.js` — routing 계열 훅의 공용 ontology helper. `project ontology root` 해석, `fileMap` 로딩, domain matching 담당

## 핵심 제약

- 모든 훅 스크립트는 치명적이지 않은 오류에서 반드시 `exit 0` 반환
- 블로킹 훅(PreToolUse, Stop)은 200ms 이하 유지 — 네트워크 호출 금지
- 신규 훅 스크립트는 `run-with-flags.js` 래퍼를 통해서만 등록
- `ECC_HOOK_PROFILE`이 `allowedProfiles`에 포함될 때만 실행 (기본: standard)
- stdin은 최대 1MB, 파싱 실패 시 원본 그대로 통과
- routing 계열 훅(`domain-context-inject`, `constraint-guard`, `qa-context-inject`, `pre-write-edit-codex-guard`)은 `file_path → cwd` 순서로 현재 프로젝트의 ontology root를 찾는다
- `CLAUDE_PLUGIN_ROOT`는 OMF 자산 위치 해석용이지 현재 프로젝트 routing 기준이 아니다. project file routing fallback으로 직접 사용하지 않는다
- ontology packet은 `deprecated`, `stale`, `superseded`, `expiresAt` 지난 항목을 제외하고,
  `updatedAt`/`lastSeenAt`/`createdAt`/`date` 기준 최신 active 항목을 먼저 선택한 뒤
  profile limit을 적용한다

## 관련 도메인

- `domain_session` — SessionStart/SessionEnd 훅이 세션 복원 로직 호출
- `domain_orchestration` — Stop 훅이 포맷/타입체크 배치 처리 트리거
- `domain_codex` — `pre-write-edit-codex-guard`가 ontology-tracked 파일의 Claude 직접 편집을 차단하고 Codex handoff를 강제
