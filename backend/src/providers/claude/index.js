const Anthropic = require('@anthropic-ai/sdk');
const ProviderInterface = require('../base/ProviderInterface');
const UsageLogger = require('../../services/UsageLogger');
const logger = require('../../utils/logger');

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
    this.projectId = config.projectId;
    this.userId = config.userId;
    this.agentId = config.agentId;
    this.ticketId = config.ticketId;
  }

  formatSystemPrompt(systemPrompt) {
    return { role: 'system', content: systemPrompt };
  }

  async chat(messages, options = {}) {
    const startTime = Date.now();
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
    const duration = Date.now() - startTime;

    const usage = {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    };

    try {
      await UsageLogger.log(
        this.projectId, this.userId, this.agentId,
        'claude', this.model, usage, duration, this.ticketId,
        { rawUsage: response.usage }
      );
    } catch (e) {
      logger.warn('Failed to log usage:', e.message);
    }

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
