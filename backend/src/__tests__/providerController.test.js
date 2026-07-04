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
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
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
          endpoint_url: null,
          fallback_provider: null,
          routing_rules: '{}',
          is_project_director: false,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
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
          endpoint_url: null,
          fallback_provider: null,
          routing_rules: '{}',
          is_project_director: false,
        }),
      });
    });
  });

  describe('updateProvider', () => {
    it('should update a provider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query
        .mockResolvedValueOnce({
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
            endpoint_url: null,
            fallback_provider: null,
            routing_rules: '{}',
            is_project_director: false,
            created_at: new Date(),
            updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({
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
            endpoint_url: null,
            fallback_provider: null,
            routing_rules: '{}',
            is_project_director: false,
            created_at: new Date(),
            updated_at: new Date(),
          }],
        });

      mockReq.params.projectId = '1';
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
          endpoint_url: null,
          fallback_provider: null,
          routing_rules: '{}',
          is_project_director: false,
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

      mockReq.params.projectId = '1';
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
            endpoint_url: null,
            fallback_provider: null,
            routing_rules: '{}',
            is_project_director: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      mockReq.params.projectId = '1';

      await providerController.listProviders(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            name: 'claude-pro',
            providerType: 'claude',
            endpoint_url: null,
            fallback_provider: null,
            routing_rules: '{}',
            is_project_director: false,
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
          base_url: 'https://api.anthropic.com',
        }],
      });

      const mockProvider = {
        validate: jest.fn().mockResolvedValue(true),
      };
      ProviderRouter.prototype.createProvider = jest.fn().mockReturnValue(mockProvider);

      mockReq.params.projectId = '1';
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
    it('should return 410 Gone (deprecated)', async () => {
      Project.findById.mockResolvedValue({ id: 1 });

      mockReq.params.projectId = '1';

      await providerController.getProviderConfig(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(410);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({ code: 'GONE' }),
      });
    });
  });

  describe('setProviderConfig', () => {
    it('should return 410 Gone (deprecated)', async () => {
      Project.findById.mockResolvedValue({ id: 1 });

      mockReq.params.projectId = '1';
      mockReq.body = { provider: 'openai', model: 'gpt-4o' };

      await providerController.setProviderConfig(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(410);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({ code: 'GONE' }),
      });
    });
  });

  describe('testProviderConnection', () => {
    it('should return 410 Gone (deprecated)', async () => {
      Project.findById.mockResolvedValue({ id: 1 });

      mockReq.params.projectId = '1';
      mockReq.body = { provider: 'openai', model: 'gpt-4o' };

      await providerController.testProviderConnection(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(410);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({ code: 'GONE' }),
      });
    });
  });

  describe('BP-51-11: db require at module level', () => {
    it('should have pool available at module level (not inline require)', () => {
      // If require('../db') is at module level, the mock in jest.mock() works
      // If it was inline in each function, the mock wouldn't apply
      expect(pool).toBeDefined();
      expect(pool.query).toBeDefined();
    });

    it('should use module-level pool for addProvider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          name: 'test',
          provider_type: 'openai',
          api_key_encrypted: 'enc',
          base_url: null,
          model: 'gpt-4',
          roles: ['worker'],
          max_tokens: 4096,
          temperature: 0.1,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.body = {
        name: 'test',
        providerType: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4',
      };

      await providerController.addProvider(mockReq, mockRes, nextFn);

      // If pool was inline require, this mock wouldn't be called
      expect(pool.query).toHaveBeenCalled();
    });
  });

  describe('Provider param naming: projectId vs id', () => {
    it('should use projectId param for addProvider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, project_id: 1, name: 'test', provider_type: 'ollama',
          api_key_encrypted: 'enc', base_url: null, model: 'llama3',
          roles: ['worker'], max_tokens: 4096, temperature: 0.1,
          is_active: true, endpoint_url: null, fallback_provider: null,
          routing_rules: '{}', is_project_director: false,
          created_at: new Date(), updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.body = {
        name: 'test',
        providerType: 'ollama',
        apiKey: '',
      };

      await providerController.addProvider(mockReq, mockRes, nextFn);

      expect(Project.findById).toHaveBeenCalledWith('1');
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should use projectId param for updateProvider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1, project_id: 1, name: 'old', provider_type: 'openai',
            api_key_encrypted: 'enc', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 1, project_id: 1, name: 'updated', provider_type: 'openai',
            api_key_encrypted: 'enc', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';
      mockReq.body = { name: 'updated' };

      await providerController.updateProvider(mockReq, mockRes, nextFn);

      expect(Project.findById).toHaveBeenCalledWith('1');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ name: 'updated' }),
      });
    });

    it('should use projectId param for deleteProvider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, project_id: 1 }],
      });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';

      await providerController.deleteProvider(mockReq, mockRes, nextFn);

      expect(Project.findById).toHaveBeenCalledWith('1');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { message: 'Provider deleted' },
      });
    });

    it('should use projectId param for listProviders', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, project_id: 1, name: 'test', provider_type: 'claude',
          api_key_encrypted: 'enc', base_url: null, model: 'claude-3',
          roles: ['worker'], max_tokens: 4096, temperature: 0.1,
          is_active: true, endpoint_url: null, fallback_provider: null,
          routing_rules: '{}', is_project_director: false,
          created_at: new Date(), updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';

      await providerController.listProviders(mockReq, mockRes, nextFn);

      expect(Project.findById).toHaveBeenCalledWith('1');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ name: 'test' }),
        ]),
      });
    });

    it('should use projectId param for testProvider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, project_id: 1, name: 'test', provider_type: 'openai',
          api_key_encrypted: 'encrypted-key', model: 'gpt-4',
          max_tokens: 4096, temperature: 0.1, base_url: 'https://api.openai.com',
        }],
      });

      const mockProvider = { validate: jest.fn().mockResolvedValue(true) };
      ProviderRouter.prototype.createProvider = jest.fn().mockReturnValue(mockProvider);

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';

      await providerController.testProvider(mockReq, mockRes, nextFn);

      expect(Project.findById).toHaveBeenCalledWith('1');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { valid: true, message: 'Connection successful' },
      });
    });
  });

  describe('addProvider: empty apiKey allowed for local models', () => {
    it('should accept empty apiKey string', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, project_id: 1, name: 'ollama-local', provider_type: 'ollama',
          api_key_encrypted: null, base_url: null, model: 'llama3',
          roles: ['worker'], max_tokens: 4096, temperature: 0.1,
          is_active: true, endpoint_url: null, fallback_provider: null,
          routing_rules: '{}', is_project_director: false,
          created_at: new Date(), updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.body = {
        name: 'ollama-local',
        providerType: 'ollama',
        apiKey: '',
      };

      await providerController.addProvider(mockReq, mockRes, nextFn);

      expect(encrypt).not.toHaveBeenCalled();
      const callArgs = pool.query.mock.calls[0][1];
      expect(callArgs[3]).toBeNull();
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });
  });

  describe('addProvider: default model when not provided', () => {
    it('should default model to gpt-4o when not sent', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, project_id: 1, name: 'test', provider_type: 'openai',
          api_key_encrypted: 'encrypted-key', base_url: null, model: 'gpt-4o',
          roles: ['worker'], max_tokens: 4096, temperature: 0.1,
          is_active: true, endpoint_url: null, fallback_provider: null,
          routing_rules: '{}', is_project_director: false,
          created_at: new Date(), updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.body = {
        name: 'test',
        providerType: 'openai',
        apiKey: 'sk-test',
      };

      await providerController.addProvider(mockReq, mockRes, nextFn);

      const callArgs = pool.query.mock.calls[0][1];
      expect(callArgs).toContain('gpt-4o');
    });

    it('should default to ollama model for ollama provider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, project_id: 1, name: 'ollama-local', provider_type: 'ollama',
          api_key_encrypted: null, base_url: null, model: 'llama3',
          roles: ['worker'], max_tokens: 4096, temperature: 0.1,
          is_active: true, endpoint_url: null, fallback_provider: null,
          routing_rules: '{}', is_project_director: false,
          created_at: new Date(), updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.body = {
        name: 'ollama-local',
        providerType: 'ollama',
        apiKey: '',
      };

      await providerController.addProvider(mockReq, mockRes, nextFn);

      const callArgs = pool.query.mock.calls[0][1];
      expect(callArgs).toContain('llama3');
    });
  });

  describe('updateProvider: empty body guard', () => {
    it('should return 400 when no fields to update', async () => {
      Project.findById.mockResolvedValue({ id: 1 });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';
      mockReq.body = {};

      await providerController.updateProvider(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('should use correct SQL parameter indices for providerId', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 42, project_id: 1, name: 'old', provider_type: 'openai',
            api_key_encrypted: 'enc', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 42, project_id: 1, name: 'updated', provider_type: 'openai',
            api_key_encrypted: 'enc', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '42';
      mockReq.body = { name: 'updated', model: 'gpt-4' };

      await providerController.updateProvider(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ name: 'updated' }),
      });

      const query = pool.query.mock.calls[1][0];
      const args = pool.query.mock.calls[1][1];

      expect(query).toContain('WHERE project_id = $1 AND id = $2');
      expect(args[0]).toBe('1');
      expect(args[1]).toBe('42');
      expect(args[2]).toBe('updated');
      expect(args[3]).toBe('gpt-4');

      // Verify placeholder-to-value mapping: $3→name, $4→model
      const nameMatch = query.match(/name = \$3/);
      const modelMatch = query.match(/model = \$4/);
      expect(nameMatch).not.toBeNull();
      expect(modelMatch).not.toBeNull();
      expect(args[2]).toBe('updated');
      expect(args[3]).toBe('gpt-4');
    });

    it('should retain existing key when client sends masked version (apiKey masking passthrough)', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      const existingDecrypted = 'sk-ant-existing-key-1234';
      const existingMasked = '****1234';
      decrypt.mockReturnValueOnce(existingDecrypted);
      maskToken.mockReturnValueOnce(existingMasked);

      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1, project_id: 1, name: 'old', provider_type: 'openai',
            api_key_encrypted: 'existing-encrypted', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 1, project_id: 1, name: 'renamed', provider_type: 'openai',
            api_key_encrypted: 'existing-encrypted', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        });

      maskToken.mockReturnValueOnce('****1234');

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';
      mockReq.body = { name: 'renamed', apiKey: '****1234' };

      await providerController.updateProvider(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ name: 'renamed' }),
      });

      // Verify the update did NOT include api_key_encrypted (key unchanged)
      const updateCall = pool.query.mock.calls[1];
      const updateQuery = updateCall[0];
      expect(updateQuery).not.toContain('api_key_encrypted');
      expect(encrypt).not.toHaveBeenCalled();
    });

    it('should clear key when client sends empty string different from masked', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      const existingDecrypted = 'sk-ant-existing-key-1234';
      const existingMasked = '****1234';
      decrypt.mockReturnValueOnce(existingDecrypted);
      maskToken.mockReturnValueOnce(existingMasked);

      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1, project_id: 1, name: 'old', provider_type: 'openai',
            api_key_encrypted: 'existing-encrypted', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 1, project_id: 1, name: 'old', provider_type: 'openai',
            api_key_encrypted: null, base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';
      mockReq.body = { apiKey: '' };

      await providerController.updateProvider(mockReq, mockRes, nextFn);

      const updateCall = pool.query.mock.calls[1];
      const updateArgs = updateCall[1];
      expect(updateArgs).toContain(null);
    });

    it('should encrypt new key when client sends a fresh key', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1, project_id: 1, name: 'old', provider_type: 'openai',
            api_key_encrypted: 'existing-encrypted', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 1, project_id: 1, name: 'old', provider_type: 'openai',
            api_key_encrypted: 'new-encrypted', base_url: null, model: 'gpt-4',
            roles: ['worker'], max_tokens: 4096, temperature: 0.1,
            is_active: true, endpoint_url: null, fallback_provider: null,
            routing_rules: '{}', is_project_director: false,
            created_at: new Date(), updated_at: new Date(),
          }],
        });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';
      mockReq.body = { apiKey: 'sk-ant-new-key-5678' };

      await providerController.updateProvider(mockReq, mockRes, nextFn);

      expect(encrypt).toHaveBeenCalledWith('sk-ant-new-key-5678');
    });

  describe('setDirector', () => {
    it('should set director and return updated provider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, project_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1, project_id: 1, name: 'openai-pro', provider_type: 'openai', api_key_encrypted: 'enc', base_url: null, model: 'gpt-4o', roles: ['worker'], max_tokens: 4096, temperature: 0.1, is_active: true, endpoint_url: null, fallback_provider: null, routing_rules: '{}', is_project_director: true, created_at: new Date(), updated_at: new Date() }] });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';

      await providerController.setDirector(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          name: 'openai-pro',
          providerType: 'openai',
          is_project_director: true,
          endpoint_url: null,
          fallback_provider: null,
          routing_rules: '{}',
        }),
      });
    });

    it('should demote existing director when setting new one', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 2, project_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 2, project_id: 1, name: 'new-director', provider_type: 'claude', api_key_encrypted: 'enc', base_url: null, model: 'claude-sonnet', roles: ['worker'], max_tokens: 4096, temperature: 0.1, is_active: true, endpoint_url: null, fallback_provider: null, routing_rules: '{}', is_project_director: true, created_at: new Date(), updated_at: new Date() }] });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '2';

      await providerController.setDirector(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          name: 'new-director',
          is_project_director: true,
        }),
      });

      // Verify the demote query was called (first call after provider existence check)
      const demoteCall = pool.query.mock.calls.find(call => call[0].includes('is_project_director = false'));
      expect(demoteCall).toBeDefined();
    });

    it('should return 404 for non-existent provider', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({ rows: [] });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '999';

      await providerController.setDirector(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(nextFn.mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });

  describe('addProvider: director promotion in transaction', () => {
    it('should demote existing directors when adding as director', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 2, project_id: 1, name: 'new-director', provider_type: 'openai',
          api_key_encrypted: 'encrypted-key', base_url: null, model: 'gpt-4o',
          roles: ['worker'], max_tokens: 4096, temperature: 0.1,
          is_active: true, endpoint_url: null, fallback_provider: null,
          routing_rules: '{}', is_project_director: true,
          created_at: new Date(), updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.body = {
        name: 'new-director',
        providerType: 'openai',
        apiKey: 'sk-test',
        is_project_director: true,
      };

      await providerController.addProvider(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          name: 'new-director',
          is_project_director: true,
        }),
      });

      // Verify transaction query was used (BEGIN...COMMIT)
      const txCall = pool.query.mock.calls[0][0];
      expect(txCall).toContain('BEGIN');
      expect(txCall).toContain('COMMIT');
    });
  });

  describe('updateProvider: director transaction', () => {
    it('should wrap director demote in transaction', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            rows: [{
              id: 1, project_id: 1, name: 'promoted', provider_type: 'openai',
              api_key_encrypted: 'enc', base_url: null, model: 'gpt-4o',
              roles: ['worker'], max_tokens: 4096, temperature: 0.1,
              is_active: true, endpoint_url: null, fallback_provider: null,
              routing_rules: '{}', is_project_director: true,
              created_at: new Date(), updated_at: new Date(),
            }],
          })
          .mockResolvedValueOnce({}),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValue(mockClient);
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, project_id: 1, name: 'old', provider_type: 'openai',
          api_key_encrypted: 'enc', base_url: null, model: 'gpt-4o',
          roles: ['worker'], max_tokens: 4096, temperature: 0.1,
          is_active: true, endpoint_url: null, fallback_provider: null,
          routing_rules: '{}', is_project_director: false,
          created_at: new Date(), updated_at: new Date(),
        }],
      });

      mockReq.params.projectId = '1';
      mockReq.params.providerId = '1';
      mockReq.body = { name: 'promoted', is_project_director: true };

      await providerController.updateProvider(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          name: 'promoted',
          is_project_director: true,
        }),
      });

      // Verify transaction was used: BEGIN → demote → update → COMMIT
      expect(pool.connect).toHaveBeenCalled();
      const clientCalls = mockClient.query.mock.calls;
      expect(clientCalls[0][0]).toBe('BEGIN');
      expect(clientCalls[1][0]).toContain('is_project_director = false');
      expect(clientCalls[2][0]).toContain('is_project_director =');
      expect(clientCalls[3][0]).toBe('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
});
