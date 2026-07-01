const TemplateService = require('../services/TemplateService');
const { pool } = require('../db');

describe('TemplateService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getArchitectTemplate', () => {
    it('returns 5 required template file definitions', () => {
      const result = TemplateService.getArchitectTemplate();

      expect(result).toHaveLength(5);
      expect(result.map(f => f.key)).toEqual([
        '00_ARCHITECT_CHECKLIST.md',
        '01_ARCHITECT_REQUIREMENT.md',
        '02_ARCHITECT_DESIGN.md',
        '03_ARCHITECT_IMPLEMENTATION.md',
        '04_SPECIFICATION.md',
      ]);
      expect(result.every(f => f.required)).toBe(true);
    });
  });

  describe('getTechnicalTemplate', () => {
    it('returns 3 required template file definitions', () => {
      const result = TemplateService.getTechnicalTemplate();

      expect(result).toHaveLength(3);
      expect(result.map(f => f.key)).toEqual([
        '01_TECHNICAL_REQUIREMENT.md',
        '02_TECHNICAL_DESIGN.md',
        '03_TECHNICAL_IMPLEMENTATION.md',
      ]);
    });
  });

  describe('getSimpleTemplate', () => {
    it('returns 1 required template file definition', () => {
      const result = TemplateService.getSimpleTemplate();

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('01_SIMPLE_TASKS.md');
    });
  });

  describe('getSpecificationTemplate', () => {
    it('returns 1 required template file definition', () => {
      const result = TemplateService.getSpecificationTemplate();

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('04_SPECIFICATION.md');
    });
  });

  describe('getArchitectTemplateContent', () => {
    it('returns non-empty content for each known key', () => {
      const keys = ['00_ARCHITECT_CHECKLIST.md', '01_ARCHITECT_REQUIREMENT.md', '02_ARCHITECT_DESIGN.md', '03_ARCHITECT_IMPLEMENTATION.md', '04_SPECIFICATION.md'];

      keys.forEach(key => {
        const content = TemplateService.getArchitectTemplateContent(key);
        expect(content).toBeTruthy();
        expect(content.length).toBeGreaterThan(0);
        expect(content).toContain('# ');
      });
    });

    it('renders today\'s date in dynamic fields', () => {
      const content = TemplateService.getArchitectTemplateContent('00_ARCHITECT_CHECKLIST.md');
      const today = new Date().toISOString().split('T')[0];
      expect(content).toContain(today);
    });

    it('returns empty string for unknown key', () => {
      const content = TemplateService.getArchitectTemplateContent('unknown.md');
      expect(content).toBe('');
    });
  });

  describe('getTechnicalTemplateContent', () => {
    it('returns non-empty content for each known key', () => {
      const keys = ['01_TECHNICAL_REQUIREMENT.md', '02_TECHNICAL_DESIGN.md', '03_TECHNICAL_IMPLEMENTATION.md'];

      keys.forEach(key => {
        const content = TemplateService.getTechnicalTemplateContent(key);
        expect(content).toBeTruthy();
        expect(content.length).toBeGreaterThan(0);
      });
    });

    it('renders today\'s date in dynamic fields', () => {
      const content = TemplateService.getTechnicalTemplateContent('01_TECHNICAL_REQUIREMENT.md');
      const today = new Date().toISOString().split('T')[0];
      expect(content).toContain(today);
    });

    it('returns empty string for unknown key', () => {
      const content = TemplateService.getTechnicalTemplateContent('unknown.md');
      expect(content).toBe('');
    });
  });

  describe('getSimpleTemplateContent', () => {
    it('returns non-empty content for known key', () => {
      const content = TemplateService.getSimpleTemplateContent('01_SIMPLE_TASKS.md');
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('Task List');
    });

    it('renders today\'s date in dynamic fields', () => {
      const content = TemplateService.getSimpleTemplateContent('01_SIMPLE_TASKS.md');
      const today = new Date().toISOString().split('T')[0];
      expect(content).toContain(today);
    });

    it('returns empty string for unknown key', () => {
      const content = TemplateService.getSimpleTemplateContent('unknown.md');
      expect(content).toBe('');
    });
  });

  describe('getSpecificationTemplateContent', () => {
    it('returns non-empty content for known key', () => {
      const content = TemplateService.getSpecificationTemplateContent('04_SPECIFICATION.md');
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('Model Execution Spec');
    });

    it('returns empty string for unknown key', () => {
      const content = TemplateService.getSpecificationTemplateContent('unknown.md');
      expect(content).toBe('');
    });
  });

  describe('list', () => {
    it('queries templates with LEFT JOIN for creator name', async () => {
      const mockRows = [{ id: 't1', name: 'Template 1', created_by_name: 'Admin' }];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await TemplateService.list('proj-1', 'user-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN users u ON pt.created_by = u.id'),
        ['proj-1']
      );
      expect(result).toEqual(mockRows);
    });
  });

  describe('create', () => {
    it('creates template with JSON.stringify for file_definitions', async () => {
      const mockRow = { id: 't1', name: 'New Template' };
      const fileDefs = [{ key: 'test.md', content: 'content' }];
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await TemplateService.create('proj-1', 'New Template', 'desc', fileDefs, 'user-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO project_templates'),
        ['proj-1', 'New Template', 'desc', JSON.stringify(fileDefs), 'user-1']
      );
      expect(result).toEqual(mockRow);
    });

    it('passes null for description when omitted', async () => {
      const mockRow = { id: 't1' };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      await TemplateService.create('proj-1', 'No Desc', null, [], 'user-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([null])
      );
    });
  });

  describe('apply', () => {
    it('throws NotFoundError for missing template', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(TemplateService.apply('t1', 'missing', 'user-1')).rejects.toThrow('Template not found');
    });

    it('applies template files in transaction', async () => {
      const mockTemplate = { id: 't1', file_definitions: JSON.stringify([{ key: 'a.md', content: 'ca' }, { key: 'b.md', content: 'cb' }]), name: 'Test' };
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null) // BEGIN
          .mockResolvedValueOnce(null) // INSERT a.md
          .mockResolvedValueOnce(null) // INSERT b.md
          .mockResolvedValueOnce(null) // UPDATE tickets
          .mockResolvedValueOnce(null), // COMMIT
        release: jest.fn(),
      };
      pool.query.mockResolvedValueOnce({ rows: [mockTemplate] });
      pool.connect.mockResolvedValueOnce(mockClient);

      const result = await TemplateService.apply('ticket-1', 't1', 'user-1');

      expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockClient.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO ticket_planning'),
        ['ticket-1', 'a.md', 'ca', 'user-1']
      );
      expect(mockClient.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO ticket_planning'),
        ['ticket-1', 'b.md', 'cb', 'user-1']
      );
      expect(mockClient.query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE tickets'), ['Test', 'ticket-1']);
      expect(mockClient.query).toHaveBeenNthCalledWith(5, 'COMMIT');
      expect(result).toEqual([{ key: 'a.md', content: 'ca' }, { key: 'b.md', content: 'cb' }]);
    });

    it('rolls back on error', async () => {
      const mockTemplate = { id: 't1', file_definitions: JSON.stringify([{ key: 'a.md', content: 'ca' }]), name: 'Test' };
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null) // BEGIN
          .mockRejectedValueOnce(new Error('DB error')), // INSERT fails
        release: jest.fn(),
      };
      pool.query.mockResolvedValueOnce({ rows: [mockTemplate] });
      pool.connect.mockResolvedValueOnce(mockClient);

      await expect(TemplateService.apply('ticket-1', 't1', 'user-1')).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('delete', () => {
    it('deletes template with ownership guard', async () => {
      const mockRow = { id: 't1', name: 'Deleted' };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await TemplateService.delete('t1', 'user-1');

      expect(pool.query).toHaveBeenCalledWith(
        'DELETE FROM project_templates WHERE id = $1 AND created_by = $2 RETURNING *',
        ['t1', 'user-1']
      );
      expect(result).toEqual(mockRow);
    });

    it('returns undefined when not owned by user', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await TemplateService.delete('t1', 'other-user');

      expect(result).toBeUndefined();
    });
  });
});
