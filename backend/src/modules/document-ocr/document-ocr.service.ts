import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { aiService } from '../../services/ai.service.js';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { UpdateOcrInput } from './document-ocr.validation.js';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export class DocumentOcrService {
  /**
   * Trigger OCR processing for a document by calling the AI service.
   * Now supports PDFs + images via the upgraded Python AI service.
   */
  async triggerOcr(documentId: string, organizationId: string) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, employee: { organizationId } },
    });
    if (!doc) throw new NotFoundError('Document');

    // Read existing cross-validation result so kycScore reflects it on every re-run
    const existingOcr = await prisma.documentOcrVerification.findUnique({
      where: { documentId },
      select: { crossValidationStatus: true },
    }).catch(() => null);

    // Fetch employee profile for cross-verification against document fields
    const employee = doc.employeeId ? await prisma.employee.findFirst({
      where: { id: doc.employeeId, deletedAt: null },
      select: { firstName: true, lastName: true, dateOfBirth: true, gender: true, fatherName: true },
    }) : null;
    const profileData = employee ? {
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.toISOString().split('T')[0] : null,
      gender: (employee.gender as string | null) ?? null,
      fatherName: employee.fatherName ?? null,
    } : null;

    // Read the file from disk
    let basePath = process.cwd();
    if (basePath.endsWith('backend') || basePath.endsWith('backend/') || basePath.endsWith('backend\\')) {
      basePath = join(basePath, '..');
    }
    const filePath = join(basePath, doc.fileUrl);
    // Path traversal guard: resolved path must stay inside the uploads directory
    const resolvedFilePath = resolve(filePath);
    const resolvedUploadsBase = resolve(join(basePath, 'uploads'));
    if (!resolvedFilePath.startsWith(resolvedUploadsBase + '/') && !resolvedFilePath.startsWith(resolvedUploadsBase + '\\') && resolvedFilePath !== resolvedUploadsBase) {
      logger.warn(`OCR: Path traversal attempt blocked for document ${documentId}: ${resolvedFilePath}`);
      throw new BadRequestError('Invalid file path');
    }
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
          hrNotes: null,
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
          hrNotes: null,
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
          tamperDetails: suspicionScore >= 70 ? `Combined PDF suspicion score: ${suspicionScore}/100, risk: ${riskLevel}` : null,
        },
      }).catch((err: any) => { logger.warn(`[OCR] Failed to update document status for ${documentId}:`, err.message); });
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

    // ── OpenAI KYC Vision Scan (PRIMARY intelligence layer) ──────────────────
    // Uses process.env.OPENAI_API_KEY directly — no DB config needed.
    // gpt-4.1-mini first; auto-escalates to gpt-4.1 when confidence < 0.60.
    // Cost control: only scan when OCR confidence < 70% or result is missing/thin.
    // For PDFs: rasterize first page to PNG via Python AI service, then Vision scans
    // the PNG — this enables Vision coverage for PDF KYC documents (e-Aadhaar, PAN PDF, etc.)
    // ─────────────────────────────────────────────────────────────────────────
    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];
    const ocrConfidence = ocrResult?.confidence || 0;
    const needsVisionScan = !ocrResult
      || ocrConfidence < 0.70
      || (ocrResult.validation_reasons || []).length === 0
      || !(ocrResult.extracted_fields?.name || ocrResult.extracted_fields?.document_number)
      || (ocrResult.raw_text || '').length < 100;

    // For PDFs: attempt to rasterize page 1 to PNG so Vision can scan it
    let visionBuffer = fileBuffer;
    let visionExt = ext;
    if (ext === 'pdf' && needsVisionScan) {
      try {
        const pdfBlob = new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' });
        const pdfForm = new FormData();
        pdfForm.append('file', pdfBlob, 'document.pdf');
        pdfForm.append('page', '1');
        const rasterResp = await fetch(`${AI_SERVICE_URL}/ai/ocr/pdf-to-image`, {
          method: 'POST',
          body: pdfForm,
          signal: AbortSignal.timeout(30_000),
        });
        if (rasterResp.ok) {
          const pngBytes = await rasterResp.arrayBuffer();
          if (pngBytes.byteLength > 1000) {
            visionBuffer = Buffer.from(pngBytes);
            visionExt = 'png';
            logger.info(`[OCR] PDF rasterized to PNG for Vision scan: ${documentId} (${pngBytes.byteLength} bytes)`);
          }
        } else {
          logger.warn(`[OCR] PDF rasterization failed for ${documentId}: HTTP ${rasterResp.status}`);
        }
      } catch (rasterErr: any) {
        logger.warn(`[OCR] PDF rasterization skipped for ${documentId}: ${rasterErr.message}`);
      }
    }

    if ((imageExts.includes(visionExt)) && needsVisionScan) {
      try {
        const imgMime = `image/${visionExt === 'jpg' ? 'jpeg' : visionExt}`;
        const imageBase64 = visionBuffer.toString('base64');
        const kycResp = await aiService.scanDocumentKyc(imageBase64, imgMime, doc.type);

        if (kycResp.success && kycResp.data) {
          const visionJson = JSON.parse(kycResp.data);
          if (!ocrResult) ocrResult = { extracted_fields: {}, validation_reasons: [], raw_text: '' };
          const vf = visionJson.extracted_fields || {};
          const of_ = ocrResult.extracted_fields || {};

          // Support both new enriched schema (vf.full_name.value) and old flat schema (vf.name)
          const vfName = (vf.full_name?.value) || vf.name || null;
          const vfDob = (vf.date_of_birth?.value) || (typeof vf.date_of_birth === 'string' ? vf.date_of_birth : null);
          const vfDocNum = (vf.document_number?.value) || (typeof vf.document_number === 'string' ? vf.document_number : null);
          const vfGender = (vf.gender?.value) || (typeof vf.gender === 'string' ? vf.gender : null);
          const vfAddress = (vf.address?.value) || (typeof vf.address === 'string' ? vf.address : null);
          const vfFatherName = (vf.father_name?.value) || (typeof vf.father_name === 'string' ? vf.father_name : null);

          // Vision fields take priority over Tesseract — OpenAI reads docs visually
          ocrResult.extracted_fields = {
            name: vfName || of_.name,
            date_of_birth: vfDob || of_.date_of_birth,
            document_number: vfDocNum || of_.aadhaar_number || of_.pan_number || of_.passport_number || of_.document_number,
            aadhaar_number: visionJson.document_type === 'AADHAAR' ? (vfDocNum || of_.aadhaar_number) : of_.aadhaar_number,
            pan_number: visionJson.document_type === 'PAN' ? (vfDocNum || of_.pan_number) : of_.pan_number,
            passport_number: visionJson.document_type === 'PASSPORT' ? (vfDocNum || of_.passport_number) : of_.passport_number,
            father_name: vfFatherName || of_.father_name,
            mother_name: vf.mother_name || of_.mother_name,
            gender: vfGender || of_.gender,
            address: vfAddress || of_.address,
            issuing_authority: vf.issuing_authority || of_.issuing_authority,
            issue_date: vf.issue_date || of_.issue_date,
            expiry_date: vf.expiry_date || of_.expiry_date,
            account_number: vf.account_number || of_.account_number,
            ifsc_code: vf.ifsc_code || of_.ifsc_code,
            bank_name: vf.bank_name || of_.bank_name,
            company_name: (vf.company_name?.value) || vf.company_name || of_.company_name || null,
            designation: (vf.designation?.value) || vf.designation || of_.designation || null,
          };

          // Build validation_reasons from new findings[] (evidence-based, not checklists)
          if (Array.isArray(visionJson.findings) && visionJson.findings.length > 0) {
            for (const f of visionJson.findings) {
              if (!f.check || !f.detail) continue;
              const prefix = f.result === 'PASS' ? '✓' : f.result === 'FAIL' ? '✗' : '⚠';
              ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []), `${prefix} ${f.check}: ${f.detail}`];
            }
          }
          // Tampering signals get prominent FAIL prefix
          if (Array.isArray(visionJson.tampering_signals) && visionJson.tampering_signals.length > 0) {
            for (const t of visionJson.tampering_signals) {
              ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []), `✗ Tampering: ${t}`];
            }
          }
          // Authenticity checks — only show non-PASS entries
          if (visionJson.authenticity_checks) {
            for (const [key, val] of Object.entries(visionJson.authenticity_checks as Record<string, any>)) {
              const v = val as any;
              if (v?.result !== 'PASS' && v?.evidence) {
                const prefix = v.result === 'FAIL' ? '✗' : '⚠';
                const label = key.replace(/_/g, ' ');
                ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []), `${prefix} ${label}: ${v.evidence}`];
              }
            }
          }
          // Legacy fallback: old validation_pointers format (Python service / old models)
          if (!visionJson.findings && Array.isArray(visionJson.validation_pointers) && visionJson.validation_pointers.length > 0) {
            ocrResult.validation_reasons = [
              ...(ocrResult.validation_reasons || []),
              ...visionJson.validation_pointers.map((p: string) => `⚠ ${p}`),
            ];
          }
          if (Array.isArray(visionJson.suspicious_indicators) && visionJson.suspicious_indicators.length > 0) {
            ocrResult.validation_reasons = [
              ...(ocrResult.validation_reasons || []),
              ...visionJson.suspicious_indicators.map((s: string) => `⚠ ${s}`),
            ];
          }
          // Store structured vision data for frontend display
          ocrResult.vision_findings = visionJson.findings || [];
          ocrResult.vision_authenticity_checks = visionJson.authenticity_checks || null;
          ocrResult.vision_tampering_signals = visionJson.tampering_signals || [];
          ocrResult.vision_recommended_status = visionJson.recommended_status || null;
          if (visionJson.document_type && visionJson.document_type !== 'OTHER' &&
              (!ocrResult.document_type || ocrResult.document_type === 'OTHER')) {
            ocrResult.document_type = visionJson.document_type;
          }
          if (visionJson.raw_text && (ocrResult.raw_text || '').length < 100) {
            ocrResult.raw_text = visionJson.raw_text;
          }
          // Use vision confidence when it exceeds Tesseract
          if (typeof kycResp.confidence === 'number' && kycResp.confidence > (ocrResult.confidence || 0)) {
            ocrResult.confidence = kycResp.confidence;
          }
          ocrResult.vision_scanned = true;
          ocrResult.vision_quality_note = visionJson.quality?.blur_or_noise_note || visionJson.quality?.blur_note || visionJson.quality_note || null;
          ocrResult.vision_summary = visionJson.summary || null;  // one-sentence AI verdict
          if (kycResp.escalated) ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []), '🔼 Escalated to gpt-4.1 for higher accuracy'];
          logger.info(`[OCR] OpenAI KYC vision complete for ${documentId} — model: ${visionJson._model || 'gpt-4.1-mini'}, conf: ${kycResp.confidence}, escalated: ${kycResp.escalated}`);
        }
      } catch (visionErr: any) {
        logger.warn(`[OCR] KYC vision scan skipped for ${documentId}: ${visionErr.message}`);
      }
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
            hrNotes: null,
            processingMode: 'manual_review',
            extractionSource: 'none',
            suspicionScore: 0,
          },
          update: {
            rawText: note,
            detectedType: 'COMBINED_PDF',
            confidence: 0,
            ocrStatus: 'PENDING',
            hrNotes: null,
            processingMode: 'manual_review',
            extractionSource: 'none',
          },
        });
        // Keep document status as PENDING (not FLAGGED) — this is not a suspicious document
        await prisma.document.update({
          where: { id: documentId },
          data: { status: 'PENDING', rejectionReason: null },
        }).catch((err: any) => { logger.warn(`[OCR] Failed to reset document status for ${documentId}:`, err.message); });
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

    // Face validation for PHOTO type documents — flag if no face detected
    if (doc.type === 'PHOTO' && ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext)) {
      try {
        const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const photoBlob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
        const photoForm = new FormData();
        photoForm.append('file', photoBlob, `photo.${ext}`);
        const photoRes = await fetch(`${AI_SERVICE_URL}/ai/ocr/validate-photo`, {
          method: 'POST',
          body: photoForm,
          signal: AbortSignal.timeout(15_000),
        });
        if (photoRes.ok) {
          const photoJson = await photoRes.json() as { data: { valid: boolean; face_count: number; reason: string } };
          const photoData = photoJson?.data;
          if (photoData && !photoData.valid && photoData.reason !== 'opencv_unavailable') {
            const faceWarning = photoData.reason === 'no_face_detected'
              ? 'No human face detected in this photo. Please upload a clear passport-size photograph.'
              : `Multiple faces detected (${photoData.face_count}). Upload a photo containing only the employee.`;
            if (!ocrResult) ocrResult = {};
            ocrResult.is_flagged = true;
            ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []), `🚩 Photo validation: ${faceWarning}`];
            logger.info(`[OCR] Photo validation failed for ${documentId}: ${photoData.reason}`);
          }
        }
      } catch (photoErr: any) {
        logger.warn(`[OCR] Photo face-validation skipped for ${documentId}: ${photoErr.message}`);
      }

      // ── OpenAI Vision photo quality / liveness check ─────────────────────────
      // Checks for proper passport-style format: single face, plain background,
      // no sunglasses, no obstruction, not a selfie. Non-blocking — failure is logged only.
      try {
        const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const photoBase64 = fileBuffer.toString('base64');
        const photoQualityPrompt = `Analyze this passport-size photograph submitted for KYC identity verification.
Return ONLY compact JSON (no markdown):
{
  "face_count": <number of faces visible>,
  "face_clearly_visible": <true/false>,
  "plain_background": <true/false>,
  "wearing_sunglasses": <true/false>,
  "face_obstructed": <true/false>,
  "is_selfie_style": <true/false>,
  "quality_issues": ["list any issues found"],
  "suitable_for_kyc": <true/false>
}`;
        const apiKey = process.env.OPENAI_API_KEY;
        if (apiKey) {
          const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
          const isOpenRouter = apiKey.startsWith('sk-or-v1-') || baseUrl.includes('openrouter');
          const model = isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4.1-mini';
          const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
          const pqRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              ...(isOpenRouter ? { 'HTTP-Referer': 'https://hr.anistonav.com', 'X-Title': 'Aniston HRMS KYC' } : {}),
            },
            body: JSON.stringify({
              model,
              max_tokens: 400,
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: photoQualityPrompt },
                  { type: 'image_url', image_url: { url: `data:${mimeType};base64,${photoBase64}`, detail: 'high' } },
                ],
              }],
            }),
            signal: AbortSignal.timeout(20_000),
          });
          if (pqRes.ok) {
            const pqData = await pqRes.json() as any;
            const pqRaw = pqData.choices?.[0]?.message?.content || '';
            const pqJson = JSON.parse(pqRaw.replace(/```json[\s\S]*?```|```/g, '').trim());
            if (!ocrResult) ocrResult = {};
            if (!ocrResult.llm_extracted_data_extra) ocrResult.llm_extracted_data_extra = {};
            ocrResult.llm_extracted_data_extra.photo_quality_check = pqJson;

            const issues: string[] = pqJson.quality_issues || [];
            if (!pqJson.suitable_for_kyc) {
              if (pqJson.face_count > 1) {
                ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []),
                  `✗ Photo: Multiple faces detected (${pqJson.face_count}) — must be a solo photograph`];
                ocrResult.is_flagged = true;
              } else if (issues.length > 0) {
                ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []),
                  `✗ Photo: ${issues.join(', ')} — employee should re-upload a proper passport-size photograph`];
                ocrResult.is_flagged = true;
              }
            } else {
              ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []),
                `✓ Photo: clear face, plain background, passport style — suitable for KYC`];
            }
            logger.info(`[OCR] Photo quality check complete for ${documentId} — suitable: ${pqJson.suitable_for_kyc}`);
          }
        }
      } catch (pqErr: any) {
        logger.warn(`[OCR] Photo quality check skipped for ${documentId}: ${pqErr.message}`);
      }
      // ── End photo quality check ───────────────────────────────────────────────
    }

    // Analyze image quality — pass docType so PHOTO skips text-based tamper checks
    const qualityReport = this.analyzeImageQuality(fileBuffer, ocrResult, ext, doc.type);
    const fields = ocrResult.extracted_fields || {};

    // Status logic: tamper/screenshot → FLAGGED; low confidence alone → PENDING (HR review, not auto-reject)
    const confidence = ocrResult.confidence || 0;
    const isLowConfidence = confidence > 0 && confidence < 0.60;
    const isPythonFlagged = ocrResult.is_flagged === true;
    const hasTamperIssues = qualityReport.tamperingIndicators.length > 0 || qualityReport.isScreenshot;
    // Low confidence alone never auto-flags — spec: "Low confidence = NEEDS_HR_REVIEW, not fake"
    let autoOcrStatus = (isPythonFlagged || hasTamperIssues) ? 'FLAGGED' : 'PENDING';

    // ── AI Enhancement: run LLM profile cross-check in parallel with image processing ──
    // Performs profile cross-checks and authenticity analysis.
    // Non-blocking — any failure silently falls back to Vision-only output.
    try {
      const profileJson = profileData ? JSON.stringify(profileData) : '{}';
      const docType = ocrResult.document_type || doc.type || 'UNKNOWN';
      const aiResp = await aiService.prompt(
        organizationId,
        `You are an enterprise KYC analyst for an Indian HR system. You receive OCR text and the employee profile.
Perform ONLY profile cross-checks and text-level authenticity assessment — Vision AI has already done image forensics.

Rules:
1. Compare extracted fields against profile values where both are present.
2. Only include findings where you found a real match/mismatch/issue. Skip NOT_APPLICABLE silently.
3. Return maximum 5 findings total. Focus only on profile mismatches and suspicious text patterns.
4. Use specific values: "Document: 'Rahul Kumar' vs profile: 'Rahul Kumar' — exact match" not generic text.
5. If profile data unavailable for a field, set result: NOT_APPLICABLE and skip the finding.
6. Document-type rules (CRITICAL — read carefully before generating any finding):
   - PHOTO/PROFILE_PHOTO: ONLY verify (1) a human face is clearly visible, (2) portrait/passport-size format. Return EMPTY findings and profile_comparison arrays. NEVER flag for missing text, keywords, or document structure.
   - RESIDENCE_PROOF: verify address only — NEVER compare name. The name on a residence proof (electricity/water bill, rental agreement) is often a parent or property owner — a different name is expected and normal, NOT a mismatch.
   - PAN: extract date_of_birth ONLY from the field explicitly labeled "Date of Birth" or "जन्म तिथि". NEVER use "Verified On", "VERIFIED ON", "Verified Date", "Digitally Signed", "Signed on", or any system/verification timestamp as DOB. The PAN DOB must be a birth date at least 18 years in the past — any date within the last 5 years is a verification timestamp, NOT a DOB.
   - TENTH_CERTIFICATE/TWELFTH_CERTIFICATE/DEGREE_CERTIFICATE/POST_GRADUATION_CERTIFICATE: extract name ONLY from the student/examinee name field (labeled "Name of Student", "विद्यार्थी का नाम", "This is to certify that [NAME]", "Candidate Name"). NEVER extract Mother's Name, Father's Name, school name, board name, or any header text as the student name. If only mother/father name is visible and no student name, return NOT_APPLICABLE for name.
   - SALARY_SLIP_DOC: verify gross - deductions = net if all present.
   - EXPERIENCE_LETTER/OFFER_LETTER_DOC/RELIEVING_LETTER: check name/company/designation/dates.
   - BANK_STATEMENT/CANCELLED_CHEQUE: check account holder name only.
   - DIGILOCKER: if the document shows a DigiLocker logo, QR code, or "Powered by DigiLocker" / "Digitally signed" text, it is a government-digitally-verified document — treat this as a strong positive authenticity signal and note it explicitly.

Respond with compact JSON only (no markdown):
{"confirmed_type":"...","findings":[{"check":"Name cross-check","result":"PASS|WARNING|FAIL","detail":"specific evidence"}],"profile_comparison":[{"field":"full_name","profile_value":"","document_value":"","result":"PASS|WARNING|FAIL|NOT_APPLICABLE","confidence":0,"detail":"specific comparison result"}],"suspicious_indicators":[],"confidence_note":"one-line assessment"}`,
        `Document type: ${docType}\nEmployee profile: ${profileJson}\nOCR Text (first 1500 chars):\n${(ocrResult.raw_text || '').substring(0, 1500)}`,
        900,
      );
      if (aiResp.success && aiResp.data) {
        try {
          const cleaned = aiResp.data.replace(/```json[\s\S]*?```|```/g, '').trim();
          const aiJson = JSON.parse(cleaned);

          // Add evidence-based findings to validation_reasons
          if (Array.isArray(aiJson.findings)) {
            for (const f of aiJson.findings) {
              if (!f.check || !f.detail) continue;
              const prefix = f.result === 'PASS' ? '✓' : f.result === 'FAIL' ? '✗' : '⚠';
              ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []), `${prefix} ${f.check}: ${f.detail}`];
            }
          }
          if (Array.isArray(aiJson.suspicious_indicators)) {
            for (const s of aiJson.suspicious_indicators) {
              if (s) ocrResult.validation_reasons = [...(ocrResult.validation_reasons || []), `⚠ ${s}`];
            }
          }
          if (aiJson.confidence_note) ocrResult.ai_confidence_note = aiJson.confidence_note;
          // Store structured profile comparison for frontend
          if (Array.isArray(aiJson.profile_comparison) && aiJson.profile_comparison.length > 0) {
            ocrResult.profile_comparison = aiJson.profile_comparison;
          }
          if (aiJson.confirmed_type && aiJson.confirmed_type !== 'OTHER' &&
              (!ocrResult.document_type || ocrResult.document_type === 'OTHER')) {
            ocrResult.document_type = aiJson.confirmed_type;
          }
        } catch {
          // Malformed AI JSON — ignore, keep Vision result
        }
      }
    } catch (aiErr: any) {
      logger.warn(`[OCR] AI enhancement skipped for ${documentId}: ${aiErr.message}`);
    }

    // Deduplicate findings: Vision AI + LLM enhancement may produce overlapping checks.
    // Extract the check name from each reason string (everything before the first ': ')
    // and keep only the most severe result per check (FAIL > WARNING > PASS).
    // When Vision AI produced real findings, skip Python OCR generic template messages entirely —
    // they add noise like "HR must manually identify and verify this page" with no specific evidence.
    const visionHasFindings = (ocrResult?.vision_findings || []).length > 0;
    const rawReasons: string[] = visionHasFindings ? [] : (ocrResult.validation_reasons || []);
    const severityRank = (r: string) => r.startsWith('✗') ? 2 : r.startsWith('⚠') ? 1 : 0;
    const deduped = new Map<string, string>();
    for (const r of rawReasons) {
      const colonIdx = r.indexOf(':');
      const key = colonIdx > 0 ? r.slice(2, colonIdx).trim().toLowerCase() : r.slice(0, 40).toLowerCase();
      const existing = deduped.get(key);
      if (!existing || severityRank(r) > severityRank(existing)) {
        deduped.set(key, r);
      }
    }
    // For PHOTO documents: only face-detection and portrait-format findings are relevant.
    // Strip all Python OCR text-based reasons — they have no meaning for a photograph.
    const isPhotoType = doc.type === 'PHOTO';
    const validationReasons: string[] = isPhotoType
      ? Array.from(deduped.values()).filter(r => /face|portrait|passport.?size|multiple.?face|🚩/i.test(r))
      : Array.from(deduped.values());

    // Document expiry check: passport / DL validity — flag if expiry date is in the past or within 6 months
    if (['PASSPORT', 'DRIVING_LICENSE'].includes(doc.type)) {
      const expiryRaw = fields.expiry_date || fields.valid_upto || fields.validity || null;
      if (!ocrResult.extra_fields) ocrResult.extra_fields = {};
      if (expiryRaw) {
        ocrResult.extra_fields.expiry_date = expiryRaw;
        const normalized = this.normalizeDate(expiryRaw);
        if (normalized) {
          const expiry = new Date(normalized.slice(0, 4) + '-' + normalized.slice(4, 6) + '-' + normalized.slice(6, 8));
          const now = new Date();
          const sixMonthsAhead = new Date(); sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);
          if (!isNaN(expiry.getTime())) {
            if (expiry < now) {
              ocrResult.extra_fields.is_expired = true;
              validationReasons.push(`✗ Document Expired: ${doc.type.replace('_', ' ')} expired on ${expiryRaw} — employee must renew`);
            } else if (expiry < sixMonthsAhead) {
              ocrResult.extra_fields.is_expired = false;
              validationReasons.push(`⚠ Expiring Soon: ${doc.type.replace('_', ' ')} expires on ${expiryRaw} — expires within 6 months`);
            } else {
              ocrResult.extra_fields.is_expired = false;
            }
          }
        }
      }
    }

    // Aadhaar text-level consistency check + QR guidance note
    if (doc.type === 'AADHAAR') {
      const rawText = ocrResult.raw_text || '';

      // Check if QR/XML data is present in raw text (UIDAI offline XML format)
      const hasQrXmlData = /<Poi\b/i.test(rawText) || /<ResidentData\b/i.test(rawText);
      let qrName: string | null = null;
      let qrDob: string | null = null;
      if (hasQrXmlData) {
        const nameMatch = rawText.match(/\bname=['"](.*?)['"]/i) || rawText.match(/\bn=['"](.*?)['"]/i);
        const dobMatch = rawText.match(/\bdob=['"](.*?)['"]/i);
        if (nameMatch) qrName = nameMatch[1];
        if (dobMatch) qrDob = dobMatch[1];
      }

      // Text-level consistency: doc number passes Verhoeff + name + DOB all present and consistent
      const extractedDocNum = fields.aadhaar_number || fields.document_number || null;
      const extractedName = fields.name || null;
      const extractedDobRaw = fields.date_of_birth || null;

      let aadhaarConsistencyCheck: 'PASS' | 'FAIL' = 'PASS';
      const aadhaarCheckReasons: string[] = [];

      if (qrName && extractedName) {
        const qrNameResult = this.compareNames(qrName, extractedName);
        if (qrNameResult.match === 'FAIL') {
          aadhaarConsistencyCheck = 'FAIL';
          aadhaarCheckReasons.push(`QR name "${qrName}" does not match OCR name "${extractedName}"`);
        }
      }
      if (qrDob && extractedDobRaw) {
        const qrNorm = this.normalizeDate(qrDob);
        const ocrNorm = this.normalizeDate(extractedDobRaw);
        if (qrNorm && ocrNorm && qrNorm !== ocrNorm) {
          aadhaarConsistencyCheck = 'FAIL';
          aadhaarCheckReasons.push(`QR DOB "${qrDob}" does not match OCR DOB "${extractedDobRaw}"`);
        }
      }

      // Store consistency result in extra_fields for verifyKyc() expiry check to reference
      if (!ocrResult.extra_fields) ocrResult.extra_fields = {};
      ocrResult.extra_fields.aadhaar_consistency_check = aadhaarConsistencyCheck;
      ocrResult.extra_fields.aadhaar_check_reason = aadhaarCheckReasons.length > 0
        ? aadhaarCheckReasons.join('; ')
        : extractedDocNum
          ? 'Aadhaar data internally consistent'
          : 'Insufficient data for consistency check';

      if (aadhaarConsistencyCheck === 'FAIL') {
        validationReasons.push(`✗ Aadhaar QR data inconsistency: ${aadhaarCheckReasons.join('; ')}`);
      } else if (hasQrXmlData) {
        validationReasons.push(`✓ Aadhaar QR/XML data present and internally consistent`);
      }

      // Always add HR guidance note for physical Aadhaar verification
      validationReasons.push(
        `⚠ For physical Aadhaar cards: scan QR code with mAadhaar app to verify authenticity against UIDAI database`
      );
    }

    // Graduation year sanity check for education certificates
    // Compare the year on the certificate against the employee's date of birth.
    const EDU_YEAR_CHECK_TYPES: Record<string, { minYearsAfterBirth: number; maxYearsAfterBirth: number }> = {
      TENTH_CERTIFICATE: { minYearsAfterBirth: 14, maxYearsAfterBirth: 22 },
      TWELFTH_CERTIFICATE: { minYearsAfterBirth: 16, maxYearsAfterBirth: 24 },
      DEGREE_CERTIFICATE: { minYearsAfterBirth: 19, maxYearsAfterBirth: 28 },
      POST_GRADUATION_CERTIFICATE: { minYearsAfterBirth: 21, maxYearsAfterBirth: 32 },
    };
    if (EDU_YEAR_CHECK_TYPES[doc.type] && employee?.dateOfBirth) {
      const dobYear = new Date(employee.dateOfBirth).getFullYear();
      if (!isNaN(dobYear) && dobYear > 1900) {
        const rawText = ocrResult.raw_text || '';
        const llmYear = fields.year || fields.passing_year || fields.graduation_year || null;
        let gradYear: number | null = null;
        if (llmYear) {
          const parsed = parseInt(String(llmYear), 10);
          if (parsed >= 1980 && parsed <= new Date().getFullYear() + 1) gradYear = parsed;
        }
        if (!gradYear) {
          // Try to extract year from raw text — look for 4-digit year between 1980 and current year+1
          const yearMatches = rawText.match(/\b(19[89]\d|20[0-2]\d)\b/g);
          if (yearMatches && yearMatches.length > 0) {
            // Take the most recently appearing year that makes sense as a passing year
            const currentYear = new Date().getFullYear();
            const validYears = yearMatches.map(Number).filter((y: number) => y >= 1980 && y <= currentYear + 1);
            if (validYears.length > 0) {
              gradYear = Math.max(...validYears);
            }
          }
        }
        if (gradYear) {
          const { minYearsAfterBirth, maxYearsAfterBirth } = EDU_YEAR_CHECK_TYPES[doc.type];
          const expectedMin = dobYear + minYearsAfterBirth;
          const expectedMax = dobYear + maxYearsAfterBirth;
          if (gradYear < expectedMin || gradYear > expectedMax) {
            const dobStr = employee.dateOfBirth.toISOString().split('T')[0];
            validationReasons.push(
              `⚠ Graduation year ${gradYear} appears inconsistent with date of birth ${dobStr} (expected range: ${expectedMin}–${expectedMax}). Verify the certificate year.`
            );
          }
        }
      }
    }

    const dynamicFields: Record<string, string> = ocrResult.dynamic_fields || {};
    const authenticityScore: number = typeof ocrResult.authenticity_score === 'number' ? ocrResult.authenticity_score : 1.0;
    // AI findings are stored in llmExtractedData.findings — no longer dumped into hrNotes

    // ── KYC Score (weighted 0–100) ────────────────────────────────────────────
    const extractionScore = Math.round(confidence * 100) * 0.30;
    const profileComparison: any[] = ocrResult.profile_comparison || [];
    const profilePassCount = profileComparison.filter((p: any) => p.result === 'PASS').length;
    const profileTotal = profileComparison.filter((p: any) => p.result !== 'NOT_APPLICABLE').length;
    const profileScore = profileTotal > 0 ? (profilePassCount / profileTotal) * 100 * 0.25 : 25; // neutral if no profile
    const failFindings = validationReasons.filter((r: string) => r.startsWith('✗')).length;
    const totalFindings = validationReasons.filter((r: string) => r.startsWith('✓') || r.startsWith('✗') || r.startsWith('⚠')).length;
    const authenticityPct = totalFindings > 0 ? Math.max(0, (totalFindings - failFindings) / totalFindings) * 100 : 80;
    const authenticityScore2 = authenticityPct * 0.15;
    const qualityPct = qualityReport.resolutionQuality === 'HIGH' ? 100 : qualityReport.resolutionQuality === 'MEDIUM' ? 70 : 40;
    const qualityScore = qualityPct * 0.10;
    const prevCross = existingOcr?.crossValidationStatus;
    // null = never cross-validated: use 10 (neutral) not 20 (full pass) to avoid inflating score on first run
    const crossDocScore = prevCross === 'PASS' ? 20 : prevCross === 'PARTIAL' ? 10 : prevCross === 'FAIL' ? 0 : 10;
    const kycScore = Math.round(extractionScore + profileScore + crossDocScore + authenticityScore2 + qualityScore);
    const hasCriticalFindings = validationReasons.some((r: string) => r.startsWith('✗ Tampering:'));
    // AI must NEVER auto-recommend 'VERIFIED' — that is an exclusive HR action.
    // Use 'AI_APPROVED' to signal high confidence without bypassing human review.
    const recommendedStatus = (kycScore >= 85 && !hasCriticalFindings) ? 'AI_APPROVED'
      : (kycScore < 70 || hasCriticalFindings) ? 'FLAGGED'
      : 'NEEDS_HR_REVIEW';

    if (kycScore >= 90 && !hasCriticalFindings && !hasTamperIssues) {
      autoOcrStatus = 'REVIEWED';
    }

    // Bank-specific fields extracted by Python — stored at root of llmExtractedData for autoFillFromOcr
    const bankExtras: Record<string, string | null> = (fields.ifsc_code || fields.bank_name || fields.account_number) ? {
      accountNumber: fields.account_number || null,
      ifscCode: fields.ifsc_code || null,
      bankName: fields.bank_name || null,
      branch: fields.branch || null,
    } : {};

    // IFSC real-time validation for bank documents
    if (['CANCELLED_CHEQUE', 'BANK_STATEMENT'].includes(doc.type) && fields.ifsc_code) {
      const ifscResult = await this.validateIfscCode(fields.ifsc_code);
      if (ifscResult.valid && ifscResult.bankName) {
        validationReasons.push(`✓ IFSC ${fields.ifsc_code} verified — ${ifscResult.bankName}${ifscResult.branch ? ', ' + ifscResult.branch : ''}`);
        // Enrich bankExtras with verified bank name/branch from IFSC API
        if (!bankExtras.bankName && ifscResult.bankName) bankExtras.bankName = ifscResult.bankName;
        if (!bankExtras.branch && ifscResult.branch) bankExtras.branch = ifscResult.branch;
      } else if (!ifscResult.valid && ifscResult.error) {
        validationReasons.push(`✗ IFSC code ${fields.ifsc_code} not found in RBI database — verify the cheque details`);
      }
    }

    // Education certs: student_name has priority; generic name fields often contain school/board names
    const EDU_CERT_TYPES = ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
    const isEduCertDoc = EDU_CERT_TYPES.includes(doc.type);
    const extractedNameValue = isEduCertDoc
      ? (fields.student_name || fields.name || null)
      : (fields.name || fields.account_holder_name || fields.student_name || null);

    // Compute extractedDocNumber here so we can run duplicate detection before the upsert
    const extractedDocNumberValue = fields.aadhaar_number || fields.pan_number || fields.passport_number || fields.epic_number || fields.dl_number || fields.account_number || null;

    // Cross-employee duplicate detection: same identity document number used by two employees = fraud signal
    if (extractedDocNumberValue && doc.employeeId && ['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE'].includes(doc.type)) {
      try {
        const duplicateOcr = await prisma.documentOcrVerification.findFirst({
          where: {
            extractedDocNumber: extractedDocNumberValue,
            document: {
              type: doc.type,
              deletedAt: null,
              employee: { organizationId },
              NOT: { id: documentId },
            },
          },
          select: { documentId: true },
        });
        if (duplicateOcr) {
          validationReasons.push(`✗ Duplicate Document: This ${doc.type.replace(/_/g, ' ')} number (${extractedDocNumberValue}) is already registered by another employee in your organization`);
        }
      } catch (err: any) {
        logger.warn(`[OCR] Duplicate check failed for ${documentId}: ${err.message}`);
      }
    }

    // PAN DOB sanity: DigiLocker stamps "Verified On" dates which AI may pick up as date_of_birth.
    // Any date within the last 18 years cannot be a valid DOB for an employee — discard it.
    let extractedDobValue: string | null = fields.date_of_birth || null;
    if (doc.type === 'PAN' && extractedDobValue) {
      const dobDate = new Date(extractedDobValue);
      const cutoff18 = new Date();
      cutoff18.setFullYear(cutoff18.getFullYear() - 18);
      if (!isNaN(dobDate.getTime()) && dobDate > cutoff18) {
        logger.warn(`[OCR] PAN DOB sanity rejected for ${documentId}: "${extractedDobValue}" is within 18 years — treating as verification timestamp`);
        extractedDobValue = null;
      }
    }

    // Upsert the OCR verification record
    const ocrVerification = await prisma.documentOcrVerification.upsert({
      where: { documentId },
      create: {
        documentId,
        organizationId,
        rawText: (ocrResult.raw_text || '').substring(0, 10000),
        detectedType: ocrResult.document_type || doc.type,
        confidence,
        extractedName: extractedNameValue,
        extractedDob: extractedDobValue,
        extractedFatherName: fields.father_name || null,
        extractedMotherName: fields.mother_name || null,
        extractedDocNumber: extractedDocNumberValue,
        extractedGender: fields.gender || null,
        extractedAddress: fields.address || null,
        isScreenshot: qualityReport.isScreenshot,
        isOriginalScan: qualityReport.isOriginalScan,
        resolutionQuality: qualityReport.resolutionQuality,
        tamperingIndicators: qualityReport.tamperingIndicators,
        ocrStatus: autoOcrStatus,
        hrNotes: null,  // HR writes their own notes; AI findings live in llmExtractedData
        processingMode: 'python_advanced',
        extractionSource: 'python',
        suspicionScore: Math.min(100, (qualityReport.tamperingIndicators.length * 15) + (failFindings * 10) + (isLowConfidence ? 15 : 0)),
        llmExtractedData: {
          validation_reasons: validationReasons,
          dynamic_fields: dynamicFields,
          authenticity_score: authenticityScore,
          is_flagged: isPythonFlagged,
          ai_confidence_note: ocrResult.ai_confidence_note || null,
          vision_scanned: ocrResult.vision_scanned === true,
          vision_quality_note: ocrResult.vision_quality_note || null,
          vision_summary: ocrResult.vision_summary || null,
          // Enterprise KYC structured data
          findings: [...(ocrResult.vision_findings || [])],
          authenticity_checks: ocrResult.vision_authenticity_checks || null,
          tampering_signals: ocrResult.vision_tampering_signals || [],
          // Sanitize: AI model may output 'VERIFIED' but that is an HR-only action
          recommended_status: (ocrResult.vision_recommended_status === 'VERIFIED' ? 'AI_APPROVED' : ocrResult.vision_recommended_status) || recommendedStatus,
          profile_comparison: profileComparison.length > 0 ? profileComparison : [],
          modelUsed: ocrResult.vision_scanned ? 'gpt-4.1-mini' : 'python',
          deepRecheckAvailable: imageExts.includes(ext) || ext === 'pdf',
          ai_enhanced: true,
          ...(ocrResult.extra_fields ? { extra_fields: ocrResult.extra_fields } : {}),
          // Photo quality check result (Change 4 — populated for PHOTO type documents only)
          ...(ocrResult.llm_extracted_data_extra || {}),
          ...bankExtras,
        } as any,
        kycScore,
        profileComparison: profileComparison.length > 0 ? profileComparison as any : undefined,
      },
      update: {
        rawText: (ocrResult.raw_text || '').substring(0, 10000),
        detectedType: ocrResult.document_type || doc.type,
        confidence,
        extractedName: extractedNameValue,
        extractedDob: extractedDobValue,
        extractedFatherName: fields.father_name || null,
        extractedMotherName: fields.mother_name || null,
        extractedDocNumber: extractedDocNumberValue,
        extractedGender: fields.gender || null,
        extractedAddress: fields.address || null,
        isScreenshot: qualityReport.isScreenshot,
        isOriginalScan: qualityReport.isOriginalScan,
        resolutionQuality: qualityReport.resolutionQuality,
        tamperingIndicators: qualityReport.tamperingIndicators,
        ocrStatus: autoOcrStatus,
        // hrNotes intentionally omitted — never overwrite HR's custom notes on re-run
        processingMode: 'python_advanced',
        extractionSource: 'python',
        suspicionScore: Math.min(100, (qualityReport.tamperingIndicators.length * 15) + (failFindings * 10) + (isLowConfidence ? 15 : 0)),
        llmExtractedData: {
          validation_reasons: validationReasons,
          dynamic_fields: dynamicFields,
          authenticity_score: authenticityScore,
          is_flagged: isPythonFlagged,
          ai_confidence_note: ocrResult.ai_confidence_note || null,
          vision_scanned: ocrResult.vision_scanned === true,
          vision_quality_note: ocrResult.vision_quality_note || null,
          vision_summary: ocrResult.vision_summary || null,
          findings: [...(ocrResult.vision_findings || [])],
          authenticity_checks: ocrResult.vision_authenticity_checks || null,
          tampering_signals: ocrResult.vision_tampering_signals || [],
          // Sanitize: AI model may output 'VERIFIED' but that is an HR-only action
          recommended_status: (ocrResult.vision_recommended_status === 'VERIFIED' ? 'AI_APPROVED' : ocrResult.vision_recommended_status) || recommendedStatus,
          profile_comparison: profileComparison.length > 0 ? profileComparison : [],
          modelUsed: ocrResult.vision_scanned ? 'gpt-4.1-mini' : 'python',
          deepRecheckAvailable: imageExts.includes(ext),
          ai_enhanced: true,
          ...(ocrResult.extra_fields ? { extra_fields: ocrResult.extra_fields } : {}),
          // Photo quality check result (Change 4 — populated for PHOTO type documents only)
          ...(ocrResult.llm_extracted_data_extra || {}),
          ...bankExtras,
        } as any,
        kycScore,
        profileComparison: profileComparison.length > 0 ? profileComparison as any : undefined,
      },
    });

    // Auto-verify: kycScore ≥ 90 + no tampering + no critical findings → VERIFIED without waiting for HR
    const shouldAutoVerify = kycScore >= 90 && !hasTamperIssues && !hasCriticalFindings;

    // Update the Document record
    await prisma.document.update({
      where: { id: documentId },
      data: {
        ocrData: ocrResult,
        status: hasTamperIssues ? 'FLAGGED' : (shouldAutoVerify ? 'VERIFIED' : undefined),
        tamperDetected: hasTamperIssues,
        tamperDetails: hasTamperIssues
          ? qualityReport.tamperingIndicators.join('; ') || 'Possible screenshot detected'
          : null,
        rejectionReason: null,
      },
    });

    if (shouldAutoVerify) {
      logger.info(`[OCR] Auto-verified document ${documentId} (kycScore: ${kycScore})`);
      await prisma.documentOcrVerification.update({
        where: { documentId },
        data: { ocrStatus: 'VERIFIED' as any },
      });
      // Fire-and-forget: check if all docs for this employee are now VERIFIED → auto-approve KYC gate
      if (doc.employeeId) {
        this.checkAutoApproveKyc(doc.employeeId, organizationId).catch((err: any) =>
          logger.warn(`[OCR] KYC auto-approve check failed for employee ${doc.employeeId}: ${err.message}`)
        );
      }
    }

    // Auto-escalate: very low confidence + poor score on an image → fire deep recheck immediately
    // Only escalates for image files (PDFs use a different flow); only once (not if already deep-checked)
    const alreadyDeepChecked = (ocrResult as any)._model === 'gpt-4.1';
    if (!shouldAutoVerify && kycScore < 60 && confidence < 0.55 && imageExts.includes(ext) && !alreadyDeepChecked && !hasTamperIssues) {
      logger.info(`[OCR] Auto-escalating ${documentId} to gpt-4.1 deep recheck (score:${kycScore}, conf:${Math.round(confidence * 100)}%)`);
      this.deepRecheckDocument(documentId, 'system-auto-escalate', organizationId).catch((err: any) =>
        logger.warn(`[OCR] Auto-escalate deep recheck failed for ${documentId}: ${err.message}`)
      );
    }

    // Cross-validation timing fix: run cross-validation AFTER OCR completes (not when queuing).
    // Check if all sibling docs for this employee are now processed — the last one triggers cross-validation.
    if (doc.employeeId) {
      try {
        const stillPending = await prisma.documentOcrVerification.count({
          where: {
            document: { employeeId: doc.employeeId, deletedAt: null },
            ocrStatus: 'PENDING',
            NOT: { documentId },
          },
        });
        if (stillPending === 0) {
          this.crossValidateEmployee(doc.employeeId, organizationId).catch((err: any) =>
            logger.warn(`[OCR] Auto cross-validation failed for employee ${doc.employeeId}: ${err.message}`)
          );
        }
      } catch { /* non-blocking */ }
    }

    return ocrVerification;
  }

  /**
   * Image/document quality analysis including PDF metadata and JPEG EXIF tamper detection.
   *
   * PDF metadata check: scans the raw PDF bytes for known design-tool signatures
   * (Canva, Photoshop, GIMP, Inkscape, LibreOffice) in the Creator/Producer fields.
   * These tools are almost never used to generate official government documents — their
   * presence is a strong indicator the PDF was edited or fabricated.
   *
   * EXIF check: scans JPEG/PNG bytes for software strings embedded by editing tools.
   * Phones never write "Photoshop" or "GIMP" into EXIF; finding these strings means
   * the file was post-processed after capture.
   */
  private analyzeImageQuality(buffer: Buffer, ocrResult: any, ext: string, docType?: string) {
    const indicators: string[] = [];
    const fileSize = buffer.length;
    const isPdf = ext === 'pdf';
    const isPhoto = docType === 'PHOTO';

    // Very small file might be a screenshot crop (but not for PDFs or passport photos)
    if (!isPdf && !isPhoto && fileSize < 20_000) {
      indicators.push('Very small file size — may be a cropped screenshot');
    }

    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;

    // ── PDF metadata tamper detection ─────────────────────────────────────────
    // Scan first 8 KB of PDF for Creator/Producer fields. Government PDFs are
    // generated by server-side tools (iTextSharp, ReportLab, etc.), not Canva.
    if (isPdf) {
      const EDITING_TOOLS = [
        'Canva', 'Adobe Photoshop', 'GIMP', 'Inkscape',
        'Microsoft Word', 'LibreOffice', 'OpenOffice',
        'CorelDRAW', 'Affinity', 'Foxit PhantomPDF Editor',
        'Nitro PDF', 'PDFescape',
      ];
      const headerSlice = buffer.slice(0, Math.min(buffer.length, 32_768)).toString('latin1');
      // Capture Creator and Producer field values from PDF metadata
      const creatorMatch = /\/Creator\s*\(([^)]{1,120})\)/i.exec(headerSlice);
      const producerMatch = /\/Producer\s*\(([^)]{1,120})\)/i.exec(headerSlice);
      const metaStr = `${creatorMatch?.[1] || ''} ${producerMatch?.[1] || ''}`.toLowerCase();
      for (const tool of EDITING_TOOLS) {
        if (metaStr.includes(tool.toLowerCase())) {
          indicators.push(`PDF created/edited with ${tool} — possible document fabrication`);
          break; // One match is enough; avoid duplicate indicators
        }
      }
      // Also flag if no Creator/Producer at all — legitimate e-Aadhaar / DigiLocker PDFs always have these
      if (!creatorMatch && !producerMatch && fileSize > 10_000) {
        indicators.push('PDF metadata stripped — Creator/Producer fields missing (possible editing artifact)');
      }
    }

    // ── JPEG/PNG EXIF editing-software detection ──────────────────────────────
    // Camera and scanner EXIF never contains "Photoshop" or "GIMP". Finding these
    // strings in the raw bytes means the image was opened and re-saved in an editor.
    if ((isJpeg || isPng) && !isPhoto) {
      const EXIF_TOOLS = ['Photoshop', 'GIMP', 'Lightroom', 'Canva', 'Affinity Photo', 'Pixelmator'];
      // Scan only first 64 KB where EXIF APP1 segment lives
      const exifSlice = buffer.slice(0, Math.min(buffer.length, 65_536)).toString('latin1');
      for (const tool of EXIF_TOOLS) {
        if (exifSlice.includes(tool)) {
          indicators.push(`Image edited with ${tool} (found in EXIF metadata) — possible document tampering`);
          break;
        }
      }
    }

    // Very low OCR confidence on a text document is suspicious — but PHOTO has no text by design
    if (!isPhoto && ocrResult.confidence < 0.3) {
      indicators.push('Very low OCR confidence — document may be unclear or heavily edited');
    }

    const rawLen = (ocrResult.raw_text || '').length;
    // Skip "very little text" check for PHOTO — photos have no OCR text by design
    if (!isPhoto && rawLen < 20 && ocrResult.document_type !== 'OTHER' && !isPdf) {
      indicators.push('Very little text extracted — may be a photo of a photo or heavily edited');
    }

    const isScreenshot = !isPdf && !isPhoto && isPng && fileSize > 500_000 && rawLen < 100;

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
  async getOcrData(documentId: string, organizationId: string) {
    // Validate document belongs to the requesting org before exposing OCR data
    const doc = await prisma.document.findFirst({
      where: { id: documentId, employee: { organizationId } },
    });
    if (!doc) throw new NotFoundError('Document');
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

    // Validate OCR record belongs to the requesting org
    if (existing.organizationId !== organizationId) throw new ForbiddenError('Access denied');

    const updated = await prisma.documentOcrVerification.update({
      where: { documentId },
      data: {
        ...data,
        hrReviewedBy: reviewerId,
        hrReviewedAt: new Date(),
      },
    });

    // Sync document.status when ocrStatus changes so both fields stay consistent
    if (data.ocrStatus) {
      const statusMap: Record<string, string> = {
        FLAGGED: 'FLAGGED',
        REVIEWED: 'PENDING', // REVIEWED means AI is done; HR must still approve → keep PENDING
        PENDING: 'PENDING',
      };
      const newDocStatus = statusMap[data.ocrStatus];
      if (newDocStatus) {
        await prisma.document.update({
          where: { id: documentId },
          data: { status: newDocStatus as any },
        }).catch((err: any) => { logger.warn(`[OCR] Failed to sync document status for ${documentId}:`, err.message); });
      }
    }

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
    // Clean relational suffixes + honorifics, then normalize (lowercase, collapse whitespace)
    const na = this.normalizeName(this.cleanNameForComparison(a));
    const nb = this.normalizeName(this.cleanNameForComparison(b));

    if (na === nb) return { match: 'PASS', similarity: 1.0, reason: 'Exact match after normalization' };

    const sim = this.jaroSimilarity(na, nb);

    // Also try token-based comparison (handles middle name insertion/omission)
    const tokensA = new Set(na.split(' ').filter(t => t.length > 1));
    const tokensB = new Set(nb.split(' ').filter(t => t.length > 1));
    const intersection = [...tokensA].filter(t => tokensB.has(t));
    const tokenSim = intersection.length / Math.max(tokensA.size, tokensB.size);

    const effectiveSim = Math.max(sim, tokenSim * 0.95);

    // 0.88: allows middle name omission (e.g. "Rajesh Kumar Sharma" vs "Rajesh Sharma")
    // 0.75: accounts for OCR noise and romanization differences in Indian names
    if (effectiveSim >= 0.88) return { match: 'PASS', similarity: effectiveSim, reason: 'High similarity — names match' };
    if (effectiveSim >= 0.75) return { match: 'PARTIAL', similarity: effectiveSim, reason: `Possible middle name difference or OCR noise (similarity: ${(effectiveSim * 100).toFixed(0)}%)` };
    return { match: 'FAIL', similarity: effectiveSim, reason: `Name mismatch: "${a}" vs "${b}" (similarity: ${(effectiveSim * 100).toFixed(0)}%)` };
  }

  /**
   * Normalize a date string to YYYYMMDD for comparison.
   * Handles: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, bare 8-digit strings.
   */
  private normalizeDate(d: string): string {
    if (!d) return '';
    const trimmed = d.trim();
    // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD → already in year-first order
    const isoMatch = trimmed.match(/^(\d{4})[-\/\.](\d{2})[-\/\.](\d{2})$/);
    if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
    // DD/MM/YYYY / DD-MM-YYYY / DD.MM.YYYY → reorder to YYYYMMDD
    const dmyMatch = trimmed.match(/^(\d{2})[-\/\.](\d{2})[-\/\.](\d{4})$/);
    if (dmyMatch) return `${dmyMatch[3]}${dmyMatch[2]}${dmyMatch[1]}`;
    // Bare 8-digit string: validate as YYYYMMDD first (check month 01-12, day 01-31)
    const stripped = trimmed.replace(/[-\/\.]/g, '');
    if (/^\d{8}$/.test(stripped)) {
      const yyyy = parseInt(stripped.slice(0, 4), 10);
      const mm   = parseInt(stripped.slice(4, 6), 10);
      const dd   = parseInt(stripped.slice(6, 8), 10);
      if (yyyy >= 1900 && yyyy <= 2099 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return stripped; // valid YYYYMMDD
      }
      // Month/day validation failed → treat as DDMMYYYY → convert to YYYYMMDD
      return `${stripped.slice(4)}${stripped.slice(2, 4)}${stripped.slice(0, 2)}`;
    }
    return stripped;
  }

  /**
   * Strip relational suffixes and honorifics from a name before comparison.
   * Examples: "SUNNY KUMAR MEHTA Father" → "SUNNY KUMAR MEHTA"
   *           "Mr. Rahul Sharma" → "Rahul Sharma"
   */
  private cleanNameForComparison(name: string): string {
    let cleaned = name.trim();
    // Remove leading honorifics (Mr., Mrs., Ms., Dr., Shri, Smt., Late, Kumari, S/Shri)
    cleaned = cleaned.replace(/^(?:mr\.?|mrs\.?|ms\.?|dr\.?|shri\.?|smt\.?|late\.?|kumari\.?|s\/shri\.?)\s+/i, '');
    // Remove trailing relational labels — run multiple passes for chained suffixes
    const TRAILING_RELATIONAL = [
      /\s+(?:father|s\/o|d\/o|w\/o|c\/o|son\s+of|daughter\s+of|wife\s+of|guardian\s+of)\.?$/i,
      /\s+(?:father['']?s?\s+name|mother['']?s?\s+name|guardian\s+name)\.?$/i,
    ];
    for (let pass = 0; pass < 3; pass++) {
      for (const re of TRAILING_RELATIONAL) cleaned = cleaned.replace(re, '').trim();
    }
    return cleaned.trim();
  }

  /**
   * Validate an IFSC code against the Razorpay IFSC API (RBI-sourced database).
   * Fail-open: any network/service error returns valid:true so OCR is not blocked.
   */
  private async validateIfscCode(ifsc: string): Promise<{ valid: boolean; bankName?: string; branch?: string; error?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      let response: Response;
      try {
        response = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc.toUpperCase())}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
      } finally {
        clearTimeout(timeout);
      }
      if (response.status === 404) {
        return { valid: false, error: 'IFSC code not found in RBI database' };
      }
      if (response.ok) {
        const data = await response.json() as { BANK?: string; BRANCH?: string };
        return { valid: true, bankName: data.BANK, branch: data.BRANCH };
      }
      // Any other HTTP error — fail open
      return { valid: true };
    } catch {
      // Network timeout / unavailable — fail open, don't block OCR pipeline
      return { valid: true };
    }
  }

  /**
   * Return true when a name string is clearly OCR garbage and should be excluded
   * from cross-validation and display (avoids false FAIL on education cert noise).
   * Pass docType to enable education-cert single-word short-name filter.
   */
  private isGarbageName(name: string, docType?: string): boolean {
    if (!name || name.trim().length < 4) return true;
    const n = name.trim();
    if (/\d/.test(n)) return true;                     // contains digits
    if (!/[aeiouAEIOU]/.test(n)) return true;           // no vowels → gibberish
    const lower = n.toLowerCase();
    // Explicit single-word OCR garbage common in Indian education certificates
    const EXPLICIT_GARBAGE = new Set([
      'renal', 'nil', 'null', 'n/a', 'na', 'none', 'name', 'applicant',
      'candidate', 'student', 'holder', 'bearer', 'pass', 'fail',
    ]);
    if (EXPLICIT_GARBAGE.has(lower)) return true;
    // Institution/document keywords that appear near names but are not names
    const GARBAGE_TOKENS = [
      'degree programme', 'programme', 'university', 'college',
      'institute', 'board', 'marksheet', 'certificate', 'examination',
      'council', 'department', 'faculty', 'academic', 'school of', 'hereby certify',
      'awarded to', 'conferred upon',
    ];
    if (GARBAGE_TOKENS.some(t => lower.includes(t))) return true;
    // Education certs: single-word names < 6 chars are almost always OCR noise
    // (genuine names have first + last name or are longer)
    const EDUCATION_TYPES = new Set([
      'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE',
      'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE',
    ]);
    if (docType && EDUCATION_TYPES.has(docType) && !n.includes(' ') && n.length < 6) return true;
    return false;
  }

  /**
   * Cross-validate all documents for an employee using fuzzy matching.
   */
  async crossValidateEmployee(employeeId: string, organizationId: string) {
    const docs = await prisma.document.findMany({
      where: { employeeId, deletedAt: null, employee: { organizationId } },
      include: { ocrVerification: true },
    });

    // Also fetch employee profile to use as an additional source (org-scoped)
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { firstName: true, lastName: true, dateOfBirth: true, gender: true, fatherName: true, address: true },
    });
    if (!employee) throw new NotFoundError('Employee');
    const profileName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : null;
    const profileDob = employee?.dateOfBirth ? employee.dateOfBirth.toISOString().split('T')[0] : null;

    const ocrDocs = docs.filter(d => d.ocrVerification);
    if (ocrDocs.length < 1) {
      return { status: 'PENDING', message: 'Need at least 1 document with OCR data to cross-validate', details: [] };
    }

    // Document types that should NOT contribute DOB to cross-validation.
    // Education certs contain graduation/passing year — not the holder's birth date.
    const DOB_EXCLUDED_TYPES = new Set([
      'PHOTO', 'RESIDENCE_PROOF', 'PERMANENT_RESIDENCE_PROOF',
      'BANK_STATEMENT', 'CANCELLED_CHEQUE', 'EXPERIENCE_LETTER',
      'OFFER_LETTER_DOC', 'RELIEVING_LETTER', 'SALARY_SLIP_DOC',
      'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE',
    ]);

    const details: Array<{
      field: string;
      values: { docType: string; value: string | null }[];
      match: boolean;
      matchDetail?: string;
      similarity?: number;
    }> = [];

    // ---- Name comparison (fuzzy) — include employee profile as additional source ----
    // Exclude OCR garbage names; store CLEANED names (relational suffixes stripped)
    // so display chips show "SUNNY KUMAR MEHTA" not "SUNNY KUMAR MEHTA Father".
    //
    // Address-only documents (residence proof, utility bills, rent agreements) are
    // intentionally excluded from name cross-validation: these documents are commonly
    // in the name of a parent, spouse, or property owner — a name mismatch is expected
    // and does NOT indicate fraud for these document types.
    const NAME_EXCLUDED_TYPES = new Set([
      'RESIDENCE_PROOF', 'PERMANENT_RESIDENCE_PROOF', 'UTILITY_BILL', 'RENT_AGREEMENT',
    ]);

    const names: { docType: string; value: string }[] = ocrDocs
      .filter(d => !NAME_EXCLUDED_TYPES.has(d.type as string))
      .map(d => {
        const raw = d.ocrVerification!.extractedName;
        if (!raw || raw.trim().length <= 2) return null;
        if (this.isGarbageName(raw, d.type as string)) return null;
        const cleaned = this.cleanNameForComparison(raw);
        if (!cleaned || cleaned.length < 3) return null;
        return { docType: d.type as string, value: cleaned };
      })
      .filter((n): n is { docType: string; value: string } => n !== null);

    // Add profile name as a source
    if (profileName && profileName.trim().length > 2) {
      names.push({ docType: 'PROFILE', value: profileName });
    }

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

    // ---- DOB comparison — only use high-confidence OCR results from DOB-bearing documents ----
    // Excluded doc types: PHOTO, RESIDENCE_PROOF, BANK_STATEMENT, etc. — these docs never contain DOB.
    // Threshold: 0.70 confidence. Below this, OCR date reads are unreliable.
    const DOB_CONFIDENCE_THRESHOLD = 0.70;
    const allDobsForDisplay: { docType: string; value: string | null }[] = ocrDocs
      .filter(d => !DOB_EXCLUDED_TYPES.has(d.type as string))
      .map(d => ({ docType: d.type as string, value: d.ocrVerification!.extractedDob }))
      .filter(n => n.value && n.value.trim().length > 0);

    // Add profile DOB as authoritative source (confidence 100%)
    if (profileDob) allDobsForDisplay.push({ docType: 'PROFILE', value: profileDob });

    const highConfDobs: { docType: string; value: string | null }[] = ocrDocs
      .filter(d => !DOB_EXCLUDED_TYPES.has(d.type as string) && (d.ocrVerification!.confidence || 0) >= DOB_CONFIDENCE_THRESHOLD)
      .map(d => ({ docType: d.type as string, value: d.ocrVerification!.extractedDob }))
      .filter(n => n.value && n.value.trim().length > 0);

    // Profile DOB counts as high-confidence
    if (profileDob) highConfDobs.push({ docType: 'PROFILE', value: profileDob });

    if (highConfDobs.length >= 2) {
      // Normalize all DOBs to YYYYMMDD — handles DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD, bare 8-digit
      const normalized = highConfDobs.map(d => this.normalizeDate(d.value!));
      // Full date must match after normalization — year-only match is NOT enough
      const allMatch = normalized.every(n => n === normalized[0]);
      details.push({
        field: 'Date of Birth',
        values: allDobsForDisplay,
        match: allMatch,
        matchDetail: allMatch
          ? 'DOB consistent across documents'
          : `DOB mismatch detected: ${normalized.join(' vs ')}`,
      });
    } else if (allDobsForDisplay.length >= 1) {
      // Not enough high-confidence DOBs to compare — skip automatic fail, flag for HR
      details.push({
        field: 'Date of Birth',
        values: allDobsForDisplay,
        match: true,
        matchDetail: highConfDobs.length === 0
          ? 'DOB comparison skipped — OCR confidence below 70% on all documents. HR should manually verify dates.'
          : 'Only one high-confidence DOB found — manual HR verification recommended.',
      });
    }

    // ---- Father name comparison (fuzzy) ----
    const fatherNames: { docType: string; value: string | null }[] = ocrDocs
      .map(d => ({ docType: d.type as string, value: d.ocrVerification!.extractedFatherName }))
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

    // ---- Bank account holder name vs employee name cross-validation ----
    // CANCELLED_CHEQUE and BANK_STATEMENT docs have extractedName = account holder name.
    // Compare against the employee's profile name. Mismatch may indicate a 3rd-party account.
    const BANK_DOC_TYPES = new Set(['CANCELLED_CHEQUE', 'BANK_STATEMENT']);
    const bankDocs = ocrDocs.filter(d => BANK_DOC_TYPES.has(d.type as string));
    if (bankDocs.length > 0 && profileName && profileName.trim().length > 2) {
      for (const bankDoc of bankDocs) {
        const bankHolderRaw = bankDoc.ocrVerification!.extractedName;
        if (!bankHolderRaw || bankHolderRaw.trim().length < 3) continue;
        if (this.isGarbageName(bankHolderRaw)) continue;
        const bankResult = this.compareNames(bankHolderRaw, profileName);
        const simPct = (bankResult.similarity * 100).toFixed(0);
        const bankDocLabel = bankDoc.type === 'CANCELLED_CHEQUE' ? 'Cancelled Cheque' : 'Bank Statement';
        if (bankResult.match === 'FAIL') {
          details.push({
            field: 'Bank Account Holder Name',
            values: [
              { docType: bankDoc.type as string, value: bankHolderRaw },
              { docType: 'PROFILE', value: profileName },
            ],
            match: false,
            matchDetail: `Bank account holder name on ${bankDocLabel} ("${bankHolderRaw}") does not match employee name ("${profileName}") (similarity: ${simPct}%). Verify the cheque belongs to this employee.`,
            similarity: bankResult.similarity,
          });
        } else if (bankResult.match === 'PARTIAL') {
          details.push({
            field: 'Bank Account Holder Name',
            values: [
              { docType: bankDoc.type as string, value: bankHolderRaw },
              { docType: 'PROFILE', value: profileName },
            ],
            match: true,
            matchDetail: `Bank account holder name on ${bankDocLabel} partially matches employee name (similarity: ${simPct}%) — minor name variation acceptable.`,
            similarity: bankResult.similarity,
          });
        }
        // PASS: no entry needed — no cross-validation noise for perfectly matching names
      }
    }

    // ---- Address PIN code cross-validation ----
    // Compare the 6-digit PIN from AADHAAR or RESIDENCE_PROOF against the employee's stored address.
    // This is a WARNING-only check — mismatch sets PARTIAL at most (not FAIL).
    const ADDRESS_DOC_TYPES = new Set(['AADHAAR', 'RESIDENCE_PROOF', 'PERMANENT_RESIDENCE_PROOF']);
    const employeeAddress = employee?.address as Record<string, string> | null | undefined;
    const profilePin = employeeAddress?.pincode || employeeAddress?.pin || employeeAddress?.postalCode || null;

    if (profilePin && /^\d{6}$/.test(String(profilePin))) {
      for (const addrDoc of ocrDocs.filter(d => ADDRESS_DOC_TYPES.has(d.type as string))) {
        const extractedAddr = addrDoc.ocrVerification!.extractedAddress;
        if (!extractedAddr) continue;
        const pinMatch = extractedAddr.match(/\b(\d{6})\b/);
        if (!pinMatch) continue;
        const docPin = pinMatch[1];
        const docTypeLabel = (addrDoc.type as string).replace(/_/g, ' ');
        if (docPin === String(profilePin)) {
          details.push({
            field: 'Address PIN Code',
            values: [
              { docType: addrDoc.type as string, value: docPin },
              { docType: 'PROFILE', value: String(profilePin) },
            ],
            match: true,
            matchDetail: `✓ Address PIN code ${docPin} from ${docTypeLabel} matches employee profile`,
          });
        } else {
          details.push({
            field: 'Address PIN Code',
            values: [
              { docType: addrDoc.type as string, value: docPin },
              { docType: 'PROFILE', value: String(profilePin) },
            ],
            match: true, // WARNING only — kept true so overall status stays PARTIAL not FAIL
            matchDetail: `⚠ Address PIN code from ${docTypeLabel} (${docPin}) does not match employee profile (${profilePin}) — verify current address`,
          });
        }
        break; // Only check the first address document found
      }
    }

    // Overall status
    const allPass = details.every(d => d.match);
    const anyFail = details.some(d => !d.match);
    const overallStatus = details.length === 0 ? 'PENDING' : allPass ? 'PASS' : anyFail ? 'FAIL' : 'PARTIAL';

    const newCrossDocScore = overallStatus === 'PASS' ? 20 : overallStatus === 'PARTIAL' ? 10 : overallStatus === 'FAIL' ? 0 : 20;
    // Run all per-document OCR verification updates in parallel (was sequential)
    await Promise.all(ocrDocs.map(doc => {
      const existingKycScore = (doc.ocrVerification as any)?.kycScore ?? null;
      let kycScoreUpdate: { kycScore?: number } = {};
      if (existingKycScore !== null) {
        const oldCrossStr = (doc.ocrVerification as any)?.crossValidationStatus || '';
        const oldCrossDocScore = oldCrossStr === 'PASS' ? 20 : oldCrossStr === 'PARTIAL' ? 10 : oldCrossStr === 'FAIL' ? 0 : 20;
        kycScoreUpdate = { kycScore: Math.max(0, Math.min(100, existingKycScore - oldCrossDocScore + newCrossDocScore)) };
      }
      return prisma.documentOcrVerification.update({
        where: { documentId: doc.id },
        data: {
          crossValidationStatus: overallStatus,
          crossValidationDetails: details as any,
          ...kycScoreUpdate,
        },
      });
    }));

    return { status: overallStatus, details };
  }

  /**
   * Deep Re-check: re-process document using gpt-4.1 directly (highest accuracy).
   * Only for image files. Updates the existing OCR record with the new result.
   */
  async deepRecheckDocument(documentId: string, requestedBy: string, organizationId: string) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, employee: { organizationId } },
    });
    if (!doc) throw new NotFoundError('Document');

    const ext = doc.fileUrl.split('.').pop()?.toLowerCase() || '';
    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];
    const supportedDeep = [...imageExts, 'pdf'];
    if (!supportedDeep.includes(ext)) {
      throw new BadRequestError('Deep Re-check supports image files (JPG, PNG, WebP) and PDF documents');
    }

    let basePath = process.cwd();
    if (basePath.endsWith('backend') || basePath.endsWith('backend/') || basePath.endsWith('backend\\')) {
      basePath = join(basePath, '..');
    }
    const filePath = join(basePath, doc.fileUrl);
    // Path traversal guard
    const resolvedFilePath = resolve(filePath);
    const resolvedUploadsBase = resolve(join(basePath, 'uploads'));
    if (!resolvedFilePath.startsWith(resolvedUploadsBase + '/') && !resolvedFilePath.startsWith(resolvedUploadsBase + '\\') && resolvedFilePath !== resolvedUploadsBase) {
      logger.warn(`OCR: Path traversal attempt blocked for document ${documentId}: ${resolvedFilePath}`);
      throw new BadRequestError('Invalid file path');
    }
    let fileBuffer: Buffer;
    try {
      fileBuffer = readFileSync(filePath);
    } catch {
      throw new BadRequestError('File not found on disk');
    }

    // Fetch profile
    const employee = doc.employeeId ? await prisma.employee.findFirst({
      where: { id: doc.employeeId, deletedAt: null },
      select: { firstName: true, lastName: true, dateOfBirth: true, gender: true, fatherName: true },
    }) : null;
    const profileData = employee ? {
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.toISOString().split('T')[0] : null,
      gender: (employee.gender as string | null) ?? null,
      fatherName: employee.fatherName ?? null,
    } : null;

    const imgMime = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const imageBase64 = fileBuffer.toString('base64');
    const kycResp = await aiService.deepScanDocumentKyc(imageBase64, imgMime, doc.type);
    if (!kycResp.success || !kycResp.data) {
      throw new Error(kycResp.error || 'Deep scan failed');
    }

    const visionJson = JSON.parse(kycResp.data);
    const vf = visionJson.extracted_fields || {};
    const vfName = vf.full_name?.value || vf.name || null;
    const vfDob = vf.date_of_birth?.value || (typeof vf.date_of_birth === 'string' ? vf.date_of_birth : null);
    const vfDocNum = vf.document_number?.value || (typeof vf.document_number === 'string' ? vf.document_number : null);

    const validationReasons: string[] = [];
    if (Array.isArray(visionJson.findings)) {
      for (const f of visionJson.findings) {
        if (!f.check || !f.detail) continue;
        const prefix = f.result === 'PASS' ? '✓' : f.result === 'FAIL' ? '✗' : '⚠';
        validationReasons.push(`${prefix} ${f.check}: ${f.detail}`);
      }
    }
    for (const t of (visionJson.tampering_signals || [])) {
      validationReasons.push(`✗ Tampering: ${t}`);
    }

    // Run LLM enhancement with profile
    let profileComparison: any[] = [];
    try {
      const aiResp = await aiService.prompt(
        organizationId,
        `You are an enterprise KYC analyst for an Indian HR system. Perform actual checks on the document text and report structured findings — not checklists. Follow document-type rules strictly: PHOTO = image quality only (no DOB), RESIDENCE_PROOF = name/address only (no DOB). Respond with compact JSON only: {"confirmed_type":"...","findings":[{"check":"...","result":"PASS|WARNING|FAIL","detail":"..."}],"profile_comparison":[{"field":"full_name","profile_value":"","document_value":"","result":"PASS|WARNING|FAIL|NOT_APPLICABLE","confidence":0,"detail":""}],"suspicious_indicators":[],"confidence_note":"..."}`,
        `Document type: ${visionJson.document_type || doc.type}\nEmployee profile: ${JSON.stringify(profileData ?? {})}\nOCR text: ${(visionJson.raw_text || '').substring(0, 1500)}`,
        900,
      );
      if (aiResp.success && aiResp.data) {
        const aiJson = JSON.parse(aiResp.data.replace(/```json[\s\S]*?```|```/g, '').trim());
        if (Array.isArray(aiJson.findings)) {
          for (const f of aiJson.findings) {
            if (!f.check || !f.detail) continue;
            const prefix = f.result === 'PASS' ? '✓' : f.result === 'FAIL' ? '✗' : '⚠';
            validationReasons.push(`${prefix} ${f.check}: ${f.detail}`);
          }
        }
        if (Array.isArray(aiJson.profile_comparison)) profileComparison = aiJson.profile_comparison;
      }
    } catch { /* non-blocking */ }

    const confidence = typeof kycResp.confidence === 'number' ? kycResp.confidence : 0;
    const failCount = validationReasons.filter(r => r.startsWith('✗')).length;
    const totalCount = validationReasons.filter(r => r.startsWith('✓') || r.startsWith('✗') || r.startsWith('⚠')).length;
    const kycScore = Math.round(
      confidence * 100 * 0.30 +
      (profileComparison.filter(p => p.result === 'PASS').length / Math.max(profileComparison.length, 1)) * 100 * 0.25 +
      20 + // crossDoc neutral
      (totalCount > 0 ? Math.max(0, (totalCount - failCount) / totalCount) : 0.8) * 100 * 0.15 +
      70 * 0.10, // assume medium quality
    );

    const tamperingSignals: string[] = visionJson.tampering_signals || [];
    const hasCriticalFindingsDeep = validationReasons.some(r => r.startsWith('✗ Tampering:')) || tamperingSignals.length > 0;
    logger.info(`[OCR] Deep recheck completed for document ${documentId} (kycScore: ${kycScore}, tamper: ${hasCriticalFindingsDeep}) — awaiting HR approval`);

    // Sync tamper findings back to the Document record so HR dashboard reflects deep recheck results
    if (hasCriticalFindingsDeep) {
      await prisma.document.update({
        where: { id: documentId },
        data: {
          tamperDetected: true,
          tamperDetails: tamperingSignals.join('; ') || 'Tampering signals detected by deep recheck (gpt-4.1)',
          status: 'FLAGGED',
        },
      }).catch((err: any) => { logger.warn(`[OCR] Failed to flag document ${documentId} after deep recheck:`, err.message); });
    }

    const updated = await prisma.documentOcrVerification.update({
      where: { documentId },
      data: {
        confidence,
        extractedName: vfName || undefined,
        extractedDob: vfDob || undefined,
        extractedDocNumber: vfDocNum || undefined,
        hrReviewedBy: requestedBy,
        hrReviewedAt: new Date(),
        kycScore,
        profileComparison: profileComparison.length > 0 ? profileComparison as any : undefined,
        llmExtractedData: {
          validation_reasons: validationReasons,
          findings: visionJson.findings || [],
          authenticity_checks: visionJson.authenticity_checks || null,
          tampering_signals: visionJson.tampering_signals || [],
          recommended_status: visionJson.recommended_status || 'NEEDS_HR_REVIEW',
          modelUsed: 'gpt-4.1',
          deepRecheckAvailable: false,
          vision_scanned: true,
          ai_enhanced: true,
          authenticity_score: confidence,
        } as any,
      },
    });

    await createAuditLog({
      userId: requestedBy,
      organizationId,
      entity: 'DocumentOcrVerification',
      entityId: documentId,
      action: 'DEEP_RECHECK',
      newValue: { modelUsed: 'gpt-4.1', kycScore } as any,
    });

    return updated;
  }

  /**
   * Bulk-trigger OCR for all of an employee's documents (always re-runs regardless of prior confidence).
   * After queuing all docs, fires cross-validation so cross-doc results are always current.
   */
  async triggerAllForEmployee(employeeId: string, organizationId: string) {
    const docs = await prisma.document.findMany({
      where: { employeeId, deletedAt: null, employee: { organizationId } },
    });

    const { enqueueDocumentOcr } = await import('../../jobs/queues.js');
    for (const doc of docs) {
      await enqueueDocumentOcr(doc.id, organizationId);
    }

    // Cross-validation is fired by the BullMQ worker after each individual job completes,
    // so the final job completion yields fully up-to-date cross-validation results.
    // Firing it here (before jobs run) would compare stale OCR data and is counterproductive.

    return { triggered: docs.length, total: docs.length };
  }

  /**
   * Get all OCR verifications for an employee.
   */
  async getEmployeeOcrSummary(employeeId: string, organizationId: string) {
    const docs = await prisma.document.findMany({
      where: { employeeId, deletedAt: null, employee: { organizationId } },
      include: {
        ocrVerification: {
          select: {
            id: true,
            documentId: true,
            confidence: true,
            ocrStatus: true,
            detectedType: true,
            extractedName: true,
            extractedDob: true,
            extractedDocNumber: true,
            extractedFatherName: true,
            extractedGender: true,
            extractedAddress: true,
            kycScore: true,
            crossValidationStatus: true,
            crossValidationDetails: true,
            isScreenshot: true,
            tamperingIndicators: true,
            resolutionQuality: true,
            processingMode: true,
            hrReviewedAt: true,
            llmExtractedData: true, // needed for validation_reasons, findings, modelUsed on inline cards
            profileComparison: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return docs.map(d => ({
      documentId: d.id,
      documentName: d.name,
      documentType: d.type,
      fileUrl: d.fileUrl,
      status: d.status,
      rejectionReason: d.rejectionReason,
      ocr: d.ocrVerification || null,
    }));
  }

  /**
   * Force-reprocess an existing document through the full OCR pipeline.
   * Used by HR when findings are stale (node_fallback, >30 days old) or when
   * a document needs to be re-analysed after OCR improvements were deployed.
   *
   * Clears the existing ocrStatus to PENDING and re-runs triggerOcr.
   * This is distinct from deepRecheck (gpt-4.1 only) — reprocess runs
   * the full pipeline: Python → Vision → LLM enhancement → format validation.
   */
  async reprocessDocument(documentId: string, requestedBy: string, organizationId: string) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, employee: { organizationId } },
    });
    if (!doc) throw new NotFoundError('Document');

    // Reset status so re-run stores fresh results rather than partial merges
    await prisma.documentOcrVerification.updateMany({
      where: { documentId },
      data: { ocrStatus: 'PENDING', processingMode: 'python_advanced' },
    });

    await createAuditLog({
      userId: requestedBy,
      organizationId,
      entity: 'DocumentOcrVerification',
      entityId: documentId,
      action: 'REPROCESS',
      newValue: { triggeredBy: requestedBy } as any,
    });

    return this.triggerOcr(documentId, organizationId);
  }

  /**
   * Auto-approve KYC gate if all of the employee's active documents are now VERIFIED.
   * Called after a document is auto-verified (kycScore ≥ 90). Non-blocking — errors are
   * caught by the caller. Skips employees whose gate is already VERIFIED or not yet SUBMITTED.
   */
  private async checkAutoApproveKyc(employeeId: string, organizationId: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) return;
    // Only auto-approve when employee has submitted and is awaiting HR review
    if (!['SUBMITTED', 'PENDING_HR_REVIEW'].includes(gate.kycStatus)) return;

    // Check that every individually-processed active document is VERIFIED.
    // Combined KYC PDFs (type=OTHER, name contains "combined"/"kyc") use a different review
    // pipeline — they're never individually VERIFIED, so exclude them from this check.
    const activeDocs = await prisma.document.findMany({
      where: { employeeId, deletedAt: null },
      select: { status: true, type: true, name: true },
    });
    const checkableDocs = activeDocs.filter(d => {
      if (d.type !== 'OTHER') return true;
      const n = (d.name || '').toLowerCase();
      return !n.includes('combined') && !n.includes('kyc');
    });
    if (checkableDocs.length === 0) return;
    const allVerified = checkableDocs.every(d => d.status === 'VERIFIED');
    if (!allVerified) return;

    // Fetch employee to get userId (socket rooms are keyed by userId, not employeeId)
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true, firstName: true, lastName: true, user: { select: { email: true } } },
    });
    if (!emp) return;

    logger.info(`[OCR] All documents VERIFIED for employee ${employeeId} — auto-approving KYC gate`);

    await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: 'system-auto-verify',
        rejectionReason: null,
        reuploadRequested: false,
      },
    });

    // Emit real-time event — socket rooms are user:${userId}, not employeeId
    const { emitToUser } = await import('../../sockets/index.js');
    if (emp.userId) emitToUser(emp.userId, 'kyc:status-changed', { kycStatus: 'VERIFIED', autoApproved: true });

    // Congratulations email
    try {
      if (emp?.user?.email) {
        const { enqueueEmail } = await import('../../jobs/queues.js');
        await enqueueEmail({
          to: emp.user.email,
          subject: '✅ KYC Verified — Your Aniston HRMS Portal Access is Now Active',
          template: 'kyc-verified',
          context: {
            employeeName: [emp.firstName, emp.lastName].filter(Boolean).join(' ') || 'Employee',
            verifiedAt: new Date().toLocaleDateString('en-IN', { dateStyle: 'long' }),
          },
        });
      }
    } catch { /* non-blocking */ }

    // Auto-fill employee profile from verified OCR data
    try {
      const { documentService } = await import('../document/document.service.js');
      const verifiedDocs = await prisma.document.findMany({
        where: { employeeId, deletedAt: null, status: 'VERIFIED' },
        select: { id: true },
      });
      for (const d of verifiedDocs) {
        await documentService.autoFillFromOcr(d.id, employeeId, 'system-auto-verify', organizationId).catch(() => {});
      }
    } catch { /* non-blocking */ }
  }

  /**
   * Snapshot existing OCR verification to history before a re-run.
   * Call this before any upsert that would overwrite a previous result.
   */
  async snapshotOcrToHistory(documentId: string, organizationId: string, triggerReason = 'retrigger') {
    try {
      const existing = await prisma.documentOcrVerification.findUnique({ where: { documentId } });
      if (!existing) return;
      await (prisma as any).documentOcrVerificationHistory.create({
        data: {
          documentId,
          organizationId,
          ocrStatus: existing.ocrStatus,
          confidence: existing.confidence,
          kycScore: existing.kycScore,
          extractedName: existing.extractedName,
          extractedDob: existing.extractedDob,
          extractedDocNumber: existing.extractedDocNumber,
          processingMode: existing.processingMode,
          llmExtractedData: existing.llmExtractedData as any,
          triggerReason,
        },
      });
    } catch (err: any) {
      logger.warn(`[OCR] Failed to snapshot history for ${documentId}: ${err.message}`);
    }
  }

  /**
   * Get OCR verification history for a document (most recent first).
   */
  async getOcrHistory(documentId: string, organizationId: string) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, employee: { organizationId } },
    });
    if (!doc) throw new NotFoundError('Document');

    return (prisma as any).documentOcrVerificationHistory.findMany({
      where: { documentId },
      orderBy: { snapshotAt: 'desc' },
      take: 20,
    });
  }

  /**
   * Compare faces between the employee's PHOTO and their Aadhaar card image.
   * Stores result in both docs' ocrVerification.faceMatchResult and in the gate.
   */
  async compareFacesForEmployee(employeeId: string, organizationId: string) {
    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];

    const [photoDoc, aadhaarDoc] = await Promise.all([
      prisma.document.findFirst({
        where: { employeeId, type: 'PHOTO', deletedAt: null, employee: { organizationId } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.document.findFirst({
        where: { employeeId, type: 'AADHAAR', deletedAt: null, employee: { organizationId } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!photoDoc || !aadhaarDoc) {
      logger.info(`[Face] Skipping face compare for ${employeeId} — missing PHOTO or AADHAAR`);
      return null;
    }

    let basePath = process.cwd();
    if (basePath.endsWith('backend') || basePath.endsWith('backend/') || basePath.endsWith('backend\\')) {
      basePath = join(basePath, '..');
    }

    const photoExt = photoDoc.fileUrl.split('.').pop()?.toLowerCase() || '';
    const aadhaarExt = aadhaarDoc.fileUrl.split('.').pop()?.toLowerCase() || '';

    if (!imageExts.includes(photoExt) || !imageExts.includes(aadhaarExt)) {
      logger.info(`[Face] Skipping face compare — non-image file type (photo: ${photoExt}, aadhaar: ${aadhaarExt})`);
      await prisma.onboardingDocumentGate.updateMany({
        where: { employeeId },
        data: { faceMatchStatus: 'SKIPPED' },
      });
      return null;
    }

    let photoBuffer: Buffer, aadhaarBuffer: Buffer;
    try {
      photoBuffer = readFileSync(join(basePath, photoDoc.fileUrl));
      aadhaarBuffer = readFileSync(join(basePath, aadhaarDoc.fileUrl));
    } catch (err: any) {
      logger.warn(`[Face] Could not read files for comparison: ${err.message}`);
      return null;
    }

    const photo1Base64 = photoBuffer.toString('base64');
    const photo2Base64 = aadhaarBuffer.toString('base64');
    const mime1 = `image/${photoExt === 'jpg' ? 'jpeg' : photoExt}`;
    const mime2 = `image/${aadhaarExt === 'jpg' ? 'jpeg' : aadhaarExt}`;

    const result = await aiService.compareFaces(photo1Base64, mime1, photo2Base64, mime2, organizationId);

    logger.info(`[Face] Compare for ${employeeId}: match=${result.match}, confidence=${result.confidence}`);

    // Store on gate
    await prisma.onboardingDocumentGate.updateMany({
      where: { employeeId },
      data: {
        faceMatchStatus: result.match ? 'MATCH' : result.confidence === 0 ? 'SKIPPED' : 'MISMATCH',
        faceMatchScore: result.confidence,
      },
    });

    // Store on both document OCR verifications for display in HR panel
    await Promise.allSettled([
      prisma.documentOcrVerification.updateMany({
        where: { documentId: photoDoc.id },
        data: { faceMatchResult: result as any },
      }),
      prisma.documentOcrVerification.updateMany({
        where: { documentId: aadhaarDoc.id },
        data: { faceMatchResult: result as any },
      }),
    ]);

    // If mismatch with high confidence, emit alert to org HR
    if (!result.match && result.confidence >= 0.7) {
      try {
        const { emitToOrg } = await import('../../sockets/index.js');
        const emp = await prisma.employee.findUnique({
          where: { id: employeeId },
          select: { firstName: true, lastName: true, employeeCode: true },
        });
        emitToOrg(organizationId, 'kyc:face-mismatch', {
          employeeId,
          employeeName: `${emp?.firstName} ${emp?.lastName}`,
          employeeCode: emp?.employeeCode,
          confidence: result.confidence,
          reason: result.reason,
        });
        logger.warn(`[Face] MISMATCH alert emitted for ${employeeId}: ${result.reason}`);
      } catch { /* non-blocking */ }
    }

    return result;
  }

  /**
   * Org-wide bulk OCR trigger — queues all SUBMITTED / PENDING_HR_REVIEW employees' docs.
   * Rate limited to once per 15 minutes per org via Redis.
   */
  async orgBulkTrigger(organizationId: string): Promise<{ queued: number; employees: number }> {
    const gates = await prisma.onboardingDocumentGate.findMany({
      where: {
        kycStatus: { in: ['SUBMITTED', 'PENDING_HR_REVIEW', 'REUPLOAD_REQUIRED'] },
        employee: { organizationId },
      },
      select: { employeeId: true },
    });

    const docs = await prisma.document.findMany({
      where: {
        employeeId: { in: gates.map(g => g.employeeId) },
        deletedAt: null,
        employee: { organizationId },
      },
      select: { id: true, employeeId: true },
    });

    const { enqueueDocumentOcr } = await import('../../jobs/queues.js');
    for (const doc of docs) {
      await enqueueDocumentOcr(doc.id, organizationId);
    }

    logger.info(`[OCR] Org-wide bulk trigger: ${docs.length} docs across ${gates.length} employees in org ${organizationId}`);
    return { queued: docs.length, employees: gates.length };
  }

  /**
   * HR approves an individual document.
   */
  async hrApproveDocument(documentId: string, reviewerId: string, organizationId: string) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, employee: { organizationId }, deletedAt: null },
    });
    if (!doc) throw new NotFoundError('Document');

    await prisma.$transaction([
      prisma.document.update({
        where: { id: documentId },
        data: { status: 'VERIFIED', verifiedBy: reviewerId, verifiedAt: new Date() },
      }),
      prisma.documentOcrVerification.updateMany({
        where: { documentId },
        data: { ocrStatus: 'VERIFIED', hrReviewedBy: reviewerId, hrReviewedAt: new Date() },
      }),
    ]);

    await createAuditLog({
      userId: reviewerId, organizationId,
      entity: 'Document', entityId: documentId,
      action: 'HR_APPROVED', newValue: { status: 'VERIFIED' } as any,
    });

    // Check if all docs are now verified → auto-approve KYC gate
    if (doc.employeeId) {
      this.checkAutoApproveKyc(doc.employeeId, organizationId).catch(() => {});
    }

    return { success: true };
  }

  /**
   * HR rejects an individual document with a reason.
   */
  async hrRejectDocument(documentId: string, reason: string, reviewerId: string, organizationId: string) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, employee: { organizationId }, deletedAt: null },
      include: { employee: { select: { id: true, userId: true, organizationId: true } } },
    });
    if (!doc) throw new NotFoundError('Document');

    await prisma.$transaction([
      prisma.document.update({
        where: { id: documentId },
        data: { status: 'REJECTED', rejectionReason: reason, verifiedBy: reviewerId },
      }),
      prisma.documentOcrVerification.updateMany({
        where: { documentId },
        data: { ocrStatus: 'FLAGGED', hrNotes: reason, hrReviewedBy: reviewerId, hrReviewedAt: new Date() },
      }),
    ]);

    await createAuditLog({
      userId: reviewerId, organizationId,
      entity: 'Document', entityId: documentId,
      action: 'HR_REJECTED', newValue: { status: 'REJECTED', reason } as any,
    });

    // Notify employee via in-app notification
    if (doc.employee?.userId) {
      const { enqueueNotification } = await import('../../jobs/queues.js');
      await enqueueNotification({
        userId: doc.employee.userId,
        organizationId,
        title: 'Document Rejected',
        message: `Your ${doc.type.replace(/_/g, ' ')} was rejected: ${reason}. Please re-upload.`,
        type: 'DOCUMENT_FLAGGED',
        link: '/kyc-pending',
      });
    }

    return { success: true };
  }
}

export const documentOcrService = new DocumentOcrService();
