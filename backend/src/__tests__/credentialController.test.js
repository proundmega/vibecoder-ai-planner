const credentialController = require('../controllers/credentialController');
const CredentialService = require('../services/CredentialService');
const Project = require('../models/project');
const { encrypt, decrypt, maskToken } = require('../utils/crypto');

jest.mock('../services/CredentialService');
jest.mock('../models/project', () => ({
  findById: jest.fn(),
}));
jest.mock('../utils/crypto');

describe('Credential Controller', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockReq = {
      params: {},
      body: {},
      query: {},
      user: { userId: 1, role: 'project_admin' },
    };
    encrypt.mockReturnValue('encrypted-key');
    decrypt.mockReturnValue('decrypted-key');
    maskToken.mockImplementation((key) => '••••' + key.slice(-4));
  });

  describe('addCredential', () => {
    it('should add a credential with 201 status', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      CredentialService.addCredential.mockResolvedValue({
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
      });

      mockReq.params.id = '1';
      mockReq.body = {
        name: 'Anthropic API Key',
        type: 'anthropic',
        key: 'sk-ant-api03-abc123',
      };

      await credentialController.addCredential(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          name: 'Anthropic API Key',
          credentialType: 'anthropic',
          keyMasked: '••••p123',
        }),
      });
    });

    it('should return 400 if required fields missing', async () => {
      Project.findById.mockResolvedValue({ id: 1 });

      mockReq.params.id = '1';
      mockReq.body = { name: 'Test', type: 'anthropic' };

      await credentialController.addCredential(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('listCredentials', () => {
    it('should list all credentials for a project', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      CredentialService.listCredentials.mockResolvedValue([
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
      ]);

      mockReq.params.id = '1';

      await credentialController.listCredentials(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            name: 'Anthropic API Key',
            credentialType: 'anthropic',
            keyMasked: '••••p123',
          }),
        ]),
      });
    });
  });

  describe('updateCredential', () => {
    it('should update a credential', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      CredentialService.getCredential.mockResolvedValue({ id: 1, project_id: 1 });
      CredentialService.updateCredential.mockResolvedValue({
        id: 1,
        project_id: 1,
        name: 'Updated Name',
        credential_type: 'anthropic',
        key_masked: '••••n456',
        metadata: '{}',
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      mockReq.params.id = '1';
      mockReq.params.credentialId = '1';
      mockReq.body = { name: 'Updated Name' };

      await credentialController.updateCredential(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          name: 'Updated Name',
        }),
      });
    });
  });

  describe('deleteCredential', () => {
    it('should deactivate a credential', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      CredentialService.deleteCredential.mockResolvedValue({
        id: 1,
        project_id: 1,
        is_active: false,
      });

      mockReq.params.id = '1';
      mockReq.params.credentialId = '1';

      await credentialController.deleteCredential(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { message: 'Credential deactivated' },
      });
    });
  });

  describe('rotateCredential', () => {
    it('should rotate a credential with new key', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      CredentialService.rotateCredential.mockResolvedValue({
        id: 2,
        project_id: 1,
        name: 'Anthropic API Key',
        credential_type: 'anthropic',
        key_masked: '••••n789',
        metadata: '{}',
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      mockReq.params.id = '1';
      mockReq.params.credentialId = '1';
      mockReq.body = { key: 'sk-ant-api03-newkey' };

      await credentialController.rotateCredential(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          keyMasked: '••••n789',
        }),
      });
    });
  });

  describe('getDecryptedKey', () => {
    it('should return decrypted key for agent use', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      CredentialService.getDecryptedKey.mockResolvedValue('sk-ant-api03-decrypted');

      mockReq.params.id = '1';
      mockReq.query = { type: 'anthropic' };

      await credentialController.getDecryptedKey(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: {
          credentialType: 'anthropic',
          key: 'sk-ant-api03-decrypted',
        },
      });
    });
  });
});
