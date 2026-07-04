# 01_ARCHITECT_REQUIREMENT.md — Content-Security-Policy Header

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

Helmet must be configured with Content-Security-Policy (CSP) header to protect against XSS attacks.

---

## Scope

- Configure Helmet CSP with sensible defaults
- Allow inline scripts for Vue.js (required for SPA)
- Allow sources for CDN resources (if any)
- Report-only mode for gradual rollout

---

## Assumptions

- `helmet` package is already installed (confirmed by `backend/package.json`)
- The frontend is a Vue.js SPA (confirmed by `frontend/src/router/index.ts` and `.vue` files)
- Vue.js requires inline scripts for template compilation (Vue 2) or is compatible with nonce-based inline scripts (Vue 3)
- No external CDN resources are currently loaded (all assets are local or from npm)
- The `frontend/src/api/client.js` uses axios with relative URLs (proxy handles CORS)
- CSP does NOT need to allow `unsafe-eval` (Vue 3 does not require it)
- The backend serves only API routes; the frontend SPA is served by nginx in production

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **Should we use report-only mode first?**
   - Yes — `Content-Security-Policy-Report-Only` header logs violations without blocking
   - No — set CSP immediately, fix violations as they arise

2. **What CSP directives are needed?**
   - `default-src 'self'` — allow resources from same origin
   - `script-src 'self' 'unsafe-inline'` — Vue.js requires inline scripts
   - `style-src 'self' 'unsafe-inline'` — Vue.js inline styles
   - `img-src 'self' data: blob:` — allow data URIs and blobs
   - `connect-src 'self'` — allow API calls to same origin
   - `frame-ancestors 'none'` — prevent clickjacking

3. **Should we use a CSP nonce?**
   - Yes — per-request nonce for inline scripts (more secure)
   - No — `'unsafe-inline'` is simpler but less secure

---

## Acceptance Criteria

- [ ] Helmet CSP header is present on all API responses
- [ ] CSP includes `default-src 'self'` as the base directive
- [ ] CSP allows inline scripts (`'unsafe-inline'` or nonce-based) for Vue.js compatibility
- [ ] CSP blocks known XSS patterns (e.g., `<script>alert(1)</script>` in query params)
- [ ] CSP does NOT include `unsafe-eval`
- [ ] CSP does NOT include `*` in any directive
- [ ] CSP is configured via environment (report-only in development, strict in production)
- [ ] CSP does NOT break the frontend SPA when served through the proxy
- [ ] Unit tests verify CSP header is set on responses
- [ ] Linting passes with no errors

---

## Out of Scope

- CSP header on nginx-served frontend assets (handled in nginx config, not Express)
- CSP violation reporting endpoint (if report-only mode is chosen)
- CSP nonce generation and injection middleware (if nonce-based approach is chosen)
- CSP for email templates (not currently generated)
- CSP for PDF generation (not currently supported)
- CSP audit tooling or automated scanning

---

## Testing Checklist

- [ ] CSP header present on all responses
- [ ] Vue.js app loads correctly with CSP
- [ ] No console errors about CSP violations
- [ ] CSP blocks known XSS patterns

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ `default-src *` (allows everything — defeats CSP)
- ❌ `unsafe-eval` (allows eval() — XSS vector)
- ❌ CSP without testing (breaks the app)

---

*Ready for design phase.*
