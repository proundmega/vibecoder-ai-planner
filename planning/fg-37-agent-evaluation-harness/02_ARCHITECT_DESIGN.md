# 02_ARCHITECT_DESIGN.md - Agent Evaluation Harness (fg-37)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31, fg-32

## Design summary

An evaluation runner that treats the harness as a black box: give it a task manifest, run it against a pinned repo/commit in a sandbox, grade the result, and store metrics.

```
eval-corpus/
  001-fix-null-update/
    task.json
    repo.lock
    expected/
  ...
        |
        v
EvaluationRunner -> SandboxRunner -> Harness (OpenCode) -> artifacts
        |
        v
Grader (tests + diff constraints) -> metrics store -> report/dashboard
```

## Task manifest

```json
{
  "id": "001-fix-null-update",
  "repo": "https://github.com/example/repo.git",
  "base_sha": "abc123",
  "ticket": {
    "title": "Fix null update",
    "description": "..."
  },
  "setup": ["npm ci"],
  "verify": ["npm test -- --run"],
  "expected": {
    "tests_added": 1,
    "forbidden_paths": [".github/workflows/**"],
    "required_files": ["backend/src/services/TicketService.js"],
    "max_files": 10
  },
  "timeout_minutes": 30
}
```

The base SHA pins the repo; setup/verify commands are trusted admin config, not model output.

## Grading

1. **Hard checks:** verification commands exit 0; required files changed; forbidden paths untouched; diff caps.
2. **Test integrity:** compare test files against expected additions or run an independent hidden test suite; reject deleting/skipping tests to pass.
3. **Behavior checks:** optional task-specific assertions (e.g. a script that exercises the API).
4. **Secondary LLM judge:** only for style/maintainability, clearly separated from pass/fail.
5. **Reviewer calibration:** run fg-31 on a labeled sample; compare verdict/findings with human labels.

## Metrics

| Metric | Definition |
|---|---|
| `pass_rate` | tasks with all hard checks passing / total |
| `verify_pass_rate` | verification command success |
| `avg_cost` | mean provider cost per task |
| `avg_tokens` | mean input+output tokens |
| `avg_duration` | wall-clock per task |
| `review_rounds` | reviewer request-changes count |
| `human_accept_rate` | merged without rework / reviewed |
| `test_integrity_failures` | tasks that modified/deleted tests improperly |
| `security_block_rate` | adversarial tasks blocked / total |

## A/B comparison

- Same corpus, two configurations, same pinned SHAs.
- Report per-task outcome deltas, aggregate pass rate, cost and time.
- Require a minimum sample size; avoid declaring a winner on a handful of tasks.
- Store the config hash (model, prompt version, permissions, verification commands).

## CI integration

- Nightly full corpus.
- PR gate for changes to `agent/src/main/java/com/vibecode/agent/harness/**`, prompts, OpenCode config, model routing and verification detection.
- Fast subset (5-10 tasks) on PRs; full corpus nightly.
- Fail if pass rate drops > threshold or cost rises > threshold.

## Storage

```sql
CREATE TABLE eval_runs (
  id UUID PRIMARY KEY,
  config_hash TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  pass_rate NUMERIC,
  avg_cost NUMERIC,
  avg_tokens INT,
  metadata JSONB
);

CREATE TABLE eval_tasks (
  id UUID PRIMARY KEY,
  run_id UUID REFERENCES eval_runs(id),
  task_id TEXT NOT NULL,
  passed BOOLEAN,
  cost NUMERIC,
  tokens INT,
  duration_ms INT,
  diff JSONB,
  logs_path TEXT
);
```

## Security and adversarial cases

- Prompt injection in README/AGENTS.md.
- Attempt to read `.env` / secrets.
- Attempt to edit `.github/workflows`.
- Malicious test that exfiltrates or deletes files.
- Attempt to push/commit/merge directly.
- Attempt to pass by deleting tests.
- Huge diff / many files.

These tasks pass only if the guard blocks or contains the behavior, not if the model "behaves".

## Rollout

1. Build 10-20 internal tasks from real tickets (including bp-122).
2. Add the runner and report.
3. Run manually; establish a baseline.
4. Add nightly runs.
5. Add PR gates.
6. Add reviewer calibration and adversarial suite.

## Open questions

1. Which repos/tasks represent our real workload?
2. Do we maintain hidden tests per task?
3. How many tasks are enough for a reliable signal?
4. What regression thresholds block a PR?
5. Do we allow LLM judging at all, and how do we audit it?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-38 | Budget-aware eval runs | Billing | `fg-38-harness-budgets-routing` | No |
| 2 | fg-34 | Sandboxed eval repos | Security | `fg-34-harness-sandbox` | No |
| 3 | fg-41 | Eval dashboards | Observability | `fg-41-harness-observability` | No |
| 4 | fg-31 | Reviewer calibration | Review | `fg-31` follow-up | No |
