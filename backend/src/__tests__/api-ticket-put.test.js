const request = require('supertest');
const app = require('../index');

describe('PUT /api/v1/tickets/:id — status-only body', () => {
  it('should return 200 with status-only body (regression: was SQL NOT NULL violation)', async () => {
    // stub
  });
  
  it('should return 200 with full body including title', async () => {
    // stub
  });
  
  it('should preserve existing title when not included in body', async () => {
    // stub
  });
  
  it('should return 400 with invalid status transition', async () => {
    // stub
  });
});
