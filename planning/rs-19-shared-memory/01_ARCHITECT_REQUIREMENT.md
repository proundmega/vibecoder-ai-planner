# 01_ARCHITECT_REQUIREMENT.md — Shared Agent Memory

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Requirement

Agents working on the same project share context so they don't duplicate work. "Agent A made these changes to `src/auth/`" — Agent B sees that before starting work. Prevents context collisions and redundant effort.

---

## Questions for Input

Before I finalize the design, I need answers to:

1. **Scope**: Per-project or per-repo?
   - If a project has multiple repos, do agents in Repo A know about Repo B's work?

2. **What gets cached?**
   - File diffs (what files were changed)?
   - Agent decisions (what architecture choices were made)?
   - Conversation history (full chat logs)?
   - All of the above?

3. **Storage technology:**
   - Vector DB (pgvector) — semantic search, good for "find related work"
   - Simple file-based (JSON/SQLite) — fast, local, no extra deps
   - Database tables — relational, queryable, familiar

4. **When is it updated?**
   - After each agent action (commit, message, status change)?
   - Periodically (every 5 minutes)?
   - On-demand (when another agent queries)?

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

*Waiting for design input on shared memory scope and storage before finalizing.*
