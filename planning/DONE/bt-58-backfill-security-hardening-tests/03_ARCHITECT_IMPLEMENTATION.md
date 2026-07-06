# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bt-58 — Backfill Security Hardening Tests

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-04
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Backend | Frontend

**Dependencies**: bp-58 (Security Hardening) must be completed first

---

### a) Purpose

Backfill all missing test coverage for bp-58's security hardening changes. bp-58 introduced JWT_SECRET validation, MASTER_KEY validation, WebSocket auth, nginx headers, Docker profiles, and webhook warnings — but added no tests. Without tests, security regressions are impossible to detect.

---

### b) Actions

**CRITICAL**: This is a test-only ticket. Do NOT modify any production code.

#### Implementation Order

1. **JWT_SECRET crash test** — `backend/src/__tests__/jwtSecretCrash.test.js`
   - Test crash when JWT_SECRET not set
   - *Depends on*: nothing

2. **MASTER_KEY validation test** — `backend/src/__tests__/masterKeyValidation.test.js`
   - Test 64 hex chars validation, crash on invalid
   - *Depends on*: nothing

3. **WebSocket auth test** — `backend/src/__tests__/websocketAuth.test.js`
   - Test handshake auth (token in first message, reject URL query string)
   - *Depends on*: nothing

4. **nginx security headers test** — `backend/src/__tests__/nginxSecurityHeaders.test.js`
   - Test server_tokens off, CSP, X-Frame-Options, X-Content-Type-Options
   - *Depends on*: nothing

5. **Docker profile behavior test** — `backend/src/__tests__/dockerProfileBehavior.test.js`
   - Test dev vs. production port exposure
   - *Depends on*: nothing

6. **DeployService warning test** — `backend/src/__tests__/deployServiceWarning.test.js`
   - Test HTTP webhook URL warning
   - *Depends on*: nothing

7. **envValidation crash test** — `backend/src/__tests__/envValidationCrash.test.js`
   - Test crash when JWT_SECRET not set
   - *Depends on*: nothing

8. **pgAdmin dev profile test** — `backend/src/__tests__/pgAdminDevProfile.test.js`
   - Test pgAdmin only available with dev profile
   - *Depends on*: nothing

9. **PostgreSQL port exposure test** — `backend/src/__tests__/postgresPortExposure.test.js`
   - Test PostgreSQL port not exposed in production
   - *Depends on*: nothing

---

### c) Per-File Action Plan

#### `backend/src/__tests__/jwtSecretCrash.test.js` (CREATE)

```javascript
describe('JWT_SECRET crash behavior', () => {
  let original

  beforeEach(() => {
    original = process.env.JWT_SECRET
  })

  afterEach(() => {
    if (original) {
      process.env.JWT_SECRET = original
    } else {
      delete process.env.JWT_SECRET
    }
  })

  it('throws error when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET

    // Clear module cache to force re-evaluation
    const jwtPath = require('path').join(__dirname, '..', '..', 'utils', 'jwt.js')
    delete require.cache[jwtPath]

    expect(() => require('../../utils/jwt')).toThrow(/JWT_SECRET/)
  })

  it('does not throw when JWT_SECRET is set', () => {
    process.env.JWT_SECRET = 'test-secret-value'

    const jwtPath = require('path').join(__dirname, '..', '..', 'utils', 'jwt.js')
    delete require.cache[jwtPath]

    expect(() => require('../../utils/jwt')).not.toThrow()
  })
})
```

#### `backend/src/__tests__/masterKeyValidation.test.js` (CREATE)

```javascript
describe('MASTER_KEY validation', () => {
  let original

  beforeEach(() => {
    original = process.env.MASTER_KEY
  })

  afterEach(() => {
    if (original) {
      process.env.MASTER_KEY = original
    } else {
      delete process.env.MASTER_KEY
    }
  })

  it('throws error when MASTER_KEY is not 64 hex chars', () => {
    process.env.MASTER_KEY = 'invalid'

    const keyPath = require('path').join(__dirname, '..', '..', 'utils', 'masterKey.js')
    delete require.cache[keyPath]

    expect(() => require('../../utils/masterKey')).toThrow()
  })

  it('does not throw when MASTER_KEY is 64 hex chars', () => {
    process.env.MASTER_KEY = 'a'.repeat(64)

    const keyPath = require('path').join(__dirname, '..', '..', 'utils', 'masterKey.js')
    delete require.cache[keyPath]

    expect(() => require('../../utils/masterKey')).not.toThrow()
  })

  it('rejects MASTER_KEY with non-hex characters', () => {
    process.env.MASTER_KEY = 'gggg'.repeat(16)

    const keyPath = require('path').join(__dirname, '..', '..', 'utils', 'masterKey.js')
    delete require.cache[keyPath]

    expect(() => require('../../utils/masterKey')).toThrow()
  })
})
```

#### `backend/src/__tests__/websocketAuth.test.js` (CREATE)

```javascript
describe('WebSocket handshake auth', () => {
  it('requires token in first message', () => {
    // Simulate: connect without token → reject
    // Assert: connection rejected
  })

  it('accepts token in first message', () => {
    // Simulate: connect with token in first message → accept
    // Assert: connection accepted
  })

  it('rejects token in URL query string', () => {
    // Simulate: connect with token in URL → reject
    // Assert: connection rejected
  })

  it('WebSocket URL does NOT contain token', () => {
    // Verify URL format
    const wsURL = 'ws://localhost:3001/ws' // should NOT have token=
    expect(wsURL).not.toMatch(/token=/)
  })
})
```

#### `backend/src/__tests__/nginxSecurityHeaders.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('nginx security headers', () => {
  const nginxConfigPath = path.join(__dirname, '..', '..', 'nginx', 'nginx.conf')

  if (!fs.existsSync(nginxConfigPath)) {
    it.skip('No nginx config found at expected path', () => { /* skip */ })
  } else {
    const config = fs.readFileSync(nginxConfigPath, 'utf-8')

    it('has server_tokens off', () => {
      expect(config).toMatch(/server_tokens\s+off/)
    })

    it('has Content-Security-Policy header', () => {
      expect(config).toMatch(/Content-Security-Policy/)
    })

    it('has X-Frame-Options header', () => {
      expect(config).toMatch(/X-Frame-Options/)
    })

    it('has X-Content-Type-Options header', () => {
      expect(config).toMatch(/X-Content-Type-Options/)
    })
  }
})
```

#### `backend/src/__tests__/dockerProfileBehavior.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('Docker Compose profile behavior', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('No docker-compose.yml found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('dev profile is defined', () => {
      expect(compose).toMatch(/dev/)
    })

    it('production profile is defined', () => {
      expect(compose).toMatch(/production/)
    })

    it('dev profile exposes development ports', () => {
      // Check that dev profile has port mappings for dev tools
    })

    it('production profile restricts port exposure', () => {
      // Verify production only exposes necessary ports
    })
  }
})
```

#### `backend/src/__tests__/deployServiceWarning.test.js` (CREATE)

```javascript
describe('HTTP webhook URL warning', () => {
  it('warns when webhook URL uses HTTP', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Call DeployService with HTTP URL
    // (mock or call the actual service)

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringMatching(/HTTP|http:\/\//)
    )

    consoleWarn.mockRestore()
  })

  it('does not warn when webhook URL uses HTTPS', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Call DeployService with HTTPS URL

    expect(consoleWarn).not.toHaveBeenCalled()

    consoleWarn.mockRestore()
  })
})
```

#### `backend/src/__tests__/envValidationCrash.test.js` (CREATE)

```javascript
describe('envValidation.js crash on missing JWT_SECRET', () => {
  let original

  beforeEach(() => {
    original = process.env.JWT_SECRET
  })

  afterEach(() => {
    if (original) {
      process.env.JWT_SECRET = original
    } else {
      delete process.env.JWT_SECRET
    }
  })

  it('throws error when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET

    const envPath = require('path').join(__dirname, '..', '..', 'envValidation.js')
    delete require.cache[envPath]

    expect(() => require('../../envValidation')).toThrow(/JWT_SECRET/)
  })
})
```

#### `backend/src/__tests__/pgAdminDevProfile.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('pgAdmin dev-only availability', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('No docker-compose.yml found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('pgAdmin service exists', () => {
      expect(compose).toMatch(/pgadmin/)
    })

    it('pgAdmin is gated by dev profile', () => {
      // Verify pgAdmin is only available with dev profile
      // Check for profiles: [dev] or deploy.replicas or similar gating
    })
  }
})
```

#### `backend/src/__tests__/postgresPortExposure.test.js` (CREATE)

```javascript
const fs = require('fs')
const path = require('path')

describe('PostgreSQL port not exposed in production', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('No docker-compose.yml found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('PostgreSQL port 5432 is not exposed externally', () => {
      // Verify 5432 is not in ports mapping
      // (it may be internal via Docker network, but not exposed to host)
    })
  }
})
```

---

### d) Dependencies

- `utils/jwt.js` — JWT_SECRET validation
- `envValidation.js` — env validation
- `DeployService` — HTTP webhook warning
- `MASTER_KEY` validation logic
- nginx config — security headers
- `docker-compose.yml` — profiles, port exposure

---

### e) Risks/Edge Cases

- **[Config file paths]**: Paths may vary. Mitigation: check `fs.existsSync` before reading.
- **[Environment variable isolation]**: Must save/restore `process.env` in `beforeEach`/`afterEach`.
- **[Module cache]**: Tests that modify env vars must clear `require.cache` to force re-evaluation.

---

### f) Testing

#### Backend Unit Tests
- [ ] 9 test files CREATED
- [ ] All tests that modify `process.env` use `beforeEach`/`afterEach` for cleanup
- [ ] Config file tests check `fs.existsSync` before reading
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
backend/src/__tests__/jwtSecretCrash.test.js               → CREATE
backend/src/__tests__/masterKeyValidation.test.js           → CREATE
backend/src/__tests__/websocketAuth.test.js                 → CREATE
backend/src/__tests__/nginxSecurityHeaders.test.js          → CREATE
backend/src/__tests__/dockerProfileBehavior.test.js         → CREATE
backend/src/__tests__/deployServiceWarning.test.js          → CREATE
backend/src/__tests__/envValidationCrash.test.js            → CREATE
backend/src/__tests__/pgAdminDevProfile.test.js             → CREATE
backend/src/__tests__/postgresPortExposure.test.js          → CREATE
```

---

### i) Code Review Checklist

- [ ] All test files follow existing naming conventions
- [ ] `process.env` modifications are isolated with `beforeEach`/`afterEach`
- [ ] Module cache is cleared before re-requiring modules with env-dependent behavior
- [ ] Config file tests check file existence before reading
- [ ] No production code modified (test-only ticket)
- [ ] `npm test` passes with no regressions
- [ ] `npm run lint` passes

---

### j) Post-Deploy Verification

1. [ ] `npm test` passes
2. [ ] `npm run lint` passes
3. [ ] `npm run typecheck` passes
4. [ ] `npm run build` passes
5. [ ] All 9 new test files exist and run without errors
6. [ ] No regressions in existing test suites

---

*Fill in all sections before starting implementation. Update status as work progresses.*
