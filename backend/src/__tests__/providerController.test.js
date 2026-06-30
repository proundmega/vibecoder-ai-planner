const providerController = require('../controllers/providerController');
const ProviderRouter = require('../services/ProviderRouter');
const Project = require('../models/project');
const { encrypt, decrypt, maskToken } = require('../utils/crypto');

jest.mock('../services/ProviderRouter');
jest.mock('../models/project', () => ({
  findById: jest.fn(),
}));
jest.mock('../utils/crypto');
jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));

const { pool } = require('../db');

describe('Provider Controller', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    jest.clearAllMocks();
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockReq = {
      params: {},
      body: {},
      user: { userId: 'user-1', role: 'project_admin' },
    };
    encrypt.mockReturnValue('encrypted-key');
    decrypt.mockReturnValue('decrypted-key');
    maskToken.mockImplementation((token) => '****' + token.slice(-4));
  });

  describe('addProvider', () => {
    it('should add a provider with 201 status', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          name: 'claude-pro',
          provider_type: 'claude',
          api_key_encrypted: 'encrypted-key',
          base_url: null,
          model: 'claude-sonnet-4-20250514',
          roles: ['planner'],
          max_tokens: 4096,
          temperature: 0.1,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      mockReq.params.id = '1';
      mockReq.body = {
        name: 'claude-pro',
        providerType: 'claude',
        apiKey: 'sk-ant-1234',
        model: 'claude-sonnet-4-20250514',
        roles: ['planner'],
      };

      await providerController.addProvider(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          name: 'claude-pro',
          providerType: 'claude',
          model: 'claude-sonnet-4-20250514',
        }),
      });
    });
  });

  describe('updateProvider', () => {
    it('should update a provider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          name: 'claude-pro-updated',
          provider_type: 'claude',
          api_key_encrypted: 'encrypted-key',
          base_url: null,
          model: 'claude-3-opus-20240229',
          roles: ['planner', 'reviewer'],
          max_tokens: 8192,
          temperature: 0.2,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      mockReq.params.id = '1';
      mockReq.params.providerId = '1';
      mockReq.body = {
        name: 'claude-pro-updated',
        model: 'claude-3-opus-20240229',
        roles: ['planner', 'reviewer'],
        maxTokens: 8192,
        temperature: 0.2,
      };

      await providerController.updateProvider(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          name: 'claude-pro-updated',
          model: 'claude-3-opus-20240229',
        }),
      });
    });
  });

  describe('deleteProvider', () => {
    it('should delete a provider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, project_id: 1 }],
      });

      mockReq.params.id = '1';
      mockReq.params.providerId = '1';

      await providerController.deleteProvider(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { message: 'Provider deleted' },
      });
    });
  });

  describe('listProviders', () => {
    it('should list all providers for a project', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_id: 1,
            name: 'claude-pro',
            provider_type: 'claude',
            api_key_encrypted: 'encrypted-key',
            base_url: null,
            model: 'claude-sonnet-4-20250514',
            roles: ['planner'],
            max_tokens: 4096,
            temperature: 0.1,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      mockReq.params.id = '1';

      await providerController.listProviders(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            name: 'claude-pro',
            providerType: 'claude',
          }),
        ]),
      });
    });
  });

  describe('testProvider', () => {
    it('should test provider connection', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          name: 'claude-pro',
          provider_type: 'claude',
          api_key_encrypted: 'encrypted-key',
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          temperature: 0.1,
          base_url: null,
        }],
      });

      const mockProvider = {
        validate: jest.fn().mockResolvedValue(true),
      };
      ProviderRouter.prototype.createProvider = jest.fn().mockReturnValue(mockProvider);

      mockReq.params.id = '1';
      mockReq.params.providerId = '1';

      await providerController.testProvider(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: {
          valid: true,
          message: 'Connection successful',
        },
      });
    });
  });

  describe('getProviderConfig', () => {
    it('should return provider config with masked api_key', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          provider: 'openai',
          endpoint_url: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          api_key_encrypted: 'encrypted-key',
          fallback_provider: 'claude',
          routing_rules: {},
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';

      await providerController.getProviderConfig(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o',
          api_key: '****-key',
          endpoint_url: 'https://api.openai.com/v1',
          fallback_provider: 'claude',
        }),
      });
    });

    it('should return null api_key when not set', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          provider: 'openai',
          endpoint_url: null,
          model: 'gpt-4o',
          api_key_encrypted: null,
          fallback_provider: null,
          routing_rules: {},
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';

      await providerController.getProviderConfig(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          api_key: null,
        }),
      });
    });

    it('should return null when no config exists', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({ rows: [] });

      mockReq.params.projectId = '1';

      await providerController.getProviderConfig(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: null,
      });
    });
  });

  describe('setProviderConfig', () => {
    it('should store encrypted api_key with snake_case fields', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          provider: 'openai',
          endpoint_url: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          api_key_encrypted: 'encrypted-key',
          fallback_provider: null,
          routing_rules: {},
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.body = {
        provider: 'openai',
        model: 'gpt-4o',
        endpoint_url: 'https://api.openai.com/v1',
        api_key: 'sk-ant-1234',
        fallback_provider: null,
      };

      await providerController.setProviderConfig(mockReq, mockRes, nextFn);

      expect(encrypt).toHaveBeenCalledWith('sk-ant-1234');
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o',
          api_key: '****-key',
          endpoint_url: 'https://api.openai.com/v1',
        }),
      });
    });

    it('should handle empty api_key as null', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          provider: 'openai',
          endpoint_url: null,
          model: 'gpt-4o',
          api_key_encrypted: null,
          fallback_provider: null,
          routing_rules: {},
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.body = {
        provider: 'openai',
        model: 'gpt-4o',
        api_key: '',
      };

      await providerController.setProviderConfig(mockReq, mockRes, nextFn);

      expect(encrypt).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          api_key: null,
        }),
      });
    });

    it('should return 404 when project not found', async () => {
      Project.findById.mockResolvedValue(null);

      mockReq.params.projectId = '999';
      mockReq.body = { provider: 'openai', model: 'gpt-4o' };

      await providerController.setProviderConfig(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
    });
  });

  describe('testProviderConnection', () => {
    it('should test connection with snake_case api_key', async () => {
      Project.findById.mockResolvedValue({ id: 1 });

      const mockProvider = {
        validate: jest.fn().mockResolvedValue(true),
      };
      ProviderRouter.prototype.createProvider = jest.fn().mockReturnValue(mockProvider);

      mockReq.params.projectId = '1';
      mockReq.body = {
        provider: 'openai',
        model: 'gpt-4o',
        endpoint_url: 'https://api.openai.com/v1',
        api_key: 'sk-ant-1234',
      };

      await providerController.testProviderConnection(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: {
          valid: true,
          message: 'Connection successful',
        },
      });
    });
  });
});
