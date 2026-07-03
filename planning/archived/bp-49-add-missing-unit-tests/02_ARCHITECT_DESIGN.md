# bp-49: Add Missing Unit Tests for Untested Features — Design

**Status**: planned
**Date created**: 2026-06-30
**Scope**: Testing

## Current State

Six backend services merged recently have zero unit test coverage:

| Feature | Service | Route | Lines | Complex logic |
|---------|---------|-------|-------|---------------|
| bp-40 — Compute Nodes | `ProvisioningService.js` | `compute-nodes.js` | 129 | SSH spawnAgent retry, failure thresholds |
| bp-39 — Milestones | `MilestoneService.js` | `milestones.js` | 104 | Dynamic SQL builder, transaction, zero-div guard |
| bp-37 — Deployment Pipeline | `DeployService.js` | `deployments.js` | 145 | Webhook http/https routing, timeout, double-rollback guard |
| bp-36 — Pool Manager | `PoolManager.js` | `pool.js` | 169 | Docker ping fallback, idle reuse, cleanup interval |
| bp-38 — Web Terminal | `TerminalProxy.js` | `terminal.js` | 114 | bash→sh fallback, WS message routing, idempotent cleanup |
| bp-35 — Local Diff Storage | `ReviewService.js` | `review.js` | 43 | Batch UPSERT with COALESCE, invalid entry filtering |

Existing test infrastructure:
- Jest: `setupFilesAfterEnv` → `src/__tests__/jest.setup.js` (mocks pg, winston, bcryptjs, uuid, jsonwebtoken)
- `moduleNameMapper` maps `models/` and `services/` for clean `require('services/Foo')`
- `--passWithNoTests` means new test files are detected properly

## Proposed Test Strategy

### Test file per service, mocking external dependencies

| Service | External dep to mock | Mock pattern |
|---------|---------------------|--------------|
| MilestoneService | None (pure DB via pg mock) | pg already mocked in jest.setup.js |
| ReviewService | None | pg already mocked |
| DeployService | `http`/`https` native modules | `jest.mock('http')` + `jest.mock('https')` for `_sendWebhook` |
| ProvisioningService | `ssh2` | `jest.mock('ssh2')` — mock Client, on/connect/exec/end |
| PoolManager | `dockerode` | `jest.mock('dockerode')` — mock ping/createContainer/stop/remove |
| TerminalProxy | `dockerode`, `ws` | `jest.mock('dockerode')` — mock getContainer/inspect/exec |

### Test targets per service (actual complex paths)

**MilestoneService** (104 lines):
- `create`: Transaction guard, **active milestone deactivation**, empty name
- `update`: **Dynamic SQL builder** — 4 combinations of fields, empty set guard, missing record
- `getProgress`: **Zero-division guard** when total_estimate = 0

**ReviewService** (43 lines):
- `saveLocalDiff`: **Batch UPSERT with ON CONFLICT DO UPDATE**, **continue guard** for invalid entries, transaction rollback

**DeployService** (145 lines):
- `triggerDeploy`: **Ticket phase/status guard**, **webhook error→metadata fallback**
- `rollbackDeployment`: **Double-rollback guard** (`rolled_back_at` check)
- `_sendWebhook` (private): **Protocol routing** (http vs https via `URL.protocol`), **10s timeout**, response parsing

**ProvisioningService** (129 lines):
- `spawnAgent`: **SSH docker run → image-not-found retry** (pull + retry), failure counter reset
- `testConnection`: **Failure threshold** (count >= 3 → offline, else degraded)
- `getRunningContainers`: **Docker ps output parsing** (split/filter/map)

**PoolManager** (169 lines):
- Constructor: **Docker ping → fallback** (`this.docker = null`), **cleanup setInterval**
- `requestAgent`: **Idle reuse loop**, env from providerConfig, image-not-found error message
- `_destroyContainer`: **Graceful stop/remove with swallowed errors**, pool cleanup
- `markActive`: **starting→busy state transition**
- `getStatus`: **Stats counters** (busy/idle/starting/total)

**TerminalProxy** (114 lines):
- `start()`: Container inspect → **bash→sh fallback**, **WS message routing** (input=base64 write, resize=exec.resize)
- `cleanup()`: **Idempotent** stream.end with try/catch

## Risks

1. **dockerode constructor side-effects**: `PoolManager` constructor calls `new Docker()` then `this.docker.ping().catch(...)`. The async ping rejection is unhandled in tests — may cause unhandled rejection warnings. Mitigation: mock dockerode before requiring PoolManager.
2. **setInterval leaks**: `PoolManager._startCleanupInterval()` starts a `setInterval` in constructor. Must use `jest.useFakeTimers()` and clear after each test.
3. **ssh2 event pattern**: `ProvisioningService.connect()` uses `ssh.on('ready', resolve)` and `ssh.on('error', reject)` via Promise. Mock must trigger 'ready' to resolve the promise.
4. **WebSocket testing**: `TerminalProxy` takes a real WS object. Testing requires a mock with `send`, `close`, `on` methods.
5. **http/https module mocking**: `_sendWebhook` does `require('http')` / `require('https')` at call time, not at module load. `jest.mock` works for this because Jest hoists mock calls.
