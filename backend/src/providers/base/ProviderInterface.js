class ProviderInterface {
  async chat(messages, _options = {}) {
    throw new Error('Not implemented');
  }

  async validate() {
    throw new Error('Not implemented');
  }

  formatSystemPrompt(systemPrompt) {
    return { role: 'system', content: systemPrompt };
  }

  formatMessages(messages) {
    return { messages };
  }
}

module.exports = ProviderInterface;
