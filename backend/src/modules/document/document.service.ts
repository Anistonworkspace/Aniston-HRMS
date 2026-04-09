import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { encrypt } from '../../utils/encryption.js';
import { generateOfferLetterPDF, generateJoiningLetterPDF, generateExperienceLetterPDF, generateRelievingLetterPDF } from '../../utils/letterTemplates.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { storageService } from '../../services/storage.service.js';
import type { CreateDocumentInput, DocumentQuery } from './document.validation.js';

export class DocumentService {
  async list(query: DocumentQuery, organizationId: string) {
    const { page, limit, employeeId, type, status } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    if (type) where.type = type;
    if (status) where.status = status;
    // Scope to org via employee relation
    if (!employeeId) {
      where.employee = { organizationId };
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      }),
      prisma.document.count({ where }),
    ]);

    return {
      data: documents,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  async getById(id: string) {
    const doc = await prisma.document.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });
    if (!doc) throw new NotFoundError('Document');
    return doc;
  }

  async create(data: CreateDocumentInput, fileUrl: string, userId: string) {
    return prisma.document.create({
      data: {
        name: data.name,
        type: data.type as any,
        fileUrl,
        employeeId: data.employeeId || null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        status: 'PENDING',
      },
    });
  }

  async verify(id: string, status: string, verifierId: string, rejectionReason?: string) {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundError('Document');

    return prisma.document.update({
      where: { id },
      data: {
        status: status as any,
        verifiedBy: verifierId,
        verifiedAt: new Date(),
        rejectionReason: status === 'REJECTED' ? rejectionReason : null,
      },
    });
  }

  async remove(id: string) {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundError('Document');

    return prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  /**
   * Get all documents for the currently logged-in employee.
   */
  async getMyDocuments(employeeId: string) {
    return prisma.document.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * HR issues a letter document (Offer, Joining, Experience, Relieving).
   * Generates PDF, saves to disk, creates Document record.
   */
  async issueLetterDocument(
    employeeId: string,
    type: 'OFFER_LETTER_DOC' | 'JOINING_LETTER' | 'EXPERIENCE_LETTER' | 'RELIEVING_LETTER',
    issuedByUserId: string,
    organizationId: string
  ) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true } },
        salaryStructure: true,
      },
    });
    if (!employee) throw new NotFoundError('Employee');

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, address: true },
    });
    if (!org) throw new NotFoundError('Organization');

    // Validate letter type appropriateness
    if ((type === 'EXPERIENCE_LETTER' || type === 'RELIEVING_LETTER') && !employee.lastWorkingDate && !employee.resignationDate) {
      throw new BadRequestError('Experience and Relieving letters require the employee to have a resignation or last working date set.');
    }

    const letterData = {
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeCode: employee.employeeCode,
      email: employee.email,
      joiningDate: employee.joiningDate,
      lastWorkingDate: employee.lastWorkingDate,
      resignationDate: employee.resignationDate,
      ctc: employee.ctc,
      department: employee.department,
      designation: employee.designation,
      manager: employee.manager,
      organization: { name: org.name, address: org.address },
      salaryStructure: employee.salaryStructure,
    };

    // Generate PDF
    let pdfBuffer: Buffer;
    let letterName: string;
    switch (type) {
      case 'OFFER_LETTER_DOC':
        pdfBuffer = await generateOfferLetterPDF(letterData);
        letterName = 'Offer Letter';
        break;
      case 'JOINING_LETTER':
        pdfBuffer = await generateJoiningLetterPDF(letterData);
        letterName = 'Joining Letter';
        break;
      case 'EXPERIENCE_LETTER':
        pdfBuffer = await generateExperienceLetterPDF(letterData);
        letterName = 'Experience Letter';
        break;
      case 'RELIEVING_LETTER':
        pdfBuffer = await generateRelievingLetterPDF(letterData);
        letterName = 'Relieving Letter';
        break;
    }

    // Save PDF to disk under employees/{code}/letters/
    const lettersDir = storageService.getAbsoluteDir('employees', employee.employeeCode, 'letters');
    const fileName = `${type.toLowerCase()}-${Date.now()}.pdf`;
    const filePath = join(lettersDir, fileName);
    writeFileSync(filePath, pdfBuffer);

    const fileUrl = storageService.buildUrl(`employees/${employee.employeeCode}/letters`, fileName);

    // Create document record
    const document = await prisma.document.create({
      data: {
        name: `${letterName} - ${employee.firstName} ${employee.lastName}`,
        type: type as any,
        fileUrl,
        employeeId,
        status: 'ISSUED',
        issuedBy: issuedByUserId,
        verifiedBy: issuedByUserId,
        verifiedAt: new Date(),
      },
    });

    await createAuditLog({
      userId: issuedByUserId,
      organizationId,
      entity: 'Document',
      entityId: document.id,
      action: 'CREATE',
      newValue: { type, employeeId, letterName },
    });

    return document;
  }

  /**
   * Auto-fill employee profile fields from OCR-extracted data when HR approves a document.
   * Only fills fields that are currently null/empty — never overwrites existing data.
   */
  async autoFillFromOcr(documentId: string, employeeId: string, verifierId: string, organizationId: string): Promise<string[]> {
    const ocrData = await prisma.documentOcrVerification.findUnique({
      where: { documentId },
    });
    if (!ocrData) return [];

    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) return [];

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } }) as any;
    if (!employee) return [];

    const updates: Record<string, any> = {};
    const filledFields: string[] = [];

    // Auto-fill DOB (from any identity document)
    if (!employee.dateOfBirth && ocrData.extractedDob) {
      const parsed = new Date(ocrData.extractedDob);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1940 && parsed.getFullYear() < 2010) {
        updates.dateOfBirth = parsed;
        filledFields.push('Date of Birth');
      }
    }

    // Auto-fill gender
    if (ocrData.extractedGender) {
      const genderMap: Record<string, string> = { MALE: 'MALE', FEMALE: 'FEMALE', M: 'MALE', F: 'FEMALE', TRANSGENDER: 'OTHER' };
      const mapped = genderMap[ocrData.extractedGender.toUpperCase()];
      if (mapped && employee.gender !== mapped) {
        updates.gender = mapped;
        filledFields.push('Gender');
      }
    }

    // Auto-fill father's name
    if (!employee.fatherName && ocrData.extractedFatherName) {
      updates.fatherName = ocrData.extractedFatherName;
      filledFields.push('Father\'s Name');
    }

    // Auto-fill address (JSON)
    if (!employee.address && ocrData.extractedAddress) {
      updates.address = { line1: ocrData.extractedAddress };
      filledFields.push('Address');
    }

    // Auto-fill name from identity documents (if name fields are empty)
    if (ocrData.extractedName && (!employee.firstName || !employee.lastName)) {
      const nameParts = ocrData.extractedName.trim().split(/\s+/);
      if (nameParts.length >= 2) {
        if (!employee.firstName) {
          updates.firstName = nameParts[0];
          filledFields.push('First Name');
        }
        if (!employee.lastName) {
          updates.lastName = nameParts.slice(1).join(' ');
          filledFields.push('Last Name');
        }
      }
    }

    // Document-type-specific fields
    if (doc.type === 'PAN' && !employee.panNumber && ocrData.extractedDocNumber) {
      const pan = ocrData.extractedDocNumber.toUpperCase().replace(/[\s\-]/g, '');
      if (/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) {
        updates.panNumber = pan;
        filledFields.push('PAN Number');
      }
    }

    if (doc.type === 'AADHAAR' && !employee.aadhaarEncrypted && ocrData.extractedDocNumber) {
      const aadhaar = ocrData.extractedDocNumber.replace(/[\s\-X]/gi, '');
      if (/^\d{12}$/.test(aadhaar)) {
        updates.aadhaarEncrypted = encrypt(aadhaar);
        filledFields.push('Aadhaar Number');
      }
    }

    // Bank details from cancelled cheque OCR (LLM extracts IFSC, account number)
    if ((doc.type === 'CANCELLED_CHEQUE' || doc.type === 'BANK_STATEMENT') && ocrData.llmExtractedData) {
      const llmData = typeof ocrData.llmExtractedData === 'string' ? JSON.parse(ocrData.llmExtractedData) : ocrData.llmExtractedData;
      if (!employee.bankAccountNumber && llmData.accountNumber) {
        const accNo = llmData.accountNumber.replace(/[\s\-]/g, '');
        if (/^\d{9,18}$/.test(accNo)) {
          updates.bankAccountNumber = accNo;
          filledFields.push('Bank Account Number');
        }
      }
      if (!employee.bankIfsc && llmData.ifscCode) {
        const ifsc = llmData.ifscCode.toUpperCase().replace(/[\s\-]/g, '');
        if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
          updates.bankIfsc = ifsc;
          filledFields.push('Bank IFSC Code');
        }
      }
      if (!employee.bankName && llmData.bankName) {
        updates.bankName = llmData.bankName;
        filledFields.push('Bank Name');
      }
    }

    if (filledFields.length > 0) {
      await prisma.employee.update({
        where: { id: employeeId },
        data: updates,
      });

      await createAuditLog({
        userId: verifierId,
        organizationId,
        entity: 'Employee',
        entityId: employeeId,
        action: 'UPDATE',
        newValue: { source: 'OCR_AUTO_FILL', documentId, filledFields },
      });
    }

    return filledFields;
  }
}

export const documentService = new DocumentService();
