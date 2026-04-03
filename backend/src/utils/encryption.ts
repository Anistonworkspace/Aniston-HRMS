import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;

/**
 * Derives a 32-byte key from ENCRYPTION_KEY using a per-encryption random salt.
 * Falls back to JWT_SECRET ONLY in development mode with a warning.
 */
function getSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    const fallback = process.env.JWT_SECRET;
    if (fallback) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[WARN] ENCRYPTION_KEY not set — falling back to JWT_SECRET. Set ENCRYPTION_KEY in production.');
      }
      return fallback;
    }
  }

  throw new Error('ENCRYPTION_KEY environment variable must be set');
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, 32);
}

/**
 * Encrypts plaintext using AES-256-GCM with a random salt per encryption.
 * Returns a hex string in the format: salt:iv:authTag:ciphertext
 */
export function encrypt(text: string): string {
  const secret = getSecret();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM ciphertext string.
 * Supports both new format (salt:iv:authTag:ciphertext) and legacy format (iv:authTag:ciphertext).
 */
export function decrypt(ciphertext: string): string {
  const secret = getSecret();
  const parts = ciphertext.split(':');

  let salt: Buffer;
  let ivHex: string;
  let authTagHex: string;
  let encryptedHex: string;

  if (parts.length === 4) {
    // New format with random salt
    [, ivHex, authTagHex, encryptedHex] = parts;
    salt = Buffer.from(parts[0], 'hex');
  } else if (parts.length === 3) {
    // Legacy format with hardcoded salt
    [ivHex, authTagHex, encryptedHex] = parts;
    salt = Buffer.from('aniston-hrms-salt');
  } else {
    throw new Error('Invalid ciphertext format');
  }

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid ciphertext format');
  }

  const key = deriveKey(secret, salt);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Masks an Aadhaar number, showing only the last 4 digits.
 * Input: "123456781234" -> Output: "XXXX-XXXX-1234"
 */
export function maskAadhaar(number: string): string {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 4) {
    return 'XXXX-XXXX-XXXX';
  }
  const last4 = digits.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

/**
 * Masks a PAN number, showing first 3 and last 1 characters, rest as X.
 * Input: "ABCDE1234F" -> Output: "ABCXXXXXXF"
 */
export function maskPAN(number: string): string {
  const pan = number.replace(/\s/g, '').toUpperCase();
  if (pan.length < 4) {
    return 'XXXXXXXXXX';
  }
  const first3 = pan.slice(0, 3);
  const last1 = pan.slice(-1);
  const maskedMiddle = 'X'.repeat(pan.length - 4);
  return `${first3}${maskedMiddle}${last1}`;
}
