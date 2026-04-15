/**
 * document-processor.service.ts
 *
 * Node.js-native document OCR fallback service.
 * Used when the Python AI service (localhost:8000) is unavailable.
 *
 * Features:
 *  - Tesseract.js worker pool (max 3 concurrent, auto-reuse)
 *  - sharp preprocessing for better OCR accuracy
 *  - pdf-parse for digital PDF text extraction
 *  - Field extraction for: PAN, Aadhaar, Passport, Voter ID, DL, Education, Employment
 *  - Aadhaar Verhoeff check digit validation
 *  - PAN entity code validation
 *  - DL state code validation
 *  - Quality analysis (screenshot, resolution, format)
 *  - 60s timeout per OCR call
 */

import { createWorker, Worker as TessWorker } from 'tesseract.js';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { extname } from 'path';
import { createRequire } from 'module';
import { logger } from '../lib/logger.js';

// pdf-parse is a CommonJS module — use createRequire to avoid ESM/CJS interop issues
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
// pdf-parse v2.x: class-based API
const { PDFParse: PdfParseV2 } = _require('pdf-parse') as { PDFParse: new (opts: { data: Buffer }) => any };
import {
  validatePAN, validateAadhaar, validatePassport, validateVoterID, validateDrivingLicense,
} from '../utils/documentFormatValidator.js';

// ─── Worker Pool ──────────────────────────────────────────────────────────────

const MAX_WORKERS = 3;
const OCR_TIMEOUT_MS = 60_000; // 60 seconds per OCR call

interface PooledWorker {
  worker: TessWorker;
  busy: boolean;
}

let workerPool: PooledWorker[] = [];
let poolInitialised = false;

async function initPool(): Promise<void> {
  if (poolInitialised) return;
  poolInitialised = true;
  for (let i = 0; i < MAX_WORKERS; i++) {
    try {
      const w = await createWorker('eng');
      workerPool.push({ worker: w, busy: false });
    } catch (err: any) {
      logger.warn(`[OCR Pool] Failed to initialise worker ${i}: ${err.message}`);
    }
  }
  logger.info(`[OCR Pool] Initialised ${workerPool.length} Tesseract workers`);
}

function waitForFreeWorker(): Promise<PooledWorker> {
  return new Promise((resolve) => {
    const check = () => {
      const free = workerPool.find(w => !w.busy);
      if (free) {
        free.busy = true;
        resolve(free);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

async function runOcrWithTimeout(imagePath: string): Promise<{ text: string; confidence: number }> {
  await initPool();

  if (workerPool.length === 0) {
    // Pool empty — create ephemeral worker
    const w = await createWorker('eng');
    try {
      const { data } = await w.recognize(imagePath);
      return { text: data.text, confidence: data.confidence };
    } finally {
      await w.terminate();
    }
  }

  const pooled = await waitForFreeWorker();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pooled.busy = false;
      reject(new Error('OCR timed out after 60 seconds'));
    }, OCR_TIMEOUT_MS);

    pooled.worker.recognize(imagePath)
      .then(({ data }) => {
        clearTimeout(timeout);
        pooled.busy = false;
        resolve({ text: data.text, confidence: data.confidence });
      })
      .catch(err => {
        clearTimeout(timeout);
        pooled.busy = false;
        reject(err);
      });
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

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
  formatWarnings: string[];
  suspicionFlags: string[];
  warnings: string[];
}

// ─── Image OCR (tesseract.js + sharp preprocessing) ──────────────────────────

export async function extractTextFromImage(
  imagePath: string,
): Promise<{ text: string; confidence: number }> {
  const processedPath = imagePath + '_ocr_processed.png';
  try {
    const sharp = (await import('sharp')).default;
    await sharp(imagePath)
      .greyscale()
      .normalize()
      .sharpen()
      .resize({ width: 1800, withoutEnlargement: false })
      .toFile(processedPath);
  } catch (sharpErr: any) {
    logger.warn(`[OCR] Sharp preprocessing failed, using original: ${sharpErr.message}`);
    // Fall through to OCR the original
  }

  const pathToOcr = existsSync(processedPath) ? processedPath : imagePath;
  try {
    return await runOcrWithTimeout(pathToOcr);
  } finally {
    if (existsSync(processedPath)) {
      try { unlinkSync(processedPath); } catch { /* ignore cleanup error */ }
    }
  }
}

// ─── PDF Text Extraction (pdf-parse) ─────────────────────────────────────────

export async function extractTextFromPDF(
  pdfPath: string,
): Promise<{ text: string; pageCount: number; isScanned: boolean; metadata: any }> {
  const dataBuffer = readFileSync(pdfPath);
  try {
    const parser = new PdfParseV2({ data: dataBuffer });
    const result = await parser.getText({});
    const text = (result?.text ?? '').trim();
    return {
      text,
      pageCount: result?.total ?? result?.pages?.length ?? 0,
      isScanned: text.length < 100,
      metadata: {},
    };
  } catch (error: any) {
    if (error.message?.includes('password')) {
      throw new Error('PDF is password-protected. Please upload an unprotected version.');
    }
    throw error;
  }
}

// ─── Field Extraction ─────────────────────────────────────────────────────────

export function extractPAN(text: string): {
  panNumber: string | null; nameOnCard: string | null; dob: string | null; fatherName: string | null;
} {
  const upper = text.toUpperCase().replace(/[\s\-\.]/g, '');
  // Apply common OCR misread corrections in digit positions
  const fixed = upper.replace(/O(?=[0-9A-Z]{3}[A-Z]$)/g, '0').replace(/I(?=\d)/g, '1');
  const match = fixed.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  const panNumber = match ? match[0] : null;

  const nameMatch = text.match(/(?:^|\n)([A-Z][A-Za-z ]{2,35})(?:\n|$)/m);
  const dobMatch = text.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
  const fatherMatch = text.match(/(?:Father[''`s]*s?\s*Name|FATHER)[:\s]+([A-Z][A-Za-z ]{2,40})/i);

  return {
    panNumber,
    nameOnCard: nameMatch ? nameMatch[1].trim() : null,
    dob: dobMatch ? dobMatch[1] : null,
    fatherName: fatherMatch ? fatherMatch[1].trim() : null,
  };
}

export function extractAadhaar(text: string): {
  aadhaarNumber: string | null;
  nameOnCard: string | null;
  dob: string | null;
  yearOfBirth: string | null;
  gender: string | null;
  address: string | null;
} {
  // Handle masked Aadhaar
  const maskedMatch = text.match(/[Xx*]{4}[\s\-]?[Xx*]{4}[\s\-]?(\d{4})/i);
  if (maskedMatch) {
    return { aadhaarNumber: `XXXX-XXXX-${maskedMatch[1]}`, nameOnCard: null, dob: null, yearOfBirth: null, gender: null, address: null };
  }

  // Full 12-digit: may have spaces
  const digitClean = text.replace(/[\s\-]/g, '');
  const fullMatch = digitClean.match(/[2-9]\d{11}/);
  const aadhaarNumber = fullMatch
    ? `${fullMatch[0].slice(0, 4)}-${fullMatch[0].slice(4, 8)}-${fullMatch[0].slice(8)}`
    : null;

  const nameMatch = text.match(/\n([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\n/);
  const dobMatch = text.match(/(?:DOB|Date of Birth|Birth)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
  const yobMatch = text.match(/(?:Year of Birth|YOB)[:\s]*(\d{4})/i);
  const genderMatch = text.match(/\b(MALE|FEMALE|TRANSGENDER|Male|Female)\b/);
  const addressMatch = text.match(/(?:Address|Addr)[:\s]+(.{10,120}?)(?:\n\n|\Z)/is);

  return {
    aadhaarNumber,
    nameOnCard: nameMatch ? nameMatch[1].trim() : null,
    dob: dobMatch ? dobMatch[1] : null,
    yearOfBirth: yobMatch ? yobMatch[1] : null,
    gender: genderMatch ? genderMatch[1].toUpperCase() : null,
    address: addressMatch ? addressMatch[1].trim().replace(/\s+/g, ' ') : null,
  };
}

export function extractPassport(text: string): {
  passportNumber: string | null; nameOnCard: string | null; dob: string | null; expiryDate: string | null; placeOfBirth: string | null;
} {
  const upper = text.toUpperCase();

  const numMatch = upper.match(/\b([A-Z][1-9]\d{5}[1-9])\b/);
  const dobMatch = text.match(/(?:Date of Birth|DOB)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
  const expiryMatch = text.match(/(?:Date of Expiry|Expiry)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
  const pobMatch = text.match(/(?:Place of Birth)[:\s]*([A-Z][a-zA-Z ]{2,30})/i);

  // MRZ name extraction
  let name: string | null = null;
  const mrzMatch = upper.match(/P<IND([A-Z]+)<<([A-Z<]+)/);
  if (mrzMatch) {
    name = mrzMatch[1] + ' ' + mrzMatch[2].replace(/<+/g, ' ').trim();
  } else {
    const nameMatch = text.match(/(?:Given Name|Full Name|Holder)[:\s]+([A-Z][A-Za-z ]{2,40})/i);
    if (nameMatch) name = nameMatch[1].trim();
  }

  return {
    passportNumber: numMatch ? numMatch[1] : null,
    nameOnCard: name,
    dob: dobMatch ? dobMatch[1] : null,
    expiryDate: expiryMatch ? expiryMatch[1] : null,
    placeOfBirth: pobMatch ? pobMatch[1].trim() : null,
  };
}

export function extractVoterID(text: string): {
  epicNumber: string | null; nameOnCard: string | null; fatherName: string | null; address: string | null;
} {
  const upper = text.toUpperCase();
  const epicMatch = upper.match(/\b([A-Z]{3}\d{7})\b/);
  const nameMatch = text.match(/(?:Elector'?s?\s*Name|Name)[:\s]+([A-Z][A-Za-z ]{2,40})/i);
  const fatherMatch = text.match(/(?:Father'?s?\s*Name|Husband'?s?\s*Name|Relation)[:\s]+([A-Z][A-Za-z ]{2,40})/i);
  const addrMatch = text.match(/(?:Address)[:\s]+(.{10,120}?)(?:\n\n|\Z)/is);

  return {
    epicNumber: epicMatch ? epicMatch[1] : null,
    nameOnCard: nameMatch ? nameMatch[1].trim() : null,
    fatherName: fatherMatch ? fatherMatch[1].trim() : null,
    address: addrMatch ? addrMatch[1].trim() : null,
  };
}

export function extractDrivingLicense(text: string): {
  dlNumber: string | null; nameOnCard: string | null; dob: string | null; validTill: string | null; vehicleClasses: string | null;
} {
  const upper = text.toUpperCase();
  const dlMatch = upper.match(/\b([A-Z]{2}[-\s]?\d{1,2}[-\s]?\d{4}[-\s]?\d{7})\b/);
  const nameMatch = text.match(/(?:Name|Holder)[:\s]+([A-Z][A-Za-z ]{2,40})/i);
  const dobMatch = text.match(/(?:DOB|Date of Birth)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
  const expiryMatch = text.match(/(?:Valid Till|Valid Until|Expiry)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
  const covMatch = text.match(/(?:COV|Vehicle Class|Class of Vehicle)[:\s]*([A-Z0-9\s,\/]+)/i);

  return {
    dlNumber: dlMatch ? dlMatch[1].replace(/[\s-]+/g, '-') : null,
    nameOnCard: nameMatch ? nameMatch[1].trim() : null,
    dob: dobMatch ? dobMatch[1] : null,
    validTill: expiryMatch ? expiryMatch[1] : null,
    vehicleClasses: covMatch ? covMatch[1].trim() : null,
  };
}

export function extractEducation(text: string): {
  name: string | null; yearOfPassing: string | null; rollNumber: string | null; institutionName: string | null;
} {
  const nameMatch = text.match(/(?:Student|Candidate|Name)[:\s]+([A-Z][A-Za-z ]{2,40})/i);
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const rollMatch = text.match(/(?:Roll|Registration|Enrolment)[:\s]+([A-Z0-9]+)/i);
  const instMatch = text.match(/(?:University|Board|Institute|College)[:\s]+([A-Z][A-Za-z &.,]{2,60})/i);

  return {
    name: nameMatch ? nameMatch[1].trim() : null,
    yearOfPassing: yearMatch ? yearMatch[0] : null,
    rollNumber: rollMatch ? rollMatch[1] : null,
    institutionName: instMatch ? instMatch[1].trim() : null,
  };
}

export function extractEmployment(text: string): {
  employeeName: string | null; companyName: string | null; designation: string | null; dateRange: string | null;
} {
  const nameMatch = text.match(/(?:Employee|Dear|Mr\.|Ms\.|Mrs\.)\s+([A-Z][A-Za-z ]{2,40})/i);
  const companyMatch = text.match(/(?:Company|Organisation|Organization|Employer)[:\s]+([A-Z][A-Za-z &.,]{2,60})/i);
  const designationMatch = text.match(/(?:Designation|Position|Role)[:\s]+([A-Z][A-Za-z ]{2,40})/i);
  const datesMatch = text.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/g);

  return {
    employeeName: nameMatch ? nameMatch[1].trim() : null,
    companyName: companyMatch ? companyMatch[1].trim() : null,
    designation: designationMatch ? designationMatch[1].trim() : null,
    dateRange: datesMatch && datesMatch.length >= 2 ? `${datesMatch[0]} – ${datesMatch[datesMatch.length - 1]}` : datesMatch?.[0] || null,
  };
}

// ─── Document Type Detection ──────────────────────────────────────────────────

export function detectDocumentType(text: string, declaredType?: string): string {
  if (declaredType && declaredType !== 'AUTO' && declaredType !== 'OTHER' && declaredType !== 'UNKNOWN') {
    return declaredType;
  }

  const upper = text.toUpperCase();

  if ((upper.includes('INCOME TAX') || upper.includes('PERMANENT ACCOUNT NUMBER')) && /[A-Z]{5}\d{4}[A-Z]/.test(upper)) return 'PAN';
  if (upper.includes('UIDAI') || upper.includes('AADHAAR') || text.includes('आधार') || /\d{4}\s\d{4}\s\d{4}/.test(text)) return 'AADHAAR';
  if ((upper.includes('PASSPORT') && upper.includes('REPUBLIC OF INDIA')) || /P<IND/.test(upper)) return 'PASSPORT';
  if (upper.includes('ELECTION COMMISSION OF INDIA') || upper.includes('EPIC') || /[A-Z]{3}\d{7}/.test(upper)) return 'VOTER_ID';
  if (upper.includes('DRIVING LICENCE') || upper.includes('TRANSPORT DEPARTMENT')) return 'DRIVING_LICENSE';
  if (upper.includes('SENIOR SECONDARY') || upper.includes('CLASS XII') || upper.includes('HIGHER SECONDARY')) return 'TWELFTH_CERTIFICATE';
  if (upper.includes('SECONDARY EDUCATION') && (upper.includes('CLASS X') || upper.includes('CLASS 10'))) return 'TENTH_CERTIFICATE';
  if (upper.includes('BACHELOR') || (upper.includes('UNIVERSITY') && upper.includes('DEGREE'))) return 'DEGREE_CERTIFICATE';
  if (upper.includes('MASTER OF') || upper.includes('MBA') || upper.includes('POST GRADUATE')) return 'POST_GRADUATION_CERTIFICATE';
  if (upper.includes('EXPERIENCE') && upper.includes('EMPLOYMENT')) return 'EXPERIENCE_LETTER';
  if (upper.includes('RELIEVING')) return 'RELIEVING_LETTER';
  if (upper.includes('OFFER LETTER') || upper.includes('APPOINTMENT LETTER')) return 'OFFER_LETTER_DOC';
  if (upper.includes('IFSC') && upper.includes('ACCOUNT')) return 'BANK_STATEMENT';
  if (upper.includes('CANCELLED') && upper.includes('CHEQUE')) return 'CANCELLED_CHEQUE';
  if (upper.includes('SALARY') && (upper.includes('BASIC') || upper.includes('HRA') || upper.includes('NET PAY'))) return 'SALARY_SLIP_DOC';

  return 'UNKNOWN';
}

// ─── Quality Analysis ─────────────────────────────────────────────────────────

function analyzeQuality(fileBuffer: Buffer, ext: string, confidence: number, textLength: number) {
  const fileSize = fileBuffer.length;

  // Screenshot: large PNG with short text
  const isPng = ext === '.png' || (fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50);
  const isScreenshot = isPng && fileSize > 300_000 && textLength < 100;

  // Legitimate scan: non-screenshot with decent size
  const isOriginalScan = ext === '.pdf' || (!isScreenshot && fileSize > 80_000);

  const resolutionQuality: 'LOW' | 'MEDIUM' | 'HIGH' =
    fileSize > 400_000 ? 'HIGH' : fileSize > 80_000 ? 'MEDIUM' : 'LOW';

  const suspicionFlags: string[] = [];
  if (isScreenshot) suspicionFlags.push('Possible screenshot — PNG file with minimal text content');
  if (fileSize < 10_000) suspicionFlags.push('File size very small — may be a thumbnail or corrupt file');
  if (confidence < 20) suspicionFlags.push(`Very low OCR confidence (${confidence.toFixed(0)}%) — document may be too blurry or distorted`);

  return { isScreenshot, isOriginalScan, resolutionQuality, suspicionFlags };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function processDocumentLocally(
  filePath: string,
  declaredType?: string,
): Promise<ExtractedDocument> {
  const ext = extname(filePath).toLowerCase();
  let rawText = '';
  let confidence = 0;
  let pdfMetadata: any = {};

  // Step 1: Extract text
  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'].includes(ext)) {
    try {
      const result = await extractTextFromImage(filePath);
      rawText = result.text;
      confidence = result.confidence;
    } catch (ocrErr: any) {
      logger.warn(`[DocProcessor] Image OCR failed: ${ocrErr.message}`);
      rawText = '';
      confidence = 0;
    }
  } else if (ext === '.pdf') {
    try {
      const result = await extractTextFromPDF(filePath);
      rawText = result.text;
      confidence = result.isScanned ? 40 : 88;
      pdfMetadata = result.metadata;
      if (result.isScanned) {
        logger.info('[DocProcessor] Scanned PDF — limited native text; OCR from PDF images requires Python service');
      }
    } catch (pdfErr: any) {
      throw pdfErr; // re-throw (password-protected, corrupt, etc.)
    }
  } else {
    return {
      rawText: '', detectedType: 'UNKNOWN', extractedFields: {},
      confidence: 0, isScreenshot: false, isOriginalScan: false,
      resolutionQuality: 'LOW', formatValid: false,
      formatErrors: [`Unsupported file type: ${ext}`], formatWarnings: [],
      suspicionFlags: [`Unsupported file extension: ${ext}`], warnings: [],
    };
  }

  // Step 2: Detect type
  const detectedType = detectDocumentType(rawText, declaredType);

  // Step 3: Extract fields based on type
  const extractedFields: Record<string, string | null> = {};
  let formatValid = true;
  const formatErrors: string[] = [];
  const formatWarnings: string[] = [];
  const warnings: string[] = [];

  switch (detectedType) {
    case 'PAN': {
      const { panNumber, nameOnCard, dob, fatherName } = extractPAN(rawText);
      extractedFields.extractedDocNumber = panNumber;
      extractedFields.extractedName = nameOnCard;
      extractedFields.extractedDob = dob;
      extractedFields.extractedFatherName = fatherName;
      if (panNumber) {
        const v = validatePAN(panNumber);
        formatValid = v.valid;
        formatErrors.push(...v.errors);
        formatWarnings.push(...v.warnings);
      } else {
        formatValid = false;
        formatErrors.push('PAN number not detectable in document');
      }
      break;
    }

    case 'AADHAAR': {
      const { aadhaarNumber, nameOnCard, dob, yearOfBirth, gender, address } = extractAadhaar(rawText);
      extractedFields.extractedDocNumber = aadhaarNumber;
      extractedFields.extractedName = nameOnCard;
      extractedFields.extractedDob = dob;
      extractedFields.extractedGender = gender;
      extractedFields.extractedAddress = address;
      if (yearOfBirth) extractedFields.yearOfBirth = yearOfBirth;
      if (aadhaarNumber && !aadhaarNumber.startsWith('X')) {
        const v = validateAadhaar(aadhaarNumber.replace(/-/g, ''));
        formatValid = v.valid;
        formatErrors.push(...v.errors);
        formatWarnings.push(...v.warnings);
      } else if (!aadhaarNumber) {
        formatValid = false;
        formatErrors.push('Aadhaar number not detectable in document');
      }
      break;
    }

    case 'PASSPORT': {
      const { passportNumber, nameOnCard, dob, expiryDate, placeOfBirth } = extractPassport(rawText);
      extractedFields.extractedDocNumber = passportNumber;
      extractedFields.extractedName = nameOnCard;
      extractedFields.extractedDob = dob;
      if (expiryDate) extractedFields.expiryDate = expiryDate;
      if (placeOfBirth) extractedFields.placeOfBirth = placeOfBirth;
      if (passportNumber) {
        const v = validatePassport(passportNumber);
        formatValid = v.valid;
        formatErrors.push(...v.errors);
        formatWarnings.push(...v.warnings);
      } else {
        formatValid = false;
        formatErrors.push('Passport number not detectable in document');
      }
      break;
    }

    case 'VOTER_ID': {
      const { epicNumber, nameOnCard, fatherName, address } = extractVoterID(rawText);
      extractedFields.extractedDocNumber = epicNumber;
      extractedFields.extractedName = nameOnCard;
      extractedFields.extractedFatherName = fatherName;
      extractedFields.extractedAddress = address;
      if (epicNumber) {
        const v = validateVoterID(epicNumber);
        formatValid = v.valid;
        formatErrors.push(...v.errors);
        formatWarnings.push(...v.warnings);
      }
      break;
    }

    case 'DRIVING_LICENSE': {
      const { dlNumber, nameOnCard, dob, validTill, vehicleClasses } = extractDrivingLicense(rawText);
      extractedFields.extractedDocNumber = dlNumber;
      extractedFields.extractedName = nameOnCard;
      extractedFields.extractedDob = dob;
      if (validTill) extractedFields.validTill = validTill;
      if (vehicleClasses) extractedFields.vehicleClasses = vehicleClasses;
      if (dlNumber) {
        const v = validateDrivingLicense(dlNumber);
        formatValid = v.valid;
        formatErrors.push(...v.errors);
        formatWarnings.push(...v.warnings);
      }
      break;
    }

    case 'TENTH_CERTIFICATE':
    case 'TWELFTH_CERTIFICATE':
    case 'DEGREE_CERTIFICATE':
    case 'POST_GRADUATION_CERTIFICATE': {
      const { name, yearOfPassing, rollNumber, institutionName } = extractEducation(rawText);
      extractedFields.extractedName = name;
      if (yearOfPassing) extractedFields.yearOfPassing = yearOfPassing;
      if (rollNumber) extractedFields.rollNumber = rollNumber;
      if (institutionName) extractedFields.institutionName = institutionName;
      break;
    }

    case 'EXPERIENCE_LETTER':
    case 'RELIEVING_LETTER':
    case 'OFFER_LETTER_DOC': {
      const { employeeName, companyName, designation, dateRange } = extractEmployment(rawText);
      extractedFields.extractedName = employeeName;
      if (companyName) extractedFields.companyName = companyName;
      if (designation) extractedFields.designation = designation;
      if (dateRange) extractedFields.dateRange = dateRange;
      break;
    }

    case 'BANK_STATEMENT':
    case 'CANCELLED_CHEQUE': {
      const accMatch = rawText.match(/(?:Account\s+(?:Number|No\.?)|A\/c\s+No\.?)[:\s]+([0-9]{9,18})/i);
      const nameMatch = rawText.match(/(?:Account\s+Holder(?:'s)?\s+(?:Name)?|Name)[:\s]+([A-Z][A-Za-z\s.]{2,40})/i);
      const ifscMatch = rawText.match(/(?:IFSC|IFSC\s+Code)[:\s]+([A-Z]{4}0[A-Z0-9]{6})/i);
      const bankMatch = rawText.match(/(?:Bank\s+(?:Name|:)|Banker)[:\s]*([A-Z][A-Za-z\s&.,]{2,50})/i);
      const micrMatch = rawText.match(/\b([0-9]{9})\b/);  // MICR code on cancelled cheques
      extractedFields.extractedName = nameMatch ? nameMatch[1].trim() : null;
      extractedFields.extractedDocNumber = accMatch ? accMatch[1] : null;
      if (ifscMatch) extractedFields.ifscCode = ifscMatch[1];
      if (bankMatch) extractedFields.bankName = bankMatch[1].trim();
      if (micrMatch && detectedType === 'CANCELLED_CHEQUE') extractedFields.micrCode = micrMatch[1];
      if (extractedFields.extractedDocNumber) {
        formatValid = true;
      } else {
        formatErrors.push('Bank account number not detectable — verify manually');
      }
      if (ifscMatch?.[1]) {
        const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscMatch[1]);
        if (!ifscOk) formatErrors.push(`IFSC code format invalid: ${ifscMatch[1]}`);
      }
      break;
    }

    case 'SALARY_SLIP_DOC': {
      const nameMatch = rawText.match(/(?:Employee\s+Name|Name\s*:)[:\s]+([A-Z][A-Za-z\s.]{2,40})/i);
      const empCodeMatch = rawText.match(/(?:Employee\s+(?:Code|ID|No\.?)|Emp\.?\s+(?:Code|ID))[:\s]+([A-Z0-9\-]+)/i);
      const netPayMatch = rawText.match(/(?:Net\s+(?:Pay|Salary)|Take\s+Home)[:\s]+(?:Rs\.?|₹)?\s*([0-9,]+)/i);
      const monthMatch = rawText.match(/(?:(?:For\s+)?(?:the\s+)?Month\s+(?:of\s+)?|Pay\s+Period)[:\s]*([A-Za-z]+\s+\d{4}|\d{1,2}[\/\-]\d{4})/i);
      extractedFields.extractedName = nameMatch ? nameMatch[1].trim() : null;
      if (empCodeMatch) extractedFields.employeeCode = empCodeMatch[1];
      if (netPayMatch) extractedFields.netPay = netPayMatch[1].replace(/,/g, '');
      if (monthMatch) extractedFields.payMonth = monthMatch[1].trim();
      formatValid = !!extractedFields.extractedName;
      if (!extractedFields.extractedName) formatErrors.push('Employee name not detectable in salary slip');
      break;
    }

    default:
      // No specific extraction for other types — still store raw text
      break;
  }

  // Step 4: Quality analysis
  const fileBuffer = existsSync(filePath) ? readFileSync(filePath) : Buffer.alloc(0);
  const quality = analyzeQuality(fileBuffer, ext, confidence, rawText.length);

  if (confidence < 50 && confidence > 0) {
    warnings.push(`Low OCR confidence (${confidence.toFixed(0)}%) — document may be blurry or low quality`);
  }

  // Step 5: PDF metadata tamper check
  const suspicionFlags = [...quality.suspicionFlags];
  if (ext === '.pdf' && pdfMetadata) {
    const { checkPdfMetadataTamper } = await import('../utils/documentFormatValidator.js');
    const tamperFlags = checkPdfMetadataTamper(pdfMetadata);
    suspicionFlags.push(...tamperFlags);
  }

  return {
    rawText: rawText.slice(0, 3000),
    detectedType,
    extractedFields,
    confidence,
    isScreenshot: quality.isScreenshot,
    isOriginalScan: quality.isOriginalScan,
    resolutionQuality: quality.resolutionQuality,
    formatValid,
    formatErrors,
    formatWarnings,
    suspicionFlags,
    warnings,
  };
}
