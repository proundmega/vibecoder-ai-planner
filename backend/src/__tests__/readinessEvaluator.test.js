const ReadinessEvaluator = require('../services/ReadinessEvaluator');

const ARCHITECT_TEMPLATE = {
  name: 'architecture',
  sectionsEnforced: true,
  files: [
    { key: '01_ARCHITECT_REQUIREMENT.md', required: true, requiredSections: ['Assumptions', 'Change impact'] },
    { key: '02_ARCHITECT_DESIGN.md', required: true, requiredSections: ['Failure modes and recovery', 'Security considerations'] },
    { key: '03_ARCHITECT_IMPLEMENTATION.md', required: true },
  ],
};

function readyFiles() {
  return {
    '01_ARCHITECT_REQUIREMENT.md': [
      '# 01',
      '## Assumptions',
      '| ID | Assumption | Impact if wrong | Validation / evidence |',
      '|---|---|---|---|',
      '| A1 | The API is reachable | Requests fail | Integration test |',
      '',
      '## Change impact',
      '| Area | Impact | Evidence / owner |',
      '|---|---|---|',
      '| API | New route | route test |',
      '| Rollback | revert | git revert |',
      '',
      '## Functional requirements',
      '| ID | Requirement | Acceptance |',
      '|---|---|---|',
      '| FR1 | Add readiness | 409 is returned |',
      '',
      '## Dependencies',
      '- none',
    ].join('\n'),
    '02_ARCHITECT_DESIGN.md': [
      '# 02',
      '## Failure modes and recovery',
      '| Failure mode | Trigger | Detection | Mitigation / test | Operator action |',
      '|---|---|---|---|---|',
      '| DB down | outage | health check | readiness test | retry |',
      '',
      '## Security considerations',
      '- Authentication: JWT required',
      '- Authorization: TICKET_READINESS_APPROVE permission',
      '- Project scoping: project membership check',
      '- Secrets: none stored',
      '- Audit: ticket_readiness_events',
      '- Rate limiting: existing limiter',
      '- Input validation: Joi schema',
      '- Data exposure: codes only',
      '',
      '## Rollback',
      '- revert the migration',
    ].join('\n'),
    '03_ARCHITECT_IMPLEMENTATION.md': [
      '# 03',
      '## Test plan',
      '- unit and integration tests',
      '## Dependencies',
      '- fg-30',
    ].join('\n'),
  };
}

function readyTicket(overrides = {}) {
  return {
    id: 1,
    title: 'Add the readiness gate',
    description: 'In scope: gate execution. Out of scope: rewriting the UI. ' +
      'This description explains the problem, the context and the expected behavior in detail.',
    templateSchema: 'architecture',
    planningStatus: 'completed',
    planApprovedAt: new Date().toISOString(),
    readinessRequirementIds: ['FR1'],
    ...overrides,
  };
}

function evaluate(overrides = {}, input = {}) {
  return ReadinessEvaluator.evaluate({
    ticket: readyTicket(overrides.ticket),
    files: overrides.files || readyFiles(),
    criteria: overrides.criteria || ['Given a draft, when it starts, then it is blocked'],
    template: overrides.template === undefined ? ARCHITECT_TEMPLATE : overrides.template,
    smallFix: overrides.smallFix || null,
    waivedCodes: overrides.waivedCodes || [],
    now: new Date('2026-11-22T00:00:00Z'),
    ...input,
  });
}

function codes(result) {
  return result.issues.map(issue => issue.code);
}

describe('ReadinessEvaluator', () => {
  test('a complete template ticket is ready', () => {
    const result = evaluate();
    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.requirements.map(req => req.id)).toEqual(['FR1']);
  });

  test('title and description checks use specific codes', () => {
    expect(codes(evaluate({ ticket: { title: 'fix' } }))).toContain('TITLE_TOO_GENERIC');
    expect(codes(evaluate({ ticket: { description: 'short' } }))).toContain('DESCRIPTION_TOO_SHORT');
  });

  test('missing scope is reported', () => {
    const files = readyFiles();
    files['01_ARCHITECT_REQUIREMENT.md'] = files['01_ARCHITECT_REQUIREMENT.md']
      .replace('## Change impact', '### Change impact');
    const result = evaluate({
      files,
      ticket: { description: 'A long enough description without the scope heading. '.repeat(3) },
    });
    expect(codes(result)).toContain('MISSING_SCOPE');
  });

  test('missing template and required files are reported', () => {
    expect(codes(evaluate({ template: null, ticket: { templateSchema: null } }))).toContain('MISSING_TEMPLATE');
    const files = readyFiles();
    delete files['02_ARCHITECT_DESIGN.md'];
    expect(codes(evaluate({ files }))).toContain('MISSING_REQUIRED_FILE');
  });

  test('empty required files and sections are reported', () => {
    const files = readyFiles();
    files['03_ARCHITECT_IMPLEMENTATION.md'] = '   ';
    expect(codes(evaluate({ files }))).toContain('EMPTY_REQUIRED_FILE');

    const missingSection = readyFiles();
    missingSection['01_ARCHITECT_REQUIREMENT.md'] = missingSection['01_ARCHITECT_REQUIREMENT.md']
      .replace('## Assumptions', '## Something else');
    expect(codes(evaluate({ files: missingSection }))).toContain('MISSING_REQUIRED_SECTION');
  });

  test('placeholders are reported with the file', () => {
    const files = readyFiles();
    files['03_ARCHITECT_IMPLEMENTATION.md'] += '\nTODO: fill this in';
    const result = evaluate({ files });
    const placeholder = result.issues.find(issue => issue.code === 'PLACEHOLDER');
    expect(placeholder).toBeDefined();
    expect(placeholder.file).toBe('03_ARCHITECT_IMPLEMENTATION.md');
  });

  test('missing acceptance criteria and plan approval are reported', () => {
    const result = evaluate({ criteria: [] , ticket: { planApprovedAt: null } });
    expect(codes(result)).toEqual(expect.arrayContaining(['MISSING_ACCEPTANCE_CRITERIA', 'PLAN_NOT_APPROVED']));
  });

  test('test plan, dependencies and rollback are required for non-small templates', () => {
    const files = readyFiles();
    files['03_ARCHITECT_IMPLEMENTATION.md'] = '# 03\nNo sections here.';
    files['01_ARCHITECT_REQUIREMENT.md'] = files['01_ARCHITECT_REQUIREMENT.md']
      .replace('## Dependencies\n- none', '');
    files['02_ARCHITECT_DESIGN.md'] = files['02_ARCHITECT_DESIGN.md']
      .replace('## Rollback\n- revert the migration', '');
    expect(codes(evaluate({ files }))).toEqual(
      expect.arrayContaining(['MISSING_TEST_PLAN', 'MISSING_DEPENDENCIES', 'MISSING_ROLLBACK'])
    );
  });

  test('assumptions must include impact and validation or an explicit none statement', () => {
    const empty = readyFiles();
    empty['01_ARCHITECT_REQUIREMENT.md'] = empty['01_ARCHITECT_REQUIREMENT.md']
      .replace('| A1 | The API is reachable | Requests fail | Integration test |', '| A1 | | | |');
    expect(codes(evaluate({ files: empty }))).toContain('EMPTY_ASSUMPTIONS');

    const missing = readyFiles();
    missing['01_ARCHITECT_REQUIREMENT.md'] = missing['01_ARCHITECT_REQUIREMENT.md']
      .replace(/## Assumptions[\s\S]*?(?=## Change impact)/, '');
    expect(codes(evaluate({ files: missing }))).toContain('MISSING_ASSUMPTIONS');

    const explicitNone = readyFiles();
    explicitNone['01_ARCHITECT_REQUIREMENT.md'] = explicitNone['01_ARCHITECT_REQUIREMENT.md']
      .replace(/## Assumptions[\s\S]*?(?=## Change impact)/, '## Assumptions\n\nNo material assumptions — verified by the existing tests.\n\n');
    expect(codes(evaluate({ files: explicitNone }))).not.toContain('MISSING_ASSUMPTIONS');
  });

  test('missing failure modes and security considerations are reported', () => {
    const files = readyFiles();
    files['02_ARCHITECT_DESIGN.md'] = files['02_ARCHITECT_DESIGN.md']
      .replace(/## Failure modes and recovery[\s\S]*?(?=## Security considerations)/, '')
      .replace(/## Security considerations[\s\S]*?(?=## Rollback)/, '');
    expect(codes(evaluate({ files }))).toEqual(
      expect.arrayContaining(['MISSING_FAILURE_MODES', 'MISSING_SECURITY_CONSIDERATIONS'])
    );
  });

  test('security-sensitive scope makes the security issue non-waivable', () => {
    const files = readyFiles();
    files['02_ARCHITECT_DESIGN.md'] = files['02_ARCHITECT_DESIGN.md']
      .replace(/## Security considerations[\s\S]*?(?=## Rollback)/, '')
      .replace('revert the migration', 'revert the change');
    const result = evaluate({
      files,
      ticket: { title: 'Add the authentication permission gate' },
      waivedCodes: ['MISSING_SECURITY_CONSIDERATIONS'],
    });
    const issue = result.allIssues.find(item => item.code === 'MISSING_SECURITY_CONSIDERATIONS');
    expect(issue.waivable).toBe(false);
    expect(result.ready).toBe(false);

    const resultForDocs = evaluate({ files, waivedCodes: ['MISSING_SECURITY_CONSIDERATIONS'] });
    expect(resultForDocs.issues.map(item => item.code)).not.toContain('MISSING_SECURITY_CONSIDERATIONS');
  });

  test('missing change impact is reported', () => {
    const files = readyFiles();
    files['01_ARCHITECT_REQUIREMENT.md'] = files['01_ARCHITECT_REQUIREMENT.md']
      .replace(/## Change impact[\s\S]*?(?=## Functional requirements)/, '');
    expect(codes(evaluate({ files }))).toContain('MISSING_CHANGE_IMPACT');
  });

  test('requirement parsing ignores cross-references and parses bullet definitions', () => {
    const files = readyFiles();
    files['01_ARCHITECT_REQUIREMENT.md'] = files['01_ARCHITECT_REQUIREMENT.md'].replace(
      /## Functional requirements[\s\S]*?(?=## Dependencies)/,
      [
        '## Functional requirements',
        '- **FR1 - Build the gate:** returns 409 (FR5).',
        '- **FR2 - Audit the decision:** writes one row (FR1).',
        '',
        'See FR1/FR8 for the audit rows.',
        '',
      ].join('\n')
    );

    const result = evaluate({ files });

    expect(result.requirements.map(req => req.id)).toEqual(['FR1', 'FR2']);
    expect(codes(result)).not.toContain('DUPLICATE_REQUIREMENT_ID');
    expect(codes(result)).not.toContain('MISSING_REQUIREMENT_ACCEPTANCE');
  });

  test('duplicate and acceptance-less requirement IDs are reported', () => {
    const files = readyFiles();
    files['01_ARCHITECT_REQUIREMENT.md'] = files['01_ARCHITECT_REQUIREMENT.md']
      .replace('| FR1 | Add readiness | 409 is returned |', '| FR1 | Add readiness | |\n| FR1 | Duplicate | |');
    const result = evaluate({ files });
    expect(codes(result)).toEqual(
      expect.arrayContaining(['DUPLICATE_REQUIREMENT_ID', 'MISSING_REQUIREMENT_ACCEPTANCE'])
    );
  });

  test('removing an approved requirement ID requires replan', () => {
    const files = readyFiles();
    files['01_ARCHITECT_REQUIREMENT.md'] = files['01_ARCHITECT_REQUIREMENT.md']
      .replace('| FR1 | Add readiness | 409 is returned |', '| FR2 | Renamed | done |');
    const result = evaluate({ files, ticket: { readinessRequirementIds: ['FR1'] } });
    expect(codes(result)).toContain('REQUIREMENT_ID_CHANGED');
  });

  test('a waiver suppresses a waivable issue but never PLAN_NOT_APPROVED', () => {
    const result = evaluate({
      ticket: { planApprovedAt: null },
      criteria: [],
      waivedCodes: ['MISSING_ACCEPTANCE_CRITERIA', 'PLAN_NOT_APPROVED'],
    });
    expect(codes(result)).not.toContain('MISSING_ACCEPTANCE_CRITERIA');
    expect(codes(result)).toContain('PLAN_NOT_APPROVED');
    expect(result.ready).toBe(false);
  });

  test('a small fix waives template/file/section checks but still checks criteria and assumptions', () => {
    const result = evaluate({
      template: null,
      files: {},
      criteria: [],
      smallFix: { at: '2026-11-22T00:00:00Z', reason: 'Single-file typo fix' },
      ticket: { templateSchema: null },
    });
    const found = codes(result);
    expect(found).not.toContain('MISSING_TEMPLATE');
    expect(found).not.toContain('MISSING_REQUIRED_FILE');
    expect(found).not.toContain('MISSING_TEST_PLAN');
    expect(found).toContain('MISSING_ACCEPTANCE_CRITERIA');
    expect(found).toContain('MISSING_ASSUMPTIONS');
  });

  test('a small fix with an explicit assumptions statement passes the assumptions check', () => {
    const result = evaluate({
      template: null,
      files: {},
      criteria: ['Typo fixed'],
      smallFix: { at: '2026-11-22T00:00:00Z', reason: 'Single-file typo fix' },
      ticket: { templateSchema: null, description: 'Fix a typo in the label. In scope: one label. ' +
        'No material assumptions — docs-only change with a visual check.' },
    });
    expect(codes(result)).not.toContain('MISSING_ASSUMPTIONS');
  });

  test('a security-sensitive small fix still requires security considerations', () => {
    const result = evaluate({
      template: null,
      files: {},
      criteria: ['The auth check still rejects the caller'],
      smallFix: { at: '2026-11-22T00:00:00Z', reason: 'One-line permission typo' },
      ticket: {
        templateSchema: null,
        title: 'Fix the authentication permission check',
        description: 'In scope: one permission check. No material assumptions — verified by the auth test.',
      },
      waivedCodes: ['MISSING_SECURITY_CONSIDERATIONS'],
    });

    expect(codes(result)).toContain('MISSING_SECURITY_CONSIDERATIONS');
    expect(result.ready).toBe(false);
  });

  test('custom templates without requiredSections report sectionsEnforced false', () => {
    const result = evaluate({
      template: {
        name: 'custom',
        sectionsEnforced: false,
        files: [{ key: '01_CUSTOM.md', required: true, requiredSections: [] }],
      },
      files: { '01_CUSTOM.md': '# 01\nBody without placeholders.' },
      ticket: { templateSchema: 'custom' },
    });
    expect(result.sectionsEnforced).toBe(false);
  });
});
