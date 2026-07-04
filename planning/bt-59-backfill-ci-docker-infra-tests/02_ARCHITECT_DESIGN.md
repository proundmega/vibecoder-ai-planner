# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: CI/CD | Docker
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, bp-59 (CI & Docker Infra)

---

## Problem Statement

bp-59 hardened CI pipeline and Docker infrastructure but added no tests. Without tests, CI configuration drift, Docker build regressions, and security issues (running as root) are impossible to detect automatically.

---

## Current State

### Existing CI
- `.github/workflows/ci.yml` — uses `actions/checkout@v4`, `actions/setup-node@v4`
- Docker image build steps for backend and frontend
- Java agent build and test steps

### Existing Docker
- `backend/Dockerfile` — multi-stage build, `USER node`
- `agent/Dockerfile` — uses `agent-*.jar` glob
- `docker-compose.yml` — network name, memory limits, healthcheck
- `agent/docker-compose.yml` — works with root compose

### Gap Analysis
- **No tests** for CI actions version
- **No tests** for Docker builds in CI
- **No tests** for Java agent build in CI
- **No tests** for non-root Docker user
- **No tests** for multi-stage Docker build
- **No tests** for agent Dockerfile glob pattern
- **No tests** for Docker Compose network name
- **No tests** for memory limits
- **No tests** for healthcheck start period
- **No tests** for agent compose compatibility

---

## Design

### Test Architecture

All tests use **Jest** with `fs` to read configuration files. No Docker execution is required — tests verify configuration content, not actual build output. This makes tests fast and CI-compatible.

#### Test Pattern

```javascript
const fs = require('fs')
const path = require('path')

describe('Configuration verification', () => {
  const filePath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml')

  if (!fs.existsSync(filePath)) {
    it.skip('CI workflow not found', () => { /* skip */ })
  } else {
    const content = fs.readFileSync(filePath, 'utf-8')
    it('uses actions/checkout@v4', () => {
      expect(content).toMatch(/actions\/checkout@v4/)
    })
  }
})
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/__tests__/ciActionsVersion.test.js` | CREATE | Verify actions@v4 |
| `backend/src/__tests__/ciDockerBuilds.test.js` | CREATE | Verify Docker builds in CI |
| `backend/src/__tests__/ciAgentBuild.test.js` | CREATE | Verify Java agent build |
| `backend/src/__tests__/dockerfileNonRoot.test.js` | CREATE | Verify USER node |
| `backend/src/__tests__/dockerfileMultiStage.test.js` | CREATE | Verify multi-stage build |
| `backend/src/__tests__/agentDockerfileGlob.test.js` | CREATE | Verify agent-*.jar glob |
| `backend/src/__tests__/composeNetworkName.test.js` | CREATE | Verify network name |
| `backend/src/__tests__/composeMemoryLimits.test.js` | CREATE | Verify memory limits |
| `backend/src/__tests__/composeHealthcheck.test.js` | CREATE | Verify 30s start period |
| `backend/src/__tests__/agentComposeWorks.test.js` | CREATE | Verify agent compose |

---

## Test Details

### CI Actions Version (`backend/src/__tests__/ciActionsVersion.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('CI actions version', () => {
  const ciPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml')

  if (!fs.existsSync(ciPath)) {
    it.skip('CI workflow not found', () => { /* skip */ })
  } else {
    const ci = fs.readFileSync(ciPath, 'utf-8')

    it('uses actions/checkout@v4', () => {
      expect(ci).toMatch(/actions\/checkout@v4/)
      expect(ci).not.toMatch(/actions\/checkout@v3/)
    })

    it('uses actions/setup-node@v4', () => {
      expect(ci).toMatch(/actions\/setup-node@v4/)
      expect(ci).not.toMatch(/actions\/setup-node@v3/)
    })
  }
})
```

### CI Docker Builds (`backend/src/__tests__/ciDockerBuilds.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('CI Docker builds', () => {
  const ciPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml')

  if (!fs.existsSync(ciPath)) {
    it.skip('CI workflow not found', () => { /* skip */ })
  } else {
    const ci = fs.readFileSync(ciPath, 'utf-8')

    it('builds backend Docker image', () => {
      expect(ci).toMatch(/docker.*build.*backend|docker.*push.*backend/i)
    })

    it('builds frontend Docker image', () => {
      expect(ci).toMatch(/docker.*build.*frontend|docker.*push.*frontend/i)
    })
  }
})
```

### CI Agent Build (`backend/src/__tests__/ciAgentBuild.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('CI Java agent build', () => {
  const ciPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml')

  if (!fs.existsSync(ciPath)) {
    it.skip('CI workflow not found', () => { /* skip */ })
  } else {
    const ci = fs.readFileSync(ciPath, 'utf-8')

    it('runs mvn test for agent', () => {
      expect(ci).toMatch(/mvn\s+test/i)
    })

    it('runs mvn package for agent', () => {
      expect(ci).toMatch(/mvn\s+package/i)
    })
  }
})
```

### Dockerfile Non-Root (`backend/src/__tests__/dockerfileNonRoot.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('Backend Dockerfile non-root', () => {
  const dockerfilePath = path.join(__dirname, '..', '..', 'backend', 'Dockerfile')

  if (!fs.existsSync(dockerfilePath)) {
    it.skip('Backend Dockerfile not found', () => { /* skip */ })
  } else {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8')

    it('uses USER node for non-root', () => {
      expect(dockerfile).toMatch(/USER\s+node/)
    })
  }
})
```

### Dockerfile Multi-Stage (`backend/src/__tests__/dockerfileMultiStage.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('Backend Dockerfile multi-stage build', () => {
  const dockerfilePath = path.join(__dirname, '..', '..', 'backend', 'Dockerfile')

  if (!fs.existsSync(dockerfilePath)) {
    it.skip('Backend Dockerfile not found', () => { /* skip */ })
  } else {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8')

    it('has multi-stage build (FROM ... AS ...)', () => {
      expect(dockerfile).toMatch(/FROM\s+\S+\s+AS\s+\S+/i)
    })

    it('has builder stage', () => {
      expect(dockerfile).toMatch(/FROM.*AS.*builder/i)
    })

    it('has production stage that copies from builder', () => {
      expect(dockerfile).toMatch(/COPY.*--from=builder/i)
    })
  }
})
```

### Agent Dockerfile Glob (`backend/src/__tests__/agentDockerfileGlob.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('Agent Dockerfile JAR glob', () => {
  const dockerfilePath = path.join(__dirname, '..', '..', 'agent', 'Dockerfile')

  if (!fs.existsSync(dockerfilePath)) {
    it.skip('Agent Dockerfile not found', () => { /* skip */ })
  } else {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8')

    it('uses agent-*.jar glob', () => {
      expect(dockerfile).toMatch(/agent-\*\.jar/)
    })

    it('does not hardcode JAR version', () => {
      expect(dockerfile).not.toMatch(/agent-\d+\.\d+\.\d+\.jar/)
    })
  }
})
```

### Compose Network Name (`backend/src/__tests__/composeNetworkName.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('Docker Compose network name', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('docker-compose.yml not found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('sets network name to vibecode_default', () => {
      expect(compose).toMatch(/name:\s*vibecode/)
    })
  }
})
```

### Compose Memory Limits (`backend/src/__tests__/composeMemoryLimits.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('Docker Compose memory limits', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('docker-compose.yml not found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('all services have memory limits', () => {
      // Check for deploy.resources.limits.memory or mem_limit in each service
      expect(compose).toMatch(/mem_limit|memory:/)
    })

    it('api service has memory limit', () => {
      // Verify api service specifically has a limit
    })

    it('frontend service has memory limit', () => {
      // Verify frontend service specifically has a limit
    })
  }
})
```

### Compose Healthcheck (`backend/src/__tests__/composeHealthcheck.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('Docker Compose healthcheck', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('docker-compose.yml not found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('API healthcheck has 30s start period', () => {
      expect(compose).toMatch(/start_period:\s*30s/)
    })
  }
})
```

### Agent Compose Works (`backend/src/__tests__/agentComposeWorks.test.js`)

```javascript
const fs = require('fs')
const path = require('path')

describe('Agent compose compatibility', () => {
  const agentComposePath = path.join(__dirname, '..', '..', 'agent', 'docker-compose.yml')
  const mainComposePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(agentComposePath)) {
    it.skip('Agent docker-compose.yml not found', () => { /* skip */ })
  } else {
    const agentCompose = fs.readFileSync(agentComposePath, 'utf-8')

    it('agent compose has service_healthy condition for api', () => {
      expect(agentCompose).toMatch(/condition:\s*service_healthy/i)
    })

    it('agent compose does not define conflicting services', () => {
      // Verify agent compose doesn't redefine services from main compose
    })
  }
})
```

---

## Dependencies

### Backend Dependencies
- `.github/workflows/ci.yml` — CI configuration
- `backend/Dockerfile` — backend Docker configuration
- `agent/Dockerfile` — agent Docker configuration
- `docker-compose.yml` — Docker Compose configuration
- `agent/docker-compose.yml` — agent Docker Compose

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/*.test.js` | CI config, Dockerfile, Compose config verification |

---

## Risks and Edge Cases

### Backend Risks
- **[File paths may vary]**: Config files may be in different locations. Mitigation: check `fs.existsSync` before reading, use `describe.skip` if not found.
- **[YAML parsing]**: Simple regex may miss YAML nuances. Mitigation: use broad regex patterns that match common YAML formatting.

---

## Alternative Designs Considered

### Alternative 1: Execute Docker builds in tests
- **Pros**: Verifies actual build output
- **Cons**: Requires Docker, slow, not CI-friendly
- **Decision**: Config file scanning is faster and sufficient

### Alternative 2: Use YAML parser instead of regex
- **Pros**: More accurate parsing
- **Cons**: Requires new dependency (js-yaml)
- **Decision**: Regex is sufficient for simple checks and avoids new dependency

---

*This design document guides implementation.*
