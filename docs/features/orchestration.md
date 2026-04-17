# Orchestration

## 목적

여러 Claude/Codex 에이전트를 tmux 워크트리로 병렬 실행하는 오케스트레이션 시스템. JSON 플랜 파일로 워커 구성을 선언하면, 각 워커가 독립된 git worktree에서 실행되고 핸드오프 문서로 결과를 교환한다. `seedPaths`로 미커밋 로컬 파일을 워크트리에 오버레이 가능.

## 진입점

- `scripts/orchestrate-worktrees.js` — CLI 진입점. `plan.json --execute` 플래그로 실행
- `scripts/lib/tmux-worktree-orchestrator.js` — `buildOrchestrationPlan()`, `executePlan()`, `materializePlan()` 구현
- `scripts/orchestration-status.js` — 실행 중인 세션의 제어 플레인 스냅샷 JSON 출력
- `scripts/lib/orchestration-session.js` — 워크트리 세션 상태 추적
- `commands/orchestrate.md` — `/orchestrate` 슬래시 커맨드. 워크플로우 타입(feature/bugfix/refactor/security) 정의

## 핵심 제약

- `plan.json`의 `launcherCommand`에는 `{worker_name}`, `{worktree_path}` 등 플레이스홀더만 사용
- `seedPaths`는 존재하는 파일만 — 없는 경로 지정 시 워크트리 생성 실패
- 워크트리 브랜치명 충돌 시 자동으로 suffix 추가하지 않음 — 플랜에서 고유 이름 보장 필요
- 핸드오프 문서 포맷: `## HANDOFF: [from] -> [to]` 헤더 필수
- 최종 `SHIP` 판정은 evidence 존재, false-normal signals = none, next action 명시 후에만 가능

## 관련 도메인

- `domain_hooks` — Stop 훅과 연동해 워커 완료 감지
- `domain_codex` — Codex 워커를 orchestrate-worktrees로 실행 가능
