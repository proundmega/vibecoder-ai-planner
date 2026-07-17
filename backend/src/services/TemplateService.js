const { pool } = require('../db');

const ARCHITECT_TEMPLATE_FILES = [
  { key: '00_ARCHITECT_CHECKLIST.md', title: 'Pre-Implementation Checklist', required: true },
  { key: '01_ARCHITECT_REQUIREMENT.md', title: 'Requirement', required: true },
  { key: '02_ARCHITECT_DESIGN.md', title: 'Design', required: true },
  { key: '03_ARCHITECT_IMPLEMENTATION.md', title: 'Implementation', required: true },
  { key: '04_SPECIFICATION.md', title: 'Specification', required: true },
];

const TECHNICAL_TEMPLATE_FILES = [
  { key: '01_TECHNICAL_REQUIREMENT.md', title: 'Technical Requirements', required: true },
  { key: '02_TECHNICAL_DESIGN.md', title: 'Technical Design', required: true },
  { key: '03_TECHNICAL_IMPLEMENTATION.md', title: 'Implementation Plan', required: true },
];

const SIMPLE_TEMPLATE_FILES = [
  { key: '01_SIMPLE_TASKS.md', title: 'Task List', required: true },
];

const SPECIFICATION_TEMPLATE_FILES = [
  { key: '04_SPECIFICATION.md', title: 'Specification', required: true },
];

class TemplateService {
  static getArchitectTemplate() {
    return ARCHITECT_TEMPLATE_FILES;
  }

  static getArchitectTemplateContent(fileKey) {
    const templates = {
      '00_ARCHITECT_CHECKLIST.md': `# 00_ARCHITECT_CHECKLIST.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Feature scope**: Frontend | Backend | Both

## Pre-Implementation Checklist

### Planning
- [ ] Acceptance criteria are specific and testable (not "it works")
- [ ] Out-of-scope items explicitly documented
- [ ] All design decisions have documented options (not just the chosen one)
- [ ] "Unknown unknowns" identified — things that could change the approach

### Existing Infrastructure Audit
- [ ] Backend API checked — does the route/controller/service already exist?
- [ ] Frontend API client checked — does the API call already exist in \`frontend/src/api/\`?
- [ ] Frontend UI checked — does the view/component already exist?
- [ ] Router checked — does the route already exist in \`router/index.ts\`?
- [ ] Database schema checked — do the tables/columns already exist?
- [ ] Migration checked — does a migration need to be added?
- [ ] Existing patterns identified — what style does surrounding code use?

### Dependency Analysis
- [ ] All new dependencies listed (npm packages, system deps, external APIs)
- [ ] All existing dependencies that will be affected listed
- [ ] Breaking changes identified (API contract changes, DB migration)

### Configuration Audit
- [ ] All new env vars documented with defaults and descriptions
- [ ] All new config files documented
- [ ] Feature flags considered (can this be toggled off?)

### Testing Strategy
- [ ] Unit test files identified per changed module
- [ ] Integration test scope defined
- [ ] Manual test scenarios enumerated

### Rollback Readiness
- [ ] Database migration is reversible (has _rollback.sql)
- [ ] API change is backward-compatible or versioned
- [ ] Deploy order is documented (migration first, then code)

## When to Ask the User
- Ambiguous acceptance criteria
- Scope change discovered during audit
- Conflicting requirements
- UI placement decisions
- Unclear error handling strategy
`,
      '01_ARCHITECT_REQUIREMENT.md': `# 01_ARCHITECT_REQUIREMENT.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Feature scope**: Frontend | Backend | Both

## Problem Statement
Describe the problem in one paragraph. What user need does this address?

## Scope
- **In scope**: List exactly what this ticket covers
- **Out of scope**: List what this ticket explicitly does NOT cover

## Acceptance Criteria
Each criterion must be testable (pass/fail, not subjective).

- [ ] Criterion 1 — specific behavior, not implementation detail
- [ ] Criterion 2 — edge case covered

## Known Unknowns
Things that could change the approach if they turn out differently:
- **Unknown 1**: What we don't know, and how to resolve it
- **Unknown 2**: What we don't know, and how to resolve it

## Decisions Required
Each decision has options so the implementer doesn't have to guess.

1. **Question**: How should we handle X?
   - Option A: Description, tradeoffs
   - Option B: Description, tradeoffs
   - Recommendation: Option A (reason)

## Impact Analysis
| Component | Change Type | Details |
|-----------|-------------|---------|
| \`backend/src/services/Foo.js\` | MODIFY | Add bar() method |
| \`database\` | NEW MIGRATION | Add \`baz\` column to \`tickets\` |
| \`frontend/src/views/Bar.vue\` | CREATE | New page for baz management |

## Dependencies
- **This ticket depends on**: TICKET-123 (must be done first)
- **Depends on this**: None

## Performance Considerations
- Expected QPS on new endpoint
- Data size expectations
- Caching strategy if any
`,
      '02_ARCHITECT_DESIGN.md': `# 02_ARCHITECT_DESIGN.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}

## Current State
What exists today. File paths, relevant code snippets, current behavior.

## Proposed Solution
### Approach
Describe the approach in 2-3 paragraphs. Include code patterns, not just prose.

### Data Flow
Describe the flow from trigger to completion:
\`\`\`
User clicks button → FE calls POST /api/v1/foo → service
validates → DB insert → FE updates store → UI re-renders
\`\`\`

### File-Level Impact
| File | Action | What Changes |
|------|--------|-------------|
| \`backend/src/routes/foo.js\` | MODIFY | Add POST /foo endpoint |
| \`backend/src/services/FooService.js\` | MODIFY | Add createFoo() method |
| \`frontend/src/api/foo.js\` | MODIFY | Add createFoo() API call |
| \`frontend/src/views/FooList.vue\` | MODIFY | Add create button + form |

### Error Handling Strategy
- What can go wrong at each layer
- What the user sees for each error type
- Retry vs. fail-fast decisions

### Alternatives Considered
- **Alternative A**: Chosen because ___. Rejected because ___.
- **Alternative B**: Considered but rejected because ___.

## Security Considerations
- Authentication required for new endpoints
- Authorization checks (which roles can do what)
- Input validation (what fields, what constraints)
- Rate limiting needs

## Database Changes
- New tables with column types and constraints
- New columns with defaults and nullability
- Indexes needed
- Migration strategy (data backfill if needed)

## API Contract
- New/Changed endpoints with request/response shapes
- Status codes per outcome
- Error response format
`,
      '03_ARCHITECT_IMPLEMENTATION.md': `# 03_ARCHITECT_IMPLEMENTATION.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Effort**: Small | Medium | Large

## Purpose
One-sentence summary of what this implementation achieves.

## Implementation Order
Steps must be executed in this order (dependencies listed):

1. **Step 1**: Short description — file path
   - Sub-step
   - Sub-step
   - *Depends on*: nothing

2. **Step 2**: Short description — file path
   - Sub-step
   - Sub-step
   - *Depends on*: Step 1

## Per-File Action Plan

### \`backend/src/services/FooService.js\` (MODIFY)
- Add \`createFoo(data)\` method
- Signature: \`async createFoo(data: CreateFooInput): Promise<Foo>\`
- Logic: validate → insert into DB → return created record
- Error cases: duplicate key → 409, validation fail → 400

### \`frontend/src/api/foo.js\` (MODIFY)
- Add \`createFoo(data)\` function
- Signature: \`export async function createFoo(data: CreateFooInput): Promise<Foo>\`
- HTTP: POST /api/v1/foo with JSON body

## Migration Plan
1. Run migration 018_add_foo_table.sql
2. Verify columns and constraints
3. Rollback: 018_add_foo_table_rollback.sql

## Test Plan

### Unit Tests
| File | Test | What It Covers |
|------|------|----------------|
| \`FooService.test.js\` | creates a foo successfully | Happy path |
| \`FooService.test.js\` | rejects duplicate name | Unique constraint |
| \`FooService.test.js\` | rejects missing required field | Validation |

### Integration Tests
- What to test against real DB
- What curl commands to run

## Rollback Steps
1. \`git revert <commit>\`
2. \`npm run db:rollback\` (migration 018)
3. Verify frontend shows no errors
`,
      '04_SPECIFICATION.md': `# 04_SPECIFICATION.md — Model Execution Spec

**Generated from**: Architect + Technical templates
**Target model**: 7B–34B local model (e.g., CodeLlama, Qwen, DeepSeek-Coder)
**Date**: YYYY-MM-DD

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create,
modify, or delete any file not listed here.

### CREATE: \`<file-path>\`

**Imports** (exact):
\`\`\`
// List every import statement with exact module paths
import { something } from 'module'
\`\`\`

**State variables** (exact names and types):
\`\`\`
variableName: type              → purpose and binding description
\`\`\`

**Functions** (exact signatures):
\`\`\`
async function functionName(params): ReturnType
  1. Step 1
  2. Step 2
  3. Step 3
\`\`\`

**Template structure** (exact hierarchy):
\`\`\`
<!-- Provide the exact component/template structure -->
\`\`\`

**Styling**: Describe styling requirements (scoped CSS, class names, etc.).

### MODIFY: \`<file-path>\`

**Add/modify**: \`<method or property name>\`
\`\`\`
// Describe the exact logic to add or modify
\`\`\`

**Position in file**: Describe where in the file the changes should go.

### DELETE: \`<file-path>\`

**Reason**: Brief explanation of why this file is being removed.

## Test Expectations

### <component or module name>
\`\`\`
✓ Test assertion 1
✓ Test assertion 2
✓ Test assertion 3
\`\`\`

## Edge Cases to Handle
1. **Edge case 1**: Description and handling approach
2. **Edge case 2**: Description and handling approach

## Existing Code Patterns to Follow
- Pattern 1: Description
- Pattern 2: Description
`,
    };
    return templates[fileKey] || '';
  }

  static getTechnicalTemplate() {
    return TECHNICAL_TEMPLATE_FILES;
  }

  static getTechnicalTemplateContent(fileKey) {
    const templates = {
      '01_TECHNICAL_REQUIREMENT.md': `# 01_TECHNICAL_REQUIREMENT.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Author**: TBD

---

## Technical Requirements

Describe the technical requirements here.

### Functional Requirements
- Requirement 1
- Requirement 2

### Non-Functional Requirements
- Performance: target
- Scalability: target

---

## Technical Constraints

- Constraint 1
- Constraint 2

---

*Ready for technical design.*
`,
      '02_TECHNICAL_DESIGN.md': `# 02_TECHNICAL_DESIGN.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Author**: TBD

---

## Technical Design

### Architecture

Describe the architecture here.

### Data Model

\`\`\`
Table: name
- field: type
- field: type
\`\`\`

### API Design

\`\`\`
GET /api/endpoint
POST /api/endpoint
\`\`\`

### Implementation Plan

1. Phase 1: Setup
2. Phase 2: Core logic
3. Phase 3: Testing

---

*Ready for implementation.*
`,
      '03_TECHNICAL_IMPLEMENTATION.md': `# 03_TECHNICAL_IMPLEMENTATION.md

**Status**: planned
**Priority**: P1 (High)
**Effort**: Small
**Author**: TBD
**Date created**: ${new Date().toISOString().split('T')[0]}
**Date completed**: TBD
**PR**: TBD
**Branch**: TBD

**Dependencies**: None

---

### a) Purpose

Describe the purpose and value delivered.

---

### b) Technical Implementation

1. **Step 1** — file path
   - Detail 1
   - Detail 2

2. **Step 2** — file path
   - Detail 1

---

### c) Testing

- [ ] Test 1
- [ ] Test 2

---

### d) Rollback Plan

- **How**: \`git revert <commit>\`
- **Data impact**: None
- **Downtime**: None

---

*Implementation plan.*
`,
    };
    return templates[fileKey] || '';
  }

  static getSimpleTemplate() {
    return SIMPLE_TEMPLATE_FILES;
  }

  static getSimpleTemplateContent(fileKey) {
    const templates = {
      '01_SIMPLE_TASKS.md': `# 01_SIMPLE_TASKS.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Author**: TBD

---

## Task List

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

---

## Notes

Additional notes go here.

---

*Simple task list.*
`,
    };
    return templates[fileKey] || '';
  }

  static getSpecificationTemplate() {
    return SPECIFICATION_TEMPLATE_FILES;
  }

  static getSpecificationTemplateContent(fileKey) {
    const templates = {
      '04_SPECIFICATION.md': `# 04_SPECIFICATION.md — Model Execution Spec

**Generated from**: Architect + Technical templates
**Target model**: 7B–34B local model (e.g., CodeLlama, Qwen, DeepSeek-Coder)
**Date**: YYYY-MM-DD

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create,
modify, or delete any file not listed here.

### CREATE: \`<file-path>\`

**Imports** (exact):
\`\`\`
// List every import statement with exact module paths
import { something } from 'module'
\`\`\`

**State variables** (exact names and types):
\`\`\`
variableName: type              → purpose and binding description
\`\`\`

**Functions** (exact signatures):
\`\`\`
async function functionName(params): ReturnType
  1. Step 1
  2. Step 2
  3. Step 3
\`\`\`

**Template structure** (exact hierarchy):
\`\`\`
<!-- Provide the exact component/template structure -->
\`\`\`

**Styling**: Describe styling requirements (scoped CSS, class names, etc.).

### MODIFY: \`<file-path>\`

**Add/modify**: \`<method or property name>\`
\`\`\`
// Describe the exact logic to add or modify
\`\`\`

**Position in file**: Describe where in the file the changes should go.

### DELETE: \`<file-path>\`

**Reason**: Brief explanation of why this file is being removed.

## Test Expectations

### <component or module name>
\`\`\`
✓ Test assertion 1
✓ Test assertion 2
✓ Test assertion 3
\`\`\`

## Edge Cases to Handle
1. **Edge case 1**: Description and handling approach
2. **Edge case 2**: Description and handling approach

## Existing Code Patterns to Follow
- Pattern 1: Description
- Pattern 2: Description
`,
    };
    return templates[fileKey] || '';
  }

  static async list(projectId, _userId) {
    
    const result = await pool.query(
      `SELECT pt.*, jsonb_array_length(pt.file_definitions)::int AS file_definitions_count,
              u.name as created_by_name 
       FROM project_templates pt 
       LEFT JOIN users u ON pt.created_by = u.id 
       WHERE pt.project_id = $1 
       ORDER BY pt.created_at DESC`,
      [projectId]
    );
    return result.rows;
  }

  static async create(projectId, name, description, fileDefinitions, userId) {
    
    const result = await pool.query(
      `INSERT INTO project_templates (project_id, name, description, file_definitions, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING *`,
      [projectId, name, description || null, JSON.stringify(fileDefinitions), userId]
    );
    return result.rows[0];
  }

  static async apply(ticketId, templateId, userId) {
    
    const templateResult = await pool.query(
      'SELECT * FROM project_templates WHERE id = $1',
      [templateId]
    );
    if (templateResult.rows.length === 0) {
      const { NotFoundError } = require('../errors/HttpError');
      throw new NotFoundError('Template not found');
    }
    const template = templateResult.rows[0];
    const fileDefinitions = JSON.parse(template.file_definitions);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const fileDef of fileDefinitions) {
        await client.query(
          `INSERT INTO ticket_planning (ticket_id, file_key, content, version, created_by)
           VALUES ($1, $2, $3, 1, $4)`,
          [ticketId, fileDef.key, fileDef.content || '', userId]
        );
      }

      await client.query(
        'UPDATE tickets SET planning_status = \'template_selected\', template_schema = $1 WHERE id = $2',
        [template.name, ticketId]
      );

      await client.query('COMMIT');
      return fileDefinitions;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async delete(templateId, userId) {
    
    const result = await pool.query(
      'DELETE FROM project_templates WHERE id = $1 AND created_by = $2 RETURNING *',
      [templateId, userId]
    );
    return result.rows[0];
  }

  static async update(templateId, userId, name, description, fileDefinitions) {
    
    const result = await pool.query(
      `UPDATE project_templates 
       SET name = $1, description = $2, file_definitions = $3::jsonb
       WHERE id = $4 AND created_by = $5 RETURNING *`,
      [name.trim(), description || null, JSON.stringify(fileDefinitions), templateId, userId]
    );
    return result.rows[0];
  }
}

module.exports = TemplateService;
