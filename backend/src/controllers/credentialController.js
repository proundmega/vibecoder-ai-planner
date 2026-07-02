const CredentialService = require('../services/CredentialService');
const { NotFoundError } = require('../errors/HttpError');
const Project = require('../models/project');

async function addCredential(req, res, next) {
  try {
    const { projectId } = req.params;
    const { name, type, key, metadata, expiresAt } = req.body;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    if (!name || !type || !key) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'name, type, and key are required',
        },
      });
    }

    const credential = await CredentialService.addCredential(
      projectId, name, type, key, metadata || {}, req.user.userId
    );

    res.status(201).json({
      success: true,
      data: {
        id: credential.id,
        projectId: credential.project_id,
        name: credential.name,
        credentialType: credential.credential_type,
        keyMasked: credential.key_masked,
        metadata: credential.metadata,
        expiresAt: credential.expires_at,
        isActive: credential.is_active,
        createdAt: credential.created_at,
        updatedAt: credential.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function listCredentials(req, res, next) {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const credentials = await CredentialService.listCredentials(projectId);

    res.json({
      success: true,
      data: credentials.map(c => ({
        id: c.id,
        projectId: c.project_id,
        name: c.name,
        credentialType: c.credential_type,
        keyMasked: c.key_masked,
        metadata: c.metadata,
        expiresAt: c.expires_at,
        isActive: c.is_active,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function updateCredential(req, res, next) {
  try {
    const { projectId, credentialId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const existing = await CredentialService.getCredential(projectId, credentialId);
    if (!existing) throw new NotFoundError('Credential not found');

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.type !== undefined) updates.credentialType = req.body.type;
    if (req.body.key !== undefined) updates.key = req.body.key;
    if (req.body.metadata !== undefined) updates.metadata = req.body.metadata;
    if (req.body.expiresAt !== undefined) updates.expiresAt = req.body.expiresAt;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

    const credential = await CredentialService.updateCredential(credentialId, updates);

    if (!credential) throw new NotFoundError('Credential not found');

    res.json({
      success: true,
      data: {
        id: credential.id,
        projectId: credential.project_id,
        name: credential.name,
        credentialType: credential.credential_type,
        keyMasked: credential.key_masked,
        metadata: credential.metadata,
        expiresAt: credential.expires_at,
        isActive: credential.is_active,
        createdAt: credential.created_at,
        updatedAt: credential.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function deleteCredential(req, res, next) {
  try {
    const { projectId, credentialId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const credential = await CredentialService.deleteCredential(credentialId);

    if (!credential) throw new NotFoundError('Credential not found');

    res.json({
      success: true,
      data: { message: 'Credential deactivated' },
    });
  } catch (error) {
    next(error);
  }
}

async function rotateCredential(req, res, next) {
  try {
    const { projectId, credentialId } = req.params;
    const { key } = req.body;

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    if (!key) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'New key is required for rotation',
        },
      });
    }

    const credential = await CredentialService.rotateCredential(
      projectId, credentialId, key, req.user.userId
    );

    if (!credential) throw new NotFoundError('Credential not found');

    res.json({
      success: true,
      data: {
        id: credential.id,
        projectId: credential.project_id,
        name: credential.name,
        credentialType: credential.credential_type,
        keyMasked: credential.key_masked,
        metadata: credential.metadata,
        expiresAt: credential.expires_at,
        isActive: credential.is_active,
        createdAt: credential.created_at,
        updatedAt: credential.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getDecryptedKey(req, res, next) {
  try {
    const { projectId } = req.params;
    const { type } = req.query;

    if (!type) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'type query parameter is required',
        },
      });
    }

    const project = await Project.findById(projectId);
    if (!project) throw new NotFoundError('Project not found');

    const key = await CredentialService.getDecryptedKey(projectId, type);

    if (!key) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `No active ${type} credential configured for this project`,
        },
      });
    }

    res.json({
      success: true,
      data: {
        credentialType: type,
        key: key,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  addCredential,
  listCredentials,
  updateCredential,
  deleteCredential,
  rotateCredential,
  getDecryptedKey,
};
