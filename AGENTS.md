# Vibecode AI Planner - Agent Guide

## Project Status

**Current Date**: May 6, 2026

### Ticket Status Summary

| ID | Title | Priority | Status |
|----|------|-----|--------|
| TKT-001 | Initialize Project Structure | High | ✅ Done |
| TKT-002 | PostgreSQL Database Schema | High | ✅ Done |
| TKT-003 | User Authentication System | High | ✅ Done |
| TKT-004 | Create Projects API Endpoints | High | ✅ Done |
| TKT-005 | Create Tickets API Endpoints | High | ✅ Done |
| TKT-006 | **Create Roles and Permissions API** | **Medium** | **✅ Done** |
| TKT-007 | Create Pricing and Subscription API | Medium | ❌ Pending |
| TKT-008 | Set Up Vue.js Frontend | High | ✅ Done |
| TKT-009 | Implement Authentication UI | High | ✅ Done |
| TKT-010 | Implement Projects View | Medium | ⏸️ Unblocked |
| TKT-011 | Implement Kanban Board Component | High | ❌ Pending |
| TKT-012 | Implement Ticket Detail View | Medium | ⏸️ Unblocked |
| TKT-013 | Design AI Agent API | High | ❌ Pending |
| TKT-014 | Create AI Agent User Experience | Medium | ❌ Pending |
| TKT-015 | Dockerize Backend/Frontend | Medium | ✅ Done |
| TKT-016 | Set Up CI/CD Pipeline | Medium | ❌ Pending |
| TKT-017 | API Documentation | Low | ❌ Pending |
| TKT-018 | Write Integration Tests | Low | ⏸️ Blocked |

### ✅ Completed (TKT-006 Done!)
- Roles and Permissions middleware implemented
- Permission-level access control
- Permission mapping for different user roles

### ⏸️ Unblocked (Ready for Work)
- **TKT-010**: Projects View (was blocked by TKT-006)
- **TKT-012**: Ticket Detail View (was blocked by TKT-006)
- **TKT-018**: Integration Tests (can now use new permissions)

### 🔴 Remaining High Priority
- TKT-011: Kanban Board Component
- TKT-013: AI Agent API

## Architecture

**Monorepo**: `/backend` (Node.js + Express) + `/frontend` (Vue 3 + Vite)

**Database**: PostgreSQL 15 via pool in `db.js`

**Ports**: Frontend 3000, Backend 3001, PGAdmin 5050

## Commands

### Backend
- `npm run dev` - Start server (port 3001) with watch
- `npm test` - Run Jest tests
- `npm test -t "pattern"` - Run specific tests
- `npm run lint` - ESLint

### Frontend
- `npm run dev` - Start dev server (port 3000)
- `npm run build` - Production build (Vite)
- `npm run typecheck` - TypeScript check

### Build Order
```bash
npm run lint → npm test → npm run build
```

## Testing Guidelines

### Backend (Jest)
```bash
cd backend && npm test
cd backend && npm test -t "permissions"
cd backend && npm test -- --coverage
```

### Test Writing Best Practices

1. **Mock database calls** - Use Jest mocks for `pg.Pool.query` to avoid DB connections
2. **Test status transitions** - Validate only allowed workflow: `backlog` → `in_progress` → `review` → `done`
3. **Test ownership validation** - Ensure all mutations check user ownership
4. **Test both success and error paths** - Every public method needs both test cases
5. **Maintain consistent mocks** - Keep mock responses consistent across test files
6. **Test edge cases** - Invalid inputs, permissions, boundary values

## Key Conventions

- JWT tokens: 24h expiry, `Bearer <token>` header
- Permission middleware: `hasPermission`, `isAdmin`, `isMember`
- Rate limiting: 10 requests/60s for all endpoints
- Error handling: Consistent JSON responses with status codes

## Role Definitions

- **ADMIN**: Full system access, manage all resources
- **MEMBER**: Can create tickets/projects, update, change status, assign
- **VIEWER**: Read-only access for viewing resources
- **USER**: Basic role with minimal permissions

## Common Pitfalls

- ❌ Missing `X-API-Key` for agent endpoints
- ❌ Skipping permission middleware
- ❌ Wrong status transition order
- ❌ Hardcoding secrets (use `.env`)
- ❌ Not checking permissions before mutations

## Files Structure

- `backend/src/middleware/permissions.js` - Permission system (✅ NEW)
- `backend/src/middleware/permissions.test.js` - Permission tests (✅ NEW)
- `backend/src/middleware/auth.js` - Auth & rate limiting
- `backend/src/services/` - Business logic with unit tests
- `backend/src/__tests__/jest.setup.js` - Test mocks
- `frontend/src/` - Vue 3 application

## Recent Updates

### Just Completed (TKT-006)
- ✅ Created `permissions.js` middleware with role-based access control
- ✅ Added permission constants and role mappings
- ✅ Implemented `hasPermission()`, `isAdmin()`, `isMember()` helpers
- ✅ Added `isProjectOwner()` and `isResourceOwner()` checks
- ✅ Created comprehensive unit tests for permission middleware
- ✅ Updated `AGENTS.md` with ticket status and testing guidelines

## Next Steps (Priority Order)

1. **TKT-010**: Implement Projects View (now unblocked)
2. **TKT-012**: Implement Ticket Detail View (now unblocked)
3. **TKT-018**: Write Integration Tests (can use new permissions)
4. **TKT-011**: Build Kanban board component
5. **TKT-013**: Implement AI Agent API with API key auth

## Code Quality

- Follow IPEE: Identify → Plan → Execute → Evaluate
- Plan 80% before coding, then test
- Add extensive unit tests for all changes
- Test first, refactor after
