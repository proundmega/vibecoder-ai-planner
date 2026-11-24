const dns = require('dns');
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

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

/**
 * Node normalises IPv4-mapped literals such as ::ffff:127.0.0.1 to
 * ::ffff:7f00:1 before it reaches us, so decode the hex form back to IPv4.
 */
function ipv4FromMapped(host) {
  if (!host.startsWith('::ffff:')) return null;
  const tail = host.slice('::ffff:'.length);
  if (net.isIPv4(tail)) return tail;
  const groups = tail.split(':');
  if (groups.length !== 2) return null;
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function isPrivateAddress(address) {
  const mapped = ipv4FromMapped(String(address).toLowerCase());
  const value = mapped || address;
  if (net.isIPv4(value)) {
    const [a, b] = value.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(value)) {
    const host = value.toLowerCase();
    return host === '::' || host === '::1'
      || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  // Unknown address shapes fail closed.
  return true;
}

function isPrivateHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (net.isIP(host)) return isPrivateAddress(host);
  if (host.includes(':')) return true;
  return false;
}

/**
 * Validate a self-hosted provider base URL. Private hosts stay blocked unless
 * the existing host policy (`ALLOW_PRIVATE_HOSTS=1`) allows them. Hostnames are
 * resolved and rejected when any address is private; a failed lookup rejects
 * (fail closed) instead of silently allowing the host.
 */
async function assertSafeBaseUrl(raw, {
  allowPrivateHosts = process.env.ALLOW_PRIVATE_HOSTS === '1',
  lookup = dns.promises.lookup,
} = {}) {
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
  const host = normalizeHostname(url.hostname);
  if (!allowPrivateHosts) {
    if (isPrivateHostname(host)) {
      throw new ValidationError('baseUrl host is not allowed by the host policy');
    }
    if (!net.isIP(host)) {
      let addresses;
      try {
        addresses = await lookup(host, { all: true, verbatim: true });
      } catch {
        throw new ValidationError('baseUrl host could not be resolved');
      }
      if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new ValidationError('baseUrl host could not be resolved');
      }
      if (addresses.some(entry => isPrivateAddress(entry.address))) {
        throw new ValidationError('baseUrl host is not allowed by the host policy');
      }
    }
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
