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
