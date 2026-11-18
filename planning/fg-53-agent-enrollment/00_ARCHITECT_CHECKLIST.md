---
id: "fg-53"
title: "Agent Enrollment and Node Access Tokens"
status: in_progress
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-11-17"
updated: "2026-11-18"
pr: 174
branch: feat/fg-53-agent-enrollment
depends_on: []
---

# 00 — Agent Enrollment and Node Access Tokens (fg-53)

> **Owns:** status, status evidence, ticket map, readiness/completion gates,
> deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), exact file operations (`04`).

## Why this ticket exists

A worker node cannot join the platform by itself. It must be handed a
pre-created `AGENT_ID` and a long-lived `ak_…` key, and that key is shown only
once. The control plane can inject those values when it owns the Docker/SSH
host (PoolManager), but there is no join token, no enrollment endpoint and no
short-lived node credential — so a remote machine cannot self-register safely.
Agent expiry is also inconsistent: the heartbeat path skips
`api_key_expires_at`, and pool agents receive one-day keys with no renewal.

This ticket adds one-time project-scoped join tokens, an enrollment endpoint,
short-lived node access tokens with rotating refresh tokens, first-boot
enrollment in the Java agent, uniform expiry enforcement, and the admin API/UI
needed to mint and revoke enrollment tokens.

## Ticket map

| Doc | Present | Note |
|---|---|---|
| `01_ARCHITECT_REQUIREMENT.md` | ☑ | |
| `02_ARCHITECT_DESIGN.md` | ☑ | |
| `03_ARCHITECT_IMPLEMENTATION.md` | ☑ | |
| `04_SPECIFICATION.md` | ☐ | optional; add when implementation starts if exact file operations are needed |
| `05_RUNBOOK.md` | ☐ | optional; operator steps are summarised in `02` → Rollout |

## Readiness gate (before implementation)

- [ ] `01` has numbered `FR*`/`NFR*`, each with a testable acceptance statement
- [ ] `01` has assumptions and change impact; `02` has failure modes and
      security considerations (non-small tickets) — see `fg-45`
- [ ] `02` records the current-state audit and the chosen design
- [ ] `03` has a verification-matrix row for every `FR*`/`NFR*`
- [ ] Tests are named with their requirement ID so `fg-51` can trace evidence
- [ ] Deferred register below is complete; out-of-scope items are recorded here
- [ ] Open decisions are answered or explicitly accepted as assumptions
- [ ] No fact is duplicated across documents (see `planning/README.md`)
- [ ] Review policy is applied: independent reviewer, evidence-backed findings,
      blocking-only fix rounds (`planning/README.md` §Review policy)
- [ ] Status evidence below matches the intended status

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | PR #173 (merged) | ☑ |
| Implementation merged | PR #174 (open) | ☐ |
| Verification results | PR #174 (open) — backend 2016 tests/162 suites, frontend 653/74 files, agent 824 tests | ☑ |

A merged planning PR is **plan merged**, not `done`. Set `status: done` only
after the implementation PR is merged and `03` has a dated Results row.

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Scoped, expiring user/CI API tokens (and token refresh) for human API access; currently user auth is a 30-minute JWT only, and `TOKEN_EXPIRY_HOURS` is ignored by `auth.js` | AUTH-2 (FUTURE_IDEAS) | Security / DX | new ticket | open |
| D2 | mTLS or SPIFFE/SPIRE node identity instead of bearer tokens | self | Security | none | open |
| D3 | Multi-host enrollment/scheduling (remote Docker or SSH control plane) | fg-40, fg-43 | Infrastructure | fg-40 / fg-43 | open |
| D4 | HMAC/KMS-peppered token hashes and automatic hash migration | self | Security | none | open |
| D5 | One-line/QR enrollment UX and prebuilt `.env` generation | self | Developer experience | none | open |
| D6 | Distributed rate limiting for enroll/refresh across multiple API instances | self | Security / Ops | none | open |
| D7 | Enrollment approval workflow (human approves a pending node) | self | Security | none | open |
| D8 | Migrate legacy `ak_…` agents to access/refresh tokens automatically. Pool keys are now configurable (`POOL_AGENT_KEY_EXPIRY_DAYS`, default 30) but automatic renewal is still deferred | self | Migration | none | open |
| D9 | Credential-file encryption or OS keyring instead of a 0600 JSON file | self | Security | none | open |
| D10 | Enrollment/audit UI filters, export and retention dashboard | fg-41 | Observability | fg-41 | open |
| D11 | Broader project-agents migration: assign manual/legacy agents to a project and expose per-project agent lists. fg-53 adds `agents.project_id` for enrolled agents only; legacy agents stay owner-scoped (`project_id = NULL`) | FUTURE_IDEAS Project Agents Table Migration | Migration / Authorization | new ticket | open |
| D12 | Project-scoped agent management: a non-owner project admin with `AGENT_CREATE` + membership can mint a join token, but the resulting agent is owned by the project owner, so rotate/revoke/delete still need the owner or a super_admin | self | Authorization / UX | new ticket | open |
| D13 | Pre-existing credential-decrypt membership gap: the JWT credential decrypt route checks permission but not project membership. It is JWT-only today, so agents cannot reach it; audit/fix before exposing it to agents | self | Security | new ticket | open |

States: `open`, `scheduled`, `done`, `dropped`.

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Credential lifetimes | A: access 60 min / refresh 30 d / join 15 min; B: access 15 min / refresh 7 d / join 10 min; C: configurable with A as default | C (A defaults) | C — `AGENT_ACCESS_TOKEN_TTL_SECONDS=3600`, `AGENT_REFRESH_TOKEN_TTL_DAYS=30`, `AGENT_ENROLLMENT_TOKEN_TTL_SECONDS=900` |
| 2 | Transport policy | A: refuse enrollment/refresh over plain HTTP except loopback; B: allow private LAN with a warning; C: allow HTTP everywhere | A, with `ALLOW_INSECURE_AGENT_ENROLLMENT=1` for local testing | A |
| 3 | Agent ownership | A: project owner; B: join-token creator; C: configurable | A (matches PoolManager and survives staff changes) | A |
| 4 | UI scope | A: mint/list/revoke join tokens in this ticket; B: API-only first, UI follow-up | A — the key is otherwise unusable without curl | A |
| 5 | Node credential transport | A: reuse `X-API-Key` for `at_…` tokens; B: new `Authorization: Agent <token>` scheme | A — no changes to existing agent/client headers | A |
| 6 | Refresh-token replay policy | A: revoke the family on the first rotated-token replay; B: accept any rotated token inside a short grace window; C: idempotency key with an encrypted short replay cache that returns the same pair | C — survives concurrent refresh and a lost response without granting a stolen old token a new credential | C — `AGENT_REFRESH_REPLAY_CACHE_SECONDS=60` |

If a decision is not answered before implementation, use the recommendation and
record it as an assumption in `01`.

## Completion gate

- [ ] Every `FR*`/`NFR*` acceptance statement in `01` is met
- [ ] Verification matrix in `03` is green and has a row for every requirement
- [ ] `03` Results has a dated, non-placeholder row
- [ ] `fg-51` traceability report has no non-waived `missing`/`partial` requirements (manual until `fg-51` lands)
- [ ] `status` is `done` only after the implementation PR merged, and `pr` is set
- [ ] `PENDING.txt` / `HARNESS_ROADMAP.md` labels match `00` (`Plan merged` vs `Merged`)
- [ ] Review record in `03` shows all blocking findings resolved
- [ ] Deferred register reflects what was actually left out

## Notes

- Related: `fg-43` owns one-command host deployment/sizing; `fg-40` owns
  multi-host orchestration. This ticket makes a single remote node enroll
  safely; it does not schedule workloads across hosts.
- Existing static `ak_…` keys remain supported. No agent is forced to migrate.
- User PATs are explicitly out of scope (D1); this ticket is about node
  identity, not human API access.
- The deployment blockers from the intake list (`AGENT-1`, `AGENT-2`,
  `AUTH-1`, `AUTH-3` in `FUTURE_IDEAS.txt`) are covered by this suite; once
  the plan merges, mark those rows and remove them from the intake list.
- Enrolled agents get `agents.project_id`; legacy/manual agents keep
  `project_id = NULL` and remain owner-scoped. The broader project-agents
  migration is D11, not a dependency of this ticket.
- The planning PR merged as #173; the implementation PR is #174 (in review).
  `PENDING.txt` carries **In review (#174)** until it merges.
