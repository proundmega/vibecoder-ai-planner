---
id: "bp-123"
title: "Test Audit Corrections"
status: in_review
priority: "P0"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["bp-124"]
---

# 00 — Test Audit Corrections (bp-123)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Baseline:** master `cc334a1` after PR #99
**Report:** `AUDIT_REPORT.md`

## Why this ticket exists

A full test/quality audit found real backend and frontend defects that were not covered by tests. This ticket records the audit scope, the fixes, the regression coverage and the remaining open defects.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Component tests for edit modal/detail and assignment E2E | audit | Testing | bp-124-audit-open-defects (O9) | open |
| D2 | Integration setup should fail on migration errors | audit | Testing | bp-124-audit-open-defects | open |
| D3 | Migrate frontend validator to camelCase | audit | Frontend | bp-124-audit-open-defects | open |
| D4 | Move completed suites to `planning/DONE/` | audit | Docs | bp-124-audit-open-defects | open |
| D5 | O1-O10 open defects | audit | Multiple | bp-124-audit-open-defects | open |
| D6 | Reconcile agent identity (`assigned_agent_id`) | audit | Agent | bp-124-audit-open-defects | open |
| D7 | Remove dead SQL or add missing tables | audit | Backend | bp-124-audit-open-defects | open |
| D8 | Full SQL grammar validation in dry-run | bp-79 | Backend | bp-124-audit-open-defects (O10) | open |
