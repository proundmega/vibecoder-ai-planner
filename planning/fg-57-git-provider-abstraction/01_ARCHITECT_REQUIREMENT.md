# 01 — Requirement (fg-57)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

The autonomous harness can only publish to GitHub. A private application cannot
be moved to a foreign Git host, so the whole capture → clarify → code → review
loop is unavailable for it. Adding GitLab and Forgejo/Gitea one-off would
duplicate the publishing logic and keep the agent, backend, database and
evidence path GitHub-specific.

The immediate need is a **provider-neutral Git publishing contract** with:

1. Forgejo/Gitea self-hosted as the lightweight first provider.
2. Local bare repository/SSH as the no-PR fallback.
3. GitLab self-hosted as a later slice where the organisation already runs it.

## Goals

1. Connect a self-hosted repository, push a branch and create a review request
   without GitHub.
2. Keep the existing GitHub path source-compatible and behaviourally unchanged.
3. Make harness publishing evidence provider-neutral: branch + SHA is enough
   when no PR/MR exists.
4. Keep credentials scoped, encrypted and out of configuration, argv, logs and
   prompts.
5. Provide a disposable Forgejo integration path so the contract is tested
   against a real server, not only mocks.
6. Document the resource trade-off: Forgejo/Gitea can run small; GitLab is
   significantly heavier.

## Non-goals

- Replacing GitHub for existing projects.
- Implementing GitLab in the first slice.
- Repository mirroring or migration of history between providers.
- A full code-review UI replacement; review stays in the provider UI or a
  local diff for bare repositories.
- Changing the model-provider privacy model; self-hosted Git does not make the
  model endpoint local. See `00` D9.
- Webhooks, signed commits and CI triggers in the first slice (deferred).

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | A provider-neutral Git contract exists for backend and agent. | The same service interface covers GitHub, Forgejo/Gitea, GitLab and local bare repos; no provider name is hardcoded in the harness publishing path. |
| FR2 | A project can be connected to a Forgejo/Gitea repository with a base URL and token. | Connect validates access and default branch; the repo row stores provider, base URL and encrypted credential; an agent can fetch the credential. |
| FR3 | A worker can publish a branch and open a Forgejo/Gitea pull request. | Branch is pushed once; exactly one PR is created; duplicate publish returns the existing PR; branch/PR cleanup works. |
| FR4 | A project can be connected to a GitLab self-hosted repository and open a merge request. | Connect validates the project and default branch; branch push and MR creation work against a GitLab API fake or disposable instance. |
| FR5 | Local bare repository/SSH publishing works without a PR API. | Agent clones with a scoped key, pushes a branch and records the SHA; the run succeeds and the ticket moves to `review` with no review URL. |
| FR6 | Harness publish/reconcile accepts branch + SHA without a PR URL. | `reconcileRun` adopts a published branch-only run; a failed run without evidence is still released; no duplicate PR is created. |
| FR7 | The HTTP API is provider-neutral and GitHub-compatible. | `/api/v1/git/:projectId/...` serves all providers; existing `/api/v1/github/...` routes keep working as aliases. |
| FR8 | Credentials are scoped, encrypted and revocable. | Tokens/keys are encrypted at rest, never in `.git/config`, argv, logs or the prompt; the agent fetches them per run; revoke disables future use. |
| FR9 | Provider configuration is explicit and validated. | Base URL/SSH URL is validated, private hosts are allowed only by the existing host policy, and a bad provider config fails with a clear 4xx. |
| FR10 | The UI can select a provider and show connection/review status. | Project settings offer GitHub, Forgejo/Gitea, GitLab and local; the project shows provider, repository and the latest PR/MR/branch link. |
| FR11 | Tests cover the contract and at least one real self-hosted provider. | Unit tests run against provider fakes; integration tests run against a disposable Forgejo/Gitea container; GitHub tests stay green. |
| FR12 | Migration and operations are documented. | `05` covers Forgejo/Gitea, GitLab and bare-repo setup/cleanup; `AGENTS.md` and the runbook point to the provider-neutral endpoint. |

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | Secrets hygiene. | No plaintext credential in the database, files, argv, logs or prompt; redaction tests cover token and SSH key forms. |
| NFR2 | Fail closed. | Unknown provider, revoked credential, unreachable host or unsupported auth mode rejects publish without touching the base branch. |
| NFR3 | Idempotency. | Retried publish reuses the branch/SHA and returns the existing PR/MR; branch conflicts are reported, not force-pushed. |
| NFR4 | Privacy boundary. | Self-hosted Git does not bypass model-provider policy; fg-42 local-only/allowed-provider checks still apply. |
| NFR5 | Backward compatibility. | Existing GitHub projects, routes, tokens and tests work unchanged. |
| NFR6 | Verification. | Backend unit/integration, agent `mvn test`, lint and the new provider contract tests pass. |

## In scope

- Backend provider abstraction, routes, database changes and migrations.
- Agent Git abstraction and credential provider.
- Harness publish evidence and reconciliation changes.
- Forgejo/Gitea first implementation, local bare repo fallback, GitLab later
  slice.
- Tests, runbook and index updates.

## Out of scope

Summarise only. The authoritative list with reasons, follow-ups and state is
**`00` → Deferred register**.

- GitHub Enterprise Server base URL (D2).
- Forgejo/Gitea Actions CI, signed commits, mirroring (D4–D6).
- Webhooks and merge-event ingestion (D10).
- A local model provider (D9).

## Known unknowns

1. **Forgejo/Gitea version and API stability** — pin a tested release and
   contract-test the endpoints used.
2. **GitLab resource cost** — Omnibus is heavy; document the minimum and keep it
   a later slice.
3. **SSH host-key distribution** for local bare repos — needs an explicit
   known-hosts policy, never `StrictHostKeyChecking=no`.
4. **Ticket review without a PR** — the UI must show branch/SHA instead of a
   dead PR link.
5. **Existing GitHub evidence semantics** — `pr_url` is used by adoption and
   reaper logic; changing it risks regressions.

## Important design decisions

1. **Provider interface, not branches in every caller** — one contract, capability
   flags for review requests and installation tokens.
2. **Forgejo/Gitea first** — lightweight, self-hosted, simple PR API.
3. **Local bare repo fallback** — unblocks private repos without extra services.
4. **GitLab later** — same suite, but do not make it the first dependency.
5. **Keep `pr_url` as the review URL field** — it stays nullable; add
   provider-neutral naming only where needed to avoid a risky column rename.

## Dependencies

- fg-35 GitHub App credentials (merged).
- fg-54 node/runtime fleet (merged).
- A disposable Forgejo/Gitea container for integration tests.
- For the GitLab slice, a disposable GitLab instance or a faithful API fake.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep
a copy.
