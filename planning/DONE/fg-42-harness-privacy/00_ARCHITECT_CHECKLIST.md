---
id: "fg-42"
title: "Harness Privacy and Data Governance"
status: done
priority: "P1"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-22"
pr: 166
branch: null
depends_on: ["fg-30", "fg-34", "fg-41"]
---

# 00 — Harness Privacy and Data Governance (fg-42)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `PromptBuilder`, `PlanningDocFetcher`, `HarnessEvent`, provider config

## Why this ticket exists

The harness sends ticket text, planning docs, source files, diffs and test output to an external model. There is no classification, redaction, provider policy, tenant isolation or retention control for that data.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Implementation merged | PR #166 (`f6e9464`) | ☑ |
| Verification results | `03` → Results; backend 146 suites / 1858 tests at merge | ☑ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Sandbox network/secret boundary | fg-34 | Security | fg-34-harness-sandbox | open |
| D2 | Scoped credentials | fg-35 | Security | fg-35-github-app-credentials | resolved (#143) |
| D3 | Provider routing | fg-38 | Billing | fg-38-harness-budgets-routing | open |
| D4 | Event redaction/retention | fg-41 | Observability | fg-41-harness-observability | open |
| D5 | Legal hold and consent workflow | fg-42 | Compliance | separate privacy/legal workflow ticket | open |
| D6 | Prompt/result cache isolation | fg-42 | Security | extend when a cross-run model cache exists | open |
| D7 | Entropy-threshold and bare-10-digit phone tuning per provider | fg-42 | Security | revisit if false positives/negatives appear in real repos | open |
| D8 | Per-project artifact retention (on-disk workspace deletion is delivered by fg-44/fg-58, #209/#212) | fg-42 | Retention | fg-42-D8 (PENDING) | open |
| D9 | Repo-visibility classification, production changed-path enumeration for path rules, and exhaustive PII classifier (addresses, configurable customer identifiers) | fg-42 | Security | follow-up privacy classifier ticket | open |
| D10 | Keyset/single-snapshot project export for very large projects | fg-42 | Retention | follow-up export job ticket | open |
