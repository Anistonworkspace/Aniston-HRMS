import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError } from '../../middleware/errorHandler.js';
import PDFDocument from 'pdfkit';
import type { CreateInternProfileInput, UpdateInternProfileInput, CreateAchievementLetterInput } from './intern.validation.js';

export class InternService {
  async getProfile(employeeId: string) {
    const profile = await prisma.internProfile.findUnique({
      where: { employeeId },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true,
            email: true, department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
        mentor: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true,
            email: true, designation: { select: { name: true } },
          },
        },
        achievementLetters: { orderBy: { issuedAt: 'desc' } },
      },
    });

    return profile;
  }

  async createProfile(employeeId: string, data: CreateInternProfileInput) {
    const existing = await prisma.internProfile.findUnique({ where: { employeeId } });
    if (existing) throw new ConflictError('Intern profile already exists for this employee');

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundError('Employee');

    return prisma.internProfile.create({
      data: {
        employeeId,
        collegeUniversity: data.collegeUniversity,
        course: data.course,
        specialization: data.specialization,
        internshipStartDate: new Date(data.internshipStartDate),
        internshipEndDate: new Date(data.internshipEndDate),
        stipend: data.stipend,
        mentorId: data.mentorId,
        projectTitle: data.projectTitle,
      },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        mentor: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async updateProfile(employeeId: string, data: UpdateInternProfileInput) {
    const existing = await prisma.internProfile.findUnique({ where: { employeeId } });
    if (!existing) throw new NotFoundError('Intern profile');

    const updateData: any = { ...data };
    if (data.internshipStartDate) updateData.internshipStartDate = new Date(data.internshipStartDate);
    if (data.internshipEndDate) updateData.internshipEndDate = new Date(data.internshipEndDate);

    return prisma.internProfile.update({
      where: { employeeId },
      data: updateData,
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        mentor: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async getAchievementLetters(employeeId: string) {
    const profile = await prisma.internProfile.findUnique({ where: { employeeId } });
    if (!profile) return [];

    return prisma.internAchievementLetter.findMany({
      where: { internProfileId: profile.id },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async issueAchievementLetter(employeeId: string, data: CreateAchievementLetterInput) {
    const profile = await prisma.internProfile.findUnique({
      where: { employeeId },
      include: {
        employee: {
          select: { firstName: true, lastName: true, department: { select: { name: true } } },
        },
      },
    });
    if (!profile) throw new NotFoundError('Intern profile');

    return prisma.internAchievementLetter.create({
      data: {
        internProfileId: profile.id,
        title: data.title,
        description: data.description,
        issuedBy: data.issuedBy,
      },
    });
  }

  async generateAchievementLetterPdf(letterId: string): Promise<Buffer> {
    const letter = await prisma.internAchievementLetter.findUnique({
      where: { id: letterId },
      include: {
        internProfile: {
          include: {
            employee: {
              select: { firstName: true, lastName: true, department: { select: { name: true } } },
            },
          },
        },
      },
    });

    if (!letter) throw new NotFoundError('Achievement letter');

    const intern = letter.internProfile;
    const emp = intern.employee;
    const startDate = intern.internshipStartDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    const endDate = intern.internshipEndDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    const issuedDate = letter.issuedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 60, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(18).font('Helvetica-Bold').text('ANISTON TECHNOLOGIES LLP', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').fillColor('#666666')
        .text('New Delhi, India | www.anistonav.com', { align: 'center' });
      doc.moveDown(1);

      // Line separator
      doc.moveTo(60, doc.y).lineTo(535, doc.y).stroke('#4F46E5');
      doc.moveDown(1.5);

      // Title
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#1e1b4b')
        .text('LETTER OF ACHIEVEMENT', { align: 'center' });
      doc.moveDown(2);

      // Body
      doc.fontSize(12).font('Helvetica').fillColor('#333333');
      doc.text(`This is to certify that `, { continued: true });
      doc.font('Helvetica-Bold').text(`${emp.firstName} ${emp.lastName}`, { continued: true });
      doc.font('Helvetica').text(`, intern in the ${emp.department?.name || 'Engineering'} department from ${startDate} to ${endDate}, has been recognized for the following achievement:`);
      doc.moveDown(1.5);

      // Achievement title
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#4F46E5')
        .text(letter.title, { align: 'center' });
      doc.moveDown(1);

      // Description
      doc.fontSize(11).font('Helvetica').fillColor('#333333')
        .text(letter.description, { align: 'justify', lineGap: 4 });
      doc.moveDown(2);

      // Footer
      doc.fontSize(11).font('Helvetica').fillColor('#666666');
      doc.text(`Issued by: ${letter.issuedBy}`);
      doc.text(`Date: ${issuedDate}`);
      doc.moveDown(3);

      // Signature line
      doc.moveTo(60, doc.y).lineTo(250, doc.y).stroke('#333333');
      doc.moveDown(0.3);
      doc.fontSize(10).text('Authorized Signatory');
      doc.moveDown(0.5);
      doc.text('Aniston Technologies LLP');

      doc.end();
    });
  }
}

export const internService = new InternService();
