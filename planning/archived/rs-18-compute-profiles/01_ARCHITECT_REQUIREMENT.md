# 01_ARCHITECT_REQUIREMENT.md — Compute Profile Support

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Requirement

Users can register their own machines (local, EC2, etc.) as compute nodes. Vibecode dispatches agents to available compute. Vibecode handles coordination, users handle hardware.

---

## Scope

- Compute node registration (SSH, Docker, or URL-based)
- Node availability tracking (online/offline/capacity)
- Agent dispatch to available nodes
- Node health monitoring

---

## Questions for Input

Before I finalize the design, I need answers to:

1. **What's a "compute node"?** 
   - SSH access to a machine?
   - Docker container endpoint?
   - Just a URL where an agent server runs?
   - Something else?

2. **How do nodes register?**
   - Self-registration (user runs a command on their machine)?
   - Vibecode provisions them (we create the VM)?
   - Manual admin registration?

3. **Auto-scaling?**
   - Manual management (user adds/removes nodes)?
   - Auto-scale based on load?
   - Hybrid (manual min, auto max)?

---

## Testing Checklist (TBD — pending design input)

- [ ] TBD

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Merging code without tests
- ❌ Testing implementation details

---

*Waiting for design input on compute node model before finalizing.*
