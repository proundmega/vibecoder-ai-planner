---
id: "bp-124"
title: "Audit Open Defects"
status: planned
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["bp-123"]
---

# 00 — Audit Open Defects (bp-124)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Source:** `AUDIT_REPORT.md` sections "Open defects and risks (not changed)" O1-O8

## Why this ticket exists

PR #100 fixed the audited defects that were in scope. The audit also found eight open defects that were intentionally not changed. They need owners and acceptance criteria so they do not disappear.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | O1 milestone persistence | audit | Backend | bp-125-milestone-write-api | open |
| D2 | O2 dead SQL/tables | audit | Backend | bp-126-dead-sql-cleanup | open |
| D3 | O3 E2E rewrite + CI | audit | Testing | bp-127-cypress-e2e | open |
| D4 | O4 agent identity | audit | Agent / DB | bp-128-agent-identity | open |
| D5 | O5 validator camelCase | audit | Frontend | bp-129-validator-camelcase | open |
| D6 | O6 PUT response type | audit | Backend / Frontend | bp-130-ticket-update-contract | open |
| D7 | O7 docs drift | audit | Docs | bp-131-docs-sync | open |
| D8 | O8 integration setup | audit | Testing | bp-132-integration-setup-errors | open |
| D9 | O1-O10 umbrella | bp-123 | Multiple | bp-124-audit-open-defects | open |
| D10 | Full SQL grammar validation (O10) | bp-79 | Backend | bp-124-audit-open-defects | open |
| D11 | Harness roadmap | fg-30 | Agent | fg-33+ | open |
