// Mock db before any requires
jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

// Mock https module
jest.mock('https', () => ({
  request: jest.fn(),
}));

// Mock http module (for HTTP webhooks)
jest.mock('http', () => ({
  request: jest.fn(),
}));

const logger = require('../utils/logger');
const { pool } = require('../db');

describe('DeployService webhook HTTP warning (BP-58)', () => {
  let DeployService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete require.cache[require.resolve('../services/DeployService')];
    DeployService = require('../services/DeployService');
  });

  it('logs warning when webhook URL uses HTTP protocol', async () => {
    pool.query.mockImplementation((sql, _params) => {
      if (sql.includes('SELECT d.*, e.webhook_url')) {
        return Promise.resolve({
          rows: [{
            id: 'dep-1',
            webhook_url: 'http://example.com/webhook',
            environment_name: 'staging',
            ticket_id: 't1',
            rolled_back_at: null,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    // Mock http.request to simulate a failed request
    const http = require('http');
    http.request.mockImplementation((url, options, callback) => {
      const err = new Error('ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      callback(err);
      return { end: jest.fn() };
    });
    
    await DeployService.rollbackDeployment('dep-1').catch(() => {});
    
    // Check that logger.warn was called with HTTP warning
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Webhook sent over HTTP')
    );
  });

  it('does not log HTTP warning for HTTPS webhooks', async () => {
    pool.query.mockImplementation((sql, _params) => {
      if (sql.includes('SELECT d.*, e.webhook_url')) {
        return Promise.resolve({
          rows: [{
            id: 'dep-1',
            webhook_url: 'https://example.com/webhook',
            environment_name: 'production',
            ticket_id: 't1',
            rolled_back_at: null,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    // Mock https.request to simulate a failed request
    const https = require('https');
    https.request.mockImplementation((url, options, callback) => {
      const err = new Error('ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      callback(err);
      return { end: jest.fn() };
    });
    
    await DeployService.rollbackDeployment('dep-1').catch(() => {});
    
    // Should NOT have logged HTTP warning for HTTPS URL
    const httpWarnings = logger.warn.mock.calls.filter(
      call => call[0] && call[0].includes('Webhook sent over HTTP')
    );
    expect(httpWarnings.length).toBe(0);
  });
});
