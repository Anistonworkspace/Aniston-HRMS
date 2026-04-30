import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { emitToOrg, emitToUser } from '../../sockets/index.js';
import { logger } from '../../lib/logger.js';
import { enqueueEmail } from '../../jobs/queues.js';

// =====================
// CONSTANTS
// =====================

export const IDENTITY_PROOF_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];
export const EMPLOYMENT_PROOF_TYPES = ['EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'OFFER_LETTER_DOC', 'SALARY_SLIP_DOC'];

// Education levels ordered lowest → highest
const QUALIFICATION_ORDER = ['TENTH', 'TWELFTH', 'GRADUATION', 'POST_GRADUATION', 'PHD'];

// Document type label map for human-readable messages
const DOC_LABELS: Record<string, string> = {
  PAN: 'PAN Card',
  AADHAAR: 'Aadhaar Card',
  PASSPORT: 'Passport',
  DRIVING_LICENSE: 'Driving License',
  VOTER_ID: 'Voter ID',
  TENTH_CERTIFICATE: '10th Marksheet / Certificate',
  TWELFTH_CERTIFICATE: '12th Marksheet / Certificate',
  DEGREE_CERTIFICATE: 'Graduation / Degree Certificate',
  POST_GRADUATION_CERTIFICATE: 'Post-Graduation Certificate',
  PHOTO: 'Passport Size Photograph',
  RESIDENCE_PROOF: 'Residence Proof',
  EXPERIENCE_LETTER: 'Experience / Relieving Letter',
  RELIEVING_LETTER: 'Relieving Letter',
  OFFER_LETTER_DOC: 'Appointment / Offer Letter',
  SALARY_SLIP_DOC: 'Salary Slips',
  BANK_STATEMENT: 'Bank Statement',
  CANCELLED_CHEQUE: 'Cancelled Cheque',
};

// =====================
// DYNAMIC REQUIRED DOCS COMPUTATION
// =====================

/**
 * Compute which document types are required given fresher/experienced status and highest qualification.
 * Returns the minimal set that MUST be submitted (excluding identity proof — that is handled as "any one").
 * Identity proof requirement is tracked separately via the `needsIdentityProof` flag in the result.
 */
export function computeRequiredDocs(
  fresherOrExperienced: string,
  highestQualification: string
): { requiredDocs: string[]; needsIdentityProof: boolean; needsEmploymentProof: boolean } {
  const required: string[] = ['PAN', 'PHOTO', 'RESIDENCE_PROOF', 'CANCELLED_CHEQUE'];

  // Education chain — always require all levels up to and including highest
  const qualIdx = QUALIFICATION_ORDER.indexOf(highestQualification);

  if (qualIdx >= 0) required.push('TENTH_CERTIFICATE');           // Tenth required for all
  if (qualIdx >= 1) required.push('TWELFTH_CERTIFICATE');          // Twelfth if 12th+
  if (qualIdx >= 2) required.push('DEGREE_CERTIFICATE');           // Degree if graduation+
  if (qualIdx >= 3) required.push('POST_GRADUATION_CERTIFICATE');  // PG if PG+
  // PhD doc not a standard DocumentType enum — falls under DEGREE_CERTIFICATE or OTHER

  const needsEmploymentProof = fresherOrExperienced === 'EXPERIENCED';
  // Employment proof is expected but not hard-blocked (handled as "at least one of" in submission check)

  return {
    requiredDocs: required,
    needsIdentityProof: true, // always require at least one identity proof
    needsEmploymentProof,
  };
}

/**
 * Human-readable label for a required doc type.
 */
export function docLabel(docType: string): string {
  return DOC_LABELS[docType] || docType.replace(/_/g, ' ');
}

// =====================
// SERVICE CLASS
// =====================

export class DocumentGateService {
  async createGate(employeeId: string, requiredDocs?: string[]) {
    const existing = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (existing) return existing;

    return prisma.onboardingDocumentGate.create({
      data: {
        employeeId,
        requiredDocs: (requiredDocs || ['PAN', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO', 'CANCELLED_CHEQUE']) as any,
      },
    });
  }

  async getGate(employeeId: string) {
    return prisma.onboardingDocumentGate.findUnique({
      where: { employeeId },
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
      },
    });
  }

  /**
   * Save initial KYC configuration: upload mode, fresher/experienced, highest qualification.
   * This recomputes and stores the required docs list for that employee.
   */
  async saveKycConfig(
    employeeId: string,
    uploadMode: string,
    fresherOrExperienced: string,
    highestQualification: string
  ) {
    // Validate inputs
    if (!['COMBINED', 'SEPARATE'].includes(uploadMode)) {
      throw new BadRequestError('uploadMode must be COMBINED or SEPARATE');
    }
    if (!['FRESHER', 'EXPERIENCED'].includes(fresherOrExperienced)) {
      throw new BadRequestError('fresherOrExperienced must be FRESHER or EXPERIENCED');
    }
    if (!QUALIFICATION_ORDER.includes(highestQualification)) {
      throw new BadRequestError(`highestQualification must be one of: ${QUALIFICATION_ORDER.join(', ')}`);
    }

    // Compute required docs
    const { requiredDocs } = computeRequiredDocs(fresherOrExperienced, highestQualification);

    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) {
      return prisma.onboardingDocumentGate.create({
        data: {
          employeeId,
          requiredDocs: requiredDocs as any,
          uploadMode,
          fresherOrExperienced,
          highestQualification,
        },
      });
    }

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        uploadMode,
        fresherOrExperienced,
        highestQualification,
        requiredDocs: requiredDocs as any,
        // Reset submission state if config changes
        kycStatus: gate.kycStatus === 'PENDING' ? 'PENDING' : gate.kycStatus,
      },
    });
  }

  async checkDocumentSubmission(employeeId: string, documentType: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) return;

    // Add to submittedDocs if not already there
    const submitted = [...(gate.submittedDocs as string[])];
    if (!submitted.includes(documentType as any)) {
      submitted.push(documentType as any);
    }

    const allSubmitted = gate.requiredDocs.every((doc: any) => submitted.includes(doc));

    // If this doc was flagged for re-upload, clear it now that a new one was uploaded
    const prevReuploadTypes = (gate.reuploadDocTypes as string[]) || [];
    const newReuploadTypes = prevReuploadTypes.filter(t => t !== documentType);
    if (prevReuploadTypes.includes(documentType)) {
      logger.info(`[KYC] Re-upload completed — employee: ${employeeId}, docType: ${documentType}, remaining flagged: ${newReuploadTypes.length}`);
    }

    // Clear the rejection reason for this specific doc type
    const prevReasons = ((gate.documentRejectReasons as Record<string, string>) || {});
    const newReasons = { ...prevReasons };
    delete newReasons[documentType];

    // If all flagged docs are now re-uploaded, advance status back to SUBMITTED
    // so HR gets notified to review again. Otherwise keep REUPLOAD_REQUIRED.
    let newStatus = gate.kycStatus;
    if (gate.kycStatus === 'REUPLOAD_REQUIRED') {
      newStatus = newReuploadTypes.length === 0 ? 'SUBMITTED' : 'REUPLOAD_REQUIRED';
    }

    await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        submittedDocs: submitted as any,
        allSubmitted,
        reuploadDocTypes: newReuploadTypes as any,
        documentRejectReasons: newReasons as any,
        ...(newReuploadTypes.length === 0 && { reuploadRequested: false }),
        kycStatus: newStatus as any,
      },
    });

    // Emit real-time update if status changed
    if (newStatus !== gate.kycStatus) {
      await this.emitKycUpdate(employeeId, newStatus);
    }

    return {
      allSubmitted,
      submitted: submitted.length,
      required: gate.requiredDocs.length,
      reuploadCleared: prevReuploadTypes.includes(documentType),
      remainingReupload: newReuploadTypes.length,
    };
  }

  async unlockOfferLetter(employeeId: string, unlockedBy: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        offerLetterUnlocked: true,
        unlockedAt: new Date(),
        unlockedBy,
      },
    });
  }

  // ==================
  // KYC METHODS
  // ==================

  async saveKycPhoto(employeeId: string, photoUrl: string) {
    // Also set employee avatar so it shows in sidebar/topbar
    try {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { avatar: photoUrl },
      });
    } catch { /* non-blocking */ }

    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) {
      return prisma.onboardingDocumentGate.create({
        data: {
          employeeId,
          requiredDocs: ['PAN', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO', 'CANCELLED_CHEQUE'] as any,
          photoUrl,
        },
      });
    }

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: { photoUrl },
    });
  }

  /**
   * Employee submits KYC for HR review.
   * Validates that required docs are uploaded based on their profile config.
   */
  async submitKyc(employeeId: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    const submitted = gate.submittedDocs as string[];
    const fresher = gate.fresherOrExperienced || 'FRESHER';
    const qualification = gate.highestQualification || 'GRADUATION';
    const uploadMode = gate.uploadMode || 'SEPARATE';

    // Block submission while combined PDF classification is still running.
    // This is the server-side guard — the frontend also disables the button,
    // but this prevents a race condition if the UI guard is bypassed.
    if (gate.kycStatus === 'PROCESSING') {
      throw new BadRequestError('Your documents are still being classified by OCR. Please wait a moment, then try again.');
    }

    // Photo is always required
    const hasPhoto = !!gate.photoUrl || submitted.includes('PHOTO');
    if (!hasPhoto) {
      throw new BadRequestError('Please upload your passport size photograph before submitting.');
    }

    if (uploadMode === 'COMBINED') {
      // Combined mode: need combined PDF + photo + cancelled cheque
      if (!gate.combinedPdfUploaded) {
        throw new BadRequestError('Please upload your combined PDF before submitting.');
      }
      if (!submitted.includes('CANCELLED_CHEQUE')) {
        throw new BadRequestError('Please upload a Cancelled Cheque before submitting. This is required for payroll processing.');
      }

      // Enforce employment proof for EXPERIENCED employees — same rule as SEPARATE mode.
      if (fresher === 'EXPERIENCED' && !EMPLOYMENT_PROOF_TYPES.some(t => submitted.includes(t))) {
        throw new BadRequestError(
          'As an experienced employee, please upload at least one employment proof separately (Experience Letter, Relieving Letter, Offer Letter, or Salary Slips) before submitting.'
        );
      }

      // If classification ran but detected 0 document types, add a system note to HR review.
      // We still allow submission — HR can manually review. But they need a clear warning.
      const analysis = gate.combinedPdfAnalysis as any;
      const classificationRan = analysis && !analysis.error && analysis._source !== 'manual_review';
      const detectedDocsCount = (analysis?.detectedDocs ?? analysis?.detected_docs ?? []).length;
      const hrSystemNote = classificationRan && detectedDocsCount === 0
        ? '[System] Combined PDF was processed but 0 document types were detected. ' +
          'The PDF may be image-only without embedded text, very low quality, or the wrong file. ' +
          'HR should request re-upload unless documents can be verified by opening the PDF manually.'
        : null;

      const updateData: any = { kycStatus: 'SUBMITTED' };
      if (hrSystemNote) {
        updateData.hrReviewNotes = (gate.hrReviewNotes ? gate.hrReviewNotes + '\n' : '') + hrSystemNote;
      }

      const updated = await prisma.onboardingDocumentGate.update({
        where: { employeeId },
        data: updateData,
      });
      await this.emitKycUpdate(employeeId, 'SUBMITTED');
      setImmediate(() => {
        this._notifyHrKycSubmitted(employeeId).catch((err) =>
          logger.warn('[KYC] HR notification failed:', err),
        );
      });
      return updated;
    }

    // Separate mode: validate required docs
    const { requiredDocs, needsIdentityProof, needsEmploymentProof } = computeRequiredDocs(fresher, qualification);
    const missing: string[] = [];

    for (const docType of requiredDocs) {
      if (docType === 'PHOTO') continue; // already checked above
      if (!submitted.includes(docType)) {
        missing.push(docLabel(docType));
      }
    }

    // Identity proof — at least one of the allowed types
    if (needsIdentityProof) {
      const hasIdentity = IDENTITY_PROOF_TYPES.some(t => submitted.includes(t));
      if (!hasIdentity) {
        missing.push('Identity Proof (Aadhaar Card, Passport, Driving License, or Voter ID)');
      }
    }

    // Employment proof — hard-blocked for experienced employees (same rule as COMBINED mode)
    if (needsEmploymentProof && !EMPLOYMENT_PROOF_TYPES.some(t => submitted.includes(t))) {
      throw new BadRequestError(
        'As an experienced employee, please upload at least one employment proof ' +
        '(Experience Letter, Relieving Letter, Offer Letter, or Salary Slips) before submitting.',
      );
    }

    if (missing.length > 0) {
      throw new BadRequestError(`Missing required documents: ${missing.join(', ')}`);
    }

    const updatedData: any = { kycStatus: 'SUBMITTED' };

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: updatedData,
    });
    await this.emitKycUpdate(employeeId, 'SUBMITTED');

    // Notify HR that this employee has submitted documents for review — non-blocking
    setImmediate(() => {
      this._notifyHrKycSubmitted(employeeId).catch((err) =>
        logger.warn('[KYC] HR notification failed:', err),
      );
    });

    return updated;
  }

  private async _notifyHrKycSubmitted(employeeId: string) {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, employeeCode: true, organizationId: true },
    });
    if (!emp) return;

    const org = await prisma.organization.findUnique({
      where: { id: emp.organizationId },
      select: { name: true, adminNotificationEmail: true },
    });
    if (!org?.adminNotificationEmail) return;

    await enqueueEmail({
      to: org.adminNotificationEmail,
      subject: `KYC Submitted — ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
      template: 'document-submitted',
      context: {
        employeeName: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeCode,
        documentType: 'KYC_SUBMISSION',
        documentName: 'All KYC documents submitted for review',
        orgName: org.name,
        reviewUrl: `https://hr.anistonav.com/employees/${employeeId}?tab=documents`,
      },
    });
  }

  /**
   * Emit real-time socket event when KYC status changes.
   */
  private async emitKycUpdate(employeeId: string, status: string, trigger?: 'rejection' | 'deletion') {
    try {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { organizationId: true, firstName: true, lastName: true, employeeCode: true, userId: true },
      });
      if (emp) {
        const payload: Record<string, any> = {
          employeeId,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          employeeCode: emp.employeeCode,
          status,
          ...(trigger ? { trigger } : {}),
        };
        emitToOrg(emp.organizationId, 'kyc:status-changed', payload);
        if (emp.userId && (status === 'VERIFIED' || status === 'REUPLOAD_REQUIRED')) {
          emitToUser(emp.userId, 'kyc:status-changed', payload);
        }
      }
    } catch (err) {
      logger.warn('Failed to emit KYC socket event:', err);
    }
  }

  async setCombinedPdfUploaded(employeeId: string, analysisResult?: any) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    const updateData: any = { combinedPdfUploaded: true };
    if (analysisResult) {
      updateData.combinedPdfAnalysis = analysisResult;
    }

    if (!gate) {
      return prisma.onboardingDocumentGate.create({
        data: {
          employeeId,
          requiredDocs: ['PAN', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO', 'CANCELLED_CHEQUE'] as any,
          ...updateData,
        },
      });
    }
    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: updateData,
    });
  }

  /**
   * Set the kycStatus and processingMode after combined PDF classification completes.
   * Called from onboarding.routes.ts after Python or Node.js fallback classification.
   */
  async setCombinedPdfClassified(
    employeeId: string,
    opts: {
      analysisResult: any;
      processingMode: 'PYTHON_ADVANCED' | 'NODE_FALLBACK' | 'MANUAL_REVIEW_ONLY';
      fallbackUsed: boolean;
      missingDocuments?: string[];
      duplicateDocuments?: string[];
      employeeVisibleReasons?: string[];
    }
  ) {
    // After OCR classification completes, set status back to PENDING so the employee
    // can review the identified documents and explicitly click "Submit for HR Review".
    // We do NOT auto-submit here — that happens only when the employee calls submitKyc().
    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'PENDING',
        combinedPdfAnalysis: opts.analysisResult,
        processingMode: opts.processingMode,
        fallbackUsed: opts.fallbackUsed,
        missingDocuments: (opts.missingDocuments || []) as any,
        duplicateDocuments: (opts.duplicateDocuments || []) as any,
        employeeVisibleReasons: (opts.employeeVisibleReasons || []) as any,
      },
    });

    // Push real-time notification to the employee so their page refreshes immediately
    // without waiting for the 3-second polling cycle.
    await this.emitKycUpdate(employeeId, 'PENDING');

    return updated;
  }

  async verifyKyc(employeeId: string, verifiedBy: string, organizationId?: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    // === DOCUMENT COMPLETENESS GUARD ===
    const submitted = gate.submittedDocs as string[];
    const uploadMode = gate.uploadMode || 'SEPARATE';

    const hasPhoto = !!gate.photoUrl || submitted.includes('PHOTO');
    if (!hasPhoto) {
      throw new BadRequestError('Cannot approve: Employee has not uploaded their passport photograph.');
    }

    // Cancelled Cheque is mandatory for all employees regardless of upload mode
    if (!submitted.includes('CANCELLED_CHEQUE')) {
      throw new BadRequestError('Cannot approve: Cancelled Cheque is required for payroll processing. Employee must upload a cancelled cheque of their salary account.');
    }

    if (uploadMode === 'COMBINED') {
      if (!gate.combinedPdfUploaded) {
        throw new BadRequestError('Cannot approve: Employee has not uploaded their combined document PDF.');
      }
    } else {
      const fresher = gate.fresherOrExperienced || 'FRESHER';
      const qualification = gate.highestQualification || 'GRADUATION';
      const { requiredDocs, needsIdentityProof, needsEmploymentProof } = computeRequiredDocs(fresher, qualification);
      const missingDocs: string[] = [];

      for (const docType of requiredDocs) {
        if (docType === 'PHOTO') continue;
        if (!submitted.includes(docType)) missingDocs.push(docLabel(docType));
      }
      if (needsIdentityProof && !IDENTITY_PROOF_TYPES.some(t => submitted.includes(t))) {
        missingDocs.push('Identity Proof (Aadhaar, Passport, Driving License, or Voter ID)');
      }
      if (needsEmploymentProof && !EMPLOYMENT_PROOF_TYPES.some(t => submitted.includes(t))) {
        missingDocs.push('Employment Proof (Experience Letter, Relieving Letter, Offer Letter, or Salary Slips)');
      }
      if (missingDocs.length > 0) {
        throw new BadRequestError(`Cannot approve: Missing required documents — ${missingDocs.join(', ')}`);
      }
    }

    // Block if any active document is still REJECTED (employee must re-upload first)
    const rejectedDocs = await prisma.document.findMany({
      where: { employeeId, status: 'REJECTED', deletedAt: null },
      select: { name: true, type: true },
    });
    if (rejectedDocs.length > 0) {
      const names = rejectedDocs.map((d: any) => d.name || docLabel(String(d.type))).join(', ');
      throw new BadRequestError(`Cannot approve: The following documents need re-upload — ${names}`);
    }
    // === END GUARD ===

    const verifiedAt = new Date();
    const kycExpiresAt = new Date(verifiedAt.getTime() + 365 * 24 * 3600 * 1000); // 1 year

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'VERIFIED',
        verifiedAt,
        verifiedBy,
        rejectionReason: null,
        reuploadRequested: false,
        kycExpiresAt,
      },
    });

    // Auto-fill employee profile fields from approved OCR data.
    // Only runs on VERIFIED documents — never on FLAGGED/PENDING to avoid pushing bad data.
    if (organizationId) {
      try {
        const { documentService } = await import('../document/document.service.js');
        const docs = await prisma.document.findMany({
          where: { employeeId, deletedAt: null, status: 'VERIFIED' },
          select: { id: true },
        });
        for (const doc of docs) {
          try {
            await documentService.autoFillFromOcr(doc.id, employeeId, verifiedBy, organizationId);
          } catch { /* skip individual doc errors */ }
        }
        logger.info(`[KYC] autoFillFromOcr ran for ${docs.length} VERIFIED document(s) for employee ${employeeId}`);
      } catch (err: any) {
        logger.warn(`[KYC] autoFillFromOcr failed for employee ${employeeId}: ${err.message}`);
      }
    }

    await this.emitKycUpdate(employeeId, 'VERIFIED');

    // Send KYC approval congratulations email (non-blocking)
    try {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, organizationId: true, firstName: true, lastName: true, user: { select: { email: true } } },
      });
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
    } catch (emailErr: any) {
      logger.warn(`[KYC] Failed to send KYC-verified email for ${employeeId}: ${emailErr.message}`);
    }

    return updated;
  }

  async rejectKyc(employeeId: string, reason: string, rejectedBy: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'REJECTED',
        rejectionReason: reason,
        verifiedBy: rejectedBy,
      },
    });
    await this.emitKycUpdate(employeeId, 'REJECTED');

    // Send rejection email to employee (non-blocking)
    try {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { user: { select: { email: true } } },
      });
      if (emp?.user?.email) {
        const { enqueueEmail } = await import('../../jobs/queues.js');
        await enqueueEmail({
          to: emp.user.email,
          subject: 'KYC Verification — Action Required',
          template: 'kyc-rejected',
          context: {
            employeeName: [emp.firstName, emp.lastName].filter(Boolean).join(' ') || 'Employee',
            rejectionReason: reason,
            rejectedAt: new Date().toLocaleDateString('en-IN', { dateStyle: 'long' }),
          },
        });
      }
    } catch { /* non-blocking — email failure must not break rejection */ }

    return updated;
  }

  /**
   * HR requests re-upload of specific document types.
   * Sets kycStatus back to REUPLOAD_REQUIRED and records which docs need re-upload.
   */
  async requestReupload(
    employeeId: string,
    docTypes: string[],
    reasons: Record<string, string>,
    requestedBy: string
  ) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'REUPLOAD_REQUIRED',
        reuploadRequested: true,
        reuploadDocTypes: docTypes,
        documentRejectReasons: reasons,
        verifiedBy: requestedBy,
      },
    });
    await this.emitKycUpdate(employeeId, 'REUPLOAD_REQUIRED');

    // Notify employee via socket
    try {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, organizationId: true },
      });
      if (emp?.userId) {
        const { enqueueNotification } = await import('../../jobs/queues.js');
        await enqueueNotification({
          userId: emp.userId,
          organizationId: emp.organizationId,
          title: 'Re-upload Required',
          message: `HR has requested you re-upload: ${docTypes.map(t => docLabel(t)).join(', ')}`,
          type: 'DOCUMENT_FLAGGED',
          link: '/kyc-pending',
        });
      }
    } catch { /* non-blocking */ }

    return updated;
  }

  /**
   * HR updates internal review notes.
   * The reviewerId is persisted in verifiedBy so there is an audit trail of
   * who last touched the notes, even before a final verify/reject action.
   */
  async updateHrNotes(employeeId: string, notes: string, reviewerId: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        hrReviewNotes: notes,
        // Track who last updated notes — does not change kycStatus, just records reviewer
        verifiedBy: reviewerId,
      },
    });
  }

  /**
   * Store combined PDF analysis result from Python OCR.
   */
  async saveCombinedPdfAnalysis(employeeId: string, analysis: any) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: { combinedPdfAnalysis: analysis },
    });
  }

  /**
   * Reset KYC status when HR deletes a document.
   * Always moves gate to REUPLOAD_REQUIRED (including PENDING state — Scenario A fix),
   * notifies the employee via in-app notification AND email with the HR reason.
   */
  async resetKycOnDocumentDeletion(
    employeeId: string,
    docType: string,
    reason?: string,
    docName?: string,
    isCombinedPdf?: boolean,
  ) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) return;

    // Remove the deleted doc type from submittedDocs
    const newSubmitted = (gate.submittedDocs as string[]).filter((t) => t !== docType);
    const allSubmitted = gate.requiredDocs.every((d: any) => newSubmitted.includes(d));

    // Always revert to REUPLOAD_REQUIRED regardless of current status (Scenario A + B fix)
    const deletionReason = reason?.trim() || 'Document was removed by HR — please re-upload';

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        submittedDocs: newSubmitted as any,
        allSubmitted,
        kycStatus: 'REUPLOAD_REQUIRED',
        reuploadRequested: true,
        reuploadDocTypes: [...new Set([...(gate.reuploadDocTypes as string[] || []), docType])] as any,
        documentRejectReasons: {
          ...((gate.documentRejectReasons as Record<string, string>) || {}),
          [docType]: deletionReason,
        } as any,
      },
    });

    // Emit socket event so KycGatePage refetches immediately
    await this.emitKycUpdate(employeeId, 'REUPLOAD_REQUIRED', 'deletion');

    // Notify employee in-app + email (non-blocking)
    try {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, organizationId: true, email: true, firstName: true, lastName: true },
      });
      if (emp?.userId) {
        const { enqueueNotification, enqueueEmail } = await import('../../jobs/queues.js');
        const displayDocName = docName || docType.replace(/_/g, ' ');

        // In-app notification
        await enqueueNotification({
          userId: emp.userId,
          organizationId: emp.organizationId,
          title: 'Document Removed — Re-upload Required',
          message: `Your ${displayDocName} was removed by HR. Please re-upload it to continue.`,
          type: 'DOCUMENT_FLAGGED',
          link: '/kyc-pending',
        });

        // Email notification with full details and reason
        if (emp.email) {
          await enqueueEmail({
            to: emp.email,
            subject: `Action Required: Document Removed — Please Re-upload Your ${displayDocName}`,
            template: 'document-deleted',
            context: {
              employeeName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee',
              docType: docType.replace(/_/g, ' '),
              docName: displayDocName,
              isCombinedPdf: isCombinedPdf || false,
              reason: deletionReason,
              reuploadUrl: 'https://hr.anistonav.com/kyc-pending',
              orgName: 'Aniston Technologies',
            },
          });
        }
      }
    } catch (err) {
      logger.warn(`[DocGate] Failed to send deletion notification for employee ${employeeId}:`, err);
    }

    return updated;
  }

  /**
   * Reset KYC status when HR rejects a specific document.
   * Sets kycStatus to REUPLOAD_REQUIRED with the rejected doc type flagged.
   */
  async resetKycOnDocumentRejection(employeeId: string, docType: string, rejectionReason: string, rejectedBy: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) return;

    // Remove the rejected doc from submittedDocs — file is deleted from disk on rejection
    const newSubmitted = (gate.submittedDocs as string[]).filter(t => t !== docType);
    const allSubmitted = gate.requiredDocs.every((d: any) => newSubmitted.includes(d));

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'REUPLOAD_REQUIRED',
        reuploadRequested: true,
        submittedDocs: newSubmitted as any,
        allSubmitted,
        reuploadDocTypes: [...new Set([...(gate.reuploadDocTypes as string[]), docType])] as any,
        documentRejectReasons: {
          ...((gate.documentRejectReasons as Record<string, string>) || {}),
          [docType]: rejectionReason || 'Document rejected by HR',
        } as any,
        verifiedBy: rejectedBy,
      },
    });

    await this.emitKycUpdate(employeeId, 'REUPLOAD_REQUIRED', 'rejection');

    try {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, organizationId: true, email: true, firstName: true, lastName: true },
      });
      if (emp?.userId) {
        const { enqueueNotification, enqueueEmail } = await import('../../jobs/queues.js');
        const displayDoc = docLabel(docType);
        await enqueueNotification({
          userId: emp.userId,
          organizationId: emp.organizationId,
          title: 'Document Rejected — Re-upload Required',
          message: `Your ${displayDoc} was rejected. Reason: ${rejectionReason || 'Please re-upload a clearer copy.'}`,
          type: 'DOCUMENT_FLAGGED',
          link: '/kyc-pending',
        });
        if (emp.email) {
          await enqueueEmail({
            to: emp.email,
            subject: `Action Required: Document Rejected — Please Re-upload Your ${displayDoc}`,
            template: 'document-deleted',
            context: {
              employeeName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee',
              docType: docType.replace(/_/g, ' '),
              docName: displayDoc,
              isCombinedPdf: false,
              reason: rejectionReason || 'Document rejected by HR — please re-upload a clearer copy',
              reuploadUrl: 'https://hr.anistonav.com/kyc-pending',
              orgName: 'Aniston Technologies',
            },
          });
        }
      }
    } catch { /* non-blocking */ }

    return updated;
  }

  async getPendingKyc(organizationId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.onboardingDocumentGate.findMany({
        where: {
          kycStatus: { in: ['SUBMITTED', 'REUPLOAD_REQUIRED', 'PENDING_HR_REVIEW'] },
          employee: { organizationId },
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              email: true,
              avatar: true,
              department: { select: { name: true } },
              documents: {
                where: { deletedAt: null },
                select: {
                  ocrVerification: {
                    select: { kycScore: true, confidence: true, ocrStatus: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.onboardingDocumentGate.count({
        where: {
          kycStatus: { in: ['SUBMITTED', 'REUPLOAD_REQUIRED', 'PENDING_HR_REVIEW'] },
          employee: { organizationId },
        },
      }),
    ]);

    // Compute per-employee OCR summary: avg kycScore, avg confidence, flagged doc count
    const enrichedItems = items.map(item => {
      const docs = (item.employee as any)?.documents ?? [];
      const ocrResults = docs
        .map((d: any) => d.ocrVerification)
        .filter((o: any) => o !== null && o !== undefined);

      const avgScore = ocrResults.length > 0
        ? Math.round(ocrResults.reduce((sum: number, o: any) => sum + (o.kycScore || 0), 0) / ocrResults.length)
        : null;
      const avgConfidence = ocrResults.length > 0
        ? Math.round(ocrResults.reduce((sum: number, o: any) => sum + (o.confidence || 0), 0) / ocrResults.length * 100)
        : null;
      const flaggedCount = ocrResults.filter((o: any) => o.ocrStatus === 'FLAGGED').length;
      const scannedCount = ocrResults.length;

      const { documents: _docs, ...empWithoutDocs } = (item.employee as any);
      return {
        ...item,
        employee: empWithoutDocs,
        ocrSummary: { avgScore, avgConfidence, flaggedCount, scannedCount },
      };
    });

    return {
      data: enrichedItems,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get KYC gate with full document OCR data for HR review.
   */
  async getKycForHrReview(employeeId: string, organizationId: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({
      where: { employeeId },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true, email: true,
            avatar: true, organizationId: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });
    if (!gate) throw new NotFoundError('KYC record');
    if (gate.employee.organizationId !== organizationId) throw new NotFoundError('KYC record');

    // Fetch all documents with OCR data
    const documents = await prisma.document.findMany({
      where: { employeeId, deletedAt: null },
      include: { ocrVerification: true },
      orderBy: { createdAt: 'desc' },
    });

    // Compute what's required vs present
    const { requiredDocs, needsIdentityProof, needsEmploymentProof } = computeRequiredDocs(
      gate.fresherOrExperienced || 'FRESHER',
      gate.highestQualification || 'GRADUATION'
    );

    const submittedDocTypes = gate.submittedDocs as string[];
    const missingDocs = requiredDocs.filter(d => d !== 'PHOTO' && !submittedDocTypes.includes(d));
    const hasIdentityProof = IDENTITY_PROOF_TYPES.some(t => submittedDocTypes.includes(t));
    const hasEmploymentProof = EMPLOYMENT_PROOF_TYPES.some(t => submittedDocTypes.includes(t));

    if (needsIdentityProof && !hasIdentityProof) {
      missingDocs.push('IDENTITY_PROOF');
    }

    // Run cross-document OCR validation on-demand (non-blocking — skipped if < 2 docs have OCR data).
    // On failure, return a structured ERROR state so HR knows validation was unavailable
    // (not that documents passed — an empty result is ambiguous and dangerous).
    let crossValidation: any = null;
    try {
      const { documentOcrService } = await import('../document-ocr/document-ocr.service.js');
      crossValidation = await documentOcrService.crossValidateEmployee(employeeId, organizationId);
      // Treat PENDING (< 2 OCR docs) as "not enough data" — surface null so UI shows nothing
      if (crossValidation?.status === 'PENDING') crossValidation = null;
    } catch (err: any) {
      // Return structured error so HR sees that validation was attempted but unavailable.
      // Never expose raw stack traces — only the sanitized message.
      crossValidation = {
        status: 'ERROR',
        message:
          'Cross-document validation could not run. ' +
          'Manually verify that the name, date of birth, and document numbers match across all submitted documents.',
        technicalReason: err?.message
          ? err.message.slice(0, 300)
          : 'Unknown internal error',
        manualReviewRequired: true,
        details: [],
      };
      logger.warn(
        `[KYC HR Review] Cross-validation failed for employee ${employeeId}: ${err?.message}`
      );
    }

    // DOB cross-verification for SEPARATE-mode submissions (Cat 4 item 16 — separate mode)
    // For combined PDF this comes from Python AI; for separate docs we compute from individual OCR records.
    let separateModeDobCrossVerification: any = null;
    if ((gate.uploadMode as string) === 'SEPARATE' || !gate.combinedPdfAnalysis) {
      try {
        const dobsByType: Record<string, string> = {};
        for (const doc of documents) {
          const ocr = (doc as any).ocrVerification;
          if (ocr?.extractedDob && doc.type && doc.type !== 'OTHER') {
            // Normalize DD/MM/YYYY
            const raw = String(ocr.extractedDob).trim();
            if (raw && raw.length >= 6 && !dobsByType[doc.type]) {
              dobsByType[doc.type] = raw;
            }
          }
        }
        const dobValues = Object.values(dobsByType);
        if (dobValues.length >= 2) {
          const allMatch = dobValues.every(d => d === dobValues[0]);
          separateModeDobCrossVerification = {
            status: allMatch ? 'MATCH' : 'MISMATCH',
            primary_dob: dobValues[0],
            dobs_found: dobsByType,
            message: allMatch
              ? `Date of birth matches across ${dobValues.length} documents.`
              : `Date of birth mismatch detected across documents — please verify.`,
            mismatches: allMatch ? [] : Object.entries(dobsByType)
              .filter(([, v]) => v !== dobValues[0])
              .map(([docType, dob]) => ({ doc_type: docType, message: `${dob} vs expected ${dobValues[0]}` })),
          };
        } else if (dobValues.length === 1) {
          separateModeDobCrossVerification = {
            status: 'INSUFFICIENT_DATA',
            message: 'Only one document has a readable date of birth — cannot cross-verify.',
            dobs_found: dobsByType,
          };
        }
      } catch { /* non-blocking */ }
    }

    return {
      gate,
      documents,
      analysis: {
        requiredDocs,
        missingDocs,
        hasIdentityProof,
        hasEmploymentProof,
        needsEmploymentProof,
        hasPhoto: !!(gate.photoUrl || submittedDocTypes.includes('PHOTO')),
      },
      crossValidation,
      separateModeDobCrossVerification,
    };
  }

  /**
   * One-time enforcement: flag all VERIFIED employees who have not uploaded a Cancelled Cheque.
   * Sets their gate to REUPLOAD_REQUIRED and sends in-app notifications.
   * Safe to call on every startup — only affects VERIFIED gates missing CANCELLED_CHEQUE.
   */
  async enforceCancelledChequeRequirement(organizationId?: string) {
    // Enforce on all non-PENDING, non-REJECTED, non-PROCESSING gates — covers
    // VERIFIED (already had access), SUBMITTED, and PENDING_HR_REVIEW (stuck waiting for HR).
    const verifiedGates = await prisma.onboardingDocumentGate.findMany({
      where: {
        kycStatus: { in: ['VERIFIED', 'SUBMITTED', 'PENDING_HR_REVIEW'] },
        ...(organizationId ? { employee: { organizationId } } : {}),
      },
      select: { employeeId: true },
    });

    let enforced = 0;
    let skipped = 0;

    for (const { employeeId } of verifiedGates) {
      const hasCancelledCheque = await prisma.document.findFirst({
        where: { employeeId, type: 'CANCELLED_CHEQUE', deletedAt: null },
      });

      if (hasCancelledCheque) {
        skipped++;
        continue;
      }

      const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
      if (!gate) continue;

      await prisma.onboardingDocumentGate.update({
        where: { employeeId },
        data: {
          kycStatus: 'REUPLOAD_REQUIRED',
          reuploadRequested: true,
          reuploadDocTypes: [...new Set([...(gate.reuploadDocTypes as string[] || []), 'CANCELLED_CHEQUE'])] as any,
          documentRejectReasons: {
            ...((gate.documentRejectReasons as Record<string, string>) || {}),
            CANCELLED_CHEQUE: 'New mandatory requirement: Cancelled Cheque is now required for all employees for payroll processing. Please upload a cancelled cheque of your salary account.',
          } as any,
          requiredDocs: [...new Set([...(gate.requiredDocs as string[] || []), 'CANCELLED_CHEQUE'])] as any,
        },
      });

      await this.emitKycUpdate(employeeId, 'REUPLOAD_REQUIRED');

      try {
        const emp = await prisma.employee.findUnique({
          where: { id: employeeId },
          select: { userId: true, organizationId: true },
        });
        if (emp?.userId) {
          const { enqueueNotification } = await import('../../jobs/queues.js');
          await enqueueNotification({
            userId: emp.userId,
            organizationId: emp.organizationId,
            title: 'Action Required: Upload Cancelled Cheque',
            message: 'A Cancelled Cheque is now required for payroll processing. Please upload it to restore full portal access.',
            type: 'DOCUMENT_FLAGGED',
            link: '/kyc-pending',
          });
        }
      } catch { /* non-blocking */ }

      enforced++;
    }

    logger.info(`[KYC] Cancelled Cheque enforcement: ${enforced} employees flagged, ${skipped} already have it`);
    return { enforced, skipped, total: verifiedGates.length };
  }
}

export const documentGateService = new DocumentGateService();
