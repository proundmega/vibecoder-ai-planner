# 02 — Design (fg-56)

> **Owns:** current-state audit, design, data flow, failure modes, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file
> operations (`04`), status (`00`).

## Current state

`SupervisorMain.run` parses the declaration, connects the node credential,
fetches the node config, declares runtimes, constructs the supervisor and calls
`reconcile()`. There is no explicit backend health check in that path.

## Design

A small `BackendHealthGate` owns the HTTP probe and bounded retry:

```java
static void awaitHealth(String backendUrl, Duration timeout, Duration interval)
static boolean required(String value)
static Duration timeout(String value)
static Duration interval(String value)
static String healthUrl(String backendUrl)
```

`SupervisorMain.run`:

1. Build `AgentConfig` (needs `BACKEND_URL`/credentials path).
2. If required (default), call `BackendHealthGate.awaitHealth(agentConfig.getBackendUrl(), ...)`.
3. Only then call `auth.initialize()`, fetch the node config, declare and
   reconcile.

`healthUrl` strips trailing slashes and appends `/api/health`. The probe treats
any 2xx as healthy and any connection error/5xx/non-2xx as retryable. The wait
is bounded; on timeout it throws, so no child is created. `SUPERVISOR_HEALTH_REQUIRED=false`
skips only the gate, not declaration/reconcile.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SUPERVISOR_HEALTH_REQUIRED` | `true` | Enable the startup health gate |
| `SUPERVISOR_HEALTH_TIMEOUT_SECONDS` | `120` | Maximum wait |
| `SUPERVISOR_HEALTH_INTERVAL_SECONDS` | `2` | Retry interval |

## Failure modes

| Case | Behavior |
|---|---|
| Backend 5xx/connection refused | Retry until the timeout; exit non-zero, no children |
| Backend healthy first try | Log success and continue |
| Timeout | Throw `IOException` with the URL and last reason |
| Gate disabled | Log the skip and continue |
| Backend dies after startup | Existing retry/declaration path remains; continuous monitoring is D1 |

## Security

The health URL is the operator-configured `BACKEND_URL`; the request carries no
node token or provider secret. Logs contain the URL and status only.

## Rollout

1. Add the gate and unit tests (fake clock/sleeper, no real backend).
2. Enable by default; local offline users can set
   `SUPERVISOR_HEALTH_REQUIRED=false`.
3. Run the fg-54 runbook with the gate enabled and record evidence.
