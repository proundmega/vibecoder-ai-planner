const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
let keyBuffer = null;

const MASTER_KEY = process.env.ENCRYPTION_KEY;
if (process.env.NODE_ENV !== 'test' || process.env.INTEGRATION_TESTS) {
  if (!MASTER_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required for encryption operations.');
  }
  keyBuffer = Buffer.from(MASTER_KEY, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string (256 bits).');
  }
}

function encrypt(text) {
  if (!keyBuffer) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!keyBuffer) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function maskToken(token) {
  if (!token || token.length < 5) {
    return '****';
  }
  const visible = token.slice(-4);
  const maskedLen = Math.min(token.length - 4, 15);
  return `${'*'.repeat(maskedLen)}${visible}`;
}

module.exports = { encrypt, decrypt, maskToken };
