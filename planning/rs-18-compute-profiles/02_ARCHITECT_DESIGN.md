# 02_ARCHITECT_DESIGN.md — Compute Profile Support

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Problem Statement

Users want to run AI agents on their own hardware (laptops, servers, cloud instances). Vibecode coordinates the work, users provide the compute. Agents are Docker containers that self-register with the Vibecode portal and receive tickets.

---

## Current State

- No compute infrastructure
- Agents run locally or not at all
- No registration or dispatch mechanism

---

## Design

### Architecture

```
User Machine → Docker Agent (vibecode-agent) → Registers with Vibecode API
                                                    ↓
                                            Vibecode Portal → Node Registry
                                                    ↓
                                            Ticket Dispatcher → Assigns tickets
```

### Docker Agent

A lightweight Node.js container that runs on the user's machine:

```
vibecode-agent/
  Dockerfile
  src/
    index.js          → main entry, connects to Vibecode API
    agent.js          → ticket polling, execution logic
    executor.js       → runs coding tasks, git operations
    health.js         → health checks, resource reporting
    config.js         → reads registration token from env
```

**Dockerfile:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/
ENV VIBECODE_API_URL=https://vibecode.example.com
ENV VIBECODE_REGISTRATION_TOKEN=<token-from-portal>
ENV VIBECODE_NODE_NAME=my-laptop
EXPOSE 3000
CMD ["node", "src/index.js"]
```

### Registration Flow

```
1. User logs into Vibecode portal as project_admin
2. Goes to "Compute Nodes" page
3. Clicks "Register New Node"
4. Vibecode generates a registration token (short-lived, 15 min)
5. User runs: docker run -e VIBECODE_REGISTRATION_TOKEN=<token> vibecode-agent
6. Agent connects to Vibecode API with token
7. Vibecode validates token, creates node record, assigns to project
8. Agent starts polling for tickets
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS compute_nodes (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,              -- user-provided name: 'my-laptop', 'dev-server'
  node_type VARCHAR(50) NOT NULL DEFAULT 'docker',  -- 'docker' for now
  registration_token VARCHAR(255) NOT NULL,  -- hashed token for auth
  status VARCHAR(20) NOT NULL DEFAULT 'offline',  -- 'online'|'offline'|'busy'|'error'
  current_ticket_id BIGINT REFERENCES tickets(id),  -- null when idle
  hardware_info JSONB DEFAULT '{}',         -- CPU, RAM, OS reported by agent
  last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_compute_nodes_project_id ON compute_nodes(project_id);
CREATE INDEX idx_compute_nodes_status ON compute_nodes(status);
CREATE INDEX idx_compute_nodes_current_ticket_id ON compute_nodes(current_ticket_id);
```

### Agent API Endpoints

```
POST /api/nodes/register          → Register with token (one-time)
POST /api/nodes/:id/heartbeat     → Report status, resource usage
POST /api/nodes/:id/tickets/poll  → Poll for assigned tickets
POST /api/nodes/:id/tickets/claim → Claim a ticket
POST /api/nodes/:id/tickets/complete → Mark ticket work done
POST /api/nodes/:id/tickets/error   → Report error on ticket
```

### Ticket Dispatch

```javascript
// backend/src/services/NodeDispatcher.js
class NodeDispatcher {
  async assignTicket(ticketId, projectId) {
    // Find available node for project
    const result = await pool.query(
      `SELECT id, name, hardware_info FROM compute_nodes
       WHERE project_id = $1 AND status = 'online'
       AND current_ticket_id IS NULL
       ORDER BY last_heartbeat DESC
       LIMIT 1`,
      [projectId]
    );
    
    if (result.rows.length === 0) {
      throw new Error('No available compute nodes for this project');
    }
    
    const node = result.rows[0];
    
    // Claim the ticket
    await pool.query(
      `UPDATE tickets 
       SET assigned_agent_id = $1, assigned_node_id = $2, 
           status = 'in_progress', locked_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'backlog'`,
      [node.id, node.id, ticketId]
    );
    
    return node;
  }
}
```

### Heartbeat & Health

Agent sends heartbeat every 30 seconds:
```javascript
// Agent side
setInterval(async () => {
  const resources = await getSystemResources(); // CPU, RAM, disk
  await axios.post(`${API_URL}/api/nodes/${nodeId}/heartbeat`, {
    status: node.currentTicketId ? 'busy' : 'online',
    resources: {
      cpu_percent: resources.cpu,
      memory_used_mb: resources.memUsed,
      memory_total_mb: resources.memTotal,
      disk_used_gb: resources.diskUsed,
    }
  });
}, 30000);
```

### Node Lifecycle

```
offline → (register) → online → (claim ticket) → busy → (complete) → online
                                                          ↓
                                                      (error) → error → (fix) → online
```

---

## Dependencies

- **Docker** — container runtime on user machines
- **compute_nodes table** — new table for node registry
- **Ticket ownership** — rs-16 (nodes claim tickets like agents)

---

## Risks/Edge Cases

- **[Network connectivity]**: Agent behind NAT/firewall — agent initiates outbound connections only (no inbound needed)
- **[Downtime]**: Node goes offline — heartbeat timeout marks it offline, tickets reassignable
- **[Resource limits]**: Agent has limited RAM/CPU — report resources, dispatcher avoids overloading
- **[Security]**: Registration token short-lived (15 min), hashed in DB, single-use
- **[Multiple projects]**: Node belongs to one project — can't share compute across projects

---

## Migration Notes

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

*This document defines the design for compute profile support. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for implementation details.*
