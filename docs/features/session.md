# Session

## 목적

Claude Code 세션 간 컨텍스트를 지속하는 시스템. 세션 시작 시 이전 작업 요약을 Claude 컨텍스트에 주입하고, 세션 종료 시 현재 상태를 저장한다. 워크트리 정확 매칭 → 프로젝트명 매칭 → 최근 순 폴백 우선순위로 세션을 복원한다.

## 진입점

- `scripts/hooks/session-start.js` — SessionStart 훅 핸들러. `selectMatchingSession()` 호출 후 `{ hookSpecificOutput: { additionalContext } }` JSON을 stdout으로 출력해 Claude 컨텍스트에 주입
- `scripts/hooks/session-end.js` — SessionEnd 훅 핸들러. 현재 세션 요약을 state-store에 저장
- `scripts/lib/session-manager.js` — 세션 CRUD 및 매칭 로직
- `scripts/lib/session-aliases.js` — 세션 별칭(alias) 관리
- `scripts/lib/session-adapters/` — claude-history, dmux-tmux 등 어댑터 패턴 구현

## 핵심 제약

- 세션 매칭 우선순위 변경 금지: worktree exact match > project name > recency
- `fs.realpathSync()`로 경로 정규화 후 비교 (symlink 처리)
- stdout 출력은 반드시 JSON 형식 `{ hookSpecificOutput: { additionalContext: "..." } }`
- state-store 쓰기 실패 시 exit 0 유지 (세션 저장 실패가 작업을 막으면 안 됨)
- `CLAUDE_SESSION_ID` 환경변수 없으면 cwd SHA1로 폴백

## 관련 도메인

- `domain_state_store` — 세션 데이터 영속성 담당
- `domain_hooks` — SessionStart/SessionEnd 이벤트 라우팅
