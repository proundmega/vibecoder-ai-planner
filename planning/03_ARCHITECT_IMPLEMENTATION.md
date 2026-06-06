# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: [TICKET-ID] — [Title]

**Status**: planned | in_progress | completed | blocked
**Priority**: P0 | P1 | P2 | P3 | P4
**Effort**: Small | Medium | Large
**Author**: [Name]
**Date created**: YYYY-MM-DD
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]

**Dependencies**: [ticket IDs that must be completed first]

---

### a) Purpose

[Why does this ticket exist? What problem does it solve? What value does it deliver?]

---

### b) Actions

[Step-by-step implementation plan. Be specific about file paths, method signatures, and behavior.]

1. [Action 1]
2. [Action 2]
3. [Action 3]

**Example structure:**
```
path/to/
  file1.js    → description
  file2.js    → description
```

**Example code:**
```javascript
// Show relevant code snippets here
```

---

### c) Dependencies

[List dependencies: other tickets, libraries, services, external APIs]

- [Library/Service]: [what it provides]

---

### d) Risks/Edge Cases

[What could go wrong? What edge cases need handling? What are the trade-offs?]

- **[Risk name]**: [description and mitigation]
- **[Edge case]**: [description and handling]

---

### e) Testing

#### Unit Tests
- [ ] Test 1: [description]
- [ ] Test 2: [description]
- [ ] Test 3: [description]

#### Integration Tests
- [ ] Full request lifecycle: [description]
- [ ] Role-based access: [description]
- [ ] Data persistence: [description]

#### Frontend Tests (if applicable)
- [ ] Component test: [component name]
- [ ] E2E test: [scenario description]

---

### f) Migration Notes (if applicable)

[Database migrations, config changes, breaking changes that affect existing data]

```sql
-- Migration SQL here
```

---

### g) Notes

[Additional context, decisions made, alternatives considered]

---

*Fill in all sections before starting implementation. Update status as work progresses.*
