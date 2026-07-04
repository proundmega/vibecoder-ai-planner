# 01_ARCHITECT_REQUIREMENT.md — Frontend Code Quality Improvements

**Status**: planned
**Priority**: P3
**Effort**: Medium
**Scope**: Frontend

---

## Requirement

Fix remaining frontend quality issues: god components, broken UI logic, dead code, accessibility problems, and pattern violations.

### Issues Addressed

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | `ProjectDetail.vue` (1518 lines) — 7+ feature areas in one file | MEDIUM | `views/ProjectDetail.vue` |
| 2 | `TicketDetail.vue` (1196 lines) — edit modal, comments, attachments, planning, approvals all in one file | MEDIUM | `views/TicketDetail.vue` |
| 3 | `AIAssistant.vue` — `processUserPrompt` only handles `'scan'`, `handleScan` is mock/stub | MEDIUM | `views/AIAssistant.vue:115-136` |
| 4 | `updateProvider` calls `showEditProvider` right after saving — resets form to stale data | MEDIUM | `views/ProjectDetail.vue:269-270` |
| 5 | `ProjectList.vue` uses `deleteError` for edit failures | MEDIUM | `views/ProjectList.vue:81` |
| 6 | `TicketBoard.vue` — local `canUpdateTicket` shadows store method | MEDIUM | `views/TicketBoard.vue:87` |
| 7 | `TicketBoard.vue` — missing `:key` on `v-for="columnDef in statusColumns"` | LOW | `views/TicketBoard.vue:161` |
| 8 | `DiffViewer.vue` — missing `:key` on comment loop | LOW | `components/DiffViewer.vue:139` |
| 9 | `UserManagement.vue` — TODO comment about showing user ID instead of creator name | LOW | `views/UserManagement.vue:37` |
| 10 | `BillingDashboard.vue` — same `.reduce()` logic duplicated 5 times in template | LOW | `views/BillingDashboard.vue:51,57,63,69,101` |
| 11 | `TicketDetail.vue` — `formatMaxSize()` is dead code | LOW | `views/TicketDetail.vue:166-168` |
| 12 | `TicketBoard.vue` — ignores result of `createTicket`, always re-fetches list | LOW | `views/TicketBoard.vue:99` |
| 13 | No `aria-label` on icon-only buttons (emoji buttons) | LOW | Multiple view files |
| 14 | `AIAssistant.vue` uses `alert()` for error feedback | LOW | `views/AIAssistant.vue:87` |

---

## Scope

### In Scope
1. Extract `ProjectDetail.vue` tabs into separate component files (GitHub, Providers, Memory, Templates, Usage, Billing, Approvals)
2. Extract `TicketDetail.vue` sections into separate components (CommentSection, AttachmentSection, PhaseFlow)
3. Remove stub code from `AIAssistant.vue` or implement proper API calls
4. Fix `updateProvider` post-save form reset
5. Fix `ProjectList.vue` error state variable misuse
6. Rename or merge `TicketBoard.vue` local `canUpdateTicket` to avoid shadowing
7. Add `:key` to all `v-for` loops missing it
8. Replace `alert()` with proper error display in `AIAssistant.vue`
9. Extract repeated `.reduce()` in `BillingDashboard.vue` to computed property
10. Remove `formatMaxSize()` dead code
11. Use `createTicket` result to optimistically add to list

### Out of Scope
- Full view rewrites (extraction only)
- Backend changes
- CSS redesign (covered in bp-56)

---

## Acceptance Criteria

1. [ ] `ProjectDetail.vue` tabs extracted to separate component files
2. [ ] `TicketDetail.vue` sections extracted to separate component files
3. [ ] `AIAssistant.vue` either has working API calls or stubs are clearly marked
4. [ ] No `alert()` calls remain in production code
5. [ ] All `v-for` loops have `:key`
6. [ ] No dead code (`formatMaxSize`, unused functions)
7. [ ] All views render identically to before
8. [ ] All tests pass
