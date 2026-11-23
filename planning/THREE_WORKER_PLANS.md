# Three-Worker Flow-Test Plans

**Date:** 2026-11-23
**Purpose:** run three worker runtimes against two real backlogs without
duplicating work or turning every PR into a conflict.

> **Owns:** the operational allocation and merge protocol for a three-worker
> fleet.
> **Not here:** ticket status (each suite's `00` and `PENDING.txt`), requirements
> or design. This document links to them and does not restate their status.

Use **one plan per fleet**. Running the planner and GTD plans at the same time
means six workers; the host can size them, but human review and `src/app.js`
conflicts make it a poor first flow test. Recommended order: Plan A, then Plan B.

## Shared fleet setup

Three named supervisor sections, one child each, so logs, models and worktrees
are distinct:

```ini
[runtime "flow-a"]
role = worker
model = gtd-staging/deepseek-v4.1-flash
count = 1
effort = medium
project = 2

[runtime "flow-b"]
role = worker
model = gtd-staging/deepseek-v4.1-flash
count = 1
effort = medium
project = 2

[runtime "flow-c"]
role = worker
model = gtd-staging/deepseek-v4.1-flash
count = 1
effort = low
project = 2
```

- One node grant per project is enough; all three runtimes share it.
- Keep the Docker sandbox: `SANDBOX_MODE=docker`, `SANDBOX_REQUIRE=true`,
  `SANDBOX_NETWORK=none`.
- Host reference: 16 CPU / 31 GB / ~400 GB free. Three workers at 2 CPU and
  2 GB sandbox plus 768 MB heap fit with headroom.
- Budget: 15-minute run cap, 8 files, 400 lines, one ticket per cycle.
- Quality gate for code tickets:

  ```bash
  HARNESS_VERIFY_COMMANDS='npm test; test -n "$(git diff --name-only -- test)"'
  ```

  The second command fails the run when the agent changed no test files. This
  is the difference between the GTD `#19` outcome (green existing suite, no new
  tests) and a reviewable PR.
- Human review is still the gate. `fg-31`/`fg-32` (reviewer and fix loop) are
  being built in Plan A lane A; until they land, a `request_changes` review
  does not automatically start a fixer.

---

# Plan A — This repository's backlog

## Preconditions

1. ~~Merge `#222`~~ (custom templates; merged as `3868562`).
2. Triage `gtd#19` (review decision): do not start overlapping feature work
   while an unreviewed branch is open.
3. Run the bt-60 formal staging rerun on merged `master` (`#220` is merged) and
   close/archive bt-60.
4. Split the large suites below into reviewable slice tickets before starting a
   worker. Suggested slices are listed in the wave table.
5. Set ticket `depends_on` edges so only the current wave is ready.

## Lanes and waves

| Lane | Worker | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|---|
| **A. Review and merge** | `flow-a` | `fg-31` Phase 1: reviewer harness, structured findings, COMMENT-only, reviewed-SHA dedupe (no fix dispatch) | `fg-32`: fix request, same-branch fixer, round counter, re-review | `fg-36`: merge lifecycle, mergeability/rebase gate, merge queue |
| **B. Git provider** | `flow-b` | `fg-57` Phase 1a: `GitProvider` contract + `GitHubService` facade + tests | `fg-57` Phase 1b/2: local/bare-SSH provider, credential store, Forgejo/Gitea connect/push/PR | `fg-57` Phase 4: generic `/api/v1/git` routes, provider picker, docs |
| **C. Repo profiles and ops** | `flow-c` | `fg-39` slice 3 / FR8: flaky-test retry policy and test-data hooks | `fg-39` slice 4: FR3 prebuilt images, FR4 persistent caches with quota/GC | bt-60 rerun/closeout, then `fg-48`/`fg-49`/`fg-50` when unblocked |

**Why these lanes:**

- `fg-31 → fg-32 → fg-36` are inherently sequential: review feeds fix dispatch,
  then merge lifecycle consumes both. Do not parallelize them.
- `fg-57` is independent of the review/merge suites at the contract and provider
  level, and its plan is merged (`#206`); it is the post-pilot provider lane.
- `fg-39` slice 3 is a bounded backend/agent feature independent of the review
  and Git-provider work. Slices 4 and the planning-tooling suite follow.
- `fg-48/49/50/51/52`, `fg-37`, `fg-47` and `fg-40` are dependency-blocked
  (`fg-48` needs `fg-31`/`fg-47`; `fg-37`/`fg-47` need `fg-32`; `fg-51`/`fg-52`
  need `fg-31`/`fg-32`/`fg-36`/`fg-48`; `fg-40` needs `fg-31`/`fg-32`/`fg-36`).
  `fg-46` is deferred until a full build → review → fix → merge cycle exists.
- `fg-34` D24–D26 are decisions/rollout follow-ups, not implementation-sized
  worker tickets; `D12` is a filesystem/quota design change. Leave them out of
  the first flow test.

## Dependency note: `fg-31` and `fg-32`

`PENDING.txt` describes a circular guard: `fg-31` references `fg-32` for fix
dispatch, while `fg-32` depends on `fg-31`. Resolve it by scope, not by waiting:

- **Wave 1 ships `fg-31` Phase 1 only:** reviewer session, structured findings,
  COMMENT-only GitHub review, phase reconciliation before approve →
  `human_approval`, and reviewed-SHA dedupe.
- **`fg-32` starts after that PR merges:** it adds the request-changes handoff,
  fixer queue, same-branch update and round cap.
- Update the guard wording when Wave 1 lands. Do not build `fg-32` first.

## Merge and review protocol

- Each worker opens at most one PR per run; pause a lane when it already has an
  unreviewed PR.
- Merge order when A and B overlap in agent code: **A (`fg-31`) first**, then
  rebase B (`fg-57`) and C if needed.
- Review one PR at a time; run the layer's tests plus the project verification
  from the PR description.
- A `request_changes` review has no automated fix loop yet. Fix manually or
  create a branch-bound fixer ticket; do not let the worker start the next lane
  ticket on a stale base.
- Stop the fleet after each wave if the PRs touch the same modules; restart
  after merges and rebases.

## Plan A flow metrics

Record per run: ticket/slice, run id, model and effort, duration, files/lines,
tests added, PR URL, review decision, merge time, rebase/conflict count,
re-runs and cost. The flow test passes when three Wave 1 PRs are open without
duplicate claims, each contains tests, the human review can route findings, and
at least one PR merges without a rebase surprise.

---

# Plan B — GTD feature backlog

This is the plan already exercised by `gtd#19`; it remains useful as a second
flow test with a small, dependency-free repository.

## Wave 1 — three independent starts

| Ticket | Worker | Overlap |
|---|---|---|
| `#6` due dates | `flow-a` | `actions.js`, `engage.js`, `app.js` |
| `#11` undo | `flow-b` | `store.js`, `app.js` |
| `#12` dark mode | `flow-c` | settings/store, `styles.css`, `app.js` |

Set dependencies so the rest stay blocked:

- `#7` ← `#6`
- `#8` ← `#6`
- `#9` ← `#6`
- `#10` ← `#5` and `#6` and `#11`

## Wave 2 — after `#6` merges

| Ticket | Worker | Depends on |
|---|---|---|
| `#7` recurring actions | `flow-a` | `#6` |
| `#8` subtasks | `flow-b` | `#6` |
| `#9` tags | `flow-c` | `#6` |

## Wave 3

| Ticket | Worker | Depends on |
|---|---|---|
| `#10` bulk complete/archive/delete | first free | `#5`, `#6`, `#11` |

Merge order: `#12` → `#11` → `#6`, then reboot for Wave 2. Rebase each PR on
`main` before review; run `npm test` again after the rebase. All three Wave 1
features touch `src/app.js`, so a merge checkpoint is required even though the
claim logic prevents duplicate tickets.

The same changed-test gate and 8-file/400-line limits from the shared setup
apply. `gtd#19` is the cautionary example: existing tests passed while the
feature had no tests and no archive control.

---

# Flow-test stop conditions

Pause the fleet and fix the flow when any of these happens:

- verification fails twice for the same ticket;
- no test files changed in a code PR;
- the diff exceeds 8 files or 400 lines;
- a worker starts a ticket whose dependency is not `done`;
- two workers claim the same ticket or a duplicate PR appears;
- a lane has more than one PR awaiting review;
- the reviewer requests changes and the next ticket starts on the stale base;
- the run exceeds the 15-minute or budget cap.

# Open decisions

1. Run Plan A and Plan B sequentially (recommended) or split the fleet as
   2 GTD + 1 planner.
2. Confirm the lane C scope: `fg-39` slice 3 first, or bt-60 closeout first.
3. Confirm the `fg-31`/`fg-32` guard correction so Phase 1 is not blocked by
   its own fix-dispatch dependency.
4. GitHub App vs PAT for later waves; the current staging uses PAT local mode
   and a disposable provider key.
5. Whether to keep `beam-free` for one low-risk lane to conserve allowance, or
   run all three on `deepseek-v4.1-flash`.
