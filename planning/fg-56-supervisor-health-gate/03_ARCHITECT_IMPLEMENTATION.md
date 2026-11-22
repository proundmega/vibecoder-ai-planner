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
| FR1 | Java | `BackendHealthGateTest` | unhealthy server does not proceed; healthy server proceeds | `mvn test -Dtest=BackendHealthGateTest` |
| FR2 | Java | `BackendHealthGateTest` | bounded timeout and retry interval | same |
| FR3 | Java | `BackendHealthGateTest` | default required, explicit opt-out | same |
| FR4 | Java | `BackendHealthGateTest` | success/failure log message | same |
| FR5 | Java | `SupervisorMainTest`, `SupervisorIntegrationTest` | existing flow remains green | `mvn test -Dtest=SupervisorMainTest,SupervisorIntegrationTest` |
| FR6 | Docs | review | env vars and D7 closeout recorded | `node planning/check-planning.js` |
| NFR1 | Java | `BackendHealthGateTest` | no callback/child work before health | same |
| NFR2 | Java | `BackendHealthGateTest` | URL/status only, no credentials | same |
| FR7 | Java | `BackendHealthMonitorTest` | Detects outage/recovery, bounded backoff, disabled/no-URL | `mvn test -Dtest=BackendHealthMonitorTest` |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row
- [ ] Gate runs before any child construction
- [ ] Timeout fails closed
- [ ] Docs updated; no secret in logs

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `feat/fg-56-supervisor-health-gate` (PR #203) | BackendHealthGate 6 tests; SupervisorMain + SupervisorIntegration 20 | Pass. Healthy/503/timeout/opt-out covered; the gate runs before enrollment/declaration. |
| 2026-11-22 | `81ad3b6` | BackendHealthMonitor 4 tests; focused supervisor 30; full agent 955 (10 skipped) | Pass. Outage/recovery, bounded backoff, disabled and missing-URL cases covered; the reconcile tick pauses while unhealthy. |
