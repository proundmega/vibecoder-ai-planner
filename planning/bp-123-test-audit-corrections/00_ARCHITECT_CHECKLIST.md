# 00_ARCHITECT_CHECKLIST.md - Test Audit Corrections (bp-123)

**Status:** implemented (PR #100, in review)
**Date:** 2026-10-31
**Baseline:** master `cc334a1` after PR #99
**Report:** `AUDIT_REPORT.md`

## Why this ticket exists

A full test/quality audit found real backend and frontend defects that were not covered by tests. This ticket records the audit scope, the fixes, the regression coverage and the remaining open defects.

## Checklist

- [x] Audit backend models, services, routes, migrations and tests
- [x] Audit frontend views, API clients and component specs
- [x] Fix ticket assignee validation (`project_memberships`)
- [x] Stop serializing bcrypt `passwordHash`
- [x] Fix login lockout `Retry-After: NaN`
- [x] Preserve assignee/project names in ticket models
- [x] Fix ticket create response IDs and detail field names
- [x] Allow no-op status updates while rejecting invalid transitions
- [x] Add `critical` priority migration and propagation
- [x] Implement `db:migrate:dry-run` without a database
- [x] Guard POSIX permissions for Windows local development
- [x] Refresh stale Cypress component specs
- [ ] Move completed planning suites to `planning/DONE/`
- [ ] Resolve audit open defects O1-O8 (`bp-124`)
