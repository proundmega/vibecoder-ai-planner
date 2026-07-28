const UsageLogger = require('../../src/services/UsageLogger');
const db = require('../../src/db');

describe('Telemetry Events', () => {
  let mockQuery;

  beforeEach(() => {
    mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    jest.spyOn(db.pool, 'query').mockImplementation(mockQuery);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('_buildRawProviderFields', () => {
    it('should return raw fields for claude', () => {
      const raw = { input_tokens: 150, output_tokens: 50 };
      const result = UsageLogger._buildRawProviderFields('claude', raw);
      expect(result).toEqual({ input_tokens: 150, output_tokens: 50 });
    });

    it('should remove internal fields', () => {
      const raw = { input_tokens: 150, output_tokens: 50, _request_id: 'abc', _response_ms: 100 };
      const result = UsageLogger._buildRawProviderFields('claude', raw);
      expect(result).toEqual({ input_tokens: 150, output_tokens: 50 });
    });

    it('should return empty object for null rawUsage', () => {
      const result = UsageLogger._buildRawProviderFields('claude', null);
      expect(result).toEqual({});
    });

    it('should return empty object for undefined rawUsage', () => {
      const result = UsageLogger._buildRawProviderFields('claude', undefined);
      expect(result).toEqual({});
    });

    it('should preserve extra fields for generic provider', () => {
      const raw = { prompt_tokens: 150, completion_tokens: 50, extra_field: 'value' };
      const result = UsageLogger._buildRawProviderFields('generic', raw);
      expect(result).toEqual({ prompt_tokens: 150, completion_tokens: 50, extra_field: 'value' });
    });
  });

  describe('_buildNormalizedFields', () => {
    it('should map claude input_tokens to tokens_in', () => {
      const result = UsageLogger._buildNormalizedFields('claude', { input_tokens: 150, output_tokens: 50 }, 1200, 'claude-sonnet-4-20250514');
      expect(result.tokens_in).toBe(150);
      expect(result.tokens_out).toBe(50);
      expect(result.tokens_total).toBe(200);
      expect(result.duration_ms).toBe(1200);
      expect(result.provider_type).toBe('claude');
      expect(result.model).toBe('claude-sonnet-4-20250514');
    });

    it('should map openai prompt_tokens to tokens_in', () => {
      const result = UsageLogger._buildNormalizedFields('openai', { prompt_tokens: 150, completion_tokens: 50 }, 1200, 'gpt-4o');
      expect(result.tokens_in).toBe(150);
      expect(result.tokens_out).toBe(50);
    });

    it('should map generic prompt_tokens to tokens_in', () => {
      const result = UsageLogger._buildNormalizedFields('generic', { prompt_tokens: 150, completion_tokens: 50 }, 1200, 'gpt-4o');
      expect(result.tokens_in).toBe(150);
      expect(result.tokens_out).toBe(50);
    });

    it('should handle null rawUsage', () => {
      const result = UsageLogger._buildNormalizedFields('claude', null, 1200, 'claude-sonnet-4-20250514');
      expect(result.tokens_in).toBe(0);
      expect(result.tokens_out).toBe(0);
    });

    it('should handle missing tokens', () => {
      const result = UsageLogger._buildNormalizedFields('claude', {}, 1200, 'claude-sonnet-4-20250514');
      expect(result.tokens_in).toBe(0);
      expect(result.tokens_out).toBe(0);
    });

    it('should use default model when not provided', () => {
      const result = UsageLogger._buildNormalizedFields('claude', { input_tokens: 10 }, 100, undefined);
      expect(result.model).toBe('unknown');
    });
  });

  describe('_buildDerivedMetrics', () => {
    it('should calculate cost_usd', () => {
      const normalized = { tokens_in: 150, tokens_out: 50, duration_ms: 1200, provider_type: 'claude', model: 'claude-sonnet-4-20250514' };
      const result = UsageLogger._buildDerivedMetrics(normalized, 'claude-sonnet-4-20250514');
      expect(result.cost_usd).toBeGreaterThan(0);
    });

    it('should calculate tokens_per_second', () => {
      const normalized = { tokens_in: 150, tokens_out: 50, duration_ms: 1000, provider_type: 'claude', model: 'claude-sonnet-4-20250514' };
      const result = UsageLogger._buildDerivedMetrics(normalized, 'claude-sonnet-4-20250514');
      expect(result.tokens_per_second).toBe(50);
    });

    it('should return 0 tokens_per_second when duration_ms is 0', () => {
      const normalized = { tokens_in: 150, tokens_out: 50, duration_ms: 0, provider_type: 'claude', model: 'claude-sonnet-4-20250514' };
      const result = UsageLogger._buildDerivedMetrics(normalized, 'claude-sonnet-4-20250514');
      expect(result.tokens_per_second).toBe(0);
    });

    it('should return 0 tokens_per_second when duration_ms is undefined', () => {
      const normalized = { tokens_in: 150, tokens_out: 50, provider_type: 'claude', model: 'claude-sonnet-4-20250514' };
      const result = UsageLogger._buildDerivedMetrics(normalized, 'claude-sonnet-4-20250514');
      expect(result.tokens_per_second).toBe(0);
    });
  });

  describe('_buildFieldProvenance', () => {
    it('should have correct provenance for claude', () => {
      const result = UsageLogger._buildFieldProvenance('claude');
      expect(result.raw_provider_fields).toBe('raw:provider_response');
      expect(result['normalized_fields.tokens_in']).toBe('normalized:input_tokens→tokens_in');
      expect(result['normalized_fields.tokens_out']).toBe('normalized:output_tokens→tokens_out');
      expect(result['derived_metrics.cost_usd']).toBe('derived:pricing.js(model,tokens_in,tokens_out)');
      expect(result['derived_metrics.tokens_per_second']).toBe('derived:tokens_out/duration_ms');
    });

    it('should have correct provenance for openai', () => {
      const result = UsageLogger._buildFieldProvenance('openai');
      expect(result['normalized_fields.tokens_in']).toBe('normalized:prompt_tokens→tokens_in');
      expect(result['normalized_fields.tokens_out']).toBe('normalized:completion_tokens→tokens_out');
    });

    it('should have correct provenance for generic', () => {
      const result = UsageLogger._buildFieldProvenance('generic');
      expect(result['normalized_fields.tokens_in']).toBe('normalized:prompt_tokens→tokens_in');
      expect(result['normalized_fields.tokens_out']).toBe('normalized:completion_tokens→tokens_out');
    });
  });

  describe('logStructuredEvent', () => {
    it('should insert into telemetry_events with correct structure', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await UsageLogger.logStructuredEvent({
        providerType: 'claude',
        model: 'claude-sonnet-4-20250514',
        rawUsage: { input_tokens: 150, output_tokens: 50 },
        durationMs: 1200,
        projectId: 1,
        userId: 1,
        agentId: 1,
      });

      expect(mockQuery).toHaveBeenCalled();
      const call = mockQuery.mock.calls[0];
      const values = call[1];
      expect(values[1]).toMatch(/^[a-f0-9]{64}$/);
      expect(values[2]).toBe('claude');
    });

    it('should handle duplicate content_hash with ON CONFLICT DO NOTHING', async () => {
      let callCount = 0;
      mockQuery.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          const err = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        }
        return Promise.resolve({ rows: [] });
      });

      const payload = {
        providerType: 'claude',
        model: 'claude-sonnet-4-20250514',
        rawUsage: { input_tokens: 150, output_tokens: 50 },
        durationMs: 1200,
        projectId: 1,
        userId: 1,
        agentId: 1,
      };

      await UsageLogger.logStructuredEvent(payload);
      await UsageLogger.logStructuredEvent(payload);

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should not throw on telemetry write failure', async () => {
      mockQuery.mockRejectedValue(new Error('DB connection failed'));

      await expect(
        UsageLogger.logStructuredEvent({
          providerType: 'claude',
          model: 'claude-sonnet-4-20250514',
          rawUsage: { input_tokens: 150 },
          durationMs: 100,
        })
      ).resolves.toBeUndefined();
    });

    it('should produce correct three-layer payload', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await UsageLogger.logStructuredEvent({
        providerType: 'claude',
        model: 'claude-sonnet-4-20250514',
        rawUsage: { input_tokens: 150, output_tokens: 50, cache_read_input_tokens: 10 },
        durationMs: 1200,
        projectId: 1,
        userId: 1,
        agentId: 1,
        ticketId: 5,
        planningStage: 'design',
        fileKey: 'design.md',
      });

      expect(mockQuery).toHaveBeenCalled();
      const call = mockQuery.mock.calls[0];
      const values = call[1];

      expect(values[0]).toBe(1); // schema_version
      expect(values[2]).toBe('claude'); // provider_type
      expect(values[3]).toBe('claude-sonnet-4-20250514'); // model
      expect(values[8]).toBe(1); // project_id
      expect(values[9]).toBe(1); // user_id
      expect(values[10]).toBe(1); // agent_id
      expect(values[11]).toBe(5); // ticket_id
      expect(values[12]).toBe('design'); // planning_stage
      expect(values[13]).toBe('design.md'); // file_key
    });
  });
});
