# bp-44: Add Coverage Thresholds and Make Coverage Visible in CI — Implementation

**Status**: planned
**Priority**: P2
**Effort**: Small
**Scope**: Testing / CI

## Purpose
Enforce minimum coverage thresholds and make coverage reports accessible in CI.

## Implementation Order

1. **Modify `backend/jest.config.js`** — add coverage configuration
2. **Modify `frontend/vite.config.ts`** — add Vitest coverage configuration
3. **Install `@vitest/coverage-v8`** in frontend
4. **Modify `.github/workflows/ci.yml`** — add `--coverage` flags and artifact uploads
5. **Run tests locally** — verify coverage reports are generated and thresholds pass

## Per-File Action Plan

### `backend/jest.config.js` (MODIFY)

Add near the top of the config object (or within the module.exports):
```javascript
module.exports = {
  // ... existing config ...
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
  },
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/migrations/**',
    '!src/__tests__/**',
    '!src/validators/**',       // validation schemas are not worth testing
  ],
};
```

### `frontend/vite.config.ts` (MODIFY)

Add `test.coverage` to the existing defineConfig:
```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  // ... existing config ...
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/api/generated/**'],
    },
  },
});
```

Then install: `npm install --save-dev @vitest/coverage-v8`

### `.github/workflows/ci.yml` (MODIFY)

In the `backend` job, change:
```yaml
- run: npm test
```
to:
```yaml
- run: npm test -- --coverage
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: backend-coverage
    path: backend/coverage/
    retention-days: 7
```

In the `frontend` job, add `--coverage` to the test step:
```yaml
- run: npm test -- --run --coverage
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: frontend-coverage
    path: frontend/coverage/
    retention-days: 7
```

Use `if: always()` so coverage artifacts are uploaded even on test failure.

## Migration Plan
No database changes. No API changes.

## Test Plan
1. Run `npm test -- --coverage` in backend — verify coverage report generated in `backend/coverage/`
2. Run `npm test -- --run --coverage` in frontend — verify coverage report generated in `frontend/coverage/`
3. Temporarily lower threshold, verify CI fails (then restore)
4. Verify artifacts appear in GitHub Actions run summary

## Rollback Steps
1. Remove coverage config from jest.config.js and vite.config.ts
2. Remove --coverage flags from ci.yml
3. Remove upload-artifact steps from ci.yml
