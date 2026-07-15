const db = require('../db');

jest.mock('http', () => ({
  request: jest.fn(),
}));

jest.mock('https', () => ({
  request: jest.fn(),
}));

const http = require('http');
const https = require('https');

function createWebhookMock(statusCode = 200, delay = 0) {
  http.request.mockImplementation((url, opts, cb) => {
    const mockRes = {
      statusCode,
      on: jest.fn((event, handler) => {
        if (event === 'data') {
          if (delay > 0) setTimeout(() => handler(Buffer.from('{"ok":true}')), delay);
          else handler(Buffer.from('{"ok":true}'));
        }
        if (event === 'end') {
          if (delay > 0) setTimeout(() => handler(), delay);
          else handler();
        }
        return mockRes;
      }),
    };
    cb(mockRes);
    return {
      on: jest.fn((event, handler) => {
        if (event === 'error') handler(new Error('request error'));
        if (event === 'timeout') { req.destroy(); handler(new Error('Webhook timeout after 10s')); }
        return mockReq;
      }),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
  });
  https.request.mockImplementation(http.request.mock.instances[http.request.mock.instances.length - 1] || http.request);
}

describe('DeployService', () => {
  const pool = db.pool;
  let DeployService;

  beforeEach(() => {
    jest.clearAllMocks();
    http.request.mockReset();
    https.request.mockReset();
    pool.query.mockReset();
    createWebhookMock(200);
    DeployService = require('../services/DeployService');
  });

  describe('createEnvironment', () => {
    it('creates environment with default branch pattern', async () => {
      const mockRow = { id: 'e1', project_id: 1, name: 'staging', webhook_url: 'https://hooks.example.com', branch_pattern: '*' };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await DeployService.createEnvironment(1, 'staging', 'https://hooks.example.com');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO environments'),
        [1, 'staging', 'https://hooks.example.com', '*']
      );
      expect(result).toEqual(mockRow);
    });

    it('creates environment with custom branch pattern', async () => {
      const mockRow = { id: 'e1', branch_pattern: 'main' };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      await DeployService.createEnvironment(1, 'staging', 'https://hooks.example.com', 'main');

      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [1, 'staging', 'https://hooks.example.com', 'main']
      );
    });
  });

  describe('listEnvironments', () => {
    it('returns active environments ordered by name', async () => {
      const mockRows = [{ id: 'e1', name: 'dev', is_active: true }];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await DeployService.listEnvironments(1);

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM environments WHERE project_id = $1 AND is_active = TRUE ORDER BY name',
        [1]
      );
      expect(result).toEqual(mockRows);
    });
  });

  describe('deleteEnvironment', () => {
    it('soft-deletes by setting is_active=false', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await DeployService.deleteEnvironment('e1');

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE environments SET is_active = FALSE WHERE id = $1',
        ['e1']
      );
    });

    it('throws when environment not found', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });

      await expect(DeployService.deleteEnvironment('nonexistent')).rejects.toThrow('Environment not found');
    });
  });

  describe('triggerDeploy', () => {
    it('throws when ticket not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(DeployService.triggerDeploy('missing', 'e1')).rejects.toThrow('Ticket not found');
    });

    it('throws when ticket is not in done phase', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'in_progress', phase: 'in_progress' }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(DeployService.triggerDeploy('t1', 'e1')).rejects.toThrow('Only tickets in done phase can be deployed');
    });

    it('throws when environment not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'done', phase: 'done', commit_sha: 'abc123', title: 'Test', branch_name: 'main', project_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(DeployService.triggerDeploy('t1', 'nonexistent')).rejects.toThrow('Environment not found');
    });

    it('triggers deploy with webhook on success', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'done', phase: 'done', commit_sha: 'abc123', title: 'Test', branch_name: 'main', project_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'e1', name: 'staging', webhook_url: 'https://hooks.example.com' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'd1', ticket_id: 't1', environment_id: 'e1' }] })
        .mockResolvedValueOnce(null);

      const result = await DeployService.triggerDeploy('t1', 'e1');

      expect(result).toEqual({ id: 'd1', ticket_id: 't1', environment_id: 'e1', environment_name: 'staging' });
      expect(pool.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO deployments'),
        ['t1', 'e1', 'abc123']
      );
      expect(pool.query).toHaveBeenNthCalledWith(4, "UPDATE deployments SET status = 'triggered' WHERE id = $1", ['d1']);
    });

    it('sets status=failed on webhook error', async () => {
      http.request.mockImplementation((_url, _opts, _cb) => {
        const mockReq = {
          on: jest.fn((event, handler) => {
            if (event === 'error') { handler(new Error('webhook failed')); }
            if (event === 'timeout') { mockReq.destroy(); handler(new Error('Webhook timeout after 10s')); }
            return mockReq;
          }),
          write: jest.fn(),
          end: jest.fn(),
          destroy: jest.fn(),
        };
        return mockReq;
      });

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'done', phase: 'done', commit_sha: null, title: 'Test', branch_name: 'main', project_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'e1', name: 'staging', webhook_url: 'https://hooks.example.com' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'd1', ticket_id: 't1', environment_id: 'e1' }] });

      await DeployService.triggerDeploy('t1', 'e1');

      expect(pool.query).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining("UPDATE deployments SET status = 'failed'"),
        expect.arrayContaining(['d1'])
      );
    });

    it('uses null commit_sha when not present', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'done', phase: 'done', title: 'Test', branch_name: 'main', project_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'e1', name: 'staging', webhook_url: null }] })
        .mockResolvedValueOnce({ rows: [{ id: 'd1' }] })
        .mockResolvedValueOnce(null);

      await DeployService.triggerDeploy('t1', 'e1');

      expect(pool.query).toHaveBeenNthCalledWith(
        3,
        expect.any(String),
        ['t1', 'e1', null]
      );
    });
  });

  describe('rollbackDeployment', () => {
    it('throws when deployment not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(DeployService.rollbackDeployment('missing')).rejects.toThrow('Deployment not found');
    });

    it('throws when already rolled back', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'd1', rolled_back_at: new Date(), webhook_url: 'https://hooks.example.com', name: 'staging', ticket_id: 't1' }],
      });

      await expect(DeployService.rollbackDeployment('d1')).rejects.toThrow('Deployment already rolled back');
    });

    it('rolls back by sending webhook and setting rolled_back_at', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'd1', rolled_back_at: null, webhook_url: 'https://hooks.example.com', name: 'staging', ticket_id: 't1' }],
      });

      await DeployService.rollbackDeployment('d1');

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE deployments SET rolled_back_at = NOW() WHERE id = $1',
        ['d1']
      );
    });
  });

  describe('getDeploymentHistory', () => {
    it('returns deployments for ticket ordered by deployed_at DESC', async () => {
      const mockRows = [{ id: 'd1', environment_name: 'staging', deployed_at: new Date() }];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await DeployService.getDeploymentHistory('t1', 10, 0);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT d.*, e.name as environment_name'),
        ['t1', 10, 0]
      );
      expect(result).toEqual(mockRows);
    });

    it('supports limit and offset pagination', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await DeployService.getDeploymentHistory('t1', 5, 10);

      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['t1', 5, 10]
      );
    });
  });

  describe('updateDeploymentStatus', () => {
    it('updates deployment status', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'completed' }] });

      const result = await DeployService.updateDeploymentStatus('d1', 'completed');

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE deployments SET status = $1 WHERE id = $2 RETURNING *',
        ['completed', 'd1']
      );
      expect(result).toEqual({ id: 'd1', status: 'completed' });
    });

    it('throws when deployment not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(DeployService.updateDeploymentStatus('missing', 'completed')).rejects.toThrow('Deployment not found');
    });
  });
});
