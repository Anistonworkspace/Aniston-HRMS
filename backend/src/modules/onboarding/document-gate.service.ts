import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import { emitToOrg } from '../../sockets/index.js';
import { logger } from '../../lib/logger.js';

const DEFAULT_REQUIRED_DOCS = ['PAN', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO'];
const IDENTITY_PROOF_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];

export class DocumentGateService {
  async createGate(employeeId: string, requiredDocs?: string[]) {
    const existing = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (existing) return existing;

    return prisma.onboardingDocumentGate.create({
      data: {
        employeeId,
        requiredDocs: (requiredDocs || DEFAULT_REQUIRED_DOCS) as any,
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
      // Auto-create gate if it doesn't exist
      return prisma.onboardingDocumentGate.create({
        data: {
          employeeId,
          requiredDocs: DEFAULT_REQUIRED_DOCS as any,
          photoUrl,
        },
      });
    }

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: { photoUrl },
    });
  }

  async submitKyc(employeeId: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    // If combined PDF is uploaded, bypass individual checks
    if (gate.combinedPdfUploaded) {
      const updated = await prisma.onboardingDocumentGate.update({
        where: { employeeId },
        data: { kycStatus: 'SUBMITTED' },
      });
      await this.emitKycUpdate(employeeId, 'SUBMITTED');
      return updated;
    }

    // Verify all mandatory documents
    const submitted = gate.submittedDocs as string[];
    const missing: string[] = [];

    // Use stored required docs if available, otherwise fall back to defaults
    const requiredDocTypes: string[] = gate.requiredDocs?.length > 0
      ? (gate.requiredDocs as string[])
      : DEFAULT_REQUIRED_DOCS;

    for (const docType of requiredDocTypes) {
      if (docType === 'PHOTO') {
        if (!gate.photoUrl && !submitted.includes('PHOTO')) missing.push('Photograph');
      } else if (['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'].includes(docType)) {
        // Any identity proof type satisfies an identity proof requirement
        if (!IDENTITY_PROOF_TYPES.some(t => submitted.includes(t))) missing.push('Identity Proof (Aadhaar/Passport/DL/Voter ID)');
      } else if (!submitted.includes(docType)) {
        const labelMap: Record<string, string> = {
          PAN: 'PAN Card',
          TENTH_CERTIFICATE: '10th Certificate',
          TWELFTH_CERTIFICATE: '12th Certificate',
          DEGREE_CERTIFICATE: 'Degree Certificate',
          RESIDENCE_PROOF: 'Residence Proof',
        };
        missing.push(labelMap[docType] || docType);
      }
    }

    if (missing.length > 0) {
      const { BadRequestError } = await import('../../middleware/errorHandler.js');
      throw new BadRequestError(`Missing mandatory documents: ${missing.join(', ')}`);
    }

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: { kycStatus: 'SUBMITTED' },
    });
    await this.emitKycUpdate(employeeId, 'SUBMITTED');
    return updated;
  }

  /**
   * Emit real-time socket event when KYC status changes — HR sees updates instantly.
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

  async setCombinedPdfUploaded(employeeId: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) {
      return prisma.onboardingDocumentGate.create({
        data: {
          employeeId,
          requiredDocs: DEFAULT_REQUIRED_DOCS as any,
          combinedPdfUploaded: true,
        },
      });
    }
    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: { combinedPdfUploaded: true },
    });
  }

  async verifyKyc(employeeId: string, verifiedBy: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    const updated = await prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy,
        rejectionReason: null,
      },
    });
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

  async getPendingKyc(organizationId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.onboardingDocumentGate.findMany({
        where: {
          kycStatus: 'SUBMITTED',
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
          kycStatus: 'SUBMITTED',
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
}

export const documentGateService = new DocumentGateService();
