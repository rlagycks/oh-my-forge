# Agents

## 목적

전문화된 서브에이전트 시스템. `agents/`(마켓플레이스 배포용)와 `.agents/`(내부 플러그인 전용)의 두 위치에 분리 보관한다. 각 에이전트는 단일 역할에 집중하며 YAML frontmatter로 이름·설명·도구·모델을 선언한다. Claude Code의 `Agent` 툴이 이들을 오케스트레이션한다.

## 진입점

- `agents/` — 마켓플레이스·배포용 에이전트 파일 (Markdown + YAML frontmatter)
- `.agents/` — 내부 플러그인 전용 에이전트 (plugins/, skills/ 서브디렉터리 포함)
- `.claude-plugin/marketplace.json` — 마켓플레이스 등록 메타데이터

## 핵심 제약

- YAML frontmatter 필수 필드: `name`, `description`, `tools`, `model`
- 에이전트 파일 위치: 배포용은 `agents/`, 내부용은 `.agents/` (혼용 금지)
- 에이전트는 단일 책임 원칙 — 여러 역할을 하나의 에이전트에 합치지 말 것
- 파일명은 lowercase-hyphen (예: `code-reviewer.md`, `tdd-guide.md`)

## 관련 도메인

- `domain_common` — CLAUDE.md에 에이전트 포맷 컨벤션 정의
- `domain_orchestration` — 멀티 에이전트 오케스트레이션 패턴
- `domain_install` — 설치 프로파일에 에이전트 포함 여부 결정
