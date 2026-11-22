/**
 * fg-45 Definition of Ready evaluator.
 *
 * Pure and deterministic: it receives the ticket, the latest planning files,
 * the acceptance criteria and the resolved template definition, and returns the
 * issue list. It never writes and never touches the database, so the readiness
 * service can evaluate inside or outside a transaction.
 *
 * The checks are deliberately structural. They prove that a section exists and
 * is not a placeholder; reviewers and humans judge the content quality.
 */

const GENERIC_TITLES = new Set(['fix', 'fix stuff', 'bug', 'wip', 'misc', 'updates']);

const PLACEHOLDER_PATTERNS = [
  /\{\{[^}]*\}\}/, // {{DATE}}
  /\bTBD\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
];

const TEMPLATE_RISK_FILES = {
  architecture: {
    assumptions: ['01_ARCHITECT_REQUIREMENT.md', '00_ARCHITECT_CHECKLIST.md'],
    changeImpact: ['01_ARCHITECT_REQUIREMENT.md', '00_ARCHITECT_CHECKLIST.md'],
    failureModes: ['02_ARCHITECT_DESIGN.md'],
    security: ['02_ARCHITECT_DESIGN.md'],
    testPlan: ['03_ARCHITECT_IMPLEMENTATION.md', '04_SPECIFICATION.md'],
    dependencies: ['01_ARCHITECT_REQUIREMENT.md', '03_ARCHITECT_IMPLEMENTATION.md'],
    rollback: ['02_ARCHITECT_DESIGN.md', '03_ARCHITECT_IMPLEMENTATION.md'],
    nonSmall: true,
  },
  technical: {
    assumptions: ['01_TECHNICAL_REQUIREMENT.md', '00_ARCHITECT_CHECKLIST.md'],
    changeImpact: ['01_TECHNICAL_REQUIREMENT.md', '00_ARCHITECT_CHECKLIST.md'],
    failureModes: ['02_TECHNICAL_DESIGN.md'],
    security: ['02_TECHNICAL_DESIGN.md'],
    testPlan: ['03_TECHNICAL_IMPLEMENTATION.md'],
    dependencies: ['03_TECHNICAL_IMPLEMENTATION.md'],
    rollback: ['03_TECHNICAL_IMPLEMENTATION.md'],
    nonSmall: true,
  },
  simple: {
    assumptions: ['01_SIMPLE_TASKS.md', '00_ARCHITECT_CHECKLIST.md'],
    changeImpact: ['01_SIMPLE_TASKS.md', '00_ARCHITECT_CHECKLIST.md'],
    nonSmall: false,
  },
  specification: {
    assumptions: ['04_SPECIFICATION.md'],
    changeImpact: ['04_SPECIFICATION.md'],
    failureModes: ['04_SPECIFICATION.md'],
    security: ['04_SPECIFICATION.md'],
    testPlan: ['04_SPECIFICATION.md'],
    dependencies: ['04_SPECIFICATION.md'],
    rollback: ['04_SPECIFICATION.md'],
    nonSmall: true,
  },
};

const SECURITY_KEYWORDS = [
  'auth', 'authentication', 'authorization', 'permission', 'migration',
  'secret', 'credential', 'api key', 'api-key', 'token', 'agent boundary',
  'external call', 'user data', 'password', 'sanitiz', 'tenant',
];

const SECURITY_CONCEPTS = [
  'auth', 'permission', 'scop', 'tenant', 'secret', 'audit', 'rate limit',
  'validation', 'exposure', 'sanitiz', 'credential',
];

function extractSection(content, name) {
  if (!content) return null;
  const lines = String(content).split(/\r?\n/);
  const target = name.trim().toLowerCase();
  let start = -1;
  let level = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{2,6})\s+(.*?)\s*$/.exec(lines[i]);
    if (match && match[2].trim().toLowerCase() === target) {
      start = i;
      level = match[1].length;
      break;
    }
  }
  if (start === -1) return null;

  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[i]);
    if (match && match[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

function isPlaceholder(text) {
  if (!text) return false;
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text));
}

function tableDataRows(section) {
  if (!section) return [];
  const rows = section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('|'));
  return rows.filter((line, index) => {
    if (index === 0) return false; // header
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length === 0) return false;
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell) || cell === '')) return false; // separator
    return cells.some(cell => cell.length > 0);
  });
}

function meaningfulSection(section) {
  const text = (section || '').trim();
  if (!text) return false;
  if (isPlaceholder(text)) return false;
  return text.length >= 12;
}

function hasNoMaterialAssumptions(text) {
  return /no material assumptions\s*[-—:]/i.test(text || '');
}

function validAssumptions(section) {
  if (!section) return false;
  if (hasNoMaterialAssumptions(section)) return true;
  const rows = tableDataRows(section).filter(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    // Row must have an assumption plus impact and validation evidence.
    return cells.length >= 3 && cells[0].length > 0 && cells[1].length > 0 && cells[2].length > 0;
  });
  return rows.length > 0;
}

function validChangeImpact(section) {
  if (!section) return false;
  if (/\bn\/a\b/i.test(section) && section.replace(/[^a-z0-9]/gi, '').length > 12) return true;
  const rows = tableDataRows(section).filter(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    return cells.length >= 3 && cells[0].length > 0 && cells[1].length > 0 && cells[2].length > 0;
  });
  return rows.length > 0;
}

function validFailureModes(section) {
  if (!section || isPlaceholder(section)) return false;
  const rows = tableDataRows(section).filter(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    return cells.length >= 3 && cells[0].length > 0 && cells[2].length > 0;
  });
  return rows.length > 0;
}

function validSecurity(section) {
  if (!meaningfulSection(section)) return false;
  const lower = section.toLowerCase();
  const concepts = SECURITY_CONCEPTS.filter(keyword => lower.includes(keyword));
  return new Set(concepts).size >= 3;
}

function sectionFromFiles(files, keys, sectionName) {
  for (const key of keys || []) {
    if (files[key] === undefined || files[key] === null) continue;
    const section = extractSection(files[key], sectionName);
    if (section !== null) return { key, section };
  }
  return null;
}

function anyFileContains(files, pattern) {
  return Object.values(files || {}).some(content => pattern.test(content || ''));
}

/**
 * Parse requirement *definitions*, not every mention of an ID.
 *
 * Priority: a requirements table (the ID must be the first cell) wins over
 * bullet definitions. Cross-reference prose ("See FR1/FR8 ...") is ignored so
 * a valid plan cannot be blocked by a duplicate or a missing acceptance.
 */
function parseRequirements(fileContent) {
  const tableDefinitions = [];
  const bulletDefinitions = [];
  if (!fileContent) {
    return { requirements: [], duplicates: new Set(), missingAcceptance: [] };
  }

  for (const line of String(fileContent).split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1).map(cell => cell.trim());
      const idIndex = cells.findIndex(cell => /^N?FR\d+$/.test(cell));
      // Requirement tables put the ID in the first column. A reference table
      // that merely mentions an ID in a later column is ignored.
      if (idIndex === 0) {
        tableDefinitions.push({
          id: cells[0],
          text: trimmed,
          acceptance: cells[2] || '',
        });
      }
      continue;
    }

    const bullet = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (!bullet) continue;
    const body = bullet[1];
    const idMatch = /^(?:\*\*)?\s*(N?FR\d+)\b/.exec(body);
    if (!idMatch) continue;

    let rest = body.slice(idMatch[0].length).replace(/^[\s*:—–-]+/, '');
    // Bold definitions: "**FR1 - Build the gate:** returns 409". The
    // acceptance starts after the closing bold marker.
    const boldEnd = rest.indexOf('**');
    if (boldEnd !== -1) rest = rest.slice(boldEnd + 2);
    rest = rest.replace(/^[\s:—–-]+/, '').trim();

    bulletDefinitions.push({
      id: idMatch[1],
      text: trimmed,
      acceptance: rest,
    });
  }

  const definitions = tableDefinitions.length > 0 ? tableDefinitions : bulletDefinitions;
  const duplicates = new Set();
  const seen = new Set();
  for (const definition of definitions) {
    if (seen.has(definition.id)) duplicates.add(definition.id);
    seen.add(definition.id);
  }

  const missingAcceptance = definitions
    .filter(definition => (definition.acceptance || '').replace(/[|\s]/g, '').length < 8)
    .map(definition => definition.id);

  return { requirements: definitions, duplicates, missingAcceptance };
}

function isSecuritySensitive({ ticket, files }) {
  const haystack = [
    ticket?.title,
    ticket?.description,
    ticket?.scope,
    ...Object.values(files || {}),
  ].filter(Boolean).join('\n').toLowerCase();
  return SECURITY_KEYWORDS.some(keyword => haystack.includes(keyword));
}

class ReadinessEvaluator {
  /**
   * @param {object} input
   * @param {object} input.ticket flattened ticket row (camelCase or snake_case)
   * @param {Record<string,string>} input.files latest planning file content by key
   * @param {string[]} input.criteria acceptance criteria text rows
   * @param {{name:string, files:Array, custom?:boolean}} input.template
   * @param {{at?:string, reason?:string}|null} input.smallFix
   * @param {string[]} input.waivedCodes active (unexpired) waiver codes
   * @param {Date} input.now
   */
  evaluate({ ticket = {}, files = {}, criteria = [], template = null, smallFix = null, waivedCodes = [], now = new Date() } = {}) {
    const issues = [];
    const push = (code, message, extra = {}) => issues.push({ code, message, ...extra });

    const title = String(ticket.title || '').trim();
    const description = String(ticket.description || '').trim();
    const normalizedTitle = title.toLowerCase();
    const templateName = template?.name || ticket.templateSchema || ticket.template_schema || null;
    const riskProfile = TEMPLATE_RISK_FILES[templateName] || null;
    const isSmallFix = Boolean(smallFix && (smallFix.at || smallFix.reason));
    const securitySensitive = isSecuritySensitive({ ticket, files });
    const templateFiles = template?.files || [];

    // 1. Title
    if (title.length < 12 || GENERIC_TITLES.has(normalizedTitle)) {
      push('TITLE_TOO_GENERIC', 'Title is too short or generic; describe the change', { field: 'title', waivable: true });
    }

    // 2. Description
    if (description.length < 80) {
      push('DESCRIPTION_TOO_SHORT', 'Description must explain the problem and expected behavior (at least 80 characters)', { field: 'description', waivable: true });
    }

    // 3. Scope (planning file or description)
    const scopePattern = /(^|\n)\s*(#{1,6}\s*)?(in scope|out of scope|scope)\b/i;
    const scopePresent = scopePattern.test(description) || anyFileContains(files, scopePattern);
    if (!scopePresent) {
      push('MISSING_SCOPE', 'Document what is in and out of scope', { field: 'description', waivable: true });
    }

    // 4. Acceptance criteria
    const nonEmptyCriteria = (criteria || []).map(c => String(c || '').trim()).filter(Boolean);
    if (nonEmptyCriteria.length === 0) {
      push('MISSING_ACCEPTANCE_CRITERIA', 'Add at least one testable acceptance criterion', { waivable: true });
    }

    // 5-6. Template, required files
    if (!templateName && !isSmallFix) {
      push('MISSING_TEMPLATE', 'Apply a planning template or record a small-fix exemption', { field: 'template', waivable: false });
    }

    if (templateName && !isSmallFix) {
      for (const fileDef of templateFiles) {
        if (!fileDef.required) continue;
        const content = files[fileDef.key];
        if (content === undefined || content === null) {
          push('MISSING_REQUIRED_FILE', `Required planning file is missing: ${fileDef.key}`, { file: fileDef.key, waivable: false });
          continue;
        }
        if (!String(content).trim()) {
          push('EMPTY_REQUIRED_FILE', `Required planning file is empty: ${fileDef.key}`, { file: fileDef.key, waivable: false });
          continue;
        }

        for (const sectionName of fileDef.requiredSections || []) {
          const section = extractSection(content, sectionName);
          if (section === null || !section.trim()) {
            push('MISSING_REQUIRED_SECTION', `Required section "${sectionName}" is missing or empty in ${fileDef.key}`, {
              file: fileDef.key,
              section: sectionName,
              waivable: true,
            });
          }
        }
      }
    }

    // 7. Placeholders in required files (or any planning file when no template)
    const placeholderTargets = templateFiles.filter(f => f.required).map(f => f.key);
    const keysToScan = placeholderTargets.length > 0 ? placeholderTargets : Object.keys(files);
    for (const key of keysToScan) {
      const content = files[key];
      if (!content) continue;
      const marker = PLACEHOLDER_PATTERNS.find(pattern => pattern.test(content));
      if (marker) {
        push('PLACEHOLDER', `Planning file ${key} still contains a placeholder`, {
          file: key,
          marker: marker.source,
          waivable: true,
        });
      }
    }

    // 8. Approval
    if (!ticket.planApprovedAt && !ticket.plan_approved_at) {
      push('PLAN_NOT_APPROVED', 'A project administrator must approve the plan', { waivable: false });
    }

    // 9. Test plan / dependencies / rollback for non-small templates
    if (!isSmallFix && riskProfile?.nonSmall) {
      const testPlan = sectionFromFiles(files, riskProfile.testPlan, 'Test plan')
        || sectionFromFiles(files, riskProfile.testPlan, 'Testing')
        || sectionFromFiles(files, riskProfile.testPlan, 'Verification')
        || sectionFromFiles(files, riskProfile.testPlan, 'Verification matrix');
      const testPlanAny = testPlan || (anyFileContains(files, /(^|\n)#{1,6}\s*(test|testing|tests|test plan|verification|verification matrix)\b/i) ? { section: 'present' } : null);
      if (!testPlanAny) push('MISSING_TEST_PLAN', 'Document how the change will be tested or verified', { waivable: true });

      const dependencies = sectionFromFiles(files, riskProfile.dependencies, 'Dependencies')
        || (anyFileContains(files, /(^|\n)\s*(\*\*)?depends on(\*\*)?\s*:/i) ? { section: 'present' } : null);
      if (!dependencies) push('MISSING_DEPENDENCIES', 'Document ticket and service dependencies', { waivable: true });

      const rollback = sectionFromFiles(files, riskProfile.rollback, 'Rollback')
        || sectionFromFiles(files, riskProfile.rollback, 'Rollback plan')
        || sectionFromFiles(files, riskProfile.rollback, 'Risks')
        || (anyFileContains(files, /(^|\n)#{1,6}\s*(rollback|risks?)\b/i) ? { section: 'present' } : null);
      if (!rollback) push('MISSING_ROLLBACK', 'Document rollback or accepted risk', { waivable: true });
    }

    // 10. Assumptions (every template; small fix may use a one-line statement)
    if (riskProfile) {
      const assumptionsEntry = sectionFromFiles(files, riskProfile.assumptions, 'Assumptions');
      const assumptionsText = assumptionsEntry?.section
        || (hasNoMaterialAssumptions(description) ? description : null);
      if (!assumptionsText) {
        push('MISSING_ASSUMPTIONS', 'Add an Assumptions table or "No material assumptions — <reason>"', { waivable: true });
      } else if (!validAssumptions(assumptionsText) && !hasNoMaterialAssumptions(description)) {
        push('EMPTY_ASSUMPTIONS', 'Assumptions must include impact-if-wrong and a validation/evidence path', {
          file: assumptionsEntry?.key,
          waivable: true,
        });
      }
    } else if (isSmallFix) {
      const hasStatement = hasNoMaterialAssumptions(description)
        || hasNoMaterialAssumptions(Object.values(files).join('\n'));
      if (!hasStatement) {
        push('MISSING_ASSUMPTIONS', 'Record "No material assumptions — <reason>" for a small fix', { waivable: true });
      }
    }

    // 11. Failure modes (non-small)
    if (!isSmallFix && riskProfile?.failureModes) {
      const entry = sectionFromFiles(files, riskProfile.failureModes, 'Failure modes and recovery')
        || sectionFromFiles(files, riskProfile.failureModes, 'Failure modes');
      if (!validFailureModes(entry?.section)) {
        push('MISSING_FAILURE_MODES', 'Add a Failure modes and recovery table with detection and mitigation/test', {
          file: entry?.key,
          waivable: true,
        });
      }
    }

    // 12. Security considerations.
    // Security-sensitive scope is never waived by a small-fix exemption: a
    // one-line auth/permission change still needs the section. The small fix
    // only waives template/files/failure modes.
    if (securitySensitive) {
      const entry = sectionFromFiles(files, Object.keys(files), 'Security considerations');
      if (!validSecurity(entry?.section)) {
        push('MISSING_SECURITY_CONSIDERATIONS', 'This ticket is security-sensitive; add Security considerations', {
          file: entry?.key,
          waivable: false,
        });
      }
    } else if (!isSmallFix && riskProfile?.security) {
      const entry = sectionFromFiles(files, riskProfile.security, 'Security considerations');
      if (!validSecurity(entry?.section)) {
        push('MISSING_SECURITY_CONSIDERATIONS', 'Add Security considerations covering auth, permissions, scoping, secrets, audit, rate limiting, validation and data exposure', {
          file: entry?.key,
          waivable: true,
        });
      }
    }

    // 13. Change impact (non-small or lightweight templates)
    if (!isSmallFix && riskProfile?.changeImpact) {
      const entry = sectionFromFiles(files, riskProfile.changeImpact, 'Change impact');
      if (!validChangeImpact(entry?.section)) {
        push('MISSING_CHANGE_IMPACT', 'Add a Change impact table (area, impact, evidence/owner)', {
          file: entry?.key,
          waivable: true,
        });
      }
    }

    // 14. Requirement IDs
    const requirementFile = files['01_ARCHITECT_REQUIREMENT.md']
      || files['01_TECHNICAL_REQUIREMENT.md']
      || files['04_SPECIFICATION.md']
      || files['00_ARCHITECT_CHECKLIST.md']
      || '';
    const parsed = parseRequirements(requirementFile);
    if (parsed.duplicates.size > 0) {
      push('DUPLICATE_REQUIREMENT_ID', `Duplicate requirement IDs: ${[...parsed.duplicates].join(', ')}`, { waivable: false });
    }
    if (parsed.missingAcceptance.length > 0) {
      push('MISSING_REQUIREMENT_ACCEPTANCE', `Requirements without an acceptance statement: ${parsed.missingAcceptance.join(', ')}`, { waivable: true });
    }
    const approvedIds = Array.isArray(ticket.readinessRequirementIds)
      ? ticket.readinessRequirementIds
      : (Array.isArray(ticket.readiness_requirement_ids) ? ticket.readiness_requirement_ids : []);
    if ((ticket.planApprovedAt || ticket.plan_approved_at) && approvedIds.length > 0) {
      const currentIds = new Set(parsed.requirements.map(req => req.id));
      const removed = approvedIds.filter(id => !currentIds.has(id));
      if (removed.length > 0) {
        push('REQUIREMENT_ID_CHANGED', `Approved requirement IDs were renamed or removed: ${removed.join(', ')}. Replan required.`, { waivable: false });
      }
    }

    // Apply waivers: unlisted and non-waivable issues still block.
    const waiverSet = new Set(waivedCodes || []);
    const effectiveIssues = issues.filter(
      issue => !(issue.waivable !== false && waiverSet.has(issue.code))
    );

    return {
      ready: effectiveIssues.length === 0,
      issues: effectiveIssues,
      allIssues: issues,
      waivedCodes: [...waiverSet],
      template: templateName,
      templateName,
      sectionsEnforced: Boolean(template?.sectionsEnforced),
      securitySensitive,
      smallFix: isSmallFix,
      planningStatus: ticket.planningStatus || ticket.planning_status || 'not_started',
      planApproved: Boolean(ticket.planApprovedAt || ticket.plan_approved_at),
      requirements: parsed.requirements,
      evaluatedAt: now.toISOString(),
    };
  }
}

module.exports = new ReadinessEvaluator();
module.exports.ReadinessEvaluator = ReadinessEvaluator;
module.exports.TEMPLATE_RISK_FILES = TEMPLATE_RISK_FILES;
module.exports.extractSection = extractSection;
module.exports.parseRequirements = parseRequirements;
