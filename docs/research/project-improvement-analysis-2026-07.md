# oh-my-forge 개선 방향 분석 (2026-07-14)

코드·훅·온톨로지·상태 저장소·계측 로그를 직접 확인한 뒤 정리한 분석 보고서.
네 가지 관점: ① 실질 평가 지표 ② SQLite·온톨로지의 비(非)git 관리 ③ 메모리 계층/컨텍스트 주입 ④ 차별화 방향.

> 관련 문서: [agent-memory-harness-ontology-research-2022-2026.md](./agent-memory-harness-ontology-research-2022-2026.md) — 이 보고서의 제안 다수가 해당 리서치의 Track A 항목과 연결된다.

---

## 0. 현재 구조 요약 (분석 전제)

실제로 확인한 메모리/지식 저장 계층은 **8곳**이다:

| 저장소 | 위치 | 성격 |
|---|---|---|
| 세션 요약 | `*-session.tmp` (7일 보존) | 에피소드 기억 |
| 인스팅트 | `~/.claude/homunculus/instincts/` (글로벌+프로젝트) | 절차 기억, confidence ≥0.7 주입 |
| 결정 기록 | `domain_*.json`의 `decisions[]` + `~/.claude/decisions/index.jsonl` | 이중 저장 |
| 연속성 패킷 | decisions JSONL에서 파생 | /clear·compact 후 재주입 |
| 온톨로지 | `index.json` + `domain_*.json` + `docs/features/*.md` | 의미 기억 (GPS) |
| state-store | sql.js WASM, 6개 테이블 | **사실상 미연결 (§2 상술)** |
| recall 계측 | `~/.claude/logs/recall-hits.jsonl` | 쓰기만 되고 읽는 도구 없음 |
| Claude 네이티브 메모리 | `MEMORY.md` | 별도 트랙 |

컨텍스트 주입 경로는 3개:

1. SessionStart — 세션 요약 + 인스팅트 + 연속성 패킷 + 프로젝트 타입
2. PreToolUse `domain-context-inject` — 도메인별 세션당 1회
3. `qa-context-inject` — 버그 맵 매칭 시

---

## 1. 평가 지표 — "테스트 통과"가 아니라 "하네스가 실제로 도움이 되는가"

### 현재 상태의 문제

- 695개 테스트는 전부 배관(plumbing) 검증이다. "훅이 JSON을 잘 파싱하는가"는 검증하지만 **"주입된 컨텍스트가 에이전트 행동을 바꿨는가"는 아무것도 측정하지 않는다.**
- `harness-audit.js`(956줄)는 파일 존재 여부 체크리스트 기반 정적 점수 — 구성 준수도이지 성과 지표가 아니다.
- `recall-hits.jsonl`은 계측이 쌓이고 있지만 **소비자(분석 도구)가 하나도 없다.** 주입 "량"만 기록하고 주입이 유용했는지는 기록하지 않는다.
- `eval-harness` 스킬은 pass@k, EDD를 문서로 정의했지만 실행 가능한 러너가 없다.

### 제안하는 실질 지표 (이 프로젝트만이 측정할 수 있는 것들)

1. **제약 재발률 (핵심 KPI)** — README의 핵심 주장이 "같은 실수가 구조적으로 재발 불가"인데, 지금 이걸 검증할 방법이 없다. RCA로 constraint가 추가된 뒤 같은 도메인에서 같은 유형의 `fix:` 커밋이 다시 나오는지를 decisions JSONL + 커밋 컨벤션(`fix:`/`fix(gap):`/`fix(design):` 구분이 이미 존재)에서 계산할 수 있다. **프로젝트의 커밋 규칙 자체가 이미 지표 데이터 소스다.**
2. **fix-커밋 비율 추세** — 도메인별 `fix:` 계열 커밋 빈도가 constraint 추가 후 감소하는지. 후행 지표.
3. **recall 정밀도** — 컨텍스트가 주입된 편집이 `post-edit-ontology-check`를 통과하는 비율 vs 주입 없는 편집. recall-hits에 편집 결과를 이어 붙이면 된다.
4. **A/B 실행 하네스** — `ECC_DISABLED_HOOKS` 게이팅이 이미 있으므로, 동일 태스크를 훅 on/off로 돌려 완료율·토큰·오류 수를 비교하는 자연 실험 장치가 공짜로 존재한다. 이걸 활용하는 스크립트만 없다.
5. **골든 태스크 리플레이 (failure replay suite)** — `docs/qa/rca-history`의 실제 과거 실패 10~20건을 재현 가능한 태스크로 만들어 "과거 실패를 현재 하네스가 막는가"를 CI처럼 돌린다. 합성 테스트가 아니라 실제로 일어났던 실패이므로 "실제 사용자 관점 검증"에 가장 가깝다.
6. **설치 첫 경험(time-to-first-value)** — fresh-install 테스트가 이미 있으니, 신규 사용자가 설치 후 첫 유용한 주입을 받기까지의 단계 수/토큰을 측정.

### 우선순위

① recall-hits 분석 CLI (반나절 작업, 즉시 가시성 확보) → ② 재발률 리포트 → ③ failure replay suite.

---

## 2. SQLite 연결성 + 온톨로지의 비(非)git 관리

### 발견한 사실

- **state-store는 설계만 있고 사실상 끊겨 있다.** 기본 경로(`~/.claude/ecc/state.db`)에 DB 파일이 존재하지 않는다. 소비자는 `sessions-cli.js`, `status.js`, `skill-evolution/tracker.js` 정도인데, 정작 핵심 메모리 경로(decisions.js, 인스팅트, 세션 요약, recall 로그)는 전부 파일/JSONL에 직접 쓰고 DB를 거치지 않는다.
- **문서-코드 드리프트:** `docs/features/state-store.md`는 기본 경로를 `~/.claude/ecc-state.db`로, 코드(`scripts/lib/state-store/index.js:12`)는 `~/.claude/ecc/state.db`로 정의 — 서로 다르다.
- **동시성 위험:** sql.js는 쓰기마다 DB 전체를 `export()`해 파일로 덮어쓴다. 병렬 에이전트/훅이 각자 메모리 사본을 들고 있다가 마지막 쓰기가 이기는(last-writer-wins) 구조라, 지금 상태로 핫패스에 붙이면 데이터 유실이 난다. 반면 decisions.js는 자체 lockfile(refs.lock)을 이미 구현해서 두 시스템의 동시성 전략이 갈라져 있다.

### 온톨로지의 git 없는 관리 — 문제의 본질

온톨로지는 세 표현이 공존한다: `index.json`(기계), `docs/features/*.md`(사람), `CHANGELOG.md`(감사 로그). 이 repo 안에서는 git이 버전 관리를 해주지만, **플러그인으로 설치된 호스트 프로젝트나 `~/.claude/` 글로벌 데이터(decisions JSONL, 인스팅트)는 git 밖에 있다.** 현재 이 데이터에는 스냅샷도, 롤백도, 무결성 검증도, 보존 정책도 없다.

### 제안 — 3계층 분리

| 계층 | 담당 | 버전 관리 방식 |
|---|---|---|
| git | 사람이 작성한 spec MD, 스키마, 큐레이션된 constraint | git 그대로 |
| SQLite (state-store) | 런타임에 변하는 것: decisions, 인스팅트 confidence, recall 히트 | `revisions` 테이블 (entity, version, valid_from, valid_to) |
| JSONL | append-only 이벤트 로그 — 재생(replay)의 원천 | 시퀀스 번호 + 주기적 체크섬 스냅샷 |

핵심 논리: **지금 decisions.js가 런타임에 git 추적 파일(`domain_*.json`)을 변형하는 것 자체가 긴장 지점이다.** 플러그인 사용자의 런타임 데이터가 플러그인의 git 파일에 쓰이면 안 되므로, "런타임 가변 데이터는 DB로, 사람이 만든 지식은 git으로"의 분리가 어차피 필요하다. 이렇게 하면 state-store의 존재 이유(지금은 모호함)도 명확해진다.

### 부가 제안

- **temporal versioning** — constraint에 `valid_from`/`superseded_by`를 붙이면(Zep 스타일, 리서치 문서 Track A #8) "git 없는 롤백"이 DB 안에서 가능해진다. 2026-04-18 changelog의 decay control 작업이 이미 이 방향의 시작.
- **단일 기록자(single-writer) 원칙** — sql.js 유지 제약(네이티브 빌드 의존성 회피)이 온톨로지 constraint로 명시돼 있으므로, better-sqlite3 교체 대신 "모든 DB 쓰기는 하나의 CLI 진입점을 거친다 + lockfile"이 제약에 부합하는 답이다.
- **`repair.js`/`doctor.js` 확장** — 기존 도구에 "JSONL→DB 재구축", "체크섬 검증" 복구 경로를 붙이면 git 없이도 손상 복구가 된다.
- **최소 조치** — state-store.md 경로 드리프트 수정 + "state-store가 실제로 뭘 담당하는가" 결정 (연결하거나 제거하거나 — 지금처럼 반쯤 존재하는 게 최악).

---

## 3. 메모리 계층 보완 + 컨텍스트 주입 개선

### 발견한 갭

1. **compaction 후 dedup 상태 미초기화 (실질 버그 후보).** `domain-context-inject`의 중복 방지 상태(`/tmp/ecc-injected-<sessionKey>.json`)는 session_id 기준인데, auto-compact가 일어나도 session_id는 유지된다. 컨텍스트는 요약되면서 주입됐던 도메인 constraint가 날아가는데 dedup은 "이미 주입됨"이라고 기억해서 **재주입이 영구히 안 된다.** 연속성 패킷은 `source=compact`를 특별 처리하는데(`scripts/hooks/session-start.js:57`) 도메인 주입은 그렇지 않다. PreCompact 훅에서 이 상태 파일을 지우는 것만으로 해결된다.
2. **회상 스코어링 부재.** 인스팅트는 confidence 단일 축, decisions는 "최근 N개"뿐이다. Generative Agents식 recency×importance×relevance 3축이 없어서, 오래됐지만 치명적인 결정보다 최근의 사소한 결정이 이긴다.
3. **유용성 피드백 루프 부재.** recall-hits는 "얼마나 주입했나"만 기록한다. 주입된 constraint 관련 편집이 이후 검사를 통과/실패했는지를 이어 붙이면 constraint별 유용성 점수가 생기고, 이것이 곧 eviction(퇴출) 정책의 근거가 된다.
4. **계층 간 승격 경로가 절반만 존재.** 에피소드→의미(RCA→constraint)는 있는데, 반대 방향 정리(오래된 에피소드 기억의 통합·삭제)와 decisions 클러스터링(단발 노이즈 vs 구조적 반복 구분)이 없다. 8개 저장소가 각자 자라기만 한다.

### 제안

- **4계층 공식화** — working(세션) / episodic(세션 요약, failure trace) / semantic(온톨로지) / procedural(인스팅트, 스킬)로 기존 8개 저장소를 명시적으로 매핑하고, 각 계층에 (a) 승격 조건 (b) decay/eviction 정책 (c) 토큰 예산을 문서화. 지금은 이 매핑이 코드에 암묵적으로만 존재한다.
- **예산 기반 우선순위 주입** — 세션당 주입 토큰 총예산을 정하고 constraint > failure pattern > decision > instinct 순으로 채우기. `context-budget` 스킬과 연결하면 스킬이 문서에서 실장치로 승격된다.
- **주기적 reflection 잡** — decisions JSONL을 배치 클러스터링해 반복 패턴만 constraint로 승격 (리서치 문서 Track A #3의 Mistake Notebook 방식 — 후보로 이미 정리돼 있으니 구현만 남음).

---

## 4. 차별화 — 설계 철학에 맞는 업그레이드

철학이 "실수가 구조적으로 재발 불가능하게 시스템을 바꾼다"인데, 현재 **이 주장은 검증 불가능한 상태**다. 여기서 가장 큰 차별화 기회가 나온다.

1. **"증명하는 하네스" (최우선 추천).** §1의 재발률 지표 + failure replay suite를 합치면, oh-my-forge는 "우리 학습 루프가 작동함을 수치로 증명하는" 유일한 하네스가 된다. 다른 하네스 프로젝트들은 전부 "느낌상 좋아짐"에 머물러 있다. README에 실제 재발률 그래프 하나가 어떤 기능 목록보다 강력하다.
2. **Constraint 생애주기 = "살아있는 헌법".** constraint마다 출처(어느 실패에서, 언제, 증거), 유효 기간, machine-checkable 패턴(`|pattern:` 이미 존재)을 붙이고, blast-radius 감지로 코드 변경 시 자동 폐기 후보를 올린다. "constraint는 늘기만 하고 줄지 않는다"는 온톨로지 비대화 문제는 이 접근의 아킬레스건이므로, decay를 숨은 유지보수가 아니라 **간판 기능**으로 만들어야 한다.
3. **온톨로지 포맷의 표준화·이식성.** `_schema.json`이 이미 있고 Codex/OpenCode 패리티도 이미 관리 중이다. "에이전트 하네스용 온톨로지 인터체인지 포맷"으로 스키마를 스펙 문서화해 공개하면, 개별 도구가 아니라 표준의 자리를 노릴 수 있다.
4. **brownfield 온보딩이 채택의 쐐기.** `/ontology-extract`로 임의 repo에서 온톨로지를 자동 생성한 직후, 동일 태스크의 토큰 사용량을 before/after로 측정해 보여주면 설치 시점에 가치가 정량화된다. "설치하고 5분 안에 토큰 40% 절감 확인" 같은 경험이 오픈소스 확산의 결정타다.
5. **(선택) 커뮤니티 실패 패턴 라이브러리.** 글로벌 인스팅트 구조가 이미 있으므로, 익명화된 constraint/failure-pattern의 opt-in 공유로 네트워크 효과를 만들 수 있다. 다만 1~4보다 후순위.

---

## 5. 즉시 조치 가능한 발견 사항 (버그/드리프트)

- `docs/features/state-store.md` 경로(`~/.claude/ecc-state.db`) vs 코드(`~/.claude/ecc/state.db`) 불일치
- compaction 후 `domain-context-inject` dedup 상태 미초기화 → 도메인 컨텍스트 영구 유실 가능성
- `recall-hits.jsonl` 계측의 소비 도구 부재 (쓰기 전용 계측)
- state-store가 핵심 메모리 경로와 미연결 상태로 방치 (연결 또는 제거 결정 필요)

---

## 결론

네 관점 모두에서 공통으로 드러난 것은 하나다: 시스템(온톨로지→constraint→주입→학습)의 각 부품은 잘 만들어져 있는데, **"효과가 있었는지 되먹임하는 고리"가 전부 끊겨 있다.** recall-hits는 쓰기만 되고, state-store는 아무도 안 쓰고, 주입된 컨텍스트의 유용성은 측정되지 않고, "재발 불가"라는 핵심 주장은 검증 장치가 없다.

권장 우선순위: **측정(§1) → 저장 계층 정리(§2·§3) → 측정 결과 자체를 차별화 포인트로 공개(§4).**
