const fs = require('fs');
const path = require('path');

jest.mock('../db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
}));

jest.mock('../models/project', () => ({
  findById: jest.fn(),
}));

jest.mock('../services/GitHubService', () => ({
  getProjectRepo: jest.fn(),
  readRepoFile: jest.fn(),
}));

jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn((value) => `enc:${value}`),
  decrypt: jest.fn((value) => String(value).replace(/^enc:/, '')),
  maskToken: jest.fn(() => '****'),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const RepoProfileService = require('../services/RepoProfileService');
const Project = require('../models/project');
const { pool } = require('../db');

const CERT = fs.readFileSync(
  path.join(__dirname, '../../../agent/src/test/resources/egress-client-cert.pem'),
  'utf8'
);
const KEY = fs.readFileSync(
  path.join(__dirname, '../../../agent/src/test/resources/egress-client-key.pem'),
  'utf8'
);
const CA_CERT = fs.readFileSync(
  path.join(__dirname, '../../../agent/src/test/resources/egress-client-ca.pem'),
  'utf8'
);
const OTHER_CERT = fs.readFileSync(
  path.join(__dirname, '../../../agent/src/test/resources/egress-origin-leaf.pem'),
  'utf8'
);

const OWNER = { userId: 7, id: 7, role: 'project_admin' };

function credentialRow(overrides = {}) {
  return {
    id: 5,
    project_id: 1,
    name: 'registry-client',
    credential_type: 'custom',
    key_encrypted: `enc:${KEY}`,
    key_masked: '[redacted]',
    is_active: true,
    metadata: {
      kind: 'mtls-client',
      hosts: ['registry.example.com'],
      cert_b64: Buffer.from(CERT).toString('base64'),
      cert_sha256: 'abc123',
    },
    created_at: '2026-11-16T00:00:00Z',
    updated_at: '2026-11-16T00:00:00Z',
    ...overrides,
  };
}

describe('RepoProfile mTLS credentials (D29)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Project.findById.mockResolvedValue({ id: 1, ownerId: 7 });
    pool.query.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores a client cert/key pair encrypted and returns no private key', async () => {
    pool.query.mockResolvedValueOnce({ rows: [credentialRow()] });

    const result = await RepoProfileService.createMtlsCredential(1, {
      name: ' registry-client ',
      hosts: ['Registry.Example.com.'],
      cert_b64: Buffer.from(CERT).toString('base64'),
      key_b64: Buffer.from(KEY).toString('base64'),
    }, OWNER);

    expect(result).toEqual(expect.objectContaining({
      id: 5,
      name: 'registry-client',
      hosts: ['registry.example.com'],
      is_active: true,
    }));
    expect(result.key_b64).toBeUndefined();
    expect(result.cert_b64).toBeUndefined();

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("credential_type, key_encrypted, key_masked, metadata");
    expect(params[1]).toBe('registry-client');
    expect(params[2]).toBe(`enc:${KEY}`);
    expect(params[3]).toBe('[redacted]');
    const metadata = JSON.parse(params[4]);
    expect(metadata.kind).toBe('mtls-client');
    expect(metadata.hosts).toEqual(['registry.example.com']);
    expect(metadata.cert_b64).toBe(Buffer.from(CERT).toString('base64'));
    expect(metadata.cert_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a cert/key mismatch, a CA certificate and non-exact hosts', async () => {
    await expect(RepoProfileService.createMtlsCredential(1, {
      name: 'bad',
      hosts: ['registry.example.com'],
      cert_b64: Buffer.from(OTHER_CERT).toString('base64'),
      key_b64: Buffer.from(KEY).toString('base64'),
    }, OWNER)).rejects.toThrow(/does not match/);

    await expect(RepoProfileService.createMtlsCredential(1, {
      name: 'ca',
      hosts: ['registry.example.com'],
      cert_b64: Buffer.from(CA_CERT).toString('base64'),
      key_b64: Buffer.from(KEY).toString('base64'),
    }, OWNER)).rejects.toThrow(/not a CA/);

    await expect(RepoProfileService.createMtlsCredential(1, {
      name: 'wildcard',
      hosts: ['*.example.com'],
      cert_b64: Buffer.from(CERT).toString('base64'),
      key_b64: Buffer.from(KEY).toString('base64'),
    }, OWNER)).rejects.toThrow(/exact hostnames/);
  });

  it('rejects a profile mTLS reference that is missing, inactive or out of scope', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(RepoProfileService.assertMtlsReference(1, {
      mtls: { credential_id: 5, hosts: ['registry.example.com'] },
    })).rejects.toThrow(/does not belong/);

    pool.query.mockResolvedValueOnce({ rows: [credentialRow({ is_active: false })] });
    await expect(RepoProfileService.assertMtlsReference(1, {
      mtls: { credential_id: 5, hosts: ['registry.example.com'] },
    })).rejects.toThrow(/inactive/);

    pool.query.mockResolvedValueOnce({ rows: [credentialRow()] });
    await expect(RepoProfileService.assertMtlsReference(1, {
      mtls: { credential_id: 5, hosts: ['other.example.com'] },
    })).rejects.toThrow(/not scoped/);

    pool.query.mockResolvedValueOnce({
      rows: [credentialRow({ metadata: { kind: 'not-mtls', hosts: ['registry.example.com'] } })],
    });
    await expect(RepoProfileService.assertMtlsReference(1, {
      mtls: { credential_id: 5, hosts: ['registry.example.com'] },
    })).rejects.toThrow(/not an mTLS/);
  });

  it('accepts a reference whose hosts are scoped to the credential', async () => {
    pool.query.mockResolvedValueOnce({ rows: [credentialRow()] });
    await expect(RepoProfileService.assertMtlsReference(1, {
      mtls: { credential_id: 5, hosts: ['registry.example.com'] },
    })).resolves.toBeUndefined();
  });

  it('scopes material to the exact profile revision and its effective hosts', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'profile-1',
          project_id: 1,
          version: 3,
          profile: {
            egress: { mtls: { credential_id: 5, hosts: ['registry.example.com'] } },
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [credentialRow({
          metadata: {
            kind: 'mtls-client',
            hosts: ['registry.example.com', 'other.example.com'],
            cert_b64: Buffer.from(CERT).toString('base64'),
            cert_sha256: 'abc123',
          },
        })],
      });

    const material = await RepoProfileService.getMtlsMaterialForAgent(
      1, { id: 9, owner_id: 7 }, 'profile-1', 3);

    expect(material.profile_id).toBe('profile-1');
    expect(material.profile_version).toBe(3);
    expect(material.credential_id).toBe(5);
    expect(material.hosts).toEqual(['registry.example.com']);
    expect(pool.query.mock.calls[1][0]).toContain("credential_type = 'custom'");
  });

  it('releases scoped material to the project-owner agent only', async () => {
    jest.spyOn(RepoProfileService, 'getActive').mockResolvedValue({
      id: 'profile-1',
      profile: {
        egress: { mtls: { credential_id: 5, hosts: ['registry.example.com'] } },
      },
    });
    pool.query.mockResolvedValueOnce({ rows: [credentialRow()] });

    const material = await RepoProfileService.getMtlsMaterialForAgent(
      1, { id: 9, owner_id: 7 });

    expect(material.hosts).toEqual(['registry.example.com']);
    expect(material.cert_b64).toBe(Buffer.from(CERT).toString('base64'));
    expect(Buffer.from(material.key_b64, 'base64').toString('utf8')).toBe(KEY);
    expect(material.cert_sha256).toBe('abc123');
    expect(material.key_encrypted).toBeUndefined();
  });

  it('returns null when the active profile has no mTLS block', async () => {
    jest.spyOn(RepoProfileService, 'getActive').mockResolvedValue({
      id: 'profile-1',
      profile: { egress: { origin_ca_hosts: ['registry.example.com'] } },
    });

    await expect(
      RepoProfileService.getMtlsMaterialForAgent(1, { id: 9, owner_id: 7 })
    ).resolves.toBeNull();
  });

  it('lists and deactivates mTLS credentials without keys', async () => {
    pool.query.mockResolvedValueOnce({ rows: [credentialRow()] });
    const listed = await RepoProfileService.listMtlsCredentials(1, OWNER);
    expect(listed[0].id).toBe(5);
    expect(listed[0].key_encrypted).toBeUndefined();

    pool.query
      .mockResolvedValueOnce({ rows: [] }) // not referenced by a profile
      .mockResolvedValueOnce({ rows: [credentialRow({ is_active: false })] });
    const deleted = await RepoProfileService.deleteMtlsCredential(1, 5, OWNER);
    expect(deleted.is_active).toBe(false);
    expect(pool.query.mock.calls[2][0]).toContain('SET is_active = FALSE');
  });

  it('refuses to deactivate a credential referenced by a profile', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ exists: true }] });

    await expect(RepoProfileService.deleteMtlsCredential(1, 5, OWNER))
      .rejects.toThrow(/still referenced/);
  });
});
