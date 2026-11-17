/**
 * Built-in defaults for cloud providers that expose a fixed OpenAI-compatible
 * endpoint. Keeping them here means the API, validators and UI do not drift.
 *
 * OpenCode Zen is pay-per-use; OpenCode Go is the subscription gateway. Both
 * speak OpenAI Chat Completions at the listed base URL.
 */
const PROVIDER_DEFAULTS = Object.freeze({
  opencode: Object.freeze({
    label: 'OpenCode (Zen)',
    endpointUrl: 'https://opencode.ai/zen/v1',
    requiresModel: true,
  }),
  'opencode-go': Object.freeze({
    label: 'OpenCode Go',
    endpointUrl: 'https://opencode.ai/zen/go/v1',
    requiresModel: true,
  }),
});

function getProviderDefaults(providerType) {
  return PROVIDER_DEFAULTS[providerType] || null;
}

function providerTypesRequiringModel() {
  return Object.keys(PROVIDER_DEFAULTS).filter(
    (type) => PROVIDER_DEFAULTS[type].requiresModel
  );
}

module.exports = {
  PROVIDER_DEFAULTS,
  getProviderDefaults,
  providerTypesRequiringModel,
};
