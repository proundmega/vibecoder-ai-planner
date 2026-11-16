---
id: "fg-39"
title: "Repository Onboarding and Environment Profiles"
status: in_review
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-16"
pr: 161
branch: "feat/fg-39-repo-profiles"
depends_on: ["fg-30", "fg-34"]
---

# 00 — Repository Onboarding and Environment Profiles (fg-39)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), file operations (`04`).

**Related code:** `VerificationRunner`, `WorkspaceManager`, `SandboxConfig`,
`HarnessTicketProcessor`, project settings, `agent/Dockerfile`

## Why this ticket exists

The harness currently assumes the cloned repo can install and test itself. Real
projects need pinned toolchains, dependency caches, databases/Redis, monorepo
commands, test data and known-flaky-test handling. Most agent failures will be
environment failures, not coding failures.

## Slice plan

| Slice | Scope | State |
|---|---|---|
| 1 | Versioned profile schema/API, GitHub-manifest stack detection, profile-driven base branch/setup/verify/env/timeouts, digest-pinned image override, dry-run validation queue + agent worker, activation only after an exact-content successful dry run, fg-34/D27 profile origin-CA plumbing | in review |
| 2 | Service containers (Postgres/Redis) with health checks, ephemeral data and connection env | planned |
| 3 | Flaky-test retry policy, test-data hooks and known-failure semantics | planned |
| 4 | Prebuilt per-stack images/devcontainers, lockfile-keyed cache generations and cache-write sanitization | planned |
| 5 | Project settings profile editor | planned |

Slice 1 deliberately fails closed for non-empty `services` and `flaky_tests`
rather than accepting configuration it does not execute.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Slice 1 implementation | `feat/fg-39-repo-profiles`, commits `1ef01f7..669726d`, PR #161 | ☑ |
| Verification results | `03` → Results | ☑ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Sandbox images and supply chain | fg-34 | Security | fg-34-harness-sandbox | open |
| D2 | Evaluate profile reliability | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D3 | Cache-aware budgets | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D4 | Profile/setup telemetry | fg-41 | Observability | fg-41-harness-observability | open |
| D5 | Service containers and health checks (slice 2) | fg-39 FR5 | Infrastructure | fg-39 slice 2 | open |
| D6 | Flaky-test retry policy and test-data hooks (slice 3) | fg-39 FR8 | Reliability | fg-39 slice 3 | open |
| D7 | Prebuilt per-stack images/devcontainers and pinned toolchains (slice 4) | fg-39 FR3 | Infrastructure | fg-39 slice 4 | open |
| D8 | Project settings profile editor (slice 5) | fg-39 FR2 | UX | fg-39 slice 5 | open |
| D9 | Persistent dependency caches: size quota/watchdog, volume GC, lockfile-keyed generations and sanitized cache writes | fg-39 FR4 | Security | fg-39 slice 4 | open |
| D10 | Profile change event log beyond version rows/`created_by` timestamps | fg-39 safety | Audit | fg-41 | open |
| D11 | Real-Docker/real-repo profile dry-run e2e and cache-volume real-Docker coverage | fg-39 slice 1 review | Testing | bt-60 / fg-39 slice 4 | open |

## User decisions

- Profiles are trusted admin configuration; repo scripts remain untrusted and
  run only inside the existing sandbox boundary.
- A profile may select an image only by digest; it may not widen the operator
  egress allowlist or force a weaker TLS mode.
- The first dry run is an operator-triggered setup/verify run, not a model run.
- `services` and `flaky_tests` are rejected until the corresponding slices land.
