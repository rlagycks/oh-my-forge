# Commands

## 목적

사용자가 `/command-name` 형태로 직접 호출하는 슬래시 커맨드 시스템. 각 커맨드는 Markdown 파일로 정의되며 `Skill` 툴을 통해 실행된다. `COMMANDS-QUICK-REF.md`는 전체 커맨드 목록과 간략 설명을 제공한다. 커맨드는 복잡한 워크플로(TDD, E2E 테스트, 플래닝 등)를 단일 호출로 시작하는 진입점 역할을 한다.

## 진입점

- `commands/` — 모든 슬래시 커맨드 파일 (Markdown + `description:` frontmatter)
- `COMMANDS-QUICK-REF.md` — 커맨드 빠른 참조 가이드

## 핵심 제약

- 모든 커맨드 파일에 `description:` frontmatter 행 필수 (Skill 툴의 args 파라미터로 노출)
- 커맨드 파일 위치: `commands/<name>.md` (서브디렉터리 사용 금지)
- 파일명은 lowercase-hyphen (예: `tdd.md`, `qa-loop.md`, `ontology-sync.md`)
- 커맨드 변경 시 `COMMANDS-QUICK-REF.md` 동기화 필수
- handoff/completion 포맷을 바꾸는 커맨드는 런타임 schema와 테스트를 같이 갱신해야 함

## 관련 도메인

- `domain_common` — CLAUDE.md에 커맨드 포맷 정의
- `domain_skills` — 커맨드 내부에서 스킬 참조 패턴 사용
- `domain_hooks` — 일부 커맨드가 훅 설정과 연동 (예: session-persistence)
