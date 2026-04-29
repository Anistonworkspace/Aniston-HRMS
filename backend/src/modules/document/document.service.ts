import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError, AppError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { encrypt } from '../../utils/encryption.js';
import { generateOfferLetterPDF, generateJoiningLetterPDF, generateExperienceLetterPDF, generateRelievingLetterPDF } from '../../utils/letterTemplates.js';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { storageService } from '../../services/storage.service.js';
import { logger } from '../../lib/logger.js';
import type { CreateDocumentInput, DocumentQuery } from './document.validation.js';

export class DocumentService {
  async list(query: DocumentQuery, organizationId: string) {
    const { page, limit, employeeId, type, status } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
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
      }).catch((err: any) => {
        logger.warn('[Document] Failed to fetch document list:', err.message);
        return [];
      }),
      prisma.document.count({ where }).catch(() => 0),
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
    // If the employee already has an active document of the same type, replace it:
    // soft-delete the old record and physically remove its file so there are no duplicates.
    if (data.employeeId && data.type) {
      const existing = await prisma.document.findFirst({
        where: { employeeId: data.employeeId, type: data.type as any, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        await prisma.document.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
        if (existing.fileUrl) {
          storageService.deleteFile(existing.fileUrl).catch((err) =>
            logger.warn(`[Document] Failed to delete replaced file "${existing.fileUrl}":`, err.message),
          );
        }
      }
    }

    const doc = await prisma.document.create({
      data: {
        name: data.name,
        type: data.type as any,
        fileUrl,
        employeeId: data.employeeId || null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        status: 'PENDING',
      },
    });

    // Auto-set Employee.avatar when a PHOTO document is uploaded — awaited so profile shows immediately
    if (data.type === 'PHOTO' && data.employeeId) {
      await prisma.employee.update({ where: { id: data.employeeId }, data: { avatar: fileUrl } })
        .catch((err) => logger.warn(`[Document] Failed to update avatar for employee ${data.employeeId}: ${err.message}`));
    }

    // Trigger OCR processing for identity/financial documents — best-effort, non-blocking
    const OCR_ELIGIBLE_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE',
      'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE',
      'CANCELLED_CHEQUE', 'BANK_STATEMENT', 'OFFER_LETTER_DOC', 'SALARY_SLIP_DOC',
      'EXPERIENCE_LETTER', 'RESIDENCE_PROOF', 'PERMANENT_RESIDENCE_PROOF', 'RELIEVING_LETTER'];
    if (data.employeeId && OCR_ELIGIBLE_TYPES.includes(data.type as string)) {
      import('../../jobs/queues.js').then(({ enqueueDocumentOcr }) => {
        const orgId = doc.employeeId ? '' : ''; // fetched below
        prisma.employee.findUnique({ where: { id: data.employeeId! }, select: { organizationId: true } })
          .then(emp => {
            if (emp) {
              enqueueDocumentOcr(doc.id, emp.organizationId).catch((e) =>
                logger.warn(`[Document] OCR enqueue failed for doc ${doc.id}: ${e.message}`)
              );
            }
          }).catch(() => {});
      }).catch(() => {});
    }

    // Notify HR when a document is submitted — best-effort, non-blocking
    if (data.employeeId) {
      try {
        const { enqueueEmail } = await import('../../jobs/queues.js');
        const employee = await prisma.employee.findUnique({
          where: { id: data.employeeId },
          select: { firstName: true, lastName: true, employeeCode: true, organizationId: true },
        });
        if (employee) {
          const org = await prisma.organization.findUnique({
            where: { id: employee.organizationId },
            select: { adminNotificationEmail: true, name: true },
          });
          const hrEmail = org?.adminNotificationEmail;
          if (hrEmail) {
            await enqueueEmail({
              to: hrEmail,
              subject: `Document Uploaded: ${data.name} — ${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
              template: 'document-submitted',
              context: {
                employeeName: `${employee.firstName} ${employee.lastName}`,
                employeeCode: employee.employeeCode,
                documentType: data.type,
                documentName: data.name,
                reviewUrl: `https://hr.anistonav.com/employees/${data.employeeId}`,
                orgName: org?.name || 'Aniston Technologies',
              },
            });
          }
        }
      } catch (err: any) {
        // Non-blocking: import/email failure must not fail the document upload
        const { logger } = await import('../../lib/logger.js');
        logger.error(`[Document] Failed to send document-submitted notification: ${err.message}`);
      }
    }

    return doc;
  }

  async verify(id: string, status: string, verifierId: string, rejectionReason?: string, organizationId?: string) {
    const doc = await prisma.document.findFirst({
      where: organizationId
        ? { id, employee: { organizationId } }
        : { id },
    });
    if (!doc) throw new NotFoundError('Document');

    const updated = await prisma.document.update({
      where: { id },
      data: {
        status: status as any,
        verifiedBy: verifierId,
        verifiedAt: new Date(),
        rejectionReason: status === 'REJECTED' ? rejectionReason : null,
      },
    });

    // Physically delete the file when HR rejects a document — employee must re-upload
    // Also nullify the fileUrl in the DB so stale references don't accumulate
    // KYC gate reset is handled by the controller after this method returns
    if (status === 'REJECTED' && doc.fileUrl) {
      await storageService.deleteFile(doc.fileUrl).catch((err) =>
        logger.warn(`[Document] Failed to delete rejected file "${doc.fileUrl}":`, err.message),
      );
      await prisma.document.update({
        where: { id },
        data: { fileUrl: '' },
      }).catch((err) => logger.warn(`[Document] Failed to nullify fileUrl for rejected doc ${id}:`, err.message));
    }

    return updated;
  }

  async remove(id: string, userId?: string, organizationId?: string) {
    const doc = await prisma.document.findFirst({
      where: organizationId
        ? { id, employee: { organizationId } }
        : { id },
    });
    if (!doc) throw new NotFoundError('Document');

    // Soft-delete the DB record first
    const deleted = await prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // Physically delete the file from disk — non-blocking, best-effort.
    // Failure is logged with error code so ops can identify orphaned files.
    if (doc.fileUrl) {
      storageService.deleteFile(doc.fileUrl).catch((err) => {
        logger.error(
          `[Document] Physical file deletion failed — documentId: ${id}, ` +
          `code: ${err?.code || 'UNKNOWN'}, message: ${err?.message || err}`,
        );
      });
    }

    // Audit log the deletion
    if (userId && organizationId) {
      try {
        const { createAuditLog } = await import('../../utils/auditLogger.js');
        await createAuditLog({
          userId,
          organizationId,
          entity: 'Document',
          entityId: id,
          action: 'DELETE',
          oldValue: { name: doc.name, type: doc.type, fileUrl: doc.fileUrl, status: doc.status },
          newValue: { description: `Document "${doc.name}" (type: ${doc.type}) deleted by HR/Admin` },
        });
      } catch { /* audit log failure should not block deletion */ }
    }

    return deleted;
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
    const fileUrl = storageService.buildUrl(`employees/${employee.employeeCode}/letters`, fileName);

    // Write file then persist DB record atomically (clean up file if DB save fails)
    try {
      writeFileSync(filePath, pdfBuffer);
    } catch (err: any) {
      logger.error(`[Document] Failed to write letter file ${filePath}: ${err.message}`);
      throw new AppError('Failed to generate letter document. Please check disk space and permissions.', 500, 'FILE_WRITE_ERROR');
    }

    let document: any;
    try {
      document = await prisma.document.create({
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
    } catch (err: any) {
      // DB save failed — clean up the file to avoid orphaned files on disk
      try { unlinkSync(filePath); } catch { /* ignore cleanup errors */ }
      logger.error(`[Document] DB save failed after writing letter file ${filePath}: ${err.message}`);
      throw new AppError('Failed to save letter document record. The generated file has been cleaned up.', 500, 'DOCUMENT_GENERATION_FAILED');
    }

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
        updates.panNumber = encrypt(pan);
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

    // Bank details from bank statement / cancelled cheque OCR
    if (doc.type === 'CANCELLED_CHEQUE' || doc.type === 'BANK_STATEMENT') {
      // Account number: stored in extractedDocNumber (primary) or llmExtractedData.accountNumber
      const rawAccNo = ocrData.extractedDocNumber ||
        ((ocrData.llmExtractedData as any)?.accountNumber) || null;
      if (!employee.bankAccountNumber && rawAccNo) {
        const accNo = rawAccNo.replace(/[\s\-]/g, '');
        if (/^\d{9,18}$/.test(accNo)) {
          updates.bankAccountNumber = encrypt(accNo);
          filledFields.push('Bank Account Number');
        }
      }

      // IFSC and bank name: stored in llmExtractedData (set by OCR service for both Python and Node.js paths)
      if (ocrData.llmExtractedData) {
        const llmData = typeof ocrData.llmExtractedData === 'string'
          ? JSON.parse(ocrData.llmExtractedData)
          : ocrData.llmExtractedData;
        const rawIfsc = llmData.ifscCode || llmData.ifsc_code || null;
        const rawBank = llmData.bankName || llmData.bank_name || null;

        if (!employee.ifscCode && rawIfsc) {
          const ifsc = rawIfsc.toUpperCase().replace(/[\s\-]/g, '');
          if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
            updates.ifscCode = ifsc;
            filledFields.push('Bank IFSC Code');
          }
        }
        if (!employee.bankName && rawBank) {
          updates.bankName = rawBank;
          filledFields.push('Bank Name');
        }
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
