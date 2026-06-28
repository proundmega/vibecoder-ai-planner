# 03_ARCHITECT_IMPLEMENTATION.md — bp-31 TemplateService Redesign

**Status**: planned
**Date created**: 2026-06-28
**Effort**: Medium

## Purpose

Redesign TemplateService.js with structured template content per DREAM.md specifications, add 04_SPECIFICATION.md to Architect template, and create a standalone Specification template.

## Implementation Order

1. **Step 1**: Add 04_SPECIFICATION.md to ARCHITECT_TEMPLATE_FILES
   - Append `{ key: '04_SPECIFICATION.md', title: 'Specification', required: true }` to the array
   - *Depends on*: nothing

2. **Step 2**: Rewrite 4 architect template content methods
   - Replace content for '00_ARCHITECT_CHECKLIST.md' with redesigned structure from DREAM.md
   - Replace content for '01_ARCHITECT_REQUIREMENT.md' with redesigned structure from DREAM.md
   - Replace content for '02_ARCHITECT_DESIGN.md' with redesigned structure from DREAM.md
   - Replace content for '03_ARCHITECT_IMPLEMENTATION.md' with redesigned structure from DREAM.md
   - *Depends on*: Step 1

3. **Step 3**: Add getSpecificationContent() method
   - Add '04_SPECIFICATION.md' case to the templates object in getArchitectTemplateContent()
   - *Depends on*: Step 2

4. **Step 4**: Add SPECIFICATION_FILES constant and getter methods
   - Create `const SPECIFICATION_FILES = [{ key: '04_SPECIFICATION.md', title: 'Specification', required: true }]`
   - Add `static getSpecificationTemplate()` method
   - Add `static getSpecificationTemplateContent(fileKey)` method with same 04_SPECIFICATION.md content
   - *Depends on*: Step 3

5. **Step 5**: Update tests
   - Change `expect(files).toHaveLength(4)` to `expect(files).toHaveLength(5)` for architect template
   - Add test for 04_SPECIFICATION.md content
   - Add tests for specification template getter and content
   - *Depends on*: Step 4

## Per-File Action Plan

### `backend/src/services/TemplateService.js` (MODIFY)

**ARCHITECT_TEMPLATE_FILES array**:
- Add 5th entry: `{ key: '04_SPECIFICATION.md', title: 'Specification', required: true }`

**getArchitectTemplateContent() method**:
- Rewrite '00_ARCHITECT_CHECKLIST.md' content with: Planning, Existing Infrastructure Audit, Dependency Analysis, Configuration Audit, Testing Strategy, Rollback Readiness, When to Ask the User sections
- Rewrite '01_ARCHITECT_REQUIREMENT.md' content with: Problem Statement, Scope, Acceptance Criteria, Known Unknowns, Decisions Required, Impact Analysis, Dependencies, Performance Considerations sections
- Rewrite '02_ARCHITECT_DESIGN.md' content with: Current State, Proposed Solution, Data Flow, File-Level Impact, Error Handling Strategy, Alternatives Considered, Security Considerations, Database Changes, API Contract sections
- Rewrite '03_ARCHITECT_IMPLEMENTATION.md' content with: Purpose, Implementation Order, Per-File Action Plan, Migration Plan, Test Plan, Rollback Steps sections
- Add '04_SPECIFICATION.md' content with: File Operations (CREATE/MODIFY entries), Test Expectations, Edge Cases to Handle, Existing Code Patterns to Follow sections

**New SPECIFICATION_FILES constant**:
```javascript
const SPECIFICATION_FILES = [
  { key: '04_SPECIFICATION.md', title: 'Specification', required: true },
];
```

**New getSpecificationTemplate() method**:
```javascript
static getSpecificationTemplate() {
  return SPECIFICATION_FILES;
}
```

**New getSpecificationTemplateContent(fileKey) method**:
```javascript
static getSpecificationTemplateContent(fileKey) {
  const templates = {
    '04_SPECIFICATION.md': `# 04_SPECIFICATION.md — Model Execution Spec\n\n**Generated from**: Architect + Technical templates\n**Target model**: 7B–34B local model (e.g., CodeLlama, Qwen, DeepSeek-Coder)\n**Date**: YYYY-MM-DD\n\n## File Operations\n\nEach entry specifies exactly what the model should produce. The model MUST NOT create,\nmodify, or delete any file not listed here.\n\n### CREATE: \`frontend/src/components/Login.vue\`\n\n**Imports** (exact):\n\`\`\`\nimport { ref } from 'vue'\nimport { useRouter } from 'vue-router'\nimport { useAuthStore } from '@/stores/auth'\n\`\`\`\n\n**State variables** (exact names and types):\n\`\`\`\nemail: ref('')                  → bound to email input via v-model\npassword: ref('')               → bound to password input via v-model\nerror: ref<string | null>(null) → displayed when login fails\nloading: ref(false)             → disables submit button while true\n\`\`\`\n\n**Functions** (exact signatures):\n\`\`\`\nasync function handleSubmit(): Promise<void>\n  1. if (!email.value || !password.value) return (form validation)\n  2. loading.value = true\n  3. error.value = null\n  4. try:\n        await authStore.login(email.value, password.value)\n        router.push('/dashboard')\n      catch (err):\n        error.value = err.message || 'Login failed'\n      finally:\n        loading.value = false\n\`\`\`\n\n**Template structure** (exact hierarchy):\n\`\`\`\n<form @submit.prevent="handleSubmit">\n  <div>\n    <label for="email">Email</label>\n    <input id="email" v-model="email" type="email" required />\n  </div>\n  <div>\n    <label for="password">Password</label>\n    <input id="password" v-model="password" type="password" required />\n  </div>\n  <button type="submit" :disabled="loading">\n    {{ loading ? 'Signing in...' : 'Sign In' }}\n  </button>\n  <p v-if="error" class="error">{{ error }}</p>\n</form>\n\`\`\`\n\n**Styling**: Use scoped CSS, no external classes. Form centered, inputs full-width, error text red.\n\n### MODIFY: \`frontend/src/stores/auth.js\`\n\n**Add method**: \`async login(email: string, password: string): Promise<void>\`\n\`\`\`\nLogic:\n  const response = await fetch('/api/auth/login', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ email, password })\n  })\n  if (!response.ok) throw new Error((await response.json()).error)\n  const data = await response.json()\n  this.setToken(data.token)\n  this.setUser(data.user)\n  this.setPermissions(data.permissions || [])\n\`\`\`\n\n**Position in file**: Add after \`logout()\` method, before \`isAuthenticated()\`.\n\n### MODIFY: \`frontend/src/api/client.js\`\n\n**No changes needed** for this ticket.\n\n## Test Expectations\n\n### Login.vue\n\`\`\`\n✓ Renders email input, password input, submit button\n✓ Shows error message when login fails (mock API returns 401)\n✓ Calls authStore.login with correct email and password on submit\n✓ Redirects to /dashboard on successful login\n✓ Disables submit button while loading\n✓ Does not submit if email or password is empty\n\`\`\`\n\n### auth store login()\n\`\`\`\n✓ Stores token in localStorage under 'vibecode_token'\n✓ Stores user in localStorage under 'vibecode_user'\n✓ Throws readable error on non-ok response\n✓ Stores permissions if returned\n\`\`\`\n\n## Edge Cases to Handle\n1. **Network error**: fetch throws → catch block shows "Unable to connect. Please try again."\n2. **Already logged in**: component checks \`authStore.isAuthenticated()\` on mount → redirect to /dashboard\n3. **Token expiry after login**: Not handled in this ticket (separate concern)\n4. **Double submit**: loading flag prevents multiple simultaneous submissions\n5. **Browser autofill**: No special handling needed — browser handles it natively\n\n## Existing Code Patterns to Follow\n- Use \`<script setup>\` syntax (Composition API), not Options API\n- Import from \`@/stores/auth\` not relative paths\n- Error messages in English, stored as strings not translated (i18n not set up yet)\n- No TypeScript in .vue files (project uses .ts for stores/API, .vue files are plain JS)\n\`\`\`\n  };
  return templates[fileKey] || '';
}
```

### `backend/src/__tests__/ticketPlanning.test.js` (MODIFY)

**Changes**:
- Update `getArchitectTemplate` test: `expect(files).toHaveLength(4)` → `expect(files).toHaveLength(5)`
- Add `expect(files[4].key).toBe('04_SPECIFICATION.md')`
- Add test for `getArchitectTemplateContent('04_SPECIFICATION.md')`
- Add `describe('getSpecificationTemplate')` with test
- Add `describe('getSpecificationTemplateContent')` with test

## Migration Plan

1. No database migration required
2. Deploy code change
3. Verify template content via API response
4. Rollback: revert code change (no migration to rollback)

## Test Plan

### Unit Tests

| File | Test | What It Covers |
|------|------|----------------|
| `ticketPlanning.test.js` | architect template returns 5 files | File count and keys |
| `ticketPlanning.test.js` | 00_ARCHITECT_CHECKLIST.md content | Checklist structure |
| `ticketPlanning.test.js` | 01_ARCHITECT_REQUIREMENT.md content | Requirement structure |
| `ticketPlanning.test.js` | 02_ARCHITECT_DESIGN.md content | Design structure |
| `ticketPlanning.test.js` | 03_ARCHITECT_IMPLEMENTATION.md content | Implementation structure |
| `ticketPlanning.test.js` | 04_SPECIFICATION.md content | Specification structure |
| `ticketPlanning.test.js` | specification template returns 1 file | Specification template getter |
| `ticketPlanning.test.js` | specification content matches architect 04 | Content consistency |
| `ticketPlanning.test.js` | technical template unchanged | Backward compatibility |
| `ticketPlanning.test.js` | simple template unchanged | Backward compatibility |

### Integration Tests

- Apply Architect template to a ticket via API
- Verify all 5 files are created with correct structure
- Apply Specification template to a ticket
- Verify 1 file is created with correct structure

## Rollback Steps

1. `git revert <commit>`
2. No database rollback needed
3. Verify frontend shows no errors
