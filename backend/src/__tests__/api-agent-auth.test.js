const request = require('supertest');
const app = require('../index');

describe('GET /api/v1/tickets/:id/planning — agent auth', () => {
  it('should return 200 with X-API-Key header (regression: was 401 Missing authentication token)', async () => {
    // stub
  });
  
  it('should return 200 with Bearer JWT token', async () => {
    // stub
  });
  
  it('should return 401 without any auth', async () => {
    // stub
  });
});

describe('POST /api/v1/agents-status/:id/heartbeat — agent auth', () => {
  it('should return 200 with valid X-API-Key (regression: was 403 Invalid API key for this agent)', async () => {
    // stub
  });
  
  it('should return 401 with invalid X-API-Key', async () => {
    // stub
  });
});
