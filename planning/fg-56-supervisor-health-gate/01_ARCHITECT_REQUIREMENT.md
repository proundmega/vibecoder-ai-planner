# 01 — Requirement (fg-56)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

`SupervisorMain` enrolls, declares runtimes and starts child JVMs as soon as the
local declaration parses. `host-init.sh --yes` waits for `/api/health` after
starting Compose, but a manually started supervisor, a Compose restart while
the backend is down, or an off-host deployment can spawn children before the
backend is healthy. The children then fail heartbeats/claims or start against
an incomplete API.

## Goals

1. Gate the supervisor on the backend `/api/health` endpoint before enrollment,
   runtime declaration or the first child spawn.
2. Bound the wait and fail closed without spawning a partial fleet.
3. Make the gate observable and configurable.
4. Keep the existing declaration/reconcile behavior once health is green.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Before enrollment/declaration/spawn, the supervisor calls `BACKEND_URL + /api/health` and proceeds only on a 2xx response. | Fake server down → no children; fake server healthy → normal startup path. |
| FR2 | The wait is bounded by `SUPERVISOR_HEALTH_TIMEOUT_SECONDS` (default 120) with `SUPERVISOR_HEALTH_INTERVAL_SECONDS` (default 2) between attempts. | Timeout test exits non-zero and never spawns. |
| FR3 | `SUPERVISOR_HEALTH_REQUIRED=false` explicitly skips the gate for local/offline runs; the default is required. | Config test verifies default true and opt-out. |
| FR4 | The gate logs attempts, success and the final failure reason without secrets. | Gate test captures success/failure messages. |
| FR5 | After the gate passes, the existing enrollment, declaration and reconcile flow is unchanged; a later backend restart is handled by the existing retry loop. | Existing supervisor tests remain green. |
| FR6 | Document the env vars in `agent/README.md`/`AGENTS.md` and record the fg-43 D7 closeout. | Docs review + `check-planning.js`. |

## Non-functional / safety

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | No child is spawned while the gate is waiting. | The gate runs before `Supervisor` construction/reconcile. |
| NFR2 | Health checks never log credentials or the node token. | Logs contain only the URL/status/reason. |

## Out of scope

Continuous health monitoring, circuit-breaker behavior and backend-to-agent
push are deferred (D1/D2).
