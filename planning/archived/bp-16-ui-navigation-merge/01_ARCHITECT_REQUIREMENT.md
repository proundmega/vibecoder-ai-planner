# bp-16-ui-navigation-merge — Requirement

## Problem
Users navigating to child routes (ticket detail, ticket board, AI assistant) lose access to project-level tabs (GitHub, AI Providers, Usage & Billing, Memory). The navigation is fragmented — there's no way to switch between ticket-level work and project-level settings without going back to the project list.

Additionally, AIAssistant.vue exists as a completely separate page at `/projects/:id/ai`, duplicating the "AI" concept that could live alongside the other project tabs.

## Scope

### In scope
1. Make project-level tabs accessible from all child routes (ticket detail, ticket board, AI assistant)
2. Integrate AIAssistant functionality into the project tab structure
3. Ensure consistent navigation — user can navigate from any page within a project without losing context
4. Preserve existing functionality — no features removed, only reorganized

### Out of scope
- Redesigning the tab content itself (GitHub, Providers, Memory tabs keep their current UI)
- Changing the ticket detail page layout (attachments, comments, planning stay as-is)
- Backend API changes
- Mobile/responsive redesign

## Acceptance Criteria

1. **Tabs always visible** — When on any project child route (`/projects/:id/tickets`, `/projects/:id/tickets/:ticketId`, `/projects/:id/ai`), the project tabs remain visible
2. **AI integrated** — AIAssistant functionality is accessible as a tab (renamed "AI" or "AI Chat") within ProjectDetail, not a separate page
3. **No navigation breakage** — Clicking a ticket still shows ticket details; clicking a tab switches to that tab's content
4. **Back button works** — Browser back button navigates correctly within the project context
5. **All existing tests pass** — No regression in existing Cypress or Vitest tests

## Testing Checklist

- [ ] Navigate to `/projects/:id` — tabs visible, all 5 tabs render
- [ ] Click a ticket → `/projects/:id/tickets/:ticketId` — tabs still visible, ticket detail renders
- [ ] Click "GitHub" tab from ticket detail — GitHub tab content renders, ticket detail hidden
- [ ] Click "AI" tab — AI chat interface renders (previously separate page)
- [ ] Click "Usage & Billing" tab — usage data renders
- [ ] Click "Memory" tab — memory search/list renders
- [ ] Click "AI Providers" tab — provider management renders
- [ ] Navigate to `/projects/:id/tickets` — tabs visible, Kanban board renders
- [ ] Browser back from ticket detail → ticket board (not project list)
- [ ] All existing Cypress e2e tests pass (01-07)
- [ ] All existing Vitest unit tests pass
