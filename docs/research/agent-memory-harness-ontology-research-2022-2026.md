# AI 에이전트 / 메모리 / 하네스·루프 엔지니어링 / 온톨로지 / 컨텍스트 관리 리서치 (2022–2026)

oh-my-forge(ontology 기반 harness) 메인테이너 관점에서 정리. 두 트랙으로 구성:

- **Track A** — 지금 프로젝트에 바로 적용 가능한 기능/성능 개선 아이디어
- **Track B** — 메인테이너 스터디용 개념 지도 (읽는 순서 추천 포함)

마지막에 참고할 오픈소스 프로젝트 목록.

---

## 1. 논문 지도

### 1.1 에이전트 메모리 (Memory)

| 논문/시스템 | 시기 | 핵심 아이디어 | oh-my-forge 연결점 |
|---|---|---|---|
| [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442) (Park et al., 2023) | 2023 | memory stream + recency/importance/relevance 3축 점수로 회상, reflection으로 관찰→상위 통찰 압축 | `qa-knowledge-layer`, `iterative-retrieval` 스킬의 회상 스코어링에 참고 가능 |
| [MemGPT](https://arxiv.org/abs/2310.08560) (Packer et al., 2023) | 2023 | OS 페이징 방식으로 제한된 컨텍스트를 가상 메모리처럼 관리 (main context / external context) | `state-store.md`, `continuous-agent-loop` 스킬과 직접 대응되는 원조 아키텍처 |
| [Memory in the Age of AI Agents: A Survey](https://github.com/Shichun-Liu/Agent-Memory-Paper-List) | 2024–25 | factual memory vs experiential memory 분류, 메모리 예산·정책 평가 프레임 필요성 제기 | `continuous-learning-v2` 설계 검토 시 분류 체계로 활용 |
| [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956) | 2025-01 | 시간 유효성(fact-validity window)을 추적하는 temporal KG, LongMemEval에서 Mem0 대비 +15p | 온톨로지에 "언제부터 유효한 constraint인가"를 넣는 아이디어 |
| [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413) | 2025-04 | 대화에서 salient 정보만 추출·통합, hybrid vector+graph+KV | 세션 간 학습(계속 학습) 파이프라인의 압축 전략 참고 |
| [Hierarchical Memory for High-Efficiency Long-Term Reasoning in LLM Agents](https://arxiv.org/abs/2507.22925) | 2025-07 | short/mid/long-term 3계층 메모리, segment-page 동적 갱신(MemoryOS 계열) | `context-budget` + `state-store` 계층화 설계에 참고 |
| [Lifelong Learning of Large Language Model based Agents: A Roadmap](https://arxiv.org/abs/2501.07278) | 2025-01 | 지속 학습을 perception/memory/action 루프로 정리한 로드맵 서베이 | `continuous-learning`/`continuous-learning-v2` 스킬의 이론적 배경 |
| [Your Code Agent Can Grow Alongside You with Structured Memory](https://arxiv.org/abs/2603.13258) | 2026-03 | 코딩 에이전트 전용 structured memory — 리포지토리 지식을 구조화해 누적 | oh-my-forge의 ontology index와 문제의식이 거의 동일. 가장 먼저 읽을 것 |

### 1.2 컨텍스트 엔지니어링 / 컨텍스트 예산·주입 (Context Management & Injection)

| 논문 | 시기 | 핵심 아이디어 | oh-my-forge 연결점 |
|---|---|---|---|
| [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Anthropic) | 2025 | "prompt engineering→context engineering" 전환 선언. 컨텍스트를 유한 자원으로 취급 | `context-budget`, `token-budget-advisor` 스킬의 실무 근거 |
| [Agentic Context Engineering (ACE)](https://arxiv.org/abs/2510.04618) | 2025-10 | 컨텍스트를 "진화하는 playbook"으로 취급. brevity bias(요약이 도메인 지식을 깎아먹음), context collapse(반복 재작성이 디테일을 침식) 문제 정의 | 온톨로지 constraints를 요약하지 않고 "누적·정제"하는 방식으로 갱신할 근거 |
| [Context Engineering 2.0](https://arxiv.org/abs/2510.26493) | 2025-10 | context engineering을 프롬프트가 아니라 "에이전트가 세계를 이해하는 방식" 전체로 재정의 | ontology index를 GPS로 쓰는 현재 설계와 철학적으로 일치 |
| [ContextBudget: Budget-Aware Context Management for Long-Horizon Search Agents](https://arxiv.org/abs/2604.01664) | 2026-04 | 토큰 예산을 명시적 제약으로 걸고 검색/추론 스텝별로 배분 | 이름부터 프로젝트 스킬 `context-budget`과 동일 문제의식 — 알고리즘 참고 1순위 |
| [Acon: Optimizing Context Compression for Long-horizon LLM Agents](https://arxiv.org/abs/2510.00615) | 2025-10 | 실패 기반 가이드라인 최적화로 압축 손실 최소화 | 압축 시 constraint 유실 방지 설계에 참고 |
| [Structured Context Eviction (Beyond Compaction)](https://arxiv.org/abs/2606.11213) | 2026-06 | 요약 대신 typed dependency graph + 결정론적 eviction 정책 (요약의 손실·환각 문제 회피) | ontology index처럼 구조화된 데이터는 요약보다 eviction이 안전하다는 근거 |
| [Parallel Context Compaction for Long-Horizon LLM Agent Serving](https://arxiv.org/abs/2605.23296) | 2026-05 | 압축이 추론을 막지 않도록 병렬화 | 세션 간 auto-compact 성능 문제 있으면 참고 |

### 1.3 하네스 엔지니어링 (Harness Engineering)

| 논문/글 | 시기 | 핵심 아이디어 | oh-my-forge 연결점 |
|---|---|---|---|
| [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Anthropic) | 2025–26 | 장시간 작업의 근본 문제 = "세션마다 기억이 초기화됨". 세션 간 진행 상황을 파일/상태로 externalize해야 함 | oh-my-forge의 ontology index + HANDOFF 포맷이 이 문제의 해법 사례 |
| [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) (Anthropic) | 2026 | 툴을 추가하기보다 모델이 이미 아는 툴(파일, bash, git)을 쓰게 하고, 능력이 오르면 하네스 가정을 제거하라는 원칙 | `/codex-delegate`, `/claude-implement`의 "엔진 교체 가능" 설계와 일치 |
| [Dive into Claude Code: The Design Space of Today's and Future AI Agent Systems](https://arxiv.org/html/2604.14228v1) | 2026-04 | Claude Code 코드베이스 역공학. AI 의사결정 로직은 코드의 1.6%뿐, 98.4%는 운영 인프라(권한, 훅, 상태관리 등) | "harness가 곧 시스템"이라는 oh-my-forge 철학의 실증적 근거. 훅/권한 설계 재검토 시 1순위 참고 |
| [Harness Engineering for Agentic AI Coding Tools: An Exploratory Study](https://arxiv.org/abs/2602.14690) | 2026-02 | Context Files, Skills, Subagents, Commands, Rules, Settings, Hooks, MCP — 8가지 구성 메커니즘을 실증 분류 | oh-my-forge의 `agents/`, `skills/`, `commands/`, `hooks/`, `rules/` 구조와 거의 1:1 대응 — 분류 체계로 자체 문서 점검 가능 |
| [The Interplay of Harness Design and Post-Training in LLM Agents](https://arxiv.org/abs/2606.25447) | 2026-06 | 동일 모델도 하네스 설계에 따라 성능 편차가 post-training 효과만큼 큼 | "harness가 모델보다 성능에 더 크게 기여할 수 있다"는 정량적 근거 — README의 핵심 주장 보강 |
| [Harnessing Agent Skills](https://arxiv.org/abs/2606.20631) | 2026-06 | skill-mediated agent를 위한 참조 아키텍처 패턴 | 스킬 100개+ 보유한 `skills/` 구조 재설계 시 참고 |
| [Code as Agent Harness](https://arxiv.org/abs/2605.18747) | 2026-05 | 코드 자체를 실행 가능·검증 가능·상태 유지 가능한 하네스로 취급 | Codex delegate의 machine-checkable constraint pattern(`|pattern:keyword`) 아이디어와 연결 |

### 1.4 루프 엔지니어링 (Loop Engineering) & 자기수정 루프

| 논문/개념 | 시기 | 핵심 아이디어 | oh-my-forge 연결점 |
|---|---|---|---|
| [ReAct: Synergizing Reasoning and Acting](https://arxiv.org/abs/2210.03629) (Yao et al.) | 2022 | Thought→Action→Observation 인터리빙. 이후 거의 모든 에이전트 루프의 기본 단위 | `loop-operator` agent의 기본 루프 단위 |
| [Reflexion: an autonomous agent with dynamic memory and self-reflection](https://arxiv.org/abs/2303.11366) (Shinn et al.) | 2023 | Actor/Evaluator/Self-Reflection 3역할 분리, 실패를 자연어 피드백으로 저장해 다음 시도에 주입 (fine-tuning 없이) | `continuous-learning` 파이프라인의 "실패 → instinct 변환" 로직과 구조적으로 동일 — 논문 레벨로 근거 강화 가능 |
| [Self-Refine](https://arxiv.org/abs/2303.17651) (Madaan et al.) | 2023 | 하나의 LLM이 generator/critic/refiner 역할을 순환, 7개 태스크 평균 +20% | `verification-loop` 스킬의 self-critique 단계 설계 근거 |
| Loop Engineering (Addy Osmani 등이 대중화, 2026-06) | 2026 | "무엇을 프롬프트할지"가 아니라 "언제·어떻게 재시도하고 언제 멈출지 결정하는 시스템"을 설계하는 것이 병목이라는 주장. Boris Cherny(Anthropic)·Peter Steinberger 논의 기반 | 아직 논문화되진 않은 업계 용어지만, `autonomous-loops`/`autonomous-agent-harness` 스킬이 이미 이 문제를 다루고 있음. 관련 업계 글을 근거로 스킬 문서에 "loop engineering" 용어를 명시적으로 채택하는 것도 방법 |
| [Mistake Notebook Learning](https://arxiv.org/abs/2512.11485) | 2025-12 | 실패를 배치로 클러스터링해 fine-tuning 없이 적응, retrieval 오버헤드 없이 정확도 개선 | `continuous-learning-v2`의 실패 분류·라우팅 로직에 바로 적용 가능한 알고리즘 |
| [Agentic Context Engineering (ACE)](https://arxiv.org/abs/2510.04618) (중복 인용, 루프 관점) | 2025-10 | context를 매 루프마다 generation→reflection→curation으로 갱신 | RCA 훅(`post-bash-commit-rca.js`) → ontology constraint 추가 파이프라인과 동일 3단계 구조 |

### 1.5 온톨로지 & 지식 그래프 기반 그라운딩

| 논문 | 시기 | 핵심 아이디어 | oh-my-forge 연결점 |
|---|---|---|---|
| [Ontology-Constrained Neural Reasoning in Enterprise Agentic Systems](https://arxiv.org/abs/2604.00555) | 2026-04 | 온톨로지 제약을 뉴로심볼릭하게 결합해 엔터프라이즈 에이전트의 hallucination 억제 | `.claude/ontology/`의 machine-checkable constraint(`|pattern:keyword`) 설계를 정식 뉴로심볼릭 아키텍처로 확장할 근거 |
| [Grounding LLM Reasoning with Knowledge Graphs](https://arxiv.org/abs/2502.13247) (Amayuelas et al.) | 2025-02 | 추론 스텝마다 그래프 구조 데이터에 근거를 연결, GRBench에서 CoT 대비 +26.5% | ontology index를 단순 파일 맵이 아니라 추론 단계별 grounding 소스로 확장하는 아이디어 |
| [LLM-Driven Ontology Construction for Enterprise Knowledge Graphs](https://arxiv.org/abs/2602.01276) | 2026-02 | LLM이 비정형 텍스트에서 온톨로지를 자동 생성 | RCA 결과를 온톨로지 constraint로 "자동 승격"하는 파이프라인 고도화에 직접 적용 가능 |
| [Towards Automated Ontology Generation from Unstructured Text: A Multi-Agent LLM Approach](https://arxiv.org/abs/2604.23090) | 2026-04 | 멀티에이전트가 스키마 가이드 추출을 온톨로지 경계 내에서 수행 | 여러 서브에이전트(architect, code-reviewer 등)가 공유 온톨로지를 갱신할 때의 충돌 방지 설계 참고 |
| [LLM-empowered knowledge graph construction: A survey](https://arxiv.org/abs/2510.20345) | 2025-10 | KG 구축 파이프라인 전반의 서베이 | `ontology-sync` 스킬 문서를 서베이 체계에 맞춰 재정리할 때 참고 |

---

## 2. Track A — 프로젝트에 바로 적용 가능한 개선 아이디어

우선순위 순으로 정리. oh-my-forge 기존 스킬/에이전트와 정확히 겹치는 것부터.

1. **`context-budget` 스킬에 명시적 토큰 예산 알고리즘 도입** — [ContextBudget 논문](https://arxiv.org/abs/2604.01664)은 이름부터 스킬과 동일한 문제를 다룸. 스텝별 예산 배분 로직을 참고해 `token-budget-advisor`와 통합 검토.
2. **온톨로지 요약 대신 eviction 방식 채택** — constraint를 요약(lossy)하지 말고 [Structured Context Eviction](https://arxiv.org/html/2606.11213) 방식처럼 typed dependency graph + 결정론적 정책으로 오래된/충돌하는 constraint를 제거하는 방식으로 `ontology-sync` 갱신 로직을 개선.
3. **RCA→constraint 승격 파이프라인에 클러스터링 도입** — 현재 `post-bash-commit-rca.js`는 개별 커밋 단위로 RCA를 트리거. [Mistake Notebook Learning](https://arxiv.org/html/2512.11485)처럼 실패를 배치로 클러스터링해 패턴화하면, 노이즈성 단발 실패와 구조적 반복 실패를 구분해 constraint 생성 정밀도를 높일 수 있음.
4. **ACE의 "playbook" 갱신 3단계(generation→reflection→curation)를 continuous-learning-v2에 명시** — 지금 스킬 설명에 이 3단계를 명시적으로 넣으면 brevity bias/context collapse를 피하는 근거가 생김.
5. **LLM 기반 온톨로지 자동 생성 파이프라인** — [LLM-Driven Ontology Construction](https://arxiv.org/abs/2602.01276) 방식으로, RCA 결과 텍스트에서 `domain_*` 엔트리 초안을 자동 생성 → 사람이 검수 후 병합하는 반자동 워크플로우를 `ontology-sync`에 추가.
6. **"Dive into Claude Code" 수치를 하네스 설계 점검에 활용** — 해당 논문의 "AI 의사결정 로직 1.6% vs 운영 인프라 98.4%" 프레임으로 `hooks/`, `rules/`, `agents/`를 감사(audit)하면, 실제로 판단 로직이 필요한 곳과 순수 배관(plumbing)인 곳을 구분해 훅 비대화를 막을 수 있음.
7. **`loop-operator`/`autonomous-loops`에 "언제 멈출지" 정책을 명시적 파라미터화** — loop engineering 논의(Anthropic/Osmani)의 핵심은 재시도·중단 기준의 명시화. 현재 스킬에 종료 조건(성공 판정, 최대 재시도, 비용 상한)이 문서화돼 있는지 점검.
8. **Zep 스타일 temporal validity를 constraint에 도입** — 온톨로지 constraint에 "언제부터 유효/언제 폐기됐는지"를 넣으면, 오래된 constraint가 새 아키텍처 결정과 충돌할 때 자동 감지 가능 (`architecture-decision-records` 스킬과 연계).

## 3. Track B — 메인테이너 스터디 순서 추천

1. **개념 지도 먼저**: Lilian Weng, [LLM Powered Autonomous Agents](https://lilianweng.github.io/posts/2023-06-23-agent/) — planning/memory/tool-use 3축 프레임을 먼저 잡기.
2. **하네스 철학**: Anthropic의 [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) — oh-my-forge 설계와 직접 대조하며 읽기 좋음.
3. **역공학 사례**: [Dive into Claude Code](https://arxiv.org/html/2604.14228v1) — 실제로 지금 쓰고 있는 도구의 내부 구조.
4. **원조 메모리 아키텍처**: [Generative Agents](https://arxiv.org/abs/2304.03442), [MemGPT](https://arxiv.org/abs/2310.08560) — 이후 모든 메모리 논문의 공통 어휘.
5. **자기수정 루프**: [ReAct](https://arxiv.org/abs/2210.03629) → [Reflexion](https://arxiv.org/abs/2303.11366) → [Self-Refine](https://arxiv.org/abs/2303.17651) — 순서대로 읽으면 루프 설계의 진화가 보임.
6. **컨텍스트 엔지니어링 최신**: [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) → [ACE](https://arxiv.org/abs/2510.04618) → [Context Engineering 2.0](https://arxiv.org/abs/2510.26493).
7. **온톨로지/그라운딩**: [Grounding LLM Reasoning with Knowledge Graphs](https://arxiv.org/abs/2502.13247) → [Ontology-Constrained Neural Reasoning](https://arxiv.org/abs/2604.00555).
8. **서베이로 정리**: [Memory in the Age of AI Agents: A Survey](https://github.com/Shichun-Liu/Agent-Memory-Paper-List), [Lifelong Learning of LLM-based Agents: A Roadmap](https://arxiv.org/abs/2501.07278).

---

## 4. 추천 오픈소스

### 메모리 프레임워크
- **[Letta](https://github.com/letta-ai/letta)** (구 MemGPT) — OS 페이징식 메모리 관리 원조. 세션 간 상태를 에이전트가 스스로 관리하는 런타임이 필요하면 이 구조가 oh-my-forge의 state-store 설계와 가장 가까움.
- **[Zep / Graphiti](https://github.com/getzep/graphiti)** — temporal knowledge graph. constraint에 유효기간 개념을 넣고 싶다면 참고할 구현체.
- **[Mem0](https://github.com/mem0ai/mem0)** — hybrid vector+graph+KV, 프로덕션 레퍼런스로 가장 널리 쓰임.
- **[Cognee](https://github.com/topoteretes/cognee)** — graph-native ECL(추출-인지-로드) 파이프라인, 14가지 검색 모드. 온톨로지 자동 생성 파이프라인 설계 시 참고할 만함.

### 코딩 에이전트 하네스
- **[OpenHands](https://github.com/All-Hands-AI/OpenHands)** (구 OpenDevin) — Docker 샌드박스, 이벤트 로그(Action/Observation) 기반 아키텍처. 하네스 구조를 문서화하는 방식이 잘 정리돼 있어 `docs/features/` 포맷 참고에 유용.
- **[SWE-agent](https://github.com/SWE-agent/SWE-agent)** (Princeton) — Agent-Computer Interface 개념의 원조. 미니멀한 참조 구현.
- **[Aider](https://github.com/Aider-AI/aider)** — CLI 기반, repo map + 자동 커밋. 커밋 정책(oh-my-forge의 conventional commit + RCA 트리거)과 비교해볼 만함.

### 서베이/큐레이션 저장소
- **[Awesome Harness Engineering](https://github.com/ai-boost/awesome-harness-engineering)**
- **[Awesome-Memory-for-Agents](https://github.com/TsinghuaC3I/Awesome-Memory-for-Agents)**
- **[Agent-Memory-Paper-List](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)**
- **[KG-LLM-Papers](https://github.com/zjukg/KG-LLM-Papers)**
- **[anthropics/cwc-long-running-agents](https://github.com/anthropics/cwc-long-running-agents)** — Anthropic이 공개한 장기 실행 에이전트 하네스 참조 구현. 훅/서브에이전트 패턴을 oh-my-forge와 직접 비교 가능.

---

## 5. 하네스 평가 지표 제안 vs 실제 검증된 지표 (Harness Eval Metrics Validation)

"테스트 통과가 아니라 하네스가 실제로 도움이 되는가"를 측정하려는 6개 제안 지표를 실제 학계/업계에서 검증된 지표와 대조. 완전히 새로 발명할 필요 없이 기존 지표를 이 프로젝트 데이터(커밋 컨벤션, recall-hits.jsonl, ECC_DISABLED_HOOKS 게이팅)에 맞게 재적용하면 됨.

| 제안 지표 | 대응하는 검증된 지표/방법론 | 근거 |
|---|---|---|
| 1. 제약 재발률 | **Defect Reopen Rate (DRR)** — `재발한 결함 / 수정 완료된 결함` 비율. SW 품질 지표로 수십 년간 쓰임 | [Defect Rate 가이드](https://www.minware.com/guide/metrics/defect-rate), [DRR 계산법](https://linearb.io/blog/defining-defect-rate) — "결함 재발률이 높으면 수정이 불완전했거나 회귀 테스트가 부족하다"는 해석까지 그대로 적용 가능. RCA→constraint 추가를 "fix"로, 같은 도메인 `fix:` 재발을 "reopen"으로 매핑하면 그대로 DRR 공식 |
| 2. fix-커밋 비율 추세 | **Defect Escape Rate / Defect Rate 추세** — 배포 후 결함이 얼마나 새어나가는지의 후행 지표로 업계 표준 | [Defect Escape Rate 측정법](https://stackify.com/measure-defect-escape-rate/), [Defect Rate 전략](https://axify.io/blog/defect-rate) |
| 3. recall 정밀도 | **Memory Precision / Memory Recall (LongMemEval)**, **Context Precision / Context Recall (RAGAS)** — 정확히 같은 개념을 이미 표준 지표로 정의: Precision = top-k 검색 중 관련 항목 비율(노이즈 측정), Recall = 정답에 필요한 사실 중 실제 검색된 비율(누락 측정) | [LongMemEval 설명](https://www.getfeather.store/theory/longmemeval-benchmark-explained), [RAGAS Context Precision/Recall](https://www.confident-ai.com/blog/rag-evaluation-metrics-answer-relevancy-faithfulness-and-more), [Structured Belief State: precision-aware 메모리 검색 벤치마크](https://arxiv.org/pdf/2605.11325) (2026-05, 메모리 검색 전용 precision 벤치마크 — recall-hits.jsonl에 가장 가까운 참조 구현) |
| 4. A/B 실행 하네스 | 순수 무작위 A/B는 이미 배포된 내부 개발 도구에는 현실적으로 어려움(제거 시 실무·윤리적 문제) → 업계는 **관찰적 dose-response 분석**을 대안으로 씀 | [GitHub Copilot and Developer Productivity: An Observational Dose-Response Analysis](https://arxiv.org/pdf/2606.00438) (2026-06) — GitHub 자체가 Copilot 효과 측정에 무작위 A/B 대신 사용 빈도(dose)-결과(response) 상관 분석을 씀. `ECC_DISABLED_HOOKS` on/off는 이미 자연 실험이지만, 완전 무작위 배정이 아니라면 이 논문의 dose-response 프레임을 따르는 게 더 방어 가능한 설계 |
| 5. 골든 태스크 리플레이 | **Production-failure-based regression suite / golden dataset** — 실제 프로덕션 실패를 고정(frozen) 테스트케이스로 변환해 회귀 스위트를 구성하는 방식은 이미 업계 표준 관행 (SWE-bench도 실제 GitHub 이슈/PR 기반으로 같은 원리) | [AI Agent Regression Testing From Production Failures](https://www.arthur.ai/column/regression-test-datasets-ai-agents-production-failures), [Agent Evaluation Suites That Actually Catch Failures](https://medium.com/@Praxen/agent-evaluation-suites-that-actually-catch-failures-02f4e9ab0243) — "PR마다 골든 케이스 ~30개, 5분 이내 완료, 회귀 시 머지 블록" 패턴을 그대로 `docs/qa/rca-history` 10~20건에 적용 가능 |
| 6. 설치 첫 경험 (time-to-first-value) | **Time to First Value (TTFV) / Activation Rate** — SaaS·개발자 도구 업계 표준 온보딩 지표. 개발자 도구는 통상 30분 이내 첫 결과를 목표치로 잡음 | [TTFV 프레임워크](https://www.digitalapplied.com/blog/customer-onboarding-time-to-value-2026-saas-metrics-framework), [SaaS 온보딩 퍼널](https://userpilot.com/blog/saas-user-onboarding-funnel/) — "14일 내 첫 가치 도달 시 12개월 리텐션 80%+, 30일 넘기면 35~50%"라는 벤치마크가 있어 `fresh-install` 테스트에 구체적 목표 시간(예: 30분/5단계 이내)을 넣을 근거가 됨 |

### 추가로 참고할 만한 것들

- **다차원 trajectory 평가 서베이**: [Evaluation and Benchmarking of LLM Agents: A Survey](https://arxiv.org/html/2507.21504v1) (2025-07), [A Survey on Evaluation of LLM-based Agents](https://arxiv.org/html/2503.16416v2) (2025-03) — "최종 출력만이 아니라 스텝별 궤적(trajectory)을 평가해야 한다"는 게 이제 표준 프레임. `harness-audit.js`가 정적 체크리스트에 머물러 있다면, 이 서베이의 trajectory-aware 평가 축(도구 선택 적절성, 루프 여부, 복구 여부)을 추가하는 방향
- **METR의 task messiness 개념**: 합성 벤치마크가 아니라 "실제 배포 조건처럼 지저분한(ambiguous, environment-dependent) 태스크"일수록 성능이 크게 떨어진다는 실증 — 골든 태스크 리플레이가 합성 eval보다 신뢰도 높은 이유의 근거 자료로 인용 가능
- **LLM-as-judge를 grader로 쓸 때의 타당성**: LLM judge와 인간 평가자 간 상관관계는 연구에 따라 Pearson 0.82~0.89 수준으로 보고되지만, "인간 평가자 간 합의(inter-annotator agreement)도 완벽하지 않다(0.62 수준)"는 caveat이 있음 — [Neither Valid nor Reliable? Investigating the Use of LLMs as Judges](https://arxiv.org/html/2508.18076v1) (2025-08). `eval-harness`의 Model-Based Grader를 신뢰 지표로 쓸 거면, 최소 표본에 대해 사람 검수와의 상관관계를 주기적으로 재검증하는 절차를 넣는 게 안전

---

## 참고: 검색 방법론 메모

이 문서의 논문/글은 2026년 7월 기준 웹 검색으로 수집. 일부는 2026년 초·중반 발표 논문이라 아직 동료 검토(peer review) 이전 프리프린트일 수 있음 — 프로덕션 결정에 반영하기 전 재확인 권장. "loop engineering"은 학술 용어라기보다 2026년 6월 이후 업계에서 퍼진 실무 용어에 가까움.
