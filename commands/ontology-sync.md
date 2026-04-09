---
description: Scan spec docs and synchronize .claude/ontology/index.json with docs/features/index.md. Runs CI validation after update.
---

# Ontology Sync

spec 문서를 스캔하여 온톨로지 인덱스와 feature 라우팅 테이블을 동기화한다.

## Usage

```
/ontology-sync [--check | --fix]
```

| 플래그 | 동작 |
|--------|------|
| (없음) | 이슈 보고 + 안전한 수정 자동 적용 |
| `--check` | 드라이런 — 파일 수정 없이 이슈만 보고 |
| `--fix` | 확인 없이 모든 수정 적용 |

---

## Step 1 — Spec 파일 수집

`docs/features/` 디렉토리를 Glob으로 스캔한다.

**제외 파일**: `_template.md`, `index.md`

수집된 파일 목록을 출력한다:

```
발견된 spec 파일:
  docs/features/hooks.md
  docs/features/session.md
  ...
```

---

## Step 2 — Spec 유효성 검사

각 spec 파일을 읽고 4개의 필수 H2 섹션이 모두 존재하는지 확인한다:

- `## 목적`
- `## 진입점`
- `## 핵심 제약`
- `## 관련 도메인`

누락된 섹션이 있으면 `_template.md`의 해당 섹션 틀을 가져와 파일 끝에 추가한다 (`--check` 모드에서는 경고만 출력).

---

## Step 3 — index.json 교차 검증

`.claude/ontology/index.json`을 읽고 `$schema` 키를 제외한 모든 `domain_*` 키를 수집한다.

**spec 파일명 → domain 키 추론 규칙**: `docs/features/my-feature.md` → `domain_my_feature`

다음 세 가지 경우를 처리한다:

### A. spec 있음 + index.json 없음 (신규 도메인)

사용자에게 다음 정보를 확인하여 엔트리를 추가한다:
- `files[]` — 핵심 소스 파일 경로 (spec의 `## 진입점` 섹션 참조)
- `owner` — 담당 팀 (infra / dx / platform)
- `symbols[]` — 핵심 함수명 (선택)
- `codexWorkerHint` — `workspace-write` 또는 `read-only`

`--fix` 모드에서는 spec의 `## 진입점` 섹션에서 파일 경로를 추출하여 자동으로 엔트리를 생성한다.

### B. index.json 있음 + spec 없음 (고아 엔트리)

해당 `domain_*` 엔트리를 경고로 출력한다. `--fix` 모드에서만 사용자 확인 후 제거한다.

### C. 양쪽 모두 존재

`files[]` 내 각 경로가 실제 파일시스템에 존재하는지 확인한다. 존재하지 않는 경로가 있으면 경고로 출력한다.

---

## Step 4 — index.json 업데이트

변경 사항이 있을 경우 `.claude/ontology/index.json`을 수정한다.

**규칙**:
- `$schema` 키를 항상 첫 번째로 유지한다
- 기존 엔트리의 필드 순서를 변경하지 않는다
- 새 엔트리 필드 순서: `files`, `spec`, `owner`, `symbols`, `dependsOn`, `codexWorkerHint`
- `--check` 모드에서는 파일을 수정하지 않고 diff만 출력한다

---

## Step 5 — docs/features/index.md 재생성

`docs/features/index.md`를 읽고 도메인 테이블 부분만 재작성한다.

**보존할 섹션** (테이블 아래의 수동 편집 섹션):
- `## 라우팅 규칙`
- `## 새 도메인 추가 방법`

**재생성할 테이블 행 형식**:
```
| `domain_<id>` | <목적 섹션 첫 문장 요약> | [<domain>.md](<domain>.md) | <owner> |
```

`목적 섹션 첫 문장`은 해당 spec 파일의 `## 목적` 아래 첫 번째 비어있지 않은 줄에서 가져온다.

`--check` 모드에서는 현재 테이블과 생성될 테이블의 차이만 출력한다.

---

## Step 6 — CI 검증

```bash
node scripts/ci/validate-ontology.js
```

실행 결과를 출력한다. 실패 시 오류 메시지를 분석하여 원인을 설명하고 수정한다.

---

## Step 7 — 요약 출력

```
Ontology Sync 완료
──────────────────────────────────────────
Spec 파일: 8개 발견
유효성 검사: 8/8 PASS

index.json 변경:
  추가: domain_my_feature
  경고: domain_old_domain (spec 없음)

index.md 변경:
  1행 추가 (domain_my_feature)

CI 검증: PASS
──────────────────────────────────────────
```

변경 사항이 없으면 "이미 동기화됨" 을 출력하고 종료한다.
