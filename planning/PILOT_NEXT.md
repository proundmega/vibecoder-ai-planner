# Pilot completion plan (2026-11-22)

> **Owns:** the remaining pilot sequence, dependencies and exit criteria.
> **Not here:** ticket status. Status lives in `PENDING.txt` and each suite's
> `00`; this document links to those instead of copying them.

## Baseline

The canonical queue is `PENDING.txt` → **Current focus**. At this writing,
fg-43, fg-44 (foundation #209 plus fg-58 #212), fg-45, fg-55 and fg-56 (#203)
are merged; fg-57's Git provider plan is merged (#206) with implementation
post-pilot; bt-60 Phase A, the Phase B backend drills (#207) and the master
staging rerun (`98d6f814`, PR #24) are done, and the staging rows/PRs were
cleaned up and verified on 2026-11-24 (the reset coincided with an integration-test
run against the shared `vibecode` URL and also removed the disposable GTD
staging project 2). The next pilot step is the first real
end-to-end run; there is no external credential blocker. The disposable PAT
and provider key must still be revoked (D15).

## Milestones

| # | Milestone | Work | Exit criteria |
|---|---|---|---|
| 1 | Close the paperwork ✅ (2026-11-22) | Merge #204/#205, then rebase/merge #203 (fg-56); fg-56 closeout; bulk-move done suites to `planning/DONE/` (fg-50); prune merged branches | The queue and roadmap say merged; fg-43 D7 is done via fg-56; no stale “in review” rows for merged work |
| 2 | fg-44 storage lifecycle ✅ (2026-11-23) | Implement the `04` contract: runtime-scoped workspaces, sandbox-first cleanup, idle/max lifetime, 70/80/85/90/95 watermarks, `host-storage.sh`, orphan/image reaper, storage events | The fg-44/fg-58 matrices are green (#209/#212); a terminal run leaves no workspace; cleanup and watermark events are observed |
| 3 | bt-60 Phase B staging ✅ (2026-11-24) | Disposable local project/repo/node/runtime and provider key; real OpenCode/GitHub happy path; crash/restart, lease-loss and health-gate drills | Evidence recorded in the bt-60 runbook (PRs #20-#23 plus the master rerun PR #24); staging rows/PRs cleaned up and verified 2026-11-24; the reset removed the disposable GTD staging project 2 as collateral; credential revocation is D15 |
| 4 | First real pilot run | fg-54 runbook: mint → enroll → declare → sandbox → build → question loop → PR → review → merge | One clean end-to-end run with evidence; the question is answered and resumed; readiness warnings are visible |
| 5 | Post-pilot | fg-46 observability; fg-57 Git provider implementation; optional fg-31/fg-36; fg-51/fg-52; deferred follow-ups | Choose the next autonomy tier; no orphaned workspaces; private/self-hosted Git path available |

Each milestone closes with a defect triage. Blocking findings stop the
milestone; non-blocking findings follow the intake below.

## Dependencies and blockers

- **Staging credentials:** resolved for the 2026-11-23 run and the 2026-11-24
  master rerun with a disposable local stack, `planner-test`, a disposable
  provider key and PAT local mode. A repo-scoped GitHub App installation is
  still recommended before production; the OpenCode Go session-header proxy
  (D13) remains a staging deviation.
- **Storage lifecycle:** fg-44 is merged (foundation #209, supervisor lifecycle
  #212), so unattended runs rely on the workspace sweep and watermarks. The
  role budgets are already defined by fg-43.
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

- **fg-55:** `planning/DONE/fg-55-human-question-loop/03_ARCHITECT_IMPLEMENTATION.md`
  → Results; `OpenCodeClientTest`, `api-questions.test.js`,
  `DoomLoopDetectorTest`.
- **fg-43:** `planning/DONE/fg-43-agent-docker-deployment/03_ARCHITECT_IMPLEMENTATION.md`
  → Results; `host-init.test.sh`, `SupervisorCapacityTest`, `RuntimeConfigTest`.

The fg-45 `04`/status closeout and the fg-44 spec are merged (#205/#204).

## Definition of done (pilot)

A real ticket runs in a sandbox, asks a question, gets a human answer, opens a
PR, is reviewed and merged. The run, question, review and merge evidence are
recorded; storage stays within the watermarks; the health gate and readiness
warnings are visible. No open blocker defects remain.

## Three-worker flow tests

See `THREE_WORKER_PLANS.md` for the 3-worker allocation for this repository's
backlog and the GTD backlog, the dependency edges that keep only one wave
ready, and the review/merge protocol. It references the canonical status here;
it does not replace this queue.

## Deferred (not blocking the pilot)

fg-33 D8; fg-43 D1/D6; fg-44 D3/D5–D10/D12; fg-58 D1/D2; fg-45 D2/D5/D7/D9; fg-55 D1–D10; fg-31/fg-32/
fg-36/fg-37/fg-40; fg-46–fg-52 planning/review tooling. The canonical deferred
scope stays in each suite's `00` register and `PENDING.txt`.
