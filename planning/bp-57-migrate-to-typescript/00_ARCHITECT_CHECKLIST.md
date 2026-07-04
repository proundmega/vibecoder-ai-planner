# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Frontend

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have catalogued all `.js` files in `frontend/src/` that should become `.ts`
- [ ] I have checked `tsconfig.json` `include` patterns to ensure `.ts` files will be picked up
- [ ] I have identified the `@` path alias gap (vite has it, tsconfig doesn't)
- [ ] I have checked the generated types in `frontend/src/api/generated/` for completeness
- [ ] I have checked `client.d.ts` for completeness
- [ ] I have verified `vue-tsc` is configured correctly for `.vue` files with `<script setup lang="ts">`

### Testing Strategy

- [ ] Unit tests still pass after migration
- [ ] Typecheck passes with zero errors
- [ ] Build succeeds

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test -- --run` passes
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
