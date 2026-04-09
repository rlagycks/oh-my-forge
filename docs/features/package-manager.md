# Package Manager

## 목적

npm, pnpm, yarn, bun 중 프로젝트에서 사용하는 패키지 매니저를 자동 감지하는 시스템. 6단계 우선순위 캐스케이드로 감지하며, 감지 결과를 프로세스 범위 Map에 메모이제이션한다. Windows에서 Bun 초기화 시 자식 프로세스 과다 생성으로 발생하는 프리즈 버그(#162)를 회피하기 위해 `getAvailablePackageManagers()` 호출을 제거했다.

## 진입점

- `scripts/lib/package-manager.js` — `getPackageManager(cwd?)` 함수와 `PACKAGE_MANAGERS` 전략 객체 내보내기

## 핵심 제약

- 감지 순서 변경 금지: env var → project config → package.json → lockfile → global config → default npm
- `getAvailablePackageManagers()`를 감지 6단계에 다시 추가하지 말 것 (Windows freeze #162)
- 반환값은 반드시 `PACKAGE_MANAGERS` 객체의 키 중 하나 (npm | pnpm | yarn | bun)
- 메모이제이션 캐시는 프로세스 단위 Map — 테스트에서 캐시 초기화 필요 시 `clearCache()` 사용

## 관련 도메인

- `domain_hooks` — 훅 스크립트에서 포매터/린터 실행 시 패키지 매니저 감지
- `domain_install` — 설치 스크립트가 패키지 매니저 명령어 구성에 사용
