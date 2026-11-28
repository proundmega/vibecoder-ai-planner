const {
  normaliseEndpoint,
  resolveProviderEndpoint,
  providerCatalog,
  providerRequiresEndpoint,
  defaultTemperature,
} = require('../utils/providerDefaults');

describe('provider endpoint resolution', () => {
  it('trims a configured endpoint', () => {
    expect(normaliseEndpoint('  https://example.test/v1  ')).toBe('https://example.test/v1');
  });

  it('treats blank and non-string values as unset', () => {
    expect(normaliseEndpoint('')).toBeNull();
    expect(normaliseEndpoint('   ')).toBeNull();
    expect(normaliseEndpoint(null)).toBeNull();
    expect(normaliseEndpoint(undefined)).toBeNull();
  });

  it('prefers base_url, then endpoint_url', () => {
    expect(resolveProviderEndpoint({
      providerType: 'opencode',
      baseUrl: 'https://proxy.internal/base',
      endpointUrl: 'https://proxy.internal/endpoint',
    })).toBe('https://proxy.internal/base');
  });

  it('ignores a blank base_url so endpoint_url wins', () => {
    expect(resolveProviderEndpoint({
      providerType: 'opencode',
      baseUrl: '',
      endpointUrl: 'https://proxy.internal/endpoint',
    })).toBe('https://proxy.internal/endpoint');
  });

  it('falls back to the provider default endpoint', () => {
    expect(resolveProviderEndpoint({ providerType: 'opencode' }))
      .toBe('https://opencode.ai/inference/openai/v1');
    expect(resolveProviderEndpoint({ providerType: 'opencode-go', baseUrl: ' ' }))
      .toBe('https://opencode.ai/inference/go/openai/v1');
  });

  it('returns null when nothing is configured', () => {
    expect(resolveProviderEndpoint({ providerType: 'openai' })).toBeNull();
  });

  it('exposes the defaults catalog for the UI', () => {
    expect(providerCatalog()).toEqual([
      {
        type: 'opencode',
        label: 'OpenCode (Console)',
        endpointUrl: 'https://opencode.ai/inference/openai/v1',
        requiresModel: true,
      },
      {
        type: 'opencode-go',
        label: 'OpenCode Go',
        endpointUrl: 'https://opencode.ai/inference/go/openai/v1',
        requiresModel: true,
      },
    ]);
  });

  it('knows which provider types cannot work without an endpoint', () => {
    for (const type of ['generic', 'custom', 'ollama', 'vllm', 'llamacpp']) {
      expect(providerRequiresEndpoint(type)).toBe(true);
    }
    for (const type of ['opencode', 'opencode-go', 'openai', 'claude']) {
      expect(providerRequiresEndpoint(type)).toBe(false);
    }
  });
});


describe('default provider temperature', () => {
  afterEach(() => {
    delete process.env.PROVIDER_DEFAULT_TEMPERATURE;
  });

  it('falls back to 0.1 for unset, blank, invalid or negative values', () => {
    delete process.env.PROVIDER_DEFAULT_TEMPERATURE;
    expect(defaultTemperature()).toBe(0.1);
    process.env.PROVIDER_DEFAULT_TEMPERATURE = '';
    expect(defaultTemperature()).toBe(0.1);
    process.env.PROVIDER_DEFAULT_TEMPERATURE = '   ';
    expect(defaultTemperature()).toBe(0.1);
    process.env.PROVIDER_DEFAULT_TEMPERATURE = 'nope';
    expect(defaultTemperature()).toBe(0.1);
    process.env.PROVIDER_DEFAULT_TEMPERATURE = '-0.2';
    expect(defaultTemperature()).toBe(0.1);
  });

  it('accepts a valid override including zero', () => {
    process.env.PROVIDER_DEFAULT_TEMPERATURE = '0';
    expect(defaultTemperature()).toBe(0);
    process.env.PROVIDER_DEFAULT_TEMPERATURE = '0.7';
    expect(defaultTemperature()).toBe(0.7);
  });
});
