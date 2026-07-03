const { ValidationError } = require('../errors/HttpError');

let _secret = null;

function getSecret() {
  if (_secret) return _secret;
  
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new ValidationError('JWT_SECRET environment variable is required. Set it before starting the application.');
  }
  
  if (secret.length < 32) {
    throw new ValidationError('JWT_SECRET must be at least 32 characters long for security.');
  }
  
  _secret = secret;
  return _secret;
}

module.exports = { getSecret };
