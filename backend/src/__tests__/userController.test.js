const userController = require('../controllers/userController');
const UserService = require('../services/UserService');

jest.mock('../services/UserService');

describe('User Controller - toggleUserActive', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockReq = {
      params: {},
      body: {},
      user: { userId: 'admin-1', role: 'project_admin' },
    };
  });

  describe('toggleUserActive', () => {
    it('should toggle user active status with success wrapper', async () => {
      const user = { id: '2', name: 'Test User', is_active: false };
      UserService.toggleUserActive.mockResolvedValue(user);

      mockReq.params.id = '2';
      await userController.toggleUserActive(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: user,
      });
      expect(UserService.toggleUserActive).toHaveBeenCalledWith('2', 'admin-1');
    });

    it('should return 404 when user not found', async () => {
      UserService.toggleUserActive.mockResolvedValue(null);

      mockReq.params.id = '999';
      await userController.toggleUserActive(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
    });

    it('should pass error to next() when validation fails (self-toggle)', async () => {
      const error = new Error('Cannot toggle your own account');
      UserService.toggleUserActive.mockRejectedValue(error);

      mockReq.params.id = 'admin-1';
      mockReq.user.userId = 'admin-1';
      await userController.toggleUserActive(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalledWith(error);
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should pass error to next() for other errors', async () => {
      const error = new Error('Database error');
      UserService.toggleUserActive.mockRejectedValue(error);

      mockReq.params.id = '2';
      await userController.toggleUserActive(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalledWith(error);
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });
});
