---
id: "fg-39"
title: "Repository Onboarding and Environment Profiles"
status: in_progress
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-24"
pr: null
branch: null
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
| 1 | Versioned profile schema/API, GitHub-manifest stack detection, profile-driven base branch/setup/verify/env/timeouts, digest-pinned image override, dry-run validation queue + agent worker, activation only after an exact-content successful dry run, fg-34/D27 profile origin-CA plumbing | done (#161) |
| 2 | Service containers (Postgres/Redis) with health checks, ephemeral data and connection env | done (#167) |
| 3 | Flaky-test retry policy, test-data hooks and known-failure semantics | done (#225, `e2b94f1`) |
| 4a | Prebuilt per-stack images, pinned toolchains and stack-image detection (`fg-39b`) | in review (#232) |
| 4b | Persistent dependency caches: quota/watchdog/GC, lockfile-keyed generations and sanitized cache writes (`fg-39c`) | planned |
| 5 | Project settings profile editor | done (#167) |

Slices 1, 2, 3 and 5 are implemented; slice 4a (prebuilt stack images and
detection) is in review as PR #232, and `caches` still fails closed until slice
4b rather than accepting configuration the runtime does not execute.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Slice 1 implementation | PR #161 | ☑ |
| Slice 2/5 implementation | PR #167 (`867b9f7`) | ☑ |
| Slice 3 implementation | PR #225 (`e2b94f1`); `03` → Results | ☑ |
| Slice 4a images | PR #232; all five stages build; Python/monorepo pip+pytest smoke under the sanitized PATH | ☑ |
| Verification results | `03` → Results | ☑ |
| Remaining slices | FR3 (D7) in review; FR4 (D9) open | ☐ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Sandbox images and supply chain | fg-34 | Security | fg-34-harness-sandbox | open |
| D2 | Evaluate profile reliability | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D3 | Cache-aware budgets | fg-38 | Billing | DONE/fg-38-harness-budgets-routing | open |
| D4 | Profile/setup telemetry | fg-41 | Observability | DONE/fg-41-harness-observability | open |
| D5 | Service containers and health checks (slice 2) | fg-39 FR5 | Infrastructure | fg-39 slice 2 | merged (#167) |
| D6 | Flaky-test retry policy and test-data hooks (slice 3) | fg-39 FR8 | Reliability | fg-39 slice 3 | done (#225, `e2b94f1`) |
| D7 | Prebuilt per-stack images/devcontainers and pinned toolchains (slice 4a) | fg-39 FR3 | Infrastructure | fg-39 slice 4a | in review (#232) |
| D8 | Project settings profile editor (slice 5) | fg-39 FR2 | UX | fg-39 slice 5 | merged (#167) |
| D9 | Persistent dependency caches: size quota/watchdog, volume GC, lockfile-keyed generations and sanitized cache writes | fg-39 FR4 | Security | fg-39 slice 4b | open |
| D10 | Profile change event log beyond version rows/`created_by` timestamps | fg-39 safety | Audit | fg-41 | open |
| D11 | Real-Docker/real-repo profile dry-run e2e (cache real-Docker coverage moves with D9) | fg-39 slice 1 review | Testing | bt-60 / fg-39 slice 4 | open |
| D12 | Service container disk quota and egress-governed image pulls; image pulls currently use the Docker daemon directly | fg-39 slice 2 review | Security | fg-39 slice 4 | open |
| D13 | Enforce one current draft per project (partial unique index) or explicit multi-draft UI | fg-39 slice 5 review | Data | fg-39 slice 5 follow-up | open |
| D14 | Dry-run history pagination beyond the latest 200 rows | fg-39 slice 5 review | UX | fg-39 follow-up | open |
| D15 | One-time storage scrub/migration for legacy literal credentials in profile and validation rows (read-time redaction is in place) | fg-39 review | Security | fg-39 follow-up | open |

## User decisions

- Profiles are trusted admin configuration; repo scripts remain untrusted and
  run only inside the existing sandbox boundary.
- A profile may select an image only by digest; it may not widen the operator
  egress allowlist or force a weaker TLS mode.
- The first dry run is an operator-triggered setup/verify run, not a model run.
- Services run only in Docker mode and fail closed in host mode; `flaky_tests`
  and `caches` remain rejected until slices 3 and 4.
