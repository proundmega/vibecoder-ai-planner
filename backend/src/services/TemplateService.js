const { pool } = require('../db');

const ARCHITECT_TEMPLATE_FILES = [
  { key: '00_ARCHITECT_CHECKLIST.md', title: 'Pre-Implementation Checklist', required: true },
  { key: '01_ARCHITECT_REQUIREMENT.md', title: 'Requirement', required: true },
  { key: '02_ARCHITECT_DESIGN.md', title: 'Design', required: true },
  { key: '03_ARCHITECT_IMPLEMENTATION.md', title: 'Implementation', required: true },
];

const TECHNICAL_TEMPLATE_FILES = [
  { key: '01_TECHNICAL_REQUIREMENT.md', title: 'Technical Requirements', required: true },
  { key: '02_TECHNICAL_DESIGN.md', title: 'Technical Design', required: true },
  { key: '03_TECHNICAL_IMPLEMENTATION.md', title: 'Implementation Plan', required: true },
];

const SIMPLE_TEMPLATE_FILES = [
  { key: '01_SIMPLE_TASKS.md', title: 'Task List', required: true },
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
**Author**: TBD

---

## Pre-Implementation Checklist

- [ ] Requirements are clear and unambiguous
- [ ] Design has been reviewed and approved
- [ ] Implementation plan is detailed
- [ ] Tests are written before implementation
- [ ] Rollback plan is documented
- [ ] CI requirements are defined
- [ ] Anti-patterns are identified

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation.**

1. **Decision 1**: Description here?
   - Option A: Description
   - Option B: Description

---

*Complete this checklist before starting implementation.*
`,
      '01_ARCHITECT_REQUIREMENT.md': `# 01_ARCHITECT_REQUIREMENT.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Author**: TBD

---

## Requirement

Describe the requirement here.

---

## Scope

- What is included
- What is included

---

## Assumptions

- Assumption 1
- Assumption 2

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation.**

1. **Question**: Description?
   - Option A
   - Option B

---

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

---

## Out of Scope

- Not included
- Not included

---

## Testing Checklist

- [ ] Test 1
- [ ] Test 2

---

## CI Requirements (MANDATORY)

- \`npm test\` must pass
- \`npm run lint\` must pass

---

## Anti-Patterns to Avoid

- \`\`\`
- ❌ Anti-pattern 1
- ❌ Anti-pattern 2

---

*Ready for design phase.*
`,
      '02_ARCHITECT_DESIGN.md': `# 02_ARCHITECT_DESIGN.md

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Author**: TBD

---

## Problem Statement

Describe the problem here.

---

## Current State

Current implementation details.

---

## Design

### Proposed Solution

Describe the proposed solution with code examples.

### Data Flow Diagram

\`\`\`
Client → [middleware] → [handler] → Response
\`\`\`

### Alternative Designs Considered

- **Alternative 1** — Chose current design because: reason. Alternative was considered but rejected because: reason.
- **Alternative 2** — Chose current design because: reason. Alternative was considered but rejected because: reason.

### Config / Env Changes

- NEW: file — description
- CHANGED: file — description

---

## Dependencies

- Existing: dependency1
- New: dependency2

---

## Risks/Edge Cases

- Risk 1: Mitigation
- Risk 2: Mitigation

---

*Ready for implementation phase.*
`,
      '03_ARCHITECT_IMPLEMENTATION.md': `# 03_ARCHITECT_IMPLEMENTATION.md

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

### b) Actions

1. **Action 1** — file path
   - Detail 1
   - Detail 2

2. **Action 2** — file path
   - Detail 1

---

### c) Dependencies

- None — self-contained change

---

### d) Risks/Edge Cases

- Risk 1: Mitigation

---

### e) Testing

#### Unit Tests
- [ ] Test 1
- [ ] Test 2

#### Integration Tests
- [ ] Test 3
- [ ] Test 4

---

### f) Rollback Plan

- **How**: \`git revert <commit>\`
- **Data impact**: None
- **Downtime**: None

---

### g) Files Changed

- \`file1.js\` — NEW
- \`file2.js\` — CHANGED

---

### h) Code Review Checklist

- [ ] Checklist item 1
- [ ] Checklist item 2

---

### i) Post-Deploy Verification

- [ ] Verify item 1
- [ ] Verify item 2

---

*Implementation phase.*
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

  static async list(projectId, userId) {
    const { pool } = require('../db');
    const result = await pool.query(
      `SELECT pt.*, u.name as created_by_name 
       FROM project_templates pt 
       LEFT JOIN users u ON pt.created_by = u.id 
       WHERE pt.project_id = $1 
       ORDER BY pt.created_at DESC`,
      [projectId]
    );
    return result.rows;
  }

  static async create(projectId, name, description, fileDefinitions, userId) {
    const { pool } = require('../db');
    const result = await pool.query(
      `INSERT INTO project_templates (project_id, name, description, file_definitions, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING *`,
      [projectId, name, description || null, JSON.stringify(fileDefinitions), userId]
    );
    return result.rows[0];
  }

  static async apply(ticketId, templateId, userId) {
    const { pool } = require('../db');
    const templateResult = await pool.query(
      'SELECT * FROM project_templates WHERE id = $1',
      [templateId]
    );
    if (templateResult.rows.length === 0) {
      throw new Error('Template not found');
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
}

module.exports = TemplateService;
