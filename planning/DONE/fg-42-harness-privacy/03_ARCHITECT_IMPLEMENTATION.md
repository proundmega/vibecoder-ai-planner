# 03 — Implementation (fg-42)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Define data classification (public/internal/confidential/secret)
- [x] Add pre-flight redaction and secret scanning
- [x] Add post-flight output scanning
- [x] Define provider allowlist and retention policy per project
- [x] Enforce tenant/project isolation in prompts, logs and artifacts
- [x] Define retention/deletion for run data
- [x] Add local-model option for sensitive repos
- [x] Add audit and consent/recording controls
- [x] Test secrets, PII, tenant isolation and provider policy

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/053_harness_privacy.sql` | add | Per-project classification, provider, local-model, redaction and retention policy. |
| `backend/src/migrations/053_harness_privacy_rollback.sql` | add | Rollback for the policy table. |
| `backend/src/migrations/apply.js` | edit | Register migration 053 after 052. |
| `backend/src/services/HarnessPrivacyService.js` | add | Policy read/update (with nullable clears), provider/residency/no-training/local-only enforcement, full-scope deletion with audit tombstone, snapshot export, policy audit. |
| `backend/src/utils/piiRedaction.js` | add | Shared high-confidence PII redaction for ingest and agent messages. |
| `backend/src/utils/harnessRedaction.js` | edit | PII redaction and `pii_flagged` metadata at event ingest. |
| `backend/src/services/HarnessRunService.js` | edit | Enforce privacy policy in the start transaction and hand the resolved policy to the route. |
| `backend/src/services/HarnessEventService.js` | edit | `privacy.decision` type; per-project event retention in `purgeExpired`. |
| `backend/src/services/HarnessAuditService.js` | edit | `audit.privacy` recorder and type. |
| `backend/src/services/HarnessMetrics.js` | edit | Observe `privacy.decision` and `audit.privacy`. |
| `backend/src/api/harnessRuns.js` | edit | Accept provider endpoint/region, return `privacyPolicy` without leaking it into `data`. |
| `backend/src/api/harnessObservability.js` | edit | Privacy policy GET/PUT, deletion and export endpoints with project-admin tenant checks. |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessPrivacyPolicy.java` | add | Parses the backend policy and enforces the classification ceiling/local requirements. |
| `agent/src/main/java/com/vibecode/agent/harness/PiiRedactor.java` | add | High-confidence email/phone/SSN/Luhn-valid card redaction. |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessDataClassifier.java` | add | Classifies ticket, planning and repo context; secret wins. |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessPrivacyPipeline.java` | add | Pre-flight classification/redaction and post-flight output scan; fails closed. |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessPrivacyGuard.java` | add | Shared model/storage boundary; PII is scanned even when redaction is disabled, and persisted strings always lose PII. |
| `agent/src/main/java/com/vibecode/agent/harness/WorkspaceFileBridge.java` | edit | Redacts/blocks secrets and PII before returning `sandbox_read`/`sandbox_grep` content. |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxBashBridge.java` | edit | Redacts/blocks secrets and PII in `sandbox_bash` output, including streamed chunks. |
| `agent/src/main/java/com/vibecode/agent/harness/SecretRedactor.java` | edit | Adds a conservative high-entropy token rule beside the known credential formats. |
| `agent/src/main/java/com/vibecode/agent/config/RedactingPatternLayoutEncoder.java` | edit | Applies the storage privacy boundary (secrets + PII) to every log line. |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | edit | Loads the policy, redacts before prompting, enforces local-only/model, scans verification output and PR text, emits `privacy.decision`, and redacts logs/messages/run errors. |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | edit | Sends provider endpoint/region and captures `privacyPolicy`. |
| `agent/src/main/java/com/vibecode/agent/model/ApiResponse.java` | edit | Maps `privacyPolicy`. |
| `frontend/src/api/harnessObservability.ts` | edit | Privacy policy, deletion and export API functions/types. |
| `frontend/src/views/HarnessObservability.vue` | edit | Privacy panel for class, provider, local model, redaction, retention, delete and export. |
| `backend/src/__tests__/harnessPrivacyService.test.js` | add | Policy defaults, allowlist, local-only, no-training, residency, fail-closed, deletion and export. |
| `backend/src/__tests__/api-harness-observability.test.js` | edit | Privacy policy read/write, audit, delete/export and non-member denial. |
| `backend/src/__tests__/api-harness-runs.test.js` | edit | Start response contains `privacyPolicy` but not the internal field. |
| `backend/src/__tests__/harnessAuditService.test.js` | edit | `audit.privacy` evidence. |
| `backend/src/__tests__/harnessEventService.test.js` | edit | Retention query uses the project policy. |
| `backend/src/__tests__/integration/harnessPrivacyMigration.test.js` | add | Real-Postgres migration, constraint and rollback check. |
| `agent/src/test/java/com/vibecode/agent/harness/HarnessPrivacyPolicyTest.java` | add | Policy parsing, ceilings and local requirements. |
| `agent/src/test/java/com/vibecode/agent/harness/PiiRedactorTest.java` | add | Email, phone, SSN, Luhn card and safe-text cases. |
| `agent/src/test/java/com/vibecode/agent/harness/HarnessDataClassifierTest.java` | add | Public/internal/confidential/secret classification. |
| `agent/src/test/java/com/vibecode/agent/harness/HarnessPrivacyPipelineTest.java` | add | Pre/post-flight redaction, blocking and policy ceilings. |
| `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java` | edit | Prompt redaction and `privacy.decision` without leaking the token/PII. |
| `agent/src/test/java/com/vibecode/agent/service/ApiServiceHarnessTest.java` | edit | Provider context and privacy policy capture. |
| `frontend/src/__tests__/harnessObservabilityApi.test.ts` | edit | Privacy policy, deletion and export calls (limit/offset). |
| `frontend/src/__tests__/harnessObservabilityMember.test.js` | add | Member rendering hides the admin-only privacy panel and does not fail the page on a 403. |
| `backend/src/__tests__/integration/harnessPrivacyExport.test.js` | add | Real-Postgres export redaction and offset pagination. |

## Dependencies

- fg-30, fg-34, fg-41

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Agent | `HarnessDataClassifierTest.java` | Public, internal, confidential and secret classification; sensitive paths and most restrictive wins | `cd agent && mvn -Dtest=HarnessDataClassifierTest test` |
| FR2 | Agent | `HarnessPrivacyPipelineTest.java`, `PiiRedactorTest.java`, `HarnessTicketProcessorTest.java`, `WorkspaceFileBridgeTest.java`, `SandboxBashBridgeTest.java` | Prompt/tool secrets and PII redacted before the model; `blockOnPii` still scans when `redactPii=false` | `cd agent && mvn -Dtest='HarnessPrivacyPipelineTest,PiiRedactorTest,HarnessTicketProcessorTest,WorkspaceFileBridgeTest,SandboxBashBridgeTest' test` |
| FR3 | Agent | `SecretRedactorTest.java`, `HarnessDataClassifierTest.java` | Known-format and high-entropy secret scan; policy event emitted | `cd agent && mvn -Dtest='SecretRedactorTest,HarnessDataClassifierTest' test` |
| FR4 | Agent | `HarnessPrivacyPipelineTest.java`, `HarnessTicketProcessorTest.java`, `SandboxBashBridgeTest.java` | Verification output, tool output and PR text scanned/redacted before storage/publishing | `cd agent && mvn -Dtest='HarnessPrivacyPipelineTest,HarnessTicketProcessorTest,SandboxBashBridgeTest' test` |
| FR5 | Backend | `harnessPrivacyService.test.js`, `api-harness-runs.test.js` | Allowlist, no-training, residency, local-only, backend-authoritative endpoint and start-response handoff | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js src/__tests__/api-harness-runs.test.js --runInBand` |
| FR6 | Backend | `api-harness-observability.test.js` | Non-member and plain member cannot read, export or delete project privacy data | `cd backend && npx jest src/__tests__/api-harness-observability.test.js --runInBand` |
| FR7 | Backend | `harnessPrivacyService.test.js`, `harnessEventService.test.js`, `integration/harnessPrivacyDeletion.test.js`, `integration/harnessPrivacyMigration.test.js` | `all` empties events, usage, runs, checkpoints, messages and billing logs while keeping the audit tombstone; per-project retention; migration rollback | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js src/__tests__/harnessEventService.test.js src/__tests__/integration/harnessPrivacyDeletion.test.js src/__tests__/integration/harnessPrivacyMigration.test.js --runInBand` |
| FR8 | Backend + Agent | `harnessPrivacyService.test.js`, `HarnessPrivacyPolicyTest.java` | Local-only requires the configured endpoint; local model overrides routing | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js --runInBand` and `cd agent && mvn -Dtest=HarnessPrivacyPolicyTest test` |
| FR9 | Backend + Agent | `harnessAuditService.test.js`, `api-harness-observability.test.js`, `harnessRunService.test.js` | Policy changes are transactional/full-snapshot, exports and blocked runs are audited as `audit.privacy` | `cd backend && npx jest src/__tests__/harnessAuditService.test.js src/__tests__/api-harness-observability.test.js src/__tests__/harnessRunService.test.js --runInBand` |
| FR10 | Backend + Agent | `harnessPrivacyService.test.js`, `HarnessPrivacyPipelineTest.java`, `HarnessTicketProcessorTest.java` | Policy read/redaction failure and missing durable policy fail closed | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js --runInBand` and `cd agent && mvn -Dtest='HarnessPrivacyPipelineTest,HarnessTicketProcessorTest' test` |
| NFR5 | Backend + Agent | `harnessRedaction.test.js`, `harnessPrivacyService.test.js`, `HarnessTicketProcessorTest.java`, `HarnessPrivacyGuardTest.java` | Stored prompts, tool output, messages, run errors, events and audit contain no token or PII | `cd backend && npx jest src/__tests__/harnessRedaction.test.js src/__tests__/harnessPrivacyService.test.js --runInBand` and `cd agent && mvn -Dtest='HarnessTicketProcessorTest,HarnessPrivacyGuardTest' test` |

## Review checklist

- [x] Every `FR*`/`NFR*` has a passing row in the matrix
- [x] Error paths and edge cases are covered, not only the happy path
- [x] Migration has a rollback and is registered in `apply.js`
- [x] API contract matches `02`; OpenAPI/types regenerated if it changed
- [x] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [x] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-17 | `64a409c` (#166) | Backend 146 suites / 1858 tests; Agent 788 tests (9 skipped); Frontend 62 files / 575 tests; real-Postgres integration 17 suites / 159 tests | Review fixes: key-aware redacted export, deterministic export ordering, offset pagination (independent page snapshots, D10), member-safe privacy panel, PII log redaction, transactional/full-snapshot policy audit, provider-start audit with dedupe, dead-letter/checkpoint redaction. On-disk workspace/artifact retention is deferred in `00` D8. |
| 2026-11-22 | `f6e9464` (#166) | fg-42 | Merged; privacy policy, redaction, retention/deletion and the tenant-scoped privacy API are complete. |
