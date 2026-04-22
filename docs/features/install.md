# Install

## 목적

OMF 컴포넌트(agents, skills, hooks, rules, commands, .codex 등)를 대상 환경(claude-home, codex-home, cursor-project 등)에 선택적으로 설치하는 시스템. `install-plan.js`가 설치 계획을 산출하고 `install-apply.js`가 실행한다. 매니페스트 기반으로 설치 범위를 선언적으로 관리한다.

## 진입점

- `scripts/install-plan.js` — 설치 계획 산출 CLI. `--profile`, `--target` 플래그 지원
- `scripts/install-apply.js` — 계획 실행. 파일 복사, 심볼릭 링크, 병합 전략 적용
- `scripts/lib/install/apply.js` — 실제 파일 시스템 조작 로직
- `scripts/lib/install/config.js` — 설치 설정 파싱
- `scripts/lib/install/request.js` — 설치 요청 모델
- `scripts/lib/install/runtime.js` — 런타임 환경 감지
- `scripts/lib/install-manifests.js` — 매니페스트 로딩 및 검증
- `scripts/lib/install-executor.js` — 설치 실행 오케스트레이터

## 핵심 제약

- 설치 대상 경로는 매니페스트(`manifests/`)에만 정의 — 코드에 하드코딩 금지
- `install-apply.js`는 기존 파일 덮어쓰기 전 백업 생성
- 설치 실패는 부분 롤백 아닌 전체 중단 (일관성 보장)
- `--dry-run` 플래그는 파일 시스템 변경 없이 계획만 출력

## 관련 도메인

- `domain_codex` — `.codex/` 디렉터리가 설치 대상 중 하나
- `domain_package_manager` — 설치 스크립트가 패키지 매니저 감지 사용
