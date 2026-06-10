const { calculateCost, getModelPricing, getAllModels, MODEL_PRICING } = require('../utils/pricing');

describe('pricing', () => {
  describe('calculateCost', () => {
    it('should calculate cost for claude-sonnet-4', () => {
      const cost = calculateCost('claude-sonnet-4-20250514', 1000, 500);
      const expected = (1000 / 1_000_000) * 0.003 + (500 / 1_000_000) * 0.015;
      expect(cost).toBeCloseTo(expected);
    });

    it('should calculate cost for gpt-4o', () => {
      const cost = calculateCost('gpt-4o', 2000, 1000);
      const expected = (2000 / 1_000_000) * 0.0025 + (1000 / 1_000_000) * 0.01;
      expect(cost).toBeCloseTo(expected);
    });

    it('should use default pricing for unknown models', () => {
      const cost = calculateCost('unknown-model', 1000, 500);
      const expected = (1000 / 1_000_000) * 0.001 + (500 / 1_000_000) * 0.003;
      expect(cost).toBeCloseTo(expected);
    });

    it('should handle zero tokens', () => {
      const cost = calculateCost('gpt-4o', 0, 0);
      expect(cost).toBe(0);
    });

    it('should handle large token counts', () => {
      const cost = calculateCost('claude-3-opus-20250514', 100_000, 50_000);
      const expected = (100_000 / 1_000_000) * 0.015 + (50_000 / 1_000_000) * 0.075;
      expect(cost).toBeCloseTo(expected);
    });
  });

  describe('getModelPricing', () => {
    it('should return pricing for known model', () => {
      const pricing = getModelPricing('gpt-4o');
      expect(pricing).toEqual({ input: 0.0025, output: 0.01 });
    });

    it('should return default pricing for unknown model', () => {
      const pricing = getModelPricing('unknown');
      expect(pricing).toEqual({ input: 0.001, output: 0.003 });
    });
  });

  describe('getAllModels', () => {
    it('should return all model names except default', () => {
      const models = getAllModels();
      expect(models).toContain('gpt-4o');
      expect(models).toContain('claude-sonnet-4-20250514');
      expect(models).not.toContain('default');
    });

    it('should return all known models', () => {
      const models = getAllModels();
      const knownCount = Object.keys(MODEL_PRICING).length - 1; // exclude default
      expect(models.length).toBe(knownCount);
    });
  });
});
