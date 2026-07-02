const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = process.env.ENCRYPTION_KEY;

if (!MASTER_KEY) {
  console.warn('WARNING: ENCRYPTION_KEY not set. Encryption disabled.');
}

function encrypt(text) {
  if (!MASTER_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }

  const iv = crypto.randomBytes(16);
  const key = Buffer.from(MASTER_KEY, 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!MASTER_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = Buffer.from(MASTER_KEY, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
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
