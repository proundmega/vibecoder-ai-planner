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
    delete process.env.PROVIDER_DEFAULT_TEMPERATURE;
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
            credential_id: 1,
            provider_type: 'claude',
            api_key_encrypted: 'encrypted-my-key',
            base_url: null,
            model_id: 11,
            model: 'claude-sonnet-4-20250514',
            roles: ['planner'],
            max_tokens: 4096,
          },
          {
            credential_id: 2,
            provider_type: 'openai',
            api_key_encrypted: 'encrypted-openai-key',
            base_url: null,
            model_id: 12,
            model: 'gpt-4o',
            roles: ['worker', 'reviewer'],
            max_tokens: 8192,
          },
        ],
      });

      const router = new ProviderRouter(1);
      await router.loadProviders();

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('FROM provider_credentials pc');
      expect(sql).toContain("pc.status = 'active'");
      expect(sql).toContain("pm.status = 'verified'");
      expect(params).toEqual([1]);
      expect(ClaudeProvider).toHaveBeenCalledWith({
        apiKey: 'my-key',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        temperature: 0.1,
        baseUrl: undefined,
        projectId: 1,
        userId: null,
        agentId: null,
        ticketId: null,
      });
      expect(OpenAIProvider).toHaveBeenCalledWith({
        apiKey: 'openai-key',
        model: 'gpt-4o',
        maxTokens: 8192,
        temperature: 0.1,
        baseUrl: undefined,
        projectId: 1,
        userId: null,
        agentId: null,
        ticketId: null,
      });
    });


    it('keeps project-scoped credentials ahead of global credentials for a role', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            credential_id: 1,
            provider_type: 'claude',
            api_key_encrypted: 'encrypted-project-key',
            base_url: null,
            model_id: 11,
            model: 'project-model',
            roles: ['worker'],
            max_tokens: 4096,
          },
          {
            credential_id: 2,
            provider_type: 'openai',
            api_key_encrypted: 'encrypted-global-key',
            base_url: null,
            model_id: 12,
            model: 'global-model',
            roles: ['worker'],
            max_tokens: 4096,
          },
        ],
      });

      const router = new ProviderRouter(1);
      await router.loadProviders();

      expect(router.getForRole('worker')).toBe(ClaudeProvider.mock.results[0].value);
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
            credential_id: 1,
            provider_type: 'claude',
            api_key_encrypted: 'encrypted-my-key',
            base_url: null,
            model_id: 11,
            model: 'claude-sonnet-4-20250514',
            roles: ['planner'],
            max_tokens: 4096,
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
      expect(GenericProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'gpt-4o', maxTokens: undefined, temperature: undefined, baseUrl: 'http://localhost:8080', providerType: 'generic' });
      expect(provider.chat).toBeDefined();
    });

    it('should create GenericProvider for ollama type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('ollama', { apiKey: 'test', model: 'llama3', baseUrl: 'http://localhost:11434/v1' });
      expect(GenericProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'llama3', maxTokens: undefined, temperature: undefined, baseUrl: 'http://localhost:11434/v1', providerType: 'ollama' });
      expect(provider.chat).toBeDefined();
    });

    it('should create GenericProvider for vllm type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('vllm', { apiKey: 'test', model: 'meta-llama/Llama-3-8b', baseUrl: 'http://localhost:8000/v1' });
      expect(GenericProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'meta-llama/Llama-3-8b', maxTokens: undefined, temperature: undefined, baseUrl: 'http://localhost:8000/v1', providerType: 'vllm' });
      expect(provider.chat).toBeDefined();
    });

    it('should create GenericProvider for llamacpp type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('llamacpp', { apiKey: 'test', model: 'llama-3-8b', baseUrl: 'http://localhost:8081' });
      expect(GenericProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'llama-3-8b', maxTokens: undefined, temperature: undefined, baseUrl: 'http://localhost:8081', providerType: 'llamacpp' });
      expect(provider.chat).toBeDefined();
    });

    it('should create GenericProvider for custom type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('custom', { apiKey: 'test', model: 'custom-model', baseUrl: 'http://custom-api.com' });
      expect(GenericProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'custom-model', maxTokens: undefined, temperature: undefined, baseUrl: 'http://custom-api.com', providerType: 'custom' });
      expect(provider.chat).toBeDefined();
    });

    it('should create ClaudeProvider for anthropic type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('anthropic', { apiKey: 'test', model: 'claude-sonnet-4-20250514' });
      expect(ClaudeProvider).toHaveBeenCalledWith({ apiKey: 'test', model: 'claude-sonnet-4-20250514', maxTokens: undefined, temperature: undefined, baseUrl: undefined });
      expect(provider.chat).toBeDefined();
    });

    it('should create GenericProvider for opencode type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('opencode', {
        apiKey: 'oc_sk-test',
        model: 'kimi-k2.6',
        baseUrl: 'https://opencode.ai/zen/v1',
        providerType: 'opencode',
      });
      expect(GenericProvider).toHaveBeenCalledWith({
        apiKey: 'oc_sk-test',
        model: 'kimi-k2.6',
        baseUrl: 'https://opencode.ai/zen/v1',
        providerType: 'opencode',
      });
      expect(provider.chat).toBeDefined();
    });

    it('should create GenericProvider for opencode-go type', () => {
      const router = new ProviderRouter(1);
      const provider = router.createProvider('opencode-go', {
        apiKey: 'oc_sk-test',
        model: 'kimi-k2.6',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        providerType: 'opencode-go',
      });
      expect(GenericProvider).toHaveBeenCalledWith({
        apiKey: 'oc_sk-test',
        model: 'kimi-k2.6',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        providerType: 'opencode-go',
      });
      expect(provider.chat).toBeDefined();
    });

    it('should throw error for unknown provider type', () => {
      const router = new ProviderRouter(1);
      expect(() => router.createProvider('unknown', {})).toThrow('Unknown provider type: unknown');
    });
  });
});
