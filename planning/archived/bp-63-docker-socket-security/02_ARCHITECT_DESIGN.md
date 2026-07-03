# 02_ARCHITECT_DESIGN.md — Docker Socket Mount Security Hardening

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The API container has direct access to the host's Docker socket (`/var/run/docker.sock`), which grants full root-level Docker control. A compromised API process can escape the container, access host filesystems, and control all other containers. This is a well-known container escape vector that should not exist in production.

---

## Current State

### Docker Socket Mount (docker-compose.yml)
```yaml
services:
  api:
    environment:
      - DOCKER_SOCKET=/var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

### Docker API Usage
- `DeployService.js` — uses Docker API to spawn deployment containers
- `ProvisioningService.js` — uses Docker API to provision compute nodes
- Both connect directly to the Unix socket via raw HTTP or a Docker client library
- No filtering, no restriction, no authentication layer

### Security Impact
| Risk | Severity | Description |
|------|----------|-------------|
| Container escape | Critical | Attacker can spawn privileged containers with host filesystem access |
| Lateral movement | High | Attacker can access other containers' volumes and networks |
| Data exfiltration | High | Attacker can read secrets/env vars from other containers |
| Denial of service | Medium | Attacker can stop/remove any container on the host |

---

## Design

### Option A: Docker API Proxy (Recommended)

Deploy a lightweight Docker API proxy container that filters allowed endpoints. The proxy sits between the API container and the Docker daemon, only exposing the endpoints needed by `DeployService` and `ProvisioningService`.

#### Proxy Service: `tutum/docker-socket-proxy` or `docker-proxy`

```yaml
docker-proxy:
  image: tutum/docker-socket-proxy:latest
  container_name: vibecode-docker-proxy
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro  # Read-only socket mount
  environment:
    # Allowed endpoints (whitelist approach)
    CONTAINERS: 1    # container create, list, inspect, start, stop, kill, logs
    IMAGES: 1        # image pull, list
    NETWORKS: 1      # network create, list
    # Denied by default:
    # VOLUMES: 0       # no volume management
    # SECRETS: 0       # no secrets access
    # CONFIGS: 0       # no config access
    # EVENTS: 0        # no event streaming
  networks:
    - vibecode
```

#### API Container Changes
```yaml
api:
  environment:
    - DOCKER_API_URL=http://docker-proxy:2375  # Proxy URL instead of socket path
  # Remove: volumes: - /var/run/docker.sock:/var/run/docker.sock
```

#### Backend Code Changes
```javascript
// DeployService.js / ProvisioningService.js
const DOCKER_URL = process.env.DOCKER_API_URL || 'http://localhost:2375';
// Use dockerode or similar with URL-based connection:
// const docker = new Docker({ host: 'docker-proxy', port: 2375 });
// or: const docker = new Docker({ socketPath: false, host: DOCKER_URL });
```

### Option B: Development-Only Direct Mount, Production Proxy

Keep the direct socket mount in `docker-compose.override.yml` for local development (developers need full Docker access for debugging), but use the proxy in the base `docker-compose.yml` for production.

```yaml
# docker-compose.yml (production)
api:
  environment:
    - DOCKER_API_URL=http://docker-proxy:2375

# docker-compose.override.yml (development)
api:
  environment:
    - DOCKER_API_URL=/var/run/docker.sock
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
```

### Option C: Docker Socket ACLs (Alternative)

Use Linux ACLs to restrict which operations the Node.js process can perform on the Docker socket. This is less secure than a proxy because it still exposes the raw Docker API, just with file-level restrictions.

**Decision**: Option A + B (proxy for production, direct mount for dev) is recommended because:
- Proxy completely hides the Docker API — no raw socket access
- Whitelist approach means even if the proxy is compromised, only allowed endpoints are accessible
- Dev workflow is preserved via override file

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `docker-compose.yml` | MODIFY | Add `docker-proxy` service; remove socket mount from API; add `DOCKER_API_URL` env var |
| `docker-compose.override.yml` | MODIFY | Add socket mount for dev; set `DOCKER_API_URL=/var/run/docker.sock` for dev |
| `backend/src/services/DeployService.js` | MODIFY | Use `DOCKER_API_URL` env var; update Docker client connection |
| `backend/src/services/ProvisioningService.js` | MODIFY | Use `DOCKER_API_URL` env var; update Docker client connection |
| `backend/.env.example` | MODIFY | Replace `DOCKER_SOCKET` with `DOCKER_API_URL` |
| `backend/package.json` | MODIFY | May need `dockerode` if not already present for URL-based connections |

---

## Data Flow Diagram

### Before (Direct Socket)
```
[API Container] → [Unix Socket: /var/run/docker.sock] → [Docker Daemon (host)]
     │                        │
     └── Full root access ────┘
```

### After (With Proxy)
```
[API Container] → [HTTP: docker-proxy:2375] → [Docker Socket Proxy (filtered)] → [Docker Daemon (host)]
     │                        │                        │
     └── URL-based ───────────┘                        └── Whitelisted endpoints only ──┘
```

---

## Dependencies

### Docker Dependencies
- `tutum/docker-socket-proxy:latest` or `docker-proxy` — lightweight Docker API proxy with endpoint filtering
- No new npm dependencies required if `dockerode` is already installed

### Cross-Cutting Dependencies
- `docker-compose.yml` — new service definition
- `docker-compose.override.yml` — dev-only socket mount
- `backend/.env.example` — new `DOCKER_API_URL` env var

---

## Config / Environment Changes

- [ ] New environment variables: `DOCKER_API_URL` (replaces `DOCKER_SOCKET`)
- [ ] New npm dependencies: NONE (if `dockerode` already installed)
- [ ] Existing config changes: Remove `DOCKER_SOCKET`, add `DOCKER_API_URL`

---

## Security Considerations

- [x] Docker socket proxy runs with read-only socket mount (`:ro`)
- [x] Proxy only exposes whitelisted endpoints
- [x] No VOLUMES, SECRETS, CONFIGS, or EVENTS endpoints exposed
- [x] Proxy container runs as non-root (if image supports it)
- [x] Docker API URL is not exposed to the host (internal Docker network only)

---

## Risks and Edge Cases

### Backend Risks
- **[Proxy compatibility]**: The Docker socket proxy may not support all API calls made by DeployService/ProvisioningService. Need to test after implementation and adjust the whitelist.
- **[Dev workflow regression]**: If the override file is not properly configured, local development may break. Ensure `docker-compose.override.yml` is documented.

### Edge Cases
- **[Proxy startup order]**: The API container should not start before the proxy. Add `depends_on` with `condition: service_healthy`.
- **[Proxy health check]**: Add a health check to the proxy service to verify it can reach the Docker daemon.
- **[Network configuration]**: The proxy, API, and Docker daemon must be on the same Docker network.

---

## Alternative Designs Considered

### Alternative 1: Docker Socket ACLs
- **Pros**: No new container; uses existing socket
- **Cons**: Still exposes raw Docker API; file-level restrictions are easier to bypass than endpoint-level filtering
- **Decision**: Proxy is more secure — it completely hides the Docker API and only exposes whitelisted endpoints.

### Alternative 2: Docker-in-Docker (DinD)
- **Pros**: Complete isolation; each API instance has its own Docker daemon
- **Cons**: Heavy resource usage; complex setup; not compatible with the existing agent compute model
- **Decision**: DinD is overkill for this use case. The proxy approach provides sufficient isolation with minimal overhead.

### Alternative 3: Remove Docker access entirely
- **Pros**: Eliminates the attack surface
- **Cons**: Breaks DeployService and ProvisioningService — these features require Docker access
- **Decision**: Docker access is a core feature. The proxy approach secures it rather than removing it.
