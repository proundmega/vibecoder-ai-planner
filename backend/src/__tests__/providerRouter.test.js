const ProviderRouter = require('../services/ProviderRouter');
const { decrypt } = require('../utils/crypto');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));
jest.mock('../utils/crypto');
jest.mock('../providers/claude');
jest.mock('../providers/openai');
jest.mock('../providers/generic');

const { pool } = require('../db');
const ClaudeProvider = require('../providers/claude');
const OpenAIProvider = require('../providers/openai');
const GenericProvider = require('../providers/generic');

describe('ProviderRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    decrypt.mockImplementation((text) => text.replace('encrypted-', ''));
    ClaudeProvider.mockImplementation(() => ({
      chat: jest.fn().mockResolvedValue({ content: 'test', usage: {}, stop_reason: 'end_turn' }),
      validate: jest.fn().mockResolvedValue(true),
    }));
    OpenAIProvider.mockImplementation(() => ({
      chat: jest.fn().mockResolvedValue({ content: 'test', usage: {}, stop_reason: 'stop' }),
      validate: jest.fn().mockResolvedValue(true),
    }));
    GenericProvider.mockImplementation(() => ({
      chat: jest.fn().mockResolvedValue({ content: 'test', usage: {}, stop_reason: 'stop' }),
      validate: jest.fn().mockResolvedValue(true),
    }));
  });

  describe('loadProviders', () => {
    it('should load providers from database', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_id: 1,
            name: 'claude-pro',
            provider_type: 'claude',
            api_key_encrypted: 'encrypted-my-key',
            model: 'claude-sonnet-4-20250514',
            roles: ['planner'],
            max_tokens: 4096,
            temperature: 0.1,
            is_active: true,
          },
          {
            id: 2,
            project_id: 1,
            name: 'openai-worker',
            provider_type: 'openai',
            api_key_encrypted: 'encrypted-openai-key',
            model: 'gpt-4o',
            roles: ['worker', 'reviewer'],
            max_tokens: 8192,
            temperature: 0.2,
            is_active: true,
          },
        ],
      });

      const router = new ProviderRouter(1);
      await router.loadProviders();

      expect(pool.query).toHaveBeenCalledWith(
        `SELECT * FROM project_providers WHERE project_id = $1 AND is_active = true`,
        [1]
      );
      expect(ClaudeProvider).toHaveBeenCalledWith({
        apiKey: 'my-key',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        temperature: 0.1,
        baseUrl: undefined,
      });
      expect(OpenAIProvider).toHaveBeenCalledWith({
        apiKey: 'openai-key',
        model: 'gpt-4o',
        maxTokens: 8192,
        temperature: 0.2,
        baseUrl: undefined,
      });
    });

    it('should not reload providers if already loaded', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const router = new ProviderRouter(1);
      await router.loadProviders();
      await router.loadProviders();

      expect(pool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('getForRole', () => {
    it('should return provider for given role', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_id: 1,
            name: 'claude-pro',
            provider_type: 'claude',
            api_key_encrypted: 'encrypted-my-key',
            model: 'claude-sonnet-4-20250514',
            roles: ['planner'],
            max_tokens: 4096,
            temperature: 0.1,
            is_active: true,
          },
        ],
      });

      const router = new ProviderRouter(1);
      await router.loadProviders();

      const planner = router.getForRole('planner');
      expect(planner).toBeDefined();
    });

    it('should throw error if no provider for role', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const router = new ProviderRouter(1);
      await router.loadProviders();

      expect(() => router.getForRole('planner')).toThrow('No provider configured for role: planner');
    });
  });

  describe('createProvider', () => {
    it('should create ClaudeProvider for claude type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('claude', { apiKey: 'test', model: 'claude-sonnet-4-20250514' });
      expect(ClaudeProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'claude-sonnet-4-20250514', maxTokens: undefined, temperature: undefined, baseUrl: undefined });
      expect(provider.chat).toBeDefined();
    });

    it('should create OpenAIProvider for openai type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('openai', { apiKey: 'test', model: 'gpt-4o' });
      expect(OpenAIProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'gpt-4o', maxTokens: undefined, temperature: undefined, baseUrl: undefined });
      expect(provider.chat).toBeDefined();
    });

    it('should create GenericProvider for generic type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('generic', { apiKey: 'test', model: 'gpt-4o', baseUrl: 'http://localhost:8080' });
      expect(GenericProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'gpt-4o', maxTokens: undefined, temperature: undefined, baseUrl: 'http://localhost:8080' });
      expect(provider.chat).toBeDefined();
    });

    it('should throw error for unknown provider type', () => {
      const router = new ProviderRouter(1);
      expect(() => router.createProvider('unknown', {})).toThrow('Unknown provider type: unknown');
    });
  });
});
