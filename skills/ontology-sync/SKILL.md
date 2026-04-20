---
name: ontology-sync
description: Scan spec docs and synchronize .claude/ontology/index.json with docs/features/index.md. Use when adding a new domain, editing spec files, or when CI validate-ontology fails.
---

# Ontology Sync

## When to Use

- 새 `docs/features/<domain>.md` spec 파일을 추가한 후
- 기존 spec 파일을 수정하거나 도메인을 삭제한 후
- `validate-ontology.js` CI가 실패했을 때
- `docs/features/index.md` 테이블과 `index.json`이 맞지 않는다는 느낌이 들 때
- `/ontology-sync` 커맨드를 실행하면 자동으로 이 스킬이 활성화됨

## How It Works

이 스킬은 세 파일을 **단일 진실 원천 체계**로 관리한다:

```
docs/features/*.md          ← 개별 도메인 spec (사람이 편집)
.claude/ontology/index.json ← 머신 GPS 인덱스 (이 스킬이 동기화)
docs/features/index.md      ← 라우팅 테이블 (이 스킬이 동기화)
```

### 실행 단계

**1. Spec 파일 수집**

`docs/features/` 를 glob하여 `_template.md`와 `index.md`를 제외한 모든 `.md` 파일을 수집한다.

**2. Spec 유효성 검사**

각 spec 파일에서 4개의 필수 H2 섹션 존재 여부를 확인한다:
- `## 목적`
- `## 진입점`
- `## 핵심 제약`
- `## 관련 도메인`

누락된 섹션이 있으면 `_template.md`를 기반으로 채운다.

**3. index.json 교차 검증**

`index.json`의 `domain_*` 키와 spec 파일 목록을 대조한다:

| 상황 | 처리 |
|------|------|
| spec 존재 + index.json 없음 | 사용자에게 `domain_*` 엔트리 정보 확인 후 추가 |
| index.json 존재 + spec 없음 | 경고 출력, 해당 엔트리 제거 여부 확인 |
| 양쪽 모두 존재 | `files[]`, `spec` 경로 유효성 검사 |

**4. index.json 업데이트**

변경이 필요한 경우 `index.json`을 수정한다. 반드시 기존 필드 순서(`files`, `spec`, `owner`, `symbols`, `dependsOn`, `codexWorkerHint`)를 유지한다.

**5. docs/features/index.md 재생성**

`index.json`의 현재 상태를 기반으로 index.md의 도메인 테이블을 재작성한다. 테이블 아래의 라우팅 규칙, 새 도메인 추가 방법 등 수동 섹션은 보존한다.

**6. CI 검증 실행**

```bash
if [ -f scripts/ci/validate-ontology.js ]; then
  node scripts/ci/validate-ontology.js
else
  echo "CI 검증: SKIPPED (scripts/ci/validate-ontology.js 없음 — ECC 개발 레포에서만 사용)"
fi
```

오류가 있으면 원인을 분석하고 수정한다.

**7. 변경 요약 출력**

```
Ontology Sync 완료
──────────────────────────────────
추가됨: domain_my_feature (docs/features/my-feature.md)
수정됨: domain_hooks — files[] 경로 1건 업데이트
index.md: 1행 추가
CI 검증: PASS
──────────────────────────────────
```

## Examples

```
/ontology-sync
```
→ 전체 스캔, 이슈 보고 및 안전한 수정 자동 적용

```
/ontology-sync --check
```
→ 드라이런: 파일 수정 없이 이슈만 보고

```
/ontology-sync --fix
```
→ 모든 수정을 확인 없이 적용

## Constraints

- `docs/features/_template.md`와 `docs/features/index.md`는 **spec 파일로 취급하지 않는다**
- `index.json`의 `domain_*` 키명은 반드시 `domain_[a-z][a-z0-9_]*` 패턴이어야 한다
- `codexWorkerHint`가 없는 엔트리를 추가할 때는 반드시 사용자에게 `workspace-write` 또는 `read-only` 중 하나를 확인한다
- 기존 엔트리의 `files[]`나 `symbols[]`는 수정하지 않는다 — 경로 유효성 문제만 보고한다
- 수동 편집 섹션(라우팅 규칙, 새 도메인 추가 방법)은 index.md에서 보존한다
