jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

const { pool } = require('../db');
const HarnessPrivacyService = require('../services/HarnessPrivacyService');

const PROJECT = 7;

function policyRow(overrides = {}) {
  return {
    project_id: PROJECT,
    max_data_class: 'confidential',
    allowed_providers: ['opencode-go'],
    require_no_training: false,
    local_only: false,
    local_endpoint: null,
    local_model: null,
    data_residency: null,
    block_on_secret: false,
    block_on_pii: false,
    redact_pii: true,
    event_retention_days: 30,
    artifact_retention_days: 7,
    policy_version: 2,
    updated_at: '2026-11-17T00:00:00Z',
    ...overrides,
  };
}

describe('HarnessPrivacyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('getPolicy', () => {
    it('returns conservative defaults when no project policy exists', async () => {
      const policy = await HarnessPrivacyService.getPolicy(PROJECT);
      expect(policy.source).toBe('default');
      expect(policy.maxDataClass).toBe('confidential');
      expect(policy.blockOnSecret).toBe(false);
      expect(policy.redactPii).toBe(true);
      expect(policy.eventRetentionDays).toBe(30);
    });

    it('maps a project row', async () => {
      pool.query.mockResolvedValueOnce({ rows: [policyRow()] });
      const policy = await HarnessPrivacyService.getPolicy(PROJECT);
      expect(policy.source).toBe('project');
      expect(policy.allowedProviders).toEqual(['opencode-go']);
      expect(policy.policyVersion).toBe(2);
    });
  });

  describe('assertProviderAllowed', () => {
    it('rejects a provider outside the allowlist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [policyRow()] });
      await expect(HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT, provider: 'anthropic',
      })).rejects.toThrow('not allowed by the project privacy policy');
    });

    it('requires the configured local endpoint for local-only projects', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [policyRow({
            local_only: true,
            local_endpoint: 'http://ollama:11434/v1',
            allowed_providers: [],
          })],
        })
        .mockResolvedValueOnce({
          rows: [policyRow({
            local_only: true,
            local_endpoint: 'http://ollama:11434/v1',
            allowed_providers: [],
          })],
        });
      await expect(HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT,
        provider: 'generic',
        providerBaseUrl: 'https://api.example.com/v1',
      })).rejects.toThrow('requires a local/self-hosted model endpoint');

      const policy = await HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT,
        provider: 'generic',
        providerBaseUrl: 'http://ollama:11434/v1',
      });
      expect(policy.localOnly).toBe(true);
    });

    it('requires no-training attestation unless the endpoint is local', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [policyRow({ require_no_training: true })],
        })
        .mockResolvedValueOnce({
          rows: [policyRow({ require_no_training: true })],
        });
      await expect(HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT, provider: 'opencode-go',
      })).rejects.toThrow('no no-training attestation');

      const previous = process.env.HARNESS_NO_TRAINING_PROVIDERS;
      process.env.HARNESS_NO_TRAINING_PROVIDERS = 'opencode-go';
      try {
        const policy = await HarnessPrivacyService.assertProviderAllowed({
          projectId: PROJECT, provider: 'opencode-go',
        });
        expect(policy.requireNoTraining).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.HARNESS_NO_TRAINING_PROVIDERS;
        else process.env.HARNESS_NO_TRAINING_PROVIDERS = previous;
      }
    });

    it('enforces data residency when configured', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [policyRow({ data_residency: 'eu' })],
      });
      await expect(HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT, provider: 'opencode-go', providerRegion: 'us',
      })).rejects.toThrow('does not satisfy project residency');
    });

    it('allows an unconfigured project with a missing provider for legacy rows', async () => {
      const policy = await HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT,
      });
      expect(policy.source).toBe('default');
    });

    it('fails closed when the policy read fails', async () => {
      pool.query.mockRejectedValueOnce(new Error('policy store unavailable'));

      await expect(HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT,
        provider: 'opencode-go',
      })).rejects.toThrow('policy store unavailable');
    });

    it('uses backend provider config as the authoritative endpoint and region', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [policyRow({
            local_only: true,
            local_endpoint: 'http://ollama:11434/v1',
            data_residency: 'eu',
            allowed_providers: [],
          })],
        })
        .mockResolvedValueOnce({
          rows: [{ base_url: 'http://ollama:11434/v1', region: 'eu' }],
        });

      const policy = await HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT,
        agentId: 7,
        provider: 'generic',
      });

      expect(policy.resolvedProviderBaseUrl).toBe('http://ollama:11434/v1');
      expect(policy.resolvedProviderRegion).toBe('eu');
    });

    it('uses endpoint_url when base_url is blank', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [policyRow({
            local_only: true,
            local_endpoint: 'http://ollama:11434/v1',
            data_residency: 'eu',
            allowed_providers: [],
          })],
        })
        .mockResolvedValueOnce({
          rows: [{
            provider_type: 'opencode',
            base_url: '',
            endpoint_url: 'http://ollama:11434/v1',
            region: 'eu',
          }],
        });

      const policy = await HarnessPrivacyService.assertProviderAllowed({
        projectId: PROJECT,
        agentId: 7,
        provider: 'generic',
      });

      expect(policy.resolvedProviderBaseUrl).toBe('http://ollama:11434/v1');
    });
  });

  describe('upsertPolicy', () => {
    it('rejects an unknown data class', async () => {
      await expect(HarnessPrivacyService.upsertPolicy({
        projectId: PROJECT,
        policy: { maxDataClass: 'top-secret' },
      })).rejects.toThrow('maxDataClass must be one of');
    });

    it('normalises and stores a partial policy update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [policyRow()] });
      const policy = await HarnessPrivacyService.upsertPolicy({
        projectId: PROJECT,
        policy: {
          maxDataClass: 'internal',
          allowedProviders: 'OpenAI, opencode_go',
          redactPii: false,
        },
        updatedBy: 1,
      });
      expect(policy.projectId).toBe(PROJECT);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO harness_privacy_policies');
      expect(params[2]).toEqual(['openai', 'opencode-go']);
      expect(params[10]).toBe(false);
    });

    it('clears string fields when the caller sends null', async () => {
      pool.query.mockResolvedValueOnce({ rows: [policyRow()] });
      await HarnessPrivacyService.upsertPolicy({
        projectId: PROJECT,
        policy: {
          localEndpoint: null,
          localModel: null,
          dataResidency: null,
        },
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('CASE WHEN $15 THEN NULL');
      expect(sql).toContain('CASE WHEN $16 THEN NULL');
      expect(sql).toContain('CASE WHEN $17 THEN NULL');
      expect(params.slice(14)).toEqual([true, true, true]);
    });

    it('rejects credentials embedded in a local endpoint', async () => {
      await expect(HarnessPrivacyService.upsertPolicy({
        projectId: PROJECT,
        policy: { localEndpoint: 'http://user:pass@localhost:11434/v1' },
      })).rejects.toThrow('must not contain credentials');
    });

    it('records the full security-relevant policy snapshot in the audit payload', async () => {
      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await HarnessPrivacyService.recordPolicyAudit({
        projectId: PROJECT,
        actorId: 1,
        client,
        policy: {
          policyVersion: 4,
          maxDataClass: 'internal',
          allowedProviders: ['opencode-go'],
          requireNoTraining: true,
          localOnly: true,
          dataResidency: 'eu',
          blockOnSecret: true,
          blockOnPii: true,
          redactPii: false,
          eventRetentionDays: 14,
          artifactRetentionDays: 3,
        },
      });

      const payload = JSON.parse(client.query.mock.calls[0][1][3]);
      expect(payload).toMatchObject({
        action: 'policy_updated',
        policyVersion: 4,
        blockOnSecret: true,
        blockOnPii: true,
        redactPii: false,
        eventRetentionDays: 14,
        artifactRetentionDays: 3,
      });
    });
  });

  describe('deletion', () => {
    it('deletes data classes and writes an audit tombstone in one transaction', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({}) // SET LOCAL
          .mockResolvedValueOnce({ rowCount: 4 }) // events
          .mockResolvedValueOnce({ rowCount: 2 }) // usage
          .mockResolvedValueOnce({ rows: [{ event_id: 'audit-1' }] }) // audit
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const result = await HarnessPrivacyService.deleteProjectData({
        projectId: PROJECT,
        dataClasses: ['events', 'usage'],
        reason: 'request',
        actorId: 1,
      });

      expect(result).toEqual({
        events: 4,
        usage: 2,
        messages: 0,
        checkpoints: 0,
        runs: 0,
        usageLogs: 0,
      });
      const auditInsert = client.query.mock.calls.find(
        (call) => String(call[0]).includes('audit.privacy')
      );
      expect(auditInsert).toBeTruthy();
      expect(auditInsert[1][3]).toContain('"deleted"');
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('deletes every stored run table for the all class', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({}) // SET LOCAL
          .mockResolvedValueOnce({ rowCount: 1 }) // messages
          .mockResolvedValueOnce({ rowCount: 2 }) // usage_logs
          .mockResolvedValueOnce({ rowCount: 3 }) // checkpoints
          .mockResolvedValueOnce({ rowCount: 4 }) // events
          .mockResolvedValueOnce({ rowCount: 5 }) // usage
          .mockResolvedValueOnce({ rowCount: 6 }) // runs
          .mockResolvedValueOnce({ rows: [{ event_id: 'audit-1' }] }) // audit
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const result = await HarnessPrivacyService.deleteProjectData({
        projectId: PROJECT,
        dataClasses: ['all'],
        reason: 'subject request',
        actorId: 1,
      });

      expect(result).toEqual({
        events: 4,
        usage: 5,
        messages: 1,
        checkpoints: 3,
        runs: 6,
        usageLogs: 2,
      });
      const sql = client.query.mock.calls.map((call) => String(call[0])).join('\n');
      expect(sql).toContain('DELETE FROM ticket_messages');
      expect(sql).toContain('DELETE FROM usage_logs');
      expect(sql).toContain('DELETE FROM harness_checkpoints');
      expect(sql).toContain('DELETE FROM harness_events');
      expect(sql).toContain('DELETE FROM harness_usage');
      expect(sql).toContain('DELETE FROM harness_runs');
    });

    it('rolls back on failure', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('delete failed'))
          .mockResolvedValueOnce({}),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);
      await expect(HarnessPrivacyService.deleteProjectData({
        projectId: PROJECT, dataClasses: ['events'],
      })).rejects.toThrow('delete failed');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });
  });

  describe('export', () => {
    it('returns a consistent snapshot with all stored run tables', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [policyRow()] })
          .mockResolvedValueOnce({ rows: [{ event_id: 'e1' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'u1' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'c1' }] })
          .mockResolvedValueOnce({
            rows: [{
              id: 'm1',
              content: 'mail alice@example.com token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
              metadata: {
                password: 'hunter2',
                nested: { token: 'abc123' },
                ticket_count: 3,
              },
            }],
          })
          .mockResolvedValueOnce({ rows: [{ id: 'l1' }] })
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const data = await HarnessPrivacyService.exportProjectData(PROJECT);
      expect(data.projectId).toBe(PROJECT);
      expect(data.events).toHaveLength(1);
      expect(data.usage).toHaveLength(1);
      expect(data.runs).toHaveLength(1);
      expect(data.checkpoints).toHaveLength(1);
      expect(data.messages).toHaveLength(1);
      expect(data.usageLogs).toHaveLength(1);
      expect(data.hasMore).toBe(false);
      expect(data.nextOffset).toBeNull();
      expect(data.messages[0].content).toContain('[REDACTED_EMAIL]');
      expect(data.messages[0].content).not.toContain('alice@example.com');
      expect(data.messages[0].content).not.toContain('ghp_');
      expect(data.messages[0].metadata.password).toBe('[REDACTED]');
      expect(data.messages[0].metadata.nested.token).toBe('[REDACTED]');
      expect(data.messages[0].metadata.ticket_count).toBe(3);
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('paginates with an offset and nextOffset', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [policyRow()] })
          .mockResolvedValueOnce({ rows: [{ event_id: 'e1' }, { event_id: 'e2' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const data = await HarnessPrivacyService.exportProjectData(PROJECT, {
        limit: 1,
        offset: 2,
      });

      expect(data.events).toHaveLength(1);
      expect(data.hasMore).toBe(true);
      expect(data.nextOffset).toBe(3);
      expect(client.query.mock.calls[2][1]).toEqual([PROJECT, 2, 2]);
    });
  });
});
