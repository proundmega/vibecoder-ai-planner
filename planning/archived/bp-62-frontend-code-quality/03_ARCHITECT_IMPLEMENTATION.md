# 03_ARCHITECT_IMPLEMENTATION.md — Frontend Code Quality Improvements

**Status**: planned
**Priority**: P3
**Effort**: Medium

---

### Implementation Order

1. **Extract `ProjectDetail.vue` tabs** — Create 7 tab components, refactor ProjectDetail to route to them
2. **Extract `TicketDetail.vue` sections** — Create 5 section components, refactor TicketDetail
3. **Fix `AIAssistant.vue` stubs** — Remove mock code, show placeholder
4. **Fix error state bugs** — `ProjectList.vue` deleteError → editError, `ProjectDetail.vue` updateProvider form reset
5. **Fix `TicketBoard.vue`** — Rename local `canUpdateTicket`, add `:key`, use createTicket result
6. **Fix `BillingDashboard.vue`** — Extract .reduce() to computed property
7. **Fix `DiffViewer.vue`** — Add `:key`
8. **Remove dead code** — `formatMaxSize()` in TicketDetail
9. **Replace `alert()`** in AIAssistant with inline error state

### Per-File Changes

#### `ProjectDetail.vue` (MODIFY) + new files (CREATE)
- Move each tab panel to its own component under `components/`
- Components receive same props (project, loading states, etc.)
- Tab switching becomes component switching

#### `TicketDetail.vue` (MODIFY) + new files (CREATE)
- Extract comment list/form to `TicketCommentSection.vue`
- Extract attachment list/upload to `TicketAttachmentSection.vue`
- Extract phase flow to `TicketPhaseFlow.vue`
- Extract approval workflow to `TicketApprovalSection.vue`
- Extract header info to `TicketInfo.vue`

#### `AIAssistant.vue` (MODIFY)
- Replace `processUserPrompt()` body with `return { reply: 'AI Assistant is not yet implemented.' }`
- Replace `handleScan()` with no-op
- Remove `handleQuickAction()` or reduce to selection only
- Replace `alert()` with reactive `errorMessage` ref shown in template

### Testing

- [ ] `ProjectDetail.vue` — all 7 tabs load and display correctly
- [ ] `TicketDetail.vue` — all sections load and display correctly
- [ ] `AIAssistant.vue` — shows "Not yet implemented" message, no stubs
- [ ] `ProjectList.vue` — edit error shows correct message
- [ ] `TicketBoard.vue` — drag-and-drop still works, create ticket adds to list
- [ ] `BillingDashboard.vue` — totals compute correctly
- [ ] `npm test -- --run` — all tests pass
- [ ] `npm run build` — builds successfully
- [ ] `npm run typecheck` — no TS errors
