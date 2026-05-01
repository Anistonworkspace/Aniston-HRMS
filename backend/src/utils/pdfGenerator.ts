import PDFDocument from 'pdfkit';

interface PayrollRecordForPDF {
  id: string;
  grossSalary: any;
  netSalary: any;
  basic: any;
  hra: any;
  otherEarnings: any;
  epfEmployee: any;
  epfEmployer: any;
  esiEmployee: any;
  esiEmployer: any;
  professionalTax: any;
  tds: any;
  lopDays: any;     // Decimal in DB — use Number() before display
  lopDeduction: any;
  workingDays: number;
  presentDays: any; // Decimal in DB — use Number() before display
  overtimeHours?: any;
  overtimeAmount?: any;
  adjustments?: any;
  earningsBreakdown?: any;
  deductionsBreakdown?: any;
  createdAt: Date;
  employee: {
    firstName: string;
    lastName: string;
    employeeCode: string;
    email?: string;
    department?: { name: string } | null;
    designation?: { name: string } | null;
    bankAccountNumber?: string | null;
    bankName?: string | null;
    ifscCode?: string | null;
    accountHolderName?: string | null;
    organization?: { name: string } | null;
  };
  payrollRun: {
    month: number;
    year: number;
    organization?: { name: string } | null;
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function formatINR(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(value);
}

export function generateSalarySlipPDF(record: PayrollRecordForPDF, organizationName?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 100; // margin left + right
    const leftCol = 50;
    const rightCol = 320;

    // Resolve company name: explicit param > payrollRun org > employee org > fallback
    const companyName = organizationName
      || record.payrollRun?.organization?.name
      || record.employee?.organization?.name
      || 'Your Company';

    // =====================
    // Company Header
    // =====================
    doc.fontSize(18).font('Helvetica-Bold').text(companyName, leftCol, 50, { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#666666')
      .text('Enterprise Human Resource Management', leftCol, 72, { align: 'center' });

    doc.moveTo(leftCol, 90).lineTo(leftCol + pageWidth, 90).strokeColor('#4F46E5').lineWidth(2).stroke();

    // =====================
    // Pay Period
    // =====================
    const monthName = MONTH_NAMES[record.payrollRun.month - 1];
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text(`Salary Slip - ${monthName} ${record.payrollRun.year}`, leftCol, 100, { align: 'center' });

    // =====================
    // Employee Details
    // =====================
    let y = 130;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#4F46E5').text('EMPLOYEE DETAILS', leftCol, y);
    y += 5;
    doc.moveTo(leftCol, y + 12).lineTo(leftCol + pageWidth, y + 12).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    y += 20;

    // Mask account number: show only last 4 digits
    const maskedAccount = record.employee.bankAccountNumber
      ? `${'•'.repeat(Math.max(0, record.employee.bankAccountNumber.length - 4))}${record.employee.bankAccountNumber.slice(-4)}`
      : 'Not provided';
    const bankLabel = record.employee.bankName
      ? `${maskedAccount} (${record.employee.bankName})`
      : maskedAccount;

    const empDetails = [
      ['Employee Name', `${record.employee.firstName} ${record.employee.lastName}`],
      ['Employee Code', record.employee.employeeCode],
      ['Department', record.employee.department?.name || 'N/A'],
      ['Designation', record.employee.designation?.name || 'N/A'],
      ['Working Days', `${record.presentDays} / ${record.workingDays}`],
      ['LOP Days', `${record.lopDays}`],
      ['Bank Account', bankLabel],
      ['IFSC Code', record.employee.ifscCode || 'Not provided'],
    ];

    for (let i = 0; i < empDetails.length; i += 2) {
      const left = empDetails[i];
      const right = empDetails[i + 1];
      doc.fontSize(8).font('Helvetica').fillColor('#6b7280').text(left[0], leftCol, y);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a1a').text(left[1], leftCol + 100, y);
      if (right) {
        doc.fontSize(8).font('Helvetica').fillColor('#6b7280').text(right[0], rightCol, y);
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a1a').text(right[1], rightCol + 100, y);
      }
      y += 18;
    }

    y += 10;

    // =====================
    // Earnings & Deductions Tables Side by Side
    // =====================
    const tableTop = y;
    const colWidth = (pageWidth - 20) / 2;

    // Earnings Header
    doc.rect(leftCol, tableTop, colWidth, 22).fill('#4F46E5');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
      .text('EARNINGS', leftCol + 10, tableTop + 6);
    doc.text('Amount', leftCol + colWidth - 80, tableTop + 6);

    // Deductions Header
    const deductCol = leftCol + colWidth + 20;
    doc.rect(deductCol, tableTop, colWidth, 22).fill('#dc2626');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
      .text('DEDUCTIONS', deductCol + 10, tableTop + 6);
    doc.text('Amount', deductCol + colWidth - 80, tableTop + 6);

    // Earnings rows — use detailed breakdown if available, else fallback to legacy
    const earningsBreakdown = record.earningsBreakdown as Record<string, number> | null;
    const otherEarnings = record.otherEarnings as Record<string, number> | null;
    let earnings: [string, number][];
    if (earningsBreakdown && Object.keys(earningsBreakdown).length > 0) {
      earnings = Object.entries(earningsBreakdown)
        .filter(([_, val]) => val > 0)
        .map(([name, val]) => [name, val]);
    } else {
      earnings = [
        ['Basic Salary', Number(record.basic)],
        ['House Rent Allowance', Number(record.hra)],
        ['Dearness Allowance', Number(otherEarnings?.da || 0)],
        ['Transport Allowance', Number(otherEarnings?.ta || 0)],
        ['Medical Allowance', Number(otherEarnings?.medical || 0)],
        ['Special Allowance', Number(otherEarnings?.special || 0)],
      ].filter(([_, val]) => (val as number) > 0) as [string, number][];
    }

    // Deductions — use detailed breakdown if available, then add statutory
    const deductionsBreakdown = record.deductionsBreakdown as Record<string, number> | null;
    let deductions: [string, number][];
    if (deductionsBreakdown && Object.keys(deductionsBreakdown).length > 0) {
      deductions = Object.entries(deductionsBreakdown)
        .filter(([_, val]) => val > 0)
        .map(([name, val]) => [name, val]);
    } else {
      deductions = [];
    }
    // Always add statutory deductions
    const statutoryItems: [string, number][] = [
      ['EPF (Employee)', Number(record.epfEmployee || 0)],
      ['ESI (Employee)', Number(record.esiEmployee || 0)],
      ['Professional Tax', Number(record.professionalTax || 0)],
      ['TDS', Number(record.tds || 0)],
      ['LOP Deduction', Number(record.lopDeduction || 0)],
    ].filter(([_, val]) => Number(val) > 0) as [string, number][];
    // Merge statutory into deductions (avoid duplicates)
    const existingNames = new Set(deductions.map(([name]) => name));
    for (const item of statutoryItems) {
      if (!existingNames.has(item[0])) deductions.push(item);
    }

    // Add overtime if present
    if (Number(record.overtimeAmount || 0) > 0) {
      earnings.push(['Overtime', Number(record.overtimeAmount)]);
    }

    let ey = tableTop + 28;
    let totalEarnings = 0;
    for (const [label, amount] of earnings) {
      const bgColor = (earnings.indexOf([label, amount] as any) % 2 === 0) ? '#f9fafb' : '#ffffff';
      doc.rect(leftCol, ey - 2, colWidth, 18).fill(bgColor);
      doc.fontSize(8).font('Helvetica').fillColor('#374151').text(label as string, leftCol + 10, ey);
      doc.font('Helvetica').text(formatINR(amount as number), leftCol + colWidth - 80, ey);
      totalEarnings += amount as number;
      ey += 18;
    }

    // Earnings total
    doc.rect(leftCol, ey - 2, colWidth, 22).fill('#f0f0ff');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#4F46E5').text('Total Earnings', leftCol + 10, ey + 2);
    doc.text(formatINR(totalEarnings), leftCol + colWidth - 80, ey + 2);

    let dy = tableTop + 28;
    let totalDeductions = 0;
    for (const [label, amount] of deductions) {
      doc.rect(deductCol, dy - 2, colWidth, 18).fill(dy % 2 === 0 ? '#fff5f5' : '#ffffff');
      doc.fontSize(8).font('Helvetica').fillColor('#374151').text(label as string, deductCol + 10, dy);
      doc.font('Helvetica').text(formatINR(amount as number), deductCol + colWidth - 80, dy);
      totalDeductions += amount as number;
      dy += 18;
    }

    // Deductions total
    doc.rect(deductCol, dy - 2, colWidth, 22).fill('#fff0f0');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#dc2626').text('Total Deductions', deductCol + 10, dy + 2);
    doc.text(formatINR(totalDeductions), deductCol + colWidth - 80, dy + 2);

    // =====================
    // Net Pay
    // =====================
    const netPayY = Math.max(ey, dy) + 40;
    doc.rect(leftCol, netPayY, pageWidth, 36).fill('#4F46E5');
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff')
      .text('NET PAY', leftCol + 20, netPayY + 10);
    doc.fontSize(14).font('Helvetica-Bold')
      .text(formatINR(Number(record.netSalary)), leftCol + pageWidth - 200, netPayY + 9, { width: 180, align: 'right' });

    // =====================
    // Footer
    // =====================
    const footerY = netPayY + 60;
    doc.fontSize(7).font('Helvetica').fillColor('#9ca3af')
      .text('This is a computer-generated salary slip and does not require a signature.', leftCol, footerY, { align: 'center' });
    doc.text(`Generated on ${new Date().toLocaleDateString('en-IN')} by Aniston HRMS`, leftCol, footerY + 12, { align: 'center' });

    doc.end();
  });
}

interface OfferLetterData {
  candidateName: string;
  jobTitle: string;
  department?: string;
  ctc: number;
  basicSalary: number;
  joiningDate?: Date | null;
  companyName: string;
  offerDate?: Date;
}

export function generateOfferLetterPDF(data: OfferLetterData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 120;
    const left = 60;
    const offerDate = data.offerDate || new Date();
    const joiningDate = data.joiningDate
      ? data.joiningDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'To be confirmed';

    // Header
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#4F46E5')
      .text(data.companyName, left, 60, { align: 'center', width: pageWidth });
    doc.fontSize(9).font('Helvetica').fillColor('#6b7280')
      .text('Enterprise Human Resource Management', left, 84, { align: 'center', width: pageWidth });
    doc.moveTo(left, 102).lineTo(left + pageWidth, 102).strokeColor('#4F46E5').lineWidth(2).stroke();

    // Title
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text('OFFER OF EMPLOYMENT', left, 120, { align: 'center', width: pageWidth });

    // Date
    doc.fontSize(10).font('Helvetica').fillColor('#374151')
      .text(`Date: ${offerDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, left, 155);

    // Greeting
    let y = 185;
    doc.fontSize(10).font('Helvetica').fillColor('#374151')
      .text(`Dear ${data.candidateName},`, left, y);
    y += 20;
    doc.text(
      `We are pleased to extend this offer of employment to you for the position of ${data.jobTitle}${data.department ? ` in the ${data.department} department` : ''} at ${data.companyName}.`,
      left, y, { width: pageWidth }
    );
    y += 40;

    // Terms box
    doc.rect(left, y, pageWidth, 8).fill('#4F46E5');
    y += 8;
    doc.rect(left, y, pageWidth, 130).fill('#f9fafb');
    const termsLeft = left + 20;
    y += 18;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#4F46E5').text('TERMS OF EMPLOYMENT', termsLeft, y);
    y += 22;

    const drawRow = (label: string, value: string) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text(label, termsLeft, y);
      doc.fontSize(9).font('Helvetica').fillColor('#1a1a1a').text(value, termsLeft + 160, y);
      y += 18;
    };

    drawRow('Position:', data.jobTitle);
    if (data.department) drawRow('Department:', data.department);
    drawRow('Annual CTC:', formatINR(data.ctc));
    drawRow('Basic Salary (Monthly):', formatINR(data.basicSalary));
    drawRow('Date of Joining:', joiningDate);

    y += 20;

    // Body paragraphs
    doc.fontSize(10).font('Helvetica').fillColor('#374151')
      .text(
        'This offer is contingent upon successful completion of the onboarding process, including document verification and background checks as required by company policy.',
        left, y, { width: pageWidth }
      );
    y += 45;

    doc.text(
      'Please confirm your acceptance of this offer by completing the onboarding portal. If you have any questions, please contact the HR department.',
      left, y, { width: pageWidth }
    );
    y += 45;

    // Signature block
    doc.fontSize(10).font('Helvetica').fillColor('#374151').text('Yours sincerely,', left, y);
    y += 30;
    doc.moveTo(left, y).lineTo(left + 160, y).strokeColor('#374151').lineWidth(0.5).stroke();
    y += 8;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text('Authorised Signatory', left, y);
    doc.fontSize(9).font('Helvetica').text(data.companyName, left, y + 14);

    // Footer
    const footerY = doc.page.height - 60;
    doc.moveTo(left, footerY).lineTo(left + pageWidth, footerY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.fontSize(7).font('Helvetica').fillColor('#9ca3af')
      .text(
        'This is a computer-generated offer letter. For queries, contact HR.',
        left, footerY + 8, { align: 'center', width: pageWidth }
      );
    doc.text(`Generated on ${offerDate.toLocaleDateString('en-IN')} by Aniston HRMS`, left, footerY + 20, { align: 'center', width: pageWidth });

    doc.end();
  });
}
