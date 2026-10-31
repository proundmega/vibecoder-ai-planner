# 01_ARCHITECT_REQUIREMENT.md - Repository Onboarding and Environment Profiles (fg-39)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-34 sandbox
**Related code:** `VerificationRunner`, `WorkspaceManager`, `agent/Dockerfile`, project settings

## Problem

The harness knows a ticket and a repo, but not how to build that repo. Current verification detection is limited to root/backend/frontend `package.json`, `pom.xml` and `Makefile`. It assumes dependencies are installed and services are available.

Typical failures:

- Node 24 vs Node 20, Python 3.11 vs 3.12, Java 17 vs 21;
- missing `node_modules` / Maven cache / virtualenv;
- tests need Postgres, Redis or Docker;
- monorepos have per-package commands;
- test data/seed scripts are required;
- flaky tests fail intermittently;
- setup needs non-secret env vars.

Without profiles, agents spend their budget debugging the environment or fail verification for reasons unrelated to the ticket.

## Goals

1. Describe each repo's environment once and reuse it for every ticket.
2. Pin toolchains and cache dependencies for fast, deterministic runs.
3. Provide required services (DB/Redis/etc.) in the sandbox.
4. Define setup, verification, lint, typecheck and test-data commands.
5. Handle flaky/known-failing tests explicitly.
6. Inject non-secret configuration safely.
7. Validate profiles with a dry run before agents use them.
8. Support Node, Python, Java, Go and monorepos.

## Non-goals

- Replacing CI.
- Arbitrary user-provided Dockerfiles without review.
- Production secrets in profiles.
- Deploying the application.
- Multi-repo environment composition in Phase 1.

## Functional requirements

- **FR1 - Profile schema:** repo URL, languages, image/toolchain versions, setup commands, verify commands, services, env (non-secret), cache paths, timeouts, flaky tests.
- **FR2 - Onboarding:** detect stack from manifests; propose a profile; let an admin edit/approve.
- **FR3 - Images:** per-stack sandbox images or a devcontainer; pinned versions; pre-installed tools.
- **FR4 - Caches:** dependency caches (npm, Maven, pip, Go) persisted across runs and scoped per repo.
- **FR5 - Services:** start Postgres/Redis/etc. in the sandbox network with health checks and ephemeral data.
- **FR6 - Commands:** run setup once, then verification; capture output; respect per-command timeouts.
- **FR7 - Env:** inject non-secret env from the profile; secrets come from the secret store only when required.
- **FR8 - Flaky tests:** mark known-flaky tests; retry with limits; never hide a consistent failure.
- **FR9 - Validation:** a dry-run command verifies setup/verify in the sandbox without running a ticket.
- **FR10 - Fallback:** if no profile exists, use autodetection and warn; do not silently skip verification.

## Safety requirements

- Profiles are trusted admin config; repo scripts remain untrusted (fg-34).
- No secrets in profile JSON/logs.
- Cache poisoning must not cross projects.
- Service containers are ephemeral and isolated per run.
- A profile change is audited.

## Acceptance criteria

1. An admin can onboard a repo and get a working profile.
2. Setup and verification run deterministically in a sandbox.
3. Dependency caches speed up repeated runs without cross-project leakage.
4. Required services start and are reachable from the test command.
5. Flaky tests have a documented retry policy and do not hide real failures.
6. A dry run validates the profile before use.
7. Node, Python, Java and monorepo examples pass.
8. Missing profiles fall back to autodetection with a warning.

## Out of scope

- Windows containers.
- GPU workloads.
- Production deployment/preview environments.
- Secret rotation (fg-35).

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-34 | Sandbox runtime for profiles | Security | `fg-34-harness-sandbox` | No |
| 2 | fg-37 | Evaluate profile reliability | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 3 | fg-38 | Cache-aware budgets | Billing | `fg-38-harness-budgets-routing` | No |
| 4 | fg-41 | Profile/setup telemetry | Observability | `fg-41-harness-observability` | No |
