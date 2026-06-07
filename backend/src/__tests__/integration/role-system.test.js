const { Pool } = require('pg');
const app = require('../../index');
const request = require('supertest');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

describe('Role System Integration', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
  });

  async function cleanTable(table) {
    await pool.query(`DELETE FROM ${table} CASCADE`);
  }

  afterEach(async () => {
    try { await cleanTable('approval_requests'); } catch (e) {}
    try { await cleanTable('tickets'); } catch (e) {}
    try { await cleanTable('projects'); } catch (e) {}
    try { await cleanTable('users'); } catch (e) {}
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Users API - User Management', () => {
    let adminToken;
    let adminId;

    beforeEach(async () => {
      const email = `admin_${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin User', email, password: 'password123', role: 'project_admin' });
      adminToken = res.body.token;
      adminId = res.body.user.userId;
    });

    test('POST /api/users creates member user', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Member User', email: 'member@test.com', password: 'password123', role: 'member' });

      expect(res.status).toBe(201);
      expect(res.body.data.email).toBe('member@test.com');
      expect(res.body.data.role).toBe('member');
    });

    test('POST /api/users creates user role', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'AI User', email: 'aiuser@test.com', password: 'password123', role: 'user' });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe('user');
    });

    test('POST /api/users rejects missing fields', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Incomplete' });

      expect(res.status).toBe(400);
    });

    test('POST /api/users rejects super_admin role', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Super', email: 'super@test.com', password: 'password123', role: 'super_admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Validation');
    });

    test('PUT /api/users/:id updates user name', async () => {
      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Original', email: 'update@test.com', password: 'password123', role: 'member' });

      const res = await request(app)
        .put(`/api/users/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
    });

    test('PUT /api/users/:id cannot update own account', async () => {
      const res = await request(app)
        .put(`/api/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Self Update' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Cannot update your own account');
    });

    test('PUT /api/users/:id returns 404 for unknown user', async () => {
      const res = await request(app)
        .put('/api/users/999999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Ghost' });

      expect(res.status).toBe(404);
    });

    test('PATCH /api/users/:id/toggle-active deactivates user', async () => {
      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Toggle Me', email: 'toggle@test.com', password: 'password123', role: 'member' });

      const res = await request(app)
        .patch(`/api/users/${createRes.body.data.id}/toggle-active`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
    });

    test('PATCH /api/users/:id/toggle-active reactivates user', async () => {
      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Reactive Me', email: 'reactive@test.com', password: 'password123', role: 'member' });

      await request(app)
        .patch(`/api/users/${createRes.body.data.id}/toggle-active`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .patch(`/api/users/${createRes.body.data.id}/toggle-active`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
    });

    test('PATCH /api/users/:id/toggle-active cannot toggle own account', async () => {
      const res = await request(app)
        .patch(`/api/users/${adminId}/toggle-active`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Cannot toggle your own account');
    });

    test('DELETE /api/users/:id deletes user', async () => {
      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Delete Me', email: 'delete@test.com', password: 'password123', role: 'member' });

      const res = await request(app)
        .delete(`/api/users/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('User deleted');
    });

    test('DELETE /api/users/:id cannot delete own account', async () => {
      const res = await request(app)
        .delete(`/api/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Cannot delete your own account');
    });

    test('GET /api/users lists users scoped by project_admin', async () => {
      await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'User A', email: 'usera@test.com', password: 'password123', role: 'member' });

      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.users)).toBe(true);
    });

    test('GET /api/users/super-admin requires super_admin role', async () => {
      const res = await request(app)
        .get('/api/users/super-admin')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });

    test('POST /api/users requires project_admin or member role', async () => {
      const adminRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email: `admin_req_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });
      const adminToken = adminRes.body.token;

      const userRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Regular User', email: `regular_${Date.now()}@test.com`, password: 'password123', role: 'user' });
      const userToken = (await request(app)
        .post('/api/auth/login')
        .send({ email: userRes.body.data.email, password: 'password123' })).body.token;

      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Another', email: 'another_req@test.com', password: 'password123', role: 'member' });

      expect(res.status).toBe(403);
    });
  });

  describe('Users API - Member creates user', () => {
    let memberToken;
    let memberUserId;

    beforeEach(async () => {
      const adminRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email: `admin2_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });
      const adminToken = adminRes.body.token;

      const memberRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Member', email: `member2_${Date.now()}@test.com`, password: 'password123', role: 'member' });
      
      memberToken = adminRes.body.token;
      memberUserId = adminRes.body.user.userId;

      // Re-login as member
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: memberRes.body.data.email, password: 'password123' });
      memberToken = loginRes.body.token;
    });

    test('member can create user role', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'AI Agent', email: `agent_${Date.now()}@test.com`, password: 'password123', role: 'user' });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe('user');
    });

    test('member cannot create member role', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Another Member', email: `another_${Date.now()}@test.com`, password: 'password123', role: 'member' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Members can only create user accounts');
    });

    test('member cannot create project_admin role', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Admin User', email: `admin3_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Members can only create user accounts');
    });
  });

  describe('Users API - Deactivated user', () => {
    test('deactivated user cannot login', async () => {
      const placeholderEmail = `deact_placeholder_${Date.now()}@test.com`;
      await request(app).post('/api/auth/register').send({
        name: 'Deactivated', email: placeholderEmail, password: 'password123',
      });

      const targetEmail = `deact_${Date.now()}@test.com`;
      const adminRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email: `admin4_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });
      const adminToken = adminRes.body.token;

      const userRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Deactivated User', email: targetEmail, password: 'password123', role: 'member' });

      await request(app)
        .patch(`/api/users/${userRes.body.data.id}/toggle-active`)
        .set('Authorization', `Bearer ${adminToken}`);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: targetEmail, password: 'password123' });

      expect(loginRes.status).toBe(401);
      expect(loginRes.body.error).toContain('deactivated');
    });

    test('deactivated user cannot access protected endpoints', async () => {
      const targetEmail = `deact2_${Date.now()}@test.com`;
      const placeholderEmail = `deact2_placeholder_${Date.now()}@test.com`;
      await request(app).post('/api/auth/register').send({
        name: 'Deactivated 2 placeholder', email: placeholderEmail, password: 'password123',
      });

      const adminRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email: `admin5_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });
      const adminToken = adminRes.body.token;

      const userRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Deactivated 2', email: targetEmail, password: 'password123', role: 'member' });
      const userId = userRes.body.data.id;

      await request(app)
        .patch(`/api/users/${userId}/toggle-active`)
        .set('Authorization', `Bearer ${adminToken}`);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: targetEmail, password: 'password123' });

      expect(loginRes.status).toBe(401);
      expect(loginRes.body.error).toContain('deactivated');
    });
  });

  describe('Approvals API', () => {
    let adminToken;
    let projectId;

    beforeEach(async () => {
      const email = `admin_${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email, password: 'password123', role: 'project_admin' });
      adminToken = res.body.token;

      const projRes = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Approval Project' });
      projectId = projRes.body.data.id;
    });

    test('GET /api/approvals requires super_admin role', async () => {
      const res = await request(app)
        .get('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });

    test('POST /api/approvals requires ticketId', async () => {
      const res = await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ticketId is required');
    });

    test('POST /api/approvals rejects ticket not in review', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Test Ticket', description: 'Test' });

      const res = await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('review status');
    });

    test('POST /api/approvals creates request for ticket in review', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Review Ticket', description: 'Test' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'review' });

      const res = await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      expect(res.status).toBe(201);
      expect(res.body.ticket_id).toBe(ticketRes.body.data.id);
      expect(res.body.status).toBe('pending');
    });

    test('GET /api/approvals/pending returns pending approvals', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Pending Ticket', description: 'Test' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'review' });

      await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      const res = await request(app)
        .get('/api/approvals/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.approvals)).toBe(true);
    });

    test('GET /api/approvals/ticket/:ticketId returns approvals', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Ticket Approvals', description: 'Test' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'review' });

      await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      const res = await request(app)
        .get(`/api/approvals/ticket/${ticketRes.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.approvals)).toBe(true);
    });

    test('POST /api/approvals/:id/approve transitions ticket to done', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Approve Ticket', description: 'Test' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'review' });

      const approvalRes = await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      const approveRes = await request(app)
        .post(`/api/approvals/${approvalRes.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.approval.status).toBe('approved');
    });

    test('POST /api/approvals/:id/reject rejects request', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Reject Ticket', description: 'Test' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'review' });

      const approvalRes = await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      const rejectRes = await request(app)
        .post(`/api/approvals/${approvalRes.body.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.approval.status).toBe('rejected');
    });

    test('POST /api/approvals/:id/approve rejects already approved', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Double Approve', description: 'Test' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'review' });

      const approvalRes = await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      await request(app)
        .post(`/api/approvals/${approvalRes.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .post(`/api/approvals/${approvalRes.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    test('POST /api/approvals/:id/approve rejects non-pending', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Non Pending', description: 'Test' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'review' });

      const approvalRes = await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      await request(app)
        .post(`/api/approvals/${approvalRes.body.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .post(`/api/approvals/${approvalRes.body.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    test('user role cannot approve/reject', async () => {
      const adminRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email: `admin_approve_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });
      const adminToken = adminRes.body.token;

      const userRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'User', email: `user_${Date.now()}@test.com`, password: 'password123', role: 'user' });
      const userToken = (await request(app)
        .post('/api/auth/login')
        .send({ email: userRes.body.data.email, password: 'password123' })).body.token;

      const res = await request(app)
        .post('/api/approvals/1/approve')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Ticket Delete - Role-Based Permissions', () => {
    let adminToken;
    let adminUserId;
    let projectId;
    let memberEmail;

    beforeEach(async () => {
      const email = `admin_${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email, password: 'password123', role: 'project_admin' });
      adminToken = res.body.token;
      adminUserId = res.body.user.userId;

      const projRes = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Ticket Delete Project' });
      projectId = projRes.body.data.id;

      memberEmail = `member_${Date.now()}@test.com`;
      await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Member', email: memberEmail, password: 'password123', role: 'member' });
    });

    test('admin can delete any ticket', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Admin Delete Ticket', description: 'Test' });

      const res = await request(app)
        .delete(`/api/projects/tickets/${ticketRes.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('member can delete tickets', async () => {
      const memberRes = await request(app)
        .post('/api/auth/login')
        .send({ email: memberEmail, password: 'password123' });
      const memberToken = memberRes.body.token;

      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Member Delete Ticket', description: 'Test' });

      const res = await request(app)
        .delete(`/api/projects/tickets/${ticketRes.body.data.id}`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
    });

    test('user role cannot delete others ticket', async () => {
      const adminRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email: `admin_del_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });
      const adminToken2 = adminRes.body.token;

      const userRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send({ name: 'User', email: `user_${Date.now()}@test.com`, password: 'password123', role: 'user' });
      const userToken = (await request(app)
        .post('/api/auth/login')
        .send({ email: userRes.body.data.email, password: 'password123' })).body.token;

      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken2}`)
        .send({ title: 'Owned Ticket', description: 'Test' });

      const res = await request(app)
        .delete(`/api/projects/tickets/${ticketRes.body.data.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    test('user role can delete own ticket', async () => {
      const adminRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email: `admin_own_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });
      const adminToken2 = adminRes.body.token;

      const userRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send({ name: 'User', email: `user_${Date.now()}@test.com`, password: 'password123', role: 'user' });
      const userToken = (await request(app)
        .post('/api/auth/login')
        .send({ email: userRes.body.data.email, password: 'password123' })).body.token;

      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ title: 'My Ticket', description: 'Test' });

      const res = await request(app)
        .delete(`/api/projects/tickets/${ticketRes.body.data.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
    });

    test('delete non-existent ticket returns 404', async () => {
      const res = await request(app)
        .delete('/api/projects/tickets/999999999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('Auth Middleware - requireRole', () => {
    test('GET /api/users/super-admin blocks non-super_admin', async () => {
      const email = `regular_${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Regular', email, password: 'password123' });

      const token = res.body.token;

      const accessRes = await request(app)
        .get('/api/users/super-admin')
        .set('Authorization', `Bearer ${token}`);

      expect(accessRes.status).toBe(403);
    });

    test('requireActiveUser blocks deactivated users on users endpoint', async () => {
      const targetEmail = `block_${Date.now()}@test.com`;
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Blocked User', email: targetEmail, password: 'password123',
      });
      const regToken = regRes.body.token;
      const userId = regRes.body.user.userId;

      const adminRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email: `admin6_${Date.now()}@test.com`, password: 'password123', role: 'project_admin' });
      const adminToken = adminRes.body.token;

      await request(app)
        .patch(`/api/users/${userId}/toggle-active`)
        .set('Authorization', `Bearer ${adminToken}`);

      const accessRes = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${regToken}`);

      expect(accessRes.status).toBe(403);
    });
  });

  describe('Approval - Duplicate Prevention', () => {
    let adminToken;
    let projectId;

    beforeEach(async () => {
      const email = `admin_${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Admin', email, password: 'password123', role: 'project_admin' });
      adminToken = res.body.token;

      const projRes = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Duplicate Project' });
      projectId = projRes.body.data.id;
    });

    test('cannot create duplicate pending approval for same ticket+requester', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Dup Ticket', description: 'Test' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'review' });

      await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      const res = await request(app)
        .post('/api/approvals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ticketId: ticketRes.body.data.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already pending');
    });
  });
});
