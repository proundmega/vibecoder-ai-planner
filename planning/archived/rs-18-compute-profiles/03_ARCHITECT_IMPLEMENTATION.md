# 03_ARCHITECT_IMPLEMENTATION.md — Compute Profile Support

**Status**: planned
**Priority**: P2
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-06-10
**Date completed**: TBD
**PR**: TBD
**Branch**: rs-18-compute-profiles

**Dependencies**: rs-15-api-keys (agent needs Vibecode API key), rs-16-agent-orchestration (ticket assignment)

---

### a) Purpose

Allow users to run AI agents on their own hardware via Docker containers. Agents self-register with the Vibecode portal, report health, and receive tickets. Vibecode handles coordination, users provide compute.

**Value delivered**: Users bring their own compute (laptops, servers, cloud instances). Vibecode becomes the orchestration layer — ticket assignment, health monitoring, resource tracking.

---

### b) Actions

1. **Create migration** — `backend/src/migrations/015_compute_nodes.sql`
   - `compute_nodes` table with registration token, status, heartbeat, hardware info

2. **Create NodeService** — `backend/src/services/NodeService.js`
   - `registerNode(token, name, nodeType)` → validates token, creates node
   - `heartbeat(nodeId, status, resources)` → updates last_heartbeat, status
   - `assignTicket(nodeId, ticketId)` → claims ticket for node
   - `getAvailableNodes(projectId)` → finds online, idle nodes
   - `getNodeStatus(nodeId)` → returns current status and resources

3. **Create NodeDispatcher** — `backend/src/services/NodeDispatcher.js`
   - `dispatchTicket(ticketId, projectId)` → finds best available node, assigns ticket
   - `reassignStaleTickets()` → finds nodes with no heartbeat > 5 min, reassigns tickets

4. **Create controllers** — `backend/src/controllers/nodeController.js`
   - `registerNode(req, res, next)` → POST `/api/projects/:id/nodes/register`
   - `heartbeat(req, res, next)` → POST `/api/nodes/:id/heartbeat`
   - `pollTickets(req, res, next)` → POST `/api/nodes/:id/tickets/poll`
   - `claimTicket(req, res, next)` → POST `/api/nodes/:id/tickets/claim`
   - `completeTicket(req, res, next)` → POST `/api/nodes/:id/tickets/complete`
   - `errorTicket(req, res, next)` → POST `/api/nodes/:id/tickets/error`

5. **Create routes** — `backend/src/api/nodes.js`
   - `POST /api/projects/:id/nodes/register` — register new node
   - `POST /api/nodes/:id/heartbeat` — health check
   - `POST /api/nodes/:id/tickets/poll` — poll for tickets
   - `POST /api/nodes/:id/tickets/claim` — claim ticket
   - `POST /api/nodes/:id/tickets/complete` — mark done
   - `POST /api/nodes/:id/tickets/error` — report error
   - `GET /api/projects/:id/nodes` — list nodes (admin only)

6. **Create frontend components**
   - `frontend/src/views/ComputeNodes.vue` — node management UI
   - `frontend/src/components/NodeCard.vue` — node status card
   - Registration flow: generate token → show docker command

7. **Create tests**
   - `backend/src/__tests__/nodeService.test.js` — node CRUD tests
   - `backend/src/__tests__/nodeDispatcher.test.js` — dispatch logic tests
   - `backend/src/__tests__/nodeController.test.js` — controller tests

---

### c) Dependencies

- **rs-15-api-keys** — agent needs Vibecode API key for registration
- **rs-16-agent-orchestration** — ticket assignment logic
- **compute_nodes table** — new table for node registry

---

### d) Risks/Edge Cases

- **[Network connectivity]**: Agent behind NAT/firewall — agent initiates outbound connections only (no inbound needed)
- **[Downtime]**: Node goes offline — heartbeat timeout (5 min) marks it offline, tickets reassignable
- **[Resource limits]**: Agent has limited RAM/CPU — report resources, dispatcher avoids overloading
- **[Security]**: Registration token short-lived (15 min), hashed in DB, single-use
- **[Multiple projects]**: Node belongs to one project — can't share compute across projects

---

### e) Testing

#### Unit Tests
- [ ] NodeService.registerNode() — validates token, creates node
- [ ] NodeService.heartbeat() — updates status and resources
- [ ] NodeService.assignTicket() — claims ticket for node
- [ ] NodeDispatcher.dispatchTicket() — finds best available node
- [ ] NodeDispatcher.reassignStaleTickets() — reassigns from dead nodes

#### Integration Tests
- [ ] Full lifecycle: register → heartbeat → poll → claim → complete
- [ ] Stale node recovery: heartbeat stops → ticket reassignable

---

### f) Migration Notes

```sql
-- Migration: 015_compute_nodes.sql
CREATE TABLE IF NOT EXISTS compute_nodes (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  node_type VARCHAR(50) NOT NULL DEFAULT 'docker',
  registration_token VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  current_ticket_id BIGINT REFERENCES tickets(id),
  hardware_info JSONB DEFAULT '{}',
  last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_compute_nodes_project_id ON compute_nodes(project_id);
CREATE INDEX idx_compute_nodes_status ON compute_nodes(status);
CREATE INDEX idx_compute_nodes_current_ticket_id ON compute_nodes(current_ticket_id);
```

---

### g) Notes

- Agent is a Docker container — single binary, no complex setup
- Registration token: UUID, expires in 15 min, single-use
- Heartbeat: every 30 seconds, includes CPU/RAM/disk usage
- Stale detection: no heartbeat > 5 minutes → node marked offline
- Ticket reassignment: stale node's tickets returned to backlog
- Node belongs to one project — no cross-project sharing

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, Docker agent, registration, dispatch, heartbeat*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
