import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueBulkResume } from '../../jobs/queues.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';
import { logger } from '../../lib/logger.js';
import { sanitizeErrorMessage } from '../../utils/sanitizeError.js';

export class BulkResumeService {
  async uploadBulkResumes(
    files: Express.Multer.File[],
    jobOpeningId: string,
    uploadedBy: string,
    organizationId: string
  ) {
    const job = await prisma.jobOpening.findFirst({ where: { id: jobOpeningId, organizationId } });
    if (!job) throw new NotFoundError('Job opening');

    // Create upload record
    const upload = await prisma.bulkResumeUpload.create({
      data: {
        jobOpeningId,
        uploadedBy,
        totalFiles: files.length,
        status: 'PENDING',
        organizationId,
      },
    });

    // Create items for each file (in transaction for atomicity)
    const items = await prisma.$transaction(
      files.map((file) =>
        prisma.bulkResumeItem.create({
          data: {
            bulkUploadId: upload.id,
            organizationId,
            fileName: file.originalname,
            fileUrl: storageService.buildUrl(StorageFolder.RESUMES_BULK, file.filename),
            status: 'PENDING',
            matchedKeywords: [],
            missingKeywords: [],
          },
        })
      )
    );

    // Enqueue processing job (BullMQ picks this up in resume.worker.ts)
    await enqueueBulkResume(upload.id, organizationId, uploadedBy);

    return { upload, items };
  }

  async getBulkUpload(uploadId: string, organizationId: string) {
    const upload = await prisma.bulkResumeUpload.findFirst({
      where: { id: uploadId, organizationId },
      include: {
        jobOpening: { select: { id: true, title: true, department: true } },
        items: { orderBy: { aiScore: 'desc' } },
      },
    });
    if (!upload) throw new NotFoundError('Bulk upload');
    return upload;
  }

  async listBulkUploads(organizationId: string) {
    return prisma.bulkResumeUpload.findMany({
      where: { organizationId },
      include: {
        jobOpening: { select: { title: true, department: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Process a single resume item using the real public-apply scoring pipeline.
   * Uses pdf-parse → AI OCR fallback → AI service scoring → keyword-match fallback.
   * No random/mock data is ever produced.
   */
  async processResumeItem(
    itemId: string,
    jobDescription: string,
    jobTitle: string,
    jobRequirements: string[],
    organizationId: string
  ) {
    const item = await prisma.bulkResumeItem.findFirst({ where: { id: itemId, organizationId } });
    if (!item) throw new NotFoundError('Resume item');

    await prisma.bulkResumeItem.update({
      where: { id: itemId },
      data: { status: 'PROCESSING' },
    });

    try {
      // ── Resolve file buffer from disk or URL ─────────────────────────────
      let buffer: Buffer;

      if (item.fileUrl.startsWith('http://') || item.fileUrl.startsWith('https://')) {
        const res = await fetch(item.fileUrl, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`Failed to fetch resume from URL: ${item.fileUrl}`);
        buffer = Buffer.from(await res.arrayBuffer());
      } else {
        // Local file — always resolve via basename to prevent path traversal
        const basename = path.basename(item.fileUrl);
        const uploadsRoot = path.resolve(process.cwd(), 'uploads');
        const candidates = [
          path.join(uploadsRoot, 'resumes', 'bulk', basename),
          path.join(uploadsRoot, 'resumes', basename),
          path.join(uploadsRoot, basename),
        ];

        let resolvedPath: string | undefined;
        for (const candidate of candidates) {
          // Verify resolved path stays within uploads directory
          if (candidate.startsWith(uploadsRoot) && fs.existsSync(candidate)) {
            resolvedPath = candidate;
            break;
          }
        }
        if (!resolvedPath) {
          logger.warn(`[BulkResume] Resume file not found for item ${itemId}. Tried: ${candidates.join(', ')}`);
          throw new Error(`Resume file not found on disk: ${basename}`);
        }
        buffer = fs.readFileSync(resolvedPath);
      }

      // ── Score via full pipeline (same as public apply candidate submission) ──
      const { publicApplyService } = await import('../public-apply/public-apply.service.js');
      const result = await publicApplyService.scoreResumeBuffer(
        buffer,
        item.fileName,
        jobDescription,
        jobTitle,
        jobRequirements,
        organizationId
      );

      await prisma.bulkResumeItem.update({
        where: { id: itemId },
        data: {
          candidateName: result.candidateName || item.fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          email: result.email || null,
          phone: result.phone || null,
          aiScore: result.matchScore != null ? result.matchScore : null,
          atsScore: result.atsScore != null ? result.atsScore : null,
          aiScoreDetails: {
            strengths: result.strengths,
            gaps: result.gaps,
            summary: result.summary,
            atsScoreData: result.atsScoreData ?? null,
            parseMethod: result.parseMethod,
          },
          resumeText: result.resumeText ? result.resumeText.slice(0, 5000) : null,
          matchedKeywords: result.matchedKeywords ?? [],
          missingKeywords: result.missingKeywords ?? [],
          status: 'SCORED',
        },
      });

      return {
        candidateName: result.candidateName || item.fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        email: result.email || null,
        phone: result.phone || null,
        aiScore: result.matchScore != null ? result.matchScore : null,
        atsScore: result.atsScore ?? null,
        strengths: result.strengths,
        gaps: result.gaps,
        summary: result.summary,
        matchedKeywords: result.matchedKeywords ?? [],
        missingKeywords: result.missingKeywords ?? [],
        parseMethod: result.parseMethod,
      };
    } catch (error: any) {
      logger.error(`[BulkResume] Failed to score item ${itemId} (${item.fileName}): ${error.message}`);
      await prisma.bulkResumeItem.update({
        where: { id: itemId },
        data: { status: 'FAILED', errorMessage: sanitizeErrorMessage(error.message || 'Processing failed') },
      });
      throw error;
    }
  }

  async deleteUpload(uploadId: string, organizationId: string) {
    const upload = await prisma.bulkResumeUpload.findFirst({
      where: { id: uploadId, organizationId },
      include: { items: true },
    });
    if (!upload) throw new NotFoundError('Bulk upload');

    for (const item of upload.items) {
      try { await storageService.deleteFile(item.fileUrl); } catch { /* best-effort */ }
    }

    await prisma.bulkResumeItem.deleteMany({ where: { bulkUploadId: uploadId } });
    await prisma.bulkResumeUpload.delete({ where: { id: uploadId } });
    return { deleted: true };
  }

  async deleteItem(itemId: string, organizationId: string) {
    const item = await prisma.bulkResumeItem.findFirst({ where: { id: itemId, organizationId } });
    if (!item) throw new NotFoundError('Resume item');

    try { await storageService.deleteFile(item.fileUrl); } catch { /* best-effort */ }
    await prisma.bulkResumeItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }
}

export const bulkResumeService = new BulkResumeService();
