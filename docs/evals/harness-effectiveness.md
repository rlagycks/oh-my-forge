# Harness Effectiveness Golden Tasks

이 디렉터리는 OMF의 기능 존재 여부가 아니라 **하네스가 실제 작업 결과를 개선하는지** 측정하기 위한 golden task를 관리한다.

## 실행 원칙

- 동일한 프로젝트 snapshot, 모델, 모델 설정, 사용자 요청으로 하네스 on/off를 비교한다.
- 각 태스크는 여러 번 실행하고 실행 순서는 무작위화한다.
- 성공 여부만 기록하지 말고 입력 토큰, 출력 토큰, 도구 호출 수, 소요 시간, 사용자 개입, 검증 결과를 함께 기록한다.
- 모델이 생성한 자유 형식 설명보다 테스트·빌드·파일 상태 같은 결정적 검증을 우선한다.
- task 원문이나 사용자 코드가 이벤트 로그에 저장되지 않도록 task id와 hash 중심으로 기록한다.

## 이벤트 연결

각 실행은 `episode_id`를 공유한다.

```text
context_injection(episode_id)
        |
        +--> task_outcome(episode_id)
```

이벤트는 `~/.claude/logs/recall-hits.jsonl`에 JSONL로 기록된다. 기존 설치와의 호환성을 위해 파일명은 유지하지만, 새 레코드는 `schema_version`과 `event_type`을 가진 구조화된 이벤트다.

작업 결과는 다음처럼 기록할 수 있다.

```bash
node scripts/record-harness-event.js \
  --type task_outcome \
  --episode episode-123 \
  --task observability-recall-backward-compatibility \
  --outcome success \
  --input-tokens 1200 \
  --output-tokens 300 \
  --tool-calls 5 \
  --tests-passed true
```

그 후 다음 명령으로 주입량과 outcome을 함께 조회한다.

```bash
node scripts/recall-report.js --json
```

The default event log can be redirected for isolated runs or CI with
`OMF_HARNESS_EVENT_LOG=/path/to/events.jsonl`. The `--log` option on both
CLIs takes precedence when supplied.

## Verification runner

P1 adds a deterministic runner for the declared verification commands. It
accepts only the `node` command, invokes it with `shell: false`, captures no
command output, records no command output in the event log, and records the
exit code, timeout, duration, and task id.

Suite JSON is trusted executable configuration: `shell: false` prevents shell
interpolation, but a trusted suite is still required because `node -e` can run
arbitrary code.

Run one task:

```bash
node scripts/run-golden-task.js \
  --task observability-recall-backward-compatibility \
  --episode episode-123 \
  --log /tmp/omf-events.jsonl \
  --json
```

Run the full suite with one distinct episode per task:

```bash
node scripts/run-golden-task.js \
  --all \
  --episode-prefix paired-run-on \
  --log /tmp/omf-events.jsonl
```

The runner appends the run timestamp to `--episode-prefix`, so reusing a
prefix across repeated runs still produces distinct episode ids.

The runner is a verification and outcome-recording layer, not a model
provider or harness on/off orchestrator. Provider adapters, cost controls,
randomized paired execution, and statistical analysis remain later work.

An episode is expected to have one final `task_outcome`. If retries or
intermediate outcomes are recorded, the report uses the latest outcome by
timestamp for episode linking and exposes the number of episodes with
duplicates as `linkedInjections.duplicateOutcomeEpisodes`.

## 현재 범위와 한계

현재는 이벤트 계약·기록·집계 기반만 제공한다. 실제 Claude/Codex 실행을 자동화하는 benchmark runner, 모델별 토큰 tokenizer, 통계적 유의성 검정, 장기 실행 환경의 로그 rotation/streaming은 후속 작업이다.

`golden-tasks.json`의 verification은 실행 가능한 argv 메타데이터이며, 신뢰할 수 없는 외부 입력을 shell 문자열로 실행해서는 안 된다.
