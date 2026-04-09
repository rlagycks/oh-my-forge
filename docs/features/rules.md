# Rules

## 목적

Claude Code가 항상 따르는 코딩 표준·컨벤션·체크리스트 모음. `rules/common/`은 언어 무관 범용 원칙, `rules/<lang>/`은 특정 언어 확장을 담는다. 규칙 파일은 Claude의 컨텍스트에 자동 주입되어 별도 지시 없이도 일관된 코드 품질을 유지시킨다.

## 진입점

- `rules/README.md` — 규칙 구조 설명 및 설치 방법
- `rules/common/` — 범용 원칙 (coding-style, git-workflow, testing, security, agents 등)
- `rules/typescript/` — TypeScript/JavaScript 확장 규칙
- `rules/python/` — Python 확장 규칙
- `rules/golang/` — Go 확장 규칙
- `rules/swift/` — Swift 확장 규칙
- `rules/php/` — PHP 확장 규칙

## 핵심 제약

- 언어별 규칙(`rules/<lang>/`)이 common 규칙과 충돌하면 언어별 규칙 우선 (CSS specificity 방식)
- `rules/common/`에는 언어 특정 코드 예시 포함 금지 — 범용 의사코드만 허용
- 언어별 규칙 파일은 반드시 `> This file extends [common/xxx.md](../common/xxx.md)` 참조 포함
- 새 언어 추가 시 `rules/<lang>/coding-style.md`, `testing.md`, `patterns.md`, `hooks.md`, `security.md` 모두 생성 필수

## 관련 도메인

- `domain_common` — CLAUDE.md에서 rules/ 설치 방법 참조
- `domain_hooks` — `rules/<lang>/hooks.md`가 언어별 PostToolUse 훅 설정 가이드 포함
- `domain_install` — 설치 프로파일이 rules 파일을 대상 경로에 복사
