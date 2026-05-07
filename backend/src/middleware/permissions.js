const PERMISSIONS = {
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
  USER: 'user',
  CREATE_PROJECT: 'create_project',
  UPDATE_PROJECT: 'update_project',
  DELETE_PROJECT: 'delete_project',
  CREATE_TICKET: 'create_ticket',
  UPDATE_TICKET: 'update_ticket',
  DELETE_TICKET: 'delete_ticket',
  COMMENT_TICKET: 'comment_ticket',
  CHANGE_STATUS: 'change_status',
  ASSIGN_TICKET: 'assign_ticket',
  VIEW_PROJECT: 'view_project',
  VIEW_TICKET: 'view_ticket'
};

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === PERMISSIONS.ADMIN) return true;
  const userPerms = user.permissions || [];
  return userPerms.includes(permission);
}

function isAdmin(user) {
  return user !== null && user !== undefined && user.role === PERMISSIONS.ADMIN;
}

function isMember(user, projectId) {
  if (!user) return false;
  const memberProjectIds = user.member_project_ids || [];
  return memberProjectIds.includes(projectId);
}

function isProjectOwner(user, project) {
  if (!user || !project) return false;
  return project.owner_id === user.id;
}

function isResourceOwner(user, resource) {
  if (!user || !resource) return false;
  return resource.owner_id === user.id;
}

module.exports = {
  PERMISSIONS,
  hasPermission,
  isAdmin,
  isMember,
  isProjectOwner,
  isResourceOwner
};
