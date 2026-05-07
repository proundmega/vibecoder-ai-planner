# Vibecode AI Planner - Agent Guide

## Project Status

**Current Date**: May 7, 2026

### Ticket Status Summary

| ID | Title | Priority | Status |
|----|------|----------|--------|
| TKT-001 | Initialize Project Structure | High | ✅ Done |
| TKT-002 | PostgreSQL Database Schema | High | ✅ Done |
| TKT-003 | User Authentication System | High | ✅ Done |
| TKT-004 | Create Projects API Endpoints | High | ✅ Done |
| TKT-005 | Create Tickets API Endpoints | High | ✅ Done |
| TKT-006 | Create Roles and Permissions API | Medium | ✅ Done |
| TKT-010 | Implement Projects View | High | ✅ Done |
| TKT-011 | Kanban Board Component | High | ✅ Done |
| TKT-012 | Ticket Detail View | Medium | ✅ Done |
| TKT-018 | Write Integration Tests | Low | ⏸️ Blocked |

### ✅ Completed
- Roles and Permissions middleware (TKT-006)
- Projects View (TKT-010)
- Kanban Board Component (TKT-011)
- Ticket Detail View (TKT-012)

## Architecture

**Monorepo**: `/backend` (Node.js + Express) + `/frontend` (Vue 3 + Vite)

**Database**: PostgreSQL 15

**Ports**: Frontend 3000, Backend 3001

## Commands

### Backend
- `npm run dev` - Start server (port 3001)
- `npm test` - Run Jest tests
- `npm run lint` - ESLint

### Frontend  
- `npm run dev` - Start dev server (port 3000)
- `npm run build` - Production build (Vite)

## Testing Guidelines

### Backend (Jest)
- Mock database calls (pg.Pool.query, bcrypt, uuid, jwt)
- Test status transitions: backlog → in_progress → review → done
- Test ownership validation

## Key Files

- `backend/src/middleware/permissions.js` - Role-based access control
- `backend/src/middleware/permissions.test.js` - Permission tests (21 passing)
- `backend/src/__tests__/jest.setup.js` - Test mocks
- `frontend/src/views/TicketBoard.vue` - Kanban board (TKT-011)
- `frontend/src/views/ProjectList.vue` - Projects view (TKT-010)
- `frontend/src/views/TicketDetail.vue` - Ticket detail (TKT-012)
- `frontend/src/api/tickets.js` - Ticket API functions
- `frontend/src/api/projects.js` - Project API functions

## Remaining Work

- TKT-018: Write Integration Tests
- TKT-013: Design AI Agent API
- TKT-014: Create AI Agent User Experience
