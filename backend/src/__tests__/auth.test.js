const request = require('supertest');
const app = require('../index');

describe('Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should have login endpoint', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'pass' });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token');
  });

  it('should have register endpoint', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 't@t.com', password: 'pass' });
    
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('token');
  });

  it('should login with valid credentials', async () => {
    const UserService = require('../services/UserService');
    const result = await UserService.authenticate('test@test.com', 'pass');
    expect(result).toBeDefined();
    expect(result.id).toBe('1');
  });

  it('should return 401 for invalid login credentials', async () => {
    const UserService = require('../services/UserService');
    UserService.authenticate.mockRejectedValue(new Error('Invalid credentials'));
    
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'wrong' });
    
    expect(response.status).toBe(401);
  });

  it('should return 400 for email already registered', async () => {
    const UserService = require('../services/UserService');
    UserService.register.mockRejectedValue(new Error('Email already registered'));
    
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'existing@test.com', password: 'pass' });
    
    expect(response.status).toBe(400);
  });

  it('should have health endpoint', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });

  it('should have API version endpoint', async () => {
    const response = await request(app).get('/api/version');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('version');
  });
});
