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
| `agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java` | change | Startup gate, monitor lifecycle, pause declaration/reconcile while unhealthy |
| `agent/src/test/java/com/vibecode/agent/supervisor/BackendHealthGateTest.java` | add | Healthy/unhealthy/timeout/disabled coverage |
| `agent/src/test/java/com/vibecode/agent/supervisor/BackendHealthMonitorTest.java` | add | Outage/recovery, backoff bound, disabled/no-URL coverage |
| `agent/README.md` | change | Document the supervisor health env vars |
| `AGENTS.md` | change | Add the gate and monitor to the harness env list |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Java | `BackendHealthGateTest` | 2xx/503 probe and bounded retry; the `SupervisorMain` call order is code-reviewed (no `run()` harness test) | `mvn test -Dtest=BackendHealthGateTest` |
| FR2 | Java | `BackendHealthGateTest` | bounded timeout, retry interval and per-request remaining-time cap | same |
| FR3 | Java | `BackendHealthGateTest` | default required, explicit opt-out | same |
| FR4 | Java | `BackendHealthGateTest` | success/failure path; log text is code-reviewed (no appender assertion) | same |
| FR5 | Java | `SupervisorMainTest`, `SupervisorIntegrationTest` | existing helper and crash-adoption flows remain green | `mvn test -Dtest=SupervisorMainTest,SupervisorIntegrationTest` |
| FR6 | Docs | review | env vars and D7 closeout recorded | `node planning/check-planning.js` |
| NFR1 | Java | `BackendHealthGateTest`, `SupervisorReconcileTest` | probe gate is checked before reconcile; a dead child is not respawned while unhealthy | `mvn test -Dtest=BackendHealthGateTest,SupervisorReconcileTest` |
| NFR2 | Java | `BackendHealthGateTest` | `safeUrl` strips userinfo; monitor logs the sanitized URL | same |
| FR7 | Java | `BackendHealthMonitorTest`, `SupervisorReconcileTest` | Detects outage/recovery, bounded backoff, disabled/no-URL; runLoop pauses spawn while unhealthy | `mvn test -Dtest=BackendHealthMonitorTest,SupervisorReconcileTest` |

## Review checklist

- [x] Every `FR*`/`NFR*` has a passing row
- [x] Gate runs before any child construction (code-reviewed; no `run()` harness test)
- [x] Timeout fails closed
- [x] Docs updated; no secret in logs

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `feat/fg-56-supervisor-health-gate` (PR #203) | BackendHealthGate 6 tests; SupervisorMain + SupervisorIntegration 20 | Pass. Healthy/503/timeout/opt-out and URL-userinfo sanitization covered. The `SupervisorMain.run` ordering is code-reviewed; there is no harness test that runs `run()`. |
| 2026-11-22 | `81ad3b6` | BackendHealthMonitor 4 + SupervisorReconcile health-gate test; full agent suite 941 run / 10 skipped | Pass. Outage/recovery, bounded backoff, disabled/missing-URL, and no child respawn while unhealthy. |
