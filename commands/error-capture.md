---
description: 에이전트 실수를 분류하고 구조적으로 재발할 수 없도록 시스템을 수정한다 — 온톨로지 갭이면 constraints[]에 추가, 하네스 갭이면 failure instinct를 생성한다.
---

# /error-capture

에이전트가 실수했을 때 실행한다. **실수를 고치는 것이 아니라, 같은 실수가 구조적으로 재발할 수 없도록 시스템을 바꾼다.**

## 사용법

```
/error-capture [실수 설명]
/error-capture [관련 파일 경로] [실수 설명]
```

예시:
```
/error-capture "hooks 스크립트에서 DB를 직접 호출했음"
/error-capture scripts/hooks/my-hook.js "200ms 제한 있는 줄 모르고 network 호출 추가"
/error-capture "tdd 없이 바로 구현부터 작성했음"
```

## 실행 절차

### Step 1 — 실수 분류

아래 두 가지를 판단한다.

**A. 어느 도메인과 관련된 실수인가?**

`node '${CLAUDE_PLUGIN_ROOT:-.}/scripts/lib/ontology.js' query --file <path> 2>/dev/null`로 관련 파일 경로 또는 키워드에 매핑된 `domain_*`를 찾는다.

**B. 어떤 유형의 갭인가?**

| 유형 | 판단 기준 |
|------|----------|
| **온톨로지 갭** | 관련 domain_*가 있고, 해당 도메인의 `constraints[]`에 이 제약이 없다 |
| **온톨로지 갭 (도메인 없음)** | 관련 domain_*가 없다 — 새 도메인 정의 필요 |
| **하네스 갭** | 도메인과 무관한 프로세스 문제, 또는 constraints에는 있지만 주입/시행이 안 됨 |
| **혼합** | 두 가지 갭이 모두 존재 |

분류 결과를 먼저 출력한다:
```
분류: 온톨로지 갭
도메인: domain_hooks
근거: constraints[]에 "네트워크 호출 금지" 관련 항목 없음
```

---

### Step 2a — 온톨로지 갭 처리

**2a-1. 새 constraint 작성**

다음 형식으로 constraint를 작성한다:
- 금지/요구 사항을 구체적으로 명시 (왜 금지인지 포함)
- 기계 검사 가능한 패턴이 있으면 `|pattern:` 서픽스 추가

예시:
```
"블로킹 훅에서 fetch/axios/http 모듈 사용 금지 — 200ms 초과 시 tool 실행 지연|pattern:require('node-fetch')|pattern:require('axios')|pattern:require('http')"
```

**2a-2. index.json 업데이트**

해당 `domain_*`의 `constraints[]` 배열 끝에 추가한다.

**2a-3. spec 파일 업데이트**

`spec` 경로(`docs/features/<domain>.md`)를 읽고 `## 핵심 제약` 섹션에 같은 내용을 추가한다.

**2a-4. 온톨로지 검증**

```bash
PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-.}
if [ -f "$PLUGIN_ROOT/scripts/ci/validate-ontology.js" ]; then
  node "$PLUGIN_ROOT/scripts/ci/validate-ontology.js"
else
  echo "Ontology 검증: SKIPPED (scripts/ci/validate-ontology.js 없음 — ECC 개발 레포 전용)"
fi
```

실패 시 오류를 수정하고 재실행한다.

---

### Step 2b — 하네스 갭 처리

**2b-1. Failure instinct 파일 생성**

경로: `~/.claude/homunculus/projects/<project-hash>/instincts/personal/`

파일명: `err-<kebab-case-id>-<YYYYMMDD>.yaml`

```yaml
---
id: <kebab-case-id>
trigger: "<언제 이 실수가 발생하는가>"
confidence: 0.9
domain: "<관련 영역: hooks|testing|git|workflow|security 등>"
source: "error-capture"
outcome: "failure"
linked_domain: "<domain_*가 있으면 기입, 없으면 생략>"
---

# <실수 제목>

## Prevents
<무엇을 하면 안 되는가, 왜>

## Root Cause
<에이전트가 왜 이 실수를 했는가 — 컨텍스트 부재, 프로세스 없음 등>

## Structural Fix
<이 instinct로부터 어떤 구조가 만들어져야 하는가 — skill/rule/hook 중 무엇>
```

**2b-2. 즉시 evolve 분석 실행**

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" evolve
```

`outcome: failure` instinct가 constraint 후보로 분류됐는지 확인하고 결과를 출력한다.

---

### Step 2c — 온톨로지 갭 (도메인 없음) 처리

새 도메인이 필요한 경우 `/ontology-sync`를 안내한다:

```
이 실수는 아직 온톨로지에 등록되지 않은 영역에서 발생했습니다.
새 도메인 추가가 필요합니다. /ontology-sync 를 실행하세요.

제안 도메인 키: domain_<suggested_name>
관련 파일: <file paths>
```

---

### Step 3 — 구조적 수정 요약 출력

```
ERROR CAPTURE REPORT
════════════════════════════════════════

실수: <한 줄 요약>
유형: <온톨로지 갭 | 하네스 갭 | 혼합>
도메인: <domain_* 또는 없음>

수정 내용:
  [온톨로지] domain_<name>.constraints[] 추가
             → "<새 constraint>"
  [스펙]     docs/features/<name>.md 핵심 제약 섹션 업데이트
  [Instinct] ~/.claude/homunculus/.../err-<id>.yaml 생성

다음에 같은 실수가 일어나지 않는 이유:
  • constraint-guard.js 가 <domain_*> 파일 편집 시
    위반 패턴 감지 → stderr 경고 출력
  • domain-context-inject.js 가 constraint를 에이전트
    컨텍스트에 주입 (세션당 1회)

검증:
  Ontology CI: <PASS | FAIL>
════════════════════════════════════════
```

## 원칙

- 실수를 고치는 것이 이 명령어의 목적이 아니다 — **재발 방지 구조를 만드는 것**이 목적이다
- 하나의 실수 → 하나의 구조적 변경 (constraint 1개 또는 instinct 1개)
- constraint는 구체적이고 검사 가능해야 한다 — "좋은 코드를 써라"는 constraint가 아니다
- 분류가 불확실하면 양쪽 모두 처리한다 (혼합)

## 관련 명령어

- `/ontology-sync` — 온톨로지 전체 동기화
- `/evolve` — failure instinct를 skill/rule/command로 변환
- `/verify` — 수정 후 전체 검증
