const MODEL_PRICING = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-opus-20250514': { input: 0.015, output: 0.075 },
  'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
  'claude-3-haiku-20240307': { input: 0.0008, output: 0.004 },

  // OpenAI
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },

  // Generic fallback
  'default': { input: 0.001, output: 0.003 },
};

function calculateCost(model, tokensIn, tokensOut) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const costIn = (tokensIn / 1_000_000) * pricing.input;
  const costOut = (tokensOut / 1_000_000) * pricing.output;
  return costIn + costOut;
}

function getModelPricing(model) {
  return MODEL_PRICING[model] || MODEL_PRICING['default'];
}

function getAllModels() {
  return Object.keys(MODEL_PRICING).filter(m => m !== 'default');
}

module.exports = { MODEL_PRICING, calculateCost, getModelPricing, getAllModels };
