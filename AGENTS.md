# Vibecode AI Planner - Agent Guide

## Architecture

**Monorepo**: `/backend` (Node.js + Express) + `/frontend` (Vue 3 + Vite)

**Database**: PostgreSQL 15 via pool in `db.js`

**Ports**: Frontend 3000, Backend 3001, PGAdmin 5050

## Setup

```bash
# Quick Start
docker-compose up -d

# Manual Setup
docker run --name vibecode-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15
cd backend && npm install && npm run dev
cd ../frontend && npm install && npm run dev
```

## Commands

### Backend
- `npm run dev` - Start server (port 3001)
- `npm test` - Run Jest tests
- `npm test -t "pattern"` - Run specific tests (e.g., `npm test -t "updateStatus"`)
- `npm run lint` - ESLint

### Frontend
- `npm run dev` - Start dev server (port 3000)
- `npm run build` - Production build
- `npm run test` - Vitest tests
- `npm run typecheck` - TypeScript check

### Build Order
```bash
npm run lint → npm test → npm run build
```

## Testing Guidelines

**Backend (Jest):**
- Test files: `src/**/*.test.js` in `__tests__` folder or same directory
- Mocks: `src/__tests__/jest.setup.js` (pg, bcrypt, uuid, jwt, winston, express, supertest)
- Coverage: `npm test -- --coverage`

**Frontend (Vitest):**
- TypeScript: `npm run typecheck`

**Best Practices:**
1. Mock database calls - avoid actual DB connections in tests
2. Test edge cases - invalid inputs, permissions, boundary values
3. Test ownership validation - ensure all mutations check ownership
4. Test status transitions - validate allowed workflow transitions only
5. Test both happy path AND error cases - every public method needs both
6. Maintain consistent mocks across test files
7. Write tests before coding - follow TDD pattern
8. Add extensive unit tests - test all functions/methods thoroughly
9. Test async operations - verify Promise rejections and resolutions
10. Test error conditions - invalid input, permission denied, network errors

## Ticket Status Workflow

Valid transitions only: `backlog` → `in_progress` → `review` → `done`

Invalid transitions throw errors in:
- `TicketService.updateStatus()`
- `Ticket.updateStatus()`

Allowed statuses: `['backlog', 'in_progress', 'review', 'done']`

## Authentication

- POST `/api/auth/login` → JWT token (24h expiry)
- Token format: `Bearer <token>` in `Authorization` header
- `verifyToken` middleware: extracts user, sets `req.user`
- Invalid/missing token → 401

## Agent Endpoints

- Require `X-API-Key` header
- Valid keys: `test-*` prefix or `mock-agent-key`
- Missing/invalid key → 401
- Rate limit: 10 requests per 60s → 429

## Models

- **User**: `id, email, name, role, password_hash, current_plan`
- **Project**: `id, name, description, owner_id`
- **Ticket**: `id, project_id, title, description, status, priority, assignee_id, owner_id`

## Common Pitfalls

- ❌ Missing `X-API-Key` for agent endpoints
- ❌ Skipping `verifyToken` middleware
- ❌ Wrong ticket status transition order
- ❌ Hardcoding secrets (use `.env`)
- ❌ Not checking user ownership before mutations
- ❌ Creating db connection without releasing client
- ❌ Running tests without proper mocks

## Code Quality

- Follow IPEE: Identify → Plan → Execute → Evaluate
- Plan 80% before coding, implement after testing
- Add extensive unit tests for all changes
- Test first, then refactor

## Files to Read First

- `backend/src/index.js` - Entry point, middleware
- `backend/src/middleware/auth.js` - Auth, rate limiting
- `backend/src/services/TicketService.js` - Business logic
- `backend/src/db.js` - DB pool setup
- `backend/src/__tests__/jest.setup.js` - Test mocks
- `frontend/src/App.vue` - Main layout
- `frontend/src/api/` - API client
