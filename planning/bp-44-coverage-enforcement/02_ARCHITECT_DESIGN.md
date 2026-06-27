# bp-44: Add Coverage Thresholds and Make Coverage Visible in CI — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Testing / CI

## Current State

Backend (Jest): `jest.config.js` has no `coverageThreshold` option. Tests run with `npm test` which uses `--watchAll` by default; `--coverage` is not passed.

Frontend (Vitest): `vite.config.ts` does not include a `test` block. Coverage is not configured.

CI: `ci.yml` runs `npm test` without `--coverage`. No coverage reports are generated or stored.

## Proposed Solution

### Backend Jest Config

Add to `jest.config.js`:
```javascript
coverageThreshold: {
  global: {
    statements: 70,
    branches: 60,
    functions: 70,
    lines: 70,
  },
},
coverageDirectory: 'coverage',
collectCoverageFrom: [
  'src/**/*.js',
  '!src/migrations/**',
  '!src/__tests__/**',
],
```

### Frontend Vitest Config

Add `test` block to `vite.config.ts` or create `vitest.config.ts`:
```typescript
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
  },
},
```

Install `@vitest/coverage-v8` as dev dependency.

### CI Changes

```yaml
# backend job
- run: npm test -- --coverage
- uses: actions/upload-artifact@v4
  with:
    name: backend-coverage
    path: backend/coverage/
    retention-days: 7

# frontend job
- run: npm test -- --run --coverage
- uses: actions/upload-artifact@v4
  with:
    name: frontend-coverage
    path: frontend/coverage/
    retention-days: 7
```

### Coverage Artifact Layout

```
backend-coverage/
  lcov-report/
  lcov.info
  clover.xml

frontend-coverage/
  index.html
  ...
```

## Alternatives Considered

- **Codecov**: Better UI but requires org-level auth token; not worth the initial complexity
- **Coveralls**: Same reasoning
- **Threshold-only (no artifact)**: Developer cannot inspect coverage locally — rejected

## File-Level Impact Matrix

| File | Action | Details |
|------|--------|---------|
| `backend/jest.config.js` | MODIFY | Add coverageThreshold, coverageDirectory, collectCoverageFrom |
| `frontend/vite.config.ts` | MODIFY | Add test.coverage block |
| `.github/workflows/ci.yml` | MODIFY | Add --coverage flags and upload-artifact steps |
