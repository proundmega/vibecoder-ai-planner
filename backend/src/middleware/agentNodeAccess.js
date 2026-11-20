const { pool } = require('../db');

function notFound(res) {
  return res.status(404).json({
    success: false,
    error: { code: 'NODE_NOT_FOUND', message: 'Node not found' },
  });
}

/** Load a JWT-scoped node into `req.nodeRecord` (404 when not visible). */
async function loadNode(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM agent_nodes WHERE id = $1', [
      req.params.id,
    ]);
    const node = result.rows[0];
    if (!node) return notFound(res);

    const isSuper = req.user && req.user.role === 'super_admin';
    const isOwner = req.user && String(node.owner_id) === String(req.user.userId);
    if (!isSuper && !isOwner) {
      // Project members may read a shared node, but not mutate it.
      const shared = await pool.query(
        `SELECT 1 FROM agent_node_grants g
         JOIN projects p ON p.id = g.project_id
         WHERE g.node_id = $1 AND g.revoked_at IS NULL
           AND (p.owner_id = $2
                OR EXISTS (SELECT 1 FROM project_memberships m
                           WHERE m.project_id = p.id AND m.user_id = $2))`,
        [node.id, req.user ? req.user.userId : null]
      );
      if (shared.rows.length === 0) return notFound(res);
      req.nodeShared = true;
    }
    req.nodeRecord = node;
    return next();
  } catch (error) {
    return next(error);
  }
}

/** Mutations require node ownership or super_admin. */
async function requireNodeOwner(req, res, next) {
  const node = req.nodeRecord;
  if (!node) return notFound(res);
  if (req.user.role === 'super_admin' || String(node.owner_id) === String(req.user.userId)) {
    return next();
  }
  return notFound(res);
}

/** Grant changes additionally require project admin on the target project. */
function requireProjectAdmin(param = 'projectId') {
  return async (req, res, next) => {
    try {
      const projectId = req.body ? req.body[param] : null;
      if (projectId == null) {
        return res.status(400).json({
          success: false,
          error: { code: 'PROJECT_REQUIRED', message: 'projectId is required' },
        });
      }
      if (req.user.role === 'super_admin') return next();
      const result = await pool.query(
        `SELECT 1 FROM projects p
         WHERE p.id = $1
           AND (p.owner_id = $2
                OR ($3 IN ('project_admin','super_admin')
                    AND EXISTS (SELECT 1 FROM project_memberships m
                                WHERE m.project_id = p.id AND m.user_id = $2)))`,
        [projectId, req.user.userId, req.user.role]
      );
      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Project admin required' },
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** Grant deletion checks the grant's own project rather than the body. */
async function requireGrantProjectAdmin(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT g.project_id FROM agent_node_grants g
       WHERE g.id = $1 AND g.node_id = $2`,
      [req.params.grantId, req.params.id]
    );
    if (result.rows.length === 0) return notFound(res);
    req.grantProjectId = result.rows[0].project_id;

    if (req.user.role === 'super_admin') return next();
    const admin = await pool.query(
      `SELECT 1 FROM projects p
       WHERE p.id = $1
         AND (p.owner_id = $2
              OR ($3 IN ('project_admin','super_admin')
                  AND EXISTS (SELECT 1 FROM project_memberships m
                              WHERE m.project_id = p.id AND m.user_id = $2)))`,
      [req.grantProjectId, req.user.userId, req.user.role]
    );
    if (admin.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Project admin required' },
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  loadNode,
  requireNodeOwner,
  requireProjectAdmin,
  requireGrantProjectAdmin,
};
