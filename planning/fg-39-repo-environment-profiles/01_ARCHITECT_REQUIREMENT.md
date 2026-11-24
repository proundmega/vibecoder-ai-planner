# 01_ARCHITECT_REQUIREMENT.md - Repository Onboarding and Environment Profiles (fg-39)

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

## Slice 1 scope

Slice 1 implements FR1, FR2, FR3 (operator-provided pinned image), FR6, FR7,
FR9, FR10 and the fg-34/D27 origin-CA profile handoff. Persistent caches (FR4)
and flaky-test retry (FR8) are rejected at validation until their slices land,
so no profile declares storage or execution it does not get. FR3's prebuilt
image catalog is deferred to slice 4; slice 1 accepts any digest-pinned image
the operator supplies.

Slice 2 adds FR5: ephemeral service containers with health checks, a per-run
internal network, generated test passwords and injected connection env. Slice 5
adds the project settings profile editor for onboarding, drafts, dry runs,
activation and version history. Slice 4a adds the prebuilt per-stack images,
their pinned toolchains and stack-image detection (`fg-39b`).

## Assumptions

| # | Assumption | Impact if wrong |
|---|---|---|
| A1 | A project has one active profile and may have multiple draft/inactive versions. | Activating a profile deactivates the previous active row in the same transaction. |
| A2 | Profiles are authored by a project owner/super admin, not by repo content or the model. | Writes are owner/super-admin only; the agent re-validates every field it consumes. |
| A3 | The GitHub token used for stack detection and dry-run cloning already has repo access. | Detection falls back to a warning and the admin enters commands manually; dry-run reports a clone failure. |
| A4 | The agent's `SANDBOX_ALLOWED_HOSTS` remains the network authority. | A profile origin-CA host not already allowlisted fails closed before sandbox creation. |
| A5 | Cache volumes are disposable and may be evicted at any time. | A missing cache only slows a run; correctness does not depend on cache contents. |
| A6 | The first dry run uses the same host/Docker sandbox mode as normal runs. | Host mode executes repo scripts on the agent host; operators must use an isolated host. |
| A7 | Service containers require Docker sandbox mode. | Host mode fails closed for a profile with services. |
| A8 | Service passwords are generated per run and never stored in the profile. | Profile `env` must not set `password_env`; the generated value is passed only to the service and its connection env. |

## Change impact

| Surface | Change |
|---|---|
| Database | New `repo_profiles` and `repo_profile_validations` tables with exact-content `profile_hash`; nullable `repo_profile_id`/`repo_profile_version` columns on `harness_runs`; harness starts validate the profile against the ticket's project. |
| Backend API | New project-scoped profile CRUD, detection, activation and dry-run routes; new agent read/claim/finish routes. |
| Agent | Profile fetch/validation and repo binding, base-branch checkout, profile setup/verify commands, timeout/env handling, image override, overall `max_round_minutes` deadline, dry-run worker, D27 origin-CA handoff, and ephemeral service containers/health checks with generated connection credentials. Persistent cache mounts are deferred (D9). |
| Frontend | New Repository Profile tab in Project Settings with detection, draft editing, services/env/egress fields, dry-run polling, activation and version/validation history. |
| Existing behavior | No profile → previous autodetection and defaults, with a warning. Profile create/update/activate/validate requires an active connected repo and a matching `repo_url`; activation requires a successful dry run for the exact profile hash. `sni-only` stays the default; a profile cannot force `terminate`. |
| Compatibility | Additive migrations and nullable columns; old agents ignore the new endpoint. Profiles are opt-in per project. |

## Non-goals

- Replacing CI.
- Arbitrary user-provided Dockerfiles without review.
- Production secrets in profiles.
- Deploying the application.
- Multi-repo environment composition in Phase 1.

## Functional requirements

- **FR1 - Profile schema:** repo URL, base branch, languages, image/toolchain versions, setup commands, verify commands, services, env (non-secret), cache paths, timeouts, flaky tests. `base_branch` is the first source in fg-36's shared resolver.
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
9. Stack detection proposes a digest-pinned prebuilt image only when the
   operator has configured that stack; otherwise it warns and requires an
   admin-supplied pinned image.

## Out of scope

- Windows containers.
- GPU workloads.
- Production deployment/preview environments.
- Secret rotation (fg-35).

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
