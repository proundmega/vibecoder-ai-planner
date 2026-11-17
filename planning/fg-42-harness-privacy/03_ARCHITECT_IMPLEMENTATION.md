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
| `backend/src/services/HarnessPrivacyService.js` | add | Policy read/update, provider/residency/no-training/local-only enforcement, deletion with audit tombstone, export. |
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
| `agent/src/main/java/com/vibecode/agent/harness/SecretRedactor.java` | edit | Adds a conservative high-entropy token rule beside the known credential formats. |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | edit | Loads the policy, redacts before prompting, enforces local-only/model, scans verification output and PR text, emits `privacy.decision`. |
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
| `frontend/src/__tests__/harnessObservabilityApi.test.ts` | edit | Privacy policy, deletion and export calls. |

## Dependencies

- fg-30, fg-34, fg-41

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Agent | `HarnessDataClassifierTest.java` | Public, internal, confidential and secret classification; most restrictive wins | `cd agent && mvn -Dtest=HarnessDataClassifierTest test` |
| FR2 | Agent | `HarnessPrivacyPipelineTest.java`, `PiiRedactorTest.java`, `HarnessTicketProcessorTest.java` | Prompt secrets/PII redacted before `sendPrompt`; no token or email in the prompt | `cd agent && mvn -Dtest='HarnessPrivacyPipelineTest,PiiRedactorTest,HarnessTicketProcessorTest' test` |
| FR3 | Agent | `SecretRedactorTest.java`, `HarnessDataClassifierTest.java` | Known-format and high-entropy secret scan; policy event emitted | `cd agent && mvn -Dtest='SecretRedactorTest,HarnessDataClassifierTest' test` |
| FR4 | Agent | `HarnessPrivacyPipelineTest.java` | Verification output and PR text scanned/redacted before publishing | `cd agent && mvn -Dtest=HarnessPrivacyPipelineTest test` |
| FR5 | Backend | `harnessPrivacyService.test.js`, `api-harness-runs.test.js` | Allowlist, no-training, residency, local-only and start-response handoff | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js src/__tests__/api-harness-runs.test.js --runInBand` |
| FR6 | Backend | `api-harness-observability.test.js` | Non-member cannot read, export or delete project privacy data | `cd backend && npx jest src/__tests__/api-harness-observability.test.js --runInBand` |
| FR7 | Backend | `harnessPrivacyService.test.js`, `harnessEventService.test.js`, `integration/harnessPrivacyMigration.test.js` | Deletion by class/before keeps audit tombstone; per-project retention; migration rollback | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js src/__tests__/harnessEventService.test.js src/__tests__/integration/harnessPrivacyMigration.test.js --runInBand` |
| FR8 | Backend + Agent | `harnessPrivacyService.test.js`, `HarnessPrivacyPolicyTest.java` | Local-only requires the configured endpoint; local model overrides routing | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js --runInBand` and `cd agent && mvn -Dtest=HarnessPrivacyPolicyTest test` |
| FR9 | Backend | `harnessAuditService.test.js`, `api-harness-observability.test.js` | Policy changes and deletion emit `audit.privacy` without the secret | `cd backend && npx jest src/__tests__/harnessAuditService.test.js src/__tests__/api-harness-observability.test.js --runInBand` |
| FR10 | Backend + Agent | `harnessPrivacyService.test.js`, `HarnessPrivacyPipelineTest.java` | Policy read/redaction failure aborts instead of sending data | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js --runInBand` and `cd agent && mvn -Dtest=HarnessPrivacyPipelineTest test` |
| NFR5 | Backend + Agent | `harnessPrivacyService.test.js`, `HarnessTicketProcessorTest.java`, `harnessAuditService.test.js` | Stored prompts/events/audit contain no token or PII | `cd backend && npx jest src/__tests__/harnessPrivacyService.test.js src/__tests__/harnessAuditService.test.js --runInBand` |

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
| 2026-11-17 | `aa701b0` (#166) | Backend 146 suites / 1847 tests; Agent 772 tests (9 skipped); Frontend 61 files / 574 tests; real-Postgres integration 15 suites / 156 tests | Implementation complete on `feat/fg-42-harness-privacy`; PR opened for review |
