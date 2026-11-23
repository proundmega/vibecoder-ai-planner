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

[runtime "planner-flow-b"]
role = worker
model = <planner_credential>/deepseek-v4.1-flash
count = 1
effort = medium
project = <planner_project_id>

[runtime "planner-flow-c"]
role = worker
model = <planner_credential>/deepseek-v4.1-flash
count = 1
effort = low
project = <planner_project_id>
```

- `SANDBOX_MODE=host` for the trusted planner repo; do not use host mode for
  untrusted repos.
- Create a **Planner Flow** project connected to
  `https://github.com/proundmega/vibecoder-ai-planner`, with a worker grant and
  its own project-scoped provider credential. Do **not** reuse the GTD
  project/credential.
- Plan A's verification path is a prerequisite, not a copy of the GTD gate.
  Extend the existing `scripts/verify-local.sh` with an `--agent` mode that
  installs missing dependencies, runs only the changed layers, and checks
  changed/new tests. Do not add a second full verification script. Then set
  `HARNESS_VERIFY_COMMANDS='bash scripts/verify-local.sh --agent'`.
- Alternative: Docker with `SANDBOX_NETWORK=allowlist`, an npm/Maven allowlist,
  and the same extended script. This is slower and not needed for the first
  trusted-repo flow test.

## Plan B — GTD (dependency-free, Docker)

```ini
[runtime "gtd-flow-a"]
role = worker
model = gtd-staging/deepseek-v4.1-flash
count = 1
effort = medium
project = 2

[runtime "gtd-flow-b"]
role = worker
model = gtd-staging/deepseek-v4.1-flash
count = 1
effort = medium
project = 2

[runtime "gtd-flow-c"]
role = worker
model = gtd-staging/deepseek-v4.1-flash
count = 1
effort = low
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
- **Prerequisite ticket:** add a `--agent` mode to `scripts/verify-local.sh`.
  It must install missing dependencies, run the changed layers, and fail when
  no changed/new test file exists under `backend/src/__tests__`,
  `frontend/src/__tests__` or `agent/src/test` (use
  `git status --porcelain --untracked-files=all`). Do not start Plan A until it
  exists and passes on a no-op change. Plan B is ready today.

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
2. **Operator checkpoint:** run the bt-60 formal staging rerun on merged
   `master` and close/archive bt-60. This is not a worker code ticket and is
   not repeated in a lane.
3. Create the Planner Flow project, worker grant and project-scoped credential.
4. Extend `scripts/verify-local.sh` with the `--agent` mode and prove it on a
   no-op change.
5. Create the slice tickets below with their `depends_on` edges before starting
   a worker. Do not start a lane on a whole suite.

## Slice catalog

Each row is a **worker ticket**, not a whole suite. The expected file count is
the planning estimate; split further if a run would exceed 8 files / 400 lines.

### Lane A — review and merge

| Slice | Work | Expected files | Depends on |
|---|---|---|---|
| `fg-31a` | Review migration + attempt/finding stores + tests | 5–7 | — |
| `fg-31b` | Review prompt builder + structured-findings parser + tests | 4–6 | `fg-31a` |
| `fg-31c` | Review harness client + review-ticket processor/OpenCode session + tests | 6–8 | `fg-31b` |
| `fg-31d` | GitHub review service + phase reconciler + legacy mode + tests | 6–8 | `fg-31c` |
| `fg-32a` | Request-changes record + fixer queue + same-branch fix test | 5–7 | `fg-31d` |
| `fg-32b` | Round counter, re-review, no-progress escalation + tests | 4–6 | `fg-32a` |
| `fg-36a` | Mergeability/rebase gate + stale-SHA check + tests | 5–7 | `fg-32b` |
| `fg-36b` | Merge queue/rollback + tests | 5–7 | `fg-36a` |

`fg-31` has only `00`–`02` today; these slices come from the components in
`planning/fg-31-automatic-review-harness/02_ARCHITECT_DESIGN.md`.

### Lane B — Git provider

| Slice | Work | Expected files | Depends on |
|---|---|---|---|
| `fg-57a` | Backend `GitProvider` contract + `GitHubService` facade + tests (backend-only) | 4–6 | — |
| `fg-57b` | `project_repos` provider migration/rollback + `GitProjectService` + tests | 5–7 | `fg-57a` |
| `fg-57c` | Agent `GitService` contract/facade + tests (after `fg-31a` merges) | 5–7 | `fg-57b`, `fg-31a` |
| `fg-57d` | Local/bare-SSH provider + credential store + tests | 6–8 | `fg-57c` |
| `fg-57e` | Forgejo/Gitea connect/push/PR + disposable integration test | 6–8 | `fg-57d` |
| `fg-57f` | Generic `/api/v1/git` routes, provider picker, docs | 6–8 | `fg-57e` |

These are an operational split of `fg-57` Phase 1/2/4; see
`planning/fg-57-git-provider-abstraction/03_ARCHITECT_IMPLEMENTATION.md`.

### Lane C — repo profiles

| Slice | Work | Expected files | Depends on |
|---|---|---|---|
| `fg-39a` | FR8/slice 3 flaky-test retry policy + test-data hooks + tests | 4–6 | — |
| `fg-39b` | FR3/slice 4a prebuilt per-stack images + pinned toolchains + tests | 6–8 | `fg-39a` |
| `fg-39c` | FR4/slice 4b persistent cache quota/watchdog/GC + tests | 6–8 | `fg-39b` |

Lane C is deliberately only `fg-39`. `fg-48`/`fg-49`/`fg-50` remain blocked by
`fg-31`/`fg-47` and are not part of this flow test.

## Waves

| Wave | Lane A | Lane B | Lane C |
|---|---|---|---|
| 1 | `fg-31a` | `fg-57a` | `fg-39a` |
| 2 | `fg-31b` | `fg-57b` | `fg-39b` |
| 3 | `fg-31c` | `fg-57c` (after `fg-31a` merges) | `fg-39c` |
| 4 | `fg-31d` | `fg-57d` | — |
| 5 | `fg-32a` | `fg-57e` | — |
| 6 | `fg-32b` | `fg-57f` | — |
| 7 | `fg-36a` | — | — |
| 8 | `fg-36b` | — | — |

Wave 1 is the flow test: three ticket-sized PRs. Wave 2 proceeds only after the
Wave 1 slice merges in that lane. Set the `depends_on` edges in the planner
project before each wave; the current project has no dependencies.

The full dependency map and blocked suites are in `PENDING.txt`; the blocked
set includes `fg-37`, `fg-40`, `fg-46`, `fg-47` and `fg-48`–`fg-52`.

## Dependency note: `fg-31` and `fg-32`

`PENDING.txt` describes a circular guard: `fg-31` references `fg-32` for fix
dispatch, while `fg-32` depends on `fg-31`. Resolve it by scope:

- **Wave 1 ships `fg-31a` only:** review migration, attempt/finding stores and
  tests. Then `fg-31b` (prompt/parser), `fg-31c` (client/processor) and
  `fg-31d` (GitHub review/phase reconciler) follow.
- **`fg-32a` starts after `fg-31d` merges:** request-changes handoff, fixer
  queue, same-branch update, round cap.
- Update the guard wording when `fg-31d` lands.

## Merge and review protocol

- One PR per worker per run; pause a lane when it has an unreviewed PR.
- Merge order when A and B overlap in agent code: **A (`fg-31a`/`fg-31c`)
  first**, then rebase B and C. `fg-57a` is backend-only in Wave 1 to keep that
  overlap out of the first wave; `fg-57c` may slip a wave if A's agent slice
  lands later.
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

These edges are not set in project 2 yet. Set them before Wave 2; until then,
only Wave 1 is claimable.

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

1. Run Plan B first (ready today) and Plan A after the `scripts/verify-local.sh
   --agent` mode exists, or bootstrap Plan A immediately.
2. Confirm Plan A host mode for the trusted planner repo versus Docker with an
   npm/Maven allowlist.
3. Confirm the Plan A lane C scope: `fg-39` slice 3 first. bt-60 is an operator
   checkpoint, not a worker ticket.
4. Confirm the `fg-31`/`fg-32` guard correction so Phase 1 is not blocked by
   its own fix-dispatch dependency.
5. GitHub App vs PAT for later waves; the current staging uses PAT local mode
   and a disposable provider key.
