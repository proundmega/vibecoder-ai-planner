const TicketPlanningService = require('../services/TicketPlanningService');
const TemplateService = require('../services/TemplateService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn(),
      release: jest.fn(),
    }),
  },
  transaction: jest.fn(),
}));

describe('TicketPlanningService', () => {
  const { pool } = require('../db');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should return all planning files for a ticket', async () => {
      pool.query.mockResolvedValue({
        rows: [
          { file_key: '00_CHECKLIST.md', content: '# Checklist', version: 1, created_by_name: 'User', ticket_title: 'Test' },
        ],
      });

      const result = await TicketPlanningService.list('ticket-1', 'user-1');
      expect(pool.query).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].file_key).toBe('00_CHECKLIST.md');
    });
  });

  describe('get', () => {
    it('should return a specific planning file', async () => {
      pool.query.mockResolvedValue({
        rows: [{ file_key: '01_REQUIREMENT.md', content: '# Requirement', version: 1, created_by_name: 'User', ticket_title: 'Test' }],
      });

      const result = await TicketPlanningService.get('ticket-1', '01_REQUIREMENT.md', 'user-1');
      expect(result.file_key).toBe('01_REQUIREMENT.md');
    });

    it('should return null for non-existent file', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await TicketPlanningService.get('ticket-1', 'nonexistent.md', 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('getPlanningForTicket', () => {
    it('should format planning data for ticket response', async () => {
      pool.query.mockResolvedValue({
        rows: [
          { file_key: '00_CHECKLIST.md', content: '# v1', version: 1, updated_at: '2026-01-01', created_by_name: 'User' },
          { file_key: '00_CHECKLIST.md', content: '# v2', version: 2, updated_at: '2026-01-02', created_by_name: 'User' },
          { file_key: '01_REQUIREMENT.md', content: '# Req', version: 1, updated_at: '2026-01-01', created_by_name: 'User' },
        ],
      });

      const ticket = { id: 'ticket-1', planningStatus: 'in_progress', templateSchema: 'architecture' };
      const result = await TicketPlanningService.getPlanningForTicket(ticket, 'user-1');

      expect(result.status).toBe('in_progress');
      expect(result.templateSchema).toBe('architecture');
      expect(result.files).toHaveLength(2);
      expect(result.files[0].version).toBe(2);
    });
  });
});

describe('TemplateService', () => {
  describe('getArchitectTemplate', () => {
    it('should return 5 architect template files', () => {
      const files = TemplateService.getArchitectTemplate();
      expect(files).toHaveLength(5);
      expect(files[0].key).toBe('00_ARCHITECT_CHECKLIST.md');
      expect(files[1].key).toBe('01_ARCHITECT_REQUIREMENT.md');
      expect(files[2].key).toBe('02_ARCHITECT_DESIGN.md');
      expect(files[3].key).toBe('03_ARCHITECT_IMPLEMENTATION.md');
      expect(files[4].key).toBe('04_SPECIFICATION.md');
    });
  });

  describe('getArchitectTemplateContent', () => {
    it('should return content for 00_ARCHITECT_CHECKLIST.md', () => {
      const content = TemplateService.getArchitectTemplateContent('00_ARCHITECT_CHECKLIST.md');
      expect(content).toContain('ARCHITECT_CHECKLIST');
      expect(content).toContain('## Pre-Implementation Checklist');
      expect(content).toContain('### Planning');
      expect(content).toContain('### Existing Infrastructure Audit');
    });

    it('should return content for 01_ARCHITECT_REQUIREMENT.md', () => {
      const content = TemplateService.getArchitectTemplateContent('01_ARCHITECT_REQUIREMENT.md');
      expect(content).toContain('ARCHITECT_REQUIREMENT');
      expect(content).toContain('## Problem Statement');
      expect(content).toContain('## Scope');
      expect(content).toContain('## Acceptance Criteria');
    });

    it('should return content for 02_ARCHITECT_DESIGN.md', () => {
      const content = TemplateService.getArchitectTemplateContent('02_ARCHITECT_DESIGN.md');
      expect(content).toContain('ARCHITECT_DESIGN');
      expect(content).toContain('## Current State');
      expect(content).toContain('## Proposed Solution');
      expect(content).toContain('### File-Level Impact');
    });

    it('should return content for 03_ARCHITECT_IMPLEMENTATION.md', () => {
      const content = TemplateService.getArchitectTemplateContent('03_ARCHITECT_IMPLEMENTATION.md');
      expect(content).toContain('ARCHITECT_IMPLEMENTATION');
      expect(content).toContain('## Purpose');
      expect(content).toContain('## Implementation Order');
      expect(content).toContain('## Per-File Action Plan');
    });

    it('should return content for 04_SPECIFICATION.md', () => {
      const content = TemplateService.getArchitectTemplateContent('04_SPECIFICATION.md');
      expect(content).toContain('04_SPECIFICATION');
      expect(content).toContain('## File Operations');
      expect(content).toContain('## Test Expectations');
      expect(content).toContain('## Edge Cases to Handle');
    });

    it('should return empty string for unknown file key', () => {
      const content = TemplateService.getArchitectTemplateContent('unknown.md');
      expect(content).toBe('');
    });
  });

  describe('getSpecificationTemplate', () => {
    it('should return 1 specification template file', () => {
      const files = TemplateService.getSpecificationTemplate();
      expect(files).toHaveLength(1);
      expect(files[0].key).toBe('04_SPECIFICATION.md');
    });
  });

  describe('getSpecificationTemplateContent', () => {
    it('should return content for 04_SPECIFICATION.md', () => {
      const content = TemplateService.getSpecificationTemplateContent('04_SPECIFICATION.md');
      expect(content).toContain('04_SPECIFICATION');
      expect(content).toContain('## File Operations');
      expect(content).toContain('## Test Expectations');
    });

    it('should return same content as architect 04_SPECIFICATION.md', () => {
      const specContent = TemplateService.getSpecificationTemplateContent('04_SPECIFICATION.md');
      const architectContent = TemplateService.getArchitectTemplateContent('04_SPECIFICATION.md');
      expect(specContent).toBe(architectContent);
    });

    it('should return empty string for unknown file key', () => {
      const content = TemplateService.getSpecificationTemplateContent('unknown.md');
      expect(content).toBe('');
    });
  });

  describe('getTechnicalTemplate', () => {
    it('should return 3 technical template files', () => {
      const files = TemplateService.getTechnicalTemplate();
      expect(files).toHaveLength(3);
      expect(files[0].key).toBe('01_TECHNICAL_REQUIREMENT.md');
      expect(files[1].key).toBe('02_TECHNICAL_DESIGN.md');
      expect(files[2].key).toBe('03_TECHNICAL_IMPLEMENTATION.md');
    });
  });

  describe('getSimpleTemplate', () => {
    it('should return 1 simple template file', () => {
      const files = TemplateService.getSimpleTemplate();
      expect(files).toHaveLength(1);
      expect(files[0].key).toBe('01_SIMPLE_TASKS.md');
    });
  });
});
