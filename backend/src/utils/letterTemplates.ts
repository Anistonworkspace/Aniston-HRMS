import PDFDocument from 'pdfkit';
import { aiService } from '../services/ai.service.js';
import { logger } from '../lib/logger.js';

export interface LetterEmployeeData {
  firstName: string;
  lastName: string;
  employeeCode: string;
  email: string;
  joiningDate: Date;
  lastWorkingDate?: Date | null;
  resignationDate?: Date | null;
  ctc?: any;
  department?: { name: string } | null;
  designation?: { name: string } | null;
  manager?: { firstName: string; lastName: string } | null;
  organization: { name: string; address?: any };
  salaryStructure?: { basic: any; hra: any; otherAllowances?: any } | null;
}

// =====================
// Helpers
// =====================

function formatDate(date: Date): string {
  const d = new Date(date);
  const day = d.getDate();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = months[d.getMonth()];
  const year = d.getFullYear();

  const suffix =
    day === 1 || day === 21 || day === 31
      ? 'st'
      : day === 2 || day === 22
        ? 'nd'
        : day === 3 || day === 23
          ? 'rd'
          : 'th';

  return `${day}${suffix} ${month} ${year}`;
}

function formatINR(value: any): string {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(num);
}

function drawLetterhead(
  doc: PDFKit.PDFDocument,
  orgName: string,
  address?: any,
): number {
  const leftCol = 50;
  const pageWidth = doc.page.width - 100;

  doc
    .fontSize(18)
    .font('Helvetica-Bold')
    .fillColor('#1a1a1a')
    .text(orgName, leftCol, 50, { align: 'center' });

  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#666666')
    .text('Enterprise Human Resource Management', leftCol, 72, {
      align: 'center',
    });

  if (address) {
    const addrText =
      typeof address === 'string'
        ? address
        : [address.line1, address.line2, address.city, address.state, address.pincode]
            .filter(Boolean)
            .join(', ');
    if (addrText) {
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#9ca3af')
        .text(addrText, leftCol, 86, { align: 'center' });
    }
  }

  const lineY = address ? 102 : 90;
  doc
    .moveTo(leftCol, lineY)
    .lineTo(leftCol + pageWidth, lineY)
    .strokeColor('#4F46E5')
    .lineWidth(2)
    .stroke();

  return lineY + 15;
}

function drawSignatureBlock(doc: PDFKit.PDFDocument, y: number): void {
  const leftCol = 50;

  doc
    .fontSize(10)
    .font('Helvetica-Bold')
    .fillColor('#1a1a1a')
    .text('For Aniston Technologies LLP', leftCol, y);

  y += 60;

  doc
    .moveTo(leftCol, y)
    .lineTo(leftCol + 180, y)
    .strokeColor('#d1d5db')
    .lineWidth(0.5)
    .stroke();

  y += 8;

  doc
    .fontSize(10)
    .font('Helvetica-Bold')
    .fillColor('#1a1a1a')
    .text('Authorized Signatory', leftCol, y);

  y += 16;

  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#6b7280')
    .text('Human Resources Department', leftCol, y);
}

function drawFooter(doc: PDFKit.PDFDocument): void {
  const leftCol = 50;
  const bottomY = doc.page.height - 60;

  doc
    .fontSize(7)
    .font('Helvetica')
    .fillColor('#9ca3af')
    .text(
      'This is a computer-generated document and does not require a physical signature.',
      leftCol,
      bottomY,
      { align: 'center' },
    );

  doc.text(
    `Generated on ${new Date().toLocaleDateString('en-IN')} by Aniston HRMS`,
    leftCol,
    bottomY + 12,
    { align: 'center' },
  );
}

// =====================
// AI Offer Letter Content Generator
// =====================

export async function generateAiOfferLetterContent(
  organizationId: string,
  data: { name: string; employeeCode: string; email: string; joiningDate: Date; designation: string; department: string; ctc: string; organization: string },
): Promise<{ openingParagraph: string; roleDescription: string; whyJoinUs: string; closingParagraph: string } | null> {
  try {
    const systemPrompt = `You are a professional HR letter writer for an Indian technology company.
Generate personalized offer letter content for this candidate.
Return a JSON object with: { "openingParagraph": string, "roleDescription": string, "whyJoinUs": string, "closingParagraph": string }
Keep it warm, professional, and specific to the role. Use Indian English.
Return ONLY valid JSON, no markdown or extra text.`;

    const userPrompt = `Generate personalized offer letter content for the following candidate:
Name: ${data.name}
Designation: ${data.designation}
Department: ${data.department}
CTC: ${data.ctc}
Joining Date: ${new Date(data.joiningDate).toLocaleDateString('en-IN')}
Organization: ${data.organization}`;

    const aiResponse = await aiService.prompt(organizationId, systemPrompt, userPrompt, 1024);

    const content = aiResponse.data || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);

    return parsed;
  } catch (err) {
    logger.warn(`[AI Offer Letter] Failed to generate AI content: ${(err as Error).message}`);
    return null;
  }
}

// =====================
// Offer Letter
// =====================

export function generateOfferLetterPDF(
  data: LetterEmployeeData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const leftCol = 50;
    const pageWidth = doc.page.width - 100;
    const currentYear = new Date().getFullYear();

    let y = drawLetterhead(doc, data.organization.name, data.organization.address);

    // Reference & Date
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#6b7280')
      .text(`REF: AT/HR/OL/${data.employeeCode}/${currentYear}`, leftCol, y);
    y += 14;
    doc.text(`Date: ${formatDate(new Date())}`, leftCol, y);
    y += 28;

    // Greeting
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(`Dear ${data.firstName} ${data.lastName},`, leftCol, y);
    y += 20;

    // Body
    const designation = data.designation?.name || 'the designated role';
    const department = data.department?.name || 'the assigned department';

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(
        `We are pleased to offer you the position of ${designation} in the ${department} department at Aniston Technologies LLP.`,
        leftCol,
        y,
        { width: pageWidth, lineGap: 4 },
      );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      'We are confident that your skills and experience will be a valuable addition to our team. The details of your compensation and terms of employment are outlined below.',
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 15;

    // Compensation Table
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#4F46E5')
      .text('COMPENSATION DETAILS', leftCol, y);
    y += 18;

    const colLabel = leftCol;
    const colValue = leftCol + 280;
    const rowHeight = 24;

    // Table header
    doc.rect(leftCol, y, pageWidth, rowHeight).fill('#4F46E5');
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#ffffff')
      .text('Component', colLabel + 10, y + 7)
      .text('Annual Amount', colValue, y + 7);
    y += rowHeight;

    const ctc = Number(data.ctc) || 0;
    const basic = Number(data.salaryStructure?.basic) || 0;
    const hra = Number(data.salaryStructure?.hra) || 0;
    const otherAllowances = Number(data.salaryStructure?.otherAllowances) || 0;

    const compRows = [
      ['Annual CTC', formatINR(ctc)],
      ['Basic Salary', formatINR(basic * 12)],
      ['House Rent Allowance (HRA)', formatINR(hra * 12)],
      ['Other Allowances', formatINR(otherAllowances * 12)],
    ];

    compRows.forEach(([label, amount], idx) => {
      const bgColor = idx % 2 === 0 ? '#f9fafb' : '#ffffff';
      doc.rect(leftCol, y, pageWidth, rowHeight).fill(bgColor);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#374151')
        .text(label, colLabel + 10, y + 7)
        .text(amount, colValue, y + 7);
      y += rowHeight;
    });

    // Border around table
    doc
      .rect(leftCol, y - rowHeight * (compRows.length + 1), pageWidth, rowHeight * (compRows.length + 1))
      .strokeColor('#e5e7eb')
      .lineWidth(0.5)
      .stroke();

    y += 20;

    // Terms
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#4F46E5')
      .text('TERMS OF EMPLOYMENT', leftCol, y);
    y += 18;

    const terms = [
      `Date of Joining: ${formatDate(data.joiningDate)}`,
      'Probation Period: 6 months from the date of joining',
      'Notice Period: 30 days during probation and post-confirmation',
    ];

    terms.forEach((term) => {
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#1a1a1a')
        .text(`•  ${term}`, leftCol + 10, y, { width: pageWidth - 10, lineGap: 4 });
      doc.moveDown(0.5);
      y = doc.y;
    });

    y += 15;

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(
        'Please confirm your acceptance by signing and returning this letter within 7 days of receipt.',
        leftCol,
        y,
        { width: pageWidth, lineGap: 4 },
      );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text('We look forward to welcoming you to the team.', leftCol, y, {
      width: pageWidth,
    });
    doc.moveDown(0.5);
    y = doc.y + 20;

    drawSignatureBlock(doc, y);
    drawFooter(doc);

    doc.end();
  });
}

// =====================
// Joining Letter
// =====================

export function generateJoiningLetterPDF(
  data: LetterEmployeeData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const leftCol = 50;
    const pageWidth = doc.page.width - 100;
    const currentYear = new Date().getFullYear();

    let y = drawLetterhead(doc, data.organization.name, data.organization.address);

    // Reference & Date
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#6b7280')
      .text(`REF: AT/HR/JL/${data.employeeCode}/${currentYear}`, leftCol, y);
    y += 14;
    doc.text(`Date: ${formatDate(new Date())}`, leftCol, y);
    y += 28;

    // Greeting
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(`Dear ${data.firstName} ${data.lastName},`, leftCol, y);
    y += 20;

    // Body
    const designation = data.designation?.name || 'the designated role';
    const department = data.department?.name || 'the assigned department';

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(
        `This is to confirm your appointment as ${designation} in the ${department} department, effective ${formatDate(data.joiningDate)}.`,
        leftCol,
        y,
        { width: pageWidth, lineGap: 4 },
      );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      'We are delighted to have you on board and are confident that your expertise will contribute significantly to the growth of our organization.',
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 15;

    // Employment Details Table
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#4F46E5')
      .text('EMPLOYMENT DETAILS', leftCol, y);
    y += 18;

    const colLabel = leftCol;
    const colValue = leftCol + 220;
    const rowHeight = 24;

    // Table header
    doc.rect(leftCol, y, pageWidth, rowHeight).fill('#4F46E5');
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#ffffff')
      .text('Particulars', colLabel + 10, y + 7)
      .text('Details', colValue, y + 7);
    y += rowHeight;

    const managerName = data.manager
      ? `${data.manager.firstName} ${data.manager.lastName}`
      : 'To be assigned';

    const detailRows = [
      ['Employee Code', data.employeeCode],
      ['Designation', designation],
      ['Department', department],
      ['Reporting Manager', managerName],
      ['Work Mode', 'As per organizational policy'],
      ['Probation Period', '6 months'],
    ];

    detailRows.forEach(([label, value], idx) => {
      const bgColor = idx % 2 === 0 ? '#f9fafb' : '#ffffff';
      doc.rect(leftCol, y, pageWidth, rowHeight).fill(bgColor);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#374151')
        .text(label, colLabel + 10, y + 7)
        .text(value, colValue, y + 7);
      y += rowHeight;
    });

    doc
      .rect(leftCol, y - rowHeight * (detailRows.length + 1), pageWidth, rowHeight * (detailRows.length + 1))
      .strokeColor('#e5e7eb')
      .lineWidth(0.5)
      .stroke();

    y += 20;

    // Terms & Conditions
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#4F46E5')
      .text('TERMS & CONDITIONS', leftCol, y);
    y += 18;

    const conditions = [
      'Working Hours: You are expected to adhere to the standard working hours as defined by the organization. Any overtime or flexible arrangements must be pre-approved by your reporting manager.',
      'Confidentiality: You shall maintain strict confidentiality of all proprietary information, trade secrets, and business strategies of the company. This obligation shall survive the termination of your employment.',
      'Code of Conduct: You are expected to conduct yourself in a professional manner at all times and comply with the company\'s policies, rules, and regulations as may be amended from time to time.',
      'Intellectual Property: Any work product, inventions, or innovations developed during the course of your employment shall be the exclusive property of the company.',
    ];

    conditions.forEach((condition, idx) => {
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#1a1a1a')
        .text(`${idx + 1}.  ${condition}`, leftCol, y, {
          width: pageWidth,
          lineGap: 4,
        });
      doc.moveDown(0.5);
      y = doc.y + 4;
    });

    y += 10;

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(
        'We wish you a successful and rewarding career with Aniston Technologies LLP.',
        leftCol,
        y,
        { width: pageWidth },
      );
    doc.moveDown(0.5);
    y = doc.y + 20;

    drawSignatureBlock(doc, y);
    drawFooter(doc);

    doc.end();
  });
}

// =====================
// Experience Letter
// =====================

export function generateExperienceLetterPDF(
  data: LetterEmployeeData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const leftCol = 50;
    const pageWidth = doc.page.width - 100;
    const currentYear = new Date().getFullYear();

    let y = drawLetterhead(doc, data.organization.name, data.organization.address);

    // Reference & Date
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#6b7280')
      .text(`REF: AT/HR/EXP/${data.employeeCode}/${currentYear}`, leftCol, y);
    y += 14;
    doc.text(`Date: ${formatDate(new Date())}`, leftCol, y);
    y += 35;

    // Title
    doc
      .fontSize(13)
      .font('Helvetica-Bold')
      .fillColor('#1a1a1a')
      .text('TO WHOM IT MAY CONCERN', leftCol, y, { align: 'center' });
    y += 35;

    // Body
    const designation = data.designation?.name || 'the designated role';
    const department = data.department?.name || 'the assigned department';
    const endDate = data.lastWorkingDate
      ? formatDate(new Date(data.lastWorkingDate))
      : 'present';

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(
        `This is to certify that ${data.firstName} ${data.lastName} (Employee Code: ${data.employeeCode}) was employed with Aniston Technologies LLP from ${formatDate(data.joiningDate)} to ${endDate}.`,
        leftCol,
        y,
        { width: pageWidth, lineGap: 4 },
      );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      `During their employment, they held the position of ${designation} in the ${department} department.`,
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      'During their tenure, they performed their duties diligently and their conduct was found to be satisfactory. They demonstrated professionalism, dedication, and a strong work ethic throughout their association with the organization.',
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      'We wish them all the best in their future endeavours.',
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      'This certificate is issued upon request and without any prejudice.',
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 30;

    drawSignatureBlock(doc, y);
    drawFooter(doc);

    doc.end();
  });
}

// =====================
// Relieving Letter
// =====================

export function generateRelievingLetterPDF(
  data: LetterEmployeeData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const leftCol = 50;
    const pageWidth = doc.page.width - 100;
    const currentYear = new Date().getFullYear();

    let y = drawLetterhead(doc, data.organization.name, data.organization.address);

    // Reference & Date
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#6b7280')
      .text(`REF: AT/HR/RL/${data.employeeCode}/${currentYear}`, leftCol, y);
    y += 14;
    doc.text(`Date: ${formatDate(new Date())}`, leftCol, y);
    y += 28;

    // Greeting
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(`Dear ${data.firstName} ${data.lastName},`, leftCol, y);
    y += 20;

    // Subject
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#1a1a1a')
      .text('Subject: Relieving Letter', leftCol, y);
    y += 25;

    // Body
    const resignationDate = data.resignationDate
      ? formatDate(new Date(data.resignationDate))
      : 'your submitted date';
    const lastWorkingDate = data.lastWorkingDate
      ? formatDate(new Date(data.lastWorkingDate))
      : 'the agreed date';

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(
        `This is to inform you that your resignation dated ${resignationDate} has been accepted and you have been relieved from your duties at Aniston Technologies LLP effective ${lastWorkingDate}.`,
        leftCol,
        y,
        { width: pageWidth, lineGap: 4 },
      );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      'All dues have been settled and there are no pending obligations from either side. Your full and final settlement has been processed as per the company policy.',
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      `Your employment details with the organization are as follows:`,
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 10;

    // Summary details
    const designation = data.designation?.name || 'N/A';
    const department = data.department?.name || 'N/A';

    const summaryRows = [
      ['Employee Code', data.employeeCode],
      ['Designation', designation],
      ['Department', department],
      ['Date of Joining', formatDate(data.joiningDate)],
      ['Last Working Date', lastWorkingDate],
    ];

    summaryRows.forEach(([label, value]) => {
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#374151')
        .text(`${label}: `, leftCol + 20, y, { continued: true })
        .font('Helvetica')
        .fillColor('#1a1a1a')
        .text(value);
      y = doc.y + 4;
    });

    y += 15;

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#1a1a1a')
      .text(
        'We appreciate your contributions during your tenure and wish you success in your future endeavours.',
        leftCol,
        y,
        { width: pageWidth, lineGap: 4 },
      );
    doc.moveDown(0.5);
    y = doc.y + 10;

    doc.text(
      'Please do not hesitate to reach out if you require any further documentation or assistance.',
      leftCol,
      y,
      { width: pageWidth, lineGap: 4 },
    );
    doc.moveDown(0.5);
    y = doc.y + 30;

    drawSignatureBlock(doc, y);
    drawFooter(doc);

    doc.end();
  });
}
