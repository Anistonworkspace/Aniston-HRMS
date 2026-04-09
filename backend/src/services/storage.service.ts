/**
 * StorageService — provider-agnostic file storage abstraction.
 *
 * Design goals:
 *  - Single source of truth for uploads root path
 *  - Typed folder constants for organised, deterministic directory layout
 *  - Safe file deletion (path-traversal protection)
 *  - Drop-in S3/cloud swap: set STORAGE_PROVIDER=S3 and implement S3StorageService
 *
 * Folder layout on disk:
 *  uploads/
 *    policies/               ← company policy PDFs
 *    branding/               ← logo, signature, stamp images
 *    resumes/
 *      bulk/                 ← bulk-uploaded candidate resumes
 *    employee-documents/     ← generic employee doc fallback
 *    employees/
 *      {employeeId}/
 *        kyc/                ← KYC docs & passport photo per employee
 *    walkin/
 *      {sessionFolder}/      ← public kiosk uploads (UUID per session)
 *    agent/                  ← desktop agent installers (publicly served)
 */

import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Folder constants
// ---------------------------------------------------------------------------

export const StorageFolder = {
  POLICIES: 'policies',
  BRANDING: 'branding',
  RESUMES_BULK: 'resumes/bulk',
  EMPLOYEE_DOCUMENTS: 'employee-documents',
  WALKIN: 'walkin',
  /** Desktop installer binaries — served publicly (no auth) */
  AGENT: 'agent',
  /** Employee desktop screenshots — served with JWT auth */
  AGENT_SCREENSHOTS: 'agent-screenshots',
  /** Database backup dumps — never served statically, streamed with auth only */
  BACKUPS: 'backups',
} as const;

export type StorageFolder = typeof StorageFolder[keyof typeof StorageFolder];

// Dynamic folder builders (entity-scoped paths)
export const StoragePath = {
  employeeKyc: (employeeId: string) => `employees/${employeeId}/kyc`,
  walkinSession: (sessionId: string) => `walkin/${sessionId}`,
};

// ---------------------------------------------------------------------------
// Local storage provider (default)
// ---------------------------------------------------------------------------

class LocalStorageService {
  private readonly uploadsRoot: string;

  constructor() {
    // Always resolve relative to project root, regardless of whether the
    // process is started from the project root or the backend/ directory.
    let base = process.cwd();
    if (
      base.endsWith('backend') ||
      base.endsWith('backend\\') ||
      base.endsWith('backend/')
    ) {
      base = path.resolve(base, '..');
    }
    this.uploadsRoot = path.join(base, 'uploads');
  }

  /** Absolute path to the uploads root directory. */
  getUploadsRoot(): string {
    return this.uploadsRoot;
  }

  /**
   * Resolve an absolute directory path for the given sub-path segments.
   * Creates the directory (and all parents) if it does not exist.
   */
  getAbsoluteDir(...subPaths: string[]): string {
    const dir = path.join(this.uploadsRoot, ...subPaths);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Build the relative URL that is stored in the database.
   * e.g. buildUrl('policies', 'file-123.pdf') → '/uploads/policies/file-123.pdf'
   */
  buildUrl(folderOrRelative: string, filename?: string): string {
    if (filename !== undefined) {
      return `/uploads/${folderOrRelative}/${filename}`;
    }
    // folderOrRelative is already a full relative path like 'employees/id/kyc/file.pdf'
    return `/uploads/${folderOrRelative}`;
  }

  /**
   * Resolve a stored relative URL back to an absolute disk path.
   * e.g. '/uploads/policies/file.pdf' → '/home/.../uploads/policies/file.pdf'
   */
  resolvePath(relativeUrl: string): string {
    // Strip the leading '/uploads/' prefix to get the path within uploads root
    const relative = relativeUrl.replace(/^\/uploads\//, '');
    return path.join(this.uploadsRoot, relative);
  }

  /**
   * Delete a file identified by its stored relative URL.
   * No-ops silently when the file does not exist.
   * Throws on path traversal attempts.
   */
  async deleteFile(relativeUrl: string | null | undefined): Promise<void> {
    if (!relativeUrl) return;

    const fullPath = this.resolvePath(relativeUrl);

    // Security: ensure the resolved path stays inside the uploads root
    const normalised = path.normalize(fullPath);
    if (!normalised.startsWith(this.uploadsRoot)) {
      throw new Error(
        `StorageService: path traversal detected — refusing to delete "${relativeUrl}"`,
      );
    }

    try {
      if (fs.existsSync(normalised)) {
        await fs.promises.unlink(normalised);
      }
    } catch (err: any) {
      // Log but do not throw — a missing file must never block a DB update
      console.error(`[StorageService] Failed to delete "${normalised}":`, err.message);
    }
  }

  /** Returns true (used by callers that need to know the active provider). */
  isLocal(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// S3 storage provider stub — fill in when migrating to cloud storage
// ---------------------------------------------------------------------------

class S3StorageService {
  getUploadsRoot(): string {
    throw new Error('S3StorageService: getUploadsRoot() is not applicable for cloud storage.');
  }

  getAbsoluteDir(..._subPaths: string[]): string {
    throw new Error('S3StorageService: getAbsoluteDir() is not applicable for cloud storage.');
  }

  buildUrl(bucket: string, key: string): string {
    // TODO: return signed URL or CDN URL
    throw new Error(`S3StorageService: buildUrl() not yet implemented. bucket=${bucket} key=${key}`);
  }

  resolvePath(_relativeUrl: string): string {
    throw new Error('S3StorageService: resolvePath() is not applicable for cloud storage.');
  }

  async deleteFile(_relativeUrl: string | null | undefined): Promise<void> {
    throw new Error('S3StorageService: deleteFile() not yet implemented.');
  }

  isLocal(): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Factory — select provider from environment
// ---------------------------------------------------------------------------

function createStorageService(): LocalStorageService {
  const provider = (process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();

  if (provider === 'S3') {
    // Cast because the public interface is the same; swap the implementation
    // when S3StorageService is fully implemented.
    return new S3StorageService() as unknown as LocalStorageService;
  }

  return new LocalStorageService();
}

export const storageService = createStorageService();
