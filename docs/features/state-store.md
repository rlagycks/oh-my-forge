# State Store

## 목적

OMF 세션 데이터, 스킬 이력, 오케스트레이션 상태를 SQLite(sql.js WASM)로 영속화하는 시스템. `wrapSqlJsDatabase()`가 sql.js API를 better-sqlite3 호환 인터페이스로 래핑(어댑터 패턴)하여 상위 코드가 런타임을 의식하지 않게 한다. 트랜잭션 커밋 후까지 디스크 쓰기를 지연한다.

## 진입점

- `scripts/lib/state-store/index.js` — `getStateStore(dbPath?)` 팩토리, `wrapSqlJsDatabase()` 어댑터
- `scripts/lib/state-store/schema.js` — 테이블 DDL 정의
- `scripts/lib/state-store/queries.js` — 준비된 쿼리 (세션 CRUD, 스킬 이력 조회 등)
- `scripts/lib/state-store/migrations.js` — `runMigrations(db)` 스키마 버전 관리

## 핵심 제약

- sql.js(WASM) 의존성 유지 — better-sqlite3로 교체 금지 (Node.js 바이너리 빌드 의존성 없앤 이유)
- 트랜잭션 없이 직접 쓰기 금지 — 모든 변경은 트랜잭션으로 감쌀 것
- 마이그레이션은 항상 멱등 (이미 적용된 버전 재실행 시 오류 없이 통과)
- DB 파일 경로 기본값: `~/.claude/ecc-state.db`

## 관련 도메인

- `domain_session` — 세션 저장/조회의 영속성 레이어
- `domain_install` — 설치 상태 추적
