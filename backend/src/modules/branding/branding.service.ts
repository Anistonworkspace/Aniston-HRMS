import path from 'path';
import fs from 'fs';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

function resolveUploadPath(fileUrl: string): string | null {
  if (!fileUrl) return null;
  let base = process.cwd();
  if (base.endsWith('backend') || base.endsWith('backend\\') || base.endsWith('backend/')) {
    base = path.resolve(base, '..');
  }
  const full = path.join(base, fileUrl);
  return fs.existsSync(full) ? full : null;
}

function deleteFile(fileUrl: string | null | undefined) {
  if (!fileUrl) return;
  const fullPath = resolveUploadPath(fileUrl);
  if (fullPath) {
    try {
      fs.unlinkSync(fullPath);
    } catch (err) {
      logger.error(`[Branding] Failed to delete old file: ${fullPath}`, { error: err });
    }
  }
}

export class BrandingService {
  async get(organizationId: string) {
    const branding = await prisma.companyBranding.findUnique({
      where: { organizationId },
    });
    return branding;
  }

  async upsert(
    organizationId: string,
    data: {
      companyName?: string;
      companyAddress?: string;
    },
  ) {
    const branding = await prisma.companyBranding.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    return branding;
  }

  async uploadAsset(
    organizationId: string,
    field: 'logoUrl' | 'signatureUrl' | 'stampUrl',
    filePath: string,
  ) {
    // Find existing branding to delete old file
    const existing = await prisma.companyBranding.findUnique({
      where: { organizationId },
    });

    // Delete the old file if it exists and is different
    if (existing && existing[field] && existing[field] !== filePath) {
      deleteFile(existing[field]);
    }

    const branding = await prisma.companyBranding.upsert({
      where: { organizationId },
      create: { organizationId, [field]: filePath },
      update: { [field]: filePath },
    });
    return branding;
  }
}

export const brandingService = new BrandingService();
