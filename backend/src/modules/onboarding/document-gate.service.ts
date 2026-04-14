import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { emitToOrg } from '../../sockets/index.js';
import { logger } from '../../lib/logger.js';

// =====================
// CONSTANTS
// =====================

const IDENTITY_PROOF_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];
const EMPLOYMENT_PROOF_TYPES = ['EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'OFFER_LETTER_DOC', 'SALARY_SLIP_DOC'];

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
  const required: string[] = ['PAN', 'PHOTO', 'RESIDENCE_PROOF'];

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
        requiredDocs: (requiredDocs || ['PAN', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO']) as any,
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

    const submitted = [...gate.submittedDocs];
    if (!submitted.includes(documentType as any)) {
      submitted.push(documentType as any);
    }

    const allSubmitted = gate.requiredDocs.every((doc: any) => submitted.includes(doc));

    await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        submittedDocs: submitted as any,
        allSubmitted,
      },
    });

    return { allSubmitted, submitted: submitted.length, required: gate.requiredDocs.length };
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
          requiredDocs: ['PAN', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO'] as any,
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

    // Photo is always required
    const hasPhoto = !!gate.photoUrl || submitted.includes('PHOTO');
    if (!hasPhoto) {
      throw new BadRequestError('Please upload your passport size photograph before submitting.');
    }

    if (uploadMode === 'COMBINED') {
      // Combined mode: just need combined PDF + photo
      if (!gate.combinedPdfUploaded) {
        throw new BadRequestError('Please upload your combined PDF before submitting.');
      }
      const updated = await prisma.onboardingDocumentGate.update({
        where: { employeeId },
        data: { kycStatus: 'SUBMITTED' },
      });
      await this.emitKycUpdate(employeeId, 'SUBMITTED');
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

    // Employment proof — soft warning only (not hard-blocked) for experienced
    // HR will flag if missing; we only hard-block if truly mandatory
    const employmentWarning = needsEmploymentProof && !EMPLOYMENT_PROOF_TYPES.some(t => submitted.includes(t));

    if (missing.length > 0) {
      throw new BadRequestError(`Missing required documents: ${missing.join(', ')}`);
    }

    const updatedData: any = { kycStatus: 'SUBMITTED' };
    if (employmentWarning) {
      // Add a soft note to HR review notes that employment proof was not submitted
      updatedData.hrReviewNotes = (gate.hrReviewNotes ? gate.hrReviewNotes + '\n' : '') +
        '[System] Employee declared as EXPERIENCED but no employment proof was uploaded.';
    }

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: updatedData,
    });
    await this.emitKycUpdate(employeeId, 'SUBMITTED');
    return updated;
  }

  /**
   * Emit real-time socket event when KYC status changes.
   */
  private async emitKycUpdate(employeeId: string, status: string) {
    try {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { organizationId: true, firstName: true, lastName: true, employeeCode: true },
      });
      if (emp) {
        emitToOrg(emp.organizationId, 'kyc:status-changed', {
          employeeId,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          employeeCode: emp.employeeCode,
          status,
        });
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
          requiredDocs: ['PAN', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO'] as any,
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
    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'PENDING_HR_REVIEW',
        combinedPdfAnalysis: opts.analysisResult,
        processingMode: opts.processingMode,
        fallbackUsed: opts.fallbackUsed,
        missingDocuments: (opts.missingDocuments || []) as any,
        duplicateDocuments: (opts.duplicateDocuments || []) as any,
        employeeVisibleReasons: (opts.employeeVisibleReasons || []) as any,
      },
    });
  }

  async verifyKyc(employeeId: string, verifiedBy: string, organizationId?: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy,
        rejectionReason: null,
        reuploadRequested: false,
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
   */
  async updateHrNotes(employeeId: string, notes: string, reviewerId: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: { hrReviewNotes: notes },
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
   * Removes the doc type from submittedDocs and, if KYC was past PENDING,
   * moves it back to REUPLOAD_REQUIRED so the employee sees the KYC gate again.
   */
  async resetKycOnDocumentDeletion(employeeId: string, docType: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) return;

    // Remove the deleted doc type from submittedDocs
    const newSubmitted = (gate.submittedDocs as string[]).filter((t) => t !== docType);
    const allSubmitted = gate.requiredDocs.every((d: any) => newSubmitted.includes(d));

    // Only revert if KYC was past PENDING — don't touch a gate already at PENDING
    const shouldRevert = !['PENDING'].includes(gate.kycStatus);
    const newStatus = shouldRevert ? 'REUPLOAD_REQUIRED' : gate.kycStatus;

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        submittedDocs: newSubmitted as any,
        allSubmitted,
        kycStatus: newStatus,
        // If reverting, record which doc needs re-upload
        ...(shouldRevert
          ? {
              reuploadRequested: true,
              reuploadDocTypes: [...new Set([...(gate.reuploadDocTypes as string[]), docType])] as any,
              documentRejectReasons: {
                ...((gate.documentRejectReasons as Record<string, string>) || {}),
                [docType]: 'Document was removed by HR — please re-upload',
              } as any,
            }
          : {}),
      },
    });

    if (shouldRevert) {
      await this.emitKycUpdate(employeeId, 'REUPLOAD_REQUIRED');
      // Notify employee
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
            title: 'Document Deleted — Action Required',
            message: `HR removed your ${docType.replace(/_/g, ' ')}. Please re-upload it from the KYC page.`,
            type: 'DOCUMENT_FLAGGED',
            link: '/kyc-pending',
          });
        }
      } catch { /* non-blocking */ }
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

    // Only act if KYC was past PENDING
    if (gate.kycStatus === 'PENDING') return;

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'REUPLOAD_REQUIRED',
        reuploadRequested: true,
        reuploadDocTypes: [...new Set([...(gate.reuploadDocTypes as string[]), docType])] as any,
        documentRejectReasons: {
          ...((gate.documentRejectReasons as Record<string, string>) || {}),
          [docType]: rejectionReason || 'Document rejected by HR',
        } as any,
        verifiedBy: rejectedBy,
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
          title: 'Document Rejected — Re-upload Required',
          message: `Your ${docType.replace(/_/g, ' ')} was rejected. Reason: ${rejectionReason || 'Please re-upload a clearer copy.'}`,
          type: 'DOCUMENT_FLAGGED',
          link: '/kyc-pending',
        });
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

    return {
      data: items,
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
    };
  }
}

export const documentGateService = new DocumentGateService();
