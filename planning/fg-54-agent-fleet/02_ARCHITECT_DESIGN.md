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
  endpoint; `provider_models` owns the model id, capability metadata, `roles[]`
  and a default reasoning `effort`. A runtime attaches a model whose roles
  include its role and may override the effort (reviewers can run `max`).
- **Supervisor**: one container per host. It enrolls as the node, fetches its
  resolved configuration, and reconciles child JVMs. The config lists roles,
  model refs, effort and counts — never secrets:

  ```ini
  ; agent.ini — no secrets; fetched config wins over any secret-looking value
  [runtime "workers"]
  role = worker
  model = acme/claude-sonnet
  count = 3
  effort = high

  [runtime "reviewers"]
  role = reviewer
  model = acme/claude-opus
  count = 2
  effort = max
  ```
- **Manager**: a service in the main stack. It owns housekeeping and later
  desired state; replicas coordinate through Postgres locks and
  `FOR UPDATE SKIP LOCKED`.
- **Clean cut**: `agent_runtimes` is a new table and the legacy `agents` table
  is dropped; `agents.project_id`, static `ak_…` auth,
  `agent_enrollment_tokens.project_id/provider_id` and the fused
  `providers.model/roles/is_project_director` columns are removed. No backfill;
  the user approved this in `00`.

### Role capability matrix

| Capability | worker | reviewer | planner |
|---|---|---|---|
| Claim/build tickets | yes | no | no |
| Clone, branch, push, open PR | yes | no (read-only checkout for review) | no |
| Read tickets and PR diffs | granted projects | granted projects | granted projects |
| Post review / findings | no | yes | no |
| Move `review → done` | no | no (D10: comment-only now; bounded small-ticket approval later) | no |
| Draft/publish planning docs | no | no | yes (API-guarded) |
| Reasoning effort | model default, overridable | model default, overridable up to `max` | model default, overridable |
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
  revoked_at TIMESTAMPTZ
);

-- One active grant per tuple; revoked history is retained.
CREATE UNIQUE INDEX agent_node_grants_active
  ON agent_node_grants(node_id, project_id, role)
  WHERE revoked_at IS NULL;

-- Credentials and models
CREATE TABLE provider_credentials (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE, -- NULL = owner-global
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
  -- PG15+: global (NULL project) and project names are unique per owner
  UNIQUE NULLS NOT DISTINCT (owner_id, project_id, name)
);

CREATE TABLE provider_models (
  id BIGSERIAL PRIMARY KEY,
  credential_id BIGINT NOT NULL REFERENCES provider_credentials(id) ON DELETE RESTRICT,
  model VARCHAR(200) NOT NULL,
  display_name VARCHAR(200),
  source VARCHAR(20) NOT NULL CHECK (source IN ('discovered','manual')),
  status VARCHAR(20) NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','verified','disabled')),
  roles TEXT[] NOT NULL DEFAULT '{}'
    CHECK (roles <@ ARRAY['worker','reviewer','planner']::TEXT[]),
  max_tokens INTEGER,
  context_window INTEGER,
  effort VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (effort IN ('minimal','low','medium','high','max')),
  last_verified_at TIMESTAMPTZ,
  last_verify_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (credential_id, model)
);

-- Runtime instances (new table; legacy agents is dropped, not renamed)
CREATE TABLE agent_runtimes (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('worker','reviewer','planner')),
  model_id BIGINT NOT NULL REFERENCES provider_models(id) ON DELETE RESTRICT,
  concurrency INTEGER NOT NULL DEFAULT 1 CHECK (concurrency > 0),
  effort VARCHAR(20)
    CHECK (effort IS NULL OR effort IN ('minimal','low','medium','high','max')), -- NULL = model default
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','draining','stopped')),
  current_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (node_id, name)
);

-- Node join tokens replace project-scoped enrollment tokens
CREATE TABLE agent_node_enrollment_tokens (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_node_enrollment_tokens_uses_check CHECK (used_count <= max_uses)
);

-- Node credentials replace the fg-53 agent token tables
CREATE TABLE agent_node_access_tokens (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_node_refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES agent_nodes(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  replaced_by_id BIGINT REFERENCES agent_node_refresh_tokens(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_node_auth_events (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT REFERENCES agent_nodes(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  ip INET,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_node_access_tokens_prefix
  ON agent_node_access_tokens(token_prefix);
CREATE INDEX idx_agent_node_access_tokens_node
  ON agent_node_access_tokens(node_id, expires_at DESC);
CREATE INDEX idx_agent_node_access_tokens_expiry
  ON agent_node_access_tokens(expires_at) WHERE revoked_at IS NULL;

CREATE INDEX idx_agent_node_refresh_tokens_prefix
  ON agent_node_refresh_tokens(token_prefix);
CREATE INDEX idx_agent_node_refresh_tokens_node
  ON agent_node_refresh_tokens(node_id, expires_at DESC);
CREATE INDEX idx_agent_node_refresh_tokens_expiry
  ON agent_node_refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- Claim marker only; the run lease authority stays harness_leases (fg-33).
ALTER TABLE tickets RENAME COLUMN assigned_agent_id TO assigned_runtime_id;
```

### Migration and FK remap (clean cut)

The migration **creates** `agent_runtimes`; it does not rename `agents`. The
legacy table is removed after its references are detached. No row is carried
over, so the ordering is:

1. Create the new tables and partial indexes above. The `NULLS NOT DISTINCT`
   constraint requires PG15+; the repo runs pg17.
2. Detach every FK that points at `agents(id)`, then rename the column to
   `runtime_id` (or `assigned_runtime_id`). Then **remove every legacy value**
   so a new runtime starting at id 1 cannot inherit an old row: set nullable
   columns to `NULL`, and delete legacy rows where the renamed column is
   `NOT NULL` (`harness_runs`, `harness_leases`, `agent_heartbeats`). Tables: `agent_actions`, `agent_heartbeats`, `usage_logs`,
   `telemetry_events`, `harness_runs`, `harness_leases`, `harness_usage`,
   `repo_profile_validations`, and `tickets.assigned_agent_id`.
3. Append-only exception: `ALTER TABLE harness_events ADD COLUMN runtime_id BIGINT;`
   Do **not** rename, null or delete historical `agent_id` rows (fg-41 owns the
   append-only store).
4. `tickets`: rename to `assigned_runtime_id`, set it to `NULL` (legacy
   assignments cannot be mapped under the clean cut), then add
   `FOREIGN KEY (assigned_runtime_id) REFERENCES agent_runtimes(id) ON DELETE SET NULL`.
5. Drop the fg-53 token/audit tables (`agent_enrollment_tokens`,
   `agent_access_tokens`, `agent_refresh_tokens`, `agent_auth_events`) after
   dropping their internal FKs; the node tables replace them.
6. Drop `agents` (all FKs are gone).
7. Drop `project_providers` and `providers`. Secrets are **not migrated**; the
   registry starts empty and credentials are re-entered.

**Append-only exception:** `harness_events` (fg-41) is deliberately excluded
from the reset. Step 3 only adds a nullable `runtime_id` column for events
written after the cut, so no update or delete touches the append-only store and
the fg-41 trigger/test stay valid.

The rollback recreates the empty legacy tables, renames the columns back and
restores the old FKs. It restores schema only; the clean cut accepts data loss,
which is why `NFR5`/`FR16` test it on a **seeded** database as well as a fresh
one.

- Migration: `backend/src/migrations/056_agent_fleet.sql`
- Rollback: `backend/src/migrations/056_agent_fleet_rollback.sql`
- Backfill: **none** — legacy identities, assignments and provider secrets are
  intentionally discarded (approved clean cut).
- Apply order: after `055_agent_enrollment.sql` in
  `backend/src/migrations/apply.js`.
- Token primitives kept from fg-53: hashed prefixes, refresh rotation and the
  replay cache; the tables are node-scoped.

### Provider replacement

`providers` and `project_providers` are **dropped**, not migrated. The clean cut
means their encrypted secrets and rows are discarded and re-entered through the
registry. Call sites move to `ProviderRegistryService`:

- `ProviderService` and `ProviderRouter` become thin readers of
  `provider_credentials` + `provider_models`; `getForRole` filters by
  `status='verified'` and `role = ANY(roles)`.
- `PoolManager.resolveProviderConfig`/`autoSelectProvider` resolve a verified
  `worker` model from the registry; the container-per-agent path is removed
  (`D9`).
- `providerController`, usage attribution and harness provider resolution read
  the registry; no code path reads `providers.model`, `providers.roles` or
  `is_project_director`.
- Provider secrets reach a runtime only through
  `GET /agent-nodes/:id/runtimes/:runtimeId/provider-config`, which decrypts per
  request, sets `Cache-Control: no-store`, audits the access and never logs the
  value. `GET /agent-nodes/:id/config` stays secret-free.

### Lease authority

There is **one authority per scope**, and fg-54 adds no second expiry column:

| Scope | Authority | Notes |
|---|---|---|
| Run lease (harness) | `harness_leases.expires_at` (fg-33) | existing durable reaper; the only expiry for active runs |
| Claim marker (non-harness pickup) | `tickets.assigned_runtime_id` + `locked_at` | not a lease; stale sweep only when no active run lease exists |
| Ticket completion/release | `TicketService.releaseTicket` | clears the claim; the run reaper owns lease expiry |

The manager's stale sweep runs in one transaction: select stale tickets with
`FOR UPDATE SKIP LOCKED`, skip any with an unexpired `harness_leases` row, and
release the rest. `harness_leases` expiry is left to the fg-33 reaper, so a
ticket cannot be released twice.

## API contract

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/agent-nodes/enroll` | join token | `{token, name, hostname, fingerprint}` | `{node, accessToken, refreshToken}` | 400/401/409/429 |
| GET | `/api/v1/agent-nodes` | JWT `AGENT_READ` | — | nodes owned by the caller, or granted to a project the caller belongs to; super_admin sees all | 403 |
| POST | `/api/v1/agent-nodes/:id/revoke` | JWT `AGENT_REVOKE` + node owner (or super_admin) | — | node + runtimes marked | 403/404/409 |
| POST | `/api/v1/agent-nodes/:id/drain` | JWT `AGENT_REVOKE` + node owner (or super_admin) | — | drain accepted | 403/404 |
| GET | `/api/v1/agent-nodes/:id/grants` | JWT `AGENT_READ` + node access | — | grants | 403/404 |
| POST | `/api/v1/agent-nodes/:id/grants` | JWT `AGENT_CREATE` + node owner + project admin | `{projectId, role}` | grant (reactivates a revoked tuple) | 400/403/404/409 |
| DELETE | `/api/v1/agent-nodes/:id/grants/:grantId` | JWT `AGENT_CREATE` + node owner + project admin; grant must belong to `:id` | — | revoked grant | 403/404 |
| GET | `/api/v1/agent-nodes/:id/config` | node credential, `:id` **must equal** the credential node | `?runtime=` optional | resolved runtimes, models, grants (no secrets) | 401/403/404 |
| POST | `/api/v1/agent-nodes/:id/runtimes` | node credential, `:id` **must equal** the credential node | declared set (`role`, `modelRef`, `count`, `effort?`, `project?`) | upserted runtimes (resolved effort) | 400/401/403/404/409 |
| GET | `/api/v1/agent-nodes/:id/runtimes/:runtimeId/provider-config` | node credential, `:id` **must equal** the credential node + runtime ownership | — | decrypted provider config for one run (no-store, audited) | 401/403/404 |
| POST | `/api/v1/agent-runtimes/:id/heartbeat` | node credential + `X-Agent-Runtime` | `{status, currentProjectId}` | ack | 401/403/409 |
| PATCH | `/api/v1/agent-runtimes/:id` | JWT `AGENT_CREATE` + node access | `{effort?, concurrency?, status?}` | updated runtime | 400/403/404 |
| GET/POST | `/api/v1/provider-credentials` | JWT `PROJECT_MANAGE_MEMBERS` (project) or owner/super_admin (global) | credential fields | list/create (secret masked) | 400/403 |
| PATCH/DELETE | `/api/v1/provider-credentials/:id` | JWT `PROJECT_MANAGE_MEMBERS` + scope | rotation or status | updated/masked | 403/409 |
| POST | `/api/v1/provider-credentials/:id/discover` | JWT `PROJECT_MANAGE_MEMBERS` + scope | — | discovered models (`unverified`) | 400/403/502 |
| POST | `/api/v1/provider-credentials/:id/models` | JWT `PROJECT_MANAGE_MEMBERS` + scope | `{model, displayName?, roles?}` | manual model | 400/403/409 |
| POST | `/api/v1/provider-models/:id/test` | JWT `PROJECT_MANAGE_MEMBERS` + scope | — | `{verified, latencyMs}` | 400/403/502/429 |
| PATCH | `/api/v1/provider-models/:id` | JWT `PROJECT_MANAGE_MEMBERS` + scope | `{roles?, status?, maxTokens?, effort?}` | updated model | 400/403/409 |

No new permission codes are introduced: nodes use `AGENT_READ`,
`AGENT_CREATE`, `AGENT_REVOKE` and `AGENT_DELETE`; the registry reuses
`PROJECT_MANAGE_MEMBERS` exactly like the current provider routes. Node-scoped
routes resolve the presented credential first and reject a mismatched `:id`
with 404 (existence is not leaked).

JWT node mutations are scoped twice. **Node ownership** (`owner_id = caller`,
or `super_admin`) is required for revoke, drain and grant changes; **project
admin** on the grant's project is additionally required to create or delete a
grant. Both are required: a project admin who does not own the node cannot
manage its grants and must ask the node owner (or a super_admin) to create or
remove them. Grant deletion validates `(nodeId, grantId)` and returns 404 for a
foreign pair.

Existing agent endpoints (`/agents/*`, claim/review/planning) keep their paths
but authenticate with the node credential plus the runtime header, and check
the runtime role and project grant before acting.

## Data flow

```
enroll:  join token → AgentNodeEnrollmentService → node + credential pair → supervisor volume
boot:    node credential → GET /agent-nodes/:id/config → validate roles/model/grant
spawn:   supervisor → child JVM (AGENT_RUNTIME_ID, role, model) → heartbeat
claim:   runtime → POST claim(project, role) → grant + role check → ticket claim marker + harness lease
run:     runtime → fetch repo token + provider config → harness → publish → release
revoke:  UI → grant/runtime revoked → next heartbeat 403 → runtime drains, releases claim and lease
```

## Failure modes and recovery

| Failure mode | Trigger | Detection | Mitigation / test | Operator action |
|---|---|---|---|---|
| Join token exhausted or expired | Token reused / TTL passed | 401/409 at enroll | single-use default, TTL; test asserts no node row | Mint a new token |
| Node credential lost | Volume deleted | 401 on config/heartbeat | re-enroll; credential store 0600; no secrets in config | Restore the volume or re-enroll |
| Supervisor crash mid-spawn | OOM/kill | children orphaned | PID tracking, startup sweep, deterministic names; kill -9 test | Restart the stack |
| Partial reconcile | Backend down at boot | config fetch fails | retry with backoff, keep current children, no destructive action | Check backend reachability |
| Model unverified | Attached before test | runtime creation 409 | attach requires `verified`; test records error | Run the test button |
| Unsupported effort value | Provider has a lower ceiling or a different field | adapter maps/clamps | map canonical → provider; clamp and log at `debug`; unknown canonical value is 400 | Pick a supported value |
| Credential rotation during a run | Rotation while runtimes are live | version change | runtimes resolve per run; rotation keeps model refs | None; next run uses the new secret |
| Duplicate manager work | Two replicas tick together | duplicate audit rows | advisory lock + `SKIP LOCKED`; two-replica test | None |
| Grant revoked mid-lease | Admin revokes a grant | 403 on next heartbeat | runtime releases the claim then drains; test asserts release | Re-grant if accidental |
| Node reads another node's config | Credential presents a foreign `:id` | 404/403 | credential-to-`:id` binding in `agentNodeAuth`; test asserts 404 | None |
| Double release by the manager | Ticket lock and run lease both expire | duplicate release/audit | single authority: skip tickets with an unexpired `harness_leases` row; `SKIP LOCKED`; concurrency test | None |
| Re-grant after revoke | `revoked_at` set, same tuple inserted | unique violation | partial unique index on active grants; re-grant clears `revoked_at` (upsert) | None |
| Cross-owner grant change | Non-owner project admin targets a node or a foreign `grantId` | 403/404 | ownership + project-admin checks; `(nodeId, grantId)` binding; FR21 test | None |
| Seeded migration destroys legacy rows | Clean-cut drop/reset | expected data loss | documented; the seeded test asserts **no legacy id remains** in any `runtime_id`/`assigned_runtime_id` and no row matches a new runtime | Restore from backup only if needed |
| Role confusion from a stale client | Old container without runtime header | 401/403 | reject runtime-less agent calls; no env-based fallback | Rebuild the container |
| Delete in-use credential/model | UI delete | 409 | `ON DELETE RESTRICT` + explicit reference list | Disable or rotate instead |

## Security considerations

- **Authentication:** user JWT for admin paths; node access token
  (`X-API-Key`) for supervisor/runtime paths; join tokens are owner-scoped,
  hashed and short-lived.
- **Authorization:** deny-by-default. Every mutating/claiming path resolves the
  runtime from the node credential + `X-Agent-Runtime`, then checks role ∈
  model roles, `(node, project, role)` grant, and project membership. Node-scoped
  routes bind `:id` to the presented credential (404 on mismatch); node lists are
  scoped to owned nodes or projects the caller belongs to. No `AGENT_MODE` or
  client header can elevate a role.
- **Input validation:** Joi schemas; role enums at the edge and CHECK
  constraints in the DB; model ids bounded; ini parser rejects unknown keys.
- **Secrets:** provider secrets encrypted with the existing `ENCRYPTION_KEY`
  path, never returned by list/read routes, never in the supervisor config/argv,
  redacted from logs and audit. The only plaintext delivery is the per-runtime
  `provider-config` endpoint (node credential + runtime ownership, `no-store`,
  audited, not logged).
- **Audit:** enrollment, grant create/revoke, credential create/rotate/delete
  attempt, provider-config read, model test, runtime state changes, role-denied
  and node-binding-denied requests.
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
| Dropping `agents` and renaming `assigned_agent_id` touches ~54 references | wide diff, missed call site or FK | ordered detach/list in `02`; grep verification and seeded migration test in `03` |
| `PoolManager` still spawns containers | two competing models | pool creation disabled/adapted in the supervisor slice (`D9`) |
| Clean cut breaks old scripts | operator confusion | docs state the cut; no shim by decision |
| Model discovery differs per provider | incomplete lists | manual add + test is authoritative (`FR7`, `FR8`) |
| Reviewer/planner roles have no work yet | idle runtimes | planner ships with the planning API path; reviewers use `review` tickets |
| `max` effort increases spend | higher cost per run | surface resolved effort in usage; fg-38 budgets cap it |
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

Product decisions (reviewer authority, planner publish path) live in **`00` →
Decisions needed from the user**; no design questions remain. Default
concurrency and grant granularity are captured in `01` → Open questions.
