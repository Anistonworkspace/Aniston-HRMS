import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

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
      return prisma.onboardingDocumentGate.update({
        where: { employeeId },
        data: { kycStatus: 'SUBMITTED' },
      });
    }

    // Verify all mandatory documents
    const submitted = gate.submittedDocs as string[];
    const missing: string[] = [];

    if (!submitted.includes('PAN')) missing.push('PAN Card');
    if (!IDENTITY_PROOF_TYPES.some(t => submitted.includes(t))) missing.push('Identity Proof (Aadhaar/Passport/DL/Voter ID)');
    if (!submitted.includes('TENTH_CERTIFICATE')) missing.push('10th Certificate');
    if (!submitted.includes('TWELFTH_CERTIFICATE')) missing.push('12th Certificate');
    if (!submitted.includes('DEGREE_CERTIFICATE')) missing.push('Degree Certificate');
    if (!submitted.includes('RESIDENCE_PROOF')) missing.push('Residence Proof');
    if (!gate.photoUrl && !submitted.includes('PHOTO')) missing.push('Photograph');

    if (missing.length > 0) {
      const { BadRequestError } = await import('../../middleware/errorHandler.js');
      throw new BadRequestError(`Missing mandatory documents: ${missing.join(', ')}`);
    }

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: { kycStatus: 'SUBMITTED' },
    });
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

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy,
        rejectionReason: null,
      },
    });
  }

  async rejectKyc(employeeId: string, reason: string, rejectedBy: string) {
    const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
    if (!gate) throw new NotFoundError('Document gate');

    return prisma.onboardingDocumentGate.update({
      where: { employeeId },
      data: {
        kycStatus: 'REJECTED',
        rejectionReason: reason,
        verifiedBy: rejectedBy,
      },
    });
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
