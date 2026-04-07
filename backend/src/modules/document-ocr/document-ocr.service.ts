import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { aiService } from '../../services/ai.service.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { UpdateOcrInput } from './document-ocr.validation.js';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export class DocumentOcrService {
  /**
   * Trigger OCR processing for a document by calling the AI service.
   * Now supports PDFs + images via the upgraded Python AI service.
   */
  async triggerOcr(documentId: string, organizationId: string) {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError('Document');

    // Read the file from disk
    let basePath = process.cwd();
    if (basePath.endsWith('backend') || basePath.endsWith('backend/') || basePath.endsWith('backend\\')) {
      basePath = join(basePath, '..');
    }
    const filePath = join(basePath, doc.fileUrl);
    let fileBuffer: Buffer;
    try {
      fileBuffer = readFileSync(filePath);
    } catch {
      logger.warn(`OCR: File not found on disk for document ${documentId}: ${filePath}`);
      return this.createFallbackOcr(documentId, organizationId, 'File not found on disk');
    }

    const ext = doc.fileUrl.split('.').pop()?.toLowerCase() || '';
    const supportedFormats = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'pdf'];
    if (!supportedFormats.includes(ext)) {
      return this.createFallbackOcr(documentId, organizationId, `Unsupported file format (.${ext}). Supported: images, PDF`);
    }

    // Call AI service (now handles both images AND PDFs)
    let ocrResult: any = null;
    try {
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      const mimeType = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      formData.append('file', fileBuffer, { filename: `document.${ext}`, contentType: mimeType });

      const axios = (await import('axios')).default;
      const response = await axios.post(`${AI_SERVICE_URL}/ai/ocr/extract`, formData, {
        headers: formData.getHeaders(),
        timeout: 60000, // 60s for PDF processing
      });

      ocrResult = response.data?.data;
    } catch (err: any) {
      logger.warn(`OCR: AI service call failed for document ${documentId}: ${err.message}`);
    }

    // If AI service failed, use local Node.js OCR fallback (tesseract.js + pdf-parse)
    if (!ocrResult) {
      logger.info(`OCR: Falling back to local Node.js OCR for document ${documentId}`);
      try {
        const { processDocumentLocally } = await import('../../services/document-processor.service.js');
        const localResult = await processDocumentLocally(filePath, doc.type);

        const ocrVerification = await prisma.documentOcrVerification.upsert({
          where: { documentId },
          create: {
            documentId,
            organizationId,
            rawText: localResult.rawText,
            detectedType: localResult.detectedType,
            confidence: localResult.confidence / 100, // normalize to 0-1
            extractedName: localResult.extractedFields.extractedName || null,
            extractedDob: localResult.extractedFields.extractedDob || null,
            extractedDocNumber: localResult.extractedFields.extractedDocNumber || null,
            extractedGender: localResult.extractedFields.extractedGender || null,
            isScreenshot: localResult.isScreenshot,
            isOriginalScan: localResult.isOriginalScan,
            resolutionQuality: localResult.resolutionQuality,
            formatValid: localResult.formatValid,
            formatErrors: localResult.formatErrors as any,
            ocrStatus: localResult.warnings.length > 0 ? 'FLAGGED' : 'PENDING',
            hrNotes: localResult.warnings.length > 0 ? `Local OCR: ${localResult.warnings.join('; ')}` : null,
          },
          update: {
            rawText: localResult.rawText,
            detectedType: localResult.detectedType,
            confidence: localResult.confidence / 100,
            extractedName: localResult.extractedFields.extractedName || null,
            extractedDob: localResult.extractedFields.extractedDob || null,
            extractedDocNumber: localResult.extractedFields.extractedDocNumber || null,
            extractedGender: localResult.extractedFields.extractedGender || null,
            isScreenshot: localResult.isScreenshot,
            isOriginalScan: localResult.isOriginalScan,
            resolutionQuality: localResult.resolutionQuality,
            formatValid: localResult.formatValid,
            formatErrors: localResult.formatErrors as any,
          },
        });
        logger.info(`OCR: Local fallback completed for ${documentId} — confidence: ${localResult.confidence}%`);
        return ocrVerification;
      } catch (localErr: any) {
        logger.warn(`OCR: Local fallback also failed for ${documentId}: ${localErr.message}`);
        return this.createFallbackOcr(documentId, organizationId, `AI service unavailable, local OCR failed: ${localErr.message}`);
      }
    }

    // Analyze image quality
    const qualityReport = this.analyzeImageQuality(fileBuffer, ocrResult, ext);
    const fields = ocrResult.extracted_fields || {};

    // Upsert the OCR verification record
    const ocrVerification = await prisma.documentOcrVerification.upsert({
      where: { documentId },
      create: {
        documentId,
        organizationId,
        rawText: (ocrResult.raw_text || '').substring(0, 10000),
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
        rawText: (ocrResult.raw_text || '').substring(0, 10000),
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

    // Update the Document record
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
  }

  /**
   * Image/document quality analysis.
   */
  private analyzeImageQuality(buffer: Buffer, ocrResult: any, ext: string) {
    const indicators: string[] = [];
    const fileSize = buffer.length;
    const isPdf = ext === 'pdf';

    // Very small file might be a screenshot crop (but not for PDFs)
    if (!isPdf && fileSize < 20_000) {
      indicators.push('Very small file size — may be a cropped screenshot');
    }

    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;

    if (ocrResult.confidence < 0.3) {
      indicators.push('Very low OCR confidence — document may be unclear or heavily edited');
    }

    const rawLen = (ocrResult.raw_text || '').length;
    if (rawLen < 20 && ocrResult.document_type !== 'OTHER' && !isPdf) {
      indicators.push('Very little text extracted — may be a photo of a photo or heavily edited');
    }

    const isScreenshot = !isPdf && isPng && fileSize > 500_000 && rawLen < 100;

    return {
      isScreenshot,
      isOriginalScan: isPdf || (!isScreenshot && isJpeg && fileSize > 100_000),
      resolutionQuality: isPdf ? 'HIGH' : (fileSize > 500_000 ? 'HIGH' : fileSize > 100_000 ? 'MEDIUM' : 'LOW'),
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
   * Trigger LLM-based extraction using the org's configured AI provider (DeepSeek, etc.).
   * This runs AFTER Tesseract/PDF extraction and uses the raw text to intelligently parse fields.
   */
  async triggerLlmOcr(documentId: string, organizationId: string) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { ocrVerification: true },
    });
    if (!doc) throw new NotFoundError('Document');

    const docType = doc.type;
    const existingOcrText = doc.ocrVerification?.rawText || '';

    // Skip if no text to analyze
    if (!existingOcrText || existingOcrText.length < 10 || existingOcrText.startsWith('[')) {
      logger.info(`[LLM OCR] Skipped for document ${documentId} — no OCR text available`);
      return doc.ocrVerification;
    }

    const systemPrompt = `You are an expert Indian document verification system. Your task is to extract key identity fields from OCR text of Indian documents (Aadhaar, PAN Card, Passport, Driving License, Voter ID, Education Certificates, etc.).

IMPORTANT RULES:
1. Extract ONLY fields that are clearly present in the text. Do NOT guess or hallucinate.
2. For document numbers, apply common OCR error corrections: O→0, l→1, I→1, S→5, B→8
3. Validate formats: Aadhaar=12 digits, PAN=ABCDE1234F, Passport=A1234567
4. Normalize dates to DD/MM/YYYY format
5. If name appears in ALL CAPS, convert to Title Case
6. Look for discrepancies between the stated document type and detected content
7. Rate your confidence 0.0-1.0 based on text clarity and field extraction success

Return ONLY valid JSON with these fields:
{
  "extractedName": string|null,
  "extractedDocNumber": string|null,
  "extractedDob": string|null,
  "extractedFatherName": string|null,
  "extractedMotherName": string|null,
  "extractedGender": string|null,
  "extractedAddress": string|null,
  "documentType": string,
  "confidence": number,
  "issues": string[],
  "corrections": string[]
}

"issues" should list any problems found (e.g., "Name on Aadhaar doesn't match PAN").
"corrections" should list any OCR corrections applied (e.g., "Changed PAN 'ABCDE1234O' to 'ABCDE12340'").`;

    const userPrompt = `Document type: ${docType.replace(/_/g, ' ')}
File: ${doc.fileUrl.split('/').pop()}

OCR Extracted Text:
---
${existingOcrText.substring(0, 3000)}
---

Please extract all identity fields from the above OCR text. Apply OCR error corrections where needed.`;

    try {
      const aiResponse = await aiService.prompt(organizationId, systemPrompt, userPrompt);

      let llmData: any;
      try {
        const content = aiResponse.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        llmData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
      } catch {
        logger.warn(`[LLM OCR] Failed to parse AI response for document ${documentId}`);
        llmData = { confidence: 0, error: 'Failed to parse AI response' };
      }

      const llmConfidence = typeof llmData.confidence === 'number' ? llmData.confidence : 0;

      // If LLM extracted better data than Tesseract, merge it
      const currentOcr = doc.ocrVerification;
      const updateData: any = {
        llmExtractedData: llmData,
        llmConfidence,
      };

      // Use LLM data to fill gaps in Tesseract extraction
      if (llmData.extractedName && !currentOcr?.extractedName) {
        updateData.extractedName = llmData.extractedName;
      }
      if (llmData.extractedDocNumber && !currentOcr?.extractedDocNumber) {
        updateData.extractedDocNumber = llmData.extractedDocNumber;
      }
      if (llmData.extractedDob && !currentOcr?.extractedDob) {
        updateData.extractedDob = llmData.extractedDob;
      }
      if (llmData.extractedFatherName && !currentOcr?.extractedFatherName) {
        updateData.extractedFatherName = llmData.extractedFatherName;
      }
      if (llmData.extractedGender && !currentOcr?.extractedGender) {
        updateData.extractedGender = llmData.extractedGender;
      }
      if (llmData.extractedAddress && !currentOcr?.extractedAddress) {
        updateData.extractedAddress = llmData.extractedAddress;
      }

      // If LLM found a better document type
      if (llmData.documentType && (!currentOcr?.detectedType || currentOcr.detectedType === 'OTHER')) {
        updateData.detectedType = llmData.documentType;
      }

      // Update confidence to the higher of Tesseract vs LLM
      if (llmConfidence > (currentOcr?.confidence || 0)) {
        updateData.confidence = llmConfidence;
      }

      const updated = await prisma.documentOcrVerification.update({
        where: { documentId },
        data: updateData,
      });

      logger.info(`[LLM OCR] Completed for document ${documentId} — confidence: ${llmConfidence}, issues: ${(llmData.issues || []).length}`);
      return updated;
    } catch (err: any) {
      logger.warn(`[LLM OCR] Failed for document ${documentId}: ${err.message}`);
      return doc.ocrVerification;
    }
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
      const normalized = names.map(n => n.value!.toLowerCase().replace(/\s+/g, ' ').trim());
      const allMatch = normalized.every(n => n === normalized[0]);
      details.push({ field: 'Name', values: names, match: allMatch });
    }

    // Compare DOB
    const dobs = ocrDocs.map(d => ({
      docType: d.type,
      value: d.ocrVerification!.extractedDob,
    })).filter(n => n.value);

    if (dobs.length >= 2) {
      const normalized = dobs.map(d => d.value!.replace(/[-\/\.]/g, ''));
      const allMatch = normalized.every(n => n === normalized[0]);
      details.push({ field: 'Date of Birth', values: dobs, match: allMatch });
    }

    // Compare father name
    const fatherNames = ocrDocs.map(d => ({
      docType: d.type,
      value: d.ocrVerification!.extractedFatherName,
    })).filter(n => n.value);

    if (fatherNames.length >= 2) {
      const normalized = fatherNames.map(n => n.value!.toLowerCase().replace(/\s+/g, ' ').trim());
      const allMatch = normalized.every(n => n === normalized[0]);
      details.push({ field: 'Father Name', values: fatherNames, match: allMatch });
    }

    const allPass = details.every(d => d.match);
    const anyFail = details.some(d => !d.match);
    const overallStatus = details.length === 0 ? 'PENDING' : allPass ? 'PASS' : anyFail ? 'FAIL' : 'PARTIAL';

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
   * Get all OCR verifications for an employee.
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
