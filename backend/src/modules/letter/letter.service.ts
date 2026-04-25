import path from 'path';
import fs from 'fs';
import { prisma } from '../../lib/prisma.js';
import type { LetterType, Prisma } from '@prisma/client';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { generateLetterPDF, TEMPLATE_SCHEMES } from './letterPdfEngine.js';
import { storageService } from '../../services/storage.service.js';
import type { CreateLetterInput, AssignLetterInput } from './letter.validation.js';

export class LetterService {
  // List all letters (HR view)
  async list(organizationId: string) {
    const letters = await prisma.letter.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { name: true, slug: true } },
        issuedBy: { select: { email: true } },
        assignments: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          },
        },
        _count: { select: { assignments: true } },
      },
    });
    return letters;
  }

  // Get single letter
  async getById(id: string, organizationId: string) {
    const letter = await prisma.letter.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        template: true,
        issuedBy: { select: { email: true } },
        assignments: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true } },
          },
        },
      },
    });
    if (!letter) throw new NotFoundError('Letter');
    return letter;
  }

  // Create letter + generate PDF + assign to employee
  async create(data: CreateLetterInput, userId: string, organizationId: string) {
    // Get employee data for PDF generation
    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
        salaryStructure: true,
        organization: { select: { name: true, address: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Get branding
    const branding = await prisma.companyBranding.findUnique({
      where: { organizationId },
    });

    // Get or default template
    const templateSlug = data.templateSlug || 'modern-minimal';
    let template = await prisma.letterTemplate.findFirst({
      where: { slug: templateSlug, organizationId },
    });

    // Auto-create default templates if none exist
    if (!template) {
      template = await this.ensureDefaultTemplates(organizationId, templateSlug);
    }

    // Prepare letter data
    const letterData = {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeCode: employee.employeeCode,
      designation: data.content?.designation || employee.designation?.name || 'N/A',
      department: data.content?.department || employee.department?.name || 'N/A',
      joiningDate: data.content?.joiningDate || employee.joiningDate.toISOString(),
      salary: data.content?.salary || (employee.ctc ? String(employee.ctc) : undefined),
      lastWorkingDate: data.content?.lastWorkingDate || (employee.lastWorkingDate ? employee.lastWorkingDate.toISOString() : undefined),
      resignationDate: data.content?.resignationDate || (employee.resignationDate ? employee.resignationDate.toISOString() : undefined),
      customBody: data.content?.customBody,
      customFields: data.content?.customFields,
    };

    // Generate PDF
    const pdfBuffer = await generateLetterPDF(
      data.type,
      templateSlug,
      letterData,
      branding,
      employee.organization.name,
      employee.organization.address,
    );

    // Save PDF file under letters/{organizationId}/
    const fileName = `${data.type.toLowerCase()}-${employee.employeeCode}-${Date.now()}.pdf`;
    const dir = storageService.getAbsoluteDir('letters', organizationId);
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, pdfBuffer);
    const fileUrl = storageService.buildUrl(`letters/${organizationId}`, fileName);

    // Create letter record + assignment in a transaction
    const letter = await prisma.$transaction(async (tx) => {
      const created = await tx.letter.create({
        data: {
          type: data.type as LetterType,
          title: data.title,
          content: letterData as unknown as Prisma.InputJsonValue,
          filePath: fileUrl,
          templateId: template?.id,
          issuedById: userId,
          organizationId,
        },
      });

      // Auto-assign to the employee
      await tx.letterAssignment.create({
        data: {
          letterId: created.id,
          employeeId: data.employeeId,
          downloadAllowed: data.downloadAllowed ?? false,
          organizationId,
        },
      });

      return created;
    });

    // Audit log
    await createAuditLog({
      userId,
      entity: 'Letter',
      entityId: letter.id,
      action: 'CREATE',
      newValue: { type: data.type, title: data.title, employee: employee.employeeCode },
      organizationId,
    });

    return letter;
  }

  // Preview letter as PDF buffer — no DB writes
  async preview(data: CreateLetterInput, organizationId: string): Promise<Buffer> {
    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
        salaryStructure: true,
        organization: { select: { name: true, address: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee');

    const branding = await prisma.companyBranding.findUnique({ where: { organizationId } });

    const letterData = {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeCode: employee.employeeCode,
      designation: data.content?.designation || employee.designation?.name || 'N/A',
      department: data.content?.department || employee.department?.name || 'N/A',
      joiningDate: data.content?.joiningDate || employee.joiningDate.toISOString(),
      salary: data.content?.salary || (employee.ctc ? String(employee.ctc) : undefined),
      lastWorkingDate: data.content?.lastWorkingDate || (employee.lastWorkingDate ? employee.lastWorkingDate.toISOString() : undefined),
      resignationDate: data.content?.resignationDate || (employee.resignationDate ? employee.resignationDate.toISOString() : undefined),
      customBody: data.content?.customBody,
      customFields: data.content?.customFields,
    };

    return generateLetterPDF(
      data.type,
      data.templateSlug || 'modern-minimal',
      letterData,
      branding,
      employee.organization.name,
      employee.organization.address,
    );
  }

  // Assign existing letter to more employees
  async assign(letterId: string, data: AssignLetterInput, organizationId: string) {
    const letter = await prisma.letter.findFirst({
      where: { id: letterId, organizationId, deletedAt: null },
    });
    if (!letter) throw new NotFoundError('Letter');

    const assignments = await prisma.$transaction(
      data.employeeIds.map((employeeId) =>
        prisma.letterAssignment.upsert({
          where: { letterId_employeeId: { letterId, employeeId } },
          create: {
            letterId,
            employeeId,
            downloadAllowed: data.downloadAllowed ?? false,
            organizationId,
          },
          update: {
            downloadAllowed: data.downloadAllowed ?? false,
          },
        }),
      ),
    );
    return assignments;
  }

  // Update assignment download permission
  async updateAssignment(assignmentId: string, downloadAllowed: boolean, userId: string, organizationId: string) {
    const assignment = await prisma.letterAssignment.findFirst({
      where: { id: assignmentId, organizationId },
    });
    if (!assignment) throw new NotFoundError('Letter assignment');

    const updated = await prisma.letterAssignment.update({
      where: { id: assignmentId },
      data: { downloadAllowed },
    });

    await createAuditLog({
      userId,
      entity: 'LetterAssignment',
      entityId: assignmentId,
      action: 'UPDATE',
      oldValue: { downloadAllowed: assignment.downloadAllowed },
      newValue: { downloadAllowed },
      organizationId,
    });

    return updated;
  }

  // Soft delete letter + remove physical file
  async delete(id: string, userId: string, organizationId: string) {
    const letter = await prisma.letter.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!letter) throw new NotFoundError('Letter');

    // Delete the physical PDF file
    await storageService.deleteFile(letter.filePath);

    await prisma.letter.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await createAuditLog({
      userId,
      entity: 'Letter',
      entityId: id,
      action: 'DELETE',
      oldValue: { type: letter.type, title: letter.title },
      organizationId,
    });
  }

  // Get letters assigned to an employee (employee self-view)
  async getMyLetters(employeeId: string, organizationId: string) {
    const assignments = await prisma.letterAssignment.findMany({
      where: {
        employeeId,
        organizationId,
        letter: { deletedAt: null },
      },
      include: {
        letter: {
          include: {
            template: { select: { name: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return assignments;
  }

  // Stream letter as images for secure viewing (returns PDF buffer)
  async getLetterFile(letterId: string, employeeId: string | undefined, organizationId: string, isAdmin: boolean) {
    const letter = await prisma.letter.findFirst({
      where: { id: letterId, organizationId, deletedAt: null },
    });
    if (!letter || !letter.filePath) throw new NotFoundError('Letter');

    // If not admin, check assignment
    if (!isAdmin && employeeId) {
      const assignment = await prisma.letterAssignment.findFirst({
        where: { letterId, employeeId, organizationId },
      });
      if (!assignment) throw new ForbiddenError('You do not have access to this letter');

      // Mark as viewed
      if (!assignment.viewedAt) {
        await prisma.letterAssignment.update({
          where: { id: assignment.id },
          data: { viewedAt: new Date() },
        });
      }
    }

    const fullPath = storageService.resolvePath(letter.filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`[Letter] File not found on disk. id=${letterId} filePath=${letter.filePath} resolved=${fullPath}`);
      throw new NotFoundError('Letter file not found on server. Please re-generate the letter.');
    }

    return { fullPath, filePath: letter.filePath };
  }

  // Check if download is allowed for employee
  async canDownload(letterId: string, employeeId: string, organizationId: string): Promise<boolean> {
    const assignment = await prisma.letterAssignment.findFirst({
      where: { letterId, employeeId, organizationId },
    });
    return assignment?.downloadAllowed ?? false;
  }

  // Record download
  async recordDownload(letterId: string, employeeId: string, organizationId: string) {
    const assignment = await prisma.letterAssignment.findFirst({
      where: { letterId, employeeId, organizationId },
    });
    if (assignment) {
      await prisma.letterAssignment.update({
        where: { id: assignment.id },
        data: { downloadedAt: new Date() },
      });
    }
  }

  // Create letter from an uploaded PDF (no template generation)
  async createFromUpload(
    data: { type: string; title: string; employeeId: string; downloadAllowed: boolean },
    fileBuffer: Buffer,
    originalName: string,
    userId: string,
    organizationId: string,
  ) {
    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const outputDir = storageService.getAbsoluteDir(`letters/${organizationId}`);
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `UPLOAD-${employee.employeeCode || 'EMP'}-${Date.now()}-${safeName}`;
    const outputPath = path.join(outputDir, fileName);
    await fs.promises.writeFile(outputPath, fileBuffer);
    const filePath = storageService.buildUrl(`letters/${organizationId}`, fileName);

    return await prisma.$transaction(async (tx) => {
      const letter = await tx.letter.create({
        data: {
          type: data.type as LetterType,
          title: data.title,
          content: { source: 'upload', originalName },
          filePath,
          organizationId,
          issuedById: userId,
        },
      });

      await tx.letterAssignment.create({
        data: {
          letterId: letter.id,
          employeeId: data.employeeId,
          organizationId,
          downloadAllowed: data.downloadAllowed,
        },
      });

      await createAuditLog({
        userId,
        entity: 'Letter',
        entityId: letter.id,
        action: 'CREATE',
        newValue: { title: data.title, type: data.type, employeeId: data.employeeId, method: 'upload' },
        organizationId,
      });

      return letter;
    });
  }

  // Get available templates
  async getTemplates(organizationId: string) {
    // Return built-in templates + any custom ones
    const customTemplates = await prisma.letterTemplate.findMany({
      where: { organizationId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // Merge with built-in
    const builtIn = Object.entries(TEMPLATE_SCHEMES).map(([slug, scheme]) => ({
      slug,
      name: scheme.name,
      description: scheme.description,
      primary: scheme.primary,
      secondary: scheme.secondary,
      style: scheme.style,
      isBuiltIn: true,
    }));

    return { builtIn, custom: customTemplates };
  }

  // Ensure default templates exist in DB
  private async ensureDefaultTemplates(organizationId: string, requestedSlug: string) {
    const entries = Object.entries(TEMPLATE_SCHEMES);
    let found = null;

    for (const [slug, scheme] of entries) {
      const existing = await prisma.letterTemplate.findFirst({
        where: { slug, organizationId },
      });
      if (!existing) {
        const created = await prisma.letterTemplate.create({
          data: {
            name: scheme.name,
            slug,
            description: scheme.description,
            layout: scheme as any,
            isDefault: slug === 'modern-minimal',
            organizationId,
          },
        });
        if (slug === requestedSlug) found = created;
      } else if (slug === requestedSlug) {
        found = existing;
      }
    }
    return found;
  }
}

export const letterService = new LetterService();
