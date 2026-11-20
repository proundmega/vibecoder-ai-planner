const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const ProviderRegistryService = require('../services/ProviderRegistryService');
const {
  credentialCreateSchema,
  credentialUpdateSchema,
  modelCreateSchema,
  modelPatchSchema,
} = require('../validators/providerRegistry');

const router = express.Router();

function errorBody(code, message) {
  return { success: false, error: { code, message } };
}

function fail(res, error) {
  if (error.status) {
    return res.status(error.status).json(errorBody(error.code, error.message));
  }
  return res.status(500).json(errorBody('INTERNAL_SERVER_ERROR', 'Request failed'));
}

router.get('/provider-credentials', verifyToken, async (req, res, next) => {
  try {
    const data = await ProviderRegistryService.list(req.user);
    res.json({ success: true, data });
  } catch (error) {
    if (error.status) return fail(res, error);
    next(error);
  }
});

router.post(
  '/provider-credentials',
  verifyToken,
  validate(credentialCreateSchema),
  async (req, res, next) => {
    try {
      const data = await ProviderRegistryService.create(req.user, {
        projectId: req.body.projectId ?? null,
        name: req.body.name,
        providerType: req.body.providerType,
        apiKey: req.body.apiKey,
        baseUrl: req.body.baseUrl || null,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.patch(
  '/provider-credentials/:id',
  verifyToken,
  validate(credentialUpdateSchema),
  async (req, res, next) => {
    try {
      const data = await ProviderRegistryService.update(req.user, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.delete('/provider-credentials/:id', verifyToken, async (req, res, next) => {
  try {
    const data = await ProviderRegistryService.remove(req.user, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if (error.status) return fail(res, error);
    next(error);
  }
});

router.post('/provider-credentials/:id/discover', verifyToken, async (req, res, next) => {
  try {
    const data = await ProviderRegistryService.discover(req.user, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if (error.status) return fail(res, error);
    next(error);
  }
});

router.post(
  '/provider-credentials/:id/models',
  verifyToken,
  validate(modelCreateSchema),
  async (req, res, next) => {
    try {
      const data = await ProviderRegistryService.addModel(req.user, req.params.id, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.patch(
  '/provider-models/:id',
  verifyToken,
  validate(modelPatchSchema),
  async (req, res, next) => {
    try {
      const data = await ProviderRegistryService.patchModel(req.user, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.delete('/provider-models/:id', verifyToken, async (req, res, next) => {
  try {
    const data = await ProviderRegistryService.removeModel(req.user, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if (error.status) return fail(res, error);
    next(error);
  }
});

router.post('/provider-models/:id/test', verifyToken, async (req, res, next) => {
  try {
    const data = await ProviderRegistryService.testModel(req.user, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    if (error.status) return fail(res, error);
    next(error);
  }
});

module.exports = router;
