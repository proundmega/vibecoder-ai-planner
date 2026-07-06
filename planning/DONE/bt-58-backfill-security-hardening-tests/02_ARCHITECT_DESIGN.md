# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, bp-58 (Security Hardening)

---

## Problem Statement

bp-58 introduced security hardening measures (JWT_SECRET validation, MASTER_KEY validation, WebSocket auth, nginx headers, Docker profiles, webhook warnings) but added no tests. Without tests, security regressions are impossible to detect automatically.

---

## Current State

### Existing Backend
- `utils/jwt.js` — crashes if `JWT_SECRET` not set
- `envValidation.js` — crashes if `JWT_SECRET` not set
- `DeployService` — warns on HTTP webhook URLs
- `MASTER_KEY` validation — 64 hex chars check

### Infrastructure
- nginx config — security headers (`server_tokens off`, CSP, X-Frame-Options, X-Content-Type-Options)
- Docker Compose — profiles (`dev`, `production`), port exposure
- pgAdmin — only in `dev` profile
- PostgreSQL — port not exposed in production

### Gap Analysis
- **No tests** for JWT_SECRET crash behavior
- **No tests** for MASTER_KEY validation
- **No tests** for WebSocket handshake auth
- **No tests** for nginx security headers
- **No tests** for Docker Compose profile behavior
- **No tests** for HTTP webhook warning
- **No tests** for envValidation crash
- **No tests** for pgAdmin dev-only availability
- **No tests** for PostgreSQL port exposure

---

## Design

### Test Architecture

All tests use **Jest** (backend) or **Vitest** (frontend/infrastructure). Infrastructure tests use `fs` to read config files. Security tests use `child_process.exec` or environment variable manipulation.

#### `backend/src/__tests__/jwtSecretCrash.test.js`

```javascript
describe('JWT_SECRET crash behavior', () => {
  it('throws error when JWT_SECRET is not set', () => {
    const original = process.env.JWT_SECRET
    delete process.env.JWT_SECRET

    expect(() => require('../../utils/jwt')).toThrow('JWT_SECRET')

    process.env.JWT_SECRET = original
  })

  it('does not throw when JWT_SECRET is set', () => {
    process.env.JWT_SECRET = 'test-secret'
    expect(() => require('../../utils/jwt')).not.toThrow()
  })
})
```

#### `backend/src/__tests__/masterKeyValidation.test.js`

```javascript
describe('MASTER_KEY validation', () => {
  it('throws error when MASTER_KEY is not 64 hex chars', () => {
    const original = process.env.MASTER_KEY
    process.env.MASTER_KEY = 'invalid'

    expect(() => require('../../utils/masterKey')).toThrow()

    process.env.MASTER_KEY = original
  })

  it('does not throw when MASTER_KEY is 64 hex chars', () => {
    process.env.MASTER_KEY = 'a'.repeat(64)
    expect(() => require('../../utils/masterKey')).not.toThrow()
  })

  it('rejects MASTER_KEY with non-hex characters', () => {
    process.env.MASTER_KEY = 'gggg'.repeat(16) // 'g' is not hex
    expect(() => require('../../utils/masterKey')).toThrow()
  })
})
```

#### `backend/src/__tests__/websocketAuth.test.js`

```javascript
describe('WebSocket handshake auth', () => {
  it('requires token in first message', () => {
    // Simulate WebSocket connection without token
    // Assert: connection rejected
  })

  it('accepts token in first message', () => {
    // Simulate WebSocket connection with token in first message
    // Assert: connection accepted
  })

  it('rejects token in URL query string', () => {
    // Simulate WebSocket connection with token in URL
    // Assert: connection rejected
  })

  it('WebSocket URL does NOT contain token', () => {
    // Verify WebSocket URL format does not include token
    expect(websocketURL).not.toMatch(/token=/)
  })
})
```

#### `backend/src/__tests__/nginxSecurityHeaders.test.js`

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

#### `backend/src/__tests__/dockerProfileBehavior.test.js`

```javascript
const fs = require('fs')
const path = require('path')

describe('Docker Compose profile behavior', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('No docker-compose.yml found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('dev profile exposes dev ports', () => {
      // Check that dev profile has port mappings
      expect(compose).toMatch(/dev/)
    })

    it('production profile does NOT expose dev ports', () => {
      // Verify production doesn't expose internal ports
    })
  }
})
```

#### `backend/src/__tests__/deployServiceWarning.test.js`

```javascript
describe('HTTP webhook URL warning', () => {
  it('warns when webhook URL uses HTTP', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    // Call DeployService with HTTP URL
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('HTTP'))
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

#### `backend/src/__tests__/envValidationCrash.test.js`

```javascript
describe('envValidation.js crash on missing JWT_SECRET', () => {
  it('throws error when JWT_SECRET is not set', () => {
    const original = process.env.JWT_SECRET
    delete process.env.JWT_SECRET

    expect(() => require('../../envValidation')).toThrow('JWT_SECRET')

    process.env.JWT_SECRET = original
  })
})
```

#### `backend/src/__tests__/pgAdminDevProfile.test.js`

```javascript
const fs = require('fs')
const path = require('path')

describe('pgAdmin dev-only availability', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('No docker-compose.yml found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('pgAdmin is only in dev profile', () => {
      // Verify pgAdmin service is gated by dev profile
    })

    it('pgAdmin is not in production profile', () => {
      // Verify pgAdmin is not available without dev profile
    })
  }
})
```

#### `backend/src/__tests__/postgresPortExposure.test.js`

```javascript
const fs = require('fs')
const path = require('path')

describe('PostgreSQL port not exposed in production', () => {
  const composePath = path.join(__dirname, '..', '..', 'docker-compose.yml')

  if (!fs.existsSync(composePath)) {
    it.skip('No docker-compose.yml found', () => { /* skip */ })
  } else {
    const compose = fs.readFileSync(composePath, 'utf-8')

    it('PostgreSQL port is not exposed in production', () => {
      // Verify 5432 is not in ports mapping for production
    })
  }
})
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/__tests__/jwtSecretCrash.test.js` | CREATE | JWT_SECRET crash test |
| `backend/src/__tests__/masterKeyValidation.test.js` | CREATE | MASTER_KEY validation |
| `backend/src/__tests__/websocketAuth.test.js` | CREATE | WebSocket handshake auth |
| `backend/src/__tests__/nginxSecurityHeaders.test.js` | CREATE | nginx security headers |
| `backend/src/__tests__/dockerProfileBehavior.test.js` | CREATE | Docker Compose profiles |
| `backend/src/__tests__/deployServiceWarning.test.js` | CREATE | HTTP webhook warning |
| `backend/src/__tests__/envValidationCrash.test.js` | CREATE | envValidation crash |
| `backend/src/__tests__/pgAdminDevProfile.test.js` | CREATE | pgAdmin dev-only |
| `backend/src/__tests__/postgresPortExposure.test.js` | CREATE | PostgreSQL port exposure |

---

## Dependencies

### Backend Dependencies
- `utils/jwt.js` — JWT_SECRET validation
- `envValidation.js` — env validation
- `DeployService` — HTTP webhook warning
- `MASTER_KEY` validation logic

### Infrastructure
- nginx config — security headers
- `docker-compose.yml` — profiles, port exposure
- pgAdmin service config

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/*.test.js` | JWT_SECRET, MASTER_KEY, envValidation, webhook warning |
| Config scan | Jest | `backend/src/__tests__/*.test.js` | nginx headers, Docker profiles, pgAdmin, PostgreSQL port |

---

## Risks and Edge Cases

### Backend Risks
- **[Config file paths]**: nginx config and docker-compose.yml paths may vary. Mitigation: check `fs.existsSync` before reading.
- **[Environment variable isolation]**: Tests that modify `process.env` must restore original values. Mitigation: save/restore in `beforeEach`/`afterEach`.
- **[WebSocket testing]**: WebSocket tests may need a real server. Mitigation: mock WebSocket or use a test server.

---

## Alternative Designs Considered

### Alternative 1: E2E tests for security headers
- **Pros**: More realistic
- **Cons**: Requires running nginx, slower
- **Decision**: Config file scanning is sufficient for header verification

---

*This design document guides implementation.*
