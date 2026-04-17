# 문서 구조 결정

## 문서의 두 독자

문서를 설계할 때 독자를 구분해야 선택이 명확해진다.

| 독자 | 목적 | 최적 형태 |
|------|------|---------|
| AI (Claude Code) | 필요한 컨텍스트만 빠르게 로드 | 작고 명확한 파일, on-demand 로드 |
| 사람 (팀, 외부 협업자) | 전체 맥락 파악, 공유 | 읽기 쉬운 형태, 공유 가능 |

온톨로지(`index.json` + spec)는 AI 소비용이다.
PRD, API 명세, 기술명세는 사람과 AI 모두 소비한다.

---

## 결정 1: 도메인 우선 구조 채택

**선택:** `docs/features/[domain]/` 하위에 문서 타입별 파일

```
docs/features/
├── chat/
│   ├── api.md
│   ├── prd.md
│   └── tech-spec.md
├── auth/
│   ├── api.md
│   └── prd.md
└── feed/
    └── api.md
```

**기각된 대안:** 타입 우선 구조
```
docs/
├── api-spec.md    (모든 API)
├── prd.md         (모든 기능)
└── tech-spec.md
```

**이유:**

소프트웨어 작업의 단위는 항상 기능(도메인)이다. "chat 개발 중"일 때 관련 api.md, prd.md가 같은 디렉토리에 있으면 컨텍스트 전환이 없다.

AI도 마찬가지다. chat 작업 시 `docs/features/chat/`만 로드하면 된다.
타입 우선이면 api-spec.md 전체를 읽어야 chat 관련 내용을 찾는다.

| 접근 패턴 | 도메인 우선 | 타입 우선 |
|---------|-----------|---------|
| "chat 기능 개발 중" | ✓ chat/ 하나 | ✗ 여러 파일 |
| "auth API만 봐줘" | ✓ auth/api.md | ✗ 전체 api-spec.md 로드 |
| "이 PR이 뭘 바꿨나" | ✓ chat/ diff 명확 | ✗ 큰 파일 일부 변경 |
| "API 명세 전체 공유" | ✗ 여러 파일 모아야 | ✓ 파일 하나 |

**공유 필요 시:** 생성 스크립트로 도메인별 파일을 타입별로 합쳐서 공유한다.
원본은 건드리지 않는다.

---

## 결정 2: 문서 타입별 역할 구분

| 문서 | 변경 빈도 | 공유 대상 | 도메인 경계 | AI 소비 빈도 |
|------|---------|---------|-----------|------------|
| API 명세서 | 높음 | 프론트-백 협업 | 명확 | 높음 (fault isolation) |
| 기술명세서 | 중간 | 내부 엔지니어 | 컴포넌트별 | 중간 (코드 리뷰) |
| PRD / 기획서 | 낮음 | PM, 외부 | 기능 전체 | 낮음 |
| 구현 계획서 | 높음 | 팀 내부 | 스프린트 단위 | 높음 (/plan 실행 시) |

---

## 결정 3: 온톨로지 ≠ SRP 그래프, 동일한 구조

**관찰:** 온톨로지(index.json → spec 파일)와 SRP 그래프(domain/doc-type.md)는 구조가 동일하다.

```
index.json (그래프 인덱스)
  └── docs/features/auth.md (그래프 노드)
  └── docs/features/qa-knowledge-layer.md (그래프 노드)
```

별도의 "SRP 그래프"를 만들 필요 없다. 온톨로지가 이미 그래프다.
확장이 필요하면 index.json에 포인터를 추가한다:

```json
"domain_auth": {
  "spec":    "docs/features/auth.md",
  "sourceDocs": {
    "apiSpec": ["docs/features/auth/api.md"],
    "prd":     ["docs/features/auth/prd.md"]
  }
}
```

`sourceDocs`는 원문 MD를 컨텍스트에 자동 주입하지 않는다.
라우팅과 handoff에는 "필요할 때만 읽을 문서" 포인터로만 노출한다.
구현자가 코드/타입만으로 계약을 확인할 수 있으면 읽지 않는다.
API shape, 비즈니스 의도, acceptance criteria처럼 코드에 없는 계약이
필요할 때만 해당 key의 문서를 연다.

---

## 결정 4: AI가 MD 파일을 읽어야 하는 조건

온톨로지가 있어도 AI가 MD 파일을 읽어야 하는 경우는 두 가지로 좁혀진다:

1. **크로스 레포 계약** — 프론트엔드 코드에 백엔드 API 응답 shape이 없을 때
2. **코드에 없는 의도** — 비즈니스 규칙, 아키텍처 결정, 엣지케이스 처리 방침

코드가 충분히 설명적이면(타입 명확, 의도가 코드에 담겨있으면) MD를 안 읽어도 된다.

**함의:** 문서 품질보다 코드 품질이 더 근본적인 해결책이다.
온톨로지는 네비게이션 레이어고, MD 문서는 코드로 표현 못한 지식의 보완재다.

---

## 현재 docs/ 구조

```
docs/
├── features/          ← AI on-demand spec (온톨로지 연결)
│   ├── hooks.md
│   ├── session.md
│   ├── qa-knowledge-layer.md
│   └── ...
├── qa/                ← QA 지식 레이어
│   ├── personas.md
│   ├── bug-topology.md
│   └── rca-history/
└── decisions/         ← 이 디렉토리. 설계 결정 기록
    ├── README.md
    ├── qa-system.md
    ├── ontology-harness.md
    └── doc-architecture.md
```
