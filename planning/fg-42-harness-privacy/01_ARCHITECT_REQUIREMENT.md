# 01_ARCHITECT_REQUIREMENT.md - Harness Privacy and Data Governance (fg-42)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-34 sandbox, fg-41 observability
**Related code:** `PromptBuilder`, `PlanningDocFetcher`, `HarnessEvent`, provider config

## Problem

Every harness run sends potentially sensitive data to an external provider:

- ticket descriptions and planning docs;
- source code and diffs;
- test output and logs;
- repository instructions and comments.

Today there is no classification, no redaction, no provider allowlist, no retention policy and no tenant isolation for this data. A secret in a repo file or a customer name in planning docs can leave the system unnoticed.

## Goals

1. Classify data before it enters a prompt.
2. Redact secrets and sensitive identifiers before model calls and logging.
3. Let projects choose allowed providers and retention policies.
4. Isolate tenants/projects in prompts, artifacts and logs.
5. Provide a local/self-hosted model option for sensitive repos.
6. Support deletion and audit of stored run data.
7. Fail closed when policy cannot be satisfied.
8. Make privacy behavior visible to admins.

## Non-goals

- Legal compliance certification.
- Full DLP across the whole platform.
- Encrypting model provider internals.
- Anonymizing all code (the model needs code to work).

## Functional requirements

- **FR1 - Classification:** label ticket/planning/repo data as public, internal, confidential or secret; classify files by path and content.
- **FR2 - Pre-flight redaction:** remove secrets (keys, tokens, passwords, `.env` values), PII patterns and configurable identifiers before sending.
- **FR3 - Secret scan:** entropy/regex scan of prompt context; block or redact matches; log a policy event.
- **FR4 - Post-flight scan:** scan model output and diffs for leaked secrets before publishing/messaging.
- **FR5 - Provider policy:** per-project allowlist, no-training/retention requirements, data residency; reject unsupported providers.
- **FR6 - Tenant isolation:** prompts, artifacts, events and caches are scoped by project/tenant; no cross-project context.
- **FR7 - Retention:** configurable retention for prompts, diffs, logs and events; deletion API.
- **FR8 - Local model option:** route sensitive projects to a self-hosted/OpenAI-compatible endpoint.
- **FR9 - Audit:** record policy decisions, redactions and blocked runs without storing the secret.
- **FR10 - Fail closed:** if redaction/policy cannot run, do not send confidential data.

## Safety requirements

- Secrets never enter the prompt, event store, logs or PR text.
- A project cannot read another project's data through prompts, caches or events.
- Provider policy is enforced before the session starts.
- Redaction must handle encoded/obfuscated secrets reasonably.
- Deletion removes derived artifacts and events as well as the source record.
- The system must not claim compliance it cannot prove.

## Acceptance criteria

1. Secrets in repo files, env examples and planning docs are redacted or blocked.
2. A project with a disallowed provider cannot start a run.
3. Tenant isolation is enforced in prompts, caches, events and artifacts.
4. Retention/deletion removes the configured data classes.
5. A sensitive project can be routed to a local model.
6. Policy decisions are auditable.
7. Tests cover secrets, PII, tenant isolation, provider policy and deletion.

## Out of scope

- GDPR/CCPA legal workflow.
- Customer-managed encryption keys.
- Full data-loss-prevention for human uploads.
- Model provider contract negotiation.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-34 | Sandbox network/secret boundary | Security | `fg-34-harness-sandbox` | No |
| 2 | fg-35 | Scoped credentials | Security | `fg-35-github-app-credentials` | No |
| 3 | fg-41 | Event redaction/retention | Observability | `fg-41-harness-observability` | No |
| 4 | fg-38 | Provider routing | Billing | `fg-38-harness-budgets-routing` | No |
