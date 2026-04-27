[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![JavaScript](https://img.shields.io/badge/-JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

[English](README.md) | **한국어**

# oh-my-forge

> 에이전트가 실수할 때마다, 그 실수가 구조적으로 다시 발생할 수 없도록 시스템을 변경한다.

[everything-claude-code](https://github.com/affaan-m/everything-claude-code) 기반의 커스텀 Claude Code 하네스.
핵심 추가 사항: **온톨로지 기반 구조적 오류 방지 시스템** — 에이전트의 실수가 하네스 레벨에서 자동으로 방지되도록 만든다.

---

## 왜 만들었나

[everything-claude-code](https://github.com/affaan-m/everything-claude-code)는 AI 에이전트 하네스를 위한 성능 최적화 시스템이다 — 스킬, instinct, 메모리 지속성, 지속적 학습, 보안 스캔, 그리고 Claude Code / Codex / Cowork 등 다양한 하네스 간 호환성까지 갖춘 프로덕션 수준의 시스템.

`oh-my-forge`는 이 모든 것을 유지하면서 두 가지를 추가한다:

**1. 온톨로지 기반 구조적 오류 방지**

에이전트가 실수할 때 기본 대응은 프롬프트를 패치하는 것이다. 하지만 이는 취약하다 — 새 세션에서 컨텍스트가 초기화되면 같은 실수가 반복된다. `oh-my-forge`는 실수를 시스템 신호로 취급한다: 각 오류를 분류하고 라우팅해서 구조적 변경(온톨로지에 새 제약 추가, 또는 학습 파이프라인에 failure instinct 생성)으로 전환한다. 같은 실수는 구조적으로 다시 발생할 수 없다.

**2. 온톨로지를 구현 엔진의 GPS로 활용**

Claude Code가 계획한다. 온톨로지 인덱스(`index.json`)는 좌표 지도 역할을 한다 — Claude는 전체 소스 트리를 탐색하는 대신 도메인 인덱스와 기능 명세 파일만 읽고(~3K 토큰), 구조화된 BRIEF를 생성한다. 구현은 사용 가능한 엔진이 담당한다:

- **Codex** — `codex` CLI가 설치된 경우 (`/codex-delegate`)
- **Claude** — Codex가 없을 때 자동 폴백 (`/claude-implement`)

별도 설정 없이 플랜 시점에 자동으로 엔진을 감지한다.

세 가지 원칙:

1. **프롬프트 패치보다 구조적 방지** — 실수가 두 번 일어날 수 있다면 문제는 프롬프트가 아니라 시스템이다
2. **온톨로지 + 하네스 공동 설계** — 제약, 파일 좌표, 기능 명세는 함께 정의되어야 한다
3. **모든 세션이 시스템을 가르친다** — 학습은 수동이 아니라 자동이다

---

## 핵심 시스템

### 1. 온톨로지 (`/.claude/ontology/`)

중앙 지식 그래프. 논리 도메인을 파일, 제약, 기능 명세에 매핑한다.

```json
"domain_hooks": {
  "files": ["hooks/hooks.json", "scripts/hooks/..."],
  "spec": "docs/features/hooks.md",
  "constraints": [
    "블로킹 훅(PreToolUse, Stop)은 200ms 이하 — 네트워크 호출 금지",
    "신규 훅은 run-with-flags.js 래퍼를 통해서만 등록"
  ],
  "riskLevel": "high",
  "codexWorkerHint": "workspace-write"
}
```

각 `domain_*` 항목이 정의하는 것:
- **files** — 이 도메인에 속하는 파일 목록
- **spec** — 에이전트가 비즈니스 의도를 이해하기 위해 읽는 기능 명세 파일
- **constraints** — 에이전트가 반드시 따라야 하는 규칙. 기계 검사 가능한 패턴 추가 가능 (`|pattern:키워드`)
- **codexWorkerHint** — `"read-only"` 또는 `"workspace-write"`, Codex에게 역할을 지시
- **riskLevel** — `"high"` 설정 시 constraint-guard에서 강한 경고 출력

**스키마:** `/.claude/ontology/_schema.json`이 모든 도메인 항목을 검증한다.

---

### 2. 구현 위임 (`/commands/codex-delegate.md`, `/commands/claude-implement.md`)

온톨로지 인덱스는 **구현 엔진의 GPS**로 동작한다. 전체 소스 트리를 주는 대신, Claude가 `index.json`과 관련 기능 명세 파일만 읽고(~3K 토큰) 구조화된 BRIEF를 생성한다.

```
/plan  →  엔진 자동 감지  →  /codex-delegate   (Codex CLI 설치된 경우)
                          →  /claude-implement  (Codex 없음, Claude만 사용)
```

두 커맨드는 동일한 BRIEF 포맷을 사용하고 동일한 HANDOFF 결과를 반환한다 — 엔진은 교체 가능하다. `/plan` 스킬은 Codex 우선 위임을 강제하고 무음 폴백 루프를 방지한다 (v1.10.x에서 수정).

**엔진 감지 순서 (첫 번째 매칭 사용):**
1. `CLAUDE_IMPL_ENGINE` 환경변수 (`claude` 또는 `codex`)
2. 프로젝트 `.claude/settings.json` → `implementationEngine` 필드
3. 글로벌 `~/.claude/settings.json` → `implementationEngine` 필드
4. 자동 감지: `codex` 바이너리 없음 → `"claude"` 자동 선택
5. 기본값: `"codex"`

Codex가 고정된 세션에서는 `pre-bash-codex-guard`가 온톨로지 추적 파일에 대한 셸 수준 쓰기(`cat >`, heredoc, `tee`, `cp`/`mv`, 인라인 Python/Node 쓰기, in-place editor)도 차단한다. 이제 Bash는 Edit/Write 가드의 조용한 우회 경로가 아니다.

**사용 기준:**

| 조건 | 행동 |
|------|------|
| Codex CLI 설치된 경우 | `/codex-delegate domain_X "task"` (또는 `/plan`이 자동 라우팅) |
| Claude만 구독 중인 경우 | `/claude-implement domain_X "task"` (또는 `/plan`이 자동 라우팅) |
| 멀티 도메인 작업 | 먼저 분해 후 도메인별로 위임 |
| 아키텍처 결정 | Claude에서 직접 처리 — 위임하지 않음 |
| 보안 민감 코드 | 구현 후 `/code-review` |

---

### 3. Constraint Guard (`/scripts/hooks/constraint-guard.js`)

모든 `Write`, `Edit`, `MultiEdit` 전에 실행되는 `PreToolUse` 훅.

에이전트가 추적 중인 도메인의 파일을 수정할 때:
1. 해당 파일을 소유한 `domain_*` 탐색
2. 도메인의 `constraints[]`에서 기계 검사 가능한 패턴 추출
3. 제안된 변경 내용이 위반 패턴과 일치하면 stderr에 경고 출력

```
// constraint 형식
"블로킹 훅에서 네트워크 호출 금지 — 200ms 제한|pattern:require('node-fetch')|pattern:require('axios')"
//                                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                               기계가 검사하는 패턴들
```

- 항상 `exit 0` — tool 실행을 절대 차단하지 않음
- 세션 스코프: 같은 경고는 세션당 한 번만 출력
- `riskLevel: "high"` 도메인은 `WARNING: HIGH RISK` 헤더와 함께 강한 경고 출력

---

### 3. Error Capture (`/commands/error-capture.md`)

`/error-capture` 명령어는 학습 루프의 진입점이다.

에이전트가 실수했을 때 실행:
```
/error-capture "훅 스크립트에서 DB를 직접 호출했음"
/error-capture scripts/hooks/my-hook.js "200ms 제한 모르고 네트워크 호출 추가"
```

명령어 실행 과정:
1. **실수 분류** — 온톨로지 갭, 하네스 갭, 또는 혼합
2. **적절한 수정으로 라우팅:**
   - 온톨로지 갭 → `index.json`에 새 constraint 추가 + 기능 명세 업데이트
   - 하네스 갭 → `continuous-learning-v2`용 failure instinct 파일 생성
3. **구조적 리포트 출력** — 왜 같은 실수가 다시 일어나지 않는지 명시

---

### 4. Continuous Learning v2 (`/skills/continuous-learning-v2/`)

세션에서 패턴을 추출해 instinct로 승격하고, 최종적으로 구조적 제약으로 만든다.

파이프라인:
```
세션 실수
  → /error-capture
    → failure instinct (yaml)
      → evolve 분석
        → constraint 후보
          → /ontology-sync → domain constraints[]
```

---

## 프로젝트 구조

```
oh-my-forge/
├── .claude/
│   └── ontology/
│       ├── _schema.json     # 도메인 항목 검증 스키마
│       └── index.json       # 도메인 레지스트리 (파일, 제약, 명세)
├── agents/                  # 위임용 전문 서브에이전트
├── commands/                # 슬래시 명령어
│   ├── error-capture.md     # /error-capture — 구조적 오류 방지
│   ├── ontology-sync.md     # /ontology-sync — 온톨로지 동기화
│   ├── evolve.md            # /evolve — instinct를 구조로 승격
│   └── ...
├── hooks/
│   └── hooks.json           # 훅 등록
├── rules/                   # 항상 따르는 가이드라인
├── scripts/
│   └── hooks/
│       └── constraint-guard.js  # PreToolUse 제약 검사기
├── skills/
│   ├── continuous-learning-v2/  # 세션 → instinct → constraint 파이프라인
│   └── ...                      # 140+ 워크플로우 스킬
├── mcp-configs/             # MCP 서버 설정
└── docs/
    └── features/            # 온톨로지 도메인에 연결된 기능 명세
```

---

## 명령어

### 오류 방지 & 구현 위임

| 명령어 | 설명 |
|--------|------|
| `/error-capture [설명]` | 실수를 분류하고 구조적 수정을 생성 |
| `/ontology-sync` | 온톨로지 인덱스를 코드베이스와 동기화 |
| `/evolve` | failure instinct를 스킬, 룰, 또는 constraint로 승격 |
| `/codex-delegate <도메인> <작업>` | 온톨로지 GPS를 통해 구현을 Codex에 위임 |
| `/claude-implement <도메인> <작업>` | 동일하지만 Claude가 직접 구현 — Codex 불필요 |

### 개발

| 명령어 | 설명 |
|--------|------|
| `/plan` | 구현 계획 수립 |
| `/tdd` | 테스트 주도 개발 워크플로우 |
| `/code-review` | 품질 리뷰 |
| `/build-fix` | 빌드 오류 수정 |
| `/e2e` | E2E 테스트 생성 및 실행 |

### 세션 & 학습

| 명령어 | 설명 |
|--------|------|
| `/save-session` | 현재 세션 상태 저장 |
| `/resume-session` | 이전 세션 재개 |
| `/learn` | 현재 세션에서 패턴 추출 |
| `/skill-create` | git 히스토리에서 스킬 생성 |
| `/instinct-status` | 현재 instinct 요약 확인 |

### 오케스트레이션

| 명령어 | 설명 |
|--------|------|
| `/orchestrate` | 멀티 에이전트 작업 오케스트레이션 |
| `/loop` | 명령어를 반복 실행 |
| `/qa-loop` | 지속적 QA 루프 |

> 전체 명령어 목록: `/commands/` 디렉터리 참고.

---

## 빠른 시작

### 방법 1 — 플러그인으로 설치 (권장)

Claude Code 세션 안에서 다음 명령 하나만 실행하세요:

```
/plugin install rlagycks/oh-my-forge
```

클론이나 빌드 없이 스킬, 커맨드, 에이전트, 훅이 즉시 사용 가능합니다.

### 방법 2 — 수동 설치 (기여자 또는 로컬 커스터마이징)

```bash
git clone https://github.com/rlagycks/oh-my-forge.git
cd oh-my-forge
yarn install
node scripts/ecc.js install
```

### 설치 확인

설치 후 플러그인이 로드됐는지 확인하세요:

```
/plugin list
```

`oh-my-forge`가 목록에 표시되면 모든 커맨드를 바로 사용할 수 있습니다:

```
/plan
/tdd
/error-capture "무엇이 잘못됐는지 설명"
```

---

## 시작하기

### 온톨로지에 도메인 추가하기

1. `.claude/ontology/index.json` 수정
2. 스키마에 따라 `domain_*` 항목 추가
3. 검증 실행:
   ```bash
   node scripts/ci/validate-ontology.js
   ```

### 에이전트 오류 캡처하기

```bash
# 에이전트가 실수한 후
/error-capture "무엇이 잘못됐는지 설명"

# 파일 컨텍스트와 함께
/error-capture path/to/file.js "여기서 에이전트가 무엇을 잘못 했는지"
```

---

## 개인정보 보호

oh-my-forge는 어떠한 사용자 데이터도 수집, 전송, 저장하지 않습니다.
모든 처리는 Claude Code 세션 내에서 로컬로 실행됩니다.
이 플러그인은 텔레메트리, 분석, 외부 네트워크 호출을 일절 하지 않습니다.

---

## 기반 프로젝트

[everything-claude-code](https://github.com/affaan-m/everything-claude-code) by [Affaan Mustafa](https://github.com/affaan-m) — MIT License

---

## 라이선스

MIT © 2026 Hyochan Kim — [LICENSE](LICENSE) 참고
