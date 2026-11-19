# 02 — Design (fg-54)

> **Owns:** current-state audit, chosen design, data model, contracts, risks,
> rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), exact file
> operations (`04`), status and deferrals (`00`).

## Current state (the only infrastructure audit)

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Backend route/controller/service | yes | `backend/src/api/agents.js`, `backend/src/api/agentEnrollment.js`, `backend/src/api/providers.js`, `backend/src/services/AgentService.js`, `AgentEnrollmentService.js`, `ProviderService.js`, `ProviderRouter.js` | agents are project-bound; roles are advisory; provider key/model are fused |
| Database tables | yes | `055_agent_enrollment.sql` (`agents`, `agent_access_tokens`, `agent_refresh_tokens`, `agent_enrollment_tokens`), `035_global_providers.sql` (`providers.roles`, `is_project_director`), `009_project_providers.sql` | no node/grant/runtime model; no credential/model split |
| Frontend API client/views | yes | `frontend/src/views/AgentList.vue`, `AgentDetail.vue`, provider views under `frontend/src/views/` | enrollment is project/token-centric; no fleet or model registry |
| Agent code | yes | `agent/src/main/java/com/vibecode/agent/AgentApp.java`, `config/AgentConfig.java`, `service/AgentAuthManager.java`, `AgentCredentialStore.java` | one process = one project/role; `AGENT_MODE` is client-asserted |
| Deployment | yes | `agent/docker-compose.yml`, `agent/docker-compose.remote.yml.example` | one container per agent; no host supervisor |
| Server orchestration | partial | `backend/src/services/PoolManager.js`, `backend/src/api/pool.js` | spawns a container per request; not a durable fleet controller |

**Key insight:** extend both. Enrollment, token rotation, audit and provider
resolution already exist; this ticket re-scopes them to a node, splits the
provider object, and adds the missing host/supervisor and manager tiers.
`ProviderRouter.getForRole` currently has no production caller — role tags are
metadata, not enforcement.

## Design summary

Four runtime layers, one platform tier:

| Layer | Lifetime | Identity | Owns |
|---|---|---|---|
| Node | long | node credential | host, heartbeat, grants |
| Grant | long | `(node, project, role)` | what a node may serve |
| Runtime | replaceable | `(node, role, model)` + header | one child process slot |
| Lease | short | `(ticket, runtime, expiry)` | exclusivity for one ticket |

- **Roles are closed**: `worker`, `reviewer`, `planner`. `manager` is a server
  service tier, not a role. Capabilities live in code, not in the DB.
- **Credentials and models split**: `provider_credentials` owns the secret and
  endpoint; `provider_models` owns the model id, capability metadata and
  `roles[]`. A runtime attaches a model whose roles include its role.
- **Supervisor**: one container per host. It enrolls as the node, fetches its
  resolved configuration, and reconciles child JVMs. The config lists roles,
  model refs and counts — never secrets.
- **Manager**: a service in the main stack. It owns housekeeping and later
  desired state; replicas coordinate through Postgres locks and
  `FOR UPDATE SKIP LOCKED`.
- **Clean cut**: `agents` becomes `agent_runtimes`; `agents.project_id`,
  static `ak_…` auth, `agent_enrollment_tokens.project_id/provider_id` and the
  fused `providers.model/roles/is_project_director` columns are removed. No
  backfill; the user approved this in `00`.

### Role capability matrix

| Capability | worker | reviewer | planner |
|---|---|---|---|
| Claim/build tickets | yes | no | no |
| Clone, branch, push, open PR | yes | no (read-only checkout for review) | no |
| Read tickets and PR diffs | granted projects | granted projects | granted projects |
| Post review / findings | no | yes | no |
| Move `review → done` | no | no (D10) | no |
| Draft/publish planning docs | no | no | yes (API-guarded) |
| Report usage | yes | yes | yes |

## Alternatives considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| A · Node + grants + runtimes + supervisor | one enrollment per host; server-enforced roles; one stack | new schema and supervisor code | **chosen** |
| B · Keep one container per agent, add only server-side roles | smallest delta | still N stacks and N enrollments; no host unit | rejected |
| C · Backend-spawned containers per runtime (extend `PoolManager`) | no host supervisor | requires Docker/socket on every host and a stronger trust boundary; harder to run off-host | rejected for v1 (D1/D9) |
| D · Dynamic desired-state from day one | autoscaling, central control | command channel, leader election, drain protocol; delays the identity fix | deferred to D1 |

## Data model & migrations

```sql
-- Host identity and capabilities
CREATE TABLE agent_nodes (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  hostname VARCHAR(255),
  fingerprint VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','draining','revoked')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, name)
);

CREATE TABLE agent_node_grants (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('worker','reviewer','planner')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  UNIQUE (node_id, project_id, role)
);

-- Credentials and models
CREATE TABLE provider_credentials (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE, -- NULL = owner/global
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);

CREATE TABLE provider_models (
  id BIGSERIAL PRIMARY KEY,
  credential_id BIGINT NOT NULL REFERENCES provider_credentials(id) ON DELETE RESTRICT,
  model VARCHAR(200) NOT NULL,
  display_name VARCHAR(200),
  source VARCHAR(20) NOT NULL CHECK (source IN ('discovered','manual')),
  status VARCHAR(20) NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','verified','disabled')),
  roles TEXT[] NOT NULL DEFAULT '{}',
  max_tokens INTEGER,
  context_window INTEGER,
  last_verified_at TIMESTAMPTZ,
  last_verify_error TEXT,
  UNIQUE (credential_id, model)
);

-- Runtime instances (renamed from agents)
CREATE TABLE agent_runtimes (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('worker','reviewer','planner')),
  model_id BIGINT NOT NULL REFERENCES provider_models(id) ON DELETE RESTRICT,
  concurrency INTEGER NOT NULL DEFAULT 1 CHECK (concurrency > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','draining','stopped')),
  current_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ,
  UNIQUE (node_id, name)
);

-- Node join tokens replace project-scoped enrollment tokens
CREATE TABLE agent_node_enrollment_tokens (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lease tightening
ALTER TABLE tickets RENAME COLUMN assigned_agent_id TO assigned_runtime_id;
ALTER TABLE tickets ADD COLUMN lease_expires_at TIMESTAMPTZ;
```

- Migration: `backend/src/migrations/056_agent_fleet.sql`
- Rollback: `backend/src/migrations/056_agent_fleet_rollback.sql`
- Backfill: **none** (clean cut); the migration creates new tables, renames,
  and drops the legacy columns in the same transaction.
- Apply order: after `055_agent_enrollment.sql` in
  `backend/src/migrations/apply.js`.
- Kept from fg-53: hashed token prefixes, refresh rotation and the credential
  store (`agent_access_tokens` / `agent_refresh_tokens` now reference `node_id`).

## API contract

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/agent-nodes/enroll` | join token | `{token, name, hostname, fingerprint}` | `{node, accessToken, refreshToken}` | 400/401/409/429 |
| GET | `/api/v1/agent-nodes` | JWT `AGENT_READ` | — | node list with grants/runtimes | 403 |
| POST | `/api/v1/agent-nodes/:id/revoke` | JWT `AGENT_REVOKE` | — | node + runtimes marked | 404/409 |
| POST | `/api/v1/agent-nodes/:id/drain` | JWT `AGENT_REVOKE` | — | drain accepted | 404 |
| GET | `/api/v1/agent-nodes/:id/grants` | JWT `AGENT_READ` | — | grants | 403/404 |
| POST | `/api/v1/agent-nodes/:id/grants` | JWT `AGENT_CREATE` + project scope | `{projectId, role}` | grant | 400/403/409 |
| DELETE | `/api/v1/agent-nodes/:id/grants/:grantId` | JWT `AGENT_CREATE` | — | revoked grant | 403/404 |
| GET | `/api/v1/agent-nodes/:id/config` | node credential | `?runtime=` optional | resolved runtimes, models, grants (no secrets) | 401/403 |
| POST | `/api/v1/agent-runtimes/:id/heartbeat` | node credential + `X-Agent-Runtime` | `{status, currentProjectId}` | ack | 401/403/409 |
| GET/POST | `/api/v1/provider-credentials` | JWT `PROVIDER_MANAGE` | credential fields | list/create (secret masked) | 400/403 |
| PATCH/DELETE | `/api/v1/provider-credentials/:id` | JWT `PROVIDER_MANAGE` | rotation or status | updated/masked | 403/409 |
| POST | `/api/v1/provider-credentials/:id/discover` | JWT `PROVIDER_MANAGE` | — | discovered models (`unverified`) | 400/403/502 |
| POST | `/api/v1/provider-credentials/:id/models` | JWT `PROVIDER_MANAGE` | `{model, displayName?, roles?}` | manual model | 400/403/409 |
| POST | `/api/v1/provider-models/:id/test` | JWT `PROVIDER_MANAGE` | — | `{verified, latencyMs}` | 400/403/502/429 |
| PATCH | `/api/v1/provider-models/:id` | JWT `PROVIDER_MANAGE` | `{roles?, status?, maxTokens?}` | updated model | 400/403/409 |

Existing agent endpoints (`/agents/*`, claim/review/planning) keep their paths
but authenticate with the node credential plus the runtime header, and check
the runtime role and project grant before acting.

## Data flow

```
enroll:  join token → AgentNodeEnrollmentService → node + credential pair → supervisor volume
boot:    node credential → GET /agent-nodes/:id/config → validate roles/model/grant
spawn:   supervisor → child JVM (AGENT_RUNTIME_ID, role, model) → heartbeat
claim:   runtime → POST claim(project, role) → grant + role check → ticket lease
run:     runtime → fetch repo token + provider config → harness → publish → release
revoke:  UI → grant/runtime revoked → next heartbeat 403 → runtime drains, releases lease
```

## Failure modes and recovery

| Failure mode | Trigger | Detection | Mitigation / test | Operator action |
|---|---|---|---|---|
| Join token exhausted or expired | Token reused / TTL passed | 401/409 at enroll | single-use default, TTL; test asserts no node row | Mint a new token |
| Node credential lost | Volume deleted | 401 on config/heartbeat | re-enroll; credential store 0600; no secrets in config | Restore the volume or re-enroll |
| Supervisor crash mid-spawn | OOM/kill | children orphaned | PID tracking, startup sweep, deterministic names; kill -9 test | Restart the stack |
| Partial reconcile | Backend down at boot | config fetch fails | retry with backoff, keep current children, no destructive action | Check backend reachability |
| Model unverified | Attached before test | runtime creation 409 | attach requires `verified`; test records error | Run the test button |
| Credential rotation during a run | Rotation while runtimes are live | version change | runtimes resolve per run; rotation keeps model refs | None; next run uses the new secret |
| Duplicate manager work | Two replicas tick together | duplicate audit rows | advisory lock + `SKIP LOCKED`; two-replica test | None |
| Grant revoked mid-lease | Admin revokes a grant | 403 on next heartbeat | runtime releases the lease then drains; test asserts release | Re-grant if accidental |
| Role confusion from a stale client | Old container without runtime header | 401/403 | reject runtime-less agent calls; no env-based fallback | Rebuild the container |
| Delete in-use credential/model | UI delete | 409 | `ON DELETE RESTRICT` + explicit reference list | Disable or rotate instead |

## Security considerations

- **Authentication:** user JWT for admin paths; node access token
  (`X-API-Key`) for supervisor/runtime paths; join tokens are owner-scoped,
  hashed and short-lived.
- **Authorization:** deny-by-default. Every mutating/claiming path resolves the
  runtime from the node credential + `X-Agent-Runtime`, then checks role ∈
  model roles, `(node, project, role)` grant, and project membership. No
  `AGENT_MODE` or client header can elevate a role.
- **Input validation:** Joi schemas; role enums at the edge and CHECK
  constraints in the DB; model ids bounded; ini parser rejects unknown keys.
- **Secrets:** provider secrets encrypted with the existing `ENCRYPTION_KEY`
  path, never returned, never in the supervisor config/argv, redacted from logs
  and audit; runtime fetch is over the authenticated node channel.
- **Audit:** enrollment, grant create/revoke, credential create/rotate/delete
  attempt, model test, runtime state changes, role-denied requests.
- **Rate limiting/abuse:** enroll and model test are rate-limited per owner;
  model test is cost-capped (tiny `max_tokens`, timeout).
- **Data exposure:** config endpoint returns model ids, role tags and endpoints,
  never keys; error messages do not echo secrets or URLs with userinfo.
- **Trust boundary:** a node credential can act for any runtime on that node
  (A5). Per-runtime credentials are `D2`; until then, a compromised node is a
  compromised host, which matches the physical trust model.

## Performance

- Expected load: tens of nodes, tens of runtimes per host, one claim poll per
  runtime per interval.
- Query/index risks: grants lookup by `(node_id, project_id, role)`; runtimes by
  `node_id`; heartbeats should be an upsert, not a scan.
- Reconciliation: O(configured runtimes) with no busy loop; 50 runtimes under
  30 s (`NFR6`).
- Manager jobs: batched `SKIP LOCKED` claims; no full-table scans without an
  index.

## Risks & edge cases

| Risk / edge case | Impact | Mitigation |
|---|---|---|
| Process density in one container | OOM kills all runtimes | per-child heap cap, documented `count × heap` budget, supervisor backoff |
| Renaming `agents`/`assigned_agent_id` touches ~54 references | wide diff, missed call site | mechanical rename slice + grep verification in `03` |
| `PoolManager` still spawns containers | two competing models | pool creation disabled/adapted in the supervisor slice (`D9`) |
| Clean cut breaks old scripts | operator confusion | docs state the cut; no shim by decision |
| Model discovery differs per provider | incomplete lists | manual add + test is authoritative (`FR7`, `FR8`) |
| Reviewer/planner roles have no work yet | idle runtimes | planner ships with the planning API path; reviewers use `review` tickets |
| Advisory lock leak on crash | job starvation | locks are session-scoped and released on disconnect; test reconnect |

## Review focus

The independent reviewer should start here.

| Area | Why it is risky | Reviewer check |
|---|---|---|
| Role/grant middleware | client-asserted role is the bug being fixed | attempt a build claim with a reviewer runtime and no grant; assert 403 + audit |
| Credential rotation + RESTRICT | deletion under use can orphan runtimes | delete/rotate tests; inspect references in the 409 body |
| Supervisor reconcile | double-spawn and orphan children | apply-twice and kill -9 tests; inspect PID set |
| Clean-cut migration | irreversible data loss by design | confirm no backfill, rollback applies, and docs state the cut |
| Manager replicas | duplicate side effects | run two instances against one DB; assert one audit row per item |
| Secret handling | ini/env leakage | grep config, logs, `docker inspect` and process argv |

## Rollout

1. Migration + backend models/services (`056_agent_fleet.sql`).
2. Node enrollment and role/grant enforcement; remove legacy static auth.
3. Credential/model registry, discovery, manual add/test, reference guards.
4. Supervisor mode and the single host Compose stack; disable the old
   container-per-agent path.
5. Manager service in the main Compose stack (start with one replica, then
   scale to two in CI).
6. Frontend fleet/registry screens and docs.
7. Rollback: revert the PR and apply
   `056_agent_fleet_rollback.sql`; there is no data to preserve.

## Open questions

| # | Question | Resolution |
|---|---|---|
| 1 | Reviewer close authority | Comment only for v1; `D10` |
| 2 | Planner publish path | API draft, guarded publish like workers |
| 3 | Grant granularity | Node-level; runtime role narrows |
| 4 | Default build concurrency | 1 |
