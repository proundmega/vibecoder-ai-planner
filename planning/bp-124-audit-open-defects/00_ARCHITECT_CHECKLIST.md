# 00_ARCHITECT_CHECKLIST.md - Audit Open Defects (bp-124)

**Status:** planned
**Date:** 2026-10-31
**Source:** `AUDIT_REPORT.md` sections "Open defects and risks (not changed)" O1-O8
**Depends on:** bp-123 (audit corrections)

## Why this ticket exists

PR #100 fixed the audited defects that were in scope. The audit also found eight open defects that were intentionally not changed. They need owners and acceptance criteria so they do not disappear.

## Checklist

- [ ] Triage O1-O8 and assign priorities/owners
- [ ] Create per-defect planning suites when scheduled
- [ ] Fix O1 milestone field persistence
- [ ] Fix O2 dead SQL / missing tables
- [ ] Rewrite and wire Cypress E2E (O3)
- [ ] Reconcile agent identity semantics (O4)
- [ ] Migrate frontend validator to camelCase (O5)
- [ ] Fix `PUT /tickets/:id` response type (O6)
- [ ] Finish docs drift cleanup (O7)
- [ ] Make integration setup fail on migration errors (O8)
- [ ] Move completed planning suites to `planning/DONE/`
