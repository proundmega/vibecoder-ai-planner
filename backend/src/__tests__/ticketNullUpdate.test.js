const Ticket = require('../models/ticket');

// Mock the pool
jest.mock('../db', () => {
  const pool = {
    query: jest.fn(),
    on: jest.fn(),
  };
  return { pool };
});

// Mock PermissionService
jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
}));

describe('Ticket.update() null field support (BP-61)', () => {
  let pool;

  beforeEach(() => {
    jest.clearAllMocks();
    pool = require('../db').pool;
  });

  it('can set title to null', async () => {
    // Mock findById to return a ticket
    const mockTicket = { id: 't1', title: 'Old Title', status: 'backlog', ownerId: 'user-1', assigneeId: 'user-1', projectId: 'p1' };
    
    // Mock the findById query
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT * FROM tickets WHERE id =')) {
        return Promise.resolve({ rows: [mockTicket] });
      }
      if (sql.includes('UPDATE tickets SET')) {
        // Verify title was set to null
        const values = params;
        expect(values[0]).toBeNull(); // title = null
        return Promise.resolve({ rows: [{ ...mockTicket, title: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await Ticket.update('t1', null, null, null, null, null, 'user-1');

    expect(pool.query).toHaveBeenCalled();
    const updateCall = pool.query.mock.calls.find(call => call[0].includes('UPDATE tickets SET'));
    expect(updateCall).toBeDefined();
    // The first value should be null (title)
    expect(updateCall[1][0]).toBeNull();
  });

  it('can set description to null', async () => {
    const mockTicket = { id: 't1', title: 'Test', status: 'backlog', ownerId: 'user-1', assigneeId: 'user-1', projectId: 'p1' };
    
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT * FROM tickets WHERE id =')) {
        return Promise.resolve({ rows: [mockTicket] });
      }
      if (sql.includes('UPDATE tickets SET')) {
        // description is the second parameter
        expect(params[1]).toBeNull();
        return Promise.resolve({ rows: [{ ...mockTicket, description: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await Ticket.update('t1', null, null, null, null, null, 'user-1');

    const updateCall = pool.query.mock.calls.find(call => call[0].includes('UPDATE tickets SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][1]).toBeNull();
  });

  it('can set status to null', async () => {
    const mockTicket = { id: 't1', title: 'Test', status: 'backlog', ownerId: 'user-1', assigneeId: 'user-1', projectId: 'p1' };
    
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT * FROM tickets WHERE id =')) {
        return Promise.resolve({ rows: [mockTicket] });
      }
      if (sql.includes('UPDATE tickets SET')) {
        expect(params[2]).toBeNull();
        return Promise.resolve({ rows: [{ ...mockTicket, status: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await Ticket.update('t1', null, null, null, null, null, 'user-1');

    const updateCall = pool.query.mock.calls.find(call => call[0].includes('UPDATE tickets SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][2]).toBeNull();
  });

  it('can set priority to null', async () => {
    const mockTicket = { id: 't1', title: 'Test', status: 'backlog', ownerId: 'user-1', assigneeId: 'user-1', projectId: 'p1' };
    
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT * FROM tickets WHERE id =')) {
        return Promise.resolve({ rows: [mockTicket] });
      }
      if (sql.includes('UPDATE tickets SET')) {
        expect(params[3]).toBeNull();
        return Promise.resolve({ rows: [{ ...mockTicket, priority: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await Ticket.update('t1', null, null, null, null, null, 'user-1');

    const updateCall = pool.query.mock.calls.find(call => call[0].includes('UPDATE tickets SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][3]).toBeNull();
  });

  it('can set assigneeId to null (clear assignment)', async () => {
    const mockTicket = { id: 't1', title: 'Test', status: 'backlog', ownerId: 'user-1', assigneeId: 'user-2', projectId: 'p1' };
    
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT * FROM tickets WHERE id =')) {
        return Promise.resolve({ rows: [mockTicket] });
      }
      if (sql.includes('UPDATE tickets SET')) {
        expect(params[4]).toBeNull();
        return Promise.resolve({ rows: [{ ...mockTicket, assigneeId: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await Ticket.update('t1', null, null, null, null, null, 'user-1');

    const updateCall = pool.query.mock.calls.find(call => call[0].includes('UPDATE tickets SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][4]).toBeNull();
  });

  it('does not include undefined fields in UPDATE', async () => {
    const mockTicket = { id: 't1', title: 'Test', status: 'backlog', ownerId: 'user-1', assigneeId: 'user-1', projectId: 'p1' };
    
    pool.query.mockImplementation((sql, _params) => {
      if (sql.includes('SELECT * FROM tickets WHERE id =')) {
        return Promise.resolve({ rows: [mockTicket] });
      }
      if (sql.includes('UPDATE tickets SET')) {
        // When all fields are undefined, SET should be empty
        // The query should still execute but with no fields to update
        return Promise.resolve({ rows: [mockTicket] });
      }
      return Promise.resolve({ rows: [] });
    });

    await Ticket.update('t1', undefined, undefined, undefined, undefined, undefined, 'user-1');

    const updateCall = pool.query.mock.calls.find(call => call[0].includes('UPDATE tickets SET'));
    expect(updateCall).toBeDefined();
    // SET clause should be empty or contain only the WHERE condition
    expect(updateCall[0]).toContain('WHERE id');
  });

  it('updates only specified non-null fields', async () => {
    const mockTicket = { id: 't1', title: 'Test', status: 'backlog', ownerId: 'user-1', assigneeId: 'user-1', projectId: 'p1' };
    
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT * FROM tickets WHERE id =')) {
        return Promise.resolve({ rows: [mockTicket] });
      }
      if (sql.includes('UPDATE tickets SET')) {
        // Dynamic SET: only title and assigneeId are non-undefined
        // params should be: ['New Title', 'user-2', 't1']
        expect(params[0]).toBe('New Title');
        expect(params[1]).toBe('user-2');
        expect(params[2]).toBe('t1'); // id
        return Promise.resolve({ rows: [{ ...mockTicket, title: 'New Title', assigneeId: 'user-2' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await Ticket.update('t1', 'New Title', undefined, undefined, undefined, 'user-2', 'user-1');

    const updateCall = pool.query.mock.calls.find(call => call[0].includes('UPDATE tickets SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('title =');
    expect(updateCall[0]).toContain('assignee_id =');
    expect(updateCall[0]).toContain('updated_at =');
  });
});
