const Joi = require('joi');
const { X509Certificate } = require('crypto');

const LANGUAGES = ['node', 'python', 'java', 'go', 'rust', 'other'];
const CACHES = ['npm', 'maven', 'gradle', 'pip', 'go', 'cargo'];
const MAX_CA_BYTES = 64 * 1024;
const MAX_CA_CERTIFICATES = 16;

const SECRET_KEY = /(?:^|_)(?:API_?KEY|ACCESS_?KEY|KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY)(?:$|_)/i;
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\/$)(?!.*\.$)[A-Za-z0-9._/-]{1,255}$/;
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*@sha256:[a-f0-9]{64}$/;
const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
const COMMAND = /^[^\0\r\n]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SERVICE_NAME = /^[a-z][a-z0-9-]{0,30}$/;
const SERVICE_KEYS = new Set([
  'name', 'image', 'env', 'password_env', 'connection_env',
  'connection_url', 'healthcheck',
]);
const HEALTHCHECK_KEYS = new Set([
  'command', 'interval_seconds', 'timeout_seconds', 'retries',
  'start_period_seconds',
]);

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bASIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[abcdepr]-[A-Za-z0-9-]{10,}\b/,
  /https?:\/\/[^\s/@]+:[^\s/@]+@/,
];

const TOP_LEVEL = new Set([
  'schema_version', 'repo_url', 'base_branch', 'languages', 'image',
  'setup', 'verify', 'caches', 'env', 'timeouts', 'max_round_minutes',
  'services', 'flaky_tests', 'egress',
]);

function envIssue(env) {
  if (!env) return null;
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY.test(key)) {
      return `profile env key "${key}" must match ${ENV_KEY}`;
    }
    if (SECRET_KEY.test(key)) {
      return `profile env key "${key}" looks secret; use the credential store instead`;
    }
    if (typeof value !== 'string') {
      return `profile env value for "${key}" must be a string`;
    }
    if (value.length > 4000 || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
      return `profile env value for "${key}" is invalid`;
    }
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      return `profile env value for "${key}" looks like a credential; use the credential store instead`;
    }
  }
  return null;
}

function normalizeExactHost(host) {
  const normalized = String(host).trim().toLowerCase().replace(/\.$/, '');
  if (!normalized || normalized.length > 253) {
    return { error: `egress.origin_ca_hosts has an invalid host: ${host}` };
  }
  if (normalized.includes('*')) {
    return { error: `egress.origin_ca_hosts must list exact hostnames, not wildcards: ${host}` };
  }
  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    return { error: `egress.origin_ca_hosts has an invalid host: ${host}` };
  }
  const isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(':');
  if (isIp) {
    return { error: `egress.origin_ca_hosts must list hostnames, not IP literals: ${host}` };
  }
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'metadata' ||
    normalized === 'metadata.google.internal' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa') ||
    normalized === 'host.docker.internal' ||
    normalized === 'gateway.docker.internal'
  ) {
    return { error: `egress.origin_ca_hosts must not allow internal or metadata hosts: ${host}` };
  }
  return { host: normalized };
}

function caBundleIssue(b64) {
  let pem;
  try {
    const value = String(b64);
    if (!BASE64.test(value) || value.length % 4 !== 0) {
      return 'egress.origin_ca_b64 must be canonical base64 without whitespace or URL-safe characters';
    }
    const raw = Buffer.from(value, 'base64');
    if (raw.length === 0 || raw.length > MAX_CA_BYTES) {
      return 'egress.origin_ca_b64 must decode to 1-64 KiB';
    }
    pem = raw.toString('utf8');
  } catch {
    return 'egress.origin_ca_b64 must be valid base64';
  }
  if (/PRIVATE KEY/.test(pem)) {
    return 'egress.origin_ca_b64 must not contain a private key';
  }
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (blocks.length < 1 || blocks.length > MAX_CA_CERTIFICATES) {
    return `egress.origin_ca_b64 must contain 1-${MAX_CA_CERTIFICATES} CA certificates`;
  }
  for (const block of blocks) {
    let cert;
    try {
      cert = new X509Certificate(block);
    } catch {
      return 'egress.origin_ca_b64 contains an invalid certificate';
    }
    if (!cert.ca) {
      return 'egress.origin_ca_b64 must contain CA certificates only';
    }
  }
  return null;
}


const serviceHealthcheckSchema = Joi.object({
  command: Joi.string().trim().min(1).max(500).pattern(COMMAND).required(),
  interval_seconds: Joi.number().integer().min(1).max(60).default(2),
  timeout_seconds: Joi.number().integer().min(1).max(60).default(5),
  retries: Joi.number().integer().min(1).max(120).default(30),
  start_period_seconds: Joi.number().integer().min(0).max(120).default(0),
});

const serviceSchema = Joi.object({
  name: Joi.string().trim().pattern(SERVICE_NAME).required(),
  image: Joi.string().trim().max(500).pattern(IMAGE).required(),
  env: Joi.object().max(32).default({}),
  password_env: Joi.string().trim().pattern(ENV_KEY).allow('').optional(),
  connection_env: Joi.string().trim().pattern(ENV_KEY).required(),
  connection_url: Joi.string().trim().min(1).max(1000).required(),
  healthcheck: serviceHealthcheckSchema.required(),
});

const profileSchema = Joi.object({
  schema_version: Joi.number().integer().valid(1).default(1),
  repo_url: Joi.string().trim().max(500).pattern(GITHUB_URL).allow('').optional(),
  base_branch: Joi.string().trim().max(255).pattern(BRANCH).allow('').optional(),
  languages: Joi.array()
    .items(Joi.string().valid(...LANGUAGES))
    .unique()
    .max(8)
    .default([]),
  image: Joi.string().trim().max(500).pattern(IMAGE).allow('').optional(),
  setup: Joi.array()
    .items(Joi.string().trim().min(1).max(1000).pattern(COMMAND))
    .max(30)
    .default([]),
  verify: Joi.array()
    .items(Joi.string().trim().min(1).max(1000).pattern(COMMAND))
    .min(1)
    .max(30)
    .required(),
  caches: Joi.array()
    .items(Joi.string().valid(...CACHES))
    .unique()
    .max(CACHES.length)
    .default([]),
  env: Joi.object().max(64).default({}),
  timeouts: Joi.object({
    setup_minutes: Joi.number().integer().min(1).max(120).default(15),
    verify_minutes: Joi.number().integer().min(1).max(180).default(20),
  }).default({ setup_minutes: 15, verify_minutes: 20 }),
  max_round_minutes: Joi.number().integer().min(1).max(240).default(45),
  services: Joi.array().items(serviceSchema).max(5).default([]),
  flaky_tests: Joi.array().items(Joi.string().max(500)).default([]),
  egress: Joi.object({
    tls_mode: Joi.string().valid('terminate').default('terminate'),
    origin_ca_hosts: Joi.array().items(Joi.string().max(253)).min(1).max(16),
    origin_ca_b64: Joi.string().max(Math.ceil(MAX_CA_BYTES * 4 / 3) + 16),
    mtls: Joi.object({
      credential_id: Joi.number().integer().positive().required(),
      hosts: Joi.array().items(Joi.string().max(253)).min(1).max(16).required(),
    }).optional(),
  }).optional(),
}).required();

function validateRepoProfile(value) {
  const { error, value: validated } = profileSchema.validate(value, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: false,
    convert: true,
  });
  if (error) {
    return { error };
  }

  const issues = [];
  for (const key of Object.keys(validated)) {
    if (!TOP_LEVEL.has(key)) issues.push(`unknown profile field: ${key}`);
  }
  if (Array.isArray(validated.flaky_tests) && validated.flaky_tests.length > 0) {
    issues.push('profile flaky_tests are not implemented until fg-39 slice 3');
  }
  if (Array.isArray(validated.caches) && validated.caches.length > 0) {
    issues.push('profile caches are not implemented until D9/fg-44');
  }
  const envError = envIssue(validated.env);
  if (envError) issues.push(envError);

  if (Array.isArray(validated.services) && validated.services.length > 0) {
    const names = new Set();
    const connectionEnvs = new Set();
    const profileEnvKeys = new Set(Object.keys(validated.env || {}));
    validated.services.forEach((service, index) => {
      const prefix = `services[${index}]`;
      for (const key of Object.keys(service)) {
        if (!SERVICE_KEYS.has(key)) issues.push(`unknown ${prefix} field: ${key}`);
      }
      if (!SERVICE_NAME.test(service.name || '')) {
        issues.push(`${prefix}.name must match ${SERVICE_NAME}`);
      } else if (names.has(service.name)) {
        issues.push(`${prefix}.name must be unique`);
      } else {
        names.add(service.name);
      }
      for (const key of Object.keys(service.healthcheck || {})) {
        if (!HEALTHCHECK_KEYS.has(key)) {
          issues.push(`unknown ${prefix}.healthcheck field: ${key}`);
        }
      }
      const serviceEnvIssue = envIssue(service.env);
      if (serviceEnvIssue) {
        issues.push(`${prefix}.env: ${serviceEnvIssue}`);
      }
      const passwordEnv = service.password_env || null;
      if (passwordEnv && service.env && Object.hasOwn(service.env, passwordEnv)) {
        issues.push(`${prefix}.env must not set password_env "${passwordEnv}"`);
      }
      if (passwordEnv && !String(service.connection_url).includes('${password}')) {
        issues.push(`${prefix}.connection_url must include \${password} when password_env is set`);
      }
      if (!passwordEnv && String(service.connection_url).includes('${password}')) {
        issues.push(`${prefix}.connection_url uses \${password} without password_env`);
      }
      if (!String(service.connection_url).includes('${host}')) {
        issues.push(`${prefix}.connection_url must include \${host}`);
      }
      for (const match of String(service.connection_url).matchAll(/\$\{([^}]+)\}/g)) {
        if (match[1] !== 'host' && match[1] !== 'password') {
          issues.push(`${prefix}.connection_url has unsupported placeholder \${${match[1]}}`);
        }
      }
      if (/\/\/[^/\s]*:[^/\s]*@/.test(service.connection_url)
          && !String(service.connection_url).includes('${password}')) {
        issues.push(`${prefix}.connection_url must use \${password}, not a literal credential`);
      }
      if (profileEnvKeys.has(service.connection_env)) {
        issues.push(`${prefix}.connection_env "${service.connection_env}" conflicts with profile env`);
      }
      if (connectionEnvs.has(service.connection_env)) {
        issues.push(`${prefix}.connection_env "${service.connection_env}" is duplicated`);
      } else {
        connectionEnvs.add(service.connection_env);
      }
      if (service.password_env === '') delete service.password_env;
    });
  }

  if (validated.timeouts) {
    const timeoutKeys = new Set(['setup_minutes', 'verify_minutes']);
    for (const key of Object.keys(validated.timeouts)) {
      if (!timeoutKeys.has(key)) issues.push(`unknown timeouts field: ${key}`);
    }
  }

  if (validated.egress) {
    const egressKeys = new Set(['tls_mode', 'origin_ca_hosts', 'origin_ca_b64', 'mtls']);
    for (const key of Object.keys(validated.egress)) {
      if (!egressKeys.has(key)) issues.push(`unknown egress field: ${key}`);
    }
    const hasCaHosts = Array.isArray(validated.egress.origin_ca_hosts)
      && validated.egress.origin_ca_hosts.length > 0;
    const hasCaBundle = typeof validated.egress.origin_ca_b64 === 'string'
      && validated.egress.origin_ca_b64.length > 0;
    if (hasCaHosts !== hasCaBundle) {
      issues.push('egress.origin_ca_hosts and origin_ca_b64 must be set together');
    }
    if (hasCaHosts) {
      const hosts = [];
      for (const host of validated.egress.origin_ca_hosts) {
        const result = normalizeExactHost(host);
        if (result.error) issues.push(result.error);
        else hosts.push(result.host);
      }
      const caError = caBundleIssue(validated.egress.origin_ca_b64);
      if (caError) issues.push(caError);
      if (hosts.length > 0) validated.egress.origin_ca_hosts = hosts;
    }
    if (validated.egress.mtls) {
      const mtlsKeys = new Set(['credential_id', 'hosts']);
      for (const key of Object.keys(validated.egress.mtls)) {
        if (!mtlsKeys.has(key)) issues.push(`unknown egress.mtls field: ${key}`);
      }
      const hosts = [];
      for (const host of validated.egress.mtls.hosts || []) {
        const result = normalizeExactHost(host);
        if (result.error) issues.push(result.error.replace('egress.origin_ca_hosts', 'egress.mtls.hosts'));
        else hosts.push(result.host);
      }
      if (hosts.length > 0) validated.egress.mtls.hosts = hosts;
    }
    if (!hasCaHosts && !validated.egress.mtls) {
      issues.push('egress must configure origin_ca_hosts/origin_ca_b64 or mtls');
    }
  }

  if (issues.length > 0) {
    return {
      error: {
        details: issues.map((message) => ({ message, path: [] })),
        message: issues.join('; '),
      },
    };
  }

  if (validated.repo_url) validated.repo_url = validated.repo_url.replace(/\.git$/, '');
  for (const key of ['repo_url', 'image', 'base_branch']) {
    if (validated[key] === '') delete validated[key];
  }
  return { value: validated };
}

module.exports = {
  profileSchema,
  validateRepoProfile,
  normalizeExactHost,
  LANGUAGES,
  CACHES,
  SECRET_KEY,
};
