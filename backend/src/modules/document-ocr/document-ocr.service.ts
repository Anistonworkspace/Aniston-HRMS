import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { UpdateOcrInput } from './document-ocr.validation.js';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export class DocumentOcrService {
  /**
   * Trigger OCR processing for a document by calling the AI service.
   */
  async triggerOcr(documentId: string, organizationId: string) {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError('Document');

    // Read the file from disk
    const filePath = join(process.cwd(), doc.fileUrl);
    let fileBuffer: Buffer;
    try {
      fileBuffer = readFileSync(filePath);
    } catch {
      logger.warn(`OCR: File not found on disk for document ${documentId}: ${filePath}`);
      return this.createFallbackOcr(documentId, organizationId, 'File not found on disk');
    }

    // Check if it's an image (OCR only works on images)
    const ext = doc.fileUrl.split('.').pop()?.toLowerCase() || '';
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'].includes(ext);
    if (!isImage) {
      return this.createFallbackOcr(documentId, organizationId, 'Non-image file (PDF) — OCR requires image');
    }

    // Call AI service
    try {
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      formData.append('file', fileBuffer, { filename: `document.${ext}`, contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` });

      const axios = (await import('axios')).default;
      const response = await axios.post(`${AI_SERVICE_URL}/ai/ocr/extract`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000,
      });

      const ocrResult = response.data?.data;
      if (!ocrResult) {
        return this.createFallbackOcr(documentId, organizationId, 'AI service returned empty result');
      }

      // Analyze image quality
      const qualityReport = this.analyzeImageQuality(fileBuffer, ocrResult);

      // Extract fields based on document type
      const fields = ocrResult.extracted_fields || {};

      // Upsert the OCR verification record
      const ocrVerification = await prisma.documentOcrVerification.upsert({
        where: { documentId },
        create: {
          documentId,
          organizationId,
          rawText: ocrResult.raw_text || '',
          detectedType: ocrResult.document_type || doc.type,
          confidence: ocrResult.confidence || 0,
          extractedName: fields.name || null,
          extractedDob: fields.date_of_birth || null,
          extractedFatherName: fields.father_name || null,
          extractedMotherName: fields.mother_name || null,
          extractedDocNumber: fields.aadhaar_number || fields.pan_number || fields.passport_number || null,
          extractedGender: fields.gender || null,
          extractedAddress: fields.address || null,
          isScreenshot: qualityReport.isScreenshot,
          isOriginalScan: qualityReport.isOriginalScan,
          resolutionQuality: qualityReport.resolutionQuality,
          tamperingIndicators: qualityReport.tamperingIndicators,
          ocrStatus: 'PENDING',
        },
        update: {
          rawText: ocrResult.raw_text || '',
          detectedType: ocrResult.document_type || doc.type,
          confidence: ocrResult.confidence || 0,
          extractedName: fields.name || null,
          extractedDob: fields.date_of_birth || null,
          extractedFatherName: fields.father_name || null,
          extractedMotherName: fields.mother_name || null,
          extractedDocNumber: fields.aadhaar_number || fields.pan_number || fields.passport_number || null,
          extractedGender: fields.gender || null,
          extractedAddress: fields.address || null,
          isScreenshot: qualityReport.isScreenshot,
          isOriginalScan: qualityReport.isOriginalScan,
          resolutionQuality: qualityReport.resolutionQuality,
          tamperingIndicators: qualityReport.tamperingIndicators,
        },
      });

      // Update the Document record's existing ocrData / tamper fields
      const hasTamperIssues = qualityReport.tamperingIndicators.length > 0 || qualityReport.isScreenshot;
      await prisma.document.update({
        where: { id: documentId },
        data: {
          ocrData: ocrResult,
          tamperDetected: hasTamperIssues,
          tamperDetails: hasTamperIssues
            ? qualityReport.tamperingIndicators.join('; ') || 'Possible screenshot detected'
            : null,
        },
      });

      return ocrVerification;
    } catch (err: any) {
      logger.warn(`OCR: AI service call failed for document ${documentId}: ${err.message}`);
      return this.createFallbackOcr(documentId, organizationId, `AI service unavailable: ${err.message}`);
    }
  }

  /**
   * Basic image quality analysis (runs in Node.js without Python).
   */
  private analyzeImageQuality(buffer: Buffer, ocrResult: any) {
    const indicators: string[] = [];
    const fileSize = buffer.length;

    // Very small file might be a screenshot crop
    if (fileSize < 20_000) {
      indicators.push('Very small file size — may be a cropped screenshot');
    }

    // Check for common screenshot dimensions by reading image header
    // PNG header check
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
    // JPEG header
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;

    // If OCR confidence is very low, flag it
    if (ocrResult.confidence < 0.4) {
      indicators.push('Low OCR confidence — document may be unclear or altered');
    }

    // Check if raw text is suspiciously short for an ID document
    const rawLen = (ocrResult.raw_text || '').length;
    if (rawLen < 20 && ocrResult.document_type !== 'OTHER') {
      indicators.push('Very little text extracted — may be a photo of a photo or heavily edited');
    }

    // Heuristic: screenshots tend to be PNG with very uniform compression
    const isScreenshot = isPng && fileSize > 500_000 && rawLen < 100;

    return {
      isScreenshot,
      isOriginalScan: !isScreenshot && isJpeg && fileSize > 100_000,
      resolutionQuality: fileSize > 500_000 ? 'HIGH' : fileSize > 100_000 ? 'MEDIUM' : 'LOW',
      tamperingIndicators: indicators,
    };
  }

  /**
   * Create a minimal OCR record when AI service is unavailable.
   */
  private async createFallbackOcr(documentId: string, organizationId: string, reason: string) {
    return prisma.documentOcrVerification.upsert({
      where: { documentId },
      create: {
        documentId,
        organizationId,
        rawText: reason,
        confidence: 0,
        ocrStatus: 'PENDING',
      },
      update: {
        rawText: reason,
        confidence: 0,
      },
    });
  }

  /**
   * Get OCR verification data for a document.
   */
  async getOcrData(documentId: string) {
    const ocr = await prisma.documentOcrVerification.findUnique({
      where: { documentId },
    });
    if (!ocr) throw new NotFoundError('OCR verification data');
    return ocr;
  }

  /**
   * HR updates/edits OCR extracted data and review status.
   */
  async updateOcrData(documentId: string, data: UpdateOcrInput, reviewerId: string, organizationId: string) {
    const existing = await prisma.documentOcrVerification.findUnique({ where: { documentId } });
    if (!existing) throw new NotFoundError('OCR verification data');

    const updated = await prisma.documentOcrVerification.update({
      where: { documentId },
      data: {
        ...data,
        hrReviewedBy: reviewerId,
        hrReviewedAt: new Date(),
      },
    });

    await createAuditLog({
      userId: reviewerId,
      organizationId,
      entity: 'DocumentOcrVerification',
      entityId: updated.id,
      action: 'UPDATE',
      newValue: data,
    });

    return updated;
  }

  /**
   * Cross-validate all documents for an employee.
   * Compares name and DOB across Aadhaar, PAN, Passport, etc.
   */
  async crossValidateEmployee(employeeId: string, organizationId: string) {
    const docs = await prisma.document.findMany({
      where: { employeeId, deletedAt: null },
      include: { ocrVerification: true },
    });

    const ocrDocs = docs.filter(d => d.ocrVerification);
    if (ocrDocs.length < 2) {
      return { status: 'PENDING', message: 'Need at least 2 documents with OCR data to cross-validate', details: [] };
    }

    const details: { field: string; values: { docType: string; value: string | null }[]; match: boolean }[] = [];

    // Compare names
    const names = ocrDocs.map(d => ({
      docType: d.type,
      value: d.ocrVerification!.extractedName,
    })).filter(n => n.value);

    if (names.length >= 2) {
      const normalized = names.map(n => n.value!.toLowerCase().trim());
      const allMatch = normalized.every(n => n === normalized[0]);
      details.push({ field: 'Name', values: names, match: allMatch });
    }

    // Compare DOB
    const dobs = ocrDocs.map(d => ({
      docType: d.type,
      value: d.ocrVerification!.extractedDob,
    })).filter(n => n.value);

    if (dobs.length >= 2) {
      const normalized = dobs.map(d => d.value!.replace(/[-\/]/g, ''));
      const allMatch = normalized.every(n => n === normalized[0]);
      details.push({ field: 'Date of Birth', values: dobs, match: allMatch });
    }

    // Compare father name
    const fatherNames = ocrDocs.map(d => ({
      docType: d.type,
      value: d.ocrVerification!.extractedFatherName,
    })).filter(n => n.value);

    if (fatherNames.length >= 2) {
      const normalized = fatherNames.map(n => n.value!.toLowerCase().trim());
      const allMatch = normalized.every(n => n === normalized[0]);
      details.push({ field: 'Father Name', values: fatherNames, match: allMatch });
    }

    const allPass = details.every(d => d.match);
    const anyFail = details.some(d => !d.match);
    const overallStatus = details.length === 0 ? 'PENDING' : allPass ? 'PASS' : anyFail ? 'FAIL' : 'PARTIAL';

    // Update each OCR verification with cross-validation result
    for (const doc of ocrDocs) {
      await prisma.documentOcrVerification.update({
        where: { documentId: doc.id },
        data: {
          crossValidationStatus: overallStatus,
          crossValidationDetails: details,
        },
      });
    }

    return { status: overallStatus, details };
  }

  /**
   * Get all OCR verifications for an employee with cross-validation summary.
   */
  async getEmployeeOcrSummary(employeeId: string) {
    const docs = await prisma.document.findMany({
      where: { employeeId, deletedAt: null },
      include: { ocrVerification: true },
      orderBy: { createdAt: 'desc' },
    });

    return docs.map(d => ({
      documentId: d.id,
      documentName: d.name,
      documentType: d.type,
      fileUrl: d.fileUrl,
      status: d.status,
      ocr: d.ocrVerification || null,
    }));
  }
}

export const documentOcrService = new DocumentOcrService();
