# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: 2026-08-06
**Date completed**:
**Author**: AI Assistant
**Feature scope**: Frontend

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below. Do NOT skip any step.

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [x] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [x] I have read `04_SPECIFICATION.md` — I know the exact file operations, signatures, and test expectations
- [x] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [x] I have verified there are no important design decisions that require user input (all are frontend response-shape/typing fixes following existing backend contracts — no design decisions pending)

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists — YES for all 5 findings; backend response shapes are CORRECT (verified against controllers/services)
- [x] I have checked if the **frontend API client** already exists — YES (all 5 are in `frontend/src/api/`)
- [x] I have checked if the **frontend UI component/screen** already exists — YES (ProjectDetail, GitHubConnections, PhaseFlow, ProjectTemplates)
- [x] I have checked if the **router** already has routes — YES (no routing changes)
- [x] I have checked if there are **existing patterns** I should follow — YES (same API client style, `extractData` unwrap semantics)
- [x] I have checked if the **feature should extend existing code** — YES, every fix modifies existing files, creates NO new production files
- [x] I have checked if **shared components** exist that I should reuse — N/A (no new UI)

### Both Frontend AND Backend

- [x] This ticket is FRONTEND-ONLY — backend API exists and is correct; no backend route/controller/service/model changes
- [x] If this feature is **UI/API only**, I have verified the existing API clients cover the needed endpoints — YES, the fix is aligning frontend reads/types to the actual backend shapes
- [x] I have checked the **OpenAPI spec** — NO backend JSDoc changes needed (backend untouched); generated types regeneration NOT required for these 5 (hand-written clients are authoritative)
- [x] I have checked if **frontend API response validation** (`validator.ts`) needs updating — R1 (usage breakdown) and R2 (billing) touch response shapes consumed by components; validator.ts only validates auth/permissions endpoints today, so NO change required unless a schema is added

### Dependency Analysis

- [x] No new npm/system dependencies
- [x] Existing services/modules affected: `frontend/src/api/{usage,billing,github,phases,templates}.ts`, `frontend/src/views/{ProjectDetail,GitHubConnections}.vue`, `frontend/src/composables/useUsage.ts`
- [x] No breaking API contract changes (backend unchanged)
- [x] No circular dependencies introduced

### Configuration Audit

- [x] No new environment variables
- [x] No new config files or schema changes
- [x] Backward compatibility maintained

### Database & Migration

- [x] No DB changes (backend untouched)
- [x] No migrations

### Testing Strategy

- [x] Unit test files identified per changed module: extend `usage.test.js`, `billing.test.js`, `github.test.js`, `phases.test.js`, `templates.test.js`, `useUsage.test.ts`
- [x] Backend Jest integration tests: NONE (no backend change)
- [x] **Bash integration suite**: NONE (no backend API change)
- [x] Edge cases explicitly tested (empty breakdown, missing month billing, PR description fallback)
- [x] If frontend: unit tests for API clients + composable; no new UI so no component/E2E required
- [x] Contract tests: `api-contract.test.ts` — only if response shapes changed on the backend; NOT applicable (backend unchanged)
- [x] Response validation: `validator.ts` — not affected (no new backend response shapes)
- [x] **Test stubs created BEFORE production code** — `04_SPECIFICATION.md` lists test stubs as the first file operations
- [x] New test files EXTENDED for all changed code (regression tests that reproduce the wrong-field / wrong-shape bug)
- [x] **Coverage threshold (60%)**: run `npm test -- --run --coverage` (frontend)

### Implementation Readiness

- [x] I have a plan to implement within estimated effort (Small)
- [x] I know which files to modify (no new production files)
- [x] I know which existing patterns to follow
- [x] I know how to test (frontend unit tests)
- [x] I have identified the **branch** I will work on

## Post-Implementation Checklist

- [ ] Frontend unit tests pass (`npm test -- --run`)
- [ ] Linting passes (`npm run lint` in frontend)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] Frontend build passes (`npm run build`)
- [ ] **Coverage threshold enforced**: `npm test -- --run --coverage` (frontend) — 60% min lines, functions, branches, statements
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with `Date completed`, `PR`, `Branch`
- [ ] `04_SPECIFICATION.md` reflects the final implementation
- [ ] Code reviewed by another agent or human if available

## When to Ask the User

**IMPORTANT**: If you encounter any of the following, STOP and ask the user before proceeding:

1. **Ambiguous acceptance criteria** — none; all 5 findings have exact expected shapes from the backend
2. **Significant scope change** — none
3. **Conflicting requirements** — none
4. **Unknown unknowns** — if a fix requires a backend change (e.g., PR description mapping), stop and confirm
5. **Production impact** — no data migration, no API breaking change
6. **UI placement decision** — none
7. **Backend API conflict** — none (backend untouched)
8. **Model can't resolve** — ask for a larger model/human intervention

---

*This checklist prevents agents from skipping planning and jumping straight to coding. Always audit existing infrastructure before creating new code.*
