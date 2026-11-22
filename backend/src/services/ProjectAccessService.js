const { pool } = require('../db');
const { ForbiddenError, NotFoundError } = require('../errors/HttpError');

/**
 * fg-45 project scoping helper.
 *
 * Readiness approvals, exemptions, overrides and replans must be project
 * scoped. ProjectService.getOne/Ticket.findByProject still ignore the caller,
 * so this helper owns the membership check for the new routes instead of
 * assuming one exists (Deferred D4 retrofits the older reads).
 */
class ProjectAccessService {
  /**
   * A user is a member when they own the project or have a project_memberships
   * row. Agent actors pass the agent owner's user id, so no agent row is read.
   */
  async isProjectMember(userId, projectId, db = pool) {
    if (userId === undefined || userId === null || projectId === undefined || projectId === null) {
      return false;
    }

    const project = await db.query(
      'SELECT id, owner_id FROM projects WHERE id = $1',
      [projectId]
    );
    if (project.rows.length === 0) throw new NotFoundError('Project not found');

    if (String(project.rows[0].owner_id) === String(userId)) return true;

    const membership = await db.query(
      'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    return membership.rows.length > 0;
  }

  /**
   * `super_admin` is the only bypass; project admins must still be members.
   */
  async assertProjectMember(userId, projectId, { role, allowSuperAdmin = true } = {}, db = pool) {
    if (allowSuperAdmin && role === 'super_admin') return;
    if (!(await this.isProjectMember(userId, projectId, db))) {
      throw new ForbiddenError('Not a project member');
    }
  }

  /**
   * Resolve the user id used for membership checks. Agent credentials carry the
   * agent row in `id` and the owner user in `userId`; always prefer the owner.
   */
  actorUserId(user) {
    if (!user) return null;
    return user.userId ?? user.ownerId ?? user.user_id ?? null;
  }
}

module.exports = new ProjectAccessService();
module.exports.ProjectAccessService = ProjectAccessService;
