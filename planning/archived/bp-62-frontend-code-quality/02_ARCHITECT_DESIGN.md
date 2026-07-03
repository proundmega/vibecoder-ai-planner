# 02_ARCHITECT_DESIGN.md — Frontend Code Quality Improvements

**Status**: Working draft

---

## Design

### God Components Extraction

#### `ProjectDetail.vue` (~1518 lines)

Current structure — 7+ feature areas inlined:
```
ProjectDetail.vue
├── Tab bar (tabs: GitHub, Providers, Memory, Templates, Usage, Billing, Approvals)
├── GitHub panel (~200 lines)
├── Providers panel (~250 lines)
├── Memory panel (~150 lines)
├── Templates panel (~150 lines)
├── Usage panel (~100 lines)
├── Billing panel (~100 lines)
├── Approvals panel (~150 lines)
└── Shared state (refs, computed, methods)
```

Target structure:
```
ProjectDetail.vue (~200 lines — tab bar + routing)
├── components/ProjectGitHubTab.vue
├── components/ProjectProvidersTab.vue
├── components/ProjectMemoryTab.vue
├── components/ProjectTemplatesTab.vue
├── components/ProjectUsageTab.vue
├── components/ProjectBillingTab.vue
└── components/ProjectApprovalsTab.vue
```

#### `TicketDetail.vue` (~1196 lines)

Current structure — 4+ sections inlined:
```
TicketDetail.vue
├── Ticket info header (~100 lines)
├── Status transitions (~150 lines)
├── Comment section (~200 lines)
├── Attachment section (~150 lines)
├── Planning/Phase section (~200 lines)
├── Approval workflow (~100 lines)
└── Edit modal (~200 lines)
```

Target structure:
```
TicketDetail.vue (~200 lines)
├── components/TicketInfo.vue
├── components/TicketCommentSection.vue
├── components/TicketAttachmentSection.vue
├── components/TicketPhaseFlow.vue
├── components/TicketApprovalSection.vue
└── components/TicketEditModal.vue (already exists!)
```

### AIAssistant Stub Resolution
- Option A: Remove stub code and show "Coming Soon" placeholder
- Option B: Implement real API calls to agent endpoints (larger scope)
- **Decision**: Option A — remove misleading stubs, show clear "Not yet implemented" message. Option B is a separate feature ticket.

---

## File-Level Impact Matrix

| File | Action |
|------|--------|
| `frontend/src/views/ProjectDetail.vue` | MODIFY — extract tabs |
| `frontend/src/components/ProjectGitHubTab.vue` | CREATE |
| `frontend/src/components/ProjectProvidersTab.vue` | CREATE |
| `frontend/src/components/ProjectMemoryTab.vue` | CREATE |
| `frontend/src/components/ProjectTemplatesTab.vue` | CREATE |
| `frontend/src/components/ProjectUsageTab.vue` | CREATE |
| `frontend/src/components/ProjectBillingTab.vue` | CREATE |
| `frontend/src/components/ProjectApprovalsTab.vue` | CREATE |
| `frontend/src/views/TicketDetail.vue` | MODIFY — extract sections |
| `frontend/src/components/TicketCommentSection.vue` | CREATE |
| `frontend/src/components/TicketAttachmentSection.vue` | CREATE |
| `frontend/src/components/TicketPhaseFlow.vue` | CREATE |
| `frontend/src/components/TicketApprovalSection.vue` | CREATE |
| `frontend/src/components/TicketInfo.vue` | CREATE |
| `frontend/src/views/AIAssistant.vue` | MODIFY — remove stubs |
| `frontend/src/views/ProjectList.vue` | MODIFY — fix error state |
| `frontend/src/views/TicketBoard.vue` | MODIFY — fix canUpdateTicket + add :key + use createTicket result |
| `frontend/src/views/BillingDashboard.vue` | MODIFY — extract reduce to computed |
| `frontend/src/views/TicketDetail.vue` | MODIFY — remove formatMaxSize dead code |
| `frontend/src/components/DiffViewer.vue` | MODIFY — add :key |

---

## Dependencies

- No new npm dependencies
- Component extraction preserves all existing data flow (props, emits, store access)
