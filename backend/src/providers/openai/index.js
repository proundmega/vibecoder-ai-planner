const OpenAI = require('openai');
const ProviderInterface = require('../base/ProviderInterface');
const UsageLogger = require('../../services/UsageLogger');
const logger = require('../../utils/logger');

class OpenAIProvider extends ProviderInterface {
  constructor(config) {
    super();
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.1;
    this.projectId = config.projectId;
    this.userId = config.userId;
    this.agentId = config.agentId;
    this.ticketId = config.ticketId;
  }

  async chat(messages, options = {}) {
    const startTime = Date.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      messages,
    });
    const duration = Date.now() - startTime;

    const choice = response.choices[0];
    const usage = response.usage || {};

    try {
      await UsageLogger.log(
        this.projectId, this.userId, this.agentId,
        'openai', this.model, usage, duration, this.ticketId
      );
    } catch (e) {
      logger.warn('Failed to log usage:', e.message);
    }

    return {
      content: choice.message.content,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      },
      stop_reason: choice.finish_reason,
    };
  }

  async validate() {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      });
      return true;
    } catch (error) {
      if (error.status === 401) {
        return false;
      }
      throw error;
    }
  }
}

module.exports = OpenAIProvider;
