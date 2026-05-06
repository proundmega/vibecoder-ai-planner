# AI Kanban Planner - System Architecture

## Overview

A SaaS platform enabling human teams and AI agents to collaborate on task management through a visual Kanban interface. The system supports multi-tenancy, role-based access control, and integrates AI agents that work directly in code repositories.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                              │
├─────────────────────┬───────────────────────────────────────────┤
│  Web Frontend       │     AI Agent Clients                       │
│  (Vue.js)          │  (External AI/Development Agents)           │
│  - Kanban UI        │  - Direct repo access                      │
│  - User dashboard   │  - API-only operations                      │
└─────────┬───────────┴───────────────────────────────────────────┘
          │
          │ HTTPS / REST API
          │
┌─────────▼───────────────────────────────────────────────────────┐
│                         API GATEWAY                              │
├─────────────────────────────────────────────────────────────────┤
│  - Rate limiting                                                │
│  - Authentication/Authorization                                 │
│  - Request validation                                           │
│  - API versioning                                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌───────────────┐   ┌──────────────┐   ┌────────────────┐
│   Auth Service │   │ Project/T    │   │   AI Agent     │
│ (JWT)         │   │ icket Service│   │  Service        │
└───────────────┘   └──────────────┘   └────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐
│ Pegasus     │  │ Role Mgmt   │  │ Audit Logger        │
│ (Projects+  │  │  Controller │  │ (AI actions)        │
│ Tickets)    │  │             │  │                     │
└─────────────┘  └─────────────┘  └─────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│          PostgreSQL Database            │
│  - Users (with role, plan)             │
│  - Projects                            │
│  - Tickets (with status workflow)      │
│  - Pricing subscriptions               │
└─────────────────────────────────────────┘
```

## Core Components

### 1. Backend API (Node.js/Express)

**Location**: `backend/src/`

**Services**:
- `auth.js` - JWT authentication, password hashing, session management
- `pg.js` - PostgreSQL connection pool
- `models/` - Data models (User, Project, Ticket, PricingTier)
- `services/` - Business logic (ProjectService, TicketService, AuthService)
- `middleware/` - Authentication, validation, rate limiting

**Endpoints**:
- `/api/auth/*` - Authentication
- `/api/projects/*` - Project CRUD
- `/api/tickets/*` - Ticket CRUD
- `/api/pricing/*` - Subscription management
- `/api/agents/*` - AI agent operations

**Tech Stack**:
- Express.js 4.x
- PostgreSQL (via pg lib)
- JWT for authentication
- Winston for logging
- Zod for validation

### 2. Frontend (Vue.js 3)

**Location**: `frontend/src/`

**Architectural Pattern**: Composables + Pinia stores

**State Management**:
```typescript
// Pinia stores
stores/
  ├── auth.ts       // user, token, isAuthenticated
  ├── projects.ts   // project list, active project
  ├── tickets.ts    // ticket list, filters
  └── kanban.ts     // drag-and-drop state
```

**Components**:
```vue
components/
  ├── kanban.vue    // Main Kanban board
  ├── ticket-card.vue // Draggable ticket card
  ├── project-item.vue
  ├── auth-form.vue
  └── ticket-modal.vue
```

**Routing**: Vue Router 4
- `/login` - Sign in
- `/register` - Create account
- `/projects` - Project list
- `/projects/:id` - Project detail
- `/projects/:id/tickets` - Kanban view
- `/projects/:id/tickets/:ticketId` - Ticket detail

### 3. AI Agent Integration

**Access Modes**:
1. **Full Code Access**: Agents work directly in project repositories
2. **API-only**: Agents call API endpoints to manipulate tickets

**Security**:
- API keys for agent authentication
- Separate rate limiters for agents
- Audit trail for all AI actions
- Budget/cost tracking per agent

**Workflow**:
```
Agent Request → API Key Validation → Rate Limit Check
        ↓
    Permission Check
        ↓
    Execute Operation
        ↓
    Audit Log Entry
        ↓
    Return Response
```

### 4. Database Schema

**Users Table**:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP,
  current_plan VARCHAR(50) DEFAULT 'free'
);
```

**Projects Table**:
```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Tickets Table**:
```sql
CREATE TABLE tickets (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'backlog',
  priority VARCHAR(50) DEFAULT 'medium',
  assignee_id UUID REFERENCES users(id),
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Status Workflow**: `backlog` → `in_progress` → `review` → `done`

**Pricing_Tiers Table**:
```sql
CREATE TABLE pricing_tiers (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2),
  includes_cost_limit INTEGER,
  features JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 5. Security Architecture

**Authentication**:
- JWT tokens with 24-hour expiry
- bcrypt password hashing (cost factor 10)
- Password reset via email + token
- Session-based multi-factor (optional)

**Authorization**:
- Role-based access control (admin, member, viewer)
- Project-level permissions
- Function-level middleware checks

**API Security**:
- Helmet.js for HTTP headers
- CORS configuration
- Rate limiting (per IP + per user)
- Request validation (Zod schemas)
- Input sanitization

### 6. Data Flow Examples

#### User Creates Project
```
POST /api/projects
{ name: "My Project", description: "..." }
    ↓ [Auth Middleware]
    ↓ [Validation]
SQL INSERT INTO projects
    ↓
 201 CREATED + project data
```

#### AI Agent Claims Ticket
```
POST /api/agents/tickets/assign
{ ticketId: "...", status: "in_progress" }
    ↓ [AI Auth Middleware]
    ↓ [Rate Limit Check]
    ↓ [Audit Log: { action: 'assign', actor: 'AI' }]
SQL UPDATE tickets SET status = 'in_progress', assignee_id = ?
    ↓
 200 OK + ticket data
```

#### User Drags Ticket on Kanban
```
Drag event: ticket "TC-123" from backlog → in_progress
    ↓ [Frontend]
  PUT /api/tickets/TC-123
{ status: "in_progress" }
    ↓ [Auth Middleware]
    ↓ [Validation: valid transition?]
SQL UPDATE tickets SET status = 'in_progress'
    ↓
 200 OK
```

## Deployment Architecture (Docker)

### Local Development
```yaml
services:
  backend:
    build: ./backend
    ports: ["3001:3001"]
    environment:
      - DATABASE_URL=postgres://localhost/db
      - NODE_ENV=development
      - VUE_APP_API_URL=http://localhost:3001
      
  frontend:
    build: ./frontend
    ports: ["5173:5173"]
    depends_on: [backend]
  
  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=vibecode
      - POSTGRES_USER=admin
      - POSTGRES_PASSWORD=changeme
```

### Production

**Docker Compose with nginx**:
- nginx reverse proxy (port 80/443)
- Node.js backend (port 3001)
- Vue frontend (port 3000)
- PostgreSQL (5432)
- Redis (for caching, if needed)

**Docker Swarm/Kubernetes**:
- Separate services for each component
- Health checks on all services
- Rolling updates
- Horizontal pod scaling for API

## Scalability Considerations

**Horizontal Scaling**:
- Stateless API backend (can scale horizontally)
- Stateless Vue SPA (served via CDN)
- PostgreSQL connection pooling (PgBouncer)

**Performance Optimizations**:
- Redis caching for frequent queries (project list, user data)
- API response compression
- Frontend code splitting and lazy loading
- Paginated API endpoints

**Cost Tracking**:
- Per-user usage counters (API calls, tickets created)
- Per-project limits enforcement
- Real-time usage dashboard

## Monitoring & Observability

**Logging**:
- Winston structured logging (JSON format)
- Request/response logging (sampled in prod)
- Error-specific logging

**Metrics**:
- API response times
- Database query performance
- User activity counts
- Agent usage tracking

**Alerting**:
- Server downtime detection
- Database connection monitoring
- Error rate thresholds
- Budget/cost alerts

## Future Enhancements

1. **Real-time Updates**: WebSocket integration (Socket.io) for live kanban updates
2. **Advanced AI Features**: 
   - Auto-ticket generation from GitHub issues
   - Status suggestions based on commit patterns
   - Cost prediction based on ticket history
3. **Advanced Security**: 
   - OAuth2/OIDC for 3rd party login
   - Two-factor authentication
   - IP whitelisting for agents
4. **Collaboration**:
   - Comments and @mentions
   - File attachments
   - Timeline/History views
5. **Integrations**:
   - GitHub/GitLab webhook support
   - Jira sync
   - Slack notifications

## Decision Log

**Why Node.js?**
- Full-stack JavaScript reduces context switching
- Fast development speed with Express
- Excellent ecosystem for AI tooling
- Good performance for this use case

**Why Vue.js?**
- Gentle learning curve for developers
- Excellent composition API
- Strong component ecosystem
- Great for dashboards/interactive UIs

**Why PostgreSQL?**
- ACID compliance for financial data
- JSONB support for flexible schemas
- Mature ecosystem
- Excellent Docker support

**Why JWT?**
- Stateless (scales horizontally)
- Simple implementation
- Industry standard
- Built-in refresh token support

## References

- Project: vibecoder-ai-planner
- API Documentation: /api/docs (OpenAPI)
- Frontend Preview: port 3000/3001
- Backend Logs: `docker logs vibecode_api`
