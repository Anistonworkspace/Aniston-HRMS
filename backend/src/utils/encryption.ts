import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from ENCRYPTION_KEY or JWT_SECRET.
 */
function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set');
  }
  return crypto.scryptSync(secret, 'aniston-hrms-salt', 32);
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a hex string in the format: iv:authTag:ciphertext
 */
export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM ciphertext string (iv:authTag:ciphertext).
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid ciphertext format');
  }

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
