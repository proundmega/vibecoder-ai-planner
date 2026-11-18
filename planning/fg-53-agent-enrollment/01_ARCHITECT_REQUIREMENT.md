# 01 — Requirement (fg-53)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

A new worker host cannot join without an operator creating an agent in the UI
and copying a one-time, long-lived API key to it:

1. `AgentConfig` requires `AGENT_ID` and `AGENT_API_KEY`; there is no join
   credential or enrollment endpoint.
2. `POST /agents/create` requires a human JWT with `AGENT_CREATE`; the raw key
   is returned once and the UI discards it (`AGENT-1`).
3. The only fully automated path is PoolManager, which creates the DB record
   and injects the key; it works only where the API controls Docker/SSH, not on
   an arbitrary worker host.
4. Agent key expiry is inconsistent: middleware rejects expired keys, but the
   heartbeat route uses `AgentService.getAgentByApiKey()` without checking
   `api_key_expires_at` (`AUTH-3`).
5. Pool agents receive one-day keys (`keyExpiryDays: 1`) with no renewal path.
6. User access is a 30-minute JWT only; `.env`/README say
   `TOKEN_EXPIRY_HOURS=24`, but `backend/src/auth.js` reads
   `TOKEN_EXPIRY_MINUTES` (default 30). There are no scoped user/CI tokens.

The observable result: remote workers need manual secret handling, a lost key
means a rotate-key API call, and an “online” agent can be authenticated only
for heartbeats while every real call fails with `KEY_EXPIRED`.

## Goals

1. Let a project admin mint a **one-time, project-scoped join token** with a
   short TTL and an optional provider.
2. Let a fresh node exchange that join token for its **own** short-lived access
   token and a rotating refresh token.
3. Persist node credentials securely on the node and refresh them without
   operator action.
4. Enforce expiry and revocation consistently on every agent path.
5. Keep existing static agent keys working during rollout.
6. Make enrollment auditable, rate-limited, project-scoped and safe over TLS.
7. Give operators a minimal UI/API to mint, inspect and revoke join tokens.
8. Leave a clean path to mTLS and multi-host scheduling (deferred).

## Non-goals

- User personal access tokens/CI tokens (deferred, `00` D1).
- OAuth/OIDC provider integration for users.
- mTLS/SPIFFE node identity (deferred, `00` D2).
- Multi-host scheduling and remote Docker/SSH control (fg-40/fg-43).
- Replacing PoolManager or changing how it picks providers.
- Storing or displaying raw agent tokens after issuance.
- Automatic migration of existing `ak_…` agents (deferred, `00` D8).

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence | State |
|---|---|---|---|---|
| A1 | Join/access/refresh tokens are high-entropy random values, so a SHA-256 hash plus a lookup prefix is sufficient for at-rest protection | A fast hash would be brute-forceable; need bcrypt/HMAC or a KMS pepper | Token = 32 random bytes; security review; `00` D4 | open |
| A2 | Nodes can persist a small credential file on a mounted volume | Re-enrollment requires a new one-time token after every restart | Agent credential-store test; deployment docs | open |
| A3 | Remote enrollment can require TLS; local testing may opt out with an explicit flag | Sending bearer tokens over plain HTTP exposes them | `NFR3`/`FR14` tests; reverse-proxy runbook | open |
| A4 | Existing static `ak_…` keys remain supported for at least one release | Forced migration would break running agents | Backward-compatibility tests; `FR9` | open |
| A5 | The project owner is an acceptable owner for enrolled agents | Agents may disappear from the creator’s agent list; ownership transfer becomes a project operation | Mirrors PoolManager; `FR3` test | open |
| A6 | Reusing `X-API-Key` for access tokens does not break existing agent clients | A new header would require agent and proxy changes | Middleware prefix dispatch; `FR4` | open |
| A7 | PostgreSQL row locks/conditional updates provide enough concurrency control for single-use tokens | Concurrent enrollments could exceed `max_uses` | `FR13` integration test | open |
| A8 | The server-side `agents.project_id` is the authoritative project scope; the agent's `PROJECT_ID` env is only a bootstrap hint | A compromised worker could act across the owner's projects | `FR3`/`NFR2` cross-project tests | open |

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | An authorized user can mint a join token for a project with a name, TTL, max uses and optional provider. The raw token is returned exactly once; only a hash and lookup prefix are stored. | `POST /api/v1/agent-enrollment/tokens` returns 201 with the raw token once; list/detail responses never contain it or its hash; invalid project/provider/permission is rejected. |
| FR2 | Project admins can list join-token metadata and revoke a token. | `GET .../tokens?project_id=` returns id/name/provider/max_uses/used_count/expires_at/revoked_at and no secret; `DELETE .../tokens/:id` sets `revoked_at`; a revoked token cannot enroll. |
| FR3 | `POST /api/v1/agent-enrollment/enroll` atomically validates a join token, consumes one use, creates an agent with `agents.project_id = token.project_id`, and returns the node’s credentials. | Valid request creates exactly one agent with the token’s project and returns `{ agent_id, project_id, access_token, refresh_token, access_expires_at, refresh_expires_at }`; expired/revoked/exhausted/unknown tokens return a generic 401 and create no rows; the request cannot override project or provider. The issued access token authorizes a ticket/credential request in that project and returns 403 for another project even when the agent’s owner is a member or admin there. |
| FR4 | An agent access token (`at_…`) authenticates through `X-API-Key`; it is looked up by prefix/hash, checked for expiry/revocation, and resolves to its agent. | Valid access token authorizes agent routes; expired token returns 401 `TOKEN_EXPIRED`; revoked token returns 401 `TOKEN_REVOKED`; lookup uses an indexed prefix. |
| FR5 | `POST /api/v1/agent-enrollment/refresh` exchanges a valid refresh token (`ar_…`) plus an `idempotency_key` field for a new access token and a rotated refresh token. A retry with the same key inside a short replay window returns the same issued pair; a replay of a rotated token with a different or missing key revokes the family. | Refresh returns a new pair and marks the old token rotated. A retry with the same key inside `AGENT_REFRESH_REPLAY_CACHE_SECONDS` (default 60) returns the identical pair, does not rotate again and keeps the family valid. A replay of the rotated token with a different/absent key revokes all access/refresh tokens for the agent; the winning access token stops working and an audit event records the reason. |
| FR6 | Revoking an agent or its keys invalidates every credential for that agent (access, refresh and legacy key). | After revoke/delete, authenticated calls with any of the agent’s tokens return 401; token rows are marked revoked; other agents are unaffected. |
| FR7 | The Java agent supports first-boot enrollment via `ENROLLMENT_TOKEN` + `ENROLLMENT_URL` when no static `AGENT_ID`/`AGENT_API_KEY` is set; it persists `{ agentId, projectId, refreshToken, accessToken, exp }` to `AGENT_CREDENTIALS_FILE` (0600, atomic write) and uses the access token. | A container with an enrollment token and a persistent volume enrolls and starts without requiring `PROJECT_ID`; restarting with the volume does not re-enroll and reuses the stored project; an existing credential file takes precedence over the env token; no token appears in logs. |
| FR8 | The agent refreshes before access-token expiry and once on a 401, with bounded backoff. Refresh is single-flight per agent: timer and 401 triggers coalesce into one in-flight request with one `idempotency_key`, and every retry reuses that key. It never runs with an expired token and survives a lost refresh response. | Unit test uses a short TTL and asserts refresh before expiry and on 401; simultaneous timer+401 triggers produce one request/key; a lost response is retried with the same key and gets the same pair from the replay cache; refresh failure retries N times, logs a redacted error and exits non-zero. |
| FR9 | Existing `AGENT_ID` + `AGENT_API_KEY` (`ak_…`) configurations continue to work unchanged; middleware selects token type by prefix. | Legacy agent auth tests still pass; a legacy key authenticates; the enrollment feature can be disabled without affecting legacy mode. |
| FR10 | Every agent auth path, including heartbeat and the agent status/read paths, enforces access/legacy key expiry and revocation. | An expired key receives 401 on heartbeat and on agent-authenticated status routes; the agent is not reported online; all agent routes use the same expiry check. |
| FR11 | Join-token lifecycle, enrollment, refresh, replay-cache hits, reuse detection, expiry and revocation emit audit events with actor/project/agent/IP and no secrets. | Events are persisted/queryable; logs and events redact raw tokens; failed attempts include a reason code, not the token. |
| FR12 | Enrollment, refresh and token minting are rate-limited per IP and token prefix; failures are generic; `max_uses` is enforced under concurrency. | A burst returns 429; parallel enrollments beyond `max_uses` produce one success and the rest 401; token probing does not reveal whether a prefix exists. |
| FR13 | Enrollment and refresh are transactional; failures leave no partial agent/token rows; a refresh token rotates exactly once per idempotency key. | Integration test injects a DB failure mid-enroll and finds no agent/token rows. Two concurrent refreshes with the same token and key produce one rotation and the same pair, and that access token still authorizes a request. A replay with a different or missing key is rejected as reuse and revokes the family. |
| FR14 | Enrollment and refresh over non-TLS are refused unless the request is loopback or `ALLOW_INSECURE_AGENT_ENROLLMENT=1`. | Plain HTTP from a non-loopback address is rejected with a clear error; HTTPS or the explicit dev flag succeeds; proxy `trust proxy` behavior is tested. |
| FR15 | PoolManager-provisioned agents either use enrollment/refresh or receive credentials with a configurable lifetime and an automatic renewal path; no silent one-day expiry. | A pool agent remains authenticated past 24 hours in a test; its key lifetime is configurable; an expired pool credential is renewed or the agent fails with a clear operator action. |
| FR16 | Project admins can mint, list and revoke join tokens in the UI; the raw token is shown once with a copy action and never persisted client-side. | Component test verifies the one-time display, copy action, list/revoke, permission gating and that localStorage/Pinia does not retain the raw token. |
| FR17 | Deployment artifacts support both enrollment and legacy mode: the standalone Compose file passes the required `AGENT_ID`, `.env.example` lists `AGENT_ID` and enrollment variables, and a remote-worker template runs against a remote `BACKEND_URL` without the API's Compose network. | `docker compose -f agent/docker-compose.yml config` contains `AGENT_ID`; a remote template starts an agent against a non-Compose backend; docs cover the credential volume and enrollment variables. |

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | Token storage is one-way: only hashes and non-secret prefixes are stored; raw tokens are never logged, put in URLs, or written to prompt/event payloads. The encrypted, short-lived refresh replay cache is the only raw-token store and only returns the same pair to the matching idempotency key. | Code review and tests assert response/log/event fields contain only hashes/prefixes outside the matching retry; the replay row is encrypted, TTL-bounded and purged; a token-shaped string is redacted. |
| NFR2 | Authorization is project-scoped: mint/list/revoke require the existing agent permissions plus project membership; enrollment cannot cross projects or choose a provider not allowed by the token; an enrolled agent is confined to `agents.project_id` for ticket and credential access. | Permission-boundary tests for owner/member/admin/stranger; cross-project token use fails; an enrolled agent cannot create, list, read, pick up, edit or release a ticket/credential in another project, or access another project’s harness run/observability/privacy/budget resources, even when its owner is a member or admin there; purging the enrollment token does not change the agent’s scope. |
| NFR3 | Node credentials are written atomically with mode `0600`; secrets are never echoed, committed, included in argv, or stored in localStorage. | Credential-store unit test checks permissions and temp-file cleanup; frontend test checks storage; lint/scan finds no fixture secrets. |
| NFR4 | Token lookup is indexed and bounded; enroll/refresh add no full-table scans and stay within the existing request timeout under expected load. | Query plans use the prefix indexes; a load test covers 100 enrollments and 1,000 refreshes with p95 targets documented in `02`. |
| NFR5 | The change is additive and backward compatible: legacy keys keep working, the migration is non-destructive, and the feature can be disabled without rolling back the schema. | Legacy tests pass; migration rollback succeeds; `AGENT_ENROLLMENT_ENABLED=false` leaves legacy auth working. |
| NFR6 | Operators get actionable behavior: clear error codes, a runbook for mint/enroll/refresh/revoke, and audit/metrics signals; no silent fail-open. | `02` rollout/runbook steps are executable; tests cover each error code; metrics/events are asserted. |
| NFR7 | Expired/revoked token rows are purged or archived on a bounded schedule so tables do not grow without limit. | A retention job/test deletes rows past the configured window; audit rows follow a documented retention period. |
| NFR8 | Every `FR*`/`NFR*` has a named test row in `03` and the verification commands are run at the reviewed SHA. | `node planning/check-planning.js` passes; the matrix has a row per ID; no `missing` rows at review. |

## In scope

- Backend migration, services, validators, routes, middleware dispatch,
  heartbeat expiry, revocation cascade, rate limiting and audit events.
- Java agent enrollment client, credential store, access-token usage, refresh
  scheduling and first-boot configuration.
- Minimal frontend API client and admin UI for join tokens.
- Tests at backend unit/integration/bash, agent unit, frontend unit.
- Documentation for operators and the TLS/reverse-proxy requirement.

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| API routes/contracts | New `/api/v1/agent-enrollment/*` endpoints; existing agent routes keep their contracts but gain project-scope enforcement; OpenAPI annotations required | `02` API contract; generated spec |
| Database/migrations | New `agent_enrollment_tokens`, `agent_access_tokens`, `agent_refresh_tokens`, `agent_auth_events`; `agents` gains `project_id` and enrollment metadata columns | `02` data model; `054_agent_enrollment.sql` + rollback |
| Frontend | New `api/agentEnrollment.ts`; mint/list/revoke UI in the Agents/Compute Nodes area; agent list shows enrollment mode | `03` per-file changes |
| Agent/harness | `AgentConfig`, `AgentApp`, auth manager, credential store, `ApiService`; no prompt/harness behavior change | `03` agent test matrix |
| Permissions/auth | Reuses `AGENT_CREATE`/`AGENT_READ`/`AGENT_REVOKE` + project membership; new token type in middleware; `agents.project_id` enforced on ticket/credential routes | `02` security section |
| Background jobs/external calls | Expiry cleanup job; refresh calls from the agent | `02` failure modes |
| Downstream tickets | Unblocks remote self-registration (AGENT-1/2/AUTH-1); complements fg-40/fg-43; user PATs remain D1 | `00` notes |
| Rollback | Disable `AGENT_ENROLLMENT_ENABLED`, revoke tokens; migration rollback drops new tables/columns; legacy keys untouched | `02` rollout |

## Out of scope

Summarised only; the authoritative list is **`00` → Deferred register**.

- User/CI API tokens — see `00` D1.
- mTLS/SPIFFE identity — see `00` D2.
- Multi-host scheduling — see `00` D3.
- Automatic migration of legacy agents — see `00` D8.
- UI one-liner/QR generation — see `00` D5.
- Broader project-agents migration for manual/legacy agents — see `00` D11.

## Open questions

None. All product decisions are recorded and answered in **`00` → Decisions
needed from the user** (lifetimes, transport, ownership, UI scope, credential
transport and refresh replay); this document does not duplicate them.

## Dependencies

- Depends on: none for the new `agents.project_id` column (uses existing agent
  auth, permissions and migrations). The broader manual/legacy project-agent
  migration is deferred in `00` D11.
- Related: `fg-43` (host deployment/sizing), `fg-40` (multi-host orchestration),
  `fg-41` (audit/metrics), `fg-45`/`fg-51` (readiness and traceability gates).
- Blocks: true remote self-registration; the intake rows `AGENT-1`,
  `AGENT-2`, `AUTH-1` and `AUTH-3` until this lands.
