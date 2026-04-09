# ECC Feature Index

Claude의 도메인 라우팅 인덱스. 각 `domain_*` 키는 `.claude/ontology/index.json`과 1:1 대응한다.

| Domain ID | 기능 요약 | 스펙 문서 | 소유 팀 |
|-----------|-----------|-----------|---------|
| `domain_hooks` | 이벤트 훅 시스템 (PreToolUse/PostToolUse/Stop/SessionStart) | [hooks.md](hooks.md) | infra |
| `domain_session` | 세션 컨텍스트 지속 및 복원 | [session.md](session.md) | dx |
| `domain_orchestration` | tmux 워크트리 멀티 에이전트 오케스트레이션 | [orchestration.md](orchestration.md) | platform |
| `domain_package_manager` | npm/pnpm/yarn/bun 자동 감지 | [package-manager.md](package-manager.md) | infra |
| `domain_state_store` | SQLite 기반 세션/스킬/상태 영속성 | [state-store.md](state-store.md) | infra |
| `domain_install` | ECC 컴포넌트 선택적 설치 시스템 | [install.md](install.md) | platform |
| `domain_codex` | Codex CLI 통합 및 하이브리드 에이전트 설정 | [codex.md](codex.md) | platform |

## 라우팅 규칙

Claude가 태스크를 받았을 때 아래 기준으로 처리 방식을 결정한다.

| 태스크 유형 | 처리 방법 |
|------------|-----------|
| 특정 도메인의 단순 구현 (버그 수정, 함수 추가) | `/codex-delegate <domain_id> <task>` |
| 여러 도메인에 걸친 구현 | Claude가 도메인별로 분해 후 순차 위임 |
| 설계/아키텍처 결정 | Claude 직접 처리 |
| 보안 민감 코드 | Claude 처리 + `/codex:review` 검수 |
| 대규모 코드베이스 탐색 | `/codex:rescue` (Codex explorer 활용) |

## 새 도메인 추가 방법

1. `docs/features/[domain].md` 생성 (`_template.md` 복사)
2. `.claude/ontology/index.json`에 `domain_[name]` 키 추가
3. 이 파일의 테이블에 행 추가
4. `npm test` 실행 — `validate-ontology.js`가 정합성 검증
