# 02 — Design (fg-53)

> **Owns:** current-state audit, chosen design, data model, contracts, risks,
> rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), exact file
> operations (`04`), status and deferrals (`00`).

## Current state (the only infrastructure audit)

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Backend route/controller/service | yes | `backend/src/api/agents.js`, `backend/src/services/AgentService.js`, `backend/src/middleware/auth.js` | Create/rotate/revoke only; no join token or enrollment; heartbeat bypasses expiry |
| Database table/column | yes | `backend/src/migrations/035_global_providers.sql` (agents), `backend/src/migrations/009_project_providers.sql` | `agents` has `api_key_hash`, `api_key_hash_prefix`, `api_key_expires_at` and `owner_id`, but no `project_id`; no enrollment/access/refresh tables |
| Frontend API client | yes | `frontend/src/api/agents.ts`, `frontend/src/views/AgentList.vue`, `AgentDetail.vue`, `ComputeNodes.vue` | Create shows no key; no mint/list/revoke enrollment token UI |
| Frontend view/component/route | yes | `frontend/src/views/AgentList.vue`, `AgentModal.vue`, `ComputeNodes.vue` | No enrollment surface; global agents page has no project selector |
| Agent code | yes | `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java`, `AgentApp.java`, `service/ApiService.java` | Requires `AGENT_ID` + `AGENT_API_KEY`; sends `X-API-Key`; no enroll/refresh |
| Tests | yes | `backend/src/__tests__/api-agent-auth.test.js`, `agentProviderConfig.test.js`, `agent/src/test/...` | No enrollment/refresh/concurrency coverage; heartbeat expiry gap not tested |

**Key insight:** extend the existing agent-key auth instead of building a new
auth stack. Keep `X-API-Key`, dispatch on token prefix, and reuse the existing
permissions, project membership checks and agent rate-limit middleware.

## Design summary

Two credentials are added:

- **Join token** (`enr_…`): created by a project admin, short TTL, single-use
  by default, project-scoped, optional provider. Only its hash and lookup
  prefix are stored.
- **Node credentials** (`at_…` access + `ar_…` refresh): issued by enrollment.
  The access token is short-lived and used as the existing `X-API-Key`. The
  refresh token is stored on the node with mode `0600` and rotated on every
  use. Refresh calls carry an `Idempotency-Key`; the same key returns the same
  pair from the encrypted replay cache, while a different/absent key on a
  rotated token is treated as reuse. The agent coalesces timer and 401
  refresh triggers into one in-flight request per agent, so two independent
  keys can never race.
- **Project scope:** enrollment writes the join token's project to
  `agents.project_id`. That column, not the token row and not the agent's
  `PROJECT_ID` env, is authoritative for agent authorization. Legacy `ak_…`
  agents keep `project_id = NULL` and remain owner-scoped during rollout.

```
Admin/UI
  POST /agent-enrollment/tokens
    -> raw enr_ returned once; hash + prefix stored (project, provider, TTL, max_uses)

Node first boot (ENROLLMENT_TOKEN + volume)
  POST /agent-enrollment/enroll { token, name, node metadata }
    -> lock/validate join token, consume one use, insert agent with
       project_id = token.project_id, issue at_ + ar_; return them once
    -> agent writes { agentId, projectId, refreshToken, accessToken, exp }
       to credentials file (0600)

Normal requests
  X-API-Key: at_... -> middleware prefix dispatch -> agent_access_tokens
    -> expiry/revocation -> req.agent { id, owner_id, provider_id, project_id }

Refresh
  POST /agent-enrollment/refresh { refresh_token, idempotency_key }
    -> lock ar_; first use marks it rotated, inserts new at_ + ar_ (same family)
       and stores the encrypted response keyed by (refresh_token_id, key)
    -> retry with the same key inside AGENT_REFRESH_REPLAY_CACHE_SECONDS:
       return the stored pair (no second rotation, family stays valid)
    -> rotated token with a different/absent key: revoke family + audit reuse

Revoke
  agent delete / key revoke -> revoke all at_/ar_/legacy tokens; 401 thereafter
```

Legacy `ak_…` keys continue on the existing path. If an agent has no
`AGENT_ID`/`AGENT_API_KEY`, it can enroll; if it has a credential file, that
wins; a static key wins over an enrollment token unless
`AGENT_AUTH_MODE=enroll` is explicit.

## Alternatives considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| A · Static agent key only | Smallest change; reuses everything | No self-registration; key shown once; long-lived; no rotation unless manual | Rejected |
| B · Join token + static agent key | Unblocks enrollment with minimal auth change | Still long-lived; no expiry/refresh story; replay risk | Rejected as the target; useful as a fallback phase |
| C · Join token + short access + rotating refresh | One-time bootstrap; short exposure; revocation; auditable | More code and a new token table/middleware path | **Chosen** |
| D · mTLS/SPIFFE identity | Strongest node identity; no bearer secrets | Certificate issuance/rotation/CA and agent TLS work | Deferred (`00` D2) |

## Data model & migrations

Migration `backend/src/migrations/054_agent_enrollment.sql` (+
`054_agent_enrollment_rollback.sql`):

```sql
CREATE TABLE agent_enrollment_tokens (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_enrollment_tokens_prefix ON agent_enrollment_tokens(token_prefix);
CREATE INDEX idx_agent_enrollment_tokens_project ON agent_enrollment_tokens(project_id, created_at DESC);
CREATE INDEX idx_agent_enrollment_tokens_expiry ON agent_enrollment_tokens(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE agent_access_tokens (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_access_tokens_prefix ON agent_access_tokens(token_prefix);
CREATE INDEX idx_agent_access_tokens_agent ON agent_access_tokens(agent_id, expires_at DESC);
CREATE INDEX idx_agent_access_tokens_expiry ON agent_access_tokens(expires_at);

CREATE TABLE agent_refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_prefix VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  replaced_by_id BIGINT REFERENCES agent_refresh_tokens(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_refresh_tokens_prefix ON agent_refresh_tokens(token_prefix);
CREATE INDEX idx_agent_refresh_tokens_agent ON agent_refresh_tokens(agent_id, created_at DESC);
CREATE INDEX idx_agent_refresh_tokens_family ON agent_refresh_tokens(family_id, created_at DESC);
CREATE INDEX idx_agent_refresh_tokens_expiry ON agent_refresh_tokens(expires_at);

CREATE TABLE agent_refresh_replays (
  id BIGSERIAL PRIMARY KEY,
  refresh_token_id BIGINT NOT NULL REFERENCES agent_refresh_tokens(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL,
  response_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (refresh_token_id, idempotency_key)
);
CREATE INDEX idx_agent_refresh_replays_expiry ON agent_refresh_replays(expires_at);

CREATE TABLE agent_auth_events (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  actor_type VARCHAR(16) NOT NULL DEFAULT 'system',
  actor_id VARCHAR(64),
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_auth_events_project ON agent_auth_events(project_id, created_at DESC);
CREATE INDEX idx_agent_auth_events_agent ON agent_auth_events(agent_id, created_at DESC);
CREATE INDEX idx_agent_auth_events_created ON agent_auth_events(created_at);

ALTER TABLE agents
  ADD COLUMN project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN enrollment_token_id BIGINT REFERENCES agent_enrollment_tokens(id) ON DELETE SET NULL,
  ADD COLUMN enrolled_at TIMESTAMPTZ,
  ADD COLUMN node_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN last_enrolled_ip INET;
CREATE INDEX idx_agents_project_id ON agents(project_id);
```

- Migration: additive only. No backfill required; existing agents remain
  `project_id = NULL`, `enrollment_token_id = NULL`, `enrolled_at = NULL`,
  `node_metadata = '{}'`. Enrolled agents always get `project_id`; legacy
  agents stay owner-scoped and are covered by `00` D11.
- Project scope is stored on `agents`, not derived from
  `agents.enrollment_token_id`, so the retention purge's `ON DELETE SET NULL`
  cannot widen or erase an agent's project.
- Rollback: drop the new columns then the tables (child before parent:
  `agent_auth_events`, `agent_refresh_replays`, `agent_refresh_tokens`,
  `agent_access_tokens`, `agent_enrollment_tokens`); legacy agent columns
  untouched.
- Apply order: append after `053_harness_privacy.sql` in
  `backend/src/migrations/apply.js`.
- Cleanup: a daily job deletes expired/revoked token rows older than the
  retention window (`AGENT_TOKEN_RETENTION_DAYS`, default 30), using the
  `expires_at` indexes; `agent_refresh_replays` is purged by its short TTL
  (`AGENT_REFRESH_REPLAY_CACHE_SECONDS`, default 60); `agent_auth_events`
  keeps a longer window (`AGENT_AUTH_EVENT_RETENTION_DAYS`, default 180) and
  is indexed by `created_at`.

### Token formats

| Token | Prefix | Entropy | TTL default | Storage |
|---|---|---|---|---|
| Join | `enr_` | 32 random bytes, base64url | 15 min (`AGENT_ENROLLMENT_TOKEN_TTL_SECONDS=900`) | SHA-256 hash + first 12 chars |
| Access | `at_` | 32 random bytes, base64url | 60 min (`AGENT_ACCESS_TOKEN_TTL_SECONDS=3600`) | SHA-256 hash + first 12 chars |
| Refresh | `ar_` | 32 random bytes, base64url | 30 days (`AGENT_REFRESH_TOKEN_TTL_DAYS=30`) | SHA-256 hash + first 12 chars |

High entropy makes a fast hash acceptable; `00` D4 records an HMAC/KMS pepper
as a follow-up. Tokens are compared with `crypto.timingSafeEqual` on the hash.

Refresh replay is handled by an idempotency key and an encrypted replay cache
with a short TTL (`AGENT_REFRESH_REPLAY_CACHE_SECONDS`, default 60). The cache
returns the same pair only for the same `(refresh_token_id, idempotency_key)`;
a different/absent key on a rotated token is reuse and revokes the family. The
`Idempotency-Key` is a 128-bit random value generated per refresh attempt and
reused only for that attempt's retries; it is not derived from the token.

## API contract

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/agent-enrollment/tokens` | JWT + `AGENT_CREATE` + project membership | `{ project_id, name, ttl_seconds?, max_uses?, provider_id? }` | `{ success, data: { id, name, project_id, provider_id, token, expires_at, max_uses } }` — `token` once | 400 validation, 403 permission/project, 404 project/provider |
| GET | `/api/v1/agent-enrollment/tokens?project_id=` | JWT + `AGENT_READ` + membership | — | `{ success, data: [{ id, name, provider_id, max_uses, used_count, expires_at, revoked_at, created_at }] }` | 403 |
| DELETE | `/api/v1/agent-enrollment/tokens/:id` | JWT + `AGENT_REVOKE` + membership | — | `{ success, data: { id, revoked_at } }` | 404, 403 |
| POST | `/api/v1/agent-enrollment/enroll` | join token in body | `{ token, name, node_metadata? }` | `{ success, data: { agent_id, project_id, provider_id, access_token, refresh_token, access_expires_at, refresh_expires_at } }` | 400 validation, 401 generic invalid/expired/exhausted, 429 rate limit |
| POST | `/api/v1/agent-enrollment/refresh` | refresh token + idempotency key in body | `{ refresh_token, idempotency_key }` | same credential pair as enroll; the same key returns the identical pair | 400 `IDEMPOTENCY_KEY_REQUIRED`, 401 `REFRESH_TOKEN_INVALID`, 401 `REFRESH_TOKEN_REUSED`, 429 |
| GET | `/api/v1/agent-enrollment/agents/:agentId` | JWT + `AGENT_READ` + membership | — | `{ project_id, enrolled_at, enrollment_token_id, node_metadata, auth_mode }` (no secrets) | 403/404 |

Existing `POST /api/v1/agents/create`, `POST /agents/:id/rotate-key`,
`GET /agents/:id/key`, `DELETE /agents/:id` remain. The key-preview endpoint is
either fixed to report `unavailable` honestly or removed from the UI; raw keys
are never recoverable.

Error codes: `ENROLLMENT_TOKEN_INVALID`, `ENROLLMENT_TOKEN_EXPIRED`,
`ENROLLMENT_TOKEN_EXHAUSTED`, `REFRESH_TOKEN_INVALID`,
`REFRESH_TOKEN_REUSED`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `TLS_REQUIRED`,
`RATE_LIMITED`. Enrollment/refresh failures intentionally collapse
invalid/expired/revoked into one generic 401 to avoid prefix probing; the
audit event records the precise reason.

## Data flow

```
Mint:
  JWT -> requireAnyPermission(AGENT_CREATE) -> project membership
      -> AgentEnrollmentService.mint() -> INSERT token hash
      -> return raw token once

Enroll:
  enr_ -> hash/prefix lookup FOR UPDATE
       -> check revoked/expiry/uses -> UPDATE used_count+1
       -> resolve project owner + provider -> INSERT agents
       -> INSERT at_/ar_ -> COMMIT
       -> agent persists ar_ + at_ (0600)

Request:
  X-API-Key: at_ -> prefix lookup -> hash compare -> expiry/revoked
      -> req.agent { id, owner_id, provider_id, project_id }
      -> project-scoped route asserts ticket/credential project == project_id
         (legacy agents with project_id NULL keep the owner-scoped check)

Refresh:
  ar_ + Idempotency-Key -> lookup FOR UPDATE
      -> if not rotated: mark rotated + insert new pair (same family) +
         store encrypted response keyed by (refresh_token_id, key) -> COMMIT
      -> if rotated and the same key has an unexpired replay row:
         decrypt + return the identical pair; audit refresh_replay_cache_hit
      -> if rotated with a different/absent key: revoke family + audit reuse
```

## Failure modes and recovery

| Failure mode | Trigger | Detection | Mitigation / test | Operator action |
|---|---|---|---|---|
| Join token expired/revoked/used | TTL, admin revoke, max_uses reached | Generic 401; audit reason | Validation tests; no agent rows on failure | Mint a new token |
| Concurrent enroll | Two nodes use a 1-use token | One 201, one 401; DB row lock test | `SELECT ... FOR UPDATE` + conditional update | None |
| Partial enroll | DB error between agent and token inserts | Integration test finds no rows | Single transaction; rollback | Retry with the same token only if the transaction rolled back |
| Refresh reuse with a different/absent key | Stolen/replayed rotated token without the original idempotency key | `REFRESH_TOKEN_REUSED` audit; family revoked | Rotation + negative theft test | Re-enroll the node with a new join token |
| Concurrent refresh / lost response | Two requests with the same key, or a retry after the response was lost | One rotation commits; the replay row returns the identical pair | Family stays valid; the winner's access token still works; `refresh_replay_cache_hit` audit | None; the agent reuses its idempotency key |
| Client timer/401 race | Timer refresh and 401 refresh start together | AgentAuthManager coalesces to one in-flight request | Single key; both callers await the same result; no family revoke | None |
| Replay cache expiry | Retry arrives after `AGENT_REFRESH_REPLAY_CACHE_SECONDS` | Token is rotated and no replay row remains | Bounded retry window; agent re-enrolls if the response was truly lost | Mint a new join token |
| Agent requests another project | Enrolled agent sends a ticket/credential request for a different project | 403 from the project-scope assertion | `agents.project_id` is authoritative; legacy NULL agents unchanged; cross-project tests | None |
| Agent clock skew | Node clock ahead/behind | Early expiry/refresh loops | Server returns absolute `expires_at`; use DB `NOW()`; refresh margin | Fix clock/NTP |
| Credential file lost | Volume not mounted/recreated | Agent exits with `NO_CREDENTIALS` | Document volume; re-enroll with a new token | Mount a persistent volume |
| Backend unavailable | Network/outage | Refresh/enroll retries exhausted | Bounded backoff; exit non-zero; supervisor restarts | Restore network; new token only if refresh TTL expired |
| Revoked agent keeps running | Admin delete/revoke | 401 on next call; heartbeat fails | Revocation cascade test; agent exits after failed refresh | Re-enroll or remove the container |
| Token table growth | Many short-lived tokens | Retention metrics/job logs | Retention purge; indexes | Adjust retention |
| Plain-HTTP enrollment | Misconfigured proxy | `TLS_REQUIRED` | TLS check test; runbook | Enable TLS or explicit dev flag |

## Security considerations

- **Authentication:** join/access/refresh tokens are bearer secrets. Access
  tokens use `X-API-Key`; enrollment/refresh bodies are POST-only, never URLs.
  TLS is required outside loopback unless `ALLOW_INSECURE_AGENT_ENROLLMENT=1`.
- **Authorization:** mint/list/revoke use existing `AGENT_CREATE` /
  `AGENT_READ` / `AGENT_REVOKE` plus project membership. Join tokens are bound
  to one project and optional provider; the enroll request cannot override
  them. Enrollment writes that project to `agents.project_id`; agent auth
  loads it into `req.agent.project_id`, and ticket/credential routes assert
  the requested project matches before the existing owner/member checks. The
  check runs before any `project_admin`/`super_admin` owner bypass, so an
  enrolled agent cannot use its owner's wider role. `PROJECT_ID` on the agent
  is a bootstrap hint only and is never trusted for authorization. The
  assertion is applied to every agent-authenticated project-scoped route:
  ticket read/write/status/messages/phases/planning and harness leases/runs
  resolve the ticket project, while GitHub repo/token routes use `:projectId`. The
  credential decrypt route is JWT-only today, so an agent cannot reach it; if
  it is opened to agents it must use the same assertion.
- **Project-scoped agent route inventory (exhaustive for current project routes):**

  | Route group | Project source | Enforcement |
  |---|---|---|
  | `POST /tickets`, `POST /projects/:id/tickets` | body `projectId` / `:id` | assert before `TICKET_CREATE` and create |
  | `GET /tickets/project/:projectId`, `/backlog` | `:projectId` | assert |
  | `GET /tickets/:ticketId` | ticket project | assert in `TicketService.getOne`/controller |
  | `PUT /tickets/:ticketId`, `POST /status`, `/pickup`, `/release` | ticket project | assert before owner/admin checks |
  | `GET/POST /tickets/:ticketId/messages`, `GET /phases`, `/phases/current`, `/phases/allowed`, `POST /phases/transition`, `GET /review/diff` | ticket project | assert |
  | `GET /tickets/:ticketId/planning`, `/planning/:fileKey` | ticket project | assert |
  | `POST /tickets/:ticketId/review/local-diff` | ticket project | assert |
  | `GET /github/:projectId/repo/agent`, `POST /github/:projectId/token` | `:projectId` | assert |
  | `GET /projects/:projectId/repo-profile/agent`, `/agent/mtls`, `POST /validations/claim`, `/validations/:id/finish` | `:projectId` | assert |
  | `POST /harness/runs`, `GET /runs/:runId`, `POST /runs/:runId/{publish,reconcile,dead-letter,adopt,release-ticket,checkpoints,heartbeat,finish}`, `GET /runs/:runId/checkpoints` | run → project | assert the run belongs to the agent's project |
  | `GET /harness/tickets/:ticketId/run`, `POST /harness/leases`, `POST /leases/:ticketId/renew`, `DELETE /leases/:ticketId` | ticket project | assert |
  | `GET /harness/agents/:agentId/runs`, `/workspaces` | self-scoped | require `req.agent.id === :agentId` |
  | `POST /harness/events`, `POST/GET /harness/runs/:runId/usage`, `GET /runs/:runId/{events,timeline}` | run → project | assert run/project matches |
  | `POST /agents-status/:id/heartbeat`, `GET /agents/:agentId/provider-config/changed` | self-scoped | shared agent auth expiry/revocation; existing self check; no project data |

  Agent-management routes under `/agents` are owner-scoped configuration, not
  project data; their existing permission/ownership checks remain. JWT-only
  routes today (comments, attachments, deployments, milestones,
  memory, ticket delete, GitHub branch/PR, planning writes) are not
  agent-authenticated and need no assertion; if any is opened to agents it
  must use the same helper. New agent routes must be added to this table.
- **Input validation:** Joi schemas bound name (1–100), TTL (60–86400 s),
  max uses (1–100), provider existence, metadata size (≤4 KiB, JSON object),
  token length/prefix. Reject unknown fields.
- **Secrets:** hash-only storage; raw tokens leave the API only on issuance or
  the matching idempotent refresh retry; the replay cache stores the response
  encrypted with `ENCRYPTION_KEY`, TTL-bounded and excluded from logs/audit
  metadata; credential file `0600` atomic write; redact token shapes in logs,
  errors, prompts and audit metadata; never put tokens in argv or Docker env
  after enrollment.
- **Audit:** append-only `agent_auth_events` for mint/revoke/enroll/refresh/
  reuse/expiry/revocation with actor, project, agent, IP and reason code.
- **Rate limiting / abuse:** per-IP and per-prefix limits on enroll/refresh;
  generic failures; `max_uses` atomic; a project-level cap on active agents
  and tokens (configurable).
- **Data exposure:** list/detail endpoints never return hashes; node metadata
  is untrusted display data; error messages avoid confirming a prefix exists.
- **Privilege boundaries:** a compromised worker can only act as its own
  agent; it cannot mint tokens or enroll other nodes. A stolen join token is
  short-lived/single-use and revocable.

## Performance

- Expected load: tens of enrollments per project; refreshes roughly
  `active_agents / access_ttl` (e.g., 100 agents × 1/h = 100/h).
- Indexed lookups on `token_prefix`; hash comparison after prefix match.
- No full scans; no `SELECT *` over agents for auth.
- Targets: enroll p95 < 250 ms, refresh p95 < 100 ms at 10× expected load;
  the load test covers 100 enrollments and 1,000 refreshes.
- Rate limits keep abusive bursts from reaching the DB; retention keeps
  tables bounded.

## Observability

- Counters: `agent_enrollment_total{result}`, `agent_refresh_total{result}`
  (`rotated`, `replay_cache_hit`, `reuse`, `invalid`), and
  `agent_auth_failures_total{reason}`.
- Histograms: `agent_enrollment_duration_ms`, `agent_refresh_duration_ms`.
- Labels are bounded (result/reason enumerations); no token, prefix, agent
  name or IP is used as a label.
- The metrics module is `backend/src/metrics.js`; tests assert each counter
  increments for the success, replay-cache-hit, reuse and failure paths.

## Risks & edge cases

| Risk / edge case | Impact | Mitigation |
|---|---|---|
| Token hash pepper/KMS not implemented | Offline DB dump could brute-force low-entropy tokens; our tokens are 256-bit random | 256-bit entropy; D4 follow-up |
| Agent recreated without a volume | Re-enrollment needs a new one-time token | Document volume; credential-file check test |
| Multiple API instances rate limits | Per-instance limits can be bypassed | D6 distributed limiter; single-instance default |
| Clock skew between node/API | Premature refresh or 401 loops | Absolute expiry, refresh margin, retry with backoff |
| `X-API-Key` prefix collision (`at_` vs legacy) | Wrong dispatch | Prefix is explicit and tested; legacy keys are `ak_` |
| Provider deleted after token minted | Enrollment creates agent with NULL provider | Token stores provider_id; `ON DELETE SET NULL`; agent falls back to env or fails clearly |
| Project owner changes | Enrolled agents owned by old owner | Document; project ownership transfer follow-up |
| Replay-cache compromise | The short-lived encrypted pair could leak | Cache TTL is 60 s, rows are encrypted and purged; a different/absent key revokes the family |
| Agent project scope | A compromised worker targets another project | Server-side `agents.project_id` checked on every ticket/credential route; client `PROJECT_ID` ignored; cross-project tests |
| Static key and credential file both present | Wrong identity | Precedence rules + `AGENT_AUTH_MODE` override; test |
| Reverse proxy misreports HTTPS | False TLS acceptance/rejection | `trust proxy` config; `X-Forwarded-Proto` test |

## Review focus

| Area | Why it is risky | Reviewer check |
|---|---|---|
| Token dispatch in `middleware/auth.js` | A prefix bug can bypass auth or lock out legacy agents | Unit tests for `at_`, `ar_`, `enr_`, `ak_`, malformed and expired tokens; `file:line` |
| Agent project scope | Owner-scoped checks could let a worker cross projects | Cross-project ticket/credential tests with an owner who is also a member/admin; `agents.project_id` loaded into `req.agent` |
| Enrollment transaction | Partial agent/token rows or double-use | Concurrency integration test; inspect `FOR UPDATE`/conditional update |
| Refresh rotation/reuse | Stolen refresh token must not mint indefinitely, while same-request retries must not lock out the node | Same-key returns the same pair; different/absent key revokes the family; concurrent/lost-response tests |
| Heartbeat expiry | Existing hole could make expired agents appear online | `agentHeartbeat.js` uses the shared auth helper; test expired key |
| Agent credential file | Token leakage or lost credentials | Permission/atomic-write test; no log assertions |
| TLS check | Plain HTTP would expose bearer tokens | Test non-loopback HTTP rejection + dev flag |
| Rate limiting | Token probing/enumeration | Burst tests; generic error assertions |
| Backward compatibility | Existing agents must not break | Legacy auth suite + feature flag off |

## Rollout

1. **Migration** — apply `054_agent_enrollment.sql` (additive; legacy keys
   untouched).
2. **Backend behind a flag** — `AGENT_ENROLLMENT_ENABLED=false` by default in
   production; enable in staging/dev after TLS is configured. Mint/list/revoke
   and enroll/refresh return 404 when disabled (chosen over 403/503 so the
   feature is not advertised); test the flag-off response.
3. **Middleware** — ship dual auth for `at_…` and `ak_…`; enforce expiry on
   heartbeat. Legacy agents continue unchanged.
4. **Agent image** — add enrollment + credential store + refresh; static
   mode remains the default when `AGENT_ID`/`AGENT_API_KEY` are set. Publish a
   new image tag; do not change existing deployments automatically.
5. **UI** — add the mint/list/revoke section for project admins; display the
   raw token once. Hide it when the flag is off.
6. **Pilot** — mint a token for a test project, deploy one remote worker with
   `ENROLLMENT_TOKEN` and a persistent volume, verify heartbeat, a ticket
   pickup and a refresh; then enable for other projects.
7. **Pool agents** — move PoolManager to the new credential path or extend its
   static key lifetime + renewal (FR15); verify a >24h run.
8. **Rollback** — set `AGENT_ENROLLMENT_ENABLED=false`, revoke outstanding
   tokens, redeploy the previous agent image; legacy keys still work. Schema
   rollback (drop new tables/columns) is safe after revoking tokens and
   stopping enrollment.

## Open questions

| # | Question | Resolution |
|---|---|---|
| 1 | Should enrollment be exposed when `AGENT_ENROLLMENT_ENABLED=false`? | Return 404 to avoid advertising the feature; test it. |
| 2 | Should `/agents/:id/key` be fixed or removed? | Mark it `keyPreview: unavailable` and stop calling it; raw keys are never recoverable. |
| 3 | Should join-token mint require `PROJECT_ADMIN` specifically? | Reuse `AGENT_CREATE` + project membership; project_admin has it; add a specific permission only if the role matrix requires it. |
| 4 | Are pool agents migrated in this ticket? | Yes for FR15; if implementation is sliced, use a configurable 30-day key + renewal first and move to refresh tokens in a follow-up (record in `00` if deferred). |
