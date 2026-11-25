# Completed Planning Suites

## bp-53: Distributed State Management
- **PR**: https://github.com/proundmega/vibecoder-ai-planner/pull/38
- **Branch**: fix/bp-53-distributed-state
- **Date**: 2026-07-06
- **Description**: Replaced all in-memory Map-based state stores with Redis-backed implementations

## bp-120: Agent Connectivity Fixes
- **PR**: #97
- **Date**: 2026-09-11
- **Description**: Fixed the double-wrapped provider config, agent heartbeat listing, and Java defensive parsing.

## bp-121: Agent Connectivity IP / CORS
- **PR**: #97 (1b1b793)
- **Date**: 2026-09-11
- **Description**: CORS/IP whitelist support for non-localhost agents.

## bp-123: Test Audit Corrections
- **PR**: #100
- **Date**: 2026-11-01
- **Description**: Test/quality audit corrections (assignee validation, lockout headers, field mapping, critical priority).

## fg-13: FE/BE API Surface Inconsistencies
- **PR**: #82
- **Date**: 2026-08-06
- **Description**: Mounted missing routers, fixed auth guards, planning usage URLs, generated client, terminal WS proxy.

## fg-14: API Surface Hardening
- **PR**: #94
- **Date**: 2026-08-17
- **Description**: Query/path/header/response validation wired into routes.

## bp-124: Audit Open Defects
- **PR**: #116-#121 (stacked)
- **Date**: 2026-11-06
- **Description**: Addressed the open audit defects O1-O10 (O10 documented as structural-only) and completed the DONE hygiene pass (FR11).

## bp-133: bp-124 Deferred Follow-ups
- **PR**: #123, #124
- **Date**: 2026-11-06
- **Description**: Regenerated the frontend client and corrected the User/project-assignee contracts, removed remaining BIGSERIAL-as-UUID docs, filtered soft-deleted users from both admin lists, and scoped ticket writes to project membership.

## bp-135: CI Docker Resource Cleanup
- **PR**: #142
- **Date**: 2026-11-14
- **Description**: Scoped CI Docker cleanup: build-scoped teardown before `cleanWs()`, CI labels/build tags, a scheduled positively labelled and age-scoped GC with dry-run defaults, and a one-time manual legacy cleanup.

## fg-35: GitHub App Credentials and Least Privilege
- **PR**: #143
- **Merge**: `871271f`
- **Date**: 2026-11-14
- **Description**: Replaced long-lived PATs with repo-scoped GitHub App installation tokens: per-project installation mapping, mint/cache/revoke service, token endpoint, agent refresh/retry, scoped fallback and deployment wiring.

## bp-134: Ticket Dependency Gates
- **PR**: #137
- **Date**: 2026-11-11
- **Description**: Enforced `tickets.depends_on` at pickup, status transitions and durable starts; fail closed on missing/deleted/self/cross-project dependencies; exposed readiness and kept blocked tickets out of the agent backlog.

## fg-33: Durable Harness Execution
- **PR**: #110
- **Date**: 2026-11-03
- **Description**: Durable runs, checkpoints and leases, scheduled reaping, startup recovery, publish evidence, operator dead-letter/adoption and workspace retention.

## fg-43: Agent Docker Deployment and Host Sizing
- **PR**: #197
- **Date**: 2026-11-22
- **Description**: One supervisor per host with host sizing/check output, supervisor container limits and the `host-init.sh` deployment path; per-child cgroups remain D6.

## fg-45: Ticket Quality Gates and Definition of Ready
- **PR**: #199
- **Date**: 2026-11-22
- **Description**: Readiness gates, acceptance criteria, assumptions/change-impact and risk sections, service-owned planning completion, scoped overrides and the `READINESS_GATE_MODE` rollout.

## fg-55: Human Question Loop and Notifications
- **PR**: #195
- **Date**: 2026-11-22
- **Description**: Opt-in `question` tool, ticket questions, human answer/resume, doom-loop escalation, notification bell/inbox and run outcome notifications.

## fg-56: Supervisor Backend Health Gate
- **PR**: #203
- **Merge**: `6c9f6fd`
- **Date**: 2026-11-22
- **Description**: `/api/health` startup gate before enrollment/declaration/child spawn, bounded timeout/offline opt-out, and post-start health monitoring that pauses declaration/reconcile while unhealthy.

## fg-44: Agent Storage Lifecycle and Idle Refresh
- **PR**: #209 (foundation), #212 (supervisor lifecycle via fg-58)
- **Merge**: `85944c9`, `04081bf`
- **Date**: 2026-11-23
- **Description**: Runtime-scoped workspaces, keyed cleanup, idle/max refresh, disk and inode watermarks, periodic sweep/quarantine, storage budget events and `host-storage.sh` recovery.

## fg-58: Supervisor Storage Lifecycle and Events
- **PR**: #212
- **Merge**: `04081bf`
- **Date**: 2026-11-23
- **Description**: Supervisor idle/max refresh, inode watermarks, periodic runtime/legacy/temp sweep into `/repos/orphans/`, weekly dangling-image prune, periodic budget and complete `storage.*` events.

## bt-60: Durable Harness End-to-End Tests
- **PR**: #198 (Phase A), #207 (Phase B backend drills); staging rerun: `proundmega/planner-test` #24
- **Date**: 2026-11-24
- **Description**: Full durable-harness e2e: real backend HTTP/Postgres, agent contract/processor drills, disposable staging happy path and crash/restart, lease-loss and health-gate drills. Run `98d6f814` on merged `master` opened PR #24 with the full checkpoint sequence and no lease. The staging rows and PRs #20-#24 were cleaned up and verified on 2026-11-24; the reset coincided with an integration-test run against the shared `vibecode` URL and also removed the GTD staging project 2 (outside bt-60). Finish/key-expiry, CI e2e, the OpenCode Go session-header/checkpoint-step findings and credential revocation (D15) remain deferred.

## fg-39: Repository Onboarding and Environment Profiles
- **PR**: #161, #167, #225, #232, #237
- **Merge**: `607ebf1`
- **Date**: 2026-11-25
- **Description**: Versioned repo profiles with stack detection, pinned images, service containers, flaky-test retries/test-data hooks, prebuilt per-stack images and persistent per-project dependency caches with quota/GC, lockfile-keyed generations and credential-scrubbing reuse.
