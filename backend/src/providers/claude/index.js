const Anthropic = require('@anthropic-ai/sdk');
const ProviderInterface = require('../base/ProviderInterface');

class ClaudeProvider extends ProviderInterface {
  constructor(config) {
    super();
    this.client = new Anthropic({
      apiKey: config.apiKey,
      httpClient: Anthropic.getDefaultHttpClient(),
    });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.1;
  }

  formatSystemPrompt(systemPrompt) {
    return { role: 'system', content: systemPrompt };
  }

  async chat(messages, options = {}) {
    const systemPrompt = messages.find(m => m.role === 'system');
    const contentMessages = messages.filter(m => m.role !== 'system');

    const params = {
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      messages: contentMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (systemPrompt) {
      params.system = systemPrompt.content;
    }

    const response = await this.client.messages.create(params);

    return {
      content: response.content[0].text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      stop_reason: response.stop_reason,
    };
  }

  async validate() {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      });
      return response.id !== undefined;
    } catch (error) {
      if (error.status === 401) {
        return false;
      }
      throw error;
    }
  }
}

module.exports = ClaudeProvider;
