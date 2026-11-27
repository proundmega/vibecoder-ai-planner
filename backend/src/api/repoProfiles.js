const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { forProjectParam } = require('../middleware/agentProjectScope');
const { requireRuntime, requireProjectGrant } = require('../middleware/agentRole');
const RepoProfileService = require('../services/RepoProfileService');
const RepoProfileValidationService = require('../services/RepoProfileValidationService');
const { ForbiddenError, ValidationError } = require('../errors/HttpError');
const { validate } = require('../middleware/validate');
const { validationListQuerySchema } = require('../validators/repoProfiles');

function requireAgent(req) {
  if (!req.agent || !req.agent.id) {
    throw new ForbiddenError('Agent API key required');
  }
  return req.agent;
}

function requireAgentRuntime(req) {
  if (!req.runtime || !req.runtime.id) {
    throw new ForbiddenError('Agent runtime required');
  }
  return req.runtime.id;
}

function operator(req) {
  return req.user || {};
}

/**
 * @openapi
 * /projects/{projectId}/repo-profile:
 *   get:
 *     tags: [Repo Profiles]
 *     summary: Get the active repo profile and version history
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Active profile, latest profile and versions
 */
router.get('/:projectId/repo-profile', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.getCurrent(req.params.projectId, operator(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/versions:
 *   get:
 *     tags: [Repo Profiles]
 *     summary: List repo profile versions
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Profile versions
 */
router.get('/:projectId/repo-profile/versions', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.listVersions(req.params.projectId, operator(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/events:
 *   get:
 *     tags: [Repo Profiles]
 *     summary: List repo profile lifecycle events
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *     responses:
 *       200:
 *         description: Profile lifecycle events
 *       400:
 *         description: Invalid pagination parameters
 *       403:
 *         description: Only the project owner or a super admin can read profile events
 */
router.get('/:projectId/repo-profile/events', verifyToken,
  validate({ query: validationListQuerySchema }), async (req, res, next) => {
  try {
    const data = await RepoProfileService.listEvents(
      req.params.projectId, operator(req), req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile:
 *   post:
 *     tags: [Repo Profiles]
 *     summary: Create a draft repo profile version
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: fg-39 profile v1
 *     responses:
 *       201:
 *         description: Draft profile created
 *       400:
 *         description: Invalid profile
 */
router.post('/:projectId/repo-profile', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.create(req.params.projectId, req.body, operator(req));
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/detect:
 *   post:
 *     tags: [Repo Profiles]
 *     summary: Detect a repo profile from GitHub manifests
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Proposed profile and warnings
 */
router.post('/:projectId/repo-profile/detect', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.detect(req.params.projectId, operator(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/{profileId}:
 *   put:
 *     tags: [Repo Profiles]
 *     summary: Edit a draft repo profile
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: path
 *         name: profileId
 *         required: true
 *         schema: { type: string, pattern: '^[0-9a-fA-F-]{36}$' }
 *     responses:
 *       200:
 *         description: Updated draft
 */
router.put('/:projectId/repo-profile/:profileId', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.update(
      req.params.projectId,
      req.params.profileId,
      req.body,
      operator(req)
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/{profileId}/activate:
 *   post:
 *     tags: [Repo Profiles]
 *     summary: Activate one repo profile version
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: path
 *         name: profileId
 *         required: true
 *         schema: { type: string, pattern: '^[0-9a-fA-F-]{36}$' }
 *     responses:
 *       200:
 *         description: Activated profile
 *       400:
 *         description: Retired draft, missing successful dry run or invalid profile
 */
router.post('/:projectId/repo-profile/:profileId/activate', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.activate(
      req.params.projectId,
      req.params.profileId,
      operator(req)
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/{profileId}/validate:
 *   post:
 *     tags: [Repo Profiles]
 *     summary: Queue a dry-run validation for a profile
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: path
 *         name: profileId
 *         required: true
 *         schema: { type: string, pattern: '^[0-9a-fA-F-]{36}$' }
 *     responses:
 *       201:
 *         description: Validation queued
 *       400:
 *         description: Retired draft or invalid profile
 *       409:
 *         description: A validation is already queued/running
 */
router.post('/:projectId/repo-profile/:profileId/validate', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileValidationService.request(
      req.params.projectId,
      req.params.profileId,
      operator(req)
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/validations:
 *   get:
 *     tags: [Repo Profiles]
 *     summary: List dry-run validations
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *     responses:
 *       200:
 *         description: Validation history
 *       400:
 *         description: Invalid pagination parameters
 */
router.get('/:projectId/repo-profile/validations', verifyToken,
  validate({ query: validationListQuerySchema }), async (req, res, next) => {
  try {
    const data = await RepoProfileValidationService.list(
      req.params.projectId, operator(req), req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/validations/{validationId}:
 *   get:
 *     tags: [Repo Profiles]
 *     summary: Get one dry-run validation
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: path
 *         name: validationId
 *         required: true
 *         schema: { type: string, pattern: '^[0-9a-fA-F-]{36}$' }
 *     responses:
 *       200:
 *         description: Validation status and result
 */
router.get('/:projectId/repo-profile/validations/:validationId', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileValidationService.get(
      req.params.projectId,
      req.params.validationId,
      operator(req)
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/agent:
 *   get:
 *     tags: [Repo Profiles]
 *     summary: Get the active repo profile for the agent
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Active profile or null
 */
router.get('/:projectId/repo-profile/agent', verifyTokenOrAgent, forProjectParam(), async (req, res, next) => {
  try {
    requireAgent(req);
    const data = await RepoProfileService.getActiveForAgent(req.params.projectId, req.agent);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});


/**
 * @openapi
 * /projects/{projectId}/repo-profile/credentials/mtls:
 *   post:
 *     tags: [Repo Profiles]
 *     summary: Store a scoped mTLS client certificate/key for repo-profile egress
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       201:
 *         description: Credential metadata (never the private key)
 */
router.post('/:projectId/repo-profile/credentials/mtls', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.createMtlsCredential(
      req.params.projectId, req.body, operator(req));
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/credentials/mtls:
 *   get:
 *     tags: [Repo Profiles]
 *     summary: List repo-profile mTLS client credentials
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Credential metadata (never private keys)
 */
router.get('/:projectId/repo-profile/credentials/mtls', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.listMtlsCredentials(
      req.params.projectId, operator(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/credentials/mtls/{credentialId}:
 *   delete:
 *     tags: [Repo Profiles]
 *     summary: Deactivate a repo-profile mTLS client credential
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: path
 *         name: credentialId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Deactivated credential metadata
 */
router.delete('/:projectId/repo-profile/credentials/mtls/:credentialId', verifyToken, async (req, res, next) => {
  try {
    const data = await RepoProfileService.deleteMtlsCredential(
      req.params.projectId, req.params.credentialId, operator(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/agent/mtls:
 *   get:
 *     tags: [Repo Profiles]
 *     summary: Get one exact profile revision's scoped mTLS client material for the agent
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: profileId
 *         required: true
 *         schema: { type: string, pattern: '^[0-9a-fA-F-]{36}$' }
 *       - in: query
 *         name: profileVersion
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Client certificate/key material or null
 */
router.get('/:projectId/repo-profile/agent/mtls', verifyTokenOrAgent, requireRuntime('running'), forProjectParam(), requireProjectGrant('worker'), async (req, res, next) => {
  try {
    const agent = requireAgent(req);
    if (!req.query.profileId || req.query.profileVersion == null) {
      throw new ValidationError('profileId and profileVersion query parameters are required');
    }
    const data = await RepoProfileService.getMtlsMaterialForAgent(
      req.params.projectId,
      agent,
      req.query.profileId,
      Number(req.query.profileVersion)
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/validations/claim:
 *   post:
 *     tags: [Repo Profiles]
 *     summary: Claim the next queued dry run
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Claimed validation or null
 */
router.post('/:projectId/repo-profile/validations/claim', verifyTokenOrAgent, requireRuntime('running'), forProjectParam(), requireProjectGrant('worker'), async (req, res, next) => {
  try {
    const agent = requireAgent(req);
    const data = await RepoProfileValidationService.claimNext(
      req.params.projectId,
      agent,
      requireAgentRuntime(req)
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /projects/{projectId}/repo-profile/validations/{validationId}/finish:
 *   post:
 *     tags: [Repo Profiles]
 *     summary: Report a dry-run validation result
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: path
 *         name: validationId
 *         required: true
 *         schema: { type: string, pattern: '^[0-9a-fA-F-]{36}$' }
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Finished validation
 */
router.post('/:projectId/repo-profile/validations/:validationId/finish', verifyTokenOrAgent, requireRuntime('running'), forProjectParam(), requireProjectGrant('worker'), async (req, res, next) => {
  try {
    const agent = requireAgent(req);
    const data = await RepoProfileValidationService.finish(
      req.params.projectId,
      req.params.validationId,
      agent,
      req.body || {},
      requireAgentRuntime(req)
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
