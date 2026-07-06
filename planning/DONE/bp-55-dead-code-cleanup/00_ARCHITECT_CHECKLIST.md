# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Both

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified the root `Dockerfile` is not referenced by any `docker-compose.yml` or CI config
- [ ] I have verified `frontend/package.json` axios is not imported anywhere (`grep -r "from 'axios'" frontend/src/`)
- [ ] I have verified `frontend/package.json` vue-i18n is not imported anywhere
- [ ] I have verified `frontend/package.json` @heroicons/vue is not imported anywhere
- [ ] I have verified `backend/package.json` axios is not required anywhere (`grep -r "require('axios')" backend/src/`)
- [ ] I have verified `backend/package.json` slugify is not required anywhere
- [ ] I have verified the `INTEGRATION_TESTS=1` env var is not read by any backend code
- [ ] I have counted planning subdirectories and identified which are completed tickets
- [ ] I have checked if `ARCHITECT/` directory content overlaps with `planning/`

### Testing Strategy

- [ ] Verify no functionality breaks after removing dead dependencies
- [ ] Smoke test backend startup after removing dead deps
- [ ] Smoke test frontend build after removing dead deps
- [ ] Verify archived planning docs are still accessible

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] All tests pass (`npm test` in backend + frontend)
- [ ] Frontend builds (`npm run build`)
- [ ] Backend starts without errors (`node src/index.js`)
- [ ] Linting passes (`npm run lint`)
