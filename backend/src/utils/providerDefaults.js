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

// Types with no built-in endpoint that cannot work without one.
const ENDPOINT_REQUIRED_TYPES = Object.freeze([
  'generic',
  'custom',
  'ollama',
  'vllm',
  'llamacpp',
]);

function getProviderDefaults(providerType) {
  return PROVIDER_DEFAULTS[providerType] || null;
}

function providerTypesRequiringModel() {
  return Object.keys(PROVIDER_DEFAULTS).filter(
    (type) => PROVIDER_DEFAULTS[type].requiresModel
  );
}

/**
 * Public, serialisable view of the built-in defaults. The Providers UI reads
 * this instead of duplicating endpoints/model rules in the frontend.
 */
function providerCatalog() {
  return Object.entries(PROVIDER_DEFAULTS).map(([type, defaults]) => ({
    type,
    label: defaults.label,
    endpointUrl: defaults.endpointUrl,
    requiresModel: Boolean(defaults.requiresModel),
  }));
}

/**
 * Treat blank strings as "not configured". The database can hold '' (for
 * example from an old form), and an empty string must never win over a real
 * endpoint in any agent path.
 */
function normaliseEndpoint(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Single source of truth for the endpoint an agent should call. `base_url` is
 * the legacy column; `endpoint_url` is the column the UI edits. Either may be
 * set, so both are considered before the provider type's built-in default.
 */
function resolveProviderEndpoint({ providerType = null, baseUrl = null, endpointUrl = null } = {}) {
  return normaliseEndpoint(baseUrl)
    || normaliseEndpoint(endpointUrl)
    || getProviderDefaults(providerType)?.endpointUrl
    || null;
}

function providerRequiresEndpoint(providerType) {
  return ENDPOINT_REQUIRED_TYPES.includes(providerType);
}

/** Default sampling temperature when a registry model has no override. */
function defaultTemperature() {
  const raw = process.env.PROVIDER_DEFAULT_TEMPERATURE;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0.1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.1;
}

module.exports = {
  PROVIDER_DEFAULTS,
  getProviderDefaults,
  providerTypesRequiringModel,
  providerCatalog,
  normaliseEndpoint,
  resolveProviderEndpoint,
  providerRequiresEndpoint,
  defaultTemperature,
};
