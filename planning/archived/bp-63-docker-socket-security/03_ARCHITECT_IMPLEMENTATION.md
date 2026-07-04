# 03_ARCHITECT_IMPLEMENTATION.md — Docker Socket Mount Security Hardening

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Replace the direct Docker socket mount in the API container with a filtered Docker API proxy, eliminating the container escape vector while preserving DeployService and ProvisioningService functionality.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order:

1. **Add Docker proxy service to docker-compose.yml** — `docker-compose.yml`
   - Add `docker-proxy` service using `tutum/docker-socket-proxy:latest`
   - Whitelist only required endpoints: CONTAINERS, IMAGES, NETWORKS
   - Mount host socket as read-only (`:ro`)
   - Add health check for the proxy
   - *Depends on*: nothing

2. **Update docker-compose.override.yml for dev** — `docker-compose.override.yml`
   - Add socket mount for local development: `- /var/run/docker.sock:/var/run/docker.sock`
   - Set `DOCKER_API_URL=/var/run/docker.sock` for dev
   - *Depends on*: nothing (can be done in parallel with Step 1)

3. **Update API service in docker-compose.yml** — `docker-compose.yml`
   - Remove volume mount: `- /var/run/docker.sock:/var/run/docker.sock`
   - Replace env var: `DOCKER_SOCKET` → `DOCKER_API_URL=http://docker-proxy:2375`
   - Add `depends_on: docker-proxy` with `condition: service_healthy`
   - *Depends on*: Step 1

4. **Update DeployService.js** — `backend/src/services/DeployService.js`
   - Replace `DOCKER_SOCKET` path reference with `DOCKER_API_URL`
   - Update Docker client initialization to use URL-based connection
   - *Depends on*: Step 3

5. **Update ProvisioningService.js** — `backend/src/services/ProvisioningService.js`
   - Replace `DOCKER_SOCKET` path reference with `DOCKER_API_URL`
   - Update Docker client initialization to use URL-based connection
   - *Depends on*: Step 3

6. **Update backend/.env.example** — `backend/.env.example`
   - Replace `DOCKER_SOCKET=/var/run/docker.sock` with `DOCKER_API_URL=http://docker-proxy:2375`
   - *Depends on*: nothing

7. **Add Docker client URL-based connection module** — `backend/src/utils/docker.js` (CREATE)
   - Export a configured Docker client instance
   - Reads `DOCKER_API_URL` from env
   - Falls back to socket path for dev if `DOCKER_API_URL` is a Unix socket path
   - *Depends on*: Step 1

---

### c) Per-File Action Plan

#### `docker-compose.yml` (MODIFY)
```yaml
# Add docker-proxy service
services:
  docker-proxy:
    image: tutum/docker-socket-proxy:latest
    container_name: vibecode-docker-proxy
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      CONTAINERS: 1
      IMAGES: 1
      NETWORKS: 1
      # Denied by default: VOLUMES, SECRETS, CONFIGS, EVENTS
    networks:
      - vibecode
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:2375/version"]
      interval: 5s
      timeout: 3s
      retries: 3

# Update API service
  api:
    environment:
      - DOCKER_API_URL=http://docker-proxy:2375
    # Remove: volumes: - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      docker-proxy:
        condition: service_healthy
```

#### `docker-compose.override.yml` (MODIFY)
```yaml
services:
  api:
    environment:
      - DOCKER_API_URL=/var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

#### `backend/src/utils/docker.js` (CREATE)
```javascript
const Docker = require('dockerode');

const DOCKER_URL = process.env.DOCKER_API_URL || 'http://docker-proxy:2375';

// Check if URL is a Unix socket path
const isSocketPath = DOCKER_URL.startsWith('/');
const docker = isSocketPath
  ? new Docker({ socketPath: DOCKER_URL })
  : new Docker({ host: new URL(DOCKER_URL).hostname, port: new URL(DOCKER_URL).port || 2375 });

module.exports = { docker, DOCKER_URL };
```

#### `backend/src/services/DeployService.js` (MODIFY)
- Replace direct Docker socket connection with `require('../utils/docker').docker`
- Update any hardcoded socket path references to use `DOCKER_URL`

#### `backend/src/services/ProvisioningService.js` (MODIFY)
- Replace direct Docker socket connection with `require('../utils/docker').docker`
- Update any hardcoded socket path references to use `DOCKER_URL`

#### `backend/.env.example` (MODIFY)
```diff
- DOCKER_SOCKET=/var/run/docker.sock
+ DOCKER_API_URL=http://docker-proxy:2375
```

---

### d) Dependencies

- `tutum/docker-socket-proxy:latest` — Docker API proxy with endpoint filtering
- `dockerode` — Node.js Docker client (verify if already installed in `backend/package.json`)

---

### e) Risks/Edge Cases

- **[Proxy endpoint compatibility]**: The proxy may not support all Docker API endpoints used by DeployService/ProvisioningService. Test after implementation and add missing endpoints to the whitelist.
- **[Dev workflow]**: Developers must have `docker-compose.override.yml` in place for local Docker access. Document this in AGENTS.md.
- **[Health check timing]**: The API container should wait for the proxy to be healthy before starting. Use `depends_on` with `condition: service_healthy`.

---

### f) Testing

#### Backend Unit Tests
- [ ] Test `docker.js` utility module: URL-based connection works
- [ ] Test `DeployService`: connects to `DOCKER_API_URL` instead of socket
- [ ] Test `ProvisioningService`: connects to `DOCKER_API_URL` instead of socket

#### Integration Tests
- [ ] `docker compose up` starts API and proxy correctly
- [ ] DeployService can create and manage containers via proxy
- [ ] ProvisioningService can provision nodes via proxy
- [ ] Proxy blocks unauthorized endpoints (volumes, secrets, configs)

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `docker compose up --build` — all services start

---

### g) Migration Notes

No database migrations. This is an infrastructure-only change.

---

### h) Files Changed

**Infrastructure:**
```
docker-compose.yml                              → MODIFY (add docker-proxy, update API)
docker-compose.override.yml                     → MODIFY (dev socket mount)
backend/.env.example                            → MODIFY (DOCKER_API_URL)
```

**Backend:**
```
backend/src/utils/docker.js                     → CREATE (Docker client wrapper)
backend/src/services/DeployService.js            → MODIFY (use docker.js)
backend/src/services/ProvisioningService.js      → MODIFY (use docker.js)
```

---

### i) Code Review Checklist

- [ ] Docker socket is NOT directly mounted in production compose
- [ ] `docker-proxy` service has read-only socket mount (`:ro`)
- [ ] Proxy whitelist only includes required endpoints (CONTAINERS, IMAGES, NETWORKS)
- [ ] VOLUMES, SECRETS, CONFIGS, EVENTS are NOT exposed
- [ ] API container uses `DOCKER_API_URL` env var
- [ ] `docker.js` utility handles both URL and socket path connections
- [ ] Health check added to proxy service
- [ ] `docker-compose.override.yml` provides dev socket mount
- [ ] All deploy and provision workflows tested with proxy

---

### j) Post-Deploy Verification

1. [ ] `docker compose up` — API and proxy start correctly
2. [ ] `docker compose logs docker-proxy` — proxy is healthy
3. [ ] DeployService creates a deployment container successfully
4. [ ] ProvisioningService provisions a compute node successfully
5. [ ] Proxy blocks volume management requests (403)
6. [ ] Proxy blocks secrets access (403)
7. [ ] `docker compose -f docker-compose.yml -f docker-compose.override.yml up` — dev socket mount works
8. [ ] `npm test` — backend tests pass
9. [ ] `npm run lint` — no lint errors
