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

      const ticket = { id: 'ticket-1', planningStatus: 'in_progress', templateSchema: 'architect' };
      const result = await TicketPlanningService.getPlanningForTicket(ticket, 'user-1');

      expect(result.status).toBe('in_progress');
      expect(result.templateSchema).toBe('architect');
      expect(result.files).toHaveLength(2);
      expect(result.files[0].version).toBe(2);
    });
  });
});

describe('TemplateService', () => {
  describe('getArchitectTemplate', () => {
    it('should return 4 architect template files', () => {
      const files = TemplateService.getArchitectTemplate();
      expect(files).toHaveLength(4);
      expect(files[0].key).toBe('00_ARCHITECT_CHECKLIST.md');
      expect(files[1].key).toBe('01_ARCHITECT_REQUIREMENT.md');
      expect(files[2].key).toBe('02_ARCHITECT_DESIGN.md');
      expect(files[3].key).toBe('03_ARCHITECT_IMPLEMENTATION.md');
    });
  });

  describe('getArchitectTemplateContent', () => {
    it('should return content for 00_ARCHITECT_CHECKLIST.md', () => {
      const content = TemplateService.getArchitectTemplateContent('00_ARCHITECT_CHECKLIST.md');
      expect(content).toContain('ARCHITECT_CHECKLIST');
      expect(content).toContain('Pre-Implementation Checklist');
    });

    it('should return content for 01_ARCHITECT_REQUIREMENT.md', () => {
      const content = TemplateService.getArchitectTemplateContent('01_ARCHITECT_REQUIREMENT.md');
      expect(content).toContain('ARCHITECT_REQUIREMENT');
      expect(content).toContain('## Requirement');
    });

    it('should return content for 02_ARCHITECT_DESIGN.md', () => {
      const content = TemplateService.getArchitectTemplateContent('02_ARCHITECT_DESIGN.md');
      expect(content).toContain('ARCHITECT_DESIGN');
      expect(content).toContain('## Problem Statement');
    });

    it('should return content for 03_ARCHITECT_IMPLEMENTATION.md', () => {
      const content = TemplateService.getArchitectTemplateContent('03_ARCHITECT_IMPLEMENTATION.md');
      expect(content).toContain('ARCHITECT_IMPLEMENTATION');
      expect(content).toContain('## a) Purpose');
    });

    it('should return empty string for unknown file key', () => {
      const content = TemplateService.getArchitectTemplateContent('unknown.md');
      expect(content).toBe('');
    });
  });
});
