import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

const DEFAULT_REQUIRED_DOCS = ['AADHAAR', 'PAN', 'TENTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'CANCELLED_CHEQUE', 'PHOTO'];

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
}

export const documentGateService = new DocumentGateService();
