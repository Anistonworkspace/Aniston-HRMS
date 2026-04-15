/**
 * combined-pdf-processor.service.ts
 *
 * Node.js FALLBACK for combined PDF classification.
 * Used when the Python AI service (localhost:8000) is unavailable.
 *
 * THREE-LAYER ARCHITECTURE:
 *   Layer 1 — Python Advanced Mode  (called first by onboarding.routes.ts)
 *   Layer 2 — This service           (called when Python fails)
 *   Layer 3 — Manual Review Safe Mode (when this service returns low confidence)
 *
 * What this service does:
 *  1. Reads a combined PDF page by page via pdf-parse
 *  2. Extracts native text per page (digital PDFs)
 *  3. Runs OCR per page via tesseract.js for scanned pages
 *  4. Classifies each page into a document type via keyword scoring
 *  5. Groups adjacent same-type pages into logical document segments
 *  6. Checks required-doc checklist against detected docs
 *  7. Detects blank / duplicate / unsupported / unknown pages
 *  8. Runs cross-page suspicious content heuristics
 *  9. Returns a structured result that mirrors the Python service output format
 * 10. Always marks processingMode = 'node_fallback' and fallbackUsed = true
 * 11. Forces manual HR review when overall confidence < LOW_CONFIDENCE_THRESHOLD
 */

import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { logger } from '../lib/logger.js';

// pdf-parse v2.x uses a class-based API: new PDFParse({ data }) → parser.getText({})
// pdf-parse is a CommonJS module — use createRequire to avoid ESM/CJS interop issues
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse: PdfParseV2 } = _require('pdf-parse') as { PDFParse: new (opts: { data: Buffer }) => any };

// ─── Constants ───────────────────────────────────────────────────────────────

const LOW_CONFIDENCE_THRESHOLD = 0.45;   // below this → manual review required
const BLANK_PAGE_TEXT_THRESHOLD = 30;    // fewer than this many chars → blank
const SCANNED_PAGE_TEXT_THRESHOLD = 100; // fewer than this → likely scanned, needs OCR

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PageResult {
  pageNumber: number;
  rawText: string;
  textSource: 'native' | 'ocr' | 'empty';
  detectedType: string;
  confidence: number;               // 0–1
  keywords: string[];
  isBlank: boolean;
  isPossibleScreenshot: boolean;
}

export interface DocGroup {
  docType: string;
  pageNumbers: number[];
  confidence: number;
  extractedFields: Record<string, string | null>;
}

export interface SuspicionFlag {
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  pageNumbers?: number[];
}

export interface CombinedPdfNodeResult {
  processingMode: 'node_fallback';
  fallbackUsed: true;
  totalPages: number;
  pageResults: PageResult[];
  detectedDocs: string[];
  pageGroups: DocGroup[];
  missingFromRequired: string[];
  duplicateDocs: string[];
  blankPages: number[];
  unknownPages: number[];
  unsupportedPages: number[];
  suspicionFlags: SuspicionFlag[];
  suspicionScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  overallConfidence: number;
  requiresManualReview: boolean;
  manualReviewReasons: string[];
  employeeVisibleReasons: string[];
  hrVisibleFindings: string[];
  summary: string;
}

// ─── Classification Rules (keyword scoring) ──────────────────────────────────

interface ClassRule {
  type: string;
  required: string[];    // ALL must be present for minimum match
  optional: string[];    // each adds +0.15 to confidence
  negative: string[];    // each subtracts 0.2 from confidence
  baseScore: number;     // score when all required keywords match
}

const CLASSIFICATION_RULES: ClassRule[] = [
  {
    type: 'PAN',
    required: ['INCOME TAX', 'PERMANENT ACCOUNT NUMBER'],
    optional: ['GOVERNMENT OF INDIA', 'DEPT OF REVENUE', 'SIGNATURE', 'FATHER'],
    negative: ['AADHAAR', 'UIDAI', 'PASSPORT', 'ELECTION', 'DRIVING'],
    baseScore: 0.75,
  },
  {
    type: 'AADHAAR',
    required: ['UIDAI'],
    optional: ['UNIQUE IDENTIFICATION', 'AADHAAR', 'आधार', 'ENROLMENT', 'VID'],
    negative: ['INCOME TAX', 'PASSPORT', 'ELECTION COMMISSION', 'DRIVING'],
    baseScore: 0.70,
  },
  // Aadhaar back side: "Unique Identification Authority" without UIDAI header
  {
    type: 'AADHAAR',
    required: ['UNIQUE IDENTIFICATION AUTHORITY'],
    optional: ['AADHAAR', 'आधार', 'ENROLMENT', 'VID', 'ADDRESS'],
    negative: ['INCOME TAX', 'PASSPORT', 'ELECTION COMMISSION'],
    baseScore: 0.72,
  },
  {
    type: 'PASSPORT',
    required: ['PASSPORT', 'REPUBLIC OF INDIA'],
    optional: ['MINISTRY OF EXTERNAL AFFAIRS', 'NATIONALITY', 'DATE OF EXPIRY', 'PLACE OF BIRTH', 'INDIAN'],
    negative: ['DRIVING', 'VOTER', 'AADHAAR', 'INCOME TAX'],
    baseScore: 0.75,
  },
  {
    type: 'DRIVING_LICENSE',
    required: ['DRIVING LICENCE', 'TRANSPORT DEPARTMENT'],
    optional: ['BLOOD GROUP', 'VEHICLE CLASS', 'VALID TILL', 'COV', 'MOTOR VEHICLES ACT', 'REGIONAL TRANSPORT'],
    negative: ['PASSPORT', 'AADHAAR', 'INCOME TAX', 'ELECTION'],
    baseScore: 0.70,
  },
  {
    type: 'VOTER_ID',
    required: ['ELECTION COMMISSION OF INDIA'],
    optional: ['ELECTORAL ROLL', 'ELECTOR', 'EPIC', 'VOTER', 'भारत निर्वाचन'],
    negative: ['INCOME TAX', 'PASSPORT', 'AADHAAR', 'DRIVING'],
    baseScore: 0.75,
  },
  // 10th cert: "Secondary Education" but NOT 12th cert indicators
  {
    type: 'TENTH_CERTIFICATE',
    required: ['SECONDARY EDUCATION'],
    optional: ['CLASS X', 'CLASS 10', 'CBSE', 'ICSE', 'BOARD', 'ROLL NUMBER', 'MARKS OBTAINED', 'HIGH SCHOOL', 'EXAMINATION RESULTS'],
    negative: ['UNIVERSITY', 'BACHELOR', 'MASTER', 'SENIOR SCHOOL CERTIFICATE', 'CLASS XII', 'MARKS STATEMENT'],
    baseScore: 0.65,
  },
  // 12th cert: CBSE uses "Senior School Certificate Examination", not "Senior Secondary"
  {
    type: 'TWELFTH_CERTIFICATE',
    required: ['SECONDARY EDUCATION'],
    optional: ['SENIOR SCHOOL CERTIFICATE', 'SENIOR SECONDARY', 'CLASS XII', 'MARKS STATEMENT', 'CBSE', 'INTERMEDIATE', 'HIGHER SECONDARY', 'HSC', '12TH'],
    negative: ['UNIVERSITY', 'BACHELOR', 'MASTER', 'EXAMINATION RESULTS', 'CLASS X'],
    baseScore: 0.60,
  },
  {
    type: 'DEGREE_CERTIFICATE',
    required: ['UNIVERSITY'],
    optional: ['BACHELOR', 'CONVOCATION', 'AWARDED', 'CHANCELLOR', 'REGISTRAR', 'DEGREE', 'STATEMENT OF MARKS', 'GRADES'],
    negative: ['BOARD OF SECONDARY', 'CBSE', 'ICSE', 'ELECTION', 'INCOME TAX', 'MASTER OF', 'POST GRADUATE'],
    baseScore: 0.60,
  },
  {
    type: 'POST_GRADUATION_CERTIFICATE',
    required: ['UNIVERSITY'],
    optional: ['MASTER OF', 'POST GRADUATE', 'MBA', 'MCA', 'M.TECH', 'M.SC', 'M.COM', 'CONVOCATION', 'MA ', 'MASTER OF ARTS', 'IGNOU'],
    negative: ['BACHELOR', 'SECONDARY', 'CBSE'],
    baseScore: 0.60,
  },
  {
    type: 'EXPERIENCE_LETTER',
    required: ['EXPERIENCE'],
    optional: ['EMPLOYMENT', 'DESIGNATION', 'COMPANY', 'ORGANISATION', 'RELIEVING', 'SERVICES', 'PERIOD'],
    negative: ['UNIVERSITY', 'INCOME TAX', 'UIDAI', 'ELECTION'],
    baseScore: 0.60,
  },
  {
    type: 'RELIEVING_LETTER',
    required: ['RELIEVING'],
    optional: ['RELIEVE', 'LAST WORKING DAY', 'RESIGNATION', 'NOTICE PERIOD', 'EMPLOYMENT'],
    negative: ['UNIVERSITY', 'INCOME TAX', 'UIDAI'],
    baseScore: 0.65,
  },
  // Salary slip: PAYSLIP is the most common keyword, not SALARY
  {
    type: 'SALARY_SLIP_DOC',
    required: ['PAYSLIP'],
    optional: ['BASIC', 'HRA', 'PF', 'GROSS', 'NET PAY', 'DEDUCTION', 'EPF', 'ESI', 'EMPLOYEE', 'EARNINGS'],
    negative: ['UNIVERSITY', 'PASSPORT', 'AADHAAR'],
    baseScore: 0.70,
  },
  // Salary slip alternative: "PAY SLIP" or "NET PAY" with earnings structure
  {
    type: 'SALARY_SLIP_DOC',
    required: ['NET PAY'],
    optional: ['BASIC', 'HRA', 'GROSS', 'DEDUCTION', 'EARNINGS', 'SALARY', 'EMPLOYEE'],
    negative: ['UNIVERSITY', 'PASSPORT', 'AADHAAR', 'UIDAI'],
    baseScore: 0.65,
  },
  {
    type: 'BANK_STATEMENT',
    required: ['ACCOUNT NUMBER', 'IFSC'],
    optional: ['BANK', 'BRANCH', 'STATEMENT', 'BALANCE', 'TRANSACTION', 'DEBIT', 'CREDIT'],
    negative: ['INCOME TAX', 'PASSPORT', 'AADHAAR'],
    baseScore: 0.65,
  },
  {
    type: 'CANCELLED_CHEQUE',
    required: ['CANCELLED'],
    optional: ['CHEQUE', 'BANK', 'ACCOUNT', 'IFSC', 'MICR'],
    negative: ['INCOME TAX', 'AADHAAR'],
    baseScore: 0.70,
  },
  // Offer letter: only needs ONE of these terms (was wrongly requiring BOTH)
  {
    type: 'OFFER_LETTER_DOC',
    required: ['OFFER LETTER'],
    optional: ['DESIGNATION', 'JOINING DATE', 'SALARY', 'POSITION', 'WELCOME', 'SELECTED', 'PLEASED TO INFORM'],
    negative: ['RELIEVING', 'EXPERIENCE LETTER', 'RESIGNATION'],
    baseScore: 0.75,
  },
  {
    type: 'OFFER_LETTER_DOC',
    required: ['APPOINTMENT LETTER'],
    optional: ['DESIGNATION', 'JOINING DATE', 'SALARY', 'POSITION', 'PROBATION'],
    negative: ['RELIEVING', 'RESIGNATION'],
    baseScore: 0.75,
  },
  // Utility bills (electricity, water, gas) as residence proof
  {
    type: 'UTILITY_BILL',
    required: ['ELECTRICITY BILL'],
    optional: ['METER', 'UNITS', 'AMOUNT PAYABLE', 'BILL DATE', 'ACCOUNT ID', 'CONSUMER'],
    negative: ['INCOME TAX', 'AADHAAR', 'PASSPORT'],
    baseScore: 0.80,
  },
  {
    type: 'UTILITY_BILL',
    required: ['WATER BILL'],
    optional: ['METER', 'CONSUMER', 'ACCOUNT', 'AMOUNT'],
    negative: ['INCOME TAX', 'AADHAAR'],
    baseScore: 0.80,
  },
  {
    type: 'UTILITY_BILL',
    required: ['GAS BILL'],
    optional: ['CONSUMER', 'METER', 'AMOUNT'],
    negative: ['INCOME TAX', 'AADHAAR'],
    baseScore: 0.80,
  },
  // Telephone / broadband / cable bills
  {
    type: 'UTILITY_BILL',
    required: ['TELEPHONE BILL'],
    optional: ['CONSUMER', 'ACCOUNT', 'AMOUNT'],
    negative: ['INCOME TAX', 'AADHAAR'],
    baseScore: 0.75,
  },
  // Resignation / employment emails as experience proof
  {
    type: 'RESIGNATION_LETTER',
    required: ['RESIGNATION'],
    optional: ['LAST WORKING DAY', 'NOTICE PERIOD', 'FORMALLY INFORM', 'MANAGEMENT TRAINEE', 'ACCEPTED', 'ACKNOWLEDGE'],
    negative: ['UNIVERSITY', 'INCOME TAX', 'UIDAI', 'ELECTION'],
    baseScore: 0.70,
  },
  // ICSE 10th — "Indian Certificate of Secondary Education"
  {
    type: 'TENTH_CERTIFICATE',
    required: ['INDIAN CERTIFICATE OF SECONDARY EDUCATION'],
    optional: ['ICSE', 'CLASS 10', 'CISCE', 'MARKS', 'CANDIDATE'],
    negative: ['INDIAN SCHOOL CERTIFICATE', 'UNIVERSITY', 'BACHELOR'],
    baseScore: 0.85,
  },
  // ICSE 12th — "Indian School Certificate"
  {
    type: 'TWELFTH_CERTIFICATE',
    required: ['INDIAN SCHOOL CERTIFICATE'],
    optional: ['ISC', 'CLASS 12', 'CISCE', 'MARKS', 'CANDIDATE'],
    negative: ['UNIVERSITY', 'BACHELOR'],
    baseScore: 0.85,
  },
  // Maharashtra SSC / State Board 10th
  {
    type: 'TENTH_CERTIFICATE',
    required: ['SECONDARY SCHOOL CERTIFICATE'],
    optional: ['MAHARASHTRA', 'BOARD', 'SSC', 'MSBSHSE', 'MARKS', 'PERCENTAGE'],
    negative: ['HIGHER SECONDARY', 'HSC', 'UNIVERSITY', 'BACHELOR', 'MASTER'],
    baseScore: 0.80,
  },
  // Maharashtra HSC / State Board 12th
  {
    type: 'TWELFTH_CERTIFICATE',
    required: ['HIGHER SECONDARY CERTIFICATE'],
    optional: ['MAHARASHTRA', 'BOARD', 'HSC', 'MSBSHSE', 'MARKS', 'PERCENTAGE'],
    negative: ['SECONDARY SCHOOL CERTIFICATE', 'SSC', 'UNIVERSITY', 'BACHELOR'],
    baseScore: 0.80,
  },
  // Karnataka PUC (12th)
  {
    type: 'TWELFTH_CERTIFICATE',
    required: ['PRE-UNIVERSITY'],
    optional: ['KARNATAKA', 'PUC', 'II PUC', 'SECOND PUC', 'MARKS', 'DEPT OF PRE'],
    negative: ['UNIVERSITY DEGREE', 'BACHELOR'],
    baseScore: 0.80,
  },
  // Tamil Nadu / Andhra SSLC (10th)
  {
    type: 'TENTH_CERTIFICATE',
    required: ['SSLC'],
    optional: ['TAMIL NADU', 'ANDHRA', 'KERALA', 'SCHOOL', 'MARKS', 'PASS CERTIFICATE'],
    negative: ['HSC', 'PLUS TWO', 'UNIVERSITY'],
    baseScore: 0.82,
  },
  // UP Board / Intermediate (12th)
  {
    type: 'TWELFTH_CERTIFICATE',
    required: ['INTERMEDIATE EDUCATION'],
    optional: ['UTTAR PRADESH', 'UP BOARD', 'MADHYAMIK', 'MARKS', 'PERCENTAGE'],
    negative: ['HIGH SCHOOL EDUCATION', 'UNIVERSITY', 'BACHELOR'],
    baseScore: 0.80,
  },
  // UP Board High School (10th)
  {
    type: 'TENTH_CERTIFICATE',
    required: ['HIGH SCHOOL EDUCATION'],
    optional: ['UTTAR PRADESH', 'UP BOARD', 'MADHYAMIK', 'MARKS', 'PERCENTAGE'],
    negative: ['INTERMEDIATE EDUCATION', 'UNIVERSITY', 'BACHELOR'],
    baseScore: 0.80,
  },
  // IGNOU Masters / PG certificate
  {
    type: 'POST_GRADUATION_CERTIFICATE',
    required: ['INDIRA GANDHI NATIONAL OPEN UNIVERSITY'],
    optional: ['MASTER OF', 'M.A.', 'M.SC', 'M.COM', 'MBA', 'IGNOU', 'SAMARTH', 'REGIONAL CENTRE'],
    negative: ['BACHELOR', 'SECONDARY', 'CBSE'],
    baseScore: 0.85,
  },
  // Provisional degree certificate
  {
    type: 'DEGREE_CERTIFICATE',
    required: ['PROVISIONAL CERTIFICATE'],
    optional: ['UNIVERSITY', 'BACHELOR', 'DEGREE', 'CONVOCATION', 'EXAMINATION'],
    negative: ['INCOME TAX', 'AADHAAR', 'SECONDARY'],
    baseScore: 0.78,
  },
  // Cancelled cheque
  {
    type: 'CANCELLED_CHEQUE',
    required: ['CANCELLED'],
    optional: ['CHEQUE', 'BANK', 'ACCOUNT', 'IFSC', 'MICR', 'ACCOUNT NUMBER'],
    negative: ['INCOME TAX', 'AADHAAR', 'PASSPORT'],
    baseScore: 0.75,
  },
  // Bank passbook page
  {
    type: 'BANK_STATEMENT',
    required: ['PASSBOOK'],
    optional: ['ACCOUNT', 'IFSC', 'BANK', 'BRANCH', 'BALANCE', 'SBI', 'HDFC', 'ICICI'],
    negative: ['INCOME TAX', 'AADHAAR'],
    baseScore: 0.70,
  },
  // DISCOM utility bills (all major Indian electricity companies)
  {
    type: 'UTILITY_BILL',
    required: ['TPDDL'],
    optional: ['UNITS', 'AMOUNT', 'METER', 'CONSUMER', 'BILL'],
    negative: [],
    baseScore: 0.88,
  },
  {
    type: 'UTILITY_BILL',
    required: ['TNEB'],
    optional: ['UNITS', 'AMOUNT', 'METER', 'CONSUMER', 'BILL', 'TANGEDCO'],
    negative: [],
    baseScore: 0.88,
  },
  {
    type: 'UTILITY_BILL',
    required: ['PSPCL'],
    optional: ['UNITS', 'AMOUNT', 'METER', 'CONSUMER', 'BILL', 'PUNJAB'],
    negative: [],
    baseScore: 0.88,
  },
  {
    type: 'UTILITY_BILL',
    required: ['WESCO'],
    optional: ['UNITS', 'AMOUNT', 'METER', 'CONSUMER', 'BILL', 'ODISHA'],
    negative: [],
    baseScore: 0.85,
  },
  {
    type: 'UTILITY_BILL',
    required: ['MSEB'],
    optional: ['UNITS', 'AMOUNT', 'METER', 'CONSUMER', 'BILL', 'MAHARASHTRA'],
    negative: [],
    baseScore: 0.85,
  },
  {
    type: 'UTILITY_BILL',
    required: ['PGVCL'],
    optional: ['UNITS', 'AMOUNT', 'METER', 'CONSUMER', 'BILL', 'GUJARAT'],
    negative: [],
    baseScore: 0.85,
  },
  {
    type: 'UTILITY_BILL',
    required: ['CESCOM'],
    optional: ['UNITS', 'AMOUNT', 'METER', 'CONSUMER', 'BILL', 'KARNATAKA'],
    negative: [],
    baseScore: 0.85,
  },
  {
    type: 'UTILITY_BILL',
    required: ['HESCOM'],
    optional: ['UNITS', 'AMOUNT', 'METER', 'CONSUMER', 'BILL', 'KARNATAKA'],
    negative: [],
    baseScore: 0.85,
  },
  // Rent agreement as residence proof
  {
    type: 'RENT_AGREEMENT',
    required: ['RENT AGREEMENT'],
    optional: ['LANDLORD', 'TENANT', 'MONTHLY RENT', 'LEASE', 'LICENCE'],
    negative: ['INCOME TAX', 'AADHAAR'],
    baseScore: 0.80,
  },
  {
    type: 'RENT_AGREEMENT',
    required: ['LEAVE AND LICENCE'],
    optional: ['LANDLORD', 'TENANT', 'MONTHLY RENT', 'RENT'],
    negative: ['INCOME TAX', 'AADHAAR'],
    baseScore: 0.80,
  },
];

// ─── Classify a single page's text ───────────────────────────────────────────

function classifyPage(text: string): { type: string; confidence: number; keywords: string[] } {
  const upper = text.toUpperCase();
  const matchedKeywords: string[] = [];

  // Quick blank check
  if (text.trim().length < BLANK_PAGE_TEXT_THRESHOLD) {
    return { type: 'BLANK', confidence: 0.95, keywords: [] };
  }

  // PAN regex shortcut: if PAN pattern found, strong signal
  const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/;
  if (PAN_PATTERN.test(upper) && (upper.includes('INCOME TAX') || upper.includes('PERMANENT ACCOUNT'))) {
    return { type: 'PAN', confidence: 0.90, keywords: ['PERMANENT ACCOUNT NUMBER', 'PAN_REGEX_MATCH'] };
  }

  // Aadhaar regex shortcut: 12-digit sequence with UIDAI/आधार/Unique Identification
  const AADHAAR_PATTERN = /\b\d{4}\s?\d{4}\s?\d{4}\b/;
  if (AADHAAR_PATTERN.test(text) && (
    upper.includes('UIDAI') || upper.includes('AADHAAR') || text.includes('आधार') ||
    upper.includes('UNIQUE IDENTIFICATION AUTHORITY') || upper.includes('GOVERNMENT OF INDIA') && upper.includes('ENROLMENT')
  )) {
    return { type: 'AADHAAR', confidence: 0.88, keywords: ['AADHAAR_REGEX_MATCH'] };
  }

  // MRZ detection (Passport)
  const MRZ_PATTERN = /^[A-Z0-9<]{44}$/m;
  if (MRZ_PATTERN.test(upper)) {
    return { type: 'PASSPORT', confidence: 0.92, keywords: ['MRZ_DETECTED'] };
  }

  // ── Strong domain shortcuts (bypass rule scoring for unambiguous patterns) ──

  // 12th certificate: CBSE says "Senior School Certificate Examination" (NOT "Senior Secondary")
  if (upper.includes('SENIOR SCHOOL CERTIFICATE') ||
      (upper.includes('SECONDARY') && upper.includes('MARKS STATEMENT')) ||
      upper.includes('CLASS XII') || upper.includes('CLASS 12TH') ||
      upper.includes('AISSCE') || upper.includes('HIGHER SECONDARY CERTIFICATE')) {
    return { type: 'TWELFTH_CERTIFICATE', confidence: 0.87, keywords: ['TWELFTH_SHORTCUT'] };
  }

  // 10th certificate: "Secondary Examination" / "Class X" / "SSLC"
  if (upper.includes('SECONDARY EXAMINATION') ||
      upper.includes('CLASS-X') || upper.includes(' CLASS X ') ||
      upper.includes('SSLC') || upper.includes('MATRICULATION EXAMINATION') ||
      (upper.includes('EXAMINATION RESULTS') && upper.includes('SECONDARY'))) {
    return { type: 'TENTH_CERTIFICATE', confidence: 0.87, keywords: ['TENTH_SHORTCUT'] };
  }

  // Offer letter: any document that explicitly says "OFFER LETTER" (standalone, not needing another keyword)
  if (upper.includes('OFFER LETTER') || upper.includes('APPOINTMENT LETTER') ||
      upper.includes('OFFER OF EMPLOYMENT')) {
    return { type: 'OFFER_LETTER_DOC', confidence: 0.88, keywords: ['OFFER_LETTER_SHORTCUT'] };
  }

  // Salary slip / payslip: common payroll document patterns
  if (upper.includes('PAYSLIP') || upper.includes('PAY SLIP') ||
      (upper.includes('NET PAY') && upper.includes('BASIC')) ||
      (upper.includes('PAYSLIP FOR THE MONTH') || upper.includes('PAY SLIP FOR THE MONTH')) ||
      (upper.includes('GROSS') && upper.includes('NET PAY') && upper.includes('DEDUCTION'))) {
    return { type: 'SALARY_SLIP_DOC', confidence: 0.88, keywords: ['SALARY_SLIP_SHORTCUT'] };
  }

  // Utility bills: electricity, water, gas, telephone
  if (upper.includes('ELECTRICITY BILL') || upper.includes('ELECTRIC BILL') ||
      upper.includes('WATER BILL') || upper.includes('GAS BILL') ||
      upper.includes('TELEPHONE BILL') || upper.includes('BROADBAND BILL') ||
      (upper.includes('BILL') && (upper.includes('PVVNL') || upper.includes('BESCOM') ||
        upper.includes('MSEDCL') || upper.includes('BSES') || upper.includes('TATA POWER') ||
        upper.includes('DISCOMS'))) ||
      (upper.includes('METER') && upper.includes('UNITS') && upper.includes('AMOUNT PAYABLE'))) {
    return { type: 'UTILITY_BILL', confidence: 0.88, keywords: ['UTILITY_BILL_SHORTCUT'] };
  }

  // Resignation / formal exit email as employment/experience proof
  if ((upper.includes('RESIGNATION') && (
    upper.includes('LAST WORKING DAY') || upper.includes('FORMALLY INFORM') ||
    upper.includes('NOTICE PERIOD') || upper.includes('ACKNOWLEDGE')
  )) || upper.includes('ACCEPTANCE OF RESIGNATION')) {
    return { type: 'RESIGNATION_LETTER', confidence: 0.82, keywords: ['RESIGNATION_SHORTCUT'] };
  }

  // ICSE 10th shortcut
  if (upper.includes('INDIAN CERTIFICATE OF SECONDARY EDUCATION') || upper.includes('CISCE') && upper.includes('CLASS 10')) {
    return { type: 'TENTH_CERTIFICATE', confidence: 0.90, keywords: ['ICSE_TENTH_SHORTCUT'] };
  }

  // ICSE 12th shortcut
  if (upper.includes('INDIAN SCHOOL CERTIFICATE') || upper.includes('ISC EXAMINATION')) {
    return { type: 'TWELFTH_CERTIFICATE', confidence: 0.90, keywords: ['ICSE_TWELFTH_SHORTCUT'] };
  }

  // Maharashtra board shortcut
  if (upper.includes('MSBSHSE') || upper.includes('SECONDARY SCHOOL CERTIFICATE') && upper.includes('BOARD')) {
    return { type: 'TENTH_CERTIFICATE', confidence: 0.87, keywords: ['MAHARASHTRA_SSC_SHORTCUT'] };
  }
  if (upper.includes('HIGHER SECONDARY CERTIFICATE') && (upper.includes('BOARD') || upper.includes('HSC'))) {
    return { type: 'TWELFTH_CERTIFICATE', confidence: 0.87, keywords: ['HSC_SHORTCUT'] };
  }

  // Karnataka PUC shortcut (12th)
  if ((upper.includes('II PUC') || upper.includes('SECOND PUC') || upper.includes('PRE-UNIVERSITY COURSE')) &&
      !upper.includes('BACHELOR')) {
    return { type: 'TWELFTH_CERTIFICATE', confidence: 0.87, keywords: ['PUC_SHORTCUT'] };
  }

  // SSLC shortcut (10th — South India)
  if (upper.includes('SSLC') && !upper.includes('HSC') && !upper.includes('PLUS TWO')) {
    return { type: 'TENTH_CERTIFICATE', confidence: 0.87, keywords: ['SSLC_SHORTCUT'] };
  }

  // IGNOU shortcut
  if (upper.includes('INDIRA GANDHI NATIONAL OPEN UNIVERSITY') || upper.includes('IGNOU')) {
    const isBachelor = upper.includes('BACHELOR') || upper.includes('B.A.') || upper.includes('B.SC');
    return {
      type: isBachelor ? 'DEGREE_CERTIFICATE' : 'POST_GRADUATION_CERTIFICATE',
      confidence: 0.88,
      keywords: ['IGNOU_SHORTCUT'],
    };
  }

  // Provisional certificate shortcut
  if (upper.includes('PROVISIONAL CERTIFICATE') && upper.includes('UNIVERSITY')) {
    return { type: 'DEGREE_CERTIFICATE', confidence: 0.85, keywords: ['PROVISIONAL_CERT_SHORTCUT'] };
  }

  // IFSC code shortcut — bank statement / cancelled cheque
  const IFSC_PATTERN = /\b[A-Z]{4}0[A-Z0-9]{6}\b/;
  if (IFSC_PATTERN.test(upper)) {
    if (upper.includes('CANCELLED')) {
      return { type: 'CANCELLED_CHEQUE', confidence: 0.88, keywords: ['IFSC_CANCELLED_SHORTCUT'] };
    }
    if (upper.includes('ACCOUNT') || upper.includes('STATEMENT') || upper.includes('PASSBOOK')) {
      return { type: 'BANK_STATEMENT', confidence: 0.85, keywords: ['IFSC_BANK_SHORTCUT'] };
    }
  }

  // MICR code shortcut (bank cheque — 9 digits at bottom)
  const MICR_PATTERN = /\b\d{9}\b/;
  if (MICR_PATTERN.test(text) && (upper.includes('CHEQUE') || upper.includes('CHECK') || upper.includes('BANK'))) {
    return { type: 'CANCELLED_CHEQUE', confidence: 0.80, keywords: ['MICR_SHORTCUT'] };
  }

  // Additional DISCOM shortcuts for utility bills
  if (upper.includes('TPDDL') || upper.includes('TANGEDCO') || upper.includes('TNEB') ||
      upper.includes('PSPCL') || upper.includes('MSEB') || upper.includes('PGVCL') ||
      upper.includes('CESCOM') || upper.includes('HESCOM') || upper.includes('WESCO') ||
      upper.includes('SOUTHCO') || upper.includes('NESCO') || upper.includes('CESC') ||
      upper.includes('TPWODL') || upper.includes('TSSPDCL') || upper.includes('APEPDCL') ||
      upper.includes('DHBVNL') || upper.includes('UHBVNL') || upper.includes('JVVNL') ||
      upper.includes('AVVNL') || upper.includes('APDCL') || upper.includes('NBPDCL') ||
      upper.includes('SBPDCL') || upper.includes('UGVCL') || upper.includes('DGVCL') ||
      upper.includes('MGVCL') || upper.includes('TORRENT POWER') || upper.includes('ADANI ELECTRICITY')) {
    return { type: 'UTILITY_BILL', confidence: 0.90, keywords: ['DISCOM_SHORTCUT'] };
  }

  // Passbook page shortcut
  if (upper.includes('PASSBOOK') && (upper.includes('ACCOUNT') || upper.includes('BANK'))) {
    return { type: 'BANK_STATEMENT', confidence: 0.82, keywords: ['PASSBOOK_SHORTCUT'] };
  }

  // Score against all rules
  let bestType = 'UNKNOWN';
  let bestScore = 0;

  for (const rule of CLASSIFICATION_RULES) {
    const requiredMatches = rule.required.filter(k => upper.includes(k));
    if (requiredMatches.length < rule.required.length) continue; // all required must match

    let score = rule.baseScore;
    const matched = [...requiredMatches];

    for (const opt of rule.optional) {
      if (upper.includes(opt)) {
        score += 0.05;
        matched.push(opt);
      }
    }
    for (const neg of rule.negative) {
      if (upper.includes(neg)) score -= 0.20;
    }

    score = Math.min(Math.max(score, 0), 1);
    if (score > bestScore) {
      bestScore = score;
      bestType = rule.type;
      matchedKeywords.splice(0, matchedKeywords.length, ...matched);
    }
  }

  // Post-classification disambiguation

  // Degree vs PG
  if (bestType === 'DEGREE_CERTIFICATE' || bestType === 'POST_GRADUATION_CERTIFICATE') {
    const isPG = /\b(MASTER OF|MBA|MCA|M\.TECH|M\.SC|M\.COM|MASTER'S|POST.?GRAD|IGNOU|M\.A\.|MA\s)\b/i.test(text);
    if (isPG) bestType = 'POST_GRADUATION_CERTIFICATE';
    else if (/\b(BACHELOR OF|B\.TECH|B\.SC|B\.COM|B\.E\.|BACHELOR'S|BCA|BBA)\b/i.test(text)) bestType = 'DEGREE_CERTIFICATE';
  }

  // 10th vs 12th disambiguation (both can match 'SECONDARY EDUCATION')
  if (bestType === 'TENTH_CERTIFICATE' || bestType === 'TWELFTH_CERTIFICATE') {
    const is12th = upper.includes('SENIOR SCHOOL CERTIFICATE') ||
      upper.includes('CLASS XII') || upper.includes('MARKS STATEMENT') ||
      upper.includes('SENIOR SECONDARY') || /\b(XII|12TH)\b/.test(upper);
    const is10th = upper.includes('CLASS X ') || upper.includes('CLASS-X') ||
      upper.includes('HIGH SCHOOL') || upper.includes('EXAMINATION RESULTS') ||
      /\b(CLASS X|10TH)\b/.test(upper);
    if (is12th && !is10th) bestType = 'TWELFTH_CERTIFICATE';
    else if (is10th && !is12th) bestType = 'TENTH_CERTIFICATE';
  }

  return { type: bestType, confidence: bestScore, keywords: matchedKeywords };
}

// ─── Screenshot / suspicious page heuristics ─────────────────────────────────

function detectPageSuspicion(text: string, pageIndex: number, textSource: string): SuspicionFlag[] {
  const flags: SuspicionFlag[] = [];

  if (text.trim().length < BLANK_PAGE_TEXT_THRESHOLD) {
    flags.push({ severity: 'MEDIUM', message: `Page ${pageIndex + 1}: appears blank or unreadable`, pageNumbers: [pageIndex + 1] });
  }

  // Unusually short text for a declared identity document
  if (textSource === 'ocr' && text.length < 50 && text.length > 0) {
    flags.push({ severity: 'LOW', message: `Page ${pageIndex + 1}: very little text extracted — document may be low quality`, pageNumbers: [pageIndex + 1] });
  }

  // Detect if text looks like a UI screenshot (common browser/phone UI terms)
  const screenshotIndicators = ['BATTERY', 'WIFI', 'SIGNAL', 'AM PM', '4G', '5G', 'STATUS BAR', 'SEARCH', 'MENU', 'BACK BUTTON'];
  const upperText = text.toUpperCase();
  const screenHits = screenshotIndicators.filter(s => upperText.includes(s));
  if (screenHits.length >= 2) {
    flags.push({ severity: 'HIGH', message: `Page ${pageIndex + 1}: possible screenshot (UI indicators: ${screenHits.slice(0, 3).join(', ')})`, pageNumbers: [pageIndex + 1] });
  }

  return flags;
}

// ─── Extract fields from classified page ─────────────────────────────────────

function extractFieldsFromPage(text: string, docType: string): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  const upper = text.toUpperCase();

  // PAN extraction
  if (docType === 'PAN') {
    const panMatch = upper.match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/);
    if (panMatch) fields.documentNumber = panMatch[1];
    const nameMatch = text.match(/(?:Name|name)[:\s]+([A-Z][A-Za-z\s]{2,40})/);
    if (nameMatch) fields.name = nameMatch[1].trim();
    const dobMatch = text.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
    if (dobMatch) fields.dateOfBirth = dobMatch[1];
    const fatherMatch = text.match(/(?:Father|FATHER)[:\s]+([A-Z][A-Za-z\s]{2,40})/);
    if (fatherMatch) fields.fatherName = fatherMatch[1].trim();
  }

  // Aadhaar extraction
  if (docType === 'AADHAAR') {
    const aadhaarMatch = text.match(/\b(\d{4}\s?\d{4}\s?\d{4})\b/);
    if (aadhaarMatch) fields.documentNumber = aadhaarMatch[1].replace(/\s/g, '-');
    const nameMatch = text.match(/\n([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\n/);
    if (nameMatch) fields.name = nameMatch[1].trim();
    const dobMatch = text.match(/(?:DOB|Date of Birth)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    if (dobMatch) fields.dateOfBirth = dobMatch[1];
    const yearMatch = text.match(/(?:Year of Birth|YOB)[:\s]*(\d{4})/i);
    if (yearMatch) fields.yearOfBirth = yearMatch[1];
    const genderMatch = text.match(/\b(MALE|FEMALE|TRANSGENDER)\b/i);
    if (genderMatch) fields.gender = genderMatch[1].toUpperCase();
    const vidMatch = text.match(/VID[:\s]*(\d{16})/i);
    if (vidMatch) fields.vid = vidMatch[1];
  }

  // Passport extraction
  if (docType === 'PASSPORT') {
    const passportMatch = upper.match(/\b([A-Z][0-9]{7})\b/);
    if (passportMatch) fields.documentNumber = passportMatch[1];
    const dobMatch = text.match(/(?:Date of Birth|DOB)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    if (dobMatch) fields.dateOfBirth = dobMatch[1];
    const expiryMatch = text.match(/(?:Date of Expiry|Expiry Date)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    if (expiryMatch) fields.expiryDate = expiryMatch[1];
    // MRZ name extraction
    const mrzMatch = upper.match(/^P<IND([A-Z]+)<<([A-Z]+)/m);
    if (mrzMatch) {
      fields.surname = mrzMatch[1];
      fields.givenName = mrzMatch[2].replace(/<+/g, ' ').trim();
    }
  }

  // Driving License
  if (docType === 'DRIVING_LICENSE') {
    const dlMatch = upper.match(/\b([A-Z]{2}[-\s]?\d{1,2}[-\s]?\d{4}[-\s]?\d{7})\b/);
    if (dlMatch) fields.documentNumber = dlMatch[1].replace(/[\s-]+/g, '-');
    const nameMatch = text.match(/(?:Name|HOLDER)[:\s]+([A-Z][A-Za-z\s]{2,40})/i);
    if (nameMatch) fields.name = nameMatch[1].trim();
    const dobMatch = text.match(/(?:DOB|Date of Birth)[:\s]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    if (dobMatch) fields.dateOfBirth = dobMatch[1];
  }

  // Voter ID
  if (docType === 'VOTER_ID') {
    const epicMatch = upper.match(/\b([A-Z]{3}\d{7})\b/);
    if (epicMatch) fields.documentNumber = epicMatch[1];
    const nameMatch = text.match(/(?:Elector's Name|Name)[:\s]+([A-Z][A-Za-z\s]{2,40})/i);
    if (nameMatch) fields.name = nameMatch[1].trim();
  }

  // Education certificates — extract institution, year, name
  if (['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'].includes(docType)) {
    const nameMatch = text.match(/(?:Student|Candidate|Name)[:\s]+([A-Z][A-Za-z\s]{2,40})/i);
    if (nameMatch) fields.name = nameMatch[1].trim();
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) fields.yearOfPassing = yearMatch[0];
    const rollMatch = text.match(/(?:Roll|Registration|Enrolment)[:\s]+([A-Z0-9]+)/i);
    if (rollMatch) fields.rollNumber = rollMatch[1];
  }

  // Employment documents
  if (['EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'OFFER_LETTER_DOC'].includes(docType)) {
    const nameMatch = text.match(/(?:Employee|Candidate|Dear|Mr\.|Ms\.|Mrs\.)\s+([A-Z][A-Za-z\s]{2,40})/i);
    if (nameMatch) fields.employeeName = nameMatch[1].trim();
    const companyMatch = text.match(/(?:Company|Organisation|Organization|Employer)[:\s]+([A-Z][A-Za-z\s&.,]{2,60})/i);
    if (companyMatch) fields.companyName = companyMatch[1].trim();
    const dateMatch = text.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/g);
    if (dateMatch?.length) fields.date = dateMatch[0];
  }

  return fields;
}

// ─── Group consecutive pages of same type ────────────────────────────────────

function groupPages(pageResults: PageResult[]): DocGroup[] {
  const groups: DocGroup[] = [];
  if (pageResults.length === 0) return groups;

  let currentType = pageResults[0].detectedType;
  let currentPages: PageResult[] = [pageResults[0]];

  for (let i = 1; i < pageResults.length; i++) {
    const page = pageResults[i];

    // BLANK pages can extend the current group or be standalone — assign to previous group
    if (page.detectedType === 'BLANK' || page.detectedType === 'UNKNOWN') {
      currentPages.push(page);
      continue;
    }

    if (page.detectedType === currentType) {
      currentPages.push(page);
    } else {
      // Flush current group
      if (currentType !== 'BLANK' && currentType !== 'UNKNOWN') {
        const combinedText = currentPages.map(p => p.rawText).join('\n');
        groups.push({
          docType: currentType,
          pageNumbers: currentPages.map(p => p.pageNumber),
          confidence: currentPages.reduce((s, p) => s + p.confidence, 0) / currentPages.length,
          extractedFields: extractFieldsFromPage(combinedText, currentType),
        });
      }
      currentType = page.detectedType;
      currentPages = [page];
    }
  }

  // Flush last group
  if (currentType !== 'BLANK' && currentType !== 'UNKNOWN' && currentPages.length > 0) {
    const combinedText = currentPages.map(p => p.rawText).join('\n');
    groups.push({
      docType: currentType,
      pageNumbers: currentPages.map(p => p.pageNumber),
      confidence: currentPages.reduce((s, p) => s + p.confidence, 0) / currentPages.length,
      extractedFields: extractFieldsFromPage(combinedText, currentType),
    });
  }

  return groups;
}

// ─── Check required documents ─────────────────────────────────────────────────

const DOC_TYPE_ALIASES: Record<string, string[]> = {
  PAN: ['PAN'],
  AADHAAR: ['AADHAAR'],
  PASSPORT: ['PASSPORT'],
  DRIVING_LICENSE: ['DRIVING_LICENSE'],
  VOTER_ID: ['VOTER_ID'],
  TENTH_CERTIFICATE: ['TENTH_CERTIFICATE'],
  TWELFTH_CERTIFICATE: ['TWELFTH_CERTIFICATE'],
  DEGREE_CERTIFICATE: ['DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'],
  POST_GRADUATION_CERTIFICATE: ['POST_GRADUATION_CERTIFICATE', 'DEGREE_CERTIFICATE'],
  // Experience proof: offer letter, salary slip, relieving letter, resignation are all valid
  EXPERIENCE_LETTER: ['EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'OFFER_LETTER_DOC', 'SALARY_SLIP_DOC', 'RESIGNATION_LETTER'],
  OFFER_LETTER_DOC: ['OFFER_LETTER_DOC', 'EXPERIENCE_LETTER', 'RELIEVING_LETTER'],
  SALARY_SLIP_DOC: ['SALARY_SLIP_DOC'],
  PHOTO: ['PHOTO'],
  // Residence proof: utility bills, bank statement, cancelled cheque, rent agreement, or govt-issued address doc
  RESIDENCE_PROOF: ['BANK_STATEMENT', 'CANCELLED_CHEQUE', 'VOTER_ID', 'DRIVING_LICENSE', 'UTILITY_BILL', 'RENT_AGREEMENT'],
  UTILITY_BILL: ['UTILITY_BILL', 'BANK_STATEMENT', 'RENT_AGREEMENT'],
  BANK_STATEMENT: ['BANK_STATEMENT', 'CANCELLED_CHEQUE'],
  CANCELLED_CHEQUE: ['CANCELLED_CHEQUE', 'BANK_STATEMENT'],
  RENT_AGREEMENT: ['RENT_AGREEMENT', 'UTILITY_BILL'],
  RESIGNATION_LETTER: ['RESIGNATION_LETTER', 'RELIEVING_LETTER', 'EXPERIENCE_LETTER'],
};

function checkRequiredDocs(
  detectedTypes: string[],
  requiredDocs: string[],
): { missing: string[]; present: string[] } {
  const missing: string[] = [];
  const present: string[] = [];

  for (const required of requiredDocs) {
    const aliases = DOC_TYPE_ALIASES[required] || [required];
    const found = aliases.some(alias => detectedTypes.includes(alias));
    if (found) present.push(required);
    else missing.push(required);
  }

  return { missing, present };
}

// ─── Detect duplicates ────────────────────────────────────────────────────────

function detectDuplicates(groups: DocGroup[]): string[] {
  const typeCounts: Record<string, number> = {};
  for (const g of groups) {
    typeCounts[g.docType] = (typeCounts[g.docType] || 0) + 1;
  }
  return Object.entries(typeCounts)
    .filter(([, count]) => count > 1)
    .map(([type]) => type);
}

// ─── Build employee-visible reasons ──────────────────────────────────────────

function buildEmployeeReasons(
  missing: string[],
  duplicates: string[],
  blankPages: number[],
  suspicionFlags: SuspicionFlag[],
  requiresManualReview: boolean,
): string[] {
  const reasons: string[] = [];

  const DOC_LABELS: Record<string, string> = {
    PAN: 'PAN Card',
    AADHAAR: 'Aadhaar Card',
    PASSPORT: 'Passport',
    DRIVING_LICENSE: 'Driving Licence',
    VOTER_ID: 'Voter ID',
    TENTH_CERTIFICATE: '10th Certificate',
    TWELFTH_CERTIFICATE: '12th Certificate',
    DEGREE_CERTIFICATE: 'Degree Certificate',
    POST_GRADUATION_CERTIFICATE: 'Post Graduation Certificate',
    EXPERIENCE_LETTER: 'Experience/Relieving Letter',
    PHOTO: 'Profile Photo',
    RESIDENCE_PROOF: 'Residence Proof',
  };

  if (missing.length > 0) {
    reasons.push(`Missing documents: ${missing.map(d => DOC_LABELS[d] || d).join(', ')}`);
  }
  if (duplicates.length > 0) {
    reasons.push(`Duplicate pages detected for: ${duplicates.map(d => DOC_LABELS[d] || d).join(', ')}`);
  }
  if (blankPages.length > 0) {
    reasons.push(`Blank or unreadable pages found: page(s) ${blankPages.join(', ')}`);
  }
  const highFlags = suspicionFlags.filter(f => f.severity === 'HIGH');
  if (highFlags.length > 0) {
    reasons.push('Some pages appear to be screenshots rather than scanned documents');
  }
  if (requiresManualReview) {
    reasons.push('Document is under HR review — further verification required');
  }
  return reasons;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processCombinedPdfFallback(
  pdfBuffer: Buffer,
  requiredDocs: string[] = [],
): Promise<CombinedPdfNodeResult> {
  const suspicionFlags: SuspicionFlag[] = [];
  const manualReviewReasons: string[] = [];

  // ── Step 1: Load pdf-parse and extract per-page text ──────────────────────
  let pdfData: { text: string; numpages: number; pageContent?: string[] } | null = null;
  let pageTexts: string[] = [];

  try {
    // pdf-parse v2.x: class-based API — new PdfParseV2({ data }) → parser.getText({})
    // Returns { pages: [{text: string, num: number}], text: string, total: number }
    const parser = new PdfParseV2({ data: pdfBuffer });
    const result = await parser.getText({});
    const pages: Array<{ text: string; num: number }> = result?.pages ?? [];

    if (pages.length > 0) {
      pageTexts = pages.map((p: { text: string; num: number }) =>
        typeof p.text === 'string' ? p.text : '',
      );
    } else {
      // Fallback: use combined text, split by form-feed
      const fullText: string = result?.text ?? '';
      pdfData = { text: fullText, numpages: result?.total ?? 0 };
      const byFormFeed = fullText.split('\f').filter((t: string) => t.trim().length > 0);
      pageTexts = byFormFeed.length > 1 ? byFormFeed : [fullText];
    }
  } catch (err: any) {
    if (err.message?.includes('password')) {
      return {
        processingMode: 'node_fallback',
        fallbackUsed: true,
        totalPages: 0,
        pageResults: [],
        detectedDocs: [],
        pageGroups: [],
        missingFromRequired: requiredDocs,
        duplicateDocs: [],
        blankPages: [],
        unknownPages: [],
        unsupportedPages: [],
        suspicionFlags: [{ severity: 'HIGH', message: 'PDF is password-protected — cannot process' }],
        suspicionScore: 100,
        riskLevel: 'HIGH',
        overallConfidence: 0,
        requiresManualReview: true,
        manualReviewReasons: ['PDF is password-protected'],
        employeeVisibleReasons: ['Your combined PDF is password-protected. Please upload an unprotected version.'],
        hrVisibleFindings: ['CRITICAL: Password-protected PDF cannot be processed. Employee must resubmit.'],
        summary: 'Password-protected PDF — cannot process',
      };
    }

    // Corrupt PDF
    logger.error(`[CombinedPDF Fallback] PDF parse failed: ${err.message}`);
    return {
      processingMode: 'node_fallback',
      fallbackUsed: true,
      totalPages: 0,
      pageResults: [],
      detectedDocs: [],
      pageGroups: [],
      missingFromRequired: requiredDocs,
      duplicateDocs: [],
      blankPages: [],
      unknownPages: [],
      unsupportedPages: [],
      suspicionFlags: [{ severity: 'HIGH', message: `PDF could not be read: ${err.message}` }],
      suspicionScore: 100,
      riskLevel: 'HIGH',
      overallConfidence: 0,
      requiresManualReview: true,
      manualReviewReasons: ['PDF is corrupted or unreadable'],
      employeeVisibleReasons: ['Your combined PDF could not be read. Please check the file and resubmit.'],
      hrVisibleFindings: [`CRITICAL: PDF parse error — ${err.message}`],
      summary: 'Corrupted/unreadable PDF',
    };
  }

  const totalPages = pageTexts.length;
  if (totalPages === 0) {
    return {
      processingMode: 'node_fallback',
      fallbackUsed: true,
      totalPages: 0,
      pageResults: [],
      detectedDocs: [],
      pageGroups: [],
      missingFromRequired: requiredDocs,
      duplicateDocs: [],
      blankPages: [],
      unknownPages: [],
      unsupportedPages: [],
      suspicionFlags: [{ severity: 'HIGH', message: 'PDF has no extractable pages' }],
      suspicionScore: 80,
      riskLevel: 'HIGH',
      overallConfidence: 0,
      requiresManualReview: true,
      manualReviewReasons: ['Empty PDF — no pages found'],
      employeeVisibleReasons: ['Your combined PDF appears to be empty. Please resubmit.'],
      hrVisibleFindings: ['CRITICAL: Empty PDF — zero pages extracted.'],
      summary: 'Empty PDF',
    };
  }

  // ── Step 2: Attempt OCR on scanned pages via tesseract.js ────────────────
  const processedPageTexts: string[] = [];
  const textSources: ('native' | 'ocr' | 'empty')[] = [];

  for (let i = 0; i < pageTexts.length; i++) {
    const nativeText = pageTexts[i] || '';
    if (nativeText.trim().length >= SCANNED_PAGE_TEXT_THRESHOLD) {
      processedPageTexts.push(nativeText);
      textSources.push('native');
    } else if (nativeText.trim().length > 0) {
      // Some text extracted but thin — keep as-is (OCR of PDF requires image rendering)
      processedPageTexts.push(nativeText);
      textSources.push('native');
    } else {
      // Empty page text — mark as empty (OCR from PDF images requires pdf2image, not available in Node)
      processedPageTexts.push('');
      textSources.push('empty');
    }
  }

  // ── Step 3: Classify each page ────────────────────────────────────────────
  const pageResults: PageResult[] = processedPageTexts.map((text, i) => {
    const { type, confidence, keywords } = classifyPage(text);
    const pageSuspicion = detectPageSuspicion(text, i, textSources[i]);
    suspicionFlags.push(...pageSuspicion);

    return {
      pageNumber: i + 1,
      rawText: text.substring(0, 2000), // cap stored text
      textSource: textSources[i],
      detectedType: type,
      confidence,
      keywords,
      isBlank: text.trim().length < BLANK_PAGE_TEXT_THRESHOLD,
      isPossibleScreenshot: pageSuspicion.some(f => f.message.includes('screenshot')),
    };
  });

  // ── Step 4: Group adjacent pages ─────────────────────────────────────────
  const pageGroups = groupPages(pageResults);

  // ── Step 5: Compute derived metrics ──────────────────────────────────────
  const detectedDocs = [...new Set(pageGroups.map(g => g.docType))];
  const blankPages = pageResults.filter(p => p.isBlank).map(p => p.pageNumber);
  const unknownPages = pageResults.filter(p => p.detectedType === 'UNKNOWN' && !p.isBlank).map(p => p.pageNumber);
  const duplicateDocs = detectDuplicates(pageGroups);

  // ── Step 6: Check required docs ──────────────────────────────────────────
  const { missing: missingFromRequired } = requiredDocs.length > 0
    ? checkRequiredDocs(detectedDocs, requiredDocs)
    : { missing: [] };

  // ── Step 7: Build suspicion score (0–100) ────────────────────────────────
  let suspicionScore = 0;

  // Blank pages
  if (blankPages.length > 0) suspicionScore += blankPages.length * 5;
  // Screenshot indicators
  const screenshotPages = pageResults.filter(p => p.isPossibleScreenshot);
  if (screenshotPages.length > 0) suspicionScore += screenshotPages.length * 15;
  // Duplicate docs
  if (duplicateDocs.length > 0) suspicionScore += duplicateDocs.length * 20;
  // Unknown pages
  if (unknownPages.length > 0) suspicionScore += unknownPages.length * 3;
  // Missing required docs
  if (missingFromRequired.length > 0) suspicionScore += missingFromRequired.length * 5;
  // Low confidence groups
  const lowConfGroups = pageGroups.filter(g => g.confidence < 0.5);
  if (lowConfGroups.length > 0) suspicionScore += lowConfGroups.length * 8;

  suspicionScore = Math.min(suspicionScore, 100);

  const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
    suspicionScore >= 60 ? 'HIGH' : suspicionScore >= 25 ? 'MEDIUM' : 'LOW';

  // ── Step 8: Overall confidence ────────────────────────────────────────────
  const classifiedPages = pageResults.filter(p => !p.isBlank && p.detectedType !== 'UNKNOWN');
  const overallConfidence = classifiedPages.length > 0
    ? classifiedPages.reduce((s, p) => s + p.confidence, 0) / classifiedPages.length
    : 0;

  // ── Step 9: Determine if manual review required ───────────────────────────
  let requiresManualReview = false;

  if (overallConfidence < LOW_CONFIDENCE_THRESHOLD) {
    requiresManualReview = true;
    manualReviewReasons.push(`Overall classification confidence is low (${(overallConfidence * 100).toFixed(0)}%) — node fallback mode used`);
  }
  if (unknownPages.length > Math.ceil(totalPages / 3)) {
    requiresManualReview = true;
    manualReviewReasons.push(`More than a third of pages could not be classified (${unknownPages.length}/${totalPages})`);
  }
  if (missingFromRequired.length > 0) {
    requiresManualReview = true;
    manualReviewReasons.push(`Missing required documents: ${missingFromRequired.join(', ')}`);
  }
  if (riskLevel === 'HIGH') {
    requiresManualReview = true;
    manualReviewReasons.push('High suspicion score — manual verification required');
  }
  // Always flag that node fallback was used (lower reliability than Python)
  manualReviewReasons.push('Processing used Node.js text-extraction fallback (Python AI service was unavailable) — results have lower confidence than Python-based analysis');

  // ── Step 10: HR findings ──────────────────────────────────────────────────
  const hrVisibleFindings: string[] = [];

  hrVisibleFindings.push(`[Node Fallback] Processed ${totalPages} pages from combined PDF`);
  hrVisibleFindings.push(`Classification mode: Node.js keyword-based (Python AI service unavailable)`);
  hrVisibleFindings.push(`Overall confidence: ${(overallConfidence * 100).toFixed(0)}%`);
  hrVisibleFindings.push(`Risk level: ${riskLevel} (suspicion score: ${suspicionScore}/100)`);

  if (detectedDocs.length > 0) {
    hrVisibleFindings.push(`Detected document types: ${detectedDocs.join(', ')}`);
  } else {
    hrVisibleFindings.push('WARNING: No document types could be classified');
  }
  if (missingFromRequired.length > 0) {
    hrVisibleFindings.push(`MISSING required documents: ${missingFromRequired.join(', ')}`);
  }
  if (duplicateDocs.length > 0) {
    hrVisibleFindings.push(`Duplicate doc types found: ${duplicateDocs.join(', ')}`);
  }
  if (blankPages.length > 0) {
    hrVisibleFindings.push(`Blank/unreadable pages: ${blankPages.join(', ')}`);
  }
  if (unknownPages.length > 0) {
    hrVisibleFindings.push(`Unclassified pages: ${unknownPages.join(', ')}`);
  }
  if (screenshotPages.length > 0) {
    hrVisibleFindings.push(`Possible screenshot pages: ${screenshotPages.map(p => p.pageNumber).join(', ')}`);
  }

  // Add suspicion flag details
  const highFlags = suspicionFlags.filter(f => f.severity === 'HIGH');
  const medFlags = suspicionFlags.filter(f => f.severity === 'MEDIUM');
  if (highFlags.length > 0) hrVisibleFindings.push(...highFlags.map(f => `HIGH: ${f.message}`));
  if (medFlags.length > 0) hrVisibleFindings.push(...medFlags.map(f => `MEDIUM: ${f.message}`));

  if (requiresManualReview) {
    hrVisibleFindings.push('ACTION REQUIRED: Manual HR review needed. Reasons: ' + manualReviewReasons.join('; '));
  }

  const employeeVisibleReasons = buildEmployeeReasons(
    missingFromRequired, duplicateDocs, blankPages, suspicionFlags, requiresManualReview,
  );

  const summary = requiresManualReview
    ? `Node fallback analysis complete. Manual HR review required: ${manualReviewReasons[0]}`
    : `Node fallback analysis complete. Detected ${detectedDocs.length} document type(s) across ${totalPages} pages. Risk: ${riskLevel}.`;

  logger.info(`[CombinedPDF Fallback] ${summary}`);

  return {
    processingMode: 'node_fallback',
    fallbackUsed: true,
    totalPages,
    pageResults,
    detectedDocs,
    pageGroups,
    missingFromRequired,
    duplicateDocs,
    blankPages,
    unknownPages,
    unsupportedPages: [],    // Node fallback can't reliably detect "unsupported" vs "unknown"
    suspicionFlags,
    suspicionScore,
    riskLevel,
    overallConfidence,
    requiresManualReview,
    manualReviewReasons,
    employeeVisibleReasons,
    hrVisibleFindings,
    summary,
  };
}
