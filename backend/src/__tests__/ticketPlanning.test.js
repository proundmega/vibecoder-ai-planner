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
      expect(result[0].key).toBe('00_CHECKLIST.md');
    });
  });

  describe('get', () => {
    it('should return a specific planning file', async () => {
      pool.query.mockResolvedValue({
        rows: [{ file_key: '01_REQUIREMENT.md', content: '# Requirement', version: 1, created_by_name: 'User', ticket_title: 'Test' }],
      });

      const result = await TicketPlanningService.get('ticket-1', '01_REQUIREMENT.md', 'user-1');
      expect(result.key).toBe('01_REQUIREMENT.md');
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

  describe('applyTemplate', () => {
    function createMockClient(queryMock) {
      const client = {
        query: queryMock || jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValue(client);
      return client;
    }

    it('should apply architecture template (regression: must be "architecture", not "architect")', async () => {
      const client = createMockClient(jest.fn().mockResolvedValue({ rows: [] }));

      await TicketPlanningService.applyTemplate('ticket-1', 'architecture', 'user-1');

      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query).toHaveBeenCalledWith(
        'UPDATE tickets SET planning_status = \'template_selected\', template_schema = $1 WHERE id = $2',
        ['architecture', 'ticket-1']
      );
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('should apply specification template', async () => {
      const client = createMockClient(jest.fn().mockResolvedValue({ rows: [] }));

      await TicketPlanningService.applyTemplate('ticket-1', 'specification', 'user-1');

      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query).toHaveBeenCalledWith(
        'UPDATE tickets SET planning_status = \'template_selected\', template_schema = $1 WHERE id = $2',
        ['specification', 'ticket-1']
      );
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should apply technical template', async () => {
      const client = createMockClient(jest.fn().mockResolvedValue({ rows: [] }));

      await TicketPlanningService.applyTemplate('ticket-1', 'technical', 'user-1');

      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query).toHaveBeenCalledWith(
        'UPDATE tickets SET planning_status = \'template_selected\', template_schema = $1 WHERE id = $2',
        ['technical', 'ticket-1']
      );
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should apply simple template', async () => {
      const client = createMockClient(jest.fn().mockResolvedValue({ rows: [] }));

      await TicketPlanningService.applyTemplate('ticket-1', 'simple', 'user-1');

      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query).toHaveBeenCalledWith(
        'UPDATE tickets SET planning_status = \'template_selected\', template_schema = $1 WHERE id = $2',
        ['simple', 'ticket-1']
      );
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should insert planning files with correct content for architecture template', async () => {
      const client = createMockClient(jest.fn().mockResolvedValue({ rows: [] }));

      await TicketPlanningService.applyTemplate('ticket-1', 'architecture', 'user-1');

      const insertCalls = client.query.mock.calls.filter(
        call => call[0].includes('INSERT INTO ticket_planning')
      );
      expect(insertCalls.length).toBe(5);
      expect(insertCalls[0][0]).toContain('INSERT INTO ticket_planning');
      expect(insertCalls[0][1][0]).toBe('ticket-1');
      expect(insertCalls[0][1][1]).toBe('00_ARCHITECT_CHECKLIST.md');
      expect(insertCalls[0][1][2]).toContain('ARCHITECT_CHECKLIST');
      expect(insertCalls[0][1][3]).toBe('user-1');
    });

    it('should rollback on error', async () => {
      const client = createMockClient(
        jest.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockRejectedValueOnce(new Error('DB error'))
      );

      await expect(
        TicketPlanningService.applyTemplate('ticket-1', 'architecture', 'user-1')
      ).rejects.toThrow('DB error');

      const calls = client.query.mock.calls;
      const rollbackCall = calls.find(call => call[0] === 'ROLLBACK');
      expect(rollbackCall).toBeDefined();
      expect(calls.find(call => call[0] === 'COMMIT')).toBeUndefined();
    });

    it('should use custom template fallback when template name is not built-in', async () => {
      const Ticket = require('../models/ticket');
      const client = createMockClient(
        jest.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
      );

      Ticket.findById = jest.fn().mockResolvedValue({ id: 't1', project_id: 1, title: 'Test' });
      pool.query = jest.fn().mockResolvedValue({
        rows: [{ id: 1, project_id: 1, name: 'custom', file_definitions: JSON.stringify([{ key: 'custom.md', content: 'custom content' }]) }]
      });

      await TicketPlanningService.applyTemplate('ticket-1', 'my-custom-template', 'user-1');

      expect(Ticket.findById).toHaveBeenCalledWith('ticket-1');
      const updateCalls = client.query.mock.calls.filter(
        call => call[0].includes('UPDATE tickets')
      );
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][1]).toEqual(['my-custom-template', 'ticket-1']);
    });

    it('should throw NotFoundError for non-existent custom template', async () => {
      const Ticket = require('../models/ticket');
      Ticket.findById = jest.fn().mockResolvedValue({ id: 't1', project_id: 1, title: 'Test' });
      pool.query = jest.fn().mockResolvedValue({ rows: [] });
      createMockClient(jest.fn());

      await expect(
        TicketPlanningService.applyTemplate('ticket-1', 'nonexistent-template', 'user-1')
      ).rejects.toThrow('Custom template not found: nonexistent-template');
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
