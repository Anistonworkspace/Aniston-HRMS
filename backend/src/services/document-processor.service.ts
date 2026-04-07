/**
 * Node.js-native document OCR fallback service.
 * Used when the Python AI service (localhost:8000) is unavailable.
 * Provides: image OCR (tesseract.js), PDF text extraction (pdf-parse),
 * PAN/Aadhaar validation, document type detection.
 */
import { createWorker } from 'tesseract.js';
import * as pdfParseModule from 'pdf-parse';
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
import sharp from 'sharp';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { extname } from 'path';
import { logger } from '../lib/logger.js';

// ─────────────────────────────────────
// TYPES
// ─────────────────────────────────────
export interface ExtractedDocument {
  rawText: string;
  detectedType: string;
  extractedFields: Record<string, string | null>;
  confidence: number;
  isScreenshot: boolean;
  isOriginalScan: boolean;
  resolutionQuality: 'LOW' | 'MEDIUM' | 'HIGH';
  formatValid: boolean;
  formatErrors: string[];
  warnings: string[];
}

// ─────────────────────────────────────
// IMAGE OCR (tesseract.js + sharp preprocessing)
// ─────────────────────────────────────
export async function extractTextFromImage(imagePath: string): Promise<{ text: string; confidence: number }> {
  const worker = await createWorker('eng');
  const processedPath = imagePath + '_ocr_processed.png';
  try {
    // Preprocess with sharp for better OCR accuracy
    await sharp(imagePath)
      .greyscale()
      .normalize()
      .sharpen()
      .resize({ width: 1800, withoutEnlargement: false })
      .toFile(processedPath);

    const { data } = await worker.recognize(processedPath);
    return { text: data.text, confidence: data.confidence };
  } finally {
    await worker.terminate();
    if (existsSync(processedPath)) {
      try { unlinkSync(processedPath); } catch { /* ignore */ }
    }
  }
}

// ─────────────────────────────────────
// PDF TEXT EXTRACTION (pdf-parse)
// ─────────────────────────────────────
export async function extractTextFromPDF(pdfPath: string): Promise<{ text: string; pageCount: number; isScanned: boolean }> {
  const dataBuffer = readFileSync(pdfPath);
  try {
    const data = await pdfParse(dataBuffer);
    const text = data.text.trim();
    return { text, pageCount: data.numpages, isScanned: text.length < 100 };
  } catch (error: any) {
    if (error.message?.includes('password')) {
      throw new Error('PDF is password-protected. Please upload an unprotected version.');
    }
    throw error;
  }
}

// ─────────────────────────────────────
// PAN CARD VALIDATION & EXTRACTION
// ─────────────────────────────────────
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function extractPAN(text: string): { panNumber: string | null; nameOnCard: string | null; dob: string | null } {
  const clean = text.toUpperCase().replace(/[\s\-\.]/g, '');
  // Apply common OCR misread corrections for digit positions
  const fixed = clean.replace(/O(?=\d)/g, '0').replace(/I(?=\d)/g, '1').replace(/S(?=\d)/g, '5');
  const match = fixed.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  const panNumber = match ? match[0] : null;

  // Extract name (often appears near "Name" keyword)
  const nameMatch = text.match(/(?:Name|name)[:\s]+([A-Z][A-Za-z\s]{2,40})/);
  const nameOnCard = nameMatch ? nameMatch[1].trim() : null;

  // Extract DOB
  const dobMatch = text.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
  const dob = dobMatch ? dobMatch[1] : null;

  return { panNumber, nameOnCard, dob };
}

export function validatePAN(pan: string): { isValid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!PAN_REGEX.test(pan)) {
    errors.push(`PAN format invalid: expected 5 letters + 4 digits + 1 letter, got: ${pan}`);
  }
  if (pan[3] !== 'P') {
    warnings.push(`PAN 4th character is '${pan[3]}' (expected 'P' for individual)`);
  }
  return { isValid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────
// AADHAAR VALIDATION & EXTRACTION
// ─────────────────────────────────────
export function extractAadhaar(text: string): { aadhaarNumber: string | null; nameOnCard: string | null; dob: string | null; gender: string | null } {
  // Check for masked Aadhaar first
  const maskedMatch = text.match(/[Xx]{4}\s?[Xx]{4}\s?(\d{4})/i);
  if (maskedMatch) {
    return { aadhaarNumber: `XXXX-XXXX-${maskedMatch[1]}`, nameOnCard: null, dob: null, gender: null };
  }

  // Find 12-digit sequence (may have spaces)
  const cleaned = text.replace(/[\s\-]/g, '');
  const match = cleaned.match(/[2-9]\d{11}/);
  const aadhaarNumber = match ? match[0].replace(/(\d{4})(\d{4})(\d{4})/, '$1-$2-$3') : null;

  const nameMatch = text.match(/([A-Z][a-z]+\s[A-Z][a-z]+)/);
  const dobMatch = text.match(/(?:DOB|Date of Birth|Year of Birth)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
  const genderMatch = text.match(/\b(MALE|FEMALE|TRANSGENDER)\b/i);

  return {
    aadhaarNumber,
    nameOnCard: nameMatch ? nameMatch[1] : null,
    dob: dobMatch ? dobMatch[1] : null,
    gender: genderMatch ? genderMatch[1].toUpperCase() : null,
  };
}

export function validateAadhaar(aadhaar: string): { isValid: boolean; errors: string[] } {
  const digits = aadhaar.replace(/[\s\-X]/gi, '');
  const errors: string[] = [];

  if (digits.length > 0 && digits.length !== 12) {
    errors.push(`Aadhaar must be 12 digits, found: ${digits.length}`);
  }
  if (digits.length === 12 && ['0', '1'].includes(digits[0])) {
    errors.push(`Aadhaar cannot start with ${digits[0]}`);
  }
  if (digits.length === 12 && /^(\d)\1{11}$/.test(digits)) {
    errors.push('Aadhaar appears to be a dummy number');
  }

  return { isValid: errors.length === 0, errors };
}

// ─────────────────────────────────────
// DOCUMENT TYPE DETECTION
// ─────────────────────────────────────
export function detectDocumentType(text: string): string {
  const upper = text.toUpperCase();
  if (upper.includes('INCOME TAX') || upper.includes('PERMANENT ACCOUNT NUMBER') || /[A-Z]{5}\d{4}[A-Z]/.test(upper)) return 'PAN';
  if (upper.includes('UIDAI') || upper.includes('AADHAAR') || upper.includes('आधार') || /\d{4}\s\d{4}\s\d{4}/.test(text)) return 'AADHAAR';
  if (upper.includes('PASSPORT') || /^[A-Z]\d{7}/.test(upper)) return 'PASSPORT';
  if (upper.includes('OFFER LETTER') || upper.includes('APPOINTMENT LETTER')) return 'OFFER_LETTER_DOC';
  if (upper.includes('UNIVERSITY') || upper.includes('DEGREE') || upper.includes('BACHELOR') || upper.includes('MASTER')) return 'DEGREE_CERTIFICATE';
  if (upper.includes('IFSC') || upper.includes('ACCOUNT') || upper.includes('CANCELLED')) return 'CANCELLED_CHEQUE';
  return 'UNKNOWN';
}

// ─────────────────────────────────────
// IMAGE QUALITY ANALYSIS
// ─────────────────────────────────────
function analyzeQuality(fileSize: number, ext: string, confidence: number, textLength: number) {
  const isPng = ext === '.png';
  const isScreenshot = isPng && fileSize > 500000 && textLength < 100;
  const isOriginalScan = ext === '.pdf' || (!isPng && fileSize > 100000);
  const resolutionQuality: 'LOW' | 'MEDIUM' | 'HIGH' =
    fileSize > 500000 ? 'HIGH' : fileSize > 100000 ? 'MEDIUM' : 'LOW';
  return { isScreenshot, isOriginalScan, resolutionQuality };
}

// ─────────────────────────────────────
// MAIN ENTRY POINT — Process document with local OCR
// ─────────────────────────────────────
export async function processDocumentLocally(
  filePath: string,
  declaredType?: string,
): Promise<ExtractedDocument> {
  const ext = extname(filePath).toLowerCase();
  let rawText = '';
  let confidence = 0;

  // Step 1: Extract text
  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'].includes(ext)) {
    const result = await extractTextFromImage(filePath);
    rawText = result.text;
    confidence = result.confidence;
  } else if (ext === '.pdf') {
    const result = await extractTextFromPDF(filePath);
    rawText = result.text;
    confidence = result.isScanned ? 40 : 90;
    if (result.isScanned) {
      // Attempt OCR on scanned PDF — pdf-parse already returns some text
      logger.info('Scanned PDF detected — limited text extraction available');
    }
  } else {
    return {
      rawText: '', detectedType: 'UNKNOWN', extractedFields: {},
      confidence: 0, isScreenshot: false, isOriginalScan: false,
      resolutionQuality: 'LOW', formatValid: false,
      formatErrors: [`Unsupported file type: ${ext}`], warnings: [],
    };
  }

  // Step 2: Detect type
  const detectedType = declaredType && declaredType !== 'AUTO' ? declaredType : detectDocumentType(rawText);

  // Step 3: Extract & validate based on type
  const extractedFields: Record<string, string | null> = {};
  let formatValid = true;
  const formatErrors: string[] = [];
  const warnings: string[] = [];

  if (detectedType === 'PAN') {
    const { panNumber, nameOnCard, dob } = extractPAN(rawText);
    extractedFields.extractedDocNumber = panNumber;
    extractedFields.extractedName = nameOnCard;
    extractedFields.extractedDob = dob;
    if (panNumber) {
      const v = validatePAN(panNumber);
      formatValid = v.isValid;
      formatErrors.push(...v.errors);
      warnings.push(...v.warnings);
    } else {
      formatValid = false;
      formatErrors.push('PAN number not found in document');
    }
  } else if (detectedType === 'AADHAAR') {
    const { aadhaarNumber, nameOnCard, dob, gender } = extractAadhaar(rawText);
    extractedFields.extractedDocNumber = aadhaarNumber;
    extractedFields.extractedName = nameOnCard;
    extractedFields.extractedDob = dob;
    extractedFields.extractedGender = gender;
    if (aadhaarNumber) {
      const v = validateAadhaar(aadhaarNumber);
      formatValid = v.isValid;
      formatErrors.push(...v.errors);
    } else {
      formatValid = false;
      formatErrors.push('Aadhaar number not found in document');
    }
  }

  // Step 4: Quality analysis
  const fileSize = existsSync(filePath) ? readFileSync(filePath).length : 0;
  const quality = analyzeQuality(fileSize, ext, confidence, rawText.length);

  if (confidence < 50) warnings.push(`Low OCR confidence (${confidence.toFixed(0)}%) — image may be blurry`);

  return {
    rawText: rawText.slice(0, 2000),
    detectedType,
    extractedFields,
    confidence,
    ...quality,
    formatValid,
    formatErrors,
    warnings,
  };
}
