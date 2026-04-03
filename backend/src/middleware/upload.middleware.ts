import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { BadRequestError } from './errorHandler.js';

// Resolve uploads dir relative to project root (handles both root and backend/ cwd)
function getUploadsDir(...subPaths: string[]): string {
  let base = process.cwd();
  // If cwd is the backend dir, go up one level to project root
  if (base.endsWith('backend') || base.endsWith('backend\\') || base.endsWith('backend/')) {
    base = path.resolve(base, '..');
  }
  const dir = path.join(base, 'uploads', ...subPaths);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Storage configuration: uploads/filename
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadsDir());
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

// File type filters
const imageFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError('Only JPEG, PNG, WebP, and GIF images are allowed'));
  }
};

const documentFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError('Only PDF, DOC, DOCX, and image files are allowed'));
  }
};

const resumeFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError('Only PDF, DOC, and DOCX files are allowed'));
  }
};

// Multer instances
export const uploadImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

export const uploadDocument = multer({
  storage,
  fileFilter: documentFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

export const uploadResume = multer({
  storage,
  fileFilter: resumeFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Generic upload (any file type, 50MB limit)
export const uploadAny = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Dynamic storage for walk-in uploads — creates uploads/walkin/{folder}/
export function createWalkInUpload(folderName: string) {
  const dir = path.join(process.cwd(), 'uploads', 'walkin', folderName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}${ext}`);
      },
    }),
    fileFilter: documentFilter,
    limits: { fileSize: 50 * 1024 * 1024 },
  });
}

// Dynamic storage for employee documents
export function createEmployeeUpload(empCode: string) {
  const dir = path.join(process.cwd(), 'uploads', 'employees', empCode);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueSuffix = `${Date.now()}`;
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
      },
    }),
    fileFilter: documentFilter,
    limits: { fileSize: 50 * 1024 * 1024 },
  });
}

/**
 * Create employee KYC upload — saves to uploads/employees/{employeeId}/kyc/
 * Structured folder: each employee gets their own folder with sub-categories
 */
export function createEmployeeKycUpload(employeeId: string) {
  const dir = getUploadsDir('employees', employeeId, 'kyc');

  return {
    document: multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, dir),
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname);
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: documentFilter,
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
    photo: multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, dir),
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname);
          cb(null, `photo-${Date.now()}${ext}`);
        },
      }),
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  };
}

/**
 * Get the relative URL path for an employee's KYC file
 */
export function getEmployeeKycPath(employeeId: string, filename: string): string {
  return `/uploads/employees/${employeeId}/kyc/${filename}`;
}
