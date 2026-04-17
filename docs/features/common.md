# Common

## 목적

oh-my-forge 플러그인의 루트 구성 계층. `plugin.json`(플러그인 메타데이터), `CLAUDE.md`(Claude Code 지침), `README.md`(공개 문서), `package.json`(의존성 및 스크립트)으로 구성된다. 모든 에이전트·스킬·훅의 공통 컨벤션(파일명 규칙, frontmatter 포맷 등)이 여기서 정의된다.

## 진입점

- `.claude-plugin/plugin.json` — 플러그인 ID, 버전, 진입점 선언
- `CLAUDE.md` — Claude Code에 프로젝트 지침 전달. 에이전트·스킬·명령어 포맷 컨벤션 포함
- `README.md` — 공개 설치 가이드 및 기능 문서
- `package.json` — 테스트(`node tests/run-all.js`), 린트(`markdownlint`) 스크립트 정의
- `.claude/ontology/index.json` `sourceDocs` — PRD/API/기능정의서 같은
  원문 MD를 도메인에 연결하는 포인터. 원문은 자동 로드하지 않고
  필요할 때만 읽는다.

## 핵심 제약

- 모든 파일명은 반드시 **lowercase-hyphen** 형식 (예: `python-reviewer.md`, `session-start.js`)
- 에이전트 파일에는 YAML frontmatter `name`, `description`, `tools`, `model` 네 필드 모두 필수
- 스킬 파일에는 `When to Use`, `How It Works`, `Examples` 섹션 필수
- 커맨드 파일에는 `description:` frontmatter 행 필수
- `CLAUDE.md`는 체크아웃된 소스의 일부 — 임의 수정 후 커밋 필수
- `sourceDocs`는 repo-relative `.md` 경로만 허용한다. 문서 포인터는
  routing/handoff에 노출하되 원문 내용을 자동 주입하지 않는다.

## 관련 도메인

- `domain_agents` — 에이전트 파일 컨벤션이 CLAUDE.md 지침에서 파생
- `domain_skills` — 스킬 배치 정책(skills/ vs ~/.claude/skills/)이 CLAUDE.md에 문서화
- `domain_commands` — 커맨드 포맷이 CLAUDE.md에 정의
- `domain_hooks` — 훅 스크립트 컨벤션이 CLAUDE.md에 명시
- `domain_rules` — 규칙 파일 구조가 CLAUDE.md에 기술
