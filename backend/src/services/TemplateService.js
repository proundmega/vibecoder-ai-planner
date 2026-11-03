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
      '00_ARCHITECT_CHECKLIST.md': `# 00_ARCHITECT_CHECKLIST.md — {{Title}}

**Status**: planned
**Date created**: ${new Date().toISOString().split('T')[0]}
**Priority**: P0 | P1 | P2 | P3 | P4
**Scope**: Frontend | Backend | Both | Agent | Infra
**Depends on**:

> Owns: status, ticket map, deferred scope, user decisions.
> Other documents link here; they do not copy these tables.

## Why this ticket exists
2-4 sentences: the failure or gap, who it affects, what changes.

## Ticket map
| Doc | Present |
|---|---|
| 01_ARCHITECT_REQUIREMENT.md | [ ] |
| 02_ARCHITECT_DESIGN.md | [ ] |
| 03_ARCHITECT_IMPLEMENTATION.md | [ ] |
| 04_SPECIFICATION.md | [ ] optional |
| 05_RUNBOOK.md | [ ] optional |

## Readiness gate
- [ ] 01 has numbered FR/NFR, each with a testable acceptance statement
- [ ] 02 records the current-state audit and the chosen design
- [ ] 03 has a verification-matrix row for every FR/NFR
- [ ] Deferred register below is complete
- [ ] Open decisions are answered or accepted as assumptions
- [ ] No fact is duplicated across documents

## Deferred register (canonical)
| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | {{item}} | {{self / fg-XX}} | {{Security / Observability / ...}} | {{fg-XX / none}} | open |

States: open, scheduled, done, dropped. 01/02/03/04 link here.

## Decisions needed from the user
| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | {{question}} | {{A / B}} | {{A}} | |

## Completion gate
- [ ] Every FR/NFR acceptance statement in 01 is met
- [ ] Verification matrix in 03 is green and results recorded
- [ ] Status is done and the PR is recorded
- [ ] Deferred register reflects what was actually left out
`,
      '01_ARCHITECT_REQUIREMENT.md': `# 01_ARCHITECT_REQUIREMENT.md — {{Title}}

> Owns: problem, goals, numbered requirements, acceptance.
> Not here: design (02), verification matrix (03), file operations (04),
> deferred table (00).

## Problem
What is broken or missing? Who is affected? What is the observable symptom?
Include the failure sequence, not just the label.

## Goals
1. {{...}}

## Non-goals
- {{...}}

## Functional requirements
| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | {{what the system must do}} | {{observable pass/fail condition}} |
| FR2 | {{...}} | {{...}} |

Acceptance is a behaviour, not an implementation detail. 03 maps every ID to
at least one test; a requirement with no test row is not done.

## Non-functional / safety requirements
| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | {{security, performance, compatibility, operability}} | {{...}} |

## In scope
- {{...}}

## Out of scope
Summarise only. The authoritative list with reasons and follow-ups is
00 -> Deferred register.
- {{item}} — see 00 D1

## Open questions
| # | Question | Assumption if unanswered |
|---|---|---|
| 1 | {{...}} | {{...}} |

## Dependencies
- Depends on: {{ticket IDs or merged PRs}}
- Blocks: {{ticket IDs}}
`,
      '02_ARCHITECT_DESIGN.md': `# 02_ARCHITECT_DESIGN.md — {{Title}}

> Owns: current-state audit, chosen design, data model, contracts, risks,
> rollout.
> Not here: requirements (01), verification matrix (03), exact file operations
> (04), status and deferrals (00).

## Current state (the only infrastructure audit)
| Area | Exists? | Where | Gap |
|---|---|---|---|
| Backend route/controller/service | {{yes/no}} | backend/src/... | |
| Database table/column | {{yes/no}} | backend/src/migrations/... | |
| Frontend API client | {{yes/no}} | frontend/src/api/... | |
| Frontend view/component/route | {{yes/no}} | frontend/src/... | |
| Agent code | {{yes/no}} | agent/src/... | |

**Key insight:** frontend-only / backend-first / extend both / new build.

## Design summary
2-4 paragraphs or a small diagram. Explain why this shape.

## Alternatives considered
| Option | Pros | Cons | Decision |
|---|---|---|---|
| A | | | chosen |
| B | | | rejected because ... |

## Data model & migrations
SQL for new tables, columns and indexes. Name the migration and its rollback,
note any backfill, and state where it is added in
backend/src/migrations/apply.js.

## API contract
| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | /api/v1/... | JWT / agent key | ... | { success, data } | 400/403/404/409 |

## Data flow
trigger -> layer -> layer -> storage -> response

## Failure handling & recovery
| Failure | Detection | Behaviour | Operator action |
|---|---|---|---|
| {{...}} | | | |

## Security
- Authentication:
- Authorization (permission names):
- Input validation (Joi schema):
- Sensitive data:
- Rate limiting:

## Performance
- Expected load:
- Query/index risks:
- Pagination:

## Risks & edge cases
| Risk / edge case | Impact | Mitigation |
|---|---|---|
| {{...}} | | |

## Rollout
1. migration -> backend -> frontend -> enable flag
2. Rollback:

## Open questions
| # | Question | Resolution |
|---|---|---|
| 1 | {{...}} | {{...}} |

Deferred items are recorded in 00 -> Deferred register; do not list them here.
`,
      '03_ARCHITECT_IMPLEMENTATION.md': `# 03_ARCHITECT_IMPLEMENTATION.md — {{Title}}

> Owns: work order, per-file changes, verification matrix, results.
> Not here: design rationale (02), exact signatures (04), status (00).

## Plan
Ordered slices. Each slice should be independently verifiable.
1. {{Slice name}} — {{what changes}} — verify: {{command or test}}
2. {{...}}

## Per-file changes
| File | Action | Change |
|---|---|---|
| backend/src/... | CREATE / MODIFY / DELETE | {{what}} |
| frontend/src/... | CREATE / MODIFY / DELETE | {{what}} |
| agent/src/... | CREATE / MODIFY / DELETE | {{what}} |

Exact imports and signatures belong in 04 when it exists; otherwise add them
here.

## Dependencies
- {{service, client or ticket this needs}}
- {{what depends on this change}}

## Migration notes
- File: NNN_{{name}}.sql + _rollback.sql
- Apply order: {{position in the apply.js array}}
- Backfill/rollback risk:

## Verification matrix (canonical)
One row per requirement. This table is the contract between 01 and the code.
| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | backend unit | backend/src/__tests__/... | {{name}} | npm test |
| FR1 | bash integration | backend/integration-test/suites/... | {{name}} | bash integration-test/run.sh --only |
| NFR1 | agent unit | agent/src/test/... | {{name}} | mvn test |

A requirement with no row is not done.

## Verification commands
The standard set lives in planning/ENGINEERING_STANDARDS.md -> Definition of
done. Ticket-specific additions:
{{command}}

## Review checklist
- [ ] Every FR/NFR has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in apply.js
- [ ] API contract matches 02; OpenAPI/types regenerated if it changed
- [ ] No secret, .env, Jenkinsfile, or unrelated file touched
- [ ] 04 (if present) matches what was actually built

## Results
| Date | Commit | Suites | Outcome |
|---|---|---|---|
| {{YYYY-MM-DD}} | {{sha}} | {{suites}} | {{pass/fail}} |
`,
      '04_SPECIFICATION.md': `# 04_SPECIFICATION.md — Execution Spec

Optional. Use when a smaller model will execute the ticket. This file makes
file operations exact; it does not restate 01, 02 or 03.

**Generated from**: 01_ARCHITECT_REQUIREMENT.md, 02_ARCHITECT_DESIGN.md,
03_ARCHITECT_IMPLEMENTATION.md
**Target model**: 7B | 14B | 34B
**Requirement IDs covered**: {{FR1, FR2, NFR1}}

## Test-first requirement
Create the empty test stubs listed under Test expectations before any
production code. Then implement. Then fill in the assertions.

## File operations
The model must not create, modify, or delete a file that is not listed here.

### CREATE \`{{path}}\`
**Imports (exact):** list every import and module path.
**State (exact names and types):** name -> type -> purpose.
**Functions (exact signatures):** signature, then the ordered steps.
**Template structure (UI only):** exact element hierarchy.

### MODIFY \`{{path}}\`
- Position: after which method or at which line.
- Add: the exact change.
- Imports to add.

### DELETE \`{{path}}\`
- Remove: what and why.

## Test expectations
Each case is tagged with the requirement it proves. Minimum: one happy and one
error path per new public function; loading, empty and error states per new UI
component.

[FR1][happy] input -> expected
[FR1][error] input -> expected
[NFR1][edge] condition -> behaviour

## Edge cases
| Case | Expected behaviour |
|---|---|
| {{...}} | {{...}} |

## Patterns to follow
- Follow the surrounding code style.
- Repo-wide rules: planning/ENGINEERING_STANDARDS.md

## Files NOT to change
- {{path}} — {{why}}
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
    // The standalone specification is the same document as the architect
    // suite's 04 file. Return the shared definition instead of keeping a
    // second copy that can drift.
    if (fileKey !== '04_SPECIFICATION.md') return '';
    return TemplateService.getArchitectTemplateContent('04_SPECIFICATION.md');
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
