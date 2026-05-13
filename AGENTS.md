# Vibecode AI Planner - Agent Guide

## Architecture Overview

### Monorepo Structure
```
/home/ubuntu/vibecode/vibecoder-ai-planner/
├── backend/          # Node.js + Express API server (port 3001)
│   ├── src/
│   │   ├── api/     # API routes & controllers
│   │   ├── models/  # Database models
│   │   ├── services/# Business logic layer
│   │   ├── middleware/ # Auth, permissions, rate limiting
│   │   ├── migrations/ # DB schema migrations
│   │   └── index.js # App entry point
├── frontend/         # Vue 3 SPA with Vite (port 3000)
│   └── src/
│       ├── views/   # Page components
│       ├── components/ # Reusable components
│       ├── api/     # API client functions
│       ├── stores/  # Pinia state management
│       └── router/  # Vue Router config
├── docker-compose.yml # Service definitions
└── tickets.txt       # Development task list
```

### Technology Stack
- **Backend**: Node.js, Express, PostgreSQL 15, Jest
- **Frontend**: Vue 3, Vite, Pinia, Vue Router
- **Auth**: JWT (jsonwebtoken + bcryptjs)

### Ports
- Frontend: 3000
- Backend API: 3001
- PostgreSQL: 5432
- PgAdmin: 5050

## Running the Application

### Docker (Recommended)
```bash
# Set JWT_SECRET (required by compose)
export JWT_SECRET="your-secret-key-here"

# Start all services
docker-compose up -d

# Access services
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001  
# - PgAdmin: http://localhost:5050 (admin@vibecode.local / admin)

# Stop
docker-compose down
```

### Manual Setup
```bash
# PostgreSQL
docker run --name vibecode-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15

# Backend
cd backend
npm install
npm run dev          # Express server watch mode (port 3001)

# Frontend (separate terminal)
cd frontend
npm install
npm run dev          # Vite dev server (port 3000)
npm run build        # Production build
```

### Database Setup
```bash
cd backend
npm run db:migrate   # Apply schema migrations
npm run db:reset     # Re-run migrations
```

## Development Workflow

### Commands
```bash
# Backend
npm run dev          # Start server (watch mode)
npm test             # Run Jest tests
npm run lint         # ESLint check
npm run build        # Production build

# Frontend
npm run dev          # Vite dev server
npm run build        # Production build
npm run lint         # ESLint check
npm run typecheck    # Vue-TSC type checking
npm test             # Vitest tests
```

### Git Workflow
1. Create feature branch from main/develop
2. Update AGENTS.md with any repo-specific conventions
3. Verify all tests pass before PR

## Testing

### Backend Tests
```bash
cd backend
npm test          # Run all tests
npm test -- --listTests  # List test files
```

**Note**: Jest uses mocks in `backend/src/__tests__/jest.setup.js`. Mock files define database interactions.

### Frontend Tests
```bash
cd frontend
npm test          # Run Vitest tests
```

### Test Patterns
- Unit tests: Test services/models in isolation with mocks
- Integration tests: Test full API endpoints with supertest
- Frontend: Test components with Vitest + Vue testing utils

## Permissions & Roles

### User Roles
- `user` - Basic user, can create projects
- `admin` - Full system access

### Permission Checks
Use `backend/src/middleware/permissions.js`:
```javascript
const { hasPermission } = require('./permissions');
const isAdmin = require('./permissions').isAdmin;
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create user (returns user with token)
- `POST /api/auth/login` - Get JWT token
- `GET /api/auth/me` - Get current user

### Projects
- `GET /api/projects` - List user's projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project
- `GET /api/projects/:id/tickets` - List project's tickets
- `POST /api/projects/:id/tickets` - Create ticket in project

### Tickets
- `GET /api/tickets/:id` - Get ticket detail
- `POST /api/tickets/:id/status` - Change status (validated)
- `PUT /api/tickets/:id` - Update ticket
- `DELETE /api/tickets/:id` - Delete ticket

### AI Agents
- `POST /api/agents/create` - Create agent with API key
- `GET /api/agents` - List user's agents
- `DELETE /api/agents/:id` - Delete agent
- `GET /api/agents/:id/key` - Get agent key info (truncated)
- `GET /api/agents/:id/history` - Get agent activity stats

**Agent Usage**: Set `x-api-key` header with generated agent key

### Pricing
- `GET /api/pricing/tiers` - Get subscription tiers

## AI Agent API

Agents can create and manage tickets programmatically via X-API-Key header.

### Create Agent
```bash
curl -X POST http://localhost:3001/api/agents/create \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Agent"}'
```

### Create Ticket (via API Key)
```bash
curl -X POST http://localhost:3001/api/agents/tickets/create \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "x-api-key: test-my-agent" \
  -H "Content-Type: application/json" \
  -d '{"projectId": "xxx", "title": "Bug fix", "description": "..."}'
```

### Update Ticket (via API Key)
```bash
curl -X POST http://localhost:3001/api/agents/tickets/edit/{ticketId} \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "x-api-key: test-my-agent" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "title": "Updated"}'
```

### Claim Ticket for Agent
```bash
curl -X POST http://localhost:3001/api/agents/tickets/claim/{ticketId} \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "x-api-key: test-my-agent"
```

### Change Ticket Status (via API Key)
```bash
curl -X POST http://localhost:3001/api/agents/tickets/status/{ticketId} \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "x-api-key: test-my-agent" \
  -H "Content-Type: application/json" \
  -d '{"status": "review"}'
```

### Get Assigned Tickets (via API Key)
```bash
curl http://localhost:3001/api/agents/tickets/my-tasks/{projectId} \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "x-api-key: test-my-agent"
```

### Get Agent History
```bash
curl http://localhost:3001/api/agents/{agentId}/history \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "x-api-key: test-my-agent"
```

### Revoke Agent Key
```bash
curl -X POST http://localhost:3001/api/agents/revoke/{agentId} \
  -H "Authorization: Bearer YOUR_USER_TOKEN"
```

## Database Schema

### Core Tables
- `users` - User accounts with roles/plans  
- `projects` - User projects
- `tickets` - Kanban board items
- `pricing_tiers` - Subscription plans
- `project_agents` - Agent-project membership
- `agent_actions` - Action history for billing

### Status Workflow
Tickets flow through: `backlog` → `in_progress` → `review` → `done`
Status transitions are validated in `backend/src/models/ticket.js`

## Key Files to Know

### Backend
- `backend/src/index.js` - Express app entry
- `backend/src/api/routes.js` - Main API router
- `backend/src/middleware/auth.js` - JWT validation, agent auth
- `backend/src/middleware/permissions.js` - Permission checks
- `backend/src/services/*.js` - Business logic
- `backend/src/models/*.js` - Database models
- `backend/src/migrations/00*_*.sql` - Schema definitions

### Frontend
- `frontend/src/main.ts` - Vue app entry
- `frontend/src/router/index.ts` - Route definitions
- `frontend/src/stores/auth.js` - Authentication store
- `frontend/src/api/*.js` - API client functions
- `frontend/src/views/*.vue` - Page components

## Common Issues

### Missing Authentication Token
Error: `Unauthorized` on API calls
Solution: Ensure Bearer token in `Authorization` header

### Invalid Status Transition
Error: `Invalid status transition`
Solution: Use allowed transitions: backlog→in_progress, in_progress→review, review→done

### Database Connection Fails
Error: `Connection refused`
Solution: Start PostgreSQL with `docker run ... postgres:15`

### Frontend 404 on API calls
Solution: Ensure backend is running on port 3001

### Jest Test Failures
- Old tests may reference missing methods (UserService.register, etc.)
- Run `npm test` to see which tests are failing
- Use mocks in `backend/src/__tests__/db.mocks.js`

## Frontend Architecture

### State Management
Uses Pinia with `frontend/src/stores/`:
- `auth.js` - User auth state, token management

### Routing
Vue Router at `frontend/src/router/index.ts`:
```
/ → Projects list
/projects/:id → Project detail
/projects/:id/tickets → Kanban board
/projects/:id/tickets/:id → Ticket detail
/projects/:id/ai → AI Assistant
```

### API Client
REST client in `frontend/src/api/`:
- Direct fetch() calls with Bearer token auth
- Pattern: `fetch('http://localhost:3001/api/...')`

## Contributing

1. Read this AGENTS.md
2. Check `tickets.txt` for tasks
3. Follow existing code patterns
4. Ensure all tests pass
5. Update this file with new patterns found

## License
MIT
