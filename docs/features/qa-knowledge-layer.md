# QA Knowledge Layer

> Domain: `domain_qa`
> Load policy: **on-demand** — not always in context
> Load triggers: `/qa-loop`, `e2e-rca` skill, `qa-context-inject` hook (file match)

## 목적

QA 지식 계층은 모든 워크플로에 걸쳐 공유되는 메모리 시스템이다. 페르소나 정의, 버그 히스토리, RCA 레코드를 저장하며, 알려진 이슈가 있는 컴포넌트를 편집할 때 `qa-context-inject` 훅이 자동으로 관련 버그 컨텍스트를 주입한다. 같은 버그가 반복 발생하는 것을 방지하는 것이 핵심 목표다.

## 진입점

- `commands/qa-loop.md` — `/qa-loop` 슬래시 커맨드 정의 (e2e-rca 워크플로 진입)
- `scripts/hooks/qa-context-inject.js` — PreToolUse 훅. 편집 파일이 bug-topology 맵에 있으면 컨텍스트 주입
- `docs/qa/bug-topology.md` — 파일→버그 매핑 JSON 맵 (qa-context-inject가 읽음)
- `docs/qa/personas.md` — 페르소나 역할×상태 매트릭스
- `docs/qa/rca-history/` — 각 `/qa-loop` 실행의 Phase 5 보고서 아카이브

## 핵심 제약

- `qa-context-inject`는 반드시 `exit 0` — 버그 히스토리 조회 실패가 편집을 막으면 안 됨
- 훅 출력은 반드시 `{ hookSpecificOutput: { additionalContext } }` JSON 형식
- `docs/qa/bug-topology.md` 수동 편집 금지 — `/qa-loop` 이후 개발자 승인 후에만 업데이트
- RCA 보고서는 `docs/qa/rca-history/YYYY-MM-DD-[project].md` 명명 규칙 준수

## 관련 도메인

- `domain_hooks` — `qa-context-inject.js`는 훅 시스템의 PreToolUse 훅으로 등록
- `domain_session` — 세션 시작 시 bug-topology 맵을 미리 로드하지 않음 (on-demand)
- `domain_codex` — Codex에 버그 수정 위임 시 domain_qa 스펙을 BRIEF에 포함

---

The QA knowledge layer is a shared memory system across all workflows. It stores persona definitions, bug history, and RCA records that any agent can read when working on components with known issues.

---

## Architecture

```
/qa-loop (runs 2-3x/month)
    │
    ├── Phase 0.5: Discover personas → writes docs/qa/personas.md
    ├── Phase 3.5: Fault isolation → classifies FRONTEND/BACKEND/CONTRACT
    ├── Phase 5: Final report → developer reviews
    │
    └── [After developer approves fixes]
         └── Update docs/qa/bug-topology.md
             └── qa-context-inject hook activates for future edits
```

```
[Any workflow editing source files]
    │
    └── PreToolUse:Edit fires qa-context-inject.js
         ├── Reads docs/qa/bug-topology.md (JSON map)
         ├── If file has bug history → injects context via stderr
         └── Always exits 0 — never blocks
```

---

## Files

### `docs/qa/personas.md`

Living registry of discovered personas. Rebuilt by Phase 0.5 of `e2e-rca` each run.
Contains the Role × State matrix and auth fixture locations.

### `docs/qa/bug-topology.md`

Maps source files to bug IDs. Two sections:
- **Active bugs** — unresolved, found in last QA run
- **Resolved bugs** — history with fix commit
- **File → Bug map** — JSON block consumed by `qa-context-inject.js`
- **Pattern clusters** — recurring root causes across multiple bugs

### `docs/qa/rca-history/`

One file per `/qa-loop` run. Full Phase 5 report preserved here.
Naming: `YYYY-MM-DD-[project].md`

### `scripts/hooks/qa-context-inject.js`

PreToolUse hook (Write|Edit|MultiEdit). On-demand context injection.

**How it works:**
1. Reads `tool_input.file_path` from stdin JSON
2. Loads `docs/qa/bug-topology.md` and parses the JSON file→bug map
3. If the edited file has known bugs → writes a warning to stderr
4. Always exits 0, always passes through the input unchanged

**Token cost:** ~0 when no match. ~200-400 tokens when match found (bug summary injected as context). Not loaded unless a file in the bug map is edited.

### `tests/fixtures/api-capture.ts`

Playwright fixture for API traffic capture during tests. Used in Phase 3.5 for fault isolation. Logs all `/api/*` requests/responses to `playwright-test-results/api-log-[timestamp].json`.

---

## Cross-Workflow Intelligence

The QA knowledge layer is readable by other agents — but only when relevant:

### code-reviewer

When reviewing files that appear in `bug-topology.md`, the code-reviewer should:
1. Check if the fix correctly addresses the root cause (not just the symptom)
2. Verify scope — did the fix address all instances found in Phase 4d?
3. Confirm the bug pattern cluster hasn't reappeared elsewhere

To trigger: reference `domain_qa` spec when reviewing files with QA history.

### security-reviewer

Contract mismatch bugs (FRONTEND/BACKEND ownership unclear) often indicate auth boundary issues. When `bug-topology.md` has AUTH-category bugs in the file being reviewed, load `domain_qa` spec for context.

### codex-delegate

After developer approves fixes from the report, delegate bounded tasks to Codex with:
- The specific finding (ID, file, line, root cause)
- The recommended fix from Phase 5
- The scope check result (how many files to touch)

Codex reads `domain_qa` spec to understand the full context.

---

## Ontology Integration

Entry in `.claude/ontology/index.json`:

```json
"domain_qa": {
  "files": [...],
  "spec": "docs/features/qa-knowledge-layer.md",
  "owner": "qa",
  "loadPolicy": "on-demand",
  "loadTriggers": ["/qa-loop", "e2e-rca skill", "file matches bug-topology entries"]
}
```

`loadPolicy: on-demand` means this domain is NOT injected in every session.
It only surfaces when:
- `/qa-loop` is invoked (e2e-rca skill reads it explicitly)
- `qa-context-inject` hook fires because a file in the bug map is being edited

---

## Maintenance

### After each /qa-loop run

1. Save the Phase 5 report to `docs/qa/rca-history/YYYY-MM-DD-[project].md`
2. For each confirmed bug (developer approved), add a row to `docs/qa/bug-topology.md`
3. Update the File → Bug JSON map in `bug-topology.md`
4. For resolved bugs, move them from Active to Resolved section with fix commit

### When to regenerate personas.md

- When new roles are added to the application
- When auth flow changes significantly
- Automatically on each `/qa-loop` run (Phase 0.5 rewrites it)

### When to trim rca-history/

Keep the last 6 months. Archive older files to `docs/qa/rca-history/archive/` if needed.
The hook only reads `bug-topology.md` — not history files — so trimming is safe.

---

## Token Budget

| Event | Tokens consumed | Frequency |
|-------|----------------|-----------|
| /qa-loop run (full e2e-rca) | ~4,200 | 2-3×/month |
| qa-context-inject hit (file match) | ~200-400 | Per edit of buggy file |
| qa-context-inject miss (no match) | ~0 | All other edits |
| code-reviewer reading domain_qa spec | ~800 | When reviewing QA-flagged files |
| index.json overhead (domain_qa entry) | +85 tokens | Every session |

The 85-token overhead in `index.json` is the only always-on cost.
All other loading is triggered by actual usage.
