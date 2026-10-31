# 00_ARCHITECT_CHECKLIST.md - Harness Privacy and Data Governance (fg-42)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-34 sandbox, fg-41 observability
**Related code:** `PromptBuilder`, `PlanningDocFetcher`, `HarnessEvent`, provider config

## Why this ticket exists

The harness sends ticket text, planning docs, source files, diffs and test output to an external model. There is no classification, redaction, provider policy, tenant isolation or retention control for that data.

## Checklist

- [ ] Define data classification (public/internal/confidential/secret)
- [ ] Add pre-flight redaction and secret scanning
- [ ] Add post-flight output scanning
- [ ] Define provider allowlist and retention policy per project
- [ ] Enforce tenant/project isolation in prompts, logs and artifacts
- [ ] Define retention/deletion for run data
- [ ] Add local-model option for sensitive repos
- [ ] Add audit and consent/recording controls
- [ ] Test secrets, PII, tenant isolation and provider policy
