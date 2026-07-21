# Evidence Contract

**Last Updated:** 2026-07-21

## 목적

P0 런타임 상태와 검증 증거의 경계를 정의한다. 하네스 JSONL은 실행 후에도 남는 append-only 증거이고, state-store는 현재 운영 상태를 갱신하는 mutable 저장소다. 검증 receipt는 원문 출력이 아니라 실행 종료 신호, immutable snapshot hash, 그리고 OMF 런타임의 persistence attestation으로 검증 수준을 판정한다.

## 진입점

- `scripts/lib/evidence-contract.js` — receipt 생성·검증과 `verified`/`unknown`/`failed` 판정
- `scripts/lib/harness-events.js` — `verification_receipt`를 포함한 JSONL 이벤트 생성·검증·append/read
- `scripts/record-harness-event.js` — task outcome 및 verification receipt 기록 CLI
- `scripts/lib/state-store/index.js` — 별도 mutable 운영 상태 저장소의 sql.js 어댑터

## 검증 receipt 계약

Receipt는 다음 메타데이터만 durable하게 보존한다.

| 필드 | 의미 |
|------|------|
| `verifierId` | 검증기 식별자 |
| `subject` | 절대 경로가 아닌 상대 대상 식별자 |
| `exitCode` | 프로세스 종료 코드. 없으면 `null` |
| `timedOut` | 제한 시간 초과 여부 |
| `signal` | 신호 종료 시 신호명. 없으면 `null` |
| `snapshotHash` | 선택적 `sha256:<64 lowercase hex>` immutable snapshot hash |
| `fileHashes` | 선택적 상대 경로→SHA-256 hash 맵 |
| `persistenceAttestation` | runtime이 immutable snapshot을 atomic publish·fsync한 뒤 기록한 artifact id, UTC 시각, 그리고 verifier·subject·executionId·종료 결과·snapshot에 결속된 HMAC 서명 |
| `startedAt`, `endedAt` | 선택적 ISO-8601 실행 시각 |
| `state`, `reason` | 위 필드에서 결정된 결과와 이유 |

판정은 아래 순서를 따른다. 앞선 조건이 있으면 뒤의 조건이 있어도 덮어쓰지 않는다.

| 실행 증거 | 상태 | 이유 |
|-----------|------|------|
| `timedOut === true` | `unknown` | `timed-out` |
| `signal`이 존재 | `unknown` | `signaled` |
| 정수 `exitCode`가 없음 | `unknown` | `missing-exit-code` |
| `exitCode !== 0` | `failed` | `nonzero-exit` |
| `exitCode === 0`이고 snapshot hash가 없음 | `unknown` | `missing-artifact` |
| `exitCode === 0`이고 snapshot hash는 있지만 persistence attestation이 없음 | `unknown` | `missing-persistence-attestation` |
| `exitCode === 0`이고 snapshot hash와 runtime persistence attestation이 있음 | `verified` | `verified-receipt` |

따라서 깨끗한 종료 코드나 호출자가 제공한 hash만으로는 `verified`가 아니다. `record-harness-event.js` 같은 수동 CLI는 persistence attestation을 만들 수 없으므로 receipt를 `unknown`으로 기록한다. timeout이나 signal이 있으면 exit code가 0이고 hash가 있어도 `unknown`이며, non-zero exit는 artifact가 있어도 `failed`다.

JSON Schema는 transport 구조만 검증한다. JSONL reader는 secret 없이도 구조적으로 유효한 receipt를 보존하지만, `verified`를 승인하거나 새 event를 기록하는 OMF runtime은 `OMF_EVIDENCE_ATTESTATION_SECRET`으로 HMAC 진위를 반드시 검증한다.

## P0 저장 경계와 데이터 흐름

```text
[검증 명령]
    └─ exitCode / timedOut / signal + immutable snapshot hash
         └─ OMF runtime persistence attestation
         └─ verification_receipt
              └─ append-only JSONL evidence

[세션·스킬·설치·거버넌스 상태]
    └─ transaction
         └─ sql.js state-store (mutable operational state)
```

- JSONL 이벤트는 append-only다. 기존 레코드를 갱신·삭제하지 않고, 정정 또는 재검증은 새 이벤트로 추가한다. reader는 파일을 수정하지 않는다. 회전 세그먼트와 read/retention 상한은 운영 수명주기이며 증거 레코드를 mutable DB 상태로 바꾸지 않는다.
- state-store는 세션, skill run, decision, install state, governance event를 소유하는 운영 저장소다. JSONL을 자동 복제·재생성하지 않으며, state-store의 row를 검증 receipt 대신 사용하지 않는다.
- `verification_receipt`는 JSONL evidence에 속한다. receipt의 `state`와 `reason`은 호출자가 임의로 선언하는 값이 아니라 실행 필드로부터 도출되어야 한다.

## 개인정보 및 내구성 규칙

- receipt는 strict allowlist를 사용한다. prompt, context 본문, command output, source code, 임의 metadata를 저장하지 않는다. 출력 전문이 필요하면 durable receipt의 범위를 벗어나므로 별도 보안 저장소 계약이 필요하다.
- `subject`, `fileHashes`, persistence artifact id는 portable한 상대 식별자만 허용한다. 사용자 홈, 작업 디렉터리, 절대 경로, `.`/`..` traversal, backslash, URL, 제어 문자를 receipt에 넣지 않는다.
- hash는 artifact의 존재·동일성을 확인하는 식별자이지 artifact 내용 자체가 아니다. persistence runtime은 `OMF_EVIDENCE_STORE`에 snapshot과 signed metadata를 atomic publish·fsync하고, 수용 시에는 저장된 artifact를 다시 hash해 상위 `snapshotHash`와 비교한다. `OMF_EVIDENCE_ATTESTATION_SECRET`는 verifier·subject·executionId·종료 결과·실행 시각·snapshot·artifact·시각을 HMAC 서명하며 persistence runtime에만 설정한다. runtime attestation 없이 hash만 있다고 실행이 성공했다거나 검증됐다고 추론하지 않는다.
- 로컬 telemetry는 hosted analytics service로 전송하지 않는다. JSONL 기본 경로는 `~/.claude/logs/recall-hits.jsonl`이며 `OMF_HARNESS_EVENT_LOG`로 격리 경로를 지정할 수 있다.

## 핵심 제약

- state-store는 sql.js(WASM)를 유지한다. better-sqlite3로 교체하지 않는다.
- state-store 변경은 transaction으로 묶고, sql.js export/디스크 쓰기는 commit 뒤에만 수행한다.
- JSONL event log와 state-store는 소유권·복구 경계를 합치지 않는다. JSONL 전체를 state-store로 자동 마이그레이션하지 않는다.
- receipt에 raw prompt, command output, source code 또는 절대 경로를 추가하지 않는다.

## 관련 도메인

- `domain_state_store` — mutable 운영 상태와 transaction/sql.js 제약
- `domain_hooks` — 로컬 하네스 이벤트를 기록하는 훅 경로
- `domain_session` — 세션 수명주기와 evidence 누락 처리
- [state-store.md](state-store.md) — 저장소 분리와 JSONL 운영 규칙
