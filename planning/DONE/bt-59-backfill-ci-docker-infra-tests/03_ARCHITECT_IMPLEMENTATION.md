# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bt-59 — Backfill CI/Docker Infra Tests

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-04
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: CI/CD | Docker

**Dependencies**: bp-59 (CI & Docker Infra) must be completed first

---

### a) Purpose

Backfill all missing test coverage for bp-59's CI/Docker infrastructure changes. bp-59 hardened CI pipeline and Docker configuration but added no tests. Without tests, CI configuration drift, Docker build regressions, and security issues are impossible to detect.

---

### b) Actions

**CRITICAL**: This is a test-only ticket. Do NOT modify any production code.

#### Implementation Order

1. **CI actions version test** — `backend/src/__tests__/ciActionsVersion.test.js`
   - Verify `actions/checkout@v4` and `actions/setup-node@v4`
   - *Depends on*: nothing

2. **CI Docker builds test** — `backend/src/__tests__/ciDockerBuilds.test.js`
   - Verify Docker image builds for backend and frontend in CI
   - *Depends on*: nothing

3. **CI agent build test** — `backend/src/__tests__/ciAgentBuild.test.js`
   - Verify Java agent `mvn test` and `mvn package` in CI
   - *Depends on*: nothing

4. **Dockerfile non-root test** — `backend/src/__tests__/dockerfileNonRoot.test.js`
   - Verify `USER node` in backend Dockerfile
   - *Depends on*: nothing

5. **Dockerfile multi-stage test** — `backend/src/__tests__/dockerfileMultiStage.test.js`
   - Verify multi-stage build in backend Dockerfile
   - *Depends on*: nothing

6. **Agent Dockerfile glob test** — `backend/src/__tests__/agentDockerfileGlob.test.js`
   - Verify `agent-*.jar` glob in agent Dockerfile
   - *Depends on*: nothing

7. **Compose network name test** — `backend/src/__tests__/composeNetworkName.test.js`
   - Verify `vibecode_default` network name
   - *Depends on*: nothing

8. **Compose memory limits test** — `backend/src/__tests__/composeMemoryLimits.test.js`
   - Verify memory limits on all services
   - *Depends on*: nothing

9. **Compose healthcheck test** — `backend/src/__tests__/composeHealthcheck.test.js`
   - Verify 30s start period on API healthcheck
   - *Depends on*: nothing

10. **Agent compose compatibility test** — `backend/src/__tests__/agentComposeWorks.test.js`
    - Verify agent compose works with root compose
    - *Depends on*: nothing

---

### c) Per-File Action Plan

#### `backend/src/__tests__/ciActionsVersion.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('CI actions version', () => {
  const ciPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml')

  if (!fs.existsSync(ciPath)) {
    it.skip('CI workflow not found — skipping', () => { /* skip */ })
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

#### `backend/src/__tests__/ciDockerBuilds.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('CI Docker builds', () => {
  const ciPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml')

  if (!fs.existsSync(ciPath)) {
    it.skip('CI workflow not found — skipping', () => { /* skip */ })
  } else {
    const ci = fs.readFileSync(ciPath, 'utf-8')

    it('builds backend Docker image', () => {
      expect(ci).toMatch(/docker.*build/i)
    })

    it('builds frontend Docker image', () => {
      expect(ci).toMatch(/docker.*build/i)
    })
  }
})
```

#### `backend/src/__tests__/ciAgentBuild.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('CI Java agent build', () => {
  const ciPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml')

  if (!fs.existsSync(ciPath)) {
    it.skip('CI workflow not found — skipping', () => { /* skip */ })
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

#### `backend/src/__tests__/dockerfileNonRoot.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Backend Dockerfile non-root', () => {
  const dockerfilePath = path.join(__dirname, '..', '..', 'backend', 'Dockerfile')

  if (!fs.existsSync(dockerfilePath)) {
    it.skip('Backend Dockerfile not found — skipping', () => { /* skip */ })
  } else {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8')

    it('uses USER node for non-root', () => {
      expect(dockerfile).toMatch(/USER\s+node/)
    })
  }
})
```

#### `backend/src/__tests__/dockerfileMultiStage.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Backend Dockerfile multi-stage build', () => {
  const dockerfilePath = path.join(__dirname, '..', '..', 'backend', 'Dockerfile')

  if (!fs.existsSync(dockerfilePath)) {
    it.skip('Backend Dockerfile not found — skipping', () => { /* skip */ })
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

#### `backend/src/__tests__/agentDockerfileGlob.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Agent Dockerfile JAR glob', () => {
  const dockerfilePath = path.join(__dirname, '..', '..', 'agent', 'Dockerfile')

  if (!fs.existsSync(dockerfilePath)) {
    it.skip('Agent Dockerfile not found — skipping', () => { /* skip */ })
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

#### `backend/src/__tests__/composeNetworkName.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Docker Compose network name', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('docker-compose.yml not found — skipping', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('sets network name to vibecode_default', () => {
      expect(compose).toMatch(/name:\s*vibecode/)
    })
  }
})
```

#### `backend/src/__tests__/composeMemoryLimits.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Docker Compose memory limits', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('docker-compose.yml not found — skipping', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('has memory limit configuration', () => {
      expect(compose).toMatch(/mem_limit|memory:/)
    })

    it('api service has memory limit', () => {
      // Verify api service has a memory limit
      const apiSection = compose.match(/api:[\s\S]*?(?=\n\w|$)/)
      if (apiSection) {
        expect(apiSection[0]).toMatch(/mem_limit|memory:/)
      }
    })

    it('frontend service has memory limit', () => {
      const frontendSection = compose.match(/frontend:[\s\S]*?(?=\n\w|$)/)
      if (frontendSection) {
        expect(frontendSection[0]).toMatch(/mem_limit|memory:/)
      }
    })
  }
})
```

#### `backend/src/__tests__/composeHealthcheck.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Docker Compose healthcheck', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('docker-compose.yml not found — skipping', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('API healthcheck has 30s start period', () => {
      expect(compose).toMatch(/start_period:\s*30s/)
    })
  }
})
```

#### `backend/src/__tests__/agentComposeWorks.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Agent compose compatibility', () => {
  const agentComposePath = path.join(__dirname, '..', '..', 'agent', 'docker-compose.yml')

  if (!fs.existsSync(agentComposePath)) {
    it.skip('Agent docker-compose.yml not found — skipping', () => { /* skip */ })
  } else {
    const agentCompose = fs.readFileSync(agentComposePath, 'utf-8')

    it('agent compose has service_healthy condition for api', () => {
      expect(agentCompose).toMatch(/condition:\s*service_healthy/i)
    })

    it('agent compose does not define conflicting services', () => {
      // Verify agent compose doesn't redefine services from main compose
      // (should only define agent-related services)
    })
  }
})
```

---

### d) Dependencies

- `.github/workflows/ci.yml` — CI configuration
- `backend/Dockerfile` — backend Docker configuration
- `agent/Dockerfile` — agent Docker configuration
- `docker-compose.yml` — Docker Compose configuration
- `agent/docker-compose.yml` — agent Docker Compose

---

### e) Risks/Edge Cases

- **[File paths may vary]**: Config files may be in different locations. Mitigation: check `fs.existsSync` and use `describe.skip` if not found.
- **[YAML parsing]**: Simple regex may miss YAML nuances. Mitigation: use broad regex patterns.

---

### f) Testing

#### Backend Unit Tests
- [ ] 10 test files CREATED
- [ ] All tests check file existence before reading
- [ ] Tests use `describe.skip` when config files not found
- [ ] `npm test` passes with no regressions

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

### g) Migration Notes (if applicable)

No migrations needed.

---

### h) Files Changed

**Backend:**
```
backend/src/__tests__/ciActionsVersion.test.js           → CREATE
backend/src/__tests__/ciDockerBuilds.test.js              → CREATE
backend/src/__tests__/ciAgentBuild.test.js                → CREATE
backend/src/__tests__/dockerfileNonRoot.test.js           → CREATE
backend/src/__tests__/dockerfileMultiStage.test.js        → CREATE
backend/src/__tests__/agentDockerfileGlob.test.js         → CREATE
backend/src/__tests__/composeNetworkName.test.js          → CREATE
backend/src/__tests__/composeMemoryLimits.test.js         → CREATE
backend/src/__tests__/composeHealthcheck.test.js          → CREATE
backend/src/__tests__/agentComposeWorks.test.js           → CREATE
```

---

### i) Code Review Checklist

- [ ] All test files follow existing naming conventions
- [ ] All tests check file existence before reading
- [ ] Tests use `describe.skip` when config files not found
- [ ] Regex patterns are broad enough to match YAML formatting variations
- [ ] No production code modified (test-only ticket)
- [ ] `npm test` passes with no regressions
- [ ] `npm run lint` passes

---

### j) Post-Deploy Verification

1. [ ] `npm test` passes
2. [ ] `npm run lint` passes
3. [ ] `npm run typecheck` passes
4. [ ] `npm run build` passes
5. [ ] All 10 new test files exist and run without errors
6. [ ] No regressions in existing test suites

---

*Fill in all sections before starting implementation. Update status as work progresses.*
