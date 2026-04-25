/**
 * upload.middleware.ts
 *
 * Centralised multer configuration for all file uploads in Aniston HRMS.
 *
 * All disk paths are resolved through StorageService so that:
 *  - The project root is correctly derived regardless of cwd (root vs backend/)
 *  - Swapping to S3 only requires changing the StorageService provider
 *  - All upload types land in their own deterministic subdirectory
 *
 * Exported multer instances:
 *  uploadImage        → branding/ (images only, 5 MB)
 *  uploadDocument     → employee-documents/ (pdf + images + office, 10 MB)
 *  uploadResume       → resumes/ (pdf + office, 5 MB)
 *  uploadPolicy       → policies/ (pdf + images + office, 10 MB)
 *  uploadBranding     → branding/ (images only, 5 MB) — alias of uploadImage
 *  uploadBulkResumes  → resumes/bulk/ (pdf + office, 10 MB, up to 50 files)
 *  uploadAny          → employee-documents/ (any type, 50 MB)
 *
 * Dynamic factory functions:
 *  createEmployeeKycUpload(employeeId)  → employees/{id}/kyc/
 *  createEmployeeUpload(empCode)        → employees/{empCode}/
 *  createWalkInUpload(sessionId)        → walkin/{sessionId}/
 */

import multer from 'multer';
import path from 'path';
import { BadRequestError } from './errorHandler.js';
import { storageService, StorageFolder, StoragePath } from '../services/storage.service.js';

// ---------------------------------------------------------------------------
// File-type filters
// ---------------------------------------------------------------------------

/** Validate both MIME type and extension to prevent polyglot attacks. */
function validateFileType(
  file: Express.Multer.File,
  allowedMimes: string[],
  allowedExts: string[],
  errorMsg: string,
  cb: multer.FileFilterCallback,
) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new BadRequestError(errorMsg));
  }
}

const imageFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) =>
  validateFileType(
    file,
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    'Only JPEG, PNG, WebP, and GIF images are allowed',
    cb,
  );

const documentFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) =>
  validateFileType(
    file,
    [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'],
    'Only PDF, DOC, DOCX, and image files are allowed',
    cb,
  );

const resumeFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) =>
  validateFileType(
    file,
    [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['.pdf', '.doc', '.docx'],
    'Only PDF, DOC, and DOCX files are allowed',
    cb,
  );

// ---------------------------------------------------------------------------
// Internal storage factory
// ---------------------------------------------------------------------------

/** Unique filename: {fieldname}-{timestamp}-{random}.{ext} */
function uniqueFilename(_req: any, file: Express.Multer.File, cb: (err: any, name: string) => void) {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
}

/** Build a multer.diskStorage pointing at the given sub-path inside uploads/. */
function diskStorageFor(...subPaths: string[]): multer.StorageEngine {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, storageService.getAbsoluteDir(...subPaths));
    },
    filename: uniqueFilename,
  });
}

// ---------------------------------------------------------------------------
// Exported multer instances — one per upload category
// ---------------------------------------------------------------------------

/** Image uploads (branding, profile photos).  5 MB. JPEG/PNG/WebP/GIF only. */
export const uploadImage = multer({
  storage: diskStorageFor(StorageFolder.BRANDING),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/** Generic document uploads (employee docs, KYC fallback). 10 MB. */
export const uploadDocument = multer({
  storage: diskStorageFor(StorageFolder.EMPLOYEE_DOCUMENTS),
  fileFilter: documentFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** Policy document uploads. 10 MB. Lands in policies/ subfolder. */
export const uploadPolicy = multer({
  storage: diskStorageFor(StorageFolder.POLICIES),
  fileFilter: documentFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** Letter PDF uploads — memory storage so service can write to org-scoped path. PDF only, 10 MB. */
export const uploadLetterPdf = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype === 'application/pdf' && ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new BadRequestError('Only PDF files are allowed for letter uploads'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

/**
 * Branding image uploads (logo / signature / stamp).
 * Alias of uploadImage — both land in branding/ subfolder.
 */
export const uploadBranding = multer({
  storage: diskStorageFor(StorageFolder.BRANDING),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/** Resume uploads (single). 5 MB. Lands in resumes/individual/ subfolder. */
export const uploadResume = multer({
  storage: diskStorageFor(StorageFolder.RESUMES_INDIVIDUAL),
  fileFilter: resumeFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * Bulk resume uploads (up to 50 files).
 * Lands in resumes/bulk/ subfolder. 100 MB per file.
 * Use: uploadBulkResumes(req, res, cb) — already bound to .array('resumes', 50).
 */
const _bulkResumeMulter = multer({
  storage: diskStorageFor(StorageFolder.RESUMES_BULK),
  fileFilter: resumeFilter,
  limits: { fileSize: 100 * 1024 * 1024 },
});
export const uploadBulkResumes = _bulkResumeMulter.array('resumes', 50);

/**
 * Agent screenshot uploads (desktop monitoring agent).
 * Lands in agent-screenshots/ — requires JWT auth to serve (private).
 * NOT the same as agent/ which holds public installer binaries.
 */
export const uploadAgent = multer({
  storage: diskStorageFor(StorageFolder.AGENT_SCREENSHOTS),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/** Generic uploads for bulk data (Excel, CSV, PDF only). 50 MB. No executables. */
const bulkDataFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) =>
  validateFileType(
    file,
    [
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['.pdf', '.xls', '.xlsx', '.csv', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'],
    'Only PDF, Excel, CSV, images, and Word documents are allowed',
    cb,
  );

export const uploadAny = multer({
  storage: diskStorageFor(StorageFolder.EMPLOYEE_DOCUMENTS),
  fileFilter: bulkDataFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Dynamic factory functions — entity-scoped storage
// ---------------------------------------------------------------------------

/**
 * Create a multer pair for employee KYC uploads.
 * Both document and photo land in uploads/employees/{employeeId}/kyc/
 *
 * Usage:
 *   const { document, photo } = createEmployeeKycUpload(employeeId);
 *   document.single('file')(req, res, next);
 */
export function createEmployeeKycUpload(employeeId: string) {
  const kycPath = StoragePath.employeeKyc(employeeId);
  const dir = storageService.getAbsoluteDir(kycPath);

  const kycFilename = (_req: any, file: Express.Multer.File, cb: (err: any, name: string) => void) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  };

  const photoFilename = (_req: any, file: Express.Multer.File, cb: (err: any, name: string) => void) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `photo-${Date.now()}${ext}`);
  };

  const destination = (_req: any, _file: Express.Multer.File, cb: (err: any, dest: string) => void) =>
    cb(null, dir);

  return {
    document: multer({
      storage: multer.diskStorage({ destination, filename: kycFilename }),
      fileFilter: documentFilter,
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB — combined PDFs can be large
    }),
    photo: multer({
      storage: multer.diskStorage({ destination, filename: photoFilename }),
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  };
}

/**
 * Create a multer instance scoped to a specific employee folder.
 * Lands in uploads/employees/{empCode}/
 */
export function createEmployeeUpload(empCode: string) {
  const dir = storageService.getAbsoluteDir('employees', empCode);

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${file.fieldname}-${Date.now()}${ext}`);
      },
    }),
    fileFilter: documentFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
  });
}

/**
 * Create a multer instance for a walk-in kiosk upload session.
 * Lands in uploads/walkin/{sessionId}/
 *
 * IMPORTANT: sessionId must be a UUID or similarly opaque value — never
 * derive it directly from user input to prevent path traversal.
 */
export function createWalkInUpload(sessionId: string) {
  const dir = storageService.getAbsoluteDir(StoragePath.walkinSession(sessionId));

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        cb(null, `${file.fieldname}-${unique}${ext}`);
      },
    }),
    fileFilter: documentFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
  });
}

/**
 * Email attachment uploads for bulk email sends.
 * Any file type accepted (HR controls content). 10 MB per file, up to 5 files.
 * Lands in email-attachments/
 */
const anyFileFilter = (_req: any, _file: Express.Multer.File, cb: multer.FileFilterCallback) => cb(null, true);

export const uploadEmailAttachment = multer({
  storage: diskStorageFor(StorageFolder.EMAIL_ATTACHMENTS),
  fileFilter: anyFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** Employee profile photo uploads. 5 MB. JPEG/PNG/WebP only. Lands in profiles/. */
export const uploadProfilePhoto = multer({
  storage: diskStorageFor(StorageFolder.PROFILES),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/** Project site check-in photo uploads. 10 MB. JPEG/PNG/WebP only. Lands in attendance/photos/. */
export const uploadAttendancePhoto = multer({
  storage: diskStorageFor(StorageFolder.ATTENDANCE_PHOTOS),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Build the relative URL for a KYC file stored in DB. */
export function getEmployeeKycUrl(employeeId: string, filename: string): string {
  return storageService.buildUrl(StoragePath.employeeKyc(employeeId), filename);
}
