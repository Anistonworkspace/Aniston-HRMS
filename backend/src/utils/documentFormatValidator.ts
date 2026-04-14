/**
 * documentFormatValidator.ts
 *
 * Enterprise-grade Indian document format validation.
 *
 * Rules sourced from:
 *  - PAN: Income Tax India official doc, Wikipedia, Zwitch blog
 *  - Aadhaar: UIDAI official site, Verhoeff algorithm (UIDAI uses Verhoeff check digit)
 *  - DL: Wikipedia Driving Licence in India, RTO code lists
 *  - Passport: ICAO 9303, Wikipedia Indian Passport
 *  - Voter ID (EPIC): Election Commission of India, Wikipedia
 *  - IFSC: RBI, Wikipedia
 *
 * Certainty model:
 *  - HARD INVALID: format is structurally impossible (e.g., wrong length, impossible character)
 *  - SUSPICIOUS: format matches but has known dummy/test patterns
 *  - WARNING: format is valid but has a low-confidence signal
 *  - VALID: passes all checks for this document type
 *
 * IMPORTANT: None of these checks can confirm the document is "genuine" or issued by a
 * government authority. They can only detect obviously invalid formats and common fraud signals.
 * Always use output labels: "likely valid" / "suspicious" / "invalid format" — never "genuine".
 */

export interface ValidationResult {
  outcome: 'valid' | 'suspicious' | 'invalid_format' | 'incomplete';
  valid: boolean;           // true only if outcome === 'valid'
  errors: string[];         // hard format errors
  warnings: string[];       // soft warnings (suspicious but not definitively invalid)
  normalizedValue?: string; // cleaned/normalized value if applicable
  expectedPattern?: string;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function normalize(value: string): string {
  return value.replace(/[\s\-\.]/g, '').toUpperCase();
}

// ─── PAN Validation ───────────────────────────────────────────────────────────
// Format: ABCDE1234F
// Pos 1-3: 3 uppercase letters (area code)
// Pos 4: entity type (P=person, C=company, H=HUF, F=firm, A=AOP, T=trust, B=BOI, L=local, J=juridical, G=govt)
// Pos 5: first letter of surname (individuals) or entity name
// Pos 6-9: 4 digits
// Pos 10: check letter (no public algorithm — cannot verify)
// Source: https://en.wikipedia.org/wiki/Permanent_account_number

const PAN_FULL_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PAN_VALID_ENTITY_CODES = new Set(['P', 'C', 'H', 'F', 'A', 'T', 'B', 'L', 'J', 'G']);

export function validatePAN(pan: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const norm = normalize(pan);

  // Apply common OCR corrections in digit positions (6-9): O→0, I→1, S→5
  const corrected = norm.slice(0, 5)
    + norm.slice(5, 9).replace(/O/g, '0').replace(/I/g, '1').replace(/S/g, '5')
    + norm.slice(9);

  if (!PAN_FULL_REGEX.test(corrected)) {
    errors.push(`PAN format invalid — expected 5 letters + 4 digits + 1 letter (e.g., ABCDE1234F), got: ${norm}`);
    return { outcome: 'invalid_format', valid: false, errors, warnings, expectedPattern: 'ABCDE1234F' };
  }

  // Position 4 entity code check
  const entityCode = corrected[3];
  if (!PAN_VALID_ENTITY_CODES.has(entityCode)) {
    errors.push(`PAN entity code '${entityCode}' at position 4 is not a valid ITDN entity code`);
    return { outcome: 'invalid_format', valid: false, errors, warnings };
  }

  // For HRMS: warn if entity is not "P" (individual)
  if (entityCode !== 'P') {
    warnings.push(`PAN entity code '${entityCode}' indicates non-individual entity — expected 'P' for employee`);
  }

  // Dummy PAN detection (common test values)
  const DUMMY_PANS = new Set(['AAAAA9999A', 'BBBBB0000B', 'ZZZZZ9999Z', 'PPPPP1111P']);
  if (DUMMY_PANS.has(corrected)) {
    warnings.push('PAN matches a known dummy/test value');
    return { outcome: 'suspicious', valid: false, errors, warnings, normalizedValue: corrected };
  }

  return {
    outcome: warnings.length > 0 ? 'suspicious' : 'valid',
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedValue: corrected,
  };
}

// ─── Aadhaar Validation ───────────────────────────────────────────────────────
// Format: 12 digits, first digit 2–9 (not 0 or 1)
// Check digit: Verhoeff algorithm on the last digit
// Source: UIDAI official documentation, https://m2pfintech.com/blog/validate-aadhaar-numbers-using-the-verhoeff-algorithm-in-flutter/

// Verhoeff algorithm tables
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 9, 8, 7, 6, 5];

function verhoeffCheck(num: string): boolean {
  let c = 0;
  const reversed = num.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][reversed[i]]];
  }
  return c === 0;
}

export function validateAadhaar(aadhaar: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Handle masked Aadhaar (XXXX-XXXX-1234 format — valid in digital copies)
  const masked = aadhaar.replace(/[\s\-]/gi, '');
  if (/^[Xx]{8}\d{4}$/.test(masked)) {
    return {
      outcome: 'valid',
      valid: true,
      errors: [],
      warnings: ['Masked Aadhaar — only last 4 digits visible; full validation not possible'],
      normalizedValue: masked,
    };
  }

  const digits = masked.replace(/[^0-9]/g, '');

  if (digits.length !== 12) {
    errors.push(`Aadhaar must be exactly 12 digits, found ${digits.length} digit(s)`);
    return { outcome: 'invalid_format', valid: false, errors, warnings, expectedPattern: '1234 5678 9012' };
  }

  // First digit must be 2–9 (UIDAI specification)
  if ('01'.includes(digits[0])) {
    errors.push(`Aadhaar cannot start with ${digits[0]} — valid range: 2–9`);
    return { outcome: 'invalid_format', valid: false, errors, warnings };
  }

  // All-same-digit dummy check
  if (/^(\d)\1{11}$/.test(digits)) {
    errors.push('Aadhaar is all same digit — this is a dummy/test number');
    return { outcome: 'suspicious', valid: false, errors, warnings };
  }

  // Sequential dummy check
  if (digits === '123456789012' || digits === '987654321098') {
    errors.push('Aadhaar matches a known dummy sequential number');
    return { outcome: 'suspicious', valid: false, errors, warnings };
  }

  // Verhoeff check digit validation
  if (!verhoeffCheck(digits)) {
    warnings.push('Aadhaar check digit (Verhoeff) does not validate — number may be OCR-misread or altered');
    return { outcome: 'suspicious', valid: false, errors, warnings, normalizedValue: `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}` };
  }

  return {
    outcome: 'valid',
    valid: true,
    errors,
    warnings,
    normalizedValue: `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`,
  };
}

// ─── Passport Validation ──────────────────────────────────────────────────────
// Format: 1 uppercase letter + 7 digits
// Source: https://en.wikipedia.org/wiki/Indian_passport

const PASSPORT_REGEX = /^[A-Z]\d{7}$/;

export function validatePassport(passport: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const norm = normalize(passport);

  if (!PASSPORT_REGEX.test(norm)) {
    errors.push(`Passport number format invalid — expected 1 letter + 7 digits (e.g., A1234567), got: ${norm}`);
    return { outcome: 'invalid_format', valid: false, errors, warnings, expectedPattern: 'A1234567' };
  }

  // Indian passport series: letter is typically J, K, L, M, N, P, R, T, V, W, X, Y, Z (varies over years)
  // Just warn if unusual — do not hard reject
  const validSeries = new Set('ABCDEFGHIJKLMNPQRSTUVWXYZ'.split(''));
  if (!validSeries.has(norm[0])) {
    warnings.push(`Passport series letter '${norm[0]}' is unusual for an Indian passport`);
  }

  return { outcome: 'valid', valid: true, errors, warnings, normalizedValue: norm };
}

// MRZ check digit (7-3-1 weighting, ICAO 9303)
// Source: https://trustdochub.com/en/icao-9303/
export function mrzCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const c = field[i];
    let val: number;
    if (c === '<') val = 0;
    else if (c >= 'A' && c <= 'Z') val = c.charCodeAt(0) - 55;
    else val = parseInt(c, 10);
    sum += val * weights[i % 3];
  }
  return sum % 10;
}

export function validatePassportMRZ(line1: string, line2: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (line1.length !== 44 || line2.length !== 44) {
    errors.push('MRZ lines must each be exactly 44 characters');
    return { valid: false, errors };
  }

  // Validate passport number check digit (line2 pos 0-8, check digit at pos 9)
  const passportNum = line2.substring(0, 9);
  if (parseInt(line2[9]) !== mrzCheckDigit(passportNum)) {
    errors.push('MRZ passport number check digit is invalid');
  }

  // Validate DOB check digit (line2 pos 13-18, check digit at pos 19)
  const dob = line2.substring(13, 19);
  if (parseInt(line2[19]) !== mrzCheckDigit(dob)) {
    errors.push('MRZ date-of-birth check digit is invalid');
  }

  // Validate expiry check digit (line2 pos 21-26, check digit at pos 27)
  const expiry = line2.substring(21, 27);
  if (parseInt(line2[27]) !== mrzCheckDigit(expiry)) {
    errors.push('MRZ expiry date check digit is invalid');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Driving License Validation ───────────────────────────────────────────────
// Format: SS-RR-YYYY-NNNNNNN (state code + RTO code + year + 7-digit number)
// Source: https://en.wikipedia.org/wiki/Driving_licence_in_India

const VALID_DL_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'GA',
  'GJ', 'HP', 'HR', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH',
  'ML', 'MN', 'MP', 'MZ', 'NL', 'OD', 'PB', 'PY', 'RJ', 'SK',
  'TG', 'TN', 'TR', 'UK', 'UP', 'WB',
]);

// Flexible regex: handles hyphens/spaces or not, various digit lengths
const DL_REGEX = /^([A-Z]{2})[-\s]?(\d{1,2})[-\s]?(\d{4})[-\s]?(\d{7})$/;

export function validateDrivingLicense(dl: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const norm = normalize(dl);

  const match = norm.match(DL_REGEX);
  if (!match) {
    errors.push(`Driving licence format invalid — expected SS-RR-YYYY-NNNNNNN (e.g., KA-05-2019-0012345), got: ${dl}`);
    return { outcome: 'invalid_format', valid: false, errors, warnings, expectedPattern: 'KA-05-2019-0012345' };
  }

  const [, stateCode, , yearStr] = match;

  if (!VALID_DL_STATE_CODES.has(stateCode)) {
    errors.push(`Driving licence state code '${stateCode}' is not a valid Indian state/UT code`);
    return { outcome: 'invalid_format', valid: false, errors, warnings };
  }

  const year = parseInt(yearStr, 10);
  const currentYear = new Date().getFullYear();
  if (year < 1988 || year > currentYear) {
    errors.push(`Driving licence issue year ${year} is implausible (valid range: 1988–${currentYear})`);
    return { outcome: 'invalid_format', valid: false, errors, warnings };
  }

  return { outcome: 'valid', valid: true, errors, warnings, normalizedValue: norm };
}

// ─── Voter ID (EPIC) Validation ───────────────────────────────────────────────
// Format: 3 uppercase letters + 7 digits
// Source: https://en.wikipedia.org/wiki/Voter_ID_(India)

const VOTER_ID_REGEX = /^[A-Z]{3}\d{7}$/;

export function validateVoterID(epic: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const norm = normalize(epic);

  if (!VOTER_ID_REGEX.test(norm)) {
    errors.push(`Voter ID (EPIC) format invalid — expected 3 letters + 7 digits (e.g., NUO1234561), got: ${norm}`);
    return { outcome: 'invalid_format', valid: false, errors, warnings, expectedPattern: 'NUO1234561' };
  }

  return { outcome: 'valid', valid: true, errors, warnings, normalizedValue: norm };
}

// ─── IFSC Code Validation ─────────────────────────────────────────────────────
// Format: 4 uppercase letters + 0 + 6 alphanumeric characters
// Source: RBI, Wikipedia

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validateIFSC(ifsc: string): ValidationResult {
  const errors: string[] = [];
  const norm = normalize(ifsc);

  if (!IFSC_REGEX.test(norm)) {
    errors.push(`IFSC code format invalid — expected 4 letters + 0 + 6 alphanumeric (e.g., SBIN0001234), got: ${norm}`);
    return { outcome: 'invalid_format', valid: false, errors, warnings: [], expectedPattern: 'SBIN0001234' };
  }

  return { outcome: 'valid', valid: true, errors, warnings: [], normalizedValue: norm };
}

// ─── Photo Validation ─────────────────────────────────────────────────────────
// Validates passport-size photo file characteristics.
// Source: MEA India passport photo guidelines, ICAO 2024

interface PhotoValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validatePhoto(
  fileBuffer: Buffer,
  ext: string,
  fileSizeBytes: number,
): Promise<PhotoValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // File size check
  if (fileSizeBytes < 5_000) {
    errors.push('Photo file too small (< 5KB) — likely a thumbnail or corrupt file');
  }
  if (fileSizeBytes > 5_000_000) {
    warnings.push('Photo file very large (> 5MB) — consider compressing');
  }

  // Format check
  const allowedFormats = ['.jpg', '.jpeg', '.png', '.webp'];
  if (!allowedFormats.includes(ext.toLowerCase())) {
    errors.push(`Photo format '${ext}' not accepted — allowed: JPG, PNG, WebP`);
  }

  // Magic bytes check: JPEG = FF D8, PNG = 89 50, PDF = 25 50
  const isPDF = fileBuffer[0] === 0x25 && fileBuffer[1] === 0x50;
  if (isPDF) {
    errors.push('A PDF was uploaded in the photo slot — please upload a JPEG or PNG photo');
  }

  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(fileBuffer).metadata();

    if (!meta.width || !meta.height) {
      errors.push('Cannot read image dimensions — file may be corrupt');
      return { valid: errors.length === 0, errors, warnings };
    }

    // Aspect ratio check (passport photo: 35×45mm ≈ 0.778)
    const ratio = meta.width / meta.height;
    if (ratio > 1.0) {
      errors.push(`Landscape orientation (${meta.width}×${meta.height}) — passport photo must be portrait`);
    } else if (Math.abs(ratio - 35 / 45) > 0.20) {
      warnings.push(`Aspect ratio ${ratio.toFixed(2)} deviates from standard passport photo (35×45mm = 0.78) — verify manually`);
    }

    // Minimum resolution
    if (meta.width < 200 || meta.height < 250) {
      errors.push(`Resolution too low: ${meta.width}×${meta.height}px — minimum 200×250px for usable quality`);
    }

    // Grayscale check
    if (meta.channels === 1) {
      errors.push('Grayscale image — passport photo must be in colour');
    }

    // Very small image: likely not a face photo
    if (meta.width < 100 || meta.height < 100) {
      errors.push('Image is too small to be a valid photo — likely a thumbnail or icon');
    }

  } catch {
    warnings.push('Could not read image metadata — verify photo quality manually');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── PDF Tamper Heuristics ────────────────────────────────────────────────────
// Source: Arya AI tamper detection, ELA research

export function checkPdfMetadataTamper(metadata: {
  Producer?: string;
  Creator?: string;
  Author?: string;
  CreationDate?: string;
}): string[] {
  const flags: string[] = [];

  const suspiciousSoftware = [
    'canva', 'photoshop', 'illustrator', 'inkscape', 'gimp',
    'wps', 'word', 'excel', 'powerpoint', 'affinity', 'paint.net', 'snapseed',
  ];

  const producer = (metadata.Producer || '').toLowerCase();
  const creator = (metadata.Creator || '').toLowerCase();

  if (suspiciousSoftware.some(s => producer.includes(s))) {
    flags.push(`Suspicious PDF producer: "${metadata.Producer}" — document may have been created in an editing tool, not scanned`);
  }
  if (suspiciousSoftware.some(s => creator.includes(s))) {
    flags.push(`Suspicious PDF creator: "${metadata.Creator}" — may indicate a digitally created (not scanned) document`);
  }

  if (metadata.CreationDate) {
    const created = new Date(metadata.CreationDate);
    if (!isNaN(created.getTime()) && created > new Date()) {
      flags.push(`PDF creation date is in the future (${metadata.CreationDate}) — tamper indicator`);
    }
  }

  return flags;
}

// ─── Main validator (used by document-ocr.worker.ts) ─────────────────────────

export function validateDocumentFormat(
  type: string,
  extractedDocNumber: string | null | undefined,
): { valid: boolean; errors: string[]; warnings: string[]; outcome?: string } {
  if (!extractedDocNumber || extractedDocNumber.trim() === '') {
    return { valid: true, errors: [], warnings: [] }; // can't validate empty — not an error at format level
  }

  const docType = type.toUpperCase().replace(/[\s\-]/g, '_');

  switch (docType) {
    case 'AADHAAR':
    case 'AADHAAR_CARD': {
      const r = validateAadhaar(extractedDocNumber);
      return { valid: r.valid, errors: r.errors, warnings: r.warnings, outcome: r.outcome };
    }
    case 'PAN':
    case 'PAN_CARD': {
      const r = validatePAN(extractedDocNumber);
      return { valid: r.valid, errors: r.errors, warnings: r.warnings, outcome: r.outcome };
    }
    case 'PASSPORT': {
      const r = validatePassport(extractedDocNumber);
      return { valid: r.valid, errors: r.errors, warnings: r.warnings, outcome: r.outcome };
    }
    case 'VOTER_ID':
    case 'VOTERID':
    case 'EPIC': {
      const r = validateVoterID(extractedDocNumber);
      return { valid: r.valid, errors: r.errors, warnings: r.warnings, outcome: r.outcome };
    }
    case 'DRIVING_LICENSE':
    case 'DRIVINGLICENSE':
    case 'DL': {
      const r = validateDrivingLicense(extractedDocNumber);
      return { valid: r.valid, errors: r.errors, warnings: r.warnings, outcome: r.outcome };
    }
    case 'BANK_STATEMENT':
    case 'BANKSTATEMENT':
    case 'CANCELLED_CHEQUE':
    case 'CANCELLEDCHEQUE': {
      const r = validateIFSC(extractedDocNumber);
      return { valid: r.valid, errors: r.errors, warnings: r.warnings, outcome: r.outcome };
    }
    default:
      return { valid: true, errors: [], warnings: [] };
  }
}
