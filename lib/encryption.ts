import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getSecretKeyBytes(): Buffer {
  const secretKey = process.env.ENCRYPTION_KEY;
  // 32 bytes as hex string (64 chars)
  if (!secretKey || typeof secretKey !== 'string' || secretKey.length !== 64) {
    throw new Error('ENCRYPTION_KEY is missing or invalid. It must be a 64-character hex string (32 bytes).');
  }
  return Buffer.from(secretKey, 'hex');
}

/**
 * Encrypts text using AES-256-GCM.
 * Output format: ivHex:authTagHex:cipherHex
 */
export function encrypt(plainText: string): string {
  const key = getSecretKeyBytes();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let cipherHex = cipher.update(plainText, 'utf8', 'hex');
  cipherHex += cipher.final('hex');

  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${cipherHex}`;
}

export function decrypt(encryptedText: string): string {
  const key = getSecretKeyBytes();
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plain = decipher.update(cipherHex, 'hex', 'utf8');
  plain += decipher.final('utf8');
  return plain;
}

