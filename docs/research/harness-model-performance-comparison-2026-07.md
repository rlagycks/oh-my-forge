# 고성능 모델의 순정 실행과 OMF 하네스 실행 비교 분석 (2026-07-18)

## 결론 요약

현재 저장소만으로는 **OMF 하네스가 고성능 모델의 성능을 저하시킨다고 결론 내릴 수 없다.**
반대로 성능을 개선한다고 입증된 것도 아니다. 최근 추가된 paired runner는 비교 실행의
배관을 제공하지만, 실제 모델 어댑터·스냅샷 격리·통계 분석은 아직 외부에 있다.

현재 가장 큰 문제는 하네스의 효과가 아니라 **평가 타당도**다. `golden-tasks.json`의
14개 태스크는 모델이 변경을 수행했는지 검증하지 않고 기존 저장소의 테스트/검증 명령을
실행한다. 기준 브랜치에서 전체를 실행한 결과도 14/14 통과했다. 이 코퍼스를 그대로
사용하면 모델 성능이 아니라 현재 저장소 상태를 측정하게 된다.

따라서 첫 목표는 “OMF가 더 좋은가”가 아니라 다음 세 가지를 분리해 측정하는 것이다.

1. 품질: 동일한 모델이 과제를 성공적으로 해결하는가
2. 효율: 성공까지 토큰·도구 호출·시간·비용이 얼마나 드는가
3. 안전성/유지보수성: 잘못된 수정, 회귀, 무한 루프, 사용자 개입이 늘어나는가

## 확인한 자료와 현재 상태

분석 대상은 `docs/research`의 두 문서, 최근 추가된 `docs/evals` 문서/코퍼스,
paired runner와 스키마, 관련 테스트다. `docs/reasearch`는 저장소의 실제 경로가
아니며 현재는 `docs/research`가 올바른 경로다.

최근 변경의 의미는 다음과 같다.

| 영역 | 현재 제공되는 것 | 아직 제공되지 않는 것 |
|---|---|---|
| Golden task | RCA/실패 재현 코퍼스와 결정적 검증 | 모델이 실제로 코드를 수정했는지에 대한 사전 실패 상태 |
| Paired runner | on/off 랜덤 순서, 반복, task hash, episode, 토큰/시간/비용 메타데이터 | 모델 호출 어댑터, 스냅샷 복원 강제, 통계적 유의성/신뢰구간 |
| Recall report | recurrence와 episode-level usefulness proxy | recall이 원인이라는 인과 추론, 모델 품질 판정 |
| 연구 문서 | 컨텍스트 예산, 회귀/재발률, failure replay의 방향성 | 실제 순정 모델 대비 측정 결과 |

`project-improvement-analysis-2026-07.md`의 “실행 가능한 러너가 없다”,
“recall log 소비자가 없다”는 지적은 7월 18일의 최근 커밋 이후에는 부분적으로
해소됐다. 다만 그 문서의 핵심 결론, 즉 “에이전트 행동과 결과를 측정해야 한다”는
문제의식은 여전히 유효하다.

## 재현 가능한 검증 결과

실행한 검증은 다음과 같다.

- 기준 상태에서 `node scripts/run-golden-task.js --all ...`: 14/14 통과
- 전체 회귀 테스트 `npm test`: 855/855 통과
- paired runner 전용 테스트: 4/4 통과
- golden task 메타데이터/RCA 검증: 14개 정의 모두 통과

이 결과는 플러그인 코드의 현재 회귀 상태가 양호하다는 뜻이지, OMF가 모델의 문제
해결 능력을 높인다는 뜻은 아니다. 특히 14/14 baseline pass는 모델 비교 전에 반드시
차단해야 하는 평가 설계 결함이다.

## 현재 paired runner의 타당도 위협

### 1. 검증 명령이 모델 작업의 결과와 독립적일 수 있음 — Critical

runner는 어댑터가 반환한 뒤 같은 `cwd`에서 `executeVerification`을 호출한다.
검증은 `node`만 허용하고 `shell: false`로 실행하므로 명령 주입 방어에는 적절하지만,
태스크가 기준 상태에서 이미 통과하면 모델이 아무것도 하지 않아도 성공으로 기록된다.

또한 `success_criteria`는 메타데이터일 뿐 현재 runner가 직접 평가하지 않는다. 따라서
검증 명령은 다음 중 하나여야 한다.

- 모델이 먼저 실패하는 테스트를 포함하고 수정 후에만 통과하는 테스트
- 기준 상태에서는 실패하지만 정답 패치에서는 통과하는 숨은 검증
- 패치 존재, 변경 파일 범위, 회귀 테스트, 보안 불변식까지 함께 확인하는 검증 묶음

### 2. 스냅샷 격리가 어댑터의 약속에만 의존함 — Critical

문서는 동일 snapshot을 전달한다고 설명하지만, 실제 복원은 어댑터 책임이다. runner는
on 조건 실행 후 off 조건을 위해 작업 트리가 원상 복구됐는지 확인하지 않는다. 복원이
누락되면 첫 조건의 수정이 두 번째 조건의 입력으로 누출되어 paired 비교가 오염된다.

각 조건은 별도 worktree/container에서 시작하거나, 최소한 다음을 강제해야 한다.

1. 실행 전 snapshot hash 확인
2. 조건 실행 후 patch/diff 수집
3. 다음 조건 실행 전 snapshot 재복원
4. 복원 후 tree hash 재확인

### 3. on/off 조건의 모델·설정 동일성이 검증되지 않음 — High

runner는 어댑터가 보고한 provider/model/config를 기록하지만, on/off가 같은 값인지
검증하지 않는다. 어댑터가 조건별로 다른 모델, temperature, tool 정책, timeout을
사용하면 결과 차이를 하네스 효과로 해석할 수 없다.

최소한 한 paired run 안에서 다음 값은 동일해야 한다.

- provider와 exact model revision
- generation/runtime config
- tool 목록과 권한 수준
- timeout, max output budget, 네트워크/의존성 상태
- repository snapshot과 환경 변수 allowlist

하네스가 추가하는 컨텍스트 토큰과 hook 실행 시간은 비교 대상이므로 숨기면 안 된다.
다만 모델/도구 능력 자체가 달라진 경우에는 “하네스 성능”이 아니라 “제품 구성 변경”으로
별도 분류해야 한다.

### 4. 통계적 결론을 낼 수 없음 — High

현재 보고서는 성공률 차이 `on - off`와 합계 토큰/시간/비용만 제공한다. 신뢰구간,
task별 승패, tie, 분산, 효과 크기, 유의성 검정이 없다. 반복 1회에서는 우연한 모델
샘플링 차이와 하네스 효과를 구분할 수 없다.

동일 태스크·동일 반복의 paired 결과를 이용해 다음을 추가해야 한다.

- task별 on win / off win / tie
- 성공률 차이의 paired bootstrap 95% CI 또는 McNemar 검정
- 토큰·시간·비용 비율의 paired bootstrap CI
- 난이도/도메인/태스크 유형별 층화 결과
- timeout, 사용자 개입, 안전성 실패의 별도 비율

### 5. recall usefulness는 인과 효과가 아님 — Medium

recall report의 주입 후 성공률은 useful proxy다. `recall_used`가 없으면 문서도 인과
주장을 하지 말라고 명시한다. 실제 모델 비교에서는 on 조건에서만 주입 이벤트가 생기므로,
주입 여부·주입 토큰·관련 constraint id·최종 결과를 episode로 연결하되 “성공했으므로
컨텍스트가 원인”이라고 해석하지 않아야 한다.

## 권장 실험 설계

### 가설

- H0: OMF on과 off의 품질 차이는 실무적으로 허용 가능한 범위 안이다.
- H1-quality: OMF on이 품질을 낮춘다.
- H1-efficiency: OMF on이 품질은 유지하지만 토큰/시간/비용을 증가시킨다.
- H1-benefit: 장기·실패 재현 태스크에서 OMF on이 성공률 또는 재시도 횟수를 개선한다.

“성능 저하”는 품질 저하와 운영 오버헤드를 분리해서 보고한다. 예를 들어 품질은
비열등성 마진 안인데 입력 토큰이 25% 늘었다면 “모델 성능 저하 없음, 컨텍스트 비용
증가”로 분류한다.

### 조건

1. **Native/off**: 같은 모델과 도구 인터페이스, OMF context/rules/hooks/skills 없음
2. **OMF/on**: 실제 배포할 OMF 설정 전체 적용
3. **Ablation-context**: OMF를 켜되 context injection만 비활성화
4. **Ablation-hooks**: context는 유지하고 비필수 hook을 비활성화
5. **Minimal harness**: 안전/검증에 필수인 최소 hook만 유지

1과 2가 최종 사용자 비교이고, 3~5가 성능 저하의 원인을 찾는 진단 조건이다. “플러그인
전체”를 하나의 변수로만 보면 컨텍스트 과다, hook 지연, 도구 제한, 기억 회수 효과를
분리할 수 없다.

### 태스크 코퍼스

현재 14개 failure-replay task는 OMF 자체 회귀 방지용으로 유지한다. 모델 성능 벤치마크에는
별도 `model-performance` suite를 만들고 아래 층을 섞는다.

- 기준 상태에서 테스트가 실패하는 실제 코드 수정 태스크
- 장기 실행/다중 파일 태스크
- 모호하지만 범위가 명확한 brownfield 태스크
- 보안·이식성·회귀가 필요한 태스크
- OMF와 무관한 중립 태스크
- OMF가 도움을 받을 것으로 예상되는 과거 실패 태스크

각 태스크는 기준 snapshot에서 다음 preflight를 통과해야 한다.

1. verifier가 기준 상태에서 실패한다.
2. 알려진 정답 패치 또는 승인된 reference patch에서 통과한다.
3. verifier가 모델이 만든 패치와 직접 연결된다.
4. 검증 명령이 성공만이 아니라 금지된 변경/회귀도 검사한다.
5. task prompt, source, 사용자 데이터는 로그에 남기지 않고 task hash만 기록한다.

초기 파일럿은 15~20개 태스크 × 3회 paired repetition으로 방향을 확인하고,
릴리스 판단은 최소 30개 태스크 × 5회 이상을 권장한다. 최종 표본 수는 예상 효과 크기와
허용할 비열등성 마진을 기준으로 power analysis로 확정한다.

### 실행 규칙

- 모든 조건은 동일한 provider/model revision과 generation config를 사용한다.
- pair 안에서 on/off 순서는 seed 기반으로 무작위화한다.
- 각 조건은 독립 worktree/container에서 같은 snapshot으로 시작한다.
- API seed는 고정하되, seed 고정이 결정성을 보장한다고 가정하지 않는다.
- 비용 상한 때문에 한 조건만 실행된 pair는 분석에서 제외한다.
- 모델 출력 원문은 이벤트 로그에 쓰지 않되, 비공개 artifact에 patch hash와 검증 요약을 보관한다.
- 사용자 개입은 성공으로 숨기지 않고 별도 결과로 기록한다.

## 측정 지표와 판정 기준

### 품질

- primary: deterministic task success rate
- secondary: hidden regression/security checks 통과율
- paired win rate: 동일 task/repetition에서 on이 off보다 성공한 비율
- pass@1, pass@3, pass^3
- 사용자 개입 없는 성공률

초기 운영 기준은 프로젝트가 합의해야 하지만, 예시는 다음과 같다.

- 품질 비열등: `success_on - success_off`의 95% CI 하한이 -3 percentage points보다 큼
- 실질적 개선: CI 하한이 0보다 크고 평균 개선폭이 사전 정의한 최소 효과보다 큼
- 실질적 저하: CI 상한이 -3 points보다 작거나 안전성 실패가 유의하게 증가

이 수치는 절대 규칙이 아니라 사전 등록할 decision margin이다. 결과를 본 뒤 마진을
바꾸면 하네스에 유리하게 과적합될 수 있다.

### 효율

- input/output/total tokens
- tool calls와 retry count
- wall-clock latency와 provider latency 분리
- task당 비용 및 successful task당 비용
- context injection token estimate, hook 실행 시간, compaction 횟수

품질이 비열등한 경우에만 효율을 비교한다. 실패율이 다른 조건의 평균 비용만 비교하면
성공하지 못한 저비용 실행이 유리해지는 문제가 있다.

### 위험 신호

- 잘못된 파일 수정/범위 이탈
- 테스트를 우회하거나 안전 검사를 약화한 패치
- 반복 루프·timeout·강제 중단
- false-normal completion
- 사용자 개입 및 수동 복구
- 조건 간 patch contamination 또는 snapshot hash 불일치

## 구현 우선순위

### P0 — 평가 오염 차단

1. 기존 14개 golden task를 모델 성능 점수에 사용하지 않고 harness regression suite로 명시
2. 새 suite에 baseline-failing preflight와 reference-patch validation 추가
3. adapter contract에 `restoreSnapshot`, `beforeTreeHash`, `afterTreeHash`, `patchHash` 추가
4. on/off provider/model/config/tool equality 검증 추가

### P1 — 모델 어댑터와 보고서

1. 실제 고성능 모델 한 종에 대한 adapter를 구현
2. OMF on/off가 실제 런타임 설정에 반영되는지 확인
3. task별 win/tie/loss, CI, retry/human intervention 요약 추가
4. private artifact와 public event metadata를 분리

### P2 — 파일럿과 원인 분석

1. 중립·장기·failure-replay 층으로 파일럿 실행
2. 전체 OMF 결과와 context-only/hooks-only/minimal ablation 비교
3. 품질 비열등 여부와 비용/지연 tax를 함께 판정
4. 결론을 이 저장소의 연구 문서와 릴리스 평가 요약에 기록

## 최종 판단

현 시점의 정직한 판정은 **“아직 미측정(unknown), 성능 저하 증거 없음”**이다.

최근 추가된 러너는 좋은 출발점이며, 보안 측면의 node-only/shell-free 검증과 metadata
비저장 원칙도 적절하다. 하지만 현재 14개 태스크의 baseline ceiling, 어댑터에 맡겨진
격리, 조건 동일성 미검증, 통계 분석 부재 때문에 고성능 모델에 대한 품질 결론을 내리기에는
부족하다. 우선 P0를 해결한 뒤 실제 모델 파일럿을 수행해야 “OMF가 모델을 저하시키는가”에
답할 수 있다.
