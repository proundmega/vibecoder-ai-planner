# bp-116: Planning File Usage UI

## Ticket Information
- **ID**: bp-116
- **Priority**: P2 (UX enhancement)
- **Type**: Feature
- **Scope**: Frontend (backend API already exists)

## Problem Statement

The backend provides `GET /tickets/:ticketId/planning/:fileKey/usage` endpoint (added in bp-100) which returns per-file usage history with token counts, cost, and call history. The frontend API client `getPlanningFileUsage()` is exported but has **zero call sites**. The current `TicketDetail.vue` shows aggregated usage by planning stage but has no way to drill down into per-file usage.

### Current State

**Backend (complete):**
- `GET /tickets/:ticketId/planning/usage` — aggregated by stage + by file
- `GET /tickets/:ticketId/planning/:fileKey/usage` — per-file history (50 most recent calls)
- Response includes: `tokensIn`, `tokensOut`, `costUsd`, `durationMs`, `providerType`, `model`, `planningStage`, `at`

**Frontend (missing):**
- `getPlanningFileUsage()` exported in `client.ts` but never called
- `TicketDetail.vue` shows only the aggregated "AI Usage Breakdown" table
- No UI to expand/collapse per-file usage history

## Solution

Add a collapsible per-file usage breakdown section in `TicketDetail.vue` that:
1. Lists each planning file with its total cost and token count
2. Allows expanding any file to see the full usage history (last 50 calls)
3. Shows provider/model breakdown per call

### UI Design

```
AI Usage Breakdown
┌─────────────────────────────────────────────────────┐
│ Total: $0.0234  |  12,450 in / 8,320 out            │
├─────────────────────────────────────────────────────┤
│ Stage         │ Tokens In │ Tokens Out │ Cost    │ Calls │
│ requirement   │   4,200   │    2,100   │ $0.0089 │   3   │
│ design        │   5,100   │    3,800   │ $0.0098 │   2   │
│ implementation│   3,150   │    2,420   │ $0.0047 │   4   │
├─────────────────────────────────────────────────────┤
│ Planning Files (click to expand)                    │
│ ─ 01_ARCHITECT_REQUIREMENT.md  │ $0.0089 │ 6,300 tokens │
│   ├─ 2024-01-15 14:30:00  claude-sonnet-4  2,100/1,050  │
│   ├─ 2024-01-15 14:35:00  claude-sonnet-4  2,000/1,000  │
│   └─ 2024-01-15 14:40:00  claude-sonnet-4  2,200/1,250  │
│ ─ 02_ARCHITECT_DESIGN.md       │ $0.0098 │ 8,900 tokens │
│   ├─ 2024-01-15 15:00:00  claude-sonnet-4  4,200/3,100  │
│   └─ 2024-01-15 15:10:00  claude-sonnet-4  4,700/3,200  │
└─────────────────────────────────────────────────────┘
```

## Implementation Plan

### 1. TicketDetail.vue — Add per-file usage section

After the existing "AI Usage Breakdown" stage table, add:
- A "Planning Files" section with expandable rows
- Each row shows: file name, total tokens, total cost
- Clicking a row calls `getPlanningFileUsage(ticketId, fileKey)` and shows history table

### 2. Usage data types

Use existing types from `client.ts`:
- `UsageByFile`: `{ fileKey, tokensIn, tokensOut, costUsd }`
- `UsageHistoryEntry`: `{ tokensIn, tokensOut, costUsd, durationMs, providerType, model, planningStage, at }`

### 3. Lazy loading

Only fetch per-file history when a file is expanded (not on initial mount).

## Files to Change

| File | Changes |
|------|---------|
| `frontend/src/views/TicketDetail.vue` | Add per-file usage section with expand/collapse |

## Testing

- Unit: TicketDetail.vue per-file usage expansion tests
- Contract: Verify response shape matches existing types

## Out of Scope

- Backend changes (API already exists)
- Per-file usage alerts/notifications
- Export/download usage data
- Real-time usage tracking during AI calls

## Deferred Improvements Found

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-112 | Java agent unit tests | Testing | bp-118-java-agent-unit-tests |
| 2 | bp-113 | Route-level permission guards | Security | bp-115-route-permission-guards |
| 3 | bp-113 | Route mount audit script | Developer experience | bp-117-route-mount-audit |
| 4 | bp-99 | Runtime provider config hot reload | Feature | bp-119-provider-config-hot-reload |
| 5 | bp-115 | Usage alerts dashboard | UX | (deferred) |
