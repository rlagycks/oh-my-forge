# State Store

## 목적

OMF 세션 데이터, 스킬 이력, 오케스트레이션 상태를 SQLite(sql.js WASM)로 영속화하는 시스템. `wrapSqlJsDatabase()`가 sql.js API를 better-sqlite3 호환 인터페이스로 래핑(어댑터 패턴)하여 상위 코드가 런타임을 의식하지 않게 한다. 트랜잭션 커밋 후까지 디스크 쓰기를 지연한다.

## 진입점

- `scripts/lib/state-store/index.js` — `createStateStore({ dbPath, homeDir }?)` 팩토리, `wrapSqlJsDatabase()` 어댑터
- `scripts/lib/state-store/schema.js` — 테이블 DDL 정의
- `scripts/lib/state-store/queries.js` — 준비된 쿼리 (세션 CRUD, 스킬 이력 조회 등)
- `scripts/lib/state-store/migrations.js` — `runMigrations(db)` 스키마 버전 관리

## 핵심 제약

- sql.js(WASM) 의존성 유지 — better-sqlite3로 교체 금지 (Node.js 바이너리 빌드 의존성 없앤 이유)
- 트랜잭션 없이 직접 쓰기 금지 — 모든 변경은 트랜잭션으로 감쌀 것
- 마이그레이션은 항상 멱등 (이미 적용된 버전 재실행 시 오류 없이 통과)
- DB 파일 경로 기본값: `~/.claude/ecc/state.db`

## JSONL 이벤트 로그와의 경계

하네스 이벤트 로그와 state-store는 서로 다른 운영 저장소다.

- `~/.claude/logs/recall-hits.jsonl` (또는 `OMF_HARNESS_EVENT_LOG`)은 append-only 하네스 이벤트의 원본이다. `context_injection`과 `task_outcome` 같은 이벤트, episode/session 연결자와 집계용 수치만 저장하며 프롬프트·컨텍스트 본문은 저장하지 않는다. 기존의 레거시 recall 레코드도 읽을 때 구조화 이벤트로 정규화한다.
- `~/.claude/ecc/state.db`는 세션, skill run, decision, install state, governance event처럼 조회·갱신되는 운영 상태를 소유한다. JSONL 이벤트를 자동으로 DB에 복제하거나 JSONL을 삭제하지 않는다.
- 이벤트 로그의 기본 경로와 `recall-hits.jsonl` 파일명은 기존 설치 호환성을 위해 유지한다. 회전 파일은 `<log>.1`, `<log>.2`처럼 저장되며 숫자가 클수록 오래된 세그먼트다.
- 이 변경에서는 JSONL→state-store 전체 통합·재생성 마이그레이션을 수행하지 않는다. 이벤트 인덱스/재생 및 복구 명령은 별도 후속 작업으로 남긴다.

## 이벤트 로그 운영 규칙

- 기록은 한 JSON 객체를 한 줄로 쓰는 append 방식이다. 기본 회전 한도는 10 MiB, 보존 세그먼트 수는 5개이며 다음 환경 변수로 조정할 수 있다: `OMF_HARNESS_EVENT_LOG_MAX_BYTES`, `OMF_HARNESS_EVENT_LOG_RETENTION`. 한도를 `0`으로 두면 회전을 끈다. 보존 수가 0이면 회전하지 않는다.
- 일반 report 읽기는 메모리 상한을 갖는 chunk/line streaming reader를 사용한다. 기본 읽기 상한은 16 MiB와 100,000 events이며 `OMF_HARNESS_EVENT_LOG_READ_MAX_BYTES`, `OMF_HARNESS_EVENT_LOG_READ_MAX_EVENTS` 또는 `recall-report.js --max-bytes/--max-events`로 조정한다. 상한을 넘으면 최신 세그먼트 쪽을 우선 읽고 report의 `read.truncated`와 `read.diagnostics`에 표시한다.
- 여러 프로세스의 append는 OS append semantics에 의존해 각 JSONL 레코드를 한 번에 쓴다. 회전 구간만 `<log>.lock`을 짧게 생성해 직렬화하며, 잠금이 이미 있으면 이벤트 유실을 피하기 위해 append는 계속하고 해당 회전은 건너뛴다. 30초 이상 남은 lock은 stale lock으로 간주해 다음 writer가 회수한다.
- reader는 파일을 수정하지 않는다. JSON parse 실패, schema-invalid 레코드, EOF에서 끝난 불완전 레코드, read limit은 서로 다른 진단 코드(`malformed_json`, `invalid_event`, `truncated_record`, `read_limit`)로 반환한다. 진단에는 원문 이벤트나 컨텍스트를 포함하지 않는다.

## State-store transaction/recovery 규칙

- state-store의 변경은 transaction으로 묶는다. sql.js의 export는 active transaction을 종료할 수 있으므로 transaction 중에는 디스크 export를 하지 않고, `COMMIT` 뒤에만 DB 파일을 쓴다.
- transaction body가 실패하면 `ROLLBACK`을 시도하고 호출자에게 오류를 반환한다. 프로세스가 commit/export 전에 종료되면 기존 DB 파일이 유지되는 것이 복구 경계다. 시작 시 손상된 DB를 JSONL로 자동 복구하지 않으며, 백업·복구와 JSONL replay 도구는 후속 작업이다.
- sql.js 기반 파일 DB는 단일 writer 경계를 갖는다. 여러 프로세스가 같은 DB를 동시에 갱신하는 것은 지원하지 않으며, 호출자는 세션/상태 store writer를 직렬화해야 한다. 읽기와 append-only JSONL 기록은 state-store transaction과 독립적이다.

## 관련 도메인

- `domain_session` — 세션 저장/조회의 영속성 레이어
- `domain_install` — 설치 상태 추적
