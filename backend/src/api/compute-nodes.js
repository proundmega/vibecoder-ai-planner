const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { pool } = require('../db');
const provisioning = require('../services/ProvisioningService');
const { createNodeSchema, updateNodeSchema } = require('../validators/computeNodes');

// GET /api/v1/compute-nodes
router.get('/', verifyToken, requireAnyPermission('PROJECT_UPDATE'), async (req, res, _next) => {
  const result = await pool.query('SELECT * FROM compute_nodes ORDER BY hostname');
  res.json({ success: true, data: result.rows });
});

// POST /api/v1/compute-nodes
router.post('/', verifyToken, requireAnyPermission('PROJECT_UPDATE'), validate(createNodeSchema), async (req, res, _next) => {
  const { hostname, ssh_port, ssh_user, ssh_key_credential_id, labels, capacity } = req.body;
  const result = await pool.query(
    `INSERT INTO compute_nodes (hostname, ssh_port, ssh_user, ssh_key_credential_id, labels, capacity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [hostname, ssh_port || 22, ssh_user, ssh_key_credential_id, labels || '{}', capacity || 1]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

// PUT /api/v1/compute-nodes/:id
router.put('/:id', verifyToken, requireAnyPermission('PROJECT_UPDATE'), validate(updateNodeSchema), async (req, res, _next) => {
  const { hostname, ssh_port, ssh_user, ssh_key_credential_id, labels, capacity, status } = req.body;
  const sets = []; const vals = []; let idx = 1;
  if (hostname !== undefined) { sets.push('hostname=$' + idx++); vals.push(hostname); }
  if (ssh_port !== undefined) { sets.push('ssh_port=$' + idx++); vals.push(ssh_port); }
  if (ssh_user !== undefined) { sets.push('ssh_user=$' + idx++); vals.push(ssh_user); }
  if (ssh_key_credential_id !== undefined) { sets.push('ssh_key_credential_id=$' + idx++); vals.push(ssh_key_credential_id); }
  if (labels !== undefined) { sets.push('labels=$' + idx++); vals.push(JSON.stringify(labels)); }
  if (capacity !== undefined) { sets.push('capacity=$' + idx++); vals.push(capacity); }
  if (status !== undefined) { sets.push('status=$' + idx++); vals.push(status); }
  if (sets.length === 0) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields provided' } });
  vals.push(req.params.id);
  const result = await pool.query(`UPDATE compute_nodes SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`, vals);
  if (result.rows.length === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Node not found' } });
  res.json({ success: true, data: result.rows[0] });
});

// DELETE /api/v1/compute-nodes/:id
router.delete('/:id', verifyToken, requireAnyPermission('PROJECT_UPDATE'), async (req, res, _next) => {
  await pool.query('DELETE FROM compute_nodes WHERE id = $1', [req.params.id]);
  res.json({ success: true, data: null });
});

// POST /api/v1/compute-nodes/:id/test
router.post('/:id/test', verifyToken, requireAnyPermission('PROJECT_UPDATE'), async (req, res, _next) => {
  const result = await provisioning.testConnection(req.params.id);
  res.json({ success: result.success, data: result });
});

module.exports = router;
