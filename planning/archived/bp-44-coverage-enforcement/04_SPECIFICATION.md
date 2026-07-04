# bp-44: Add Coverage Thresholds and Make Coverage Visible in CI — Spec

**Target model**: 7B–14B (JavaScript, YAML)
**Date**: 2026-06-27

## File Operations

### MODIFY: `backend/jest.config.js`

**Add** to `module.exports`:
```javascript
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
  '!src/validators/**',
],
```

### MODIFY: `frontend/vite.config.ts`

**Add** to `defineConfig({ ... })`:
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
    include: ['src/**/*.ts'],
    exclude: ['src/__tests__/**', 'src/api/generated/**'],
  },
},
```

### Install frontend dependency

```bash
cd frontend && npm install --save-dev @vitest/coverage-v8
```

### MODIFY: `.github/workflows/ci.yml`

**Backend job** — change test step and add artifact upload:
```yaml
      - name: Run tests with coverage
        run: npm test -- --coverage
        working-directory: backend
      - name: Upload backend coverage
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: backend-coverage
          path: backend/coverage/
          retention-days: 7
```

**Frontend job** — change test step and add artifact upload:
```yaml
      - name: Run tests with coverage
        run: npm test -- --run --coverage
        working-directory: frontend
      - name: Upload frontend coverage
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: frontend-coverage
          path: frontend/coverage/
          retention-days: 7
```

## Test Expectations

```
✓ npm test -- --coverage in backend produces coverage/ directory
✓ npm test -- --run --coverage in frontend produces coverage/ directory
✓ CI fails when coverage is below threshold (test by temporarily raising to 99%)
✓ Coverage artifacts downloadable from GitHub Actions run page
✓ Frontend coverage HTML report is navigable (index.html + source files)
```

## Edge Cases

1. **Excluded files**: `src/migrations/`, `src/__tests__/`, `src/validators/` — not counted in coverage totals
2. **Partial failure**: Coverage upload uses `if: always()` so report is available even if tests fail
3. **Threshold too high**: If current code is below 70/60/70/70, lower thresholds during first implementation and raise in a follow-up
4. **E2E coverage**: Not included — coverage is for unit tests only (Cypress coverage would need @cypress/code-coverage plugin)
