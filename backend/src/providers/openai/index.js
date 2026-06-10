const OpenAI = require('openai');
const ProviderInterface = require('../base/ProviderInterface');

class OpenAIProvider extends ProviderInterface {
  constructor(config) {
    super();
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.1;
  }

  async chat(messages, options = {}) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      messages,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content,
      usage: response.usage,
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
