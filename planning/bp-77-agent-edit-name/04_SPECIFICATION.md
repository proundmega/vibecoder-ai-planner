# 04_SPECIFICATION.md — Agent Edit Name Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-12

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code. Do not defer test creation to a later step.

---

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create, modify, or delete any file not listed here.

### MODIFY: `backend/src/api/agents.js`

**Add import** (after Joi import):
```javascript
const updateAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'name is required',
    'string.min': 'name must be at least 1 character',
    'string.max': 'name must not exceed 100 characters',
    'any.required': 'name is required',
  }),
});
```

**Add route** (after the create route, before the list route):
```javascript
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

### MODIFY: `backend/src/services/AgentService.js`

**Add method** (after the delete method):
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

### MODIFY: `frontend/src/api/agents.js`

**Add function** (after existing agent functions):
```typescript
export async function updateAgentName(agentId: string, name: string) {
  const response = await put(`/agents/${agentId}`, { name });
  return response.data;
}
```

**Imports to add** (verify `put` is imported from `./client`):
```typescript
import { put } from './client';
```

### MODIFY: `frontend/src/views/AgentList.vue`

**Add state variables** (in `<script setup>`):
```typescript
const editingAgentId = ref<string | null>(null)
const editName = ref('')
const editInput = ref<HTMLInputElement | null>(null)
```

**Add functions**:
```typescript
function startEdit(agent: { id: string; name: string }) {
  editingAgentId.value = agent.id
  editName.value = agent.name
  nextTick(() => editInput.value?.focus())
}

async function saveEdit(agent: { id: string; name: string }) {
  if (!editName.value.trim() || editName.value.length > 100) return
  try {
    await updateAgentName(agent.id, editName.value)
    agent.name = editName.value
    editingAgentId.value = null
  } catch (error) {
    // Error handling: show toast or inline error
  }
}

function cancelEdit() {
  editingAgentId.value = null
  editName.value = ''
}
```

**Add template** (in agent list table row, replace name cell):
```vue
<template>
  <td>
    <span v-if="editingAgentId !== agent.id" class="agent-name" @click="startEdit(agent)">
      {{ agent.name }}
      <svg class="edit-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </span>
    <span v-else class="edit-mode">
      <input 
        ref="editInput"
        v-model="editName"
        maxlength="100"
        @keydown.enter="saveEdit(agent)"
        @keydown.escape="cancelEdit"
      />
      <button class="save-btn" @click.stop="saveEdit(agent)">✓</button>
      <button class="cancel-btn" @click.stop="cancelEdit">✗</button>
    </span>
  </td>
</template>
```

**Add CSS** (in scoped `<style>`):
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

### CREATE: `backend/src/__tests__/agentEdit.test.js`

**Imports**:
```javascript
const request = require('supertest');
const app = require('src/index');
```

**Test stubs**:
```javascript
describe('PUT /api/agents/:agentId', () => {
  it('updates agent name', async () => {
    // TODO: implement
  });

  it('returns 404 for non-existent agent', async () => {
    // TODO: implement
  });

  it('returns 400 for invalid name (empty)', async () => {
    // TODO: implement
  });

  it('returns 400 for invalid name (>100 chars)', async () => {
    // TODO: implement
  });

  it('only allows owner to update agent', async () => {
    // TODO: implement
  });
});
```

### CREATE: `frontend/src/__tests__/agentEdit.test.ts`

**Imports**:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import AgentList from '@/views/AgentList.vue';
import * as agentsApi from '@/api/agents';
```

**Test stubs**:
```typescript
describe('AgentList.vue - Edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows edit icon when not editing', async () => {
    // TODO: implement
  });

  it('enters edit mode when edit icon clicked', async () => {
    // TODO: implement
  });

  it('saves name on enter key', async () => {
    // TODO: implement
  });

  it('cancels edit on escape key', async () => {
    // TODO: implement
  });

  it('calls updateAgentName API on save', async () => {
    // TODO: implement
  });
});
```

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — Agent Edit
```
✓ [happy] PUT /api/agents/:id with valid name returns 200 with updated agent
✓ [error] PUT /api/agents/:id with empty name returns 400
✓ [error] PUT /api/agents/:id with name >100 chars returns 400
✓ [error] PUT /api/agents/:id for non-existent agent returns 404
✓ [edge] PUT /api/agents/:id by non-owner returns 404 (agent not found)
```

### Frontend Unit Tests — Agent Edit
```
✓ [ui] AgentList shows edit icon (pencil) next to agent name
✓ [ui] Clicking edit icon enters edit mode (input field appears)
✓ [ui] Input field is focused when entering edit mode
✓ [ui] Pressing Enter saves the new name
✓ [ui] Pressing Escape cancels edit
✓ [ui] Clicking ✓ button saves the new name
✓ [ui] Clicking ✗ button cancels edit
✓ [api] updateAgentName() calls PUT /api/agents/:id with correct body
```

---

## Edge Cases to Handle

1. **[Empty name]**: User submits empty name — Handle: Client-side validation (min 1 char)
2. **[Name >100 chars]**: User types >100 chars — Handle: Client-side validation (max 100 chars) + server-side validation
3. **[Name with spaces]**: "My Agent" — Handle: Allow spaces, trim leading/trailing
4. **[Duplicate names]**: Two agents named "Test Agent" — Handle: Allow duplicates (no uniqueness constraint)
5. **[Concurrent edits]**: Two tabs editing same agent — Handle: Last write wins (simple UPDATE)

---

## Existing Code Patterns to Follow

- Use `pool.query()` with parameterized queries (no SQL injection)
- Error format: `{ success: false, error: { code, message } }`
- Frontend: `<script setup>` syntax, not Options API
- Frontend: Import from `@/stores/` not relative paths
- Frontend: Error messages in English, no i18n wrappers
- Backend: JSDoc annotations for OpenAPI spec generation
- Tests: Use `jest.mock()` for database dependencies in unit tests

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `backend/src/middleware/` — no middleware changes
- `frontend/src/router/` — no route changes
- `backend/src/models/` — no model changes
- `docker-compose.yml` — no infrastructure changes

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
