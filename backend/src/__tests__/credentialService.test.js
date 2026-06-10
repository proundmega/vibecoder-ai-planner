const CredentialService = require('../services/CredentialService');
const { encrypt, decrypt, maskToken } = require('../utils/crypto');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));
jest.mock('../utils/crypto');

const { pool } = require('../db');

describe('CredentialService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    encrypt.mockReturnValue('encrypted-key-data');
    decrypt.mockReturnValue('my-secret-api-key');
    maskToken.mockImplementation((key) => '••••' + key.slice(-4));
  });

  describe('addCredential', () => {
    it('should encrypt and store a credential', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          name: 'Anthropic API Key',
          credential_type: 'anthropic',
          key_encrypted: 'encrypted-key-data',
          key_masked: '••••c123',
          metadata: {},
          created_by: 1,
          expires_at: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const result = await CredentialService.addCredential(
        1, 'Anthropic API Key', 'anthropic', 'sk-ant-api03-abc123', {}, 1
      );

      expect(encrypt).toHaveBeenCalledWith('sk-ant-api03-abc123');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO project_credentials'),
        expect.arrayContaining([
          1,
          'Anthropic API Key',
          'anthropic',
          'encrypted-key-data',
          '••••c123',
          {},
          1,
        ])
      );
      expect(result.id).toBe(1);
    });
  });

  describe('listCredentials', () => {
    it('should return masked credentials for a project', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            project_id: 1,
            name: 'Anthropic API Key',
            credential_type: 'anthropic',
            key_masked: '••••p123',
            metadata: '{}',
            expires_at: null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await CredentialService.listCredentials(1);

      expect(result).toHaveLength(1);
      expect(result[0].key_masked).toBe('••••p123');
    });
  });

  describe('getCredential', () => {
    it('should return a credential by id', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          name: 'Anthropic API Key',
          credential_type: 'anthropic',
          key_encrypted: 'encrypted-key-data',
          key_masked: '••••p123',
          metadata: '{}',
          created_by: 1,
          expires_at: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const result = await CredentialService.getCredential(1, 1);

      expect(result).not.toBeNull();
      expect(result.id).toBe(1);
    });

    it('should return null if credential not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await CredentialService.getCredential(1, 999);

      expect(result).toBeNull();
    });
  });

  describe('updateCredential', () => {
    it('should update a credential and re-encrypt if key changed', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          name: 'Anthropic API Key (Updated)',
          credential_type: 'anthropic',
          key_encrypted: 'encrypted-new-key',
          key_masked: '••••n456',
          metadata: '{}',
          created_by: 1,
          expires_at: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const result = await CredentialService.updateCredential(1, {
        name: 'Anthropic API Key (Updated)',
        key: 'sk-ant-api03-new456',
      });

      expect(encrypt).toHaveBeenCalledWith('sk-ant-api03-new456');
      expect(result.name).toBe('Anthropic API Key (Updated)');
    });
  });

  describe('deleteCredential', () => {
    it('should soft delete a credential', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 1,
          is_active: false,
          updated_at: new Date(),
        }],
      });

      const result = await CredentialService.deleteCredential(1);

      expect(result).not.toBeNull();
      expect(result.is_active).toBe(false);
    });

    it('should return null if credential already inactive', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await CredentialService.deleteCredential(999);

      expect(result).toBeNull();
    });
  });

  describe('rotateCredential', () => {
    it('should deactivate old key and create new one', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 2,
            project_id: 1,
            name: 'Anthropic API Key',
            credential_type: 'anthropic',
            key_encrypted: 'encrypted-new-key',
            key_masked: '••••ated',
            metadata: '{}',
            created_by: 1,
            expires_at: null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          }],
        });

      const result = await CredentialService.rotateCredential(1, 1, 'sk-ant-api03-rotated', 1);

     expect(result.id).toBe(2);
      expect(result.key_masked).toBe('••••ated');
    });
  });

  describe('getDecryptedKey', () => {
    it('should return decrypted key for active credential', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ key_encrypted: 'encrypted-key-data' }],
      });

      const result = await CredentialService.getDecryptedKey(1, 'anthropic');

      expect(result).toBe('my-secret-api-key');
      expect(decrypt).toHaveBeenCalledWith('encrypted-key-data');
    });

    it('should return null if no active credential', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await CredentialService.getDecryptedKey(1, 'openai');

      expect(result).toBeNull();
    });
  });

  describe('maskToken', () => {
    it('should mask long keys showing last 4 chars', () => {
      expect(CredentialService.maskToken('sk-ant-api03-abc123def456')).toBe('•••••••••••••••••••••f456');
    });

    it('should return unmasked for 4-char keys', () => {
      expect(CredentialService.maskToken('1234')).toBe('1234');
    });

    it('should return •••• for null/undefined', () => {
      expect(CredentialService.maskToken(null)).toBe('••••');
      expect(CredentialService.maskToken(undefined)).toBe('••••');
    });
  });
});
