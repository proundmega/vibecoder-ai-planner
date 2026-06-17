# 03_ARCHITECT_IMPLEMENTATION.md — Content-Security-Policy Header

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-05-csp-header

**Dependencies**: None

---

### a) Purpose

Configure Helmet CSP header to protect against XSS attacks. Vue.js requires `'unsafe-inline'` for template compilation.

**Value delivered**: Protects users from XSS attacks. CSP blocks malicious scripts injected into pages.

---

### b) Actions

1. **Update helmet config** — `backend/src/index.js`
   - Add CSP directives: `defaultSrc`, `scriptSrc`, `styleSrc`, `imgSrc`, `connectSrc`, `frameAncestors`
   - Use `'unsafe-inline'` for Vue.js compatibility

2. **Create CSP report endpoint** — `backend/src/api/csp-report.js`
   - `POST /api/csp-report` — receives CSP violation reports

3. **Update routes** — `backend/src/api/routes.js`
   - Mount CSP report router

4. **Create tests**
   - `backend/src/__tests__/cspHeader.test.js` — CSP header tests

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Vue.js inline scripts]**: Requires `'unsafe-inline'` — less secure. Consider migrating to `<script type="text/html">` with manual compilation.
- **[Third-party scripts]**: Analytics/chat widgets need domain additions to `scriptSrc`.
- **[Report-only mode]**: Use for testing before enabling strict CSP.

---

### e) Testing

#### Unit Tests
- [ ] CSP header present on all responses
- [ ] CSP directives match expected values
- [ ] CSP report endpoint accepts reports

#### Integration Tests
- [ ] Vue.js app loads correctly with CSP
- [ ] No CSP violation errors in browser console

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/index.js` — CHANGED
- `backend/src/api/csp-report.js` — NEW
- `backend/src/api/routes.js` — CHANGED
- `backend/src/__tests__/cspHeader.test.js` — NEW

---

### h) Code Review Checklist

- [ ] CSP directives are restrictive but allow Vue.js to function
- [ ] `'unsafe-inline'` is only used where absolutely necessary (Vue.js)
- [ ] `frameAncestors 'none'` is set to prevent clickjacking
- [ ] CSP report endpoint does not log sensitive request body data
- [ ] No third-party domains added to CSP without review
- [ ] CSP header present on error responses (not just 200)

---

### i) Post-Deploy Verification

- [ ] Check /metrics endpoint shows pool stats
- [ ] Monitor error rate for 15 minutes
- [ ] Verify no CSP violation errors in browser console
- [ ] Test a login attempt to confirm rate limiting works

---

### j) Migration Notes

None — pure code change. Test in staging before production.

---

### k) Notes

- CSP: `default-src 'self'`, `scriptSrc 'self' 'unsafe-inline'`, `styleSrc 'self' 'unsafe-inline'`
- `frameAncestors 'none'` prevents clickjacking
- `'unsafe-inline'` required for Vue.js template compilation
- Report-only mode available for gradual rollout

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, helmet config, CSP directives*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
