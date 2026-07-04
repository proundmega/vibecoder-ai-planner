# bp-16-ui-navigation-merge — Pre-Implementation Checklist

## Existing Infrastructure Audit

### What already exists:
- **ProjectDetail.vue** — tabs: Tickets, GitHub, AI Providers, Usage & Billing, Memory
- **TicketDetail.vue** — ticket sections: info, transitions, attachments, comments, planning
- **AIAssistant.vue** — standalone AI chat at `/projects/:id/ai`
- **TicketBoard.vue** — Kanban board at `/projects/:id/tickets`
- **Router** — nested routes under `/projects/:id` with children for tickets, tickets/:ticketId, ai
- **Auth guard** — localStorage-based, checks `vibecode_token`

### Navigation structure:
```
/projects/:id          → ProjectDetail.vue (tabs visible, isChildRoute=false)
/projects/:id/tickets  → TicketBoard.vue (child route, tabs hidden)
/projects/:id/tickets/:ticketId → TicketDetail.vue (child route, tabs hidden)
/projects/:id/ai       → AIAssistant.vue (child route, tabs hidden)
```

### Key issue:
`isChildRoute = route.name !== 'ProjectDetail'` — when navigating to any child route, tabs are hidden. Users drilling into tickets lose access to project-level settings.

## Pre-Implementation Checklist

- [ ] Read ProjectDetail.vue template (lines 391-700) — tab rendering logic
- [ ] Read TicketDetail.vue template (lines 295-460) — ticket sections
- [ ] Read AIAssistant.vue template (lines 159-250) — standalone AI chat
- [ ] Read router/index.ts — route structure and children
- [ ] Check if any API calls are duplicated between views
- [ ] Verify ProjectDetail tabs load data correctly on mount
- [ ] Confirm AIAssistant API endpoints vs ProjectDetail AI Providers API
- [ ] Check CSS for tab styling conflicts between views
- [ ] Review if `isChildRoute` logic can be improved
- [ ] Decide: keep AIAssistant as separate page or merge into tabs
