# 02_ARCHITECT_DESIGN.md — Content-Security-Policy Header

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

Helmet is installed but CSP header is not configured. Vue.js SPA needs inline scripts for template compilation, which conflicts with strict CSP.

---

## Current State

```javascript
// backend/src/index.js
app.use(helmet()); // Default helmet config — no CSP
```

No CSP header. No protection against XSS.

---

## Design

### Helmet CSP Configuration

```javascript
// backend/src/index.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // Vue.js requires inline scripts
      styleSrc: ["'self'", "'unsafe-inline'"],   // Vue.js inline styles
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],  // Prevent clickjacking
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
}));
```

### Report-Only Mode (Optional)

```javascript
// For gradual rollout — use CSP-Report-Only header
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // ... same directives
    },
    reportOnly: true,  // Logs violations but doesn't block
  },
}));
```

### CSP Report Endpoint

```javascript
// backend/src/api/csp-report.js
router.post('/csp-report', (req, res) => {
  const report = req.body;
  logger.warn('CSP Violation:', report);
  res.status(204).send();
});
```

### Alternative Designs Considered

- **CSP report-only mode first** — Chose strict CSP with `'unsafe-inline'` over report-only because: the Vue.js SPA is the only frontend and inline scripts are unavoidable without a build-step change. Report-only was considered but rejected because: it provides no protection during the testing phase — it only logs violations, leaving the app vulnerable.
- **Nonce-based CSP** — Chose `'unsafe-inline'` over nonce-based CSP because: Vue.js template compilation generates inline scripts dynamically, making nonces difficult to implement without build tool changes. Nonce-based CSP was considered but rejected because: it requires server-side nonce generation per request, nonce injection into `<script>` tags, and Vue.js SFC compilation support — all of which add complexity.
- **Helmet vs manual headers** — Chose helmet over manual `res.setHeader()` calls because: helmet handles all security headers consistently (X-Frame-Options, X-Content-Type-Options, etc.) and is actively maintained. Manual headers were considered but rejected because: they are error-prone, easy to forget, and don't provide the same level of security header coverage.

### Data Flow Diagram

```
Response → [helmet CSP middleware]
    ↓
  directives applied → Content-Security-Policy header set
    ↓
Client receives response
    ↓
Browser parses CSP header
    ↓
  [resource request: script/style/image]
    ↓
  [matches CSP directive?]
    ├─ Yes → allow
    └─ No  → block → console.warn CSP violation
    ↓
  [report-uri / report-to configured?]
    ↓
  POST /csp-report → logger.warn('CSP Violation')
```

### Config / Env Changes

- NEW: `backend/.env.example` — add `CSP_REPORT_ONLY=false` (boolean flag for gradual rollout)
- CHANGED: `backend/src/index.js` — replace `app.use(helmet())` with `app.use(helmet({ contentSecurityPolicy: { ... } }))`
- NEW: `backend/src/api/routes.js` — add `POST /csp-report` endpoint for violation reporting (optional)

---

## Dependencies

- **Helmet** — already installed
- **Vue.js** — requires `'unsafe-inline'` for script/style (template compilation)

---

## Risks/Edge Cases

- **[Vue.js inline scripts]**: SPA needs `'unsafe-inline'` for template compilation. Mitigation: consider using `<script type="text/html">` with manual compilation to avoid inline scripts.
- **[Third-party scripts]**: If using analytics or chat widgets, add their domains to `scriptSrc`.
- **[Report-only mode]**: Doesn't block violations — only logs. Use for testing, switch to strict mode in production.

---

*Ready for implementation phase.*
