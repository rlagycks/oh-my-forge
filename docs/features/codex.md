# Codex

## 목적

OpenAI Codex CLI를 ECC에 통합하여 Claude(오케스트레이터)와 Codex(구현자)의 하이브리드 멀티 에이전트 구조를 구성하는 시스템. `config.toml`이 Codex 행동을 제어(sandbox, approval, 역할별 지시)하고, `codex-plugin-cc`가 Claude-Codex 비동기 통신 채널을 제공한다. `merge-mcp-config.js`가 ECC MCP 서버 설정을 `~/.codex/config.toml`에 안전하게 병합한다.

> **Codex 없이도 사용 가능**: `codex` 바이너리가 PATH에 없으면 `/plan`이 자동으로 `/claude-implement`로 폴백한다. Claude만 구독 중인 유저는 별도 설정 없이 동일한 온톨로지 GPS 워크플로우를 사용할 수 있다. 엔진 감지 로직은 `scripts/lib/utils.js`의 `detectImplementationEngine()`을 참고.

## 진입점

- `.codex/config.toml` — Codex 런타임 설정. `approval_policy`, `sandbox_mode`, `notify`, `[agents]` 역할 정의
- `.codex/agents/` — 역할별 TOML. `explorer` (read-only), `reviewer` (read-only), `docs-researcher` (read-only), `implementer` (workspace-write)
- `scripts/codex/merge-mcp-config.js` — ECC 관리 MCP 서버를 사용자 `~/.codex/config.toml`에 add-only로 병합

## 핵심 제약

- `sandbox_mode`는 각 역할 TOML에서 오버라이드 가능 — `config.toml` 최상위 값은 기본값
- `explorer`, `reviewer`, `docs-researcher`의 `sandbox_mode = "read-only"` 변경 금지 (OS 레벨 격리)
- `merge-mcp-config.js`는 기존 사용자 설정 절대 삭제/수정 금지 (add-only)
- Codex 훅은 `.codex/hooks.json`으로 설정 — Claude Code의 `run-with-flags.js` 래퍼 없이 스크립트를 직접 호출하는 방식. `domain-context-inject`와 `qa-context-inject`가 등록되어 있음

## 관련 도메인

- `domain_install` — `.codex/` 디렉터리가 ECC 설치 매니페스트에 포함
- `domain_orchestration` — Codex 워커가 tmux 오케스트레이션에서 실행 가능
