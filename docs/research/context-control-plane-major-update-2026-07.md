# OMF 2.0 후보: Evidence-Gated Context Control Plane

조사 기준일: 2026-07-21
입력: 제공된 프로젝트 요약, 현재 OMF 1.20.0 코드·문서·테스트, 최신 논문과 현업 자료

## 결론

OMF가 다음 메이저 버전에서 추가해야 할 것은 또 하나의 메모리, handoff 문서, context compiler, 멀티 에이전트 오케스트레이터가 아니다. 이 영역은 이미 유사 제품이 많고 OMF의 현재 구현과도 겹친다.

가장 날카로운 문제는 다음이다.

> 에이전트가 세션·컴팩트·모델 전환 경계에서 관찰한 것을 검증된 사실로 잘못 승격하고, 다음 에이전트가 그 오판을 비용을 내며 재사용한다.

따라서 OMF 2.0의 후보 포지셔닝은 다음이 적절하다.

> **Evidence-Gated Context Control Plane**
> 컨텍스트를 더 저장하는 시스템이 아니라, 다음 행동에 필요한 최소 컨텍스트를 선택하고 그 근거·유효성·검증 상태를 함께 통제하는 로컬 우선 하네스.

핵심은 새 저장 형식의 확산이 아니라 기존 OMF의 `hooks`, `ontology`, `handoff`, `state-store`, `harness events`, `golden tasks`, `paired benchmark`를 하나의 증거 계약으로 연결하는 것이다.

## 왜 이 문제가 실제 문제인가

### 논문이 보여주는 것

- 긴 입력은 전체 위치를 균등하게 활용하지 못한다. `Lost in the Middle`은 중요한 정보가 입력 중간에 있을 때 성능이 크게 떨어질 수 있음을 보였다. [Liu et al., 2023](https://arxiv.org/abs/2307.03172)
- 코딩 에이전트는 탐색한 컨텍스트보다 실제 해결에 사용한 컨텍스트가 적고, 정밀도보다 재현율을 선호하는 경향이 있다. 즉 “많이 회수”는 “잘 사용”이 아니다. [ContextBench, 2026](https://arxiv.org/abs/2602.05892)
- 작업 위치가 정해진 뒤에는 파일 전체보다 작업에 필요한 압축 표현이 훨씬 적은 토큰으로 같은 문제를 풀 수 있다는 초기 결과가 있다. 단, 이 연구는 프리프린트이고 온도 0에서도 결과 변동이 관찰되므로 작은 효과를 과신해서는 안 된다. [What Context Does a Coding Agent Actually Need to Act?, 2026](https://arxiv.org/abs/2607.09691)
- 컴팩트는 단순한 길이 축소가 아니라 사실성 문제를 만들 수 있다. 최근 사례 연구는 timeout으로 종료된 프로세스의 일부 출력이 다음 세션에서 성공 결과처럼 재사용되는 실패를 보고했다. [Compaction as Epistemic Failure, 2026](https://arxiv.org/abs/2607.13071)
- 구조화된 에피소드와 의존 관계를 사용해 결정론적으로 eviction하는 접근은 요약의 손실과 환각을 줄일 가능성을 제시한다. 다만 아직 OMF에 그대로 복사할 근거는 부족하므로, 먼저 작은 결정론적 정책으로 검증해야 한다. [Beyond Compaction: Structured Context Eviction, 2026](https://arxiv.org/abs/2606.11213)
- 예산을 컨텍스트 관리의 명시적 제약으로 다루는 연구는 “모든 것을 넣기”가 아니라 관찰을 넣을지, 얼마나 압축할지 순차적으로 결정해야 한다는 문제를 정식화한다. [ContextBudget, 2026](https://arxiv.org/abs/2604.01664)

### 현업이 이미 확인한 것

Anthropic의 장기 실행 하네스 자료도 컴팩트만으로 충분하지 않으며, 세션 초기화·작업 분해·구조화된 진행 산출물·독립 평가가 필요하다고 설명한다. 특히 다음 세션이 현재 상태를 추측하지 않도록 파일과 git 같은 외부 산출물에 진행 상태를 남기는 것이 핵심이다. [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)

Anthropic의 context engineering 원칙도 목표를 “가장 많은 토큰”이 아니라 “목표 결과의 가능성을 높이는 가장 작은 고신호 토큰 집합”으로 둔다. 이는 OMF의 ontology packet을 더 크게 만드는 방향과 반대이며, 패킷 선택·근거·퇴출을 제품 핵심으로 삼아야 한다는 뜻이다. [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

## 현재 OMF가 이미 가진 것

| 축 | 현재 구현 | 판단 |
|---|---|---|
| Observe | `harness-events`, recall log, session/state store, cost·task outcome 기록 | 기반은 충분하나 이벤트가 `context_injection`/`task_outcome` 중심이라 작업 탐색·컴팩트·검증 근거의 공통 trace가 약함 |
| Decide | ontology routing, 파일·도메인 매칭, 세션 선택 | 관계 분류(`continue`, `related-reset`, `fresh`, `fork`, `ask-user`)와 주입 거부 정책이 없음 |
| Act | ontology packet, Codex handoff, guards, domain/QA injection | 기능은 있으나 요청별 예산·증거 상태에 따라 행동을 선택하는 planner가 없음 |
| Re-ground | false-normal detector, golden task runner, paired benchmark, verification contract | 좋은 안전장치가 있으나 release-grade 모델 평가의 격리·통계·baseline-failing은 외부 adapter에 크게 의존 |
| Learn | RCA, decisions, instincts, recall report, skill evolution | 회상 유용성은 proxy이고, “무엇이 실제 행동을 바꿨는가”와 “어떤 주장이 검증됐는가”가 분리되어 있지 않음 |
| Portability | Claude/Codex/Gemini/OpenCode 대상 설치·handoff 구조 | 새 전용 프로토콜보다 AGENTS.md, MCP, OpenTelemetry 같은 기존 생태계에 연결하는 편이 타당 |

따라서 이 작업은 처음부터 다시 만드는 프로젝트가 아니다. OMF의 문제는 부품 부족보다 **상태 의미론과 피드백 연결이 끊겨 있는 것**이다.

## OMF 2.0의 최소 핵심 계약

### 1. Observation, Claim, Verification을 분리한다

모든 지속 가능한 컨텍스트 항목은 다음 세 층을 구분해야 한다.

```text
Observation  실제 도구/파일/프로세스에서 관찰한 것
Claim        에이전트 또는 하네스가 관찰을 해석한 것
Verification 독립적인 명령·파일 hash·테스트·git 상태가 확인한 것
```

권장 상태는 `observed`, `inferred`, `verified`, `stale`, `superseded`, `unknown`이다. `success`라는 자연어 문장만으로 `verified`가 되면 안 된다. 종료 코드, signal, 실행 시각, 대상 파일·snapshot hash 같은 결정적 근거가 있어야 한다.

이 계약은 OMF 내부 JSON Schema로 최소 구현하고, 외부 observability는 OpenTelemetry GenAI semantic conventions에 매핑한다. OMF 전용 telemetry 표준을 새로 만들 필요가 없다. [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/), [OpenTelemetry for Generative AI](https://opentelemetry.io/blog/2024/otel-generative-ai/)

### 2. Task Boundary Switchboard는 자동 실행기가 아니라 제안기다

각 요청을 다음 중 하나로 분류한다.

```text
continue       이전 목표·branch·작업 파일·미완료 상태를 이어감
related-reset  같은 저장소지만 이전 기억을 낮추고 새 하위 작업으로 시작
fresh          이전 작업을 주입하지 않음
fork           기존 상태를 보존하고 별도 방향으로 실행
ask-user       신호가 충돌해 자동 주입하지 않음
```

초기에는 판정 이유와 주입할 패킷의 preview만 보여주고 사용자가 승인할 수 있게 한다. 오판 비용이 큰 경계에서 자동 전환을 먼저 도입하면 OMF가 해결하려는 문제를 다시 만든다.

### 3. Context Planner는 토큰이 아니라 다음 검증 가능한 행동을 최적화한다

최적화 목표를 다음처럼 정의한다.

```text
cost_to_first_valid_action
  = input tokens
  + rediscovery work
  + hook/context latency
  + user intervention cost
```

초기 planner는 학습 모델이 아니라 결정론적 정책이어야 한다.

1. 현재 branch·worktree·diff·task hash를 확인한다.
2. 관련 도메인과 심볼을 찾는다.
3. `verified`이며 현재 파일·snapshot에 유효한 항목을 먼저 선택한다.
4. `unknown`·`stale`·충돌하는 항목은 낮추거나 명시적으로 표시한다.
5. 예산을 넘으면 오래되고 복구 가능한 실행 기록부터 제거한다.
6. 패킷 마지막에 “다음 행동 1개”와 “재검증할 주장”을 둔다.

벡터 DB, 장기 메모리 모델, RL 기반 최적화는 이 결정론적 기준선이 측정된 뒤에만 검토한다.

### 4. Compaction은 보존이 아니라 재검증 경계다

PreCompact에서 현재 작업 상태를 저장하는 것에 더해, post-compact/session-start에서 다음을 다시 확인한다.

- 마지막 명령의 실제 exit code와 signal
- 테스트가 실행된 시각과 대상 snapshot
- 변경 파일 및 file hash/diff 요약
- 미완료 작업과 다음 행동
- 컴팩트 summary가 주장하지만 근거가 없는 항목

검증 근거가 없는 성공 주장은 `unknown`으로 남기고, 새 에이전트에 “통과했다”고 주입하지 않는다. 이 부분이 OMF의 기존 false-normal detector와 가장 직접적으로 연결되는 메이저 업데이트다.

## 바퀴를 재발명하지 않는 포터빌리티 원칙

- 프로젝트 규칙과 작업 계약은 기존 `AGENTS.md`/Markdown을 계속 사용한다. AGENTS.md는 도구 중립적인 Markdown 형식으로 유지되는 공개 포맷이다. [AGENTS.md](https://agents.md/index)
- 외부 도구·리소스 연결은 기존 MCP를 사용한다. OMF는 “context control” 정책을 제공하고, MCP 서버나 전용 tool transport를 새로 만들지 않는다. [MCP Tools specification](https://modelcontextprotocol.io/specification/draft/server/tools)
- 실행 trace와 모델/도구 비용 계측은 OpenTelemetry에 선택적으로 export한다. 기존 JSONL은 오프라인·프라이버시 우선 기본값으로 유지한다.
- Codex·Claude·Gemini·OpenCode adapter는 provider-specific 세션 복제가 아니라 공통 `Task Boundary + Grounding Receipt` 계약만 구현한다.
- 외부 클라우드 동기화, 영구 사용자 프로필, 범용 agent marketplace는 OMF 2.0 범위에 넣지 않는다.

## 메이저 업데이트 범위

### P0 — Evidence contract와 평가 오염 차단

- Observation/Claim/Verification 상태와 provenance를 담는 내부 schema 추가
- 기존 `harness-event`는 하위 호환을 유지하면서 `compaction`, `tool_observation`, `verification_receipt`, `boundary_decision` 이벤트를 additive하게 확장
- `success`를 기록할 때 실제 exit code·signal·snapshot/file hash가 없으면 `unknown`
- `golden-tasks`의 harness regression suite와 모델 성능 suite를 분리
- 기준 상태에서 실패하지 않는 task는 모델 성능 점수에 넣지 않도록 preflight 차단
- state-store 문서와 코드 경로를 하나로 결정하고, 런타임 데이터의 단일 기록 경로를 정함

### P1 — Boundary Switchboard와 deterministic Context Planner

- 관계 분류기와 confidence/reason 목록 추가
- `ask-user`를 기본 안전 fallback으로 제공
- context budget, packet profile, eviction 우선순위, preview CLI 추가
- `domain-context-inject`가 현재 요청과 무관하거나 `stale/unknown`인 항목을 주입하지 않도록 연결

### P2 — Compaction Integrity와 Re-ground loop

- PreCompact receipt와 post-compact verifier 추가
- false-normal detector를 자연어 패턴 검출에서 증거 상태 전이 검사로 확장
- “다음 행동 1개 / 재검증할 주장 / 읽을 파일 2~3개”를 handoff contract에 고정
- compaction 후 동일 session에서 필요한 domain injection을 재허용하되 중복 주입은 방지

### P3 — Measurement-grade release gate

- paired runner에 task별 win/loss/tie, 품질 비열등성, paired bootstrap/McNemar 등 통계 출력 추가
- adapter 격리·snapshot 복원·provider/model/config fingerprint를 검증
- `context-only`, `hooks-only`, `minimal-harness` ablation을 지원
- primary metric은 quality, secondary metric은 token/time/cost, risk metric은 false-normal·human intervention·scope violation으로 분리

### P4 — Portable adapters와 공개 결과

- AGENTS.md/MCP/OpenTelemetry mapping 문서 및 최소 adapter 계약 공개
- provider별 세션 복제가 아니라 공통 receipt/packet만 교환
- 민감한 prompt/source/model output은 로그에 저장하지 않고 hash·metadata·검증 결과만 남김
- 실제 파일럿 결과가 있을 때만 README에 성능 주장을 추가

## 성공 기준과 중단 기준

첫 파일럿 전 숫자를 고정해 결과에 맞춰 바꾸지 않는다. 최소한 다음을 사전 등록한다.

### 품질

- baseline-failing task의 deterministic verifier 통과율
- 사용자 개입 없는 성공률
- false-normal completion rate
- scope violation/security regression rate

### 효율

- 첫 유효 행동까지 시간
- 첫 검증 실행까지 시간
- 불필요한 재독해 파일 수
- 입력·출력·총 토큰, tool calls, hook latency, 비용

### 효과 판정

- 품질이 사전 정의한 비열등성 마진을 벗어나면 컨텍스트 최적화가 성공해도 release blocker
- 품질이 비열등하고 첫 검증·재탐색·비용 중 하나가 개선될 때만 기능 효과로 인정
- `environmentIntegrity=unverified` 결과는 제품 성능 주장에 사용하지 않음
- `verified` 비율이 낮거나 `unknown`을 숨기는 adapter는 벤치마크에서 제외

## 하지 않을 것

- 범용 영구 메모리 제품 만들기
- 또 하나의 handoff/agent-state 포맷 만들기
- 벡터 검색을 기본 저장소로 도입하기
- 모델 내부 추론이나 비공개 세션을 다른 모델로 복제한다고 약속하기
- LLM이 만든 summary를 검증 없이 source of truth로 저장하기
- 자동 모델 전환을 첫 릴리스의 핵심 기능으로 만들기
- 통계 없는 on/off 성공률로 OMF가 모델 성능을 개선한다고 주장하기

## 최종 판단

이 저장소는 이미 좋은 부품을 갖고 있으므로 새 프로젝트를 만들 필요가 없다. OMF 2.0은 다음 한 문장으로 정의하는 것이 타당하다.

> **OMF는 에이전트의 기억을 늘리는 도구가 아니라, 세션 경계에서 검증 가능한 다음 행동만 통과시키는 하네스다.**

이 방향은 현재 코드의 연속성·온톨로지·하네스 평가 작업을 폐기하지 않고 하나의 제품 축으로 묶는다. 첫 구현은 P0의 증거 계약과 평가 오염 차단이어야 하며, 실제 모델 파일럿 전에는 성능 개선을 주장하지 않는다.
