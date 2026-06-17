# 01_ARCHITECT_REQUIREMENT.md — API Versioning

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

API must use versioned URLs (`/api/v1/*`) to enable breaking changes without requiring frontend rewrites.

---

## Scope

- Move all routes under `/api/v1/*`
- Add version negotiation middleware
- Deprecation headers on old endpoints
- Support multiple API versions running simultaneously

---

## Assumptions

- All current routes are mounted in `src/api/routes.js` under `/api` prefix
- The frontend (`frontend/src/api/client.js`) uses a base URL that can be configured for the API version
- No external API consumers other than the frontend and Java agents currently exist
- The OpenAPI spec (`src/api/openapi-spec.js`) generates paths that should reflect the versioned URLs
- The Java agent application uses the `/api/` base path and would need updating if routes change
- The frontend router proxies `/api` to the backend — this proxy config would need updating

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **How do we handle version transitions?**
   - Keep v1 and v2 running simultaneously during transition?
   - Or sunset v1 immediately when v2 ships?

2. **What versioning strategy?**
   - URL path: `/api/v1/users` (simple, what we're doing)
   - Header: `Accept: application/vnd.vibecode.v2+json` (RESTful, but harder to debug)
   - Query param: `/api/users?version=2` (easy to test, not RESTful)

3. **Should we support multiple versions at once?**
   - Yes — allows gradual migration
   - No — simpler codebase, forces frontend update

---

## Acceptance Criteria

- [ ] All routes are accessible under `/api/v1/*` prefix
- [ ] Requests to `/api/*` without version return 404 with a message suggesting `/api/v1/*`
- [ ] Frontend API client is updated to use `/api/v1/` base path
- [ ] OpenAPI spec reflects versioned paths
- [ ] Deprecation header (`Sunset` or custom `X-API-Deprecation`) is included on responses
- [ ] Java agent can be configured to use `/api/v1/` base path
- [ ] Docker nginx proxy config updated for versioned routes
- [ ] Unit tests verify versioned route mounting
- [ ] Linting passes with no errors

---

## Out of Scope

- API v2 implementation (only v1 is in scope — versioning infrastructure)
- Automatic API version negotiation based on client headers
- API version deprecation timeline management
- Migration helpers or data transformation between versions
- API version documentation site or changelog
- Backward compatibility testing across multiple versions

---

## Testing Checklist

- [ ] All routes accessible under `/api/v1/*`
- [ ] `/api/*` without version returns 404 with suggestion to use `/api/v1/*`
- [ ] Frontend works with v1 routes
- [ ] Deprecation headers on responses

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors
- `npm run generate:spec` — OpenAPI spec must be valid

---

## Anti-Patterns to Avoid

- ❌ Duplicating all route handlers for each version
- ❌ Changing field names between versions without deprecation period
- ❌ Removing old versions without migration path

---

*Ready for design phase.*
