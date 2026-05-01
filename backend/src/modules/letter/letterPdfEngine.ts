import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { storageService } from '../../services/storage.service.js';
import { logger } from '../../lib/logger.js';

// Template color schemes
export const TEMPLATE_SCHEMES: Record<string, {
  name: string;
  description: string;
  primary: string;
  secondary: string;
  accent: string;
  headerBg: string;
  tableBg: string;
  bodyFont: string;
  headingFont: string;
  style: 'classic' | 'modern' | 'bold' | 'gradient' | 'warm' | 'elegant' | 'fresh';
}> = {
  'corporate-classic': {
    name: 'Corporate Classic',
    description: 'Traditional formal letterhead with navy and gold accents',
    primary: '#1B2A4A',
    secondary: '#C8A951',
    accent: '#1B2A4A',
    headerBg: '#1B2A4A',
    tableBg: '#F8F6F0',
    bodyFont: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    style: 'classic',
  },
  'modern-minimal': {
    name: 'Modern Minimal',
    description: 'Clean sans-serif with indigo accents and white space',
    primary: '#4F46E5',
    secondary: '#818CF8',
    accent: '#4F46E5',
    headerBg: '#4F46E5',
    tableBg: '#F5F3FF',
    bodyFont: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    style: 'modern',
  },
  'bold-executive': {
    name: 'Bold Executive',
    description: 'Dark header banner with teal highlights',
    primary: '#1F2937',
    secondary: '#0D9488',
    accent: '#0D9488',
    headerBg: '#1F2937',
    tableBg: '#F0FDFA',
    bodyFont: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    style: 'bold',
  },
  'vibrant-tech': {
    name: 'Vibrant Tech',
    description: 'Purple to blue gradient with modern layout',
    primary: '#7C3AED',
    secondary: '#3B82F6',
    accent: '#7C3AED',
    headerBg: '#7C3AED',
    tableBg: '#EDE9FE',
    bodyFont: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    style: 'gradient',
  },
  'warm-professional': {
    name: 'Warm Professional',
    description: 'Soft rounded elements with amber and brown',
    primary: '#92400E',
    secondary: '#D97706',
    accent: '#D97706',
    headerBg: '#92400E',
    tableBg: '#FFFBEB',
    bodyFont: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    style: 'warm',
  },
  'elegant-formal': {
    name: 'Elegant Formal',
    description: 'Bordered certificate-style with forest green',
    primary: '#166534',
    secondary: '#15803D',
    accent: '#166534',
    headerBg: '#166534',
    tableBg: '#F0FDF4',
    bodyFont: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    style: 'elegant',
  },
  'startup-fresh': {
    name: 'Startup Fresh',
    description: 'Colorful sidebar accent with coral and slate',
    primary: '#E11D48',
    secondary: '#64748B',
    accent: '#E11D48',
    headerBg: '#E11D48',
    tableBg: '#FFF1F2',
    bodyFont: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    style: 'fresh',
  },
};

interface BrandingData {
  logoUrl?: string | null;
  signatureUrl?: string | null;
  stampUrl?: string | null;
  companyName?: string | null;
  companyAddress?: string | null;
}

interface LetterData {
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  joiningDate: string;
  salary?: string;
  lastWorkingDate?: string;
  resignationDate?: string;
  customBody?: string;
  customFields?: Record<string, string>;
}

function resolveFilePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const full = storageService.resolvePath(url);
  return fs.existsSync(full) ? full : null;
}

function formatDateStr(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
    : (day === 2 || day === 22) ? 'nd'
    : (day === 3 || day === 23) ? 'rd' : 'th';
  return `${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatINR(value: string | undefined): string {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(num);
}

export function generateLetterPDF(
  type: string,
  templateSlug: string,
  letterData: LetterData,
  branding: BrandingData | null,
  orgName: string,
  orgAddress?: any,
): Promise<Buffer> {
  const scheme = TEMPLATE_SCHEMES[templateSlug] || TEMPLATE_SCHEMES['modern-minimal'];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const leftCol = 50;
    const pageWidth = doc.page.width - 100;
    const currentYear = new Date().getFullYear();

    // === HEADER WITH BRANDING ===
    let y = 40;

    // Logo (if exists)
    const logoPath = resolveFilePath(branding?.logoUrl);
    if (logoPath) {
      try {
        doc.image(logoPath, leftCol, y, { height: 50 });
        y += 55;
      } catch (err) {
        logger.error(`[LetterPDF] Failed to load logo: ${logoPath}`, { error: err });
        y += 5;
      }
    }

    // Company name
    const displayName = branding?.companyName || orgName;
    doc.fontSize(18).font(scheme.headingFont).fillColor(scheme.primary)
      .text(displayName, leftCol, y, { align: 'center' });
    y += 22;

    // Subtitle
    doc.fontSize(9).font(scheme.bodyFont).fillColor('#6b7280')
      .text('Enterprise Human Resource Management', leftCol, y, { align: 'center' });
    y += 14;

    // Address
    const displayAddr = branding?.companyAddress || (typeof orgAddress === 'string' ? orgAddress :
      orgAddress ? [orgAddress.line1, orgAddress.line2, orgAddress.city, orgAddress.state, orgAddress.pincode].filter(Boolean).join(', ') : '');
    if (displayAddr) {
      doc.fontSize(8).font(scheme.bodyFont).fillColor('#9ca3af')
        .text(displayAddr, leftCol, y, { align: 'center' });
      y += 14;
    }

    // Header line
    doc.moveTo(leftCol, y).lineTo(leftCol + pageWidth, y)
      .strokeColor(scheme.primary).lineWidth(2).stroke();
    y += 20;

    // === ELEGANT BORDER (for elegant template) ===
    if (scheme.style === 'elegant') {
      doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
        .strokeColor(scheme.primary).lineWidth(1.5).stroke();
      doc.rect(35, 35, doc.page.width - 70, doc.page.height - 70)
        .strokeColor(scheme.secondary).lineWidth(0.5).stroke();
    }

    // === SIDEBAR ACCENT (for fresh template) ===
    if (scheme.style === 'fresh') {
      doc.rect(0, 0, 8, doc.page.height).fill(scheme.primary);
    }

    // Reference
    const refPrefix = type === 'OFFER_LETTER' ? 'OL' : type === 'JOINING_LETTER' ? 'JL'
      : type === 'EXPERIENCE_LETTER' ? 'EXP' : type === 'RELIEVING_LETTER' ? 'RL'
      : type === 'PROMOTION_LETTER' ? 'PRM' : type === 'WARNING_LETTER' ? 'WRN'
      : type === 'APPRECIATION_LETTER' ? 'APR' : 'LTR';
    doc.fontSize(9).font(scheme.bodyFont).fillColor('#6b7280')
      .text(`REF: AT/HR/${refPrefix}/${letterData.employeeCode}/${currentYear}`, leftCol, y);
    y += 14;
    doc.text(`Date: ${formatDateStr(new Date().toISOString())}`, leftCol, y);
    y += 28;

    // Greeting
    doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
      .text(`Dear ${letterData.employeeName},`, leftCol, y);
    y += 24;

    // === LETTER BODY BY TYPE ===
    // If HR provided a custom body, render it instead of the default template
    if (letterData.customBody) {
      y = renderCustomBodyOverride(doc, scheme, letterData, leftCol, pageWidth, y);
    } else {
      switch (type) {
        case 'OFFER_LETTER':
          y = renderOfferLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
        case 'JOINING_LETTER':
          y = renderJoiningLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
        case 'EXPERIENCE_LETTER':
          y = renderExperienceLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
        case 'RELIEVING_LETTER':
          y = renderRelievingLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
        case 'PROMOTION_LETTER':
          y = renderPromotionLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
        case 'SALARY_SLIP_LETTER':
          y = renderSalarySlipLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
        case 'WARNING_LETTER':
          y = renderWarningLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
        case 'APPRECIATION_LETTER':
          y = renderAppreciationLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
        default:
          y = renderCustomLetter(doc, scheme, letterData, leftCol, pageWidth, y);
          break;
      }
    }

    // === SIGNATURE BLOCK WITH BRANDING ===
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = 50;
    }

    y += 20;
    doc.fontSize(10).font(scheme.headingFont).fillColor('#1a1a1a')
      .text(`For ${displayName}`, leftCol, y);
    y += 10;

    // Signature image (if exists)
    const sigPath = resolveFilePath(branding?.signatureUrl);
    if (sigPath) {
      try {
        doc.image(sigPath, leftCol, y, { height: 40 });
        y += 45;
      } catch (err) {
        logger.error(`[LetterPDF] Failed to load signature: ${sigPath}`, { error: err });
        y += 50;
      }
    } else {
      y += 50;
    }

    // Stamp image (if exists)
    const stampPath = resolveFilePath(branding?.stampUrl);
    if (stampPath) {
      try {
        doc.image(stampPath, leftCol + 250, y - 55, { height: 50 });
      } catch (err) {
        logger.error(`[LetterPDF] Failed to load stamp: ${stampPath}`, { error: err });
      }
    }

    doc.moveTo(leftCol, y).lineTo(leftCol + 180, y)
      .strokeColor('#d1d5db').lineWidth(0.5).stroke();
    y += 8;
    doc.fontSize(10).font(scheme.headingFont).fillColor('#1a1a1a')
      .text('Authorized Signatory', leftCol, y);
    y += 16;
    doc.fontSize(9).font(scheme.bodyFont).fillColor('#6b7280')
      .text('Human Resources Department', leftCol, y);

    // Footer
    const bottomY = doc.page.height - 60;
    doc.fontSize(7).font(scheme.bodyFont).fillColor('#9ca3af')
      .text('This is a computer-generated document.', leftCol, bottomY, { align: 'center' });
    doc.text(`Generated on ${new Date().toLocaleDateString('en-IN')} by Aniston HRMS`, leftCol, bottomY + 12, { align: 'center' });

    doc.end();
  });
}

// =====================
// Letter Type Renderers
// =====================

function renderOfferLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(`We are pleased to offer you the position of ${data.designation} in the ${data.department} department.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('We are confident that your skills and experience will be a valuable addition to our team. The details of your compensation and terms are outlined below.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 15;

  // Compensation table
  doc.fontSize(10).font(scheme.headingFont).fillColor(scheme.primary)
    .text('COMPENSATION DETAILS', leftCol, y);
  y += 18;

  const rowHeight = 24;
  doc.rect(leftCol, y, pageWidth, rowHeight).fill(scheme.headerBg);
  doc.fontSize(9).font(scheme.headingFont).fillColor('#ffffff')
    .text('Component', leftCol + 10, y + 7)
    .text('Amount', leftCol + 280, y + 7);
  y += rowHeight;

  const salaryVal = data.salary ? formatINR(data.salary) : 'As per offer';
  const rows = [['Annual CTC', salaryVal]];
  rows.forEach(([label, val], idx) => {
    doc.rect(leftCol, y, pageWidth, rowHeight).fill(idx % 2 === 0 ? scheme.tableBg : '#ffffff');
    doc.fontSize(9).font(scheme.bodyFont).fillColor('#374151')
      .text(label, leftCol + 10, y + 7).text(val, leftCol + 280, y + 7);
    y += rowHeight;
  });
  doc.rect(leftCol, y - rowHeight * 2, pageWidth, rowHeight * 2).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  y += 20;

  // Terms
  doc.fontSize(10).font(scheme.headingFont).fillColor(scheme.primary).text('TERMS OF EMPLOYMENT', leftCol, y);
  y += 18;
  const terms = [
    `Date of Joining: ${data.joiningDate ? formatDateStr(data.joiningDate) : 'To be confirmed'}`,
    'Probation Period: 6 months from the date of joining',
    'Notice Period: 30 days during probation and post-confirmation',
  ];
  terms.forEach((t) => {
    doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a').text(`•  ${t}`, leftCol + 10, y, { width: pageWidth - 10, lineGap: 4 });
    doc.moveDown(0.5); y = doc.y;
  });
  y += 15;
  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text('Please confirm your acceptance by signing and returning this letter within 7 days.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;
  doc.text('We look forward to welcoming you to the team.', leftCol, y, { width: pageWidth });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderJoiningLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(`This is to confirm your appointment as ${data.designation} in the ${data.department} department, effective ${data.joiningDate ? formatDateStr(data.joiningDate) : 'the agreed date'}.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('We are delighted to have you on board and are confident that your expertise will contribute significantly to the growth of our organization.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 15;

  // Employment Details Table
  doc.fontSize(10).font(scheme.headingFont).fillColor(scheme.primary).text('EMPLOYMENT DETAILS', leftCol, y);
  y += 18;
  const rowHeight = 24;
  doc.rect(leftCol, y, pageWidth, rowHeight).fill(scheme.headerBg);
  doc.fontSize(9).font(scheme.headingFont).fillColor('#ffffff')
    .text('Particulars', leftCol + 10, y + 7).text('Details', leftCol + 220, y + 7);
  y += rowHeight;

  const details = [
    ['Employee Code', data.employeeCode],
    ['Designation', data.designation],
    ['Department', data.department],
    ['Date of Joining', data.joiningDate ? formatDateStr(data.joiningDate) : 'N/A'],
    ['Probation Period', '6 months'],
  ];
  details.forEach(([label, val], idx) => {
    doc.rect(leftCol, y, pageWidth, rowHeight).fill(idx % 2 === 0 ? scheme.tableBg : '#ffffff');
    doc.fontSize(9).font(scheme.bodyFont).fillColor('#374151')
      .text(label, leftCol + 10, y + 7).text(val, leftCol + 220, y + 7);
    y += rowHeight;
  });
  y += 20;

  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text('We wish you a successful and rewarding career with the organization.', leftCol, y, { width: pageWidth });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderExperienceLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  // Title
  doc.fontSize(13).font(scheme.headingFont).fillColor('#1a1a1a')
    .text('TO WHOM IT MAY CONCERN', leftCol, y, { align: 'center' });
  y += 35;

  const endDate = data.lastWorkingDate ? formatDateStr(data.lastWorkingDate) : 'present';
  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(`This is to certify that ${data.employeeName} (Employee Code: ${data.employeeCode}) was employed with our organization from ${data.joiningDate ? formatDateStr(data.joiningDate) : 'the date of joining'} to ${endDate}.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text(`During their employment, they held the position of ${data.designation} in the ${data.department} department.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('During their tenure, they performed their duties diligently and their conduct was found to be satisfactory. They demonstrated professionalism, dedication, and a strong work ethic.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('We wish them all the best in their future endeavours.', leftCol, y, { width: pageWidth });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('This certificate is issued upon request and without any prejudice.', leftCol, y, { width: pageWidth });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderRelievingLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  doc.fontSize(10).font(scheme.headingFont).fillColor('#1a1a1a').text('Subject: Relieving Letter', leftCol, y);
  y += 25;

  const resignDate = data.resignationDate ? formatDateStr(data.resignationDate) : 'your submitted date';
  const lwdDate = data.lastWorkingDate ? formatDateStr(data.lastWorkingDate) : 'the agreed date';

  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(`This is to inform you that your resignation dated ${resignDate} has been accepted and you have been relieved from your duties effective ${lwdDate}.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('All dues have been settled and there are no pending obligations from either side. Your full and final settlement has been processed as per company policy.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  // Summary
  const rows = [
    ['Employee Code', data.employeeCode],
    ['Designation', data.designation],
    ['Department', data.department],
    ['Date of Joining', data.joiningDate ? formatDateStr(data.joiningDate) : 'N/A'],
    ['Last Working Date', lwdDate],
  ];
  rows.forEach(([label, val]) => {
    doc.fontSize(10).font(scheme.headingFont).fillColor('#374151').text(`${label}: `, leftCol + 20, y, { continued: true })
      .font(scheme.bodyFont).fillColor('#1a1a1a').text(val);
    y = doc.y + 4;
  });
  y += 15;

  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text('We appreciate your contributions and wish you success in your future endeavours.', leftCol, y, { width: pageWidth });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderPromotionLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  doc.fontSize(10).font(scheme.headingFont).fillColor(scheme.primary).text('Subject: Promotion Letter', leftCol, y);
  y += 25;

  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(`We are pleased to inform you that in recognition of your outstanding performance and dedication, you have been promoted to the position of ${data.designation} in the ${data.department} department.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  if (data.salary) {
    doc.text(`Your revised compensation will be ${formatINR(data.salary)} per annum, effective immediately.`, leftCol, y, { width: pageWidth, lineGap: 4 });
    doc.moveDown(0.5); y = doc.y + 10;
  }

  doc.text('We are confident that you will continue to excel in your new role and contribute to the growth of the organization.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('Congratulations and best wishes for your continued success!', leftCol, y, { width: pageWidth });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderWarningLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  doc.fontSize(10).font(scheme.headingFont).fillColor('#DC2626').text('Subject: Warning Letter', leftCol, y);
  y += 25;

  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(`This letter serves as a formal warning regarding your conduct/performance as ${data.designation} in the ${data.department} department.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  const reason = data.customFields?.reason || 'the issues discussed with you';
  doc.text(`The reason for this warning is: ${reason}`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('You are advised to take corrective action immediately. Failure to improve may result in further disciplinary action, up to and including termination of employment.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('Please acknowledge receipt of this letter by signing below.', leftCol, y, { width: pageWidth });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderAppreciationLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  doc.fontSize(10).font(scheme.headingFont).fillColor(scheme.primary).text('Subject: Letter of Appreciation', leftCol, y);
  y += 25;

  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(`We would like to express our sincere appreciation for your exceptional work as ${data.designation} in the ${data.department} department.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  const achievement = data.customFields?.achievement || 'your outstanding contributions';
  doc.text(`This letter is in recognition of ${achievement}. Your dedication and hard work are truly commendable.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('Your efforts have made a significant impact on the team and the organization as a whole. We are proud to have you as part of our team.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 10;

  doc.text('Keep up the excellent work!', leftCol, y, { width: pageWidth });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderSalarySlipLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  doc.fontSize(10).font(scheme.headingFont).fillColor(scheme.primary).text('SALARY CERTIFICATE', leftCol, y, { align: 'center' });
  y += 30;

  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(`This is to certify that ${data.employeeName} (Employee Code: ${data.employeeCode}) is employed with our organization as ${data.designation} in the ${data.department} department.`, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5); y = doc.y + 15;

  // Compensation table
  doc.fontSize(10).font(scheme.headingFont).fillColor(scheme.primary).text('COMPENSATION SUMMARY', leftCol, y);
  y += 18;

  const rowHeight = 24;
  doc.rect(leftCol, y, pageWidth, rowHeight).fill(scheme.headerBg);
  doc.fontSize(9).font(scheme.headingFont).fillColor('#ffffff')
    .text('Component', leftCol + 10, y + 7)
    .text('Amount (Per Annum)', leftCol + 280, y + 7);
  y += rowHeight;

  const ctc = data.salary ? formatINR(data.salary) : 'As per records';
  const rows: [string, string][] = [
    ['Gross Annual CTC', ctc],
    ['Date of Joining', data.joiningDate ? formatDateStr(data.joiningDate) : 'N/A'],
    ['Designation', data.designation],
    ['Department', data.department],
  ];

  rows.forEach(([label, val], idx) => {
    doc.rect(leftCol, y, pageWidth, rowHeight).fill(idx % 2 === 0 ? scheme.tableBg : '#ffffff');
    doc.fontSize(9).font(scheme.bodyFont).fillColor('#374151')
      .text(label, leftCol + 10, y + 7).text(val, leftCol + 280, y + 7);
    y += rowHeight;
  });
  doc.rect(leftCol, y - rowHeight * rows.length, pageWidth, rowHeight * rows.length)
    .strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  y += 20;

  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text('This certificate is issued upon request for the purpose of salary verification and without any prejudice.', leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderCustomBodyOverride(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(data.customBody!, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5);
  return doc.y + 10;
}

function renderCustomLetter(doc: PDFKit.PDFDocument, scheme: any, data: LetterData, leftCol: number, pageWidth: number, y: number): number {
  const body = data.customFields?.body || 'This is to inform you regarding the following matter.';
  doc.fontSize(10).font(scheme.bodyFont).fillColor('#1a1a1a')
    .text(body, leftCol, y, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.5);

  // Render any extra custom fields
  if (data.customFields) {
    y = doc.y + 10;
    Object.entries(data.customFields).forEach(([key, val]) => {
      if (key === 'body' || key === 'reason' || key === 'achievement') return;
      doc.fontSize(10).font(scheme.headingFont).fillColor('#374151')
        .text(`${key}: `, leftCol, y, { continued: true })
        .font(scheme.bodyFont).fillColor('#1a1a1a').text(val);
      y = doc.y + 4;
    });
  }

  return doc.y + 10;
}
