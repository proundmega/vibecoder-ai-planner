const axios = require('axios');
const ProviderInterface = require('../base/ProviderInterface');
const UsageLogger = require('../../services/UsageLogger');

function isPrivateHostname(hostname) {
  if (process.env.ALLOW_PRIVATE_HOSTS === '1') return false;
  if (!hostname || typeof hostname !== 'string') return true;
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1') return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  if (/^0\.0\.0\.0$/.test(lower)) return true;
  if (/\.internal$/.test(lower)) return true;
  if (/\.local$/.test(lower)) return true;
  if (/^metadata\.google\.internal$/.test(lower)) return true;
  if (/\.amazonaws\.com$/.test(lower) && !/^[a-z0-9-]+\.[a-z0-9-]+\.amazonaws\.com$/.test(lower)) return true;
  return false;
}

class GenericProvider extends ProviderInterface {
  constructor(config) {
    super();
    this.baseURL = config.baseUrl;
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.1;
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
    this.userId = config.userId;
    this.agentId = config.agentId;
    this.ticketId = config.ticketId;
    if (this.baseURL && typeof this.baseURL === 'string') {
      try {
        const url = new URL(this.baseURL);
        if (isPrivateHostname(url.hostname)) {
          throw new Error('Base URL must not point to a private or internal host');
        }
      } catch (urlError) {
        if (urlError.message.includes('Base URL must not point to a private')) {
          throw urlError;
        }
      }
    }
  }

  async chat(messages, options = {}) {
    if (this.baseURL && typeof this.baseURL === 'string') {
      try {
        const url = new URL(this.baseURL);
        if (isPrivateHostname(url.hostname)) {
          throw new Error('Base URL must not point to a private or internal host');
        }
      } catch (urlError) {
        if (urlError.message.includes('Base URL must not point to a private')) {
          throw urlError;
        }
      }
    }
    const startTime = Date.now();
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
    const duration = Date.now() - startTime;

    const choice = response.data.choices[0];
    const usage = response.data.usage || {};

    try {
      await UsageLogger.log(
        this.projectId, this.userId, this.agentId,
        'generic', this.model, usage, duration, this.ticketId
      );
    } catch (e) {
      console.error('Failed to log usage:', e.message);
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
    if (!this.baseURL || typeof this.baseURL !== 'string') {
      throw new Error('Base URL is required for validation');
    }
    try {
      const url = new URL(this.baseURL);
      if (!url.protocol.startsWith('http')) {
        throw new Error('Base URL must use http or https protocol');
      }
      if (isPrivateHostname(url.hostname)) {
        throw new Error('Base URL must not point to a private or internal host');
      }
    } catch (urlError) {
      throw new Error(`Invalid base URL: ${urlError.message}`);
    }
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
