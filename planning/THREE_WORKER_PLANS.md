# Three-Worker Flow-Test Plans

**Date:** 2026-11-23
**Status snapshot:** this document records the allocation as of 2026-11-23.
Canonical ticket status remains in each suite's `00` and `PENDING.txt`; re-check
them before starting a wave.

**Purpose:** run three worker runtimes against two real backlogs without
duplicating work or turning every PR into a conflict.

> **Owns:** the operational allocation, verification gates and merge protocol
> for a three-worker fleet.
> **Not here:** ticket status, requirements or design. This document links to
> the suites and indexes instead of copying their status.

Use **one plan per fleet**. Running the planner and GTD plans at the same time
means six workers; the host can size them, but human review and `src/app.js`
conflicts make it a poor first flow test. Recommended order: Plan B first
(ready today), then Plan A once its verification bootstrap exists.

## Naming

- **Plan A** is this repository (`proundmega/vibecoder-ai-planner`). The harness
  code, planning checks and Git-provider work live here.
- **Plan B** is the GTD planner (`proundmega/gtd`).
- The canonical GTD backlog is **proundmega/gtd issues #20–#27** (created
  2026-11-23 from the feature scout).
- `GTD-T5` … `GTD-T12` below are **disposable planner test tickets** in the GTD
  project, created from those issues to exercise the flow. They are not the GTD
  repository's backlog. Recreate them from the issues when resetting the test
  environment.
- The GTD repository's PRs `#5`–`#12` are from the earlier 18-PR build and are
  unrelated to these issue/ticket numbers.
- The only GTD GitHub PR from this pilot is **#19** (archive/restore, issue #20).

---

# Shared fleet shape

Three named supervisor sections, one child each, so logs, worktrees and models
are distinct.

## Plan A — this repository (trusted repo, host mode)

Plan A needs Node, npm, Maven and JDK to install dependencies and run the
backend/frontend/agent tests. `SANDBOX_NETWORK=none` cannot install them, and
setting `HARNESS_VERIFY_COMMANDS` disables the harness's install autodetection.
For the trusted planner repository, use host mode for the first flow test:

```ini
[runtime "planner-flow-a"]
role = worker
model = <planner_credential>/deepseek-v4.1-flash
count = 1
effort = medium
project = <planner_project_id>
```

- `SANDBOX_MODE=host` for the trusted planner repo; do not use host mode for
  untrusted repos.
- Create a **Planner Flow** project connected to
  `https://github.com/proundmega/vibecoder-ai-planner`, with a worker grant and
  its own project-scoped provider credential. Do **not** reuse the GTD
  project/credential.
- `HARNESS_VERIFY_COMMANDS='bash scripts/agent-verify.sh'` once that script
  exists. The script installs dependencies and runs the changed layers; it does
  not exist yet and is a prerequisite for Plan A.
- Alternative: Docker with `SANDBOX_NETWORK=allowlist`, an npm/Maven allowlist,
  and the same script. This is slower and not needed for the first trusted-repo
  flow test.

## Plan B — GTD (dependency-free, Docker)

```ini
[runtime "gtd-flow"]
role = worker
model = gtd-staging/deepseek-v4.1-flash
count = 1
effort = medium
project = 2
```

- `SANDBOX_MODE=docker`, `SANDBOX_REQUIRE=true`, `SANDBOX_NETWORK=none`.
- `gtd-staging` is project-scoped to the GTD project (2). The model alias may be
  shared with Plan A only if the provider credential is global; the project
  cannot be shared.
- GTD has a root `package.json`, a root `test/` directory and no dependencies,
  so `npm test` works without an install.

## Verification gates (per plan, not shared)

**Plan A** — the GTD command is invalid here:

- There is no root `package.json`.
- Tests live in `backend/src/__tests__`, `frontend/src/__tests__` and
  `agent/src/test`.
- A new test file is untracked (the agent does not commit; the supervisor
  stages after verification), so `git diff` misses it. Use
  `git status --porcelain --untracked-files=all -- <paths>` or
  `git ls-files --others --exclude-standard`.
- Explicit `HARNESS_VERIFY_COMMANDS` disables the harness install autodetection,
  and `SANDBOX_NETWORK=none` blocks installs.
- **Prerequisite:** add and test `scripts/agent-verify.sh` before Wave 1. It
  should install missing dependencies, run the changed layers, and fail when no
  changed/new test file exists. Do not start Plan A until it exists and passes
  locally. Plan B is ready today.

**Plan B** — valid because the repo is dependency-free:

```bash
HARNESS_VERIFY_COMMANDS='npm test; test -n "$(git status --porcelain --untracked-files=all -- test)"'
```

This includes newly added test files. `git diff -- test` alone would not.

## Limits

- 15-minute run cap, 8 files, 400 lines, one ticket per cycle.
- Three workers at 2 CPU / 2 GB sandbox + 768 MB heap fit the 16 CPU / 31 GB
  host with headroom.
- Human review is the gate. `fg-31`/`fg-32` (reviewer and fix loop) are being
  built in Plan A lane A; until they land, `request_changes` does not
  automatically start a fixer.

---

# Plan A — This repository's backlog

## Preconditions

1. ~~Merge `#222` (custom templates).~~ Merged as `3868562`.
2. Triage `GTD-T5` / GTD PR #19 before starting overlapping GTD work.
3. Run the bt-60 formal staging rerun on merged `master` and close/archive
   bt-60.
4. Create the Planner Flow project, worker grant and project-scoped credential.
5. Add `scripts/agent-verify.sh` and prove it on a no-op change.
6. Split the large suites below into reviewable slice tickets before starting a
   worker.

## Lanes and waves

| Lane | Worker | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|---|
| **A. Review and merge** | `planner-flow-a` | `fg-31` Phase 1: reviewer harness, structured findings, COMMENT-only, reviewed-SHA dedupe (no fix dispatch) | `fg-32`: fix request, same-branch fixer, round counter, re-review | `fg-36`: merge lifecycle, mergeability/rebase gate, merge queue |
| **B. Git provider** | `planner-flow-b` | `fg-57` Phase 1 split (contract + `GitHubService` facade + tests) | local/bare-SSH provider, credential store, Forgejo/Gitea connect/push/PR | generic `/api/v1/git` routes, provider picker, docs |
| **C. Repo profiles and ops** | `planner-flow-c` | `fg-39` slice 3 / FR8: flaky-test retry policy and test-data hooks | `fg-39` slice 4: FR3 prebuilt images, FR4 persistent caches with quota/GC | bt-60 rerun/closeout, then `fg-48`/`fg-49`/`fg-50` when unblocked |

**Why these lanes:** `fg-31 → fg-32 → fg-36` are sequential; `fg-57` is the
post-pilot provider lane; `fg-39` slice 3 is a bounded backend/agent feature.
The full dependency map lives in `PENDING.txt`. The currently blocked suites
for this wave include `fg-37`, `fg-40`, `fg-46`, `fg-47` and `fg-48`–`fg-52`;
do not schedule them from this document.

`fg-57` slices are an operational split of the suite's own Phase 1/2/4; see
`planning/fg-57-git-provider-abstraction/03_ARCHITECT_IMPLEMENTATION.md`.

## Dependency note: `fg-31` and `fg-32`

`PENDING.txt` describes a circular guard: `fg-31` references `fg-32` for fix
dispatch, while `fg-32` depends on `fg-31`. Resolve it by scope:

- **Wave 1 ships `fg-31` Phase 1 only:** reviewer session, structured findings,
  COMMENT-only GitHub review, phase reconciliation before approve →
  `human_approval`, reviewed-SHA dedupe.
- **`fg-32` starts after that PR merges:** request-changes handoff, fixer queue,
  same-branch update, round cap.
- Update the guard wording when Wave 1 lands.

## Merge and review protocol

- One PR per worker per run; pause a lane when it has an unreviewed PR.
- Merge order when A and B overlap in agent code: **A (`fg-31`) first**, then
  rebase B and C.
- Review one PR at a time; run the layer's tests plus the verification in the PR.
- A `request_changes` review has no automated fix loop yet. Fix manually or
  create a branch-bound fixer ticket; do not start the next lane ticket on a
  stale base.
- Stop the fleet after each wave if the PRs touch the same modules; restart
  after merges and rebases.

## Plan A flow metrics

Record per run: ticket/slice, run id, model/effort, duration, files/lines, tests
added, PR, review decision, merge time, rebase/conflict count, re-runs and cost.
The flow test passes when three Wave 1 PRs are open without duplicate claims,
each contains tests, review findings can be routed, and at least one PR merges
without a rebase surprise.

---

# Plan B — GTD feature backlog

## Current state and canonical mapping

- Canonical backlog: **[gtd#20](https://github.com/proundmega/gtd/issues/20) …
  [gtd#27](https://github.com/proundmega/gtd/issues/27)**.
- `GTD-T5` archive/restore: **PR #19 open**, no new tests; triage before Wave 1.
- `GTD-T6` … `GTD-T12`: disposable planner test tickets, not started.
- The GTD repo is dependency-free; the Docker/no-network gate above is valid.

| Canonical issue | Planner test ticket | Feature |
|---|---|---|
| [gtd#20](https://github.com/proundmega/gtd/issues/20) | `GTD-T5` | Archive completed actions and restore them (PR #19 open) |
| [gtd#21](https://github.com/proundmega/gtd/issues/21) | `GTD-T6` | Optional due dates on next actions |
| [gtd#22](https://github.com/proundmega/gtd/issues/22) | `GTD-T7` | Recurring next actions |
| [gtd#23](https://github.com/proundmega/gtd/issues/23) | `GTD-T8` | Subtasks and checklists for actions |
| [gtd#24](https://github.com/proundmega/gtd/issues/24) | `GTD-T9` | Tags for actions and search |
| [gtd#25](https://github.com/proundmega/gtd/issues/25) | `GTD-T10` | Bulk complete, archive and delete actions |
| [gtd#26](https://github.com/proundmega/gtd/issues/26) | `GTD-T11` | Undo for the last destructive planner change |
| [gtd#27](https://github.com/proundmega/gtd/issues/27) | `GTD-T12` | Dark mode toggle |

## Wave 1 — three independent starts

| Ticket | Worker | Scope |
|---|---|---|
| `GTD-T6` due dates | `gtd-flow-a` | `actions.js`, `engage.js`, `app.js` |
| `GTD-T11` undo | `gtd-flow-b` | `store.js`, `app.js` |
| `GTD-T12` dark mode | `gtd-flow-c` | settings/store, `styles.css`, `app.js` |

Set dependencies so the rest stay blocked:

- `GTD-T7` ← `GTD-T6`
- `GTD-T8` ← `GTD-T6`
- `GTD-T9` ← `GTD-T6`
- `GTD-T10` ← `GTD-T5` and `GTD-T6` and `GTD-T11`

## Wave 2 — after `GTD-T6` merges

| Ticket | Worker | Depends on |
|---|---|---|
| `GTD-T7` recurring actions | `gtd-flow-a` | `GTD-T6` |
| `GTD-T8` subtasks | `gtd-flow-b` | `GTD-T6` |
| `GTD-T9` tags | `gtd-flow-c` | `GTD-T6` |

## Wave 3

| Ticket | Worker | Depends on |
|---|---|---|
| `GTD-T10` bulk complete/archive/delete | first free | `GTD-T5`, `GTD-T6`, `GTD-T11` |

Merge order: `GTD-T12` → `GTD-T11` → `GTD-T6`, then reboot for Wave 2. Rebase
each PR on `main` before review; run `npm test` again after the rebase. All three
Wave 1 features touch `src/app.js`, so a merge checkpoint is required even
though the claim logic prevents duplicate tickets.

`GTD-T5` / PR #19 is the cautionary example: the existing suite passed while
the feature added no new tests; its acceptance review is still open.

---

# Flow-test stop conditions

Pause the fleet and fix the flow when any of these happens:

- verification fails twice for the same ticket;
- no changed/new test file in a code PR;
- the diff exceeds 8 files or 400 lines;
- a worker starts a ticket whose dependency is not `done`;
- two workers claim the same ticket or a duplicate PR appears;
- a lane has more than one PR awaiting review;
- the reviewer requests changes and the next ticket starts on the stale base;
- the run exceeds the 15-minute or budget cap.

# Open decisions

1. Run Plan B first (ready today) and Plan A after `scripts/agent-verify.sh`
   exists, or bootstrap Plan A immediately.
2. Confirm Plan A host mode for the trusted planner repo versus Docker with an
   npm/Maven allowlist.
3. Confirm the Plan A lane C scope: `fg-39` slice 3 first, or bt-60 closeout
   first.
4. Confirm the `fg-31`/`fg-32` guard correction so Phase 1 is not blocked by
   its own fix-dispatch dependency.
5. GitHub App vs PAT for later waves; the current staging uses PAT local mode
   and a disposable provider key.
