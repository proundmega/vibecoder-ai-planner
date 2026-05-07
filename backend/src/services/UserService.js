// Mock bcrypt
jest.mock('bcryptjs', () => ({ 
  hash: jest.fn().mockResolvedValue('hash'), 
  compare: jest.fn().mockResolvedValue(true) 
}));

const bcrypt = require('bcryptjs');
const User = require('../models/user');
const authService = require('../auth');