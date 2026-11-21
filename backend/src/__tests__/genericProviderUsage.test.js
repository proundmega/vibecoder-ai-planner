const GenericProvider = require('../providers/generic');
const UsageLogger = require('../services/UsageLogger');

jest.mock('axios');
jest.mock('../services/UsageLogger', () => ({ log: jest.fn() }));

const axios = require('axios');

describe('GenericProvider usage logging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      },
    });
  });

  it('logs the OpenCode provider type instead of generic', async () => {
    const provider = new GenericProvider({
      baseUrl: 'https://opencode.ai/zen/v1',
      model: 'kimi-k2.6',
      apiKey: 'oc_sk-test',
      providerType: 'opencode',
      projectId: 1,
      userId: 2,
      ticketId: 4,
    });

    await provider.chat([{ role: 'user', content: 'hi' }]);

    expect(UsageLogger.log).toHaveBeenCalledWith(
      1,
      2,
      'opencode',
      'kimi-k2.6',
      expect.objectContaining({ prompt_tokens: 12, completion_tokens: 8 }),
      expect.any(Number),
      4,
      expect.objectContaining({ rawUsage: expect.anything() })
    );
  });

  it('defaults the logged type to generic when none is supplied', async () => {
    const provider = new GenericProvider({
      baseUrl: 'https://example.test/v1',
      model: 'local-model',
      apiKey: 'test',
    });

    await provider.chat([{ role: 'user', content: 'hi' }]);

    expect(UsageLogger.log).toHaveBeenCalledWith(
      undefined,
      undefined,
      'generic',
      'local-model',
      expect.anything(),
      expect.any(Number),
      undefined,
      expect.anything()
    );
  });
});
