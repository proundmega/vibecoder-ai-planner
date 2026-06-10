# 01_ARCHITECT_REQUIREMENT.md — GitHub Repository Integration

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Requirement

Connect a GitHub repository to a Vibecode project so AI agents can work directly on it. When a ticket is defined (using ARCHITECT templates or any format), an agent picks it up, creates a feature branch, codes, and creates a PR. The PR link is added to the ticket notes. PRs are triggered manually (not auto) so the agent finishes coding first.

---

## Scope

- GitHub OAuth or PAT integration per project
- Auto-create feature branches per ticket (e.g., `vibecode/ticket-{id}-{slug}`)
- PR creation with agent-coded changes
- PR link stored in ticket notes
- Branch cleanup after merge/close

---

## Testing Checklist (MANDATORY)

- [ ] **Happy path**: Agent creates branch → commits → creates PR → PR link in ticket
- [ ] **Branch naming**: Consistent, unique branch names per ticket
- [ ] **Error handling**: GitHub API failures (rate limits, auth errors, network)
- [ ] **Edge cases**: Duplicate ticket IDs, long ticket titles, special characters in branch names
- [ ] **Authorization**: Only project_admin can connect a repo
- [ ] **Cleanup**: Branch removed after PR merge

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors
- Backend integration test: mock GitHub API, verify branch/PR lifecycle

---

## Anti-Patterns to Avoid

- ❌ Hardcoding GitHub API URLs — use configurable base URL
- ❌ Storing PATs in plaintext — encrypt in DB
- ❌ Blocking ticket while creating branch — async with retry
- ❌ Testing implementation details — test behavior (branch exists, PR created)
- ❌ Merging code without tests

---

## Code Change Requirements

1. Write unit tests before or alongside the implementation
2. Write integration tests covering the full request lifecycle
3. Run `npm test` — must pass
4. Pass `npm run lint` with zero errors
