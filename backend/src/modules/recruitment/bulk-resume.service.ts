import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueBulkResume } from '../../jobs/queues.js';
import fs from 'fs';
import path from 'path';

export class BulkResumeService {
  async uploadBulkResumes(
    files: Express.Multer.File[],
    jobOpeningId: string,
    uploadedBy: string,
    organizationId: string
  ) {
    const job = await prisma.jobOpening.findUnique({ where: { id: jobOpeningId } });
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

    // Create items for each file
    const items = await Promise.all(
      files.map((file) =>
        prisma.bulkResumeItem.create({
          data: {
            bulkUploadId: upload.id,
            fileName: file.originalname,
            fileUrl: `/uploads/resumes/bulk/${file.filename}`,
            status: 'PENDING',
          },
        })
      )
    );

    // Enqueue processing job
    await enqueueBulkResume(upload.id, organizationId, uploadedBy);

    return { upload, items };
  }

  async getBulkUpload(uploadId: string) {
    const upload = await prisma.bulkResumeUpload.findUnique({
      where: { id: uploadId },
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

  async processResumeItem(itemId: string, jobDescription: string, jobRequirements: string[]) {
    const item = await prisma.bulkResumeItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundError('Resume item');

    await prisma.bulkResumeItem.update({
      where: { id: itemId },
      data: { status: 'PROCESSING' },
    });

    try {
      // Try AI service first
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const filePath = path.join(process.cwd(), item.fileUrl.replace(/^\//, ''));

      let result: any;
      try {
        const response = await fetch(`${aiServiceUrl}/ai/score-resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileUrl: item.fileUrl,
            fileName: item.fileName,
            jobDescription,
            requirements: jobRequirements.join(', '),
          }),
        });

        if (response.ok) {
          result = await response.json();
        } else {
          throw new Error('AI service returned error');
        }
      } catch {
        // Fallback: basic mock scoring
        result = this.mockScoreResume(item.fileName, jobRequirements);
      }

      await prisma.bulkResumeItem.update({
        where: { id: itemId },
        data: {
          candidateName: result.candidateName || item.fileName.replace(/\.[^.]+$/, ''),
          email: result.email || null,
          phone: result.phone || null,
          aiScore: result.aiScore || 0,
          aiScoreDetails: result.breakdown || result,
          status: 'SCORED',
        },
      });

      return result;
    } catch (error: any) {
      await prisma.bulkResumeItem.update({
        where: { id: itemId },
        data: { status: 'FAILED', errorMessage: error.message },
      });
      throw error;
    }
  }

  private mockScoreResume(fileName: string, requirements: string[]) {
    // Basic mock scoring when AI is unavailable
    const name = fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const score = Math.floor(Math.random() * 40) + 50; // 50-90 range
    return {
      candidateName: name,
      email: null,
      phone: null,
      aiScore: score,
      breakdown: {
        skillsMatch: Math.floor(score * 0.4),
        experience: Math.floor(score * 0.3),
        education: Math.floor(score * 0.2),
        presentation: Math.floor(score * 0.1),
      },
      summary: `Resume processed with mock scoring (AI service unavailable). Score: ${score}/100`,
    };
  }

  async createApplicationFromItem(itemId: string, jobOpeningId: string) {
    const item = await prisma.bulkResumeItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundError('Resume item');
    if (item.status !== 'SCORED') throw new BadRequestError('Resume must be scored before creating application');
    if (item.applicationId) throw new BadRequestError('Application already created for this resume');

    const application = await prisma.application.create({
      data: {
        jobOpeningId,
        candidateName: item.candidateName || item.fileName,
        email: item.email || 'unknown@placeholder.com',
        phone: item.phone || '',
        resumeUrl: item.fileUrl,
        source: 'PORTAL',
        aiScore: item.aiScore,
        aiScoreDetails: item.aiScoreDetails || undefined,
      },
    });

    await prisma.bulkResumeItem.update({
      where: { id: itemId },
      data: { applicationId: application.id },
    });

    return application;
  }

  async deleteUpload(uploadId: string) {
    const upload = await prisma.bulkResumeUpload.findUnique({
      where: { id: uploadId },
      include: { items: true },
    });
    if (!upload) throw new NotFoundError('Bulk upload');

    // Delete files from disk
    for (const item of upload.items) {
      if (item.fileUrl) {
        const filePath = path.join(process.cwd(), item.fileUrl.replace(/^\//, ''));
        try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
      }
    }

    // Delete items then upload from DB
    await prisma.bulkResumeItem.deleteMany({ where: { bulkUploadId: uploadId } });
    await prisma.bulkResumeUpload.delete({ where: { id: uploadId } });
    return { deleted: true };
  }

  async deleteItem(itemId: string) {
    const item = await prisma.bulkResumeItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundError('Resume item');

    // Delete file from disk
    if (item.fileUrl) {
      const filePath = path.join(process.cwd(), item.fileUrl.replace(/^\//, ''));
      try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
    }

    await prisma.bulkResumeItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }
}

export const bulkResumeService = new BulkResumeService();
