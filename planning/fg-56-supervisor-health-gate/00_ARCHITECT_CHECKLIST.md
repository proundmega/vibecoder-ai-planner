---
id: "fg-56"
title: "Supervisor Backend Health Gate"
status: in_review
priority: "P1"
effort: "Small"
scope: "Agent"
created: "2026-11-22"
updated: "2026-11-22"
pr: 203
branch: "feat/fg-56-supervisor-health-gate"
depends_on: ["fg-43", "fg-54"]
---

# 00 — Supervisor Backend Health Gate (fg-56)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`),
> file operations (`04`).

**Related code:** `agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java`,
`BackendHealthGate.java`, `BackendHealthMonitor.java`, `Supervisor.java`,
`agent/README.md`, `AGENTS.md`.

This ticket is the actionable follow-up `fg-43-D7`: the supervisor must not
enroll, declare runtimes or spawn children before the backend `/api/health`
endpoint is green.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan recorded | This suite; fg-43 D7 | ☑ |
| Implementation in review | PR #203 | ☑ |
| Verification results | `03` → Results | ☑ |

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Continuous post-start health monitoring with exponential backoff | self | Reliability | fg-56 PR #203 (slice B; merge pending) | scheduled |
| D2 | Health-gated restarts without Compose restart policy | self | Operations | follow-up if needed | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Gate scope | startup only / continuous | Startup only; Compose restarts the container and the existing retry loop owns post-start recovery | Assumed; revisit for D1 |
| 2 | Default | required / opt-in | Required by default; `SUPERVISOR_HEALTH_REQUIRED=false` for local offline runs | Answered 2026-11-22: required by default |

## Completion gate

- [ ] Every `FR*` acceptance in `01` is met
- [ ] `03` matrix is green and `03` Results is dated
- [ ] `status` is `done` after merge
