---
id: "fg-58"
title: "Supervisor Storage Lifecycle and Events"
status: planned
priority: "P1"
effort: "Large"
scope: "Agent"
created: "2026-11-22"
updated: "2026-11-22"
pr: null
branch: null
depends_on: ["fg-44", "fg-43", "fg-54"]
---

# 00 — Supervisor Storage Lifecycle and Events (fg-58)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`),
> file operations (`04`).

**Related code:** `agent/src/main/java/com/vibecode/agent/supervisor/Supervisor.java`,
`StoragePolicy.java`, `WorkspaceManager.java`, `HarnessTicketProcessor.java`,
`agent/scripts/host-storage.sh`.

This is the follow-up split from fg-44. PR #209 delivered the workspace and
recovery foundation (runtime/ticket layout, keyed cleanup, budget helper,
policy, host-init/Compose env, `host-storage.sh`). The supervisor lifecycle and
event path remain here.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Split recorded | fg-44 03/00; this suite | ☑ |
| Implementation merged | pending | ☐ |
| Verification results | `03` → Results | ☐ |

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Live Docker image/log inventory beyond dangling prune | self | Operations | later | open |
| D2 | Cross-host workspace migration | fg-40 | Infrastructure | fg-40 | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Watermark owner | supervisor / host cron | Supervisor; host script stays recovery-only | Assumed |
| 2 | Quarantine location | `/repos/orphans/` / delete | Quarantine under `/repos/orphans/` for the TTL | Assumed |

## Completion gate

- [ ] Every `FR*` in `01` is met
- [ ] `03` matrix green and Results dated
- [ ] `status` is `done` after merge
