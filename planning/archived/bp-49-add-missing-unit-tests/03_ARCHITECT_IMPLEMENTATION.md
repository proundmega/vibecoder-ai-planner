# bp-49: Add Missing Unit Tests for Untested Features — Implementation

**Status**: planned
**Priority**: P2
**Effort**: Large
**Scope**: Testing / Backend
**Branch**: feat/bp-49-missing-unit-tests

## Purpose
Add Jest unit tests for 6 backend services that were merged without test coverage. Each test must cover the **actual complex logic paths** — not just CRUD stubs.

## Implementation Order

1. **MilestoneService** (no Docker deps, pure DB — easiest)
2. **ReviewService** (no Docker deps, simple)
3. **DeployService** (needs http/https mocking for webhook)
4. **ProvisioningService** (needs ssh2 mocking)
5. **PoolManager** (needs dockerode mocking + cleanup interval)
6. **TerminalProxy** (WebSocket-based, hardest to test)
7. **Run full suite** — `cd backend && npm test`

## Per-File Action Plan

### 1. `backend/src/__tests__/milestoneService.test.js` (CREATE)

Complex logic to cover:
- `create`: BEGIN/COMMIT transaction, deactivates previous active milestone, empty name rejection
- `update`: Dynamic SQL builder with positional `$1..$N` parameters — test every branch (name only, description only, date only, mix), empty sets rejection, missing record
- `getProgress`: COALESCE + FILTER aggregate, **zero total_estimate guard** (no `/0`)
- `getTickets`: Simple query

```javascript
const MilestoneService = require('services/MilestoneService');
const { pool } = require('../db');

describe('MilestoneService', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('create', () => {
    it('creates a milestone, deactivates previous active');
    it('throws ValidationError for empty name');
    it('rolls back on DB error');
  });

  describe('update', () => {
    it('updates name only (dynamic SQL with 1 param)');
    it('updates description only');
    it('updates targetDate only');
    it('updates all fields (dynamic SQL with 3 params)');
    it('throws ValidationError when no fields provided');
    it('throws NotFoundError for missing milestone');
  });

  describe('getProgress', () => {
    it('calculates percentage from estimates');
    it('returns 0%% when total_estimate is 0 (no division by zero)');
  });

  describe('getTickets', () => {
    it('returns tickets for the milestone');
    it('returns empty array when no tickets');
  });
});
```

### 2. `backend/src/__tests__/reviewService.test.js` (CREATE)

Complex logic to cover:
- `saveLocalDiff`: Batch UPSERT with ON CONFLICT DO UPDATE + COALESCE, **filters out entries with missing path/action** (continue guard), transaction commit/rollback
- `getLocalDiff`: Simple SELECT
- `clearLocalDiff`: Simple DELETE

```javascript
const ReviewService = require('services/ReviewService');

describe('ReviewService', () => {
  describe('saveLocalDiff', () => {
    it('inserts multiple files in a transaction');
    it('skips entries with missing path or action (continue guard)');
    it('returns { saved: 0 } for empty array');
    it('returns { saved: 0 } for non-array input');
    it('rolls back on DB error');
  });

  describe('getLocalDiff', () => {
    it('returns diffs sorted by file_path');
    it('returns empty array when no diffs exist');
  });

  describe('clearLocalDiff', () => {
    it('deletes all diffs for a ticket');
  });
});
```

### 3. `backend/src/__tests__/deployService.test.js` (CREATE)

Complex logic to cover:
- `triggerDeploy`: **Status check** (ticket must be phase=done or status=done), webhook payload construction, **error→metadata update** on webhook failure
- `rollbackDeployment`: **Double-rollback guard** (checks `rolled_back_at`), SELECT with JOIN
- `_sendWebhook`: **Protocol selection** (http vs https via `new URL().protocol`), **timeout handling**, response parsing
- `getDeploymentHistory`, `updateDeploymentStatus`: Simple queries

```javascript
jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

const request = require('supertest');
const app = require('../index');
const DeployService = require('../api/deployments');

describe('DeployService', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('triggerDeploy', () => {
    it('rejects ticket not in done phase/status');
    it('rejects inactive environment');
    it('sends webhook with correct payload and marks status=triggered');
    it('stores error in metadata + marks status=failed on webhook failure');
  });

  describe('rollbackDeployment', () => {
    it('sends rollback webhook and sets rolled_back_at');
    it('throws error if deployment already rolled back');
    it('throws error if deployment not found');
  });

  describe('_sendWebhook', () => {
    it('uses https module for https:// URLs');
    it('uses http module for http:// URLs');
    it('rejects on timeout');
    it('rejects on connection error');
    it('resolves with status and body on success');
  });
});
```

### 4. `backend/src/__tests__/provisioningService.test.js` (CREATE)

Complex logic to cover:
- `spawnAgent`: SSH connect → `docker run`, **retry on image-not-found** (`pull access denied` / `not found` → pull then retry), failure count reset on success
- `testConnection`: **Failure count threshold** (count >= 3 → offline, else degraded), `failure_count` increment, status update
- `getNode`: NotFoundError on missing
- `getKey`: Delegates to CredentialService.decryptKey
- `destroyAgent`: SSH → `docker stop && docker rm`
- `getRunningContainers`: Docker ps output parsing (split by newline, filter empty, parse "ID Name" format)

Mock `ssh2`:
```javascript
jest.mock('ssh2', () => {
  const mockClient = {
    on: jest.fn(),
    connect: jest.fn(),
    exec: jest.fn(),
    end: jest.fn(),
  };
  // Support ssh.on('ready', cb) and ssh.on('error', cb) pattern
  return { Client: jest.fn(() => mockClient) };
});
```

```javascript
const ProvisioningService = require('services/ProvisioningService');

describe('ProvisioningService', () => {
  let mockSsh;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSsh = new (require('ssh2').Client)();
  });

  describe('getNode', () => {
    it('throws 404 if node not found');
    it('returns node row');
  });

  describe('spawnAgent', () => {
    it('SSH into node and runs docker run with env flags');
    it('pulls image and retries docker run on pull access denied');
    it('pulls image and retries docker run on "not found"');
    it('throws error if retry also fails');
    it('resets failure_count on successful spawn');
  });

  describe('destroyAgent', () => {
    it('SSH into node and runs docker stop + docker rm');
  });

  describe('testConnection', () => {
    it('sets status=online on success');
    it('increments failure_count on failure');
    it('sets status=degraded on 1st-2nd failure');
    it('sets status=offline on 3rd failure (threshold)');
  });

  describe('getRunningContainers', () => {
    it('parses docker ps output into id/name objects');
    it('returns empty array for empty output');
  });
});
```

### 5. `backend/src/__tests__/poolManager.test.js` (CREATE)

Complex logic to cover:
- Constructor: **Docker ping fallback** (`this.docker = null` when ping fails), **cleanup interval** (setInterval), pool Map init
- `requestAgent`: **Idle reuse** (reuses idle agent), **env var construction** from providerConfig (endpoint, apiKey, model), **image-not-found error** parsing (throw with build hint), NoDocker error when `this.docker` is null
- `releaseAgent`: Calls `_destroyContainer`, throws on missing agent
- `getStatus`: **Stats calculation** (busy/idle/starting/total counts)
- `_destroyContainer`: Graceful stop + remove, **try/catch swallows**, pool.delete
- `markActive`: **State transition starting→busy**, updates lastActiveAt
- `markIdle`: Sets state to idle, clears ticketId

Mock `dockerode`:
```javascript
jest.mock('dockerode', () => {
  const mockContainer = {
    start: jest.fn().mockResolvedValue(),
    stop: jest.fn().mockResolvedValue(),
    remove: jest.fn().mockResolvedValue(),
    id: 'mock-container-id',
  };
  const mockDocker = {
    ping: jest.fn().mockResolvedValue(),
    createContainer: jest.fn().mockResolvedValue(mockContainer),
    getContainer: jest.fn().mockResolvedValue(mockContainer),
  };
  return jest.fn(() => mockDocker);
});
```

```javascript
describe('PoolManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('starts cleanup interval');
    it('sets docker to null when ping fails');
  });

  describe('requestAgent', () => {
    it('reuses an idle agent (avoids creating a new container)');
    it('creates new container when no idle agents');
    it('includes providerConfig endpoint/apiKey/model in env');
    it('throws error when docker is unavailable');
    it('throws helpful error for missing agent image');
  });

  describe('releaseAgent', () => {
    it('destroys container and removes from pool');
    it('throws if agent not in pool');
  });

  describe('getStatus', () => {
    it('returns correct busy/idle/starting/total counts');
  });

  describe('_startCleanupInterval', () => {
    it('destroys starting agents after 30s timeout');
    it('destroys idle agents after IDLE_TIMEOUT_MS');
  });

  describe('markActive', () => {
    it('transitions state from starting to busy');
    it('updates lastActiveAt');
  });

  describe('markIdle', () => {
    it('sets state to idle and clears ticketId');
  });
});
```

### 6. `backend/src/__tests__/terminalProxy.test.js` (CREATE)

Complex logic to cover:
- `start()`: Container inspect → running check, **bash → sh fallback** when /bin/bash unavailable, stream setup (data→ws.send, end→ws.close, error→ws.close), **WS message routing** (input type → base64 write, resize type → exec.resize), WS close/error → cleanup
- `cleanup()`: **Idempotent** (stream.end with try/catch), nulls out references

```javascript
jest.mock('dockerode', () => {
  const mockExec = {
    start: jest.fn().mockResolvedValue({ on: jest.fn(), write: jest.fn() }),
    resize: jest.fn().mockResolvedValue(),
  };
  const mockContainer = {
    inspect: jest.fn().mockResolvedValue({ State: { Running: true } }),
    exec: jest.fn().mockResolvedValue(mockExec),
  };
  return jest.fn(() => ({ getContainer: jest.fn().mockResolvedValue(mockContainer) }));
});

describe('TerminalProxy', () => {
  let mockWs;
  let proxy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWs = {
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn(),
    };
  });

  describe('start', () => {
    it('inspects container and starts bash shell');
    it('falls back to /bin/sh when /bin/bash fails');
    it('throws if container not running');
    it('forwards stream data to WS');
    it('handles resize messages from WS');
    it('handles input messages from WS');
    it('calls cleanup on WS close');
  });

  describe('cleanup', () => {
    it('ends stream and nulls references');
    it('is idempotent when called multiple times');
    it('does not throw if stream.end fails');
  });
});
```

## Verification

1. `cd backend && npm test` — all new tests pass, existing tests unaffected
2. `npm run lint` — no errors
3. Each new file is auto-detected by jest.config.js glob `**/__tests__/*.test.js`
