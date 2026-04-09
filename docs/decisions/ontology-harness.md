# 온톨로지 + 하네스 엔지니어링 아키텍처

## 목표

온톨로지와 하네스 엔지니어링을 하나로 묶어서
정확도, 히스토리 유지, 크로스 워크플로우 인텔리전스를 동시에 잡는다.

---

## 온톨로지의 역할

온톨로지는 **내비게이션 레이어**다. "무엇을 해야 하나"가 아니라 "어디를 봐야 하나"를 알려준다.

```
index.json ("어디")  +  spec 파일 ("무엇")  +  코드 ("어떻게")
```

`index.json`이 항상 로드되는 GPS 역할을 한다. spec 파일은 필요할 때만 로드된다.

---

## 로딩 정책

| 항목 | 정책 | 이유 |
|------|------|------|
| `index.json` | 항상 로드 | GPS 역할, 크기 제한 (~1,000 tokens 이하) |
| `docs/features/*.md` (spec) | on-demand | 해당 도메인 작업 시만 필요 |
| `domain_qa` | on-demand | 월 2-3회만 실행, 항상 로드할 이유 없음 |

**on-demand 트리거:**
- `/qa-loop` 실행 시 → `domain_qa` spec 로드
- 버그 맵에 있는 파일 편집 시 → `qa-context-inject` 훅이 컨텍스트 주입
- 코드 리뷰 시 QA 히스토리 있는 파일 → `domain_qa` spec 참조

---

## QA 지식 레이어 구조

QA 런이 생성하는 지식은 `docs/qa/`에 보관되고, 이후 모든 워크플로우에서 참조된다.

```
/qa-loop 실행
    │
    ├── Phase 0.5: docs/qa/personas.md 업데이트
    ├── Phase 5: 리포트 출력 → STOP
    │
    └── [개발자 승인 후]
         └── docs/qa/bug-topology.md 업데이트
              └── qa-context-inject 훅 활성화
```

```
[이후 모든 편집 작업]
    │
    └── PreToolUse:Edit → qa-context-inject.js
         ├── bug-topology.md JSON 맵 확인
         ├── 매칭되면 → 버그 히스토리 컨텍스트 주입 (~300 tokens)
         └── 매칭 없으면 → 비용 0, 투명하게 통과
```

---

## 크로스 워크플로우 인텔리전스

온톨로지를 통해 QA 히스토리가 다른 워크플로우에 흘러들어간다.

| 워크플로우 | QA 히스토리 활용 방식 |
|-----------|---------------------|
| code-reviewer | 버그 맵에 있는 파일 리뷰 시 → 이전 버그 근본 원인 확인, 패턴 재발 여부 검사 |
| security-reviewer | AUTH 카테고리 버그 있는 파일 편집 시 → `domain_qa` spec 참조 |
| codex-delegate | 개발자 승인 후 수정 위임 시 → 버그 ID, 파일, 라인, 루트코즈를 BRIEF에 포함 |

---

## 하네스 엔지니어링 — 훅 설계

### qa-context-inject (PreToolUse:Edit)

**목적:** 버그 히스토리가 있는 파일을 편집할 때 자동으로 컨텍스트 주입

**동작:**
1. `tool_input.file_path` 읽기
2. `docs/qa/bug-topology.md` JSON 맵 확인
3. 매칭되면 → stderr에 버그 요약 출력 (Claude Code가 인라인 컨텍스트로 표시)
4. 항상 exit 0 — 절대 편집을 막지 않음

**비용 구조:**
- 매칭 없음: 0 tokens
- 매칭 있음: ~200-400 tokens (버그 요약)
- 훅 실행 자체: <5ms

### 훅 활성화 조건

`hooks/hooks.json` 등록:
```
matcher: "Write|Edit|MultiEdit"
profile: "standard,strict"
hookId: "pre:qa-context-inject"
```

---

## 토큰 비용 계산

**월간 비용 (100 세션, QA 월 2-3회 기준):**

| 항목 | tokens/세션 | 월간 |
|------|------------|------|
| index.json domain_qa 항목 (+85) | +85 | 8,500 |
| QA 런 전체 (e2e-rca) | ~4,200 | 8,400 (2회) |
| 버그 맵 훅 히트 | ~300 | ~3,000 (추정) |
| code-reviewer domain_qa 참조 | ~800 | ~4,000 (추정 5회) |
| **합계** | | **~23,900** |

**온톨로지 없이 동일 작업을 할 때 대비:** 매 세션마다 수동으로 관련 파일을 찾고 컨텍스트를 설명하는 비용이 더 크다.

---

## 구현된 파일

| 파일 | 역할 |
|------|------|
| `.claude/ontology/index.json` | 도메인 GPS (domain_qa 항목 포함) |ㅛ쇼     
| `docs/features/qa-knowledge-layer.md` | domain_qa 스펙 |
| `scripts/hooks/qa-context-inject.js` | PreToolUse:Edit 훅 |
| `hooks/hooks.json` | 훅 등록 |
| `docs/qa/bug-topology.md` | 파일 → 버그 ID 맵 |
