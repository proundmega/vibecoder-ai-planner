# bp-44: Add Coverage Thresholds and Make Coverage Visible in CI

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Testing / CI
**Priority**: P2
**Effort**: Small

## Problem Statement

The project has no code coverage enforcement. New code can drop coverage without anyone noticing. There is no coverage report in CI output, no badge, and no PR gate. Developers have no visibility into which parts of the codebase are tested.

## Scope

- **In scope**: Add Jest `coverageThreshold`, add Vitest coverage config, add `--coverage` to CI, upload coverage reports as artifacts
- **Out of scope**: Adding new tests to raise coverage, migrating to codecov/coveralls

## Acceptance Criteria

- [ ] Backend CI fails if coverage drops below thresholds (statements: 70%, branches: 60%, functions: 70%, lines: 70%)
- [ ] Frontend CI fails if coverage drops below same thresholds
- [ ] Coverage reports are uploaded as GitHub Actions artifacts
- [ ] Coverage report is viewable as a downloadable HTML or JSON artifact

## Known Unknowns

- **Current coverage levels**: Whether backend/frontend currently meet the proposed thresholds
- **Threshold tuning**: Initial thresholds may be too high or too low; adjust after first CI run

## Decisions Required

1. **Coverage upload destination?**
   - Option A: GitHub Actions artifacts (simple, no third-party)
   - Option B: Codecov (richer UI, PR comments, badge)
   - Option C: Coveralls (similar to Codecov)
   - **Recommendation**: Option A first, Option B later — zero external dependencies now

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/jest.config.js` | MODIFY | Add `coverageThreshold` block |
| `frontend/vite.config.ts` | MODIFY | Add `test.coverage` config |
| `.github/workflows/ci.yml` | MODIFY | Add `--coverage` flags, upload-artifact step |
