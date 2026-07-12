const UserService = require('../services/UserService');

async function listUsers(req, res, next) {
  try {
    const { role, search, page, perPage } = req.query;
    const users = await UserService.listUsers(req.user.userId, req.user.role, { role, search, page, perPage });
    res.json({ success: true, data: { users } });
  } catch (error) {
    next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const { name, email, password, role } = req.body;
    const user = await UserService.createUser(name, email, password, role, req.user.userId);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const { name, is_active } = req.body;
    const user = await UserService.updateUser(req.params.id, req.user.userId, { name, is_active });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

async function toggleUserActive(req, res, next) {
  try {
    const user = await UserService.toggleUserActive(req.params.id, req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    await UserService.deleteUser(req.params.id, req.user.userId);
    res.json({ success: true, data: { message: 'User deleted' } });
  } catch (error) {
    next(error);
  }
}

async function listAllUsers(req, res, next) {
  try {
    const { search, role, is_active, page, perPage } = req.query;
    const users = await UserService.listAllUsers({ search, role, is_active, page, perPage });
    res.json({ success: true, data: { users } });
  } catch (error) {
    next(error);
  }
}

async function unlockUser(req, res, next) {
  try {
    const result = await UserService.unlockUser(req.params.id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
  toggleUserActive,
  deleteUser,
  listAllUsers,
  unlockUser,
};
