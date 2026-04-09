# Skills

## 목적

재사용 가능한 워크플로 정의 및 도메인 지식 패키지. 큐레이션된 스킬은 `skills/`에, 사용자 생성·자동 임포트 스킬은 `~/.claude/skills/`에 위치한다. `Skill` 툴로 호출하며, 스킬은 깊은 참조 자료("How It Works")와 예제를 포함해 Claude가 복잡한 작업을 수행할 때 전문 지식을 즉시 활용할 수 있게 한다.

## 진입점

- `skills/` — 큐레이션 스킬 (PR 리뷰 후 병합, 소스 제어 대상)
- `.agents/skills/` — 플러그인 전용 스킬 (`.agents/` 하위)
- `docs/SKILL-PLACEMENT-POLICY.md` — 어떤 스킬을 어느 위치에 둘지 결정 기준

## 핵심 제약

- 큐레이션 스킬(`skills/`)은 반드시 PR 리뷰 후 병합 — 직접 push 금지
- 자동 생성 스킬은 `~/.claude/skills/`에만 저장 (`skills/` 혼입 금지)
- 스킬 파일 필수 섹션: `When to Use`, `How It Works`, `Examples`
- 파일명은 lowercase-hyphen (예: `python-patterns.md`, `tdd-workflow.md`)
- `docs/SKILL-PLACEMENT-POLICY.md`를 참고하지 않고 위치 결정 금지

## 관련 도메인

- `domain_common` — CLAUDE.md에 스킬 포맷·배치 정책 기술
- `domain_agents` — 에이전트가 스킬을 Skill 툴로 호출
- `domain_install` — 설치 프로파일에 스킬 포함 여부 결정
