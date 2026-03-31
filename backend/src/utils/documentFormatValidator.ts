/**
 * Document Format Validator for Indian Documents
 *
 * Validates extracted document numbers against known patterns
 * for common Indian identity and financial documents.
 */

interface ValidationResult {
  valid: boolean;
  errors: string[];
  expectedPattern?: string;
}

/**
 * Normalize input by stripping spaces, hyphens, and converting to uppercase.
 */
function normalize(value: string): string {
  return value.replace(/[\s\-]/g, '').toUpperCase();
}

// --- Regex patterns for Indian documents ---

/** Aadhaar: exactly 12 digits */
const AADHAAR_REGEX = /^\d{12}$/;

/** PAN: 5 uppercase letters + 4 digits + 1 uppercase letter */
const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;

/** Indian Passport: 1 uppercase letter + 7 digits */
const PASSPORT_REGEX = /^[A-Z]\d{7}$/;

/** Voter ID (EPIC): 3 uppercase letters + 7 digits */
const VOTER_ID_REGEX = /^[A-Z]{3}\d{7}$/;

/** Driving License: 2 letter state code followed by digits (loose pattern) */
const DRIVING_LICENSE_REGEX = /^[A-Z]{2}\d+$/;

/** IFSC Code: 4 uppercase letters + 0 + 6 alphanumeric characters */
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Validates an extracted document number against the expected format
 * for a given Indian document type.
 *
 * @param type - The document type (e.g., 'AADHAAR', 'PAN', 'PASSPORT', etc.)
 * @param extractedDocNumber - The extracted document number string (may be null/undefined)
 * @returns Validation result with valid flag, error messages, and expected pattern
 */
export function validateDocumentFormat(
  type: string,
  extractedDocNumber: string | null | undefined,
): ValidationResult {
  // If no document number provided, we can't validate — treat as valid
  if (!extractedDocNumber || extractedDocNumber.trim() === '') {
    return { valid: true, errors: [] };
  }

  const normalized = normalize(extractedDocNumber);
  const docType = type.toUpperCase().replace(/[\s\-]/g, '_');

  switch (docType) {
    case 'AADHAAR':
    case 'AADHAAR_CARD': {
      if (!AADHAAR_REGEX.test(normalized)) {
        return {
          valid: false,
          errors: ['Aadhaar number must be exactly 12 digits'],
          expectedPattern: '123456789012 (12 digits)',
        };
      }
      return { valid: true, errors: [] };
    }

    case 'PAN':
    case 'PAN_CARD': {
      if (!PAN_REGEX.test(normalized)) {
        return {
          valid: false,
          errors: ['PAN format must be ABCDE1234F (5 letters + 4 digits + 1 letter)'],
          expectedPattern: 'ABCDE1234F',
        };
      }
      return { valid: true, errors: [] };
    }

    case 'PASSPORT': {
      if (!PASSPORT_REGEX.test(normalized)) {
        return {
          valid: false,
          errors: ['Indian passport number must be 1 letter followed by 7 digits'],
          expectedPattern: 'A1234567',
        };
      }
      return { valid: true, errors: [] };
    }

    case 'VOTER_ID':
    case 'VOTERID':
    case 'EPIC': {
      if (!VOTER_ID_REGEX.test(normalized)) {
        return {
          valid: false,
          errors: ['Voter ID must be 3 letters followed by 7 digits'],
          expectedPattern: 'ABC1234567',
        };
      }
      return { valid: true, errors: [] };
    }

    case 'DRIVING_LICENSE':
    case 'DRIVINGLICENSE':
    case 'DL': {
      if (!DRIVING_LICENSE_REGEX.test(normalized)) {
        return {
          valid: false,
          errors: [
            'Driving license must start with a 2-letter state code followed by digits',
          ],
          expectedPattern: 'KA1234567890',
        };
      }
      return { valid: true, errors: [] };
    }

    case 'BANK_STATEMENT':
    case 'BANKSTATEMENT':
    case 'CANCELLED_CHEQUE':
    case 'CANCELLEDCHEQUE': {
      // For bank documents, validate IFSC code format if provided
      if (!IFSC_REGEX.test(normalized)) {
        return {
          valid: false,
          errors: [
            'IFSC code must be 4 letters, followed by 0, followed by 6 alphanumeric characters',
          ],
          expectedPattern: 'SBIN0001234',
        };
      }
      return { valid: true, errors: [] };
    }

    default:
      // Unknown document types pass validation — no format check available
      return { valid: true, errors: [] };
  }
}
