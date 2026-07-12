# 03_ARCHITECT_IMPLEMENTATION.md — Agent Edit Name Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Backend — Add Update Endpoint

#### `backend/src/api/agents.js` (MODIFY)

**Add update route** (after the create route, before the list route):
```javascript
const updateAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'name is required',
    'string.min': 'name must be at least 1 character',
    'string.max': 'name must not exceed 100 characters',
    'any.required': 'name is required',
  }),
});

/**
 * @openapi
 * /agents/{agentId}:
 *   put:
 *     tags: [Agents]
 *     summary: Update agent name
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Agent updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Agent not found
 */
router.put('/:agentId', verifyTokenOrAgent, requireAnyPermission('AGENT_CREATE'), validate(updateAgentSchema), async (req, res) => {
  try {
    const { agentId } = req.params;
    const { name } = req.body;
    
    const agent = await AgentService.updateName(agentId, name, req.user.userId);
    res.json({ success: true, data: agent });
  } catch (error) {
    if (error.message === 'Agent not found') {
      return res.status(404).json({ success: false, error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } });
    }
    logger.error('PUT /api/agents/:agentId', error);
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});
```

#### `backend/src/services/AgentService.js` (MODIFY)

**Add updateName method**:
```javascript
async updateName(agentId, name, userId) {
  const result = await pool.query(
    `UPDATE agents SET name = $1 WHERE id = $2 AND owner_id = $3 RETURNING *`,
    [name, agentId, userId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Agent not found');
  }
  
  return result.rows[0];
}
```

### Phase 2: Frontend — Add Edit UI

#### `frontend/src/api/agents.js` (MODIFY)

**Add updateAgentName function**:
```typescript
export async function updateAgentName(agentId: string, name: string) {
  const response = await put(`/agents/${agentId}`, { name });
  return response.data;
}
```

#### `frontend/src/views/AgentList.vue` (MODIFY)

**Add edit state**:
```typescript
const editingAgentId = ref<string | null>(null)
const editName = ref('')
const editInput = ref<HTMLInputElement | null>(null)
```

**Add edit functions**:
```typescript
function startEdit(agent: Agent) {
  editingAgentId.value = agent.id
  editName.value = agent.name
  nextTick(() => editInput.value?.focus())
}

async function saveEdit(agent: Agent) {
  if (!editName.value.trim() || editName.value.length > 100) return
  try {
    await updateAgentName(agent.id, editName.value)
    agent.name = editName.value
    editingAgentId.value = null
  } catch (error) {
    // Show error message
  }
}

function cancelEdit() {
  editingAgentId.value = null
  editName.value = ''
}
```

**Add edit template** (in agent list table row):
```vue
<template>
  <td>
    <span v-if="editingAgentId !== agent.id" class="agent-name" @click="startEdit(agent)">
      {{ agent.name }}
      <EditIcon class="edit-icon" />
    </span>
    <span v-else class="edit-mode">
      <input 
        ref="editInput"
        v-model="editName"
        maxlength="100"
        @keydown.enter="saveEdit(agent)"
        @keydown.escape="cancelEdit"
      />
      <button class="save-btn" @click="saveEdit(agent)">✓</button>
      <button class="cancel-btn" @click="cancelEdit">✗</button>
    </span>
  </td>
</template>
```

**Add CSS**:
```css
.agent-name {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.edit-icon {
  opacity: 0.5;
  font-size: 0.75rem;
}

.agent-name:hover .edit-icon {
  opacity: 1;
}

.edit-mode {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.edit-mode input {
  width: 150px;
  padding: 0.25rem 0.5rem;
  border: 1px solid #3b82f6;
  border-radius: 0.25rem;
}

.save-btn, .cancel-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0.25rem;
}

.save-btn { color: #10b981; }
.cancel-btn { color: #ef4444; }
```

### Phase 3: Tests

#### CREATE: `backend/src/__tests__/agentEdit.test.js`
```javascript
const request = require('supertest');
const app = require('src/index');

describe('PUT /api/agents/:agentId', () => {
  it('updates agent name', async () => {
    // TODO: create agent, PUT new name, verify update
  });

  it('returns 404 for non-existent agent', async () => {
    // TODO: PUT for invalid agent ID
  });

  it('returns 400 for invalid name (empty)', async () => {
    // TODO: PUT with empty name
  });

  it('returns 400 for invalid name (>100 chars)', async () => {
    // TODO: PUT with 101-char name
  });

  it('only allows owner to update agent', async () => {
    // TODO: create agent as user A, try to update as user B
  });
});
```

#### CREATE: `frontend/src/__tests__/agentEdit.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import AgentList from '@/views/AgentList.vue';
import * as agentsApi from '@/api/agents';

describe('AgentList.vue - Edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows edit icon when not editing', async () => {
    // TODO: mount component, assert edit icon visible
  });

  it('enters edit mode when edit icon clicked', async () => {
    // TODO: click edit icon, assert input visible
  });

  it('saves name on enter key', async () => {
    // TODO: enter edit mode, press enter, assert API called
  });

  it('cancels edit on escape key', async () => {
    // TODO: enter edit mode, press escape, assert edit mode exited
  });

  it('calls updateAgentName API on save', async () => {
    // TODO: enter edit mode, type new name, click save, assert API called
  });
});
```

### Phase 4: OpenAPI Spec

1. Add JSDoc annotations to PUT route (already done in Phase 1)
2. Run `cd backend && npm run generate:spec`
3. Run `cd frontend && npm run generate:api`
4. Run `cd frontend && npm run typecheck`

---

## Files Changed

```
backend/src/api/agents.js                                   → MODIFY (add PUT route)
backend/src/services/AgentService.js                        → MODIFY (add updateName)
frontend/src/api/agents.js                                  → MODIFY (add updateAgentName)
frontend/src/views/AgentList.vue                            → MODIFY (add edit UI)
backend/src/__tests__/agentEdit.test.js                     → CREATE
frontend/src/__tests__/agentEdit.test.ts                    → CREATE
```

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

Common goldmine categories:
- **Security**: account lockout, API key rotation/expiry, IP whitelisting
- **Observability**: Prometheus metrics, log aggregation, distributed tracing
- **Infrastructure**: S3 migration, PgBouncer, CDN caching, cache warming
- **Developer experience**: migration dry-run, env var documentation generator
- **UX**: rate limit countdown UI, usage alerts, real-time billing dashboard
- **Testing**: Cypress component tests, integration test coverage gaps

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers any new/changed fields
- [ ] Bash integration suite test added or extended for API changes
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] Frontend: `npm run lint` passes
5. [ ] Frontend: `npm run typecheck` passes
6. [ ] Frontend: `npm run build` passes
7. [ ] Frontend: `npm test -- --run --coverage` passes (60% min threshold)
8. [ ] PUT /api/agents/:agentId updates agent name
9. [ ] Frontend edit mode works correctly
10. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
