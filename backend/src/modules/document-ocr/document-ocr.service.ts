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

    // Combined KYC PDFs must NOT be processed by the single-document OCR pipeline.
    // They have their own pipeline via /ai/ocr/classify-combined-pdf called from onboarding.routes.ts.
    // Running them through /ai/ocr/extract produces meaningless 0%-confidence results and FLAGGED status.
    const isCombinedKycPdf =
      doc.type === 'OTHER' &&
      typeof doc.name === 'string' &&
      (doc.name.toLowerCase().includes('combined') || doc.name.toLowerCase().includes('kyc'));

    if (isCombinedKycPdf) {
      logger.info(`OCR: Skipping single-doc OCR for combined KYC PDF ${documentId} — processed by combined-pdf pipeline`);

      // Read the latest combined PDF analysis from the gate (already stored by onboarding pipeline)
      const gate = await prisma.onboardingDocumentGate.findFirst({
        where: { employee: { documents: { some: { id: documentId } } } },
        select: { combinedPdfAnalysis: true },
      }).catch(() => null);

      const analysis = gate?.combinedPdfAnalysis as any;
      const suspicionScore: number = analysis?.suspicion_score || analysis?.suspicionScore || 0;
      const wrongUploadCount: number = analysis?.wrong_upload_count || analysis?.wrongUploadCount || 0;
      const riskLevel: string = analysis?.risk_level || analysis?.riskLevel || 'LOW';

      // Auto-flag if Python classifier found suspicious content or wrong documents
      const autoStatus = (suspicionScore >= 50 || wrongUploadCount > 0) ? 'FLAGGED' : 'PENDING';
      const docStatus = (suspicionScore >= 50 || wrongUploadCount > 0) ? 'FLAGGED' : 'PENDING';

      const noteLines = [
        'Combined KYC PDF — processed by the combined-PDF classifier.',
        riskLevel !== 'LOW' ? `Risk level: ${riskLevel} (suspicion score: ${suspicionScore}/100).` : '',
        wrongUploadCount > 0
          ? `⚠ ${wrongUploadCount} page(s) detected as WRONG DOCUMENTS (non-KYC content). HR must request re-upload.`
          : '',
        'HR must open the document and verify each constituent document (Aadhaar/PAN, education certs, etc.).',
      ].filter(Boolean).join(' ');

      const ocr = await prisma.documentOcrVerification.upsert({
        where: { documentId },
        create: {
          documentId,
          organizationId,
          rawText: noteLines,
          detectedType: 'COMBINED_PDF',
          confidence: 0,
          ocrStatus: autoStatus,
          hrNotes: noteLines,
          processingMode: 'manual_review',
          extractionSource: 'none',
          suspicionScore,
          llmExtractedData: analysis ? {
            page_validations: analysis.page_validations || analysis.pageValidations || [],
            wrong_upload_pages: analysis.wrong_upload_pages || analysis.wrongUploadPages || [],
            wrong_upload_count: wrongUploadCount,
            risk_level: riskLevel,
          } as any : undefined,
        },
        update: {
          rawText: noteLines,
          detectedType: 'COMBINED_PDF',
          confidence: 0,
          ocrStatus: autoStatus,
          hrNotes: noteLines,
          processingMode: 'manual_review',
          extractionSource: 'none',
          suspicionScore,
          llmExtractedData: analysis ? {
            page_validations: analysis.page_validations || analysis.pageValidations || [],
            wrong_upload_pages: analysis.wrong_upload_pages || analysis.wrongUploadPages || [],
            wrong_upload_count: wrongUploadCount,
            risk_level: riskLevel,
          } as any : undefined,
        },
      });

      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: docStatus,
          rejectionReason: wrongUploadCount > 0
            ? `${wrongUploadCount} page(s) in combined PDF contain non-KYC content — please re-upload correct documents.`
            : null,
          tamperDetected: suspicionScore >= 70,
          tamperDetails: suspicionScore >= 70 ? [`Combined PDF suspicion score: ${suspicionScore}/100, risk: ${riskLevel}`] : [],
        },
      }).catch(() => {});
      return ocr;
    }

    // Call AI service (now handles both images AND PDFs) — native fetch, no axios dependency
    let ocrResult: any = null;
    try {
      const mimeType = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, `document.${ext}`);

      const response = await fetch(`${AI_SERVICE_URL}/ai/ocr/extract`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (response.ok) {
        const json = await response.json() as { data: any };
        ocrResult = json?.data;
      } else {
        logger.warn(`OCR: AI service returned ${response.status} for document ${documentId}`);
      }
    } catch (err: any) {
      logger.warn(`OCR: AI service call failed for document ${documentId}: ${err.message}`);
    }

    // If AI service failed, use local Node.js OCR fallback (tesseract.js + pdf-parse)
    if (!ocrResult) {
      // Combined KYC PDFs cannot be reliably processed by the local fallback —
      // they contain multiple documents merged into one file. Mark as pending HR
      // review instead of FLAGGED so employees are not alarmed.
      const isCombinedKycPdf =
        doc.type === 'OTHER' &&
        typeof doc.name === 'string' &&
        (doc.name.toLowerCase().includes('combined') || doc.name.toLowerCase().includes('kyc'));

      if (isCombinedKycPdf) {
        logger.info(`OCR: Combined KYC PDF detected for ${documentId} — skipping local fallback, setting pending HR review`);
        const note = 'Combined KYC PDF — Python AI service is required for multi-document processing. HR must verify each constituent document (Aadhaar, PAN, education certs, etc.) manually by opening the PDF.';
        const ocr = await prisma.documentOcrVerification.upsert({
          where: { documentId },
          create: {
            documentId,
            organizationId,
            rawText: note,
            detectedType: 'COMBINED_PDF',
            confidence: 0,
            ocrStatus: 'PENDING',
            hrNotes: note,
            processingMode: 'manual_review',
            extractionSource: 'none',
            suspicionScore: 0,
          },
          update: {
            rawText: note,
            detectedType: 'COMBINED_PDF',
            confidence: 0,
            ocrStatus: 'PENDING',
            hrNotes: note,
            processingMode: 'manual_review',
            extractionSource: 'none',
          },
        });
        // Keep document status as PENDING (not FLAGGED) — this is not a suspicious document
        await prisma.document.update({
          where: { id: documentId },
          data: { status: 'PENDING', rejectionReason: null },
        }).catch(() => {});
        return ocr;
      }

      logger.info(`OCR: Falling back to local Node.js OCR for document ${documentId}`);
      try {
        const { processDocumentLocally } = await import('../../services/document-processor.service.js');
        const localResult = await processDocumentLocally(filePath, doc.type);

        const allWarnings = [...localResult.warnings, ...localResult.formatWarnings, ...localResult.suspicionFlags];
        const localOcrStatus = 'FLAGGED'; // Node fallback is never fully trusted — always needs HR review
        const localHrNote = [
          'Processed by Node.js OCR fallback (Python AI service was unavailable).',
          ...(allWarnings.length > 0 ? [`Warnings: ${allWarnings.join('; ')}`] : []),
        ].join(' ');

        // Bank-specific fields from Node.js extractor — stored for autoFillFromOcr
        const localBankExtras = (localResult.extractedFields.ifscCode || localResult.extractedFields.bankName) ? {
          accountNumber: localResult.extractedFields.extractedDocNumber || null,
          ifscCode: localResult.extractedFields.ifscCode || null,
          bankName: localResult.extractedFields.bankName || null,
          micrCode: localResult.extractedFields.micrCode || null,
        } : {};

        const ocrVerification = await prisma.documentOcrVerification.upsert({
          where: { documentId },
          create: {
            documentId,
            organizationId,
            rawText: localResult.rawText,
            detectedType: localResult.detectedType,
            confidence: localResult.confidence / 100,
            extractedName: localResult.extractedFields.extractedName || null,
            extractedDob: localResult.extractedFields.extractedDob || null,
            extractedDocNumber: localResult.extractedFields.extractedDocNumber || null,
            extractedFatherName: localResult.extractedFields.extractedFatherName || null,
            extractedMotherName: localResult.extractedFields.extractedMotherName || null,
            extractedGender: localResult.extractedFields.extractedGender || null,
            extractedAddress: localResult.extractedFields.extractedAddress || null,
            isScreenshot: localResult.isScreenshot,
            isOriginalScan: localResult.isOriginalScan,
            resolutionQuality: localResult.resolutionQuality,
            formatValid: localResult.formatValid,
            formatErrors: localResult.formatErrors as any,
            ocrStatus: localOcrStatus,
            hrNotes: localHrNote,
            processingMode: 'node_fallback',
            extractionSource: 'tesseract',
            suspicionScore: localResult.suspicionFlags.length * 10,
            suspicionFlags: localResult.suspicionFlags as any,
            ...(Object.keys(localBankExtras).length > 0 ? { llmExtractedData: localBankExtras as any } : {}),
          },
          update: {
            rawText: localResult.rawText,
            detectedType: localResult.detectedType,
            confidence: localResult.confidence / 100,
            extractedName: localResult.extractedFields.extractedName || null,
            extractedDob: localResult.extractedFields.extractedDob || null,
            extractedDocNumber: localResult.extractedFields.extractedDocNumber || null,
            extractedFatherName: localResult.extractedFields.extractedFatherName || null,
            extractedMotherName: localResult.extractedFields.extractedMotherName || null,
            extractedGender: localResult.extractedFields.extractedGender || null,
            extractedAddress: localResult.extractedFields.extractedAddress || null,
            isScreenshot: localResult.isScreenshot,
            isOriginalScan: localResult.isOriginalScan,
            resolutionQuality: localResult.resolutionQuality,
            formatValid: localResult.formatValid,
            formatErrors: localResult.formatErrors as any,
            ocrStatus: localOcrStatus,
            hrNotes: localHrNote,
            processingMode: 'node_fallback',
            extractionSource: 'tesseract',
            suspicionScore: localResult.suspicionFlags.length * 10,
            suspicionFlags: localResult.suspicionFlags as any,
            ...(Object.keys(localBankExtras).length > 0 ? { llmExtractedData: localBankExtras as any } : {}),
          },
        });

        // Sync Document.status → FLAGGED so employee UI shows it clearly
        await prisma.document.update({
          where: { id: documentId },
          data: { status: 'FLAGGED', rejectionReason: 'Processed by Node.js OCR fallback. HR review required.' },
        });

        logger.info(`OCR: Node.js fallback completed for ${documentId} — confidence: ${localResult.confidence}%`);
        return ocrVerification;
      } catch (localErr: any) {
        logger.warn(`OCR: Local fallback also failed for ${documentId}: ${localErr.message}`);
        return this.createFallbackOcr(documentId, organizationId, `AI service unavailable, local OCR failed: ${localErr.message}`);
      }
    }

    // Analyze image quality
    const qualityReport = this.analyzeImageQuality(fileBuffer, ocrResult, ext);
    const fields = ocrResult.extracted_fields || {};

    // Confidence-based automatic status: < 60% → FLAGGED, requires HR review
    const confidence = ocrResult.confidence || 0;
    const isLowConfidence = confidence < 0.60;
    const isPythonFlagged = ocrResult.is_flagged === true;
    const hasTamperIssues = qualityReport.tamperingIndicators.length > 0 || qualityReport.isScreenshot;
    const autoOcrStatus = (isLowConfidence || isPythonFlagged || hasTamperIssues) ? 'FLAGGED' : 'PENDING';

    // Store validation reasons from Python AI in hrNotes for HR display
    const validationReasons: string[] = ocrResult.validation_reasons || [];
    const dynamicFields: Record<string, string> = ocrResult.dynamic_fields || {};
    const authenticityScore: number = typeof ocrResult.authenticity_score === 'number' ? ocrResult.authenticity_score : 1.0;
    const hrNotesFromAI = validationReasons.length > 0
      ? `AI Analysis (Authenticity: ${Math.round(authenticityScore * 100)}%):\n${validationReasons.join('\n')}`
      : null;

    // Bank-specific fields extracted by Python — stored at root of llmExtractedData for autoFillFromOcr
    const bankExtras = (fields.ifsc_code || fields.bank_name || fields.account_number) ? {
      accountNumber: fields.account_number || null,
      ifscCode: fields.ifsc_code || null,
      bankName: fields.bank_name || null,
      branch: fields.branch || null,
    } : {};

    // Upsert the OCR verification record
    const ocrVerification = await prisma.documentOcrVerification.upsert({
      where: { documentId },
      create: {
        documentId,
        organizationId,
        rawText: (ocrResult.raw_text || '').substring(0, 10000),
        detectedType: ocrResult.document_type || doc.type,
        confidence,
        extractedName: fields.name || fields.account_holder_name || fields.student_name || null,
        extractedDob: fields.date_of_birth || null,
        extractedFatherName: fields.father_name || null,
        extractedMotherName: fields.mother_name || null,
        extractedDocNumber: fields.aadhaar_number || fields.pan_number || fields.passport_number || fields.epic_number || fields.dl_number || fields.account_number || null,
        extractedGender: fields.gender || null,
        extractedAddress: fields.address || null,
        isScreenshot: qualityReport.isScreenshot,
        isOriginalScan: qualityReport.isOriginalScan,
        resolutionQuality: qualityReport.resolutionQuality,
        tamperingIndicators: qualityReport.tamperingIndicators,
        ocrStatus: autoOcrStatus,
        hrNotes: hrNotesFromAI,
        processingMode: 'python_advanced',
        extractionSource: 'python',
        suspicionScore: hasTamperIssues ? 60 : isLowConfidence ? 30 : 0,
        // Store validation reasons + dynamic fields in llmExtractedData for frontend access
        llmExtractedData: {
          validation_reasons: validationReasons,
          dynamic_fields: dynamicFields,
          authenticity_score: authenticityScore,
          is_flagged: isPythonFlagged,
          ...bankExtras,
        } as any,
      },
      update: {
        rawText: (ocrResult.raw_text || '').substring(0, 10000),
        detectedType: ocrResult.document_type || doc.type,
        confidence,
        extractedName: fields.name || fields.account_holder_name || fields.student_name || null,
        extractedDob: fields.date_of_birth || null,
        extractedFatherName: fields.father_name || null,
        extractedMotherName: fields.mother_name || null,
        extractedDocNumber: fields.aadhaar_number || fields.pan_number || fields.passport_number || fields.epic_number || fields.dl_number || fields.account_number || null,
        extractedGender: fields.gender || null,
        extractedAddress: fields.address || null,
        isScreenshot: qualityReport.isScreenshot,
        isOriginalScan: qualityReport.isOriginalScan,
        resolutionQuality: qualityReport.resolutionQuality,
        tamperingIndicators: qualityReport.tamperingIndicators,
        ocrStatus: autoOcrStatus,
        hrNotes: hrNotesFromAI,
        processingMode: 'python_advanced',
        extractionSource: 'python',
        suspicionScore: hasTamperIssues ? 60 : isLowConfidence ? 30 : 0,
        llmExtractedData: {
          validation_reasons: validationReasons,
          dynamic_fields: dynamicFields,
          authenticity_score: authenticityScore,
          is_flagged: isPythonFlagged,
          ...bankExtras,
        } as any,
      },
    });

    // Update the Document record — auto-flag if confidence is low
    await prisma.document.update({
      where: { id: documentId },
      data: {
        ocrData: ocrResult,
        status: (hasTamperIssues || isLowConfidence) ? 'FLAGGED' : undefined,
        tamperDetected: hasTamperIssues,
        tamperDetails: hasTamperIssues
          ? qualityReport.tamperingIndicators.join('; ') || 'Possible screenshot detected'
          : null,
        rejectionReason: isLowConfidence && !hasTamperIssues
          ? `OCR confidence is ${Math.round(confidence * 100)}% (below 60% threshold). HR review required.`
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
   * Create a minimal OCR record when both AI service and Node.js OCR are unavailable.
   * Documents in this state require full manual HR review.
   */
  private async createFallbackOcr(documentId: string, organizationId: string, reason: string) {
    const note = `Manual review required. OCR could not be performed: ${reason}`;
    const ocr = await prisma.documentOcrVerification.upsert({
      where: { documentId },
      create: {
        documentId,
        organizationId,
        rawText: note,
        confidence: 0,
        ocrStatus: 'FLAGGED',
        hrNotes: note,
        processingMode: 'manual_review',
        extractionSource: 'none',
        suspicionScore: 0,
      },
      update: {
        rawText: note,
        confidence: 0,
        ocrStatus: 'FLAGGED',
        hrNotes: note,
        processingMode: 'manual_review',
        extractionSource: 'none',
      },
    });

    // Sync Document.status → FLAGGED so the employee sees a clear status
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FLAGGED', rejectionReason: 'OCR processing could not be completed. HR will review manually.' },
    }).catch(() => { /* non-blocking — document may not exist yet */ });

    return ocr;
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

    // Never run LLM OCR on combined PDFs — the raw text is a mix of multiple docs and confuses the LLM
    const isCombined = doc.type === 'OTHER' &&
      typeof doc.name === 'string' &&
      (doc.name.toLowerCase().includes('combined') || doc.name.toLowerCase().includes('kyc'));
    if (isCombined || doc.ocrVerification?.detectedType === 'COMBINED_PDF') {
      logger.info(`[LLM OCR] Skipped for ${documentId} — combined KYC PDF, not suitable for single-doc LLM analysis`);
      return doc.ocrVerification;
    }

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
        const content = aiResponse.data || '';
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
   * Jaro-Winkler similarity between two strings (0-1).
   * Handles OCR noise, initials, and partial middle names better than exact match.
   */
  private jaroSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    const len1 = s1.length, len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;

    const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);
    let matches = 0, transpositions = 0;

    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDist);
      const end = Math.min(i + matchDist + 1, len2);
      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
    if (matches === 0) return 0;

    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
    // Winkler boost: reward common prefix (up to 4 chars)
    let prefix = 0;
    for (let i = 0; i < Math.min(4, len1, len2); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }
    return jaro + prefix * 0.1 * (1 - jaro);
  }

  /**
   * Normalize a name string for comparison:
   * - lowercase
   * - collapse whitespace
   * - remove punctuation
   * - handle initials (e.g. "R." → "r")
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\./g, ' ')       // expand initials dots
      .replace(/[^a-z\s]/g, '')  // remove non-alpha
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Compare two names using Jaro-Winkler similarity.
   * Returns { match, similarity, reason }.
   * PASS >= 0.92 (allows middle name difference, minor OCR noise)
   * PARTIAL 0.80-0.91 (likely same person — middle name or OCR issue)
   * FAIL < 0.80 (likely different people)
   */
  private compareNames(a: string, b: string): { match: 'PASS' | 'PARTIAL' | 'FAIL'; similarity: number; reason: string } {
    const na = this.normalizeName(a);
    const nb = this.normalizeName(b);

    if (na === nb) return { match: 'PASS', similarity: 1.0, reason: 'Exact match after normalization' };

    const sim = this.jaroSimilarity(na, nb);

    // Also try token-based comparison (handles middle name insertion/omission)
    const tokensA = new Set(na.split(' ').filter(t => t.length > 1));
    const tokensB = new Set(nb.split(' ').filter(t => t.length > 1));
    const intersection = [...tokensA].filter(t => tokensB.has(t));
    const tokenSim = intersection.length / Math.max(tokensA.size, tokensB.size);

    const effectiveSim = Math.max(sim, tokenSim * 0.95);

    if (effectiveSim >= 0.92) return { match: 'PASS', similarity: effectiveSim, reason: 'High similarity — names match' };
    if (effectiveSim >= 0.80) return { match: 'PARTIAL', similarity: effectiveSim, reason: `Possible middle name difference or OCR noise (similarity: ${(effectiveSim * 100).toFixed(0)}%)` };
    return { match: 'FAIL', similarity: effectiveSim, reason: `Name mismatch: "${a}" vs "${b}" (similarity: ${(effectiveSim * 100).toFixed(0)}%)` };
  }

  /**
   * Normalize a date string: strip separators, handle DD/MM/YYYY vs YYYY-MM-DD.
   */
  private normalizeDate(d: string): string {
    const stripped = d.replace(/[-\/\.]/g, '');
    // If it looks like YYYYMMDD (8 digits starting with 19xx or 20xx), keep as-is
    if (/^(19|20)\d{6}$/.test(stripped)) return stripped;
    // If it looks like DDMMYYYY, convert to YYYYMMDD for comparison
    if (/^\d{8}$/.test(stripped)) return stripped.slice(4) + stripped.slice(2, 4) + stripped.slice(0, 2);
    return stripped;
  }

  /**
   * Cross-validate all documents for an employee using fuzzy matching.
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

    const details: Array<{
      field: string;
      values: { docType: string; value: string | null }[];
      match: boolean;
      matchDetail?: string;
      similarity?: number;
    }> = [];

    // ---- Name comparison (fuzzy) ----
    const names = ocrDocs
      .map(d => ({ docType: d.type, value: d.ocrVerification!.extractedName }))
      .filter(n => n.value && n.value.trim().length > 2);

    if (names.length >= 2) {
      // Compare all pairs; overall match = worst pairwise result
      let worstMatch: 'PASS' | 'PARTIAL' | 'FAIL' = 'PASS';
      let worstReason = '';
      let lowestSim = 1.0;

      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const result = this.compareNames(names[i].value!, names[j].value!);
          if (result.similarity < lowestSim) {
            lowestSim = result.similarity;
            worstReason = result.reason;
          }
          if (result.match === 'FAIL' || (result.match === 'PARTIAL' && worstMatch === 'PASS')) {
            worstMatch = result.match;
          }
        }
      }

      details.push({
        field: 'Name',
        values: names,
        match: worstMatch !== 'FAIL',
        matchDetail: worstReason,
        similarity: lowestSim,
      });
    }

    // ---- DOB comparison ----
    const dobs = ocrDocs
      .map(d => ({ docType: d.type, value: d.ocrVerification!.extractedDob }))
      .filter(n => n.value && n.value.trim().length > 0);

    if (dobs.length >= 2) {
      const normalized = dobs.map(d => this.normalizeDate(d.value!));
      // Some docs only have year-of-birth — handle gracefully
      const allMatch = normalized.every(n => {
        // If lengths differ greatly, extract just year component
        const yearA = n.length >= 4 ? n.slice(-4) : n;
        const yearB = normalized[0].length >= 4 ? normalized[0].slice(-4) : normalized[0];
        return n === normalized[0] || yearA === yearB;
      });
      details.push({
        field: 'Date of Birth',
        values: dobs,
        match: allMatch,
        matchDetail: allMatch ? 'DOB consistent across documents' : `DOB mismatch detected: ${normalized.join(' vs ')}`,
      });
    }

    // ---- Father name comparison (fuzzy) ----
    const fatherNames = ocrDocs
      .map(d => ({ docType: d.type, value: d.ocrVerification!.extractedFatherName }))
      .filter(n => n.value && n.value.trim().length > 2);

    if (fatherNames.length >= 2) {
      const result = this.compareNames(fatherNames[0].value!, fatherNames[1].value!);
      details.push({
        field: 'Father Name',
        values: fatherNames,
        match: result.match !== 'FAIL',
        matchDetail: result.reason,
        similarity: result.similarity,
      });
    }

    // Overall status
    const allPass = details.every(d => d.match);
    const anyFail = details.some(d => !d.match);
    const overallStatus = details.length === 0 ? 'PENDING' : allPass ? 'PASS' : anyFail ? 'FAIL' : 'PARTIAL';

    for (const doc of ocrDocs) {
      await prisma.documentOcrVerification.update({
        where: { documentId: doc.id },
        data: {
          crossValidationStatus: overallStatus,
          crossValidationDetails: details as any,
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
