# 01_ARCHITECT_REQUIREMENT.md — Cost Tracking & Billing

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Requirement

Track AI usage per project and per user. Project admins see a billing dashboard with token counts, costs, and total spend. Simple per-project billing for now — no complex plans, just visibility.

---

## Scope

- Per-project usage dashboard (tokens, costs, model breakdown)
- Per-user usage tracking
- Per-model pricing (configurable)
- Monthly cost summary for project admins

---

## Testing Checklist (MANDATORY)

- [ ] **Happy path**: Agent call → usage logged → dashboard shows correct totals
- [ ] **Cost calculation**: Correct USD cost for known models
- [ ] **Aggregation**: Project usage aggregates correctly by provider/model
- [ ] **Error handling**: Logging failure doesn't block agent call
- [ ] **Edge cases**: Unknown model uses default pricing, missing usage data

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Merging code without tests
- ❌ Testing implementation details
