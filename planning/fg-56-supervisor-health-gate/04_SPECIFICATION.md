# 04 — Specification (fg-56)

> **Owns:** exact file operations and contracts.
> **Not here:** design (`02`), requirements (`01`), verification matrix (`03`),
> status (`00`).

## 1. Test stub first

Create `agent/src/test/java/com/vibecode/agent/supervisor/BackendHealthGateTest.java`
with `@Test` placeholders before the production class.

## 2. `BackendHealthGate`

```java
final class BackendHealthGate {
    static final long DEFAULT_TIMEOUT_SECONDS = 120;
    static final long DEFAULT_INTERVAL_MILLIS = 2_000;

    static String healthUrl(String backendUrl);
    static boolean required(String value);
    static Duration timeout(String value);
    static Duration interval(String value);
    static void awaitHealth(String backendUrl, Duration timeout, Duration interval) throws IOException;
}
```

`awaitHealth` probes `backendUrl + "/api/health"` immediately and then every
`interval` until `timeout`. A 2xx response succeeds; connection failures and
non-2xx responses are retried. On exhaustion it throws `IOException` with the
URL and last reason. It logs attempt/success/failure without credentials.

## 3. Supervisor wiring

`SupervisorMain.run` builds `AgentConfig`, then calls the gate before
`auth.initialize()` and before `Supervisor` construction. The env values are
read once at startup; a missing/invalid value falls back to the defaults.

## 3b. Post-start monitor (slice B)

`BackendHealthMonitor` starts after the gate passes. It probes
`BackendHealthGate.probeOnce(BACKEND_URL)` on a daemon scheduler, exposes
`isHealthy()`, and logs loss/recovery. Failure delay starts at the base
interval, doubles on each consecutive failure up to the max, and resets on
success. `SupervisorMain` skips the declaration/retry tick while unhealthy and
sets `Supervisor.setHealthGate(monitor::isHealthy)` so the main reconcile loop
does not spawn a missing child. The monitor is closed in the run loop's
`finally` and is created only after auth/declaration succeed.

## 4. Configuration

| Variable | Default |
|---|---|
| `SUPERVISOR_HEALTH_REQUIRED` | `true` |
| `SUPERVISOR_HEALTH_TIMEOUT_SECONDS` | `120` |
| `SUPERVISOR_HEALTH_INTERVAL_SECONDS` | `2` |
| `SUPERVISOR_HEALTH_MONITOR_ENABLED` | `true` (off when the gate is off) |
| `SUPERVISOR_HEALTH_MONITOR_INTERVAL_SECONDS` | `10` |
| `SUPERVISOR_HEALTH_MONITOR_MAX_BACKOFF_SECONDS` | `60` |

## 5. Verification commands

```bash
cd agent && mvn test -Dtest=BackendHealthGateTest,BackendHealthMonitorTest,SupervisorMainTest,SupervisorIntegrationTest
node planning/check-planning.js
git diff --check
```
