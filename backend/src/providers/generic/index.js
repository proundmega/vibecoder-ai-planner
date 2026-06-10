const axios = require('axios');
const ProviderInterface = require('../base/ProviderInterface');

class GenericProvider extends ProviderInterface {
  constructor(config) {
    super();
    this.baseURL = config.baseUrl;
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.1;
    this.apiKey = config.apiKey;
  }

  async chat(messages, options = {}) {
    const response = await axios.post(
      `${this.baseURL}/chat/completions`,
      {
        model: this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature ?? this.temperature,
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      usage: response.data.usage,
      stop_reason: choice.finish_reason,
    };
  }

  async validate() {
    try {
      await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      return true;
    } catch (error) {
      if (error.response && error.response.status === 401) {
        return false;
      }
      throw error;
    }
  }
}

module.exports = GenericProvider;
