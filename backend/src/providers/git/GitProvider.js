const net = require('net');
const { ValidationError } = require('../../errors/HttpError');

/**
 * Provider-neutral Git contract. A provider instance exposes the same
 * operations regardless of host: parseRepoUrl, validateRepoAccess,
 * validateCredential, getFileContent, createBranch, deleteBranch,
 * listBranches, createReviewRequest, listReviewRequests and getReviewDiff.
 * Providers without review requests (local bare/SSH) return null from
 * createReviewRequest and publish branch + SHA instead.
 */
function capabilities(id, label, options = {}) {
  const {
    review = true,
    installations = false,
    reviewName = 'pull request',
    authModes = ['pat'],
  } = options;
  return Object.freeze({
    id,
    label,
    supportsReviewRequests: review,
    supportsInstallations: installations,
    reviewRequestName: reviewName,
    authModes: Object.freeze(authModes),
  });
}

const PROVIDERS = Object.freeze({
  github: capabilities('github', 'GitHub', { installations: true, authModes: ['app', 'pat'] }),
  forgejo: capabilities('forgejo', 'Forgejo', { authModes: ['pat', 'project_token'] }),
  gitea: capabilities('gitea', 'Gitea', { authModes: ['pat', 'project_token'] }),
  gitlab: capabilities('gitlab', 'GitLab', { reviewName: 'merge request', authModes: ['pat', 'project_token'] }),
  local: capabilities('local', 'Local bare repository', { review: false, reviewName: 'branch', authModes: ['ssh', 'none'] }),
});

const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

function normalizeProviderId(providerId) {
  if (typeof providerId !== 'string' || !providerId.trim()) {
    throw new ValidationError('Git provider is required');
  }
  const id = providerId.trim().toLowerCase();
  if (!PROVIDERS[id]) throw new ValidationError(`Unsupported Git provider: ${providerId}`);
  return id;
}

function getCapabilities(providerId) {
  const provider = PROVIDERS[normalizeProviderId(providerId)];
  return { ...provider, authModes: [...provider.authModes] };
}

function isPrivateHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')
    || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('::ffff:')) return isPrivateHostname(host.slice('::ffff:'.length));
  if (net.isIPv6(host) && (/^f[cd]/.test(host) || /^fe[89ab]/.test(host))) return true;
  if (!net.isIPv4(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Validate a self-hosted provider base URL. Private hosts stay blocked unless
 * the existing host policy (`ALLOW_PRIVATE_HOSTS=1`) allows them.
 */
function assertSafeBaseUrl(raw, { allowPrivateHosts = process.env.ALLOW_PRIVATE_HOSTS === '1' } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw new ValidationError('baseUrl is required');
  const value = raw.trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('baseUrl must be an absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ValidationError('baseUrl must use http or https');
  }
  if (url.username || url.password) {
    throw new ValidationError('baseUrl must not embed credentials');
  }
  if (url.search || url.hash) {
    throw new ValidationError('baseUrl must not include a query or fragment');
  }
  if (!allowPrivateHosts && isPrivateHostname(url.hostname)) {
    throw new ValidationError('baseUrl host is not allowed by the host policy');
  }
  return value.replace(/\/+$/, '');
}

function createRegistry() {
  const factories = new Map();

  return {
    register(providerId, factory) {
      const id = normalizeProviderId(providerId);
      if (typeof factory !== 'function') {
        throw new ValidationError(`Git provider ${id} factory must be a function`);
      }
      factories.set(id, factory);
      return id;
    },
    has(providerId) {
      if (typeof providerId !== 'string') return false;
      const id = providerId.trim().toLowerCase();
      return Boolean(PROVIDERS[id]) && factories.has(id);
    },
    get(providerId, ...args) {
      const id = normalizeProviderId(providerId);
      const factory = factories.get(id);
      if (!factory) throw new ValidationError(`Git provider is not registered: ${id}`);
      return factory(...args);
    },
    list() {
      return Object.values(PROVIDERS).map(provider => ({
        ...provider,
        authModes: [...provider.authModes],
        registered: factories.has(provider.id),
      }));
    },
  };
}

module.exports = {
  PROVIDERS,
  PROVIDER_IDS,
  normalizeProviderId,
  getCapabilities,
  isPrivateHostname,
  assertSafeBaseUrl,
  createRegistry,
};
