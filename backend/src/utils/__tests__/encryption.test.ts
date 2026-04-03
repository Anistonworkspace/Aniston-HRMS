import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt, maskAadhaar, maskPAN } from '../encryption.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
});

describe('encryption', () => {
  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string correctly', () => {
      const plaintext = '123456789012';
      const encrypted = encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(':'); // iv:authTag:ciphertext format

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for the same plaintext (random IV)', () => {
      const plaintext = 'Hello World';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle short strings', () => {
      const encrypted = encrypt('a');
      expect(decrypt(encrypted)).toBe('a');
    });

    it('should handle special characters', () => {
      const plaintext = 'Héllo Wörld! @#$%^&*() 🎉';
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('should throw on invalid ciphertext format', () => {
      expect(() => decrypt('invalid')).toThrow('Invalid ciphertext format');
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      // Flip every hex digit in the authTag (XOR with 0xF) to guarantee corruption
      const authTagIndex = parts.length === 4 ? 2 : 1;
      parts[authTagIndex] = parts[authTagIndex]
        .split('')
        .map((c) => (parseInt(c, 16) ^ 0xf).toString(16))
        .join('');
      expect(() => decrypt(parts.join(':'))).toThrow();
    });
  });

  describe('maskAadhaar', () => {
    it('should mask a 12-digit Aadhaar number', () => {
      expect(maskAadhaar('123456781234')).toBe('XXXX-XXXX-1234');
    });

    it('should handle Aadhaar with spaces/dashes', () => {
      expect(maskAadhaar('1234 5678 9012')).toBe('XXXX-XXXX-9012');
      expect(maskAadhaar('1234-5678-9012')).toBe('XXXX-XXXX-9012');
    });

    it('should handle short input', () => {
      expect(maskAadhaar('12')).toBe('XXXX-XXXX-XXXX');
    });

    it('should handle empty input', () => {
      expect(maskAadhaar('')).toBe('XXXX-XXXX-XXXX');
    });
  });

  describe('maskPAN', () => {
    it('should mask a standard PAN number', () => {
      expect(maskPAN('ABCDE1234F')).toBe('ABCXXXXXXF');
    });

    it('should handle lowercase input', () => {
      expect(maskPAN('abcde1234f')).toBe('ABCXXXXXXF');
    });

    it('should handle short input', () => {
      expect(maskPAN('AB')).toBe('XXXXXXXXXX');
    });

    it('should handle PAN with spaces', () => {
      expect(maskPAN('ABCDE 1234F')).toBe('ABCXXXXXXF');
    });
  });
});
