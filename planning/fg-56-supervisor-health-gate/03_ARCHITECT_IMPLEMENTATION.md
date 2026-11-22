# 03 — Implementation (fg-56)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

- [x] Create the test stub first (`BackendHealthGateTest`)
- [x] Add `BackendHealthGate`
- [x] Wire the gate into `SupervisorMain.run`
- [x] Document the env vars and close fg-43 D7
- [x] Add the post-start monitor with bounded exponential backoff (slice B)
- [x] Run the matrix and record results

## Per-file changes

| File | Action | Change |
|---|---|---|
| `agent/src/main/java/com/vibecode/agent/supervisor/BackendHealthGate.java` | add | HTTP probe, URL builder, bounded retry and env parsing |
| `agent/src/main/java/com/vibecode/agent/supervisor/BackendHealthMonitor.java` | add | Post-start probe, bounded exponential backoff, health state |
| `agent/src/main/java/com/vibecode/agent/supervisor/Supervisor.java` | change | Health-gated `reconcile`/`runLoop` (covers SIGHUP reload) |
| `agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java` | change | Startup gate, monitor lifecycle, pause declaration/reconcile while unhealthy |
| `agent/src/test/java/com/vibecode/agent/supervisor/BackendHealthGateTest.java` | add | Healthy/unhealthy/timeout/disabled and URL sanitization |
| `agent/src/test/java/com/vibecode/agent/supervisor/BackendHealthMonitorTest.java` | add | Outage/recovery, backoff bound, disabled/no-URL coverage |
| `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorReconcileTest.java` | change | Dead child is not respawned while unhealthy; direct reconcile pauses |
| `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorMainHealthWiringTest.java` | add | `SupervisorMain.run` stops at the gate before credentials/declaration |
| `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorMainHarness.java` | add | Subprocess entry point for the wiring test |
| `agent/docker-compose.yml` | change | Pass the health gate/monitor env vars |
| `agent/scripts/host-init.sh` | change | `/api/health` wait path and `.env.agent-host` health vars |
| `agent/scripts/host-init.test.sh` | change | Assert the `/api/health` path and env lines |
| `agent/README.md` | change | Document the supervisor health env vars |
| `AGENTS.md` | change | Add the gate and monitor to the harness env list |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Java | `BackendHealthGateTest`, `SupervisorMainHealthWiringTest` | 2xx/503 probe and bounded retry; `run()` stops at the gate before credential/declaration work | `mvn test -Dtest=BackendHealthGateTest,SupervisorMainHealthWiringTest` |
| FR2 | Java | `BackendHealthGateTest` | bounded timeout, retry interval, per-request remaining-time cap and connect timeout | same |
| FR3 | Java | `BackendHealthGateTest` | default required, explicit opt-out | same |
| FR4 | Java | `BackendHealthGateTest` | success/failure path; log text is code-reviewed (no appender assertion) | same |
| FR5 | Java | `SupervisorMainTest`, `SupervisorIntegrationTest` | existing helper and crash-adoption flows remain green | `mvn test -Dtest=SupervisorMainTest,SupervisorIntegrationTest` |
| FR6 | Docs | review | env vars and D7 closeout recorded | `node planning/check-planning.js` |
| NFR1 | Java | `SupervisorReconcileTest`, `SupervisorMainHealthWiringTest` | probe gate stops startup before credentials; a dead child is not respawned while unhealthy, including direct/SIGHUP reconcile | `mvn test -Dtest=SupervisorReconcileTest,SupervisorMainHealthWiringTest` |
| NFR2 | Java | `BackendHealthGateTest` | `safeUrl` strips userinfo from gate/monitor/probe logs | same |
| FR7 | Java | `BackendHealthMonitorTest`, `SupervisorReconcileTest` | Detects outage/recovery, bounded backoff, disabled/no-URL; runLoop and direct reconcile pause while unhealthy | `mvn test -Dtest=BackendHealthMonitorTest,SupervisorReconcileTest` |

## Review checklist

- [x] Every `FR*`/`NFR*` has a passing row
- [x] Gate runs before any child construction; the subprocess harness test proves `run()` stops before credentials
- [x] Timeout fails closed
- [x] Docs updated; no secret in logs

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `feat/fg-56-supervisor-health-gate` (PR #203) | BackendHealthGate 7 tests; SupervisorMain + SupervisorIntegration 20 | Pass. Healthy/503/timeout/opt-out, URL-userinfo sanitization and the `run()` wiring harness are covered. |
| 2026-11-22 | `81ad3b6` | BackendHealthMonitor 4 + SupervisorReconcile health-gate test; full agent suite 941 run / 10 skipped | Pass. Outage/recovery, bounded backoff, disabled/missing-URL, and no child respawn while unhealthy. |
| 2026-11-22 | `54fef50` | Review fixes: health-gated `Supervisor.runLoop` + test; compose/host-init env; `/api/health` wait path; sanitized URLs; remaining-time request cap; matrix/Results corrected. Full agent 941 run / 10 skipped; host-init 68; Compose base+sandbox render. | Pass. |
| 2026-11-22 | `e27d805` | Review fixes 2: sanitized `probeOnce` log, `SupervisorMain.run` subprocess wiring test, direct/SIGHUP reconcile gate, host-init path/env assertions, connect-timeout cap, docs table. Full agent 942 run / 10 skipped; host-init 75; Compose base+sandbox render. | Pass. |
| 2026-11-22 | `32ece1d` | Review fixes 3: one static health `HttpClient` (no per-probe selector/FD churn), wiring test waits on a redirected file and verifies only `/api/health` was requested, D1 state vocabulary. Full agent 942 run / 10 skipped; host-init 75. | Pass. |
