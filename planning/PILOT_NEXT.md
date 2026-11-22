# Pilot completion plan (2026-11-22)

> **Owns:** the remaining pilot sequence, dependencies and exit criteria.
> **Not here:** ticket status. Status lives in `PENDING.txt` and each suite's
> `00`; this document links to those instead of copying them.

## Baseline

The canonical queue is `PENDING.txt` → **Current focus**. At this writing,
fg-43, fg-45 and fg-55 are merged; fg-56 (#203) and the fg-44/fg-45 specs
(#204/#205) are in review; bt-60 Phase A is merged and Phase B is
staging-blocked.

## Milestones

| # | Milestone | Work | Exit criteria |
|---|---|---|---|
| 1 | Close the paperwork | Merge #204/#205, then rebase/merge #203 (fg-56); fg-56 closeout; bulk-move done suites to `planning/DONE/` (fg-50); prune merged branches | The queue and roadmap say merged; fg-43 D7 points at fg-56; no stale “in review” rows for merged work |
| 2 | fg-44 storage lifecycle | Implement the `04` contract: runtime-scoped workspaces, sandbox-first cleanup, idle/max lifetime, 70/80/85/90/95 watermarks, `host-storage.sh`, orphan/image reaper, storage events | The fg-44 `03` matrix is green; a terminal run leaves no workspace; cleanup and watermark events are observed |
| 3 | bt-60 Phase B staging | Disposable project/repo/agent, provider key and GitHub App installation; real OpenCode/GitHub happy path; crash/reaper/idempotent-publish drills | Evidence recorded in the bt-60 runbook; failure drills pass; no test rows remain |
| 4 | First real pilot run | fg-54 runbook: mint → enroll → declare → sandbox → build → question loop → PR → review → merge | One clean end-to-end run with evidence; the question is answered and resumed; readiness warnings are visible |
| 5 | Post-pilot | fg-46 observability; optional fg-31/fg-36; fg-51/fg-52; deferred follow-ups | Choose the next autonomy tier; no orphaned workspaces |

Each milestone closes with a defect triage. Blocking findings stop the
milestone; non-blocking findings follow the intake below.

## Dependencies and blockers

- **Staging credentials:** a disposable repository, provider key and GitHub
  App installation are required for bt-60 Phase B. This is the main external
  blocker.
- **fg-44 must land before a long unattended run**, otherwise the host can fill
  with workspaces. The role budgets are already defined by fg-43.
- **Readiness rollout:** apply migration 061/backfill, keep
  `READINESS_GATE_MODE=warn` for the pilot, and observe the readiness panel.
- **Health gate:** the pilot host must reach `BACKEND_URL/api/health`; the
  supervisor defaults are `SUPERVISOR_HEALTH_REQUIRED=true` with a bounded
  timeout and post-start monitor.
- **Question loop:** set `HARNESS_QUESTION_LOOP=true` for the pilot and verify
  answer/timeout routing.
- **Host sizing:** run `agent/scripts/host-init.sh` for the declared fleet and
  keep the 7-runtime reference case as the baseline.

## Defect intake

Every defect found during a milestone follows the repo bug-fix protocol: add a
regression test, then fix it. A blocking defect stops the milestone; a
non-blocking finding goes to the owning suite's deferred register or the
`FUTURE_IDEAS.txt` intake. The pilot exit requires zero open blocker defects
and no known storage, health-gate or question-loop regressions.

Review defects already fixed and covered by regression tests are not open work:

- **fg-55:** `planning/fg-55-human-question-loop/03_ARCHITECT_IMPLEMENTATION.md`
  → Results; `OpenCodeClientTest`, `api-questions.test.js`,
  `DoomLoopDetectorTest`.
- **fg-43:** `planning/fg-43-agent-docker-deployment/03_ARCHITECT_IMPLEMENTATION.md`
  → Results; `host-init.test.sh`, `SupervisorCapacityTest`, `RuntimeConfigTest`.

The fg-45 `04`/status closeout and the fg-44 spec are tracked in #205/#204.

## Definition of done (pilot)

A real ticket runs in a sandbox, asks a question, gets a human answer, opens a
PR, is reviewed and merged. The run, question, review and merge evidence are
recorded; storage stays within the watermarks; the health gate and readiness
warnings are visible. No open blocker defects remain.

## Deferred (not blocking the pilot)

fg-43 D1/D6; fg-44 D3/D5–D8; fg-45 D2/D5/D7/D9; fg-55 D1–D10; fg-31/fg-32/
fg-36/fg-37/fg-40; fg-46–fg-52 planning/review tooling. The canonical deferred
scope stays in each suite's `00` register and `PENDING.txt`.
