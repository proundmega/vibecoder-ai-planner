# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, bp-55 (Dead Code Cleanup)

---

## Problem Statement

bp-55 removed dead code and unused dependencies manually. Without automated tests, future developers cannot verify that dependencies are truly unused, builds succeed after removal, or `.gitignore` behavior is correct. Manual grep scans are error-prone and not tracked in CI.

---

## Current State

### Existing Backend
- `backend/package.json` — dependencies after bp-55 cleanup (axios removed, etc.)
- Root `package-lock.json` — removed by bp-55
- `backend/.gitignore` and root `.gitignore` — verify patterns
- Dockerfiles: `backend/Dockerfile`, `frontend/Dockerfile`, `agent/Dockerfile`

### Existing Frontend
- `frontend/cypress/` — verify no axios usage
- `frontend/src/components/` — verify Heroicons usage
- `frontend/src/i18n/` or `frontend/src/main.ts` — verify vue-i18n config
- `frontend/package.json` — dependencies after bp-55 cleanup

### Gap Analysis
- **No automated tests** for dependency removal verification
- **No tests** for `npm install` success after cleanup
- **No tests** for Docker build success
- **No tests** for `.gitignore` behavior
- **No tests** for Cypress dependency verification
- **No tests** for Heroicons usage verification
- **No tests** for vue-i18n usage verification

---

## Design

### Test Architecture

All tests use `child_process.exec` or `fs`/`glob` to verify file system state and command outcomes. Tests that require Docker or network access are wrapped in `describe.skip` with a message if the prerequisite is unavailable.

#### `backend/src/__tests__/depRemovalVerification.test.js`

```javascript
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

describe('Dependency removal verification', () => {
  const REMOVED_DEPS = ['axios', '@vue/compat', ...] // from bp-55

  function grepFiles(pattern, dir) {
    const result = execSync(`grep -r --include='*.js' --include='*.ts' --include='*.vue' "${pattern}" ${dir}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim()
    return result
  }

  for (const dep of REMOVED_DEPS) {
    it(`${dep} is not imported in backend production code`, () => {
      const backendDir = path.join(__dirname, '..', '..')
      const found = grepFiles(dep, backendDir)
      expect(found).toBe('')
    })

    it(`${dep} is not in backend/package.json`, () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'))
      expect(pkg.dependencies[dep]).toBeUndefined()
      expect(pkg.devDependencies[dep]).toBeUndefined()
    })
  }
})
```

#### `backend/src/__tests__/npmInstallSucceeds.test.js`

```javascript
const { execSync } = require('child_process')
const path = require('path')

describe('npm install succeeds after dep removal', () => {
  it('backend npm install exits with code 0', () => {
    const backendDir = path.join(__dirname, '..', '..')
    const result = execSync('npm install --prefer-offline', {
      cwd: backendDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    expect(result).toContain('added')
  })

  it('frontend npm install exits with code 0', () => {
    const frontendDir = path.join(__dirname, '..', '..', 'frontend')
    const result = execSync('npm install --prefer-offline', {
      cwd: frontendDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    expect(result).toContain('added')
  })
})
```

#### `backend/src/__tests__/dockerBuildSucceeds.test.js`

```javascript
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

describe('Docker build succeeds after dep removal', () => {
  const dockerAvailable = fs.existsSync('/var/run/docker.sock') || process.env.DOCKER_HOST

  describe.skipIfDockerUnavailable = !dockerAvailable

  it('docker compose up --build succeeds', () => {
    const rootDir = path.join(__dirname, '..', '..')
    const result = execSync('docker compose up --build -d', {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 300000 // 5 minutes
    })
    expect(result).toBeDefined()
  })

  it('backend Dockerfile does not reference root package-lock.json', () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'Dockerfile'), 'utf-8')
    expect(dockerfile).not.toMatch(/package-lock\.json/)
  })
})
```

#### `backend/src/__tests__/gitignoreBehavior.test.js`

```javascript
const fs = require('fs')
const path = require('path')

describe('.gitignore behavior', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf-8')

  it('root package-lock.json is ignored', () => {
    expect(gitignore).toMatch(/\/package-lock\.json/)
  })

  it('subdirectory package-lock.json is tracked (not ignored)', () => {
    // Check that backend/ and frontend/ lockfiles are NOT in gitignore
    expect(gitignore).not.toMatch(/backend\/package-lock\.json/)
    expect(gitignore).not.toMatch(/frontend\/package-lock\.json/)
  })

  it('node_modules is ignored', () => {
    expect(gitignore).toMatch(/node_modules/)
  })
})
```

#### `frontend/src/__tests__/cypressDepVerification.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

describe('Cypress dependency verification', () => {
  it('no axios imports in frontend/cypress/', () => {
    const cypressDir = path.join(__dirname, '..', 'cypress')
    if (!fs.existsSync(cypressDir)) {
      return // skip if cypress dir doesn't exist
    }
    const result = execSync(`grep -r --include='*.ts' --include='*.js' 'axios' ${cypressDir}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim()
    expect(result).toBe('')
  })

  it('no axios import in cypress/support/', () => {
    const supportDir = path.join(__dirname, '..', 'cypress', 'support')
    if (!fs.existsSync(supportDir)) return
    const result = execSync(`grep -r 'axios' ${supportDir}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim()
    expect(result).toBe('')
  })
})
```

#### `frontend/src/__tests__/heroiconsUsage.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

describe('Heroicons usage in Vue components', () => {
  it('Heroicons are imported correctly', () => {
    const srcDir = path.join(__dirname, '..', 'src')
    if (!fs.existsSync(srcDir)) return
    const result = execSync(`grep -r '@heroicons' ${srcDir}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim()
    // Verify import paths match expected pattern
    if (result) {
      expect(result).toMatch(/@heroicons\/vue2\/solid/)
    }
  })

  it('no @heroicons/vite or @heroicons/react imports', () => {
    const srcDir = path.join(__dirname, '..', 'src')
    if (!fs.existsSync(srcDir)) return
    const result = execSync(`grep -r '@heroicons/vite\\|@heroicons/react' ${srcDir}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim()
    expect(result).toBe('')
  })
})
```

#### `frontend/src/__tests__/vueI18nUsage.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

describe('vue-i18n usage', () => {
  it('i18n is configured in main.ts or i18n config', () => {
    const mainTs = path.join(__dirname, '..', 'src', 'main.ts')
    if (!fs.existsSync(mainTs)) return
    const content = fs.readFileSync(mainTs, 'utf-8')
    expect(content).toMatch(/i18n/)
  })

  it('Vue components use $t() or useI18n()', () => {
    const srcDir = path.join(__dirname, '..', 'src')
    if (!fs.existsSync(srcDir)) return
    const result = execSync(`grep -r '\\$t(\\|useI18n' ${srcDir}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim()
    // Verify at least some components use i18n
    expect(result.length).toBeGreaterThan(0)
  })

  it('i18n locale files exist', () => {
    const localesDir = path.join(__dirname, '..', 'src', 'locales')
    expect(fs.existsSync(localesDir)).toBe(true)
  })
})
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/__tests__/depRemovalVerification.test.js` | CREATE | Grep scan for removed deps |
| `backend/src/__tests__/npmInstallSucceeds.test.js` | CREATE | Verify npm install succeeds |
| `backend/src/__tests__/dockerBuildSucceeds.test.js` | CREATE | Verify docker build succeeds |
| `backend/src/__tests__/gitignoreBehavior.test.js` | CREATE | Verify .gitignore behavior |
| `frontend/src/__tests__/cypressDepVerification.test.ts` | CREATE | Verify no axios in Cypress |
| `frontend/src/__tests__/heroiconsUsage.test.ts` | CREATE | Verify Heroicons usage |
| `frontend/src/__tests__/vueI18nUsage.test.ts` | CREATE | Verify vue-i18n usage |

---

## Dependencies

### Backend Dependencies
- `backend/package.json` — verify dependencies
- Root `.gitignore` — verify patterns
- `backend/Dockerfile` — verify no root lockfile reference
- `child_process.execSync` — run npm/docker commands

### Frontend Dependencies
- `frontend/cypress/` — verify no axios
- `frontend/src/components/` — verify Heroicons
- `frontend/src/main.ts` or `frontend/src/i18n/` — verify vue-i18n

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/*.test.js` | Grep scans, file system checks, npm install |
| Frontend unit | Vitest | `frontend/src/__tests__/*.test.ts` | Grep scans, file system checks |

---

## Risks and Edge Cases

### Backend Risks
- **[Docker not available]**: Docker tests must use `describe.skip` if Docker socket not found.
- **[npm install is slow]**: `npm install` tests may timeout. Mitigation: use `--prefer-offline` flag, increase timeout.
- **[grep false positives]**: Comments or strings containing dependency names. Mitigation: use `--include='*.js'` to limit scope.

### Frontend Risks
- **[Cypress directory may not exist]**: Tests should check `fs.existsSync` before running grep.
- **[Heroicons version may vary]**: Tests should accept both `@heroicons/vue2` and `@heroicons/vue` patterns.

---

## Alternative Designs Considered

### Alternative 1: ESLint plugin for dep removal
- **Pros**: Integrated into linting, catches imports at parse time
- **Cons**: Requires new dependency, more complex setup
- **Decision**: Grep scan is simpler and sufficient for verification

### Alternative 2: npm ls for dependency tree
- **Pros**: Shows actual used dependencies
- **Cons**: Requires `npm install` first, slower
- **Decision**: Direct grep + package.json check is faster and more targeted

---

*This design document guides implementation.*
