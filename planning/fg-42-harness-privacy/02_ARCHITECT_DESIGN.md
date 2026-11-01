# 02_ARCHITECT_DESIGN.md - Harness Privacy and Data Governance (fg-42)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-34, fg-41

## Design summary

Add a privacy pipeline around the prompt and artifact boundary: classify, redact, enforce provider policy, scan output, and store only what policy allows.

```
Ticket/planning/repo
  -> DataClassifier
  -> Redactor (secrets, PII, configured identifiers)
  -> ProviderPolicy check
  -> Prompt/model call
  -> Output/DiffScanner
  -> Publish / message / event store
```

## Data classification

| Class | Examples | Default handling |
|---|---|---|
| Public | open-source docs, public README | send allowed |
| Internal | ticket text, internal planning | send to approved provider |
| Confidential | private source, customer names | redact + approved provider/local model |
| Secret | keys, tokens, passwords, `.env` | never send; block/redact |

Classification input: project setting, repo visibility, file path rules, content patterns. The most restrictive applicable class wins.

## Redaction

- Known secret patterns: provider keys, GitHub tokens, JWT, private keys, DB URLs with credentials.
- Entropy scan for high-entropy strings; allowlist hashes/ids.
- `.env*` files: never include values; include key names only if needed.
- PII: emails, phone numbers, addresses, customer identifiers via configurable patterns.
- Redact events/logs at the emission boundary (fg-41).
- Store only a hash or `[REDACTED]`, never the original.

## Provider policy

Per project:

```json
{
  "allowed_providers": ["opencode-go"],
  "require_no_training": true,
  "max_data_class": "confidential",
  "local_endpoint": "http://ollama:11434/v1",
  "retention_days": 14
}
```

Before a run, verify the selected provider/model satisfies the policy. If not, fail closed or route to the local endpoint.

## Tenant isolation

- Every prompt/context fetch is scoped by project id and agent permissions.
- Caches (dependency, memory, artifacts) are keyed by project/tenant.
- Event and artifact access checks project membership.
- No cross-project few-shot examples or memory.

## Retention and deletion

- Configure retention per data class: prompts, diffs, logs, events, artifacts.
- Deletion job removes records and objects; keep only an audit tombstone.
- Export a project's run data on request.
- Redact before storage, so deletion has less sensitive data to remove.

## Local model option

- Support an OpenAI-compatible endpoint per project for sensitive repos.
- Same budget/routing interfaces (fg-38), but no external egress.
- Health check and fallback policy: if local is down, fail closed rather than send to cloud.

## Audit

- Record classification decisions, redaction counts, blocked runs, provider choice and policy version.
- Never record the secret value.
- Make the audit visible to project admins.

## Tests

- provider key/token/password redaction;
- `.env` and private key handling;
- PII patterns;
- tenant isolation in prompts/caches/events;
- disallowed provider fails closed;
- retention/deletion;
- local-only routing;
- post-flight leak scan.

## Rollout

1. Redaction in logs/events.
2. Pre-flight secret scanning with block mode.
3. Provider policy per project.
4. Retention/deletion.
5. Local model routing.
6. Admin privacy panel/audit.

## Open questions

1. Which data classes are mandatory vs project-configurable?
2. Do we need a dedicated DLP service or in-process scanners?
3. How do we handle secrets in binary files?
4. What is the default retention for prompts/diffs?
5. Which local model/provider do we support first?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-34 | Sandbox secret boundary | Security | `fg-34-harness-sandbox` | No |
| 2 | fg-35 | Scoped credentials | Security | `fg-35-github-app-credentials` | No |
| 3 | fg-41 | Event redaction/retention | Observability | `fg-41-harness-observability` | No |
| 4 | fg-38 | Provider routing | Billing | `fg-38-harness-budgets-routing` | No |
