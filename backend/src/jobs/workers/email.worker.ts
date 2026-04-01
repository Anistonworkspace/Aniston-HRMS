import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

interface EmailJob {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
}

// Shared email layout wrapper — Outlook-compatible (uses tables, no flexbox)
function emailLayout(headerBg: string, iconText: string, title: string, subtitle: string, bodyHtml: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0;mso-table-rspace:0}img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}body{margin:0;padding:0;width:100%!important;font-family:'DM Sans',Arial,Helvetica,sans-serif}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}@media only screen and (max-width:620px){.email-container{width:100%!important;max-width:100%!important}.stack-column{display:block!important;width:100%!important}.pad-mobile{padding-left:20px!important;padding-right:20px!important}}</style>
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;">
<center style="width:100%;background-color:#F3F4F6;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;" class="email-container">
  <!-- Header -->
  <tr>
    <td style="background:${headerBg};padding:40px 32px;text-align:center;" class="pad-mobile">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
        <tr>
          <td style="width:56px;height:56px;background:rgba(255,255,255,0.2);text-align:center;vertical-align:middle;font-size:28px;font-weight:bold;color:#ffffff;" align="center">
            ${iconText}
          </td>
        </tr>
      </table>
      <h1 style="color:#ffffff;margin:16px 0 0;font-size:24px;font-weight:700;font-family:'DM Sans',Arial,sans-serif;">${title}</h1>
      ${subtitle ? `<p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;font-family:'DM Sans',Arial,sans-serif;">${subtitle}</p>` : ''}
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:36px 32px;background:#ffffff;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;font-family:'DM Sans',Arial,sans-serif;" class="pad-mobile">
      ${bodyHtml}
    </td>
  </tr>
  <!-- Footer -->
  <tr>
    <td style="padding:24px 32px;background:#F9FAFB;border:1px solid #E5E7EB;border-top:none;text-align:center;font-family:'DM Sans',Arial,sans-serif;" class="pad-mobile">
      ${footerHtml}
    </td>
  </tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</center>
</body>
</html>`;
}

function ctaButton(href: string, label: string, bg: string = '#4F46E5'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto;">
  <tr>
    <td style="background:${bg};padding:14px 36px;text-align:center;">
      <a href="${href}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;display:inline-block;">${label}</a>
    </td>
  </tr>
</table>`;
}

function standardFooter(orgName: string, fallbackUrl?: string, fallbackLabel?: string): string {
  const parts: string[] = [];
  if (fallbackUrl) {
    parts.push(`<p style="color:#9CA3AF;font-size:12px;margin:0 0 8px;">${fallbackLabel || 'If the button doesn\'t work, copy and paste this link:'}</p>`);
    parts.push(`<p style="color:#4F46E5;font-size:12px;word-break:break-all;margin:0 0 16px;">${fallbackUrl}</p>`);
  }
  parts.push(`<hr style="border:none;border-top:1px solid #E5E7EB;margin:16px 0;"/>`);
  parts.push(`<p style="color:#9CA3AF;font-size:11px;margin:0;">${orgName || 'Aniston Technologies'} | Powered by Aniston HRMS</p>`);
  parts.push(`<p style="color:#9CA3AF;font-size:11px;margin:4px 0 0;">If you didn't expect this email, you can safely ignore it.</p>`);
  return parts.join('');
}

// Email templates
const templates: Record<string, (ctx: Record<string, any>) => string> = {
  'onboarding-invite': (ctx) => emailLayout(
    '#4F46E5', 'A', 'Welcome to Aniston!', 'Complete your onboarding profile',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${ctx.name}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">You've been invited to join Aniston Technologies. Please complete your onboarding by clicking the button below:</p>
    ${ctaButton(ctx.link, 'Start Onboarding')}
    <p style="color:#6B7280;font-size:13px;margin:16px 0 0;">This link expires in 7 days.</p>`,
    standardFooter('Aniston Technologies', ctx.link)
  ),

  'employee-invite': (ctx) => emailLayout(
    '#4F46E5', 'A', "You're Invited!", `Join ${ctx.orgName} on Aniston HRMS`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      <strong>${ctx.inviterName || 'The HR team'}</strong> has invited you to join <strong>${ctx.orgName}</strong>${ctx.role && ctx.role !== 'EMPLOYEE' ? ` as <strong>${ctx.role.replace(/_/g, ' ')}</strong>` : ''}. Click the button below to set up your password and complete your profile.
    </p>

    ${ctaButton(ctx.inviteUrl, 'Accept Invitation & Set Password')}

    <!-- What happens next -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F0FF;margin:24px 0;">
      <tr><td style="padding:20px;">
        <p style="color:#4338CA;font-weight:600;margin:0 0 10px;font-size:14px;">What happens next?</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;width:24px;">1.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Set your password on the invite page</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">2.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Log in with your email and new password</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">3.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Complete your profile and upload documents</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">4.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Install the app on your phone for attendance &amp; more</td></tr>
        </table>
      </td></tr>
    </table>

    <!-- Download App Section -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 24px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="vertical-align:top;width:44px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:40px;height:40px;background:#DBEAFE;text-align:center;vertical-align:middle;font-size:20px;">&#128241;</td></tr></table>
            </td>
            <td style="padding-left:12px;">
              <p style="color:#1E40AF;font-weight:700;margin:0 0 4px;font-size:14px;">Download Aniston HRMS App</p>
              <p style="color:#1E3A5F;font-size:12px;margin:0 0 12px;line-height:1.5;">Install the app on your phone or desktop to mark attendance, apply for leaves, view payslips, and access all HR features on the go.</p>
              ${ctaButton(ctx.downloadUrl || 'https://hr.anistonav.com/download', 'Install App', '#2563EB')}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="padding:4px 0;color:#3B82F6;font-size:11px;">&#8226; Works on Android, iPhone, Windows &amp; Mac</td></tr>
                <tr><td style="padding:4px 0;color:#3B82F6;font-size:11px;">&#8226; Tap "Install" or "Add to Home Screen" when prompted</td></tr>
                <tr><td style="padding:4px 0;color:#3B82F6;font-size:11px;">&#8226; Allow Location &amp; Notification permissions (required)</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Pre-Joining Documents Section -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFBEB;border:1px solid #FDE68A;margin:24px 0;">
      <tr><td style="padding:20px;">
        <p style="color:#92400E;font-weight:700;margin:0 0 6px;font-size:15px;">Pre-Joining Documents Required</p>
        <p style="color:#78350F;font-size:13px;margin:0 0 14px;line-height:1.5;">
          As part of the pre-joining formalities, please submit the following documents for verification and record-keeping.
          Combine all documents into <strong>one single PDF</strong> named: <strong>YourName_PreJoiningDocs.pdf</strong>
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:8px 0 4px;color:#92400E;font-weight:600;font-size:13px;" colspan="2">1. Education Certificates</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; 10th &amp; 12th Marksheet / Certificate</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; Diploma / Degree Certificate</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; Post-Graduation Certificate (if applicable)</td></tr>

          <tr><td style="padding:8px 0 4px;color:#92400E;font-weight:600;font-size:13px;" colspan="2">2. Identity Proof (any one)</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; Aadhaar Card / Passport / Driving License / Voter ID</td></tr>

          <tr><td style="padding:8px 0 4px;color:#92400E;font-weight:600;font-size:13px;" colspan="2">3. PAN Card (Mandatory)</td></tr>

          <tr><td style="padding:8px 0 4px;color:#92400E;font-weight:600;font-size:13px;" colspan="2">4. Residence Proof</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; Own House: Electricity / Water / Gas Bill</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; On Rent: Rent Agreement + Owner's Utility Bill (same address)</td></tr>

          <tr><td style="padding:8px 0 4px;color:#92400E;font-weight:600;font-size:13px;" colspan="2">5. Passport Size Photographs</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; 2 recent photographs</td></tr>

          <tr><td style="padding:8px 0 4px;color:#92400E;font-weight:600;font-size:13px;" colspan="2">6. Previous Employment (if applicable)</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; Offer / Appointment Letter</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; Last 3 Salary Slips OR Bank Statements (showing salary credit)</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; Relieving / Experience Letter</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; If serving notice: Resignation Acceptance Mail + HR Confirmation</td></tr>

          <tr><td style="padding:8px 0 4px;color:#92400E;font-weight:600;font-size:13px;" colspan="2">7. Additional (if applicable)</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; Professional Certifications</td></tr>
          <tr><td style="padding:2px 0 2px 16px;color:#78350F;font-size:12px;" colspan="2">&#8226; PF / ESIC Number from last employer</td></tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF3C7;margin-top:14px;">
          <tr><td style="padding:12px;">
            <p style="color:#92400E;font-weight:600;font-size:12px;margin:0 0 6px;">Submission Guidelines</p>
            <p style="color:#78350F;font-size:12px;margin:0;line-height:1.6;">
              &#8226; All documents should be clearly scanned (PDF format preferred; avoid mobile screenshots)<br/>
              &#8226; Arrange in order: ID Proof &rarr; PAN Card &rarr; Education &rarr; Employment &rarr; Photographs<br/>
              &#8226; Combine all into one single PDF file<br/>
              &#8226; File name format: <strong>YourName_PreJoiningDocs.pdf</strong> (e.g., RahulSharma_PreJoiningDocs.pdf)
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>

    <p style="color:#EF4444;font-size:13px;margin:16px 0 0;">
      <strong>Expires:</strong> ${new Date(ctx.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (72 hours from now)
    </p>`,
    standardFooter(ctx.orgName, ctx.inviteUrl)
  ),

  'password-reset': (ctx) => emailLayout(
    '#4F46E5', 'A', 'Password Reset', 'Reset your Aniston HRMS password',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${ctx.name}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">We received a request to reset your password. Click the button below to create a new password:</p>
    ${ctaButton(ctx.link, 'Reset Password')}
    <p style="color:#6B7280;font-size:13px;margin:16px 0 0;">If you didn't request this, you can safely ignore this email.</p>`,
    standardFooter('Aniston Technologies', ctx.link)
  ),

  'leave-approved': (ctx) => emailLayout(
    ctx.status === 'Approved' ? '#059669' : '#DC2626',
    ctx.status === 'Approved' ? '&#10003;' : '&#10007;',
    `Leave ${ctx.status}`,
    'Leave request update',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${ctx.name}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Your leave request from <strong>${ctx.startDate}</strong> to <strong>${ctx.endDate}</strong> has been <strong>${ctx.status.toLowerCase()}</strong>.</p>
    ${ctx.remarks ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;margin:16px 0;"><tr><td style="padding:16px;"><p style="color:#6B7280;font-size:14px;margin:0;"><strong>Remarks:</strong> ${ctx.remarks}</p></td></tr></table>` : ''}`,
    standardFooter('Aniston Technologies')
  ),

  'resignation-submitted': (ctx) => emailLayout(
    '#DC2626', '!', 'Resignation Notice', 'Employee resignation submitted',
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;"><strong>${ctx.name}</strong> (${ctx.employeeCode}) has submitted their resignation.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
      <tr><td style="padding:10px 0;color:#6B7280;font-size:14px;width:140px;border-bottom:1px solid #F3F4F6;">Department</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">${ctx.department || 'N/A'}</td></tr>
      <tr><td style="padding:10px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Last Working Date</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">${ctx.lastWorkingDate}</td></tr>
      <tr><td style="padding:10px 0;color:#6B7280;font-size:14px;">Reason</td><td style="padding:10px 0;font-size:14px;color:#111827;">${ctx.reason}</td></tr>
    </table>
    ${ctaButton(ctx.link, 'Review in HRMS Portal')}`,
    standardFooter('Aniston Technologies', ctx.link)
  ),

  'exit-approved': (ctx) => emailLayout(
    '#4F46E5', '&#10003;', 'Resignation Approved', 'Your resignation has been approved',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${ctx.name}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Your resignation has been approved. Your last working date is <strong>${ctx.lastWorkingDate}</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFF7ED;border:1px solid #FDE68A;margin:16px 0;">
      <tr><td style="padding:20px;">
        <p style="color:#92400E;font-weight:600;font-size:14px;margin:0 0 10px;">Please ensure the following before your last day:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:4px 0;color:#78350F;font-size:13px;">&#8226; Return all assigned assets (laptop, access card, etc.)</td></tr>
          <tr><td style="padding:4px 0;color:#78350F;font-size:13px;">&#8226; Complete knowledge transfer with your team</td></tr>
          <tr><td style="padding:4px 0;color:#78350F;font-size:13px;">&#8226; Clear any pending no-dues items</td></tr>
        </table>
      </td></tr>
    </table>
    ${ctx.notes ? `<p style="color:#6B7280;font-size:14px;margin:16px 0 0;"><strong>Notes from HR:</strong> ${ctx.notes}</p>` : ''}`,
    standardFooter('Aniston Technologies')
  ),

  'exit-completed': (ctx) => emailLayout(
    '#059669', '&#10003;', 'Exit Process Complete', 'All formalities have been completed',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${ctx.name}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">Your exit process from Aniston Technologies has been completed successfully.</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">All no-dues have been cleared and your account has been deactivated.</p>
    <p style="color:#6B7280;font-size:14px;line-height:1.6;margin:24px 0 0;">We wish you all the very best for your future endeavours. Thank you for your contributions to Aniston Technologies.</p>`,
    standardFooter('Aniston Technologies')
  ),

  'job-share': (ctx) => emailLayout(
    '#4F46E5', 'A', `Job Opening at ${ctx.orgName}`, ctx.jobTitle,
    `<h2 style="color:#111827;margin:0 0 16px;font-size:20px;">${ctx.jobTitle}</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
      ${ctx.department ? `<tr><td style="padding:10px 0;color:#6B7280;font-size:14px;width:120px;border-bottom:1px solid #F3F4F6;">Department</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">${ctx.department}</td></tr>` : ''}
      ${ctx.location ? `<tr><td style="padding:10px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Location</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">${ctx.location}</td></tr>` : ''}
      ${ctx.type ? `<tr><td style="padding:10px 0;color:#6B7280;font-size:14px;">Type</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;">${ctx.type.replace(/_/g, ' ')}</td></tr>` : ''}
    </table>
    ${ctx.customMessage ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;"><tr><td style="padding:12px;background:#F9FAFB;border-left:3px solid #4F46E5;color:#4B5563;font-size:14px;">${ctx.customMessage}</td></tr></table>` : ''}
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px;">We have an exciting opportunity that might interest you. Click the button below to learn more and apply:</p>
    ${ctaButton(ctx.applyUrl, 'Apply Now')}`,
    standardFooter(ctx.orgName, ctx.applyUrl, 'If the button doesn\'t work, copy and paste this link into your browser:')
  ),

  'app-download': (ctx) => emailLayout(
    '#4F46E5', 'A', 'Download Aniston HRMS App', 'Mark attendance, apply leaves, and more — right from your phone',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello <strong>${ctx.employeeName || 'there'}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">
      ${ctx.orgName} uses <strong>Aniston HRMS</strong> for attendance tracking, leave management, and more. Please install the app on your phone to mark your daily attendance.
    </p>
    ${ctaButton(ctx.downloadUrl, 'Install App Now')}

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F0FF;margin:24px 0;">
      <tr><td style="padding:20px;">
        <p style="color:#4338CA;font-weight:600;margin:0 0 12px;font-size:14px;">How to install:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:6px 0;color:#4B5563;font-size:13px;vertical-align:top;width:24px;">1.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Click the <strong>"Install App Now"</strong> button above</td></tr>
          <tr><td style="padding:6px 0;color:#4B5563;font-size:13px;vertical-align:top;">2.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Tap <strong>"Install"</strong> or <strong>"Add to Home Screen"</strong> when prompted</td></tr>
          <tr><td style="padding:6px 0;color:#4B5563;font-size:13px;vertical-align:top;">3.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Open the app from your home screen</td></tr>
          <tr><td style="padding:6px 0;color:#4B5563;font-size:13px;vertical-align:top;">4.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Login with your email and password</td></tr>
          <tr><td style="padding:6px 0;color:#4B5563;font-size:13px;vertical-align:top;">5.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;"><strong>Allow location &amp; notification permissions</strong> when asked</td></tr>
        </table>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF3C7;border:1px solid #FCD34D;margin:16px 0;">
      <tr><td style="padding:16px;">
        <p style="color:#92400E;font-weight:600;margin:0 0 6px;font-size:13px;">Important</p>
        <p style="color:#78350F;font-size:12px;margin:0;">You <strong>must</strong> allow <strong>Location Permission</strong> for the attendance system to work. Without it, you cannot mark your attendance.</p>
      </td></tr>
    </table>`,
    standardFooter(ctx.orgName, ctx.downloadUrl, 'If the button doesn\'t work, open this link in your phone browser:')
  ),

  'attendance-instructions': (ctx) => emailLayout(
    '#059669', 'A', 'Attendance Instructions', 'How to mark your daily attendance using Aniston HRMS',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello <strong>${ctx.employeeName || 'there'}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Please follow these instructions to mark your attendance daily using the Aniston HRMS app.
    </p>

    ${ctx.shiftInfo ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#1E40AF;font-weight:600;margin:0 0 8px;font-size:14px;">Your Shift</p>
        <p style="color:#1E3A5F;font-size:14px;margin:0;"><strong>${ctx.shiftInfo}</strong></p>
      </td></tr>
    </table>` : ''}

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0FDF4;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#166534;font-weight:600;margin:0 0 12px;font-size:14px;">Daily Attendance Steps:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:8px 0;color:#166534;font-size:13px;vertical-align:top;width:24px;"><strong>1.</strong></td><td style="padding:8px 0;color:#15803D;font-size:13px;">Open <strong>Aniston HRMS</strong> app from your home screen</td></tr>
          <tr><td style="padding:8px 0;color:#166534;font-size:13px;vertical-align:top;"><strong>2.</strong></td><td style="padding:8px 0;color:#15803D;font-size:13px;">Tap the <strong>green "Check In"</strong> button at the bottom center</td></tr>
          <tr><td style="padding:8px 0;color:#166534;font-size:13px;vertical-align:top;"><strong>3.</strong></td><td style="padding:8px 0;color:#15803D;font-size:13px;"><strong>Allow location access</strong> if prompted (REQUIRED)</td></tr>
          <tr><td style="padding:8px 0;color:#166534;font-size:13px;vertical-align:top;"><strong>4.</strong></td><td style="padding:8px 0;color:#15803D;font-size:13px;">At the end of your shift, tap the <strong>red "Check Out"</strong> button</td></tr>
        </table>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF3C7;border:1px solid #FCD34D;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#92400E;font-weight:600;margin:0 0 8px;font-size:13px;">Mandatory Requirements</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; <strong>Location Permission:</strong> Must be ON at all times. Without it, attendance cannot be marked.</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; <strong>Notification Permission:</strong> Must be allowed for shift reminders and alerts.</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; <strong>Internet Connection:</strong> Required for real-time attendance sync.</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; <strong>Mark attendance from office only</strong> — geofence is enabled.</td></tr>
        </table>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEE2E2;border:1px solid #FECACA;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#991B1B;font-weight:600;margin:0 0 6px;font-size:13px;">Do NOT</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:2px 0;color:#991B1B;font-size:12px;">&#8226; Use GPS spoofing or fake location apps</td></tr>
          <tr><td style="padding:2px 0;color:#991B1B;font-size:12px;">&#8226; Ask someone else to mark your attendance (proxy attendance = termination)</td></tr>
          <tr><td style="padding:2px 0;color:#991B1B;font-size:12px;">&#8226; Disable location after checking in</td></tr>
        </table>
      </td></tr>
    </table>

    ${ctx.downloadUrl ? `<p style="color:#6B7280;font-size:13px;margin:0 0 12px;text-align:center;">Haven't installed the app yet?</p>
    ${ctaButton(ctx.downloadUrl, 'Download App')}` : ''}`,
    `<p style="color:#9CA3AF;font-size:11px;margin:0;">For help, contact HR at ${ctx.hrEmail || 'hr@anistonav.com'}</p>
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:12px 0;"/>
    <p style="color:#9CA3AF;font-size:11px;margin:0;">${ctx.orgName} | Powered by Aniston HRMS</p>`
  ),

  'document-batch-submitted': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Documents Uploaded</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${ctx.orgName}</p>
      </div>
      <div style="padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          <strong>${ctx.employeeName}</strong> (${ctx.employeeCode}) has uploaded <strong>${ctx.documents.length}</strong> document${ctx.documents.length > 1 ? 's' : ''} for review:
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr style="background: #F9FAFB;">
            <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #6B7280; border-bottom: 1px solid #E5E7EB;">Document</th>
            <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #6B7280; border-bottom: 1px solid #E5E7EB;">Type</th>
          </tr>
          ${ctx.documents.map((d: any) => `
            <tr>
              <td style="padding: 8px 12px; font-size: 13px; color: #111827; border-bottom: 1px solid #F3F4F6;">${d.name}</td>
              <td style="padding: 8px 12px; font-size: 13px; color: #6B7280; border-bottom: 1px solid #F3F4F6;">${d.type.replace(/_/g, ' ')}</td>
            </tr>
          `).join('')}
        </table>
        <a href="${ctx.reviewUrl}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0; font-weight: 600;">
          Review Documents
        </a>
      </div>
    </div>
  `,

  'generic': (ctx) => emailLayout(
    '#4F46E5', 'A', ctx.title || 'Notification', '',
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0;">${ctx.message || ''}</p>`,
    standardFooter('Aniston Technologies')
  ),

  'document-submitted': (ctx) => emailLayout(
    '#4F46E5', 'A', 'Document Submitted for Review', `${ctx.employeeName} uploaded a document`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello HR Team,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      <strong>${ctx.employeeName}</strong> (${ctx.employeeCode}) has uploaded a new document that requires your review.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;margin:16px 0;">
      <tr><td style="padding:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;width:130px;">Document Type</td><td style="padding:6px 0;font-weight:600;font-size:14px;color:#111827;">${ctx.documentType?.replace(/_/g, ' ') || 'N/A'}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;">Document Name</td><td style="padding:6px 0;font-weight:600;font-size:14px;color:#111827;">${ctx.documentName}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;">Uploaded At</td><td style="padding:6px 0;font-size:14px;color:#111827;">${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>
        </table>
      </td></tr>
    </table>
    ${ctaButton(ctx.reviewUrl, 'Review Document in HRMS')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies', ctx.reviewUrl)
  ),

  'document-tamper-alert': (ctx) => emailLayout(
    '#DC2626', '!', 'Suspicious Document Alert', `Possible fake or altered document detected`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello HR Team,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      A document uploaded by <strong>${ctx.employeeName}</strong> (${ctx.employeeCode}) has been automatically flagged as suspicious by the OCR verification system.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;margin:16px 0;">
      <tr><td style="padding:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;width:130px;">Document Type</td><td style="padding:6px 0;font-weight:600;font-size:14px;color:#111827;">${ctx.documentType || 'N/A'}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;">Document Name</td><td style="padding:6px 0;font-weight:600;font-size:14px;color:#111827;">${ctx.documentName}</td></tr>
        </table>
      </td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEE2E2;border:1px solid #FECACA;margin:16px 0;">
      <tr><td style="padding:16px;">
        <p style="color:#991B1B;font-weight:600;margin:0 0 8px;font-size:14px;">Issues Detected:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${(ctx.issues || []).map((issue: string) => `<tr><td style="padding:3px 0;color:#991B1B;font-size:13px;">&#8226; ${issue}</td></tr>`).join('')}
        </table>
      </td></tr>
    </table>
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0;">Please review this document immediately and take appropriate action.</p>
    ${ctaButton(ctx.reviewUrl, 'Review in HRMS Portal', '#DC2626')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies', ctx.reviewUrl)
  ),

  'holiday-notification': (ctx) => emailLayout(
    ctx.isEvent ? 'Company Event' : 'Holiday Announcement',
    ctx.isEvent
      ? `<p style="font-size:40px;margin:0 0 4px;">📅</p>`
      : `<p style="font-size:40px;margin:0 0 4px;">🎉</p>`,
    ctx.color || '#4F46E5',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 12px;">Hello <strong>${ctx.employeeName || 'there'}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      ${ctx.isEvent ? 'A new company event has been scheduled' : 'A holiday has been announced'}:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${ctx.isEvent ? '#FFF7ED' : '#EEF2FF'};border:1px solid ${ctx.isEvent ? '#FED7AA' : '#C7D2FE'};margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:${ctx.isEvent ? '#C2410C' : '#4338CA'};font-weight:700;font-size:18px;margin:0 0 8px;">${ctx.holidayName}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;width:80px;">Date</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${ctx.holidayDate}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;">Type</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${ctx.typeLabel}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;">Timing</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${ctx.timingInfo}</td>
          </tr>
        </table>
        ${ctx.description ? `<p style="color:#4B5563;font-size:13px;margin:12px 0 0;line-height:1.5;border-top:1px solid ${ctx.isEvent ? '#FED7AA' : '#C7D2FE'};padding-top:12px;">${ctx.description}</p>` : ''}
      </td></tr>
    </table>`,
    standardFooter(ctx.orgName)
  ),

  'geofence-violation': (ctx) => emailLayout(
    '#DC2626', '!', 'Geofence Alert', `Employee attendance marked outside office location`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello HR Team,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      <strong>${ctx.employeeName}</strong> (${ctx.employeeCode}) has marked attendance <strong>outside</strong> the assigned office geofence.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF2F2;margin:16px 0;">
      <tr><td style="padding:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;width:130px;">Employee</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${ctx.employeeName} (${ctx.employeeCode})</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;">Assigned Location</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${ctx.locationName}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;">Distance from Office</td>
            <td style="padding:4px 0;color:#DC2626;font-size:13px;font-weight:600;">${ctx.distance}m (allowed: ${ctx.allowedRadius}m)</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;">Check-in Time</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${ctx.checkInTime}</td>
          </tr>
        </table>
      </td></tr>
    </table>
    <p style="color:#6B7280;font-size:13px;margin:16px 0 0;">Please review this attendance record and take appropriate action if needed.</p>`,
    standardFooter(ctx.orgName || 'Aniston Technologies')
  ),
};

/**
 * Get email config from database settings (falls back to env vars)
 */
async function getEmailConfig(): Promise<{
  authMethod: 'smtp' | 'oauth2';
  host: string;
  port: number;
  user: string;
  pass: string;
  fromAddress: string;
  fromName: string;
  // OAuth2 (Microsoft 365 Graph API)
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  senderEmail?: string;
} | null> {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const org = await prisma.organization.findFirst({ select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const email = settings.email;

    if (email?.authMethod === 'oauth2' && email?.tenantId && email?.clientId && email?.clientSecret) {
      return {
        authMethod: 'oauth2',
        host: '', port: 0, user: '', pass: '',
        fromAddress: email.senderEmail || email.fromAddress || '',
        fromName: email.fromName || 'Aniston HRMS',
        tenantId: email.tenantId,
        clientId: email.clientId,
        clientSecret: email.clientSecret,
        senderEmail: email.senderEmail || email.fromAddress,
      };
    }

    if (email?.host && email?.user && email?.pass) {
      return {
        authMethod: 'smtp',
        host: email.host,
        port: email.port || 587,
        user: email.user,
        pass: email.pass,
        fromAddress: email.fromAddress || email.user,
        fromName: email.fromName || 'Aniston HRMS',
      };
    }
  } catch (err) {
    logger.warn('Could not read email config from DB, falling back to env vars');
  }

  // Fallback to env vars
  if (env.SMTP_USER && env.SMTP_PASS) {
    return {
      authMethod: 'smtp',
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      fromAddress: env.SMTP_FROM,
      fromName: 'Aniston HRMS',
    };
  }

  return null;
}

/**
 * Send email via Microsoft 365 Graph API (OAuth2 Client Credentials)
 */
async function sendViaGraphApi(
  config: { tenantId: string; clientId: string; clientSecret: string; senderEmail: string; fromName: string },
  to: string,
  subject: string,
  html: string
) {
  // Get access token using Client Credentials flow
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`OAuth2 token request failed: ${err}`);
  }

  const { access_token } = await tokenRes.json();

  // Send email via Graph API
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${config.senderEmail}/sendMail`;
  const emailPayload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
      from: { emailAddress: { address: config.senderEmail, name: config.fromName } },
    },
    saveToSentItems: false,
  };

  const sendRes = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailPayload),
  });

  if (!sendRes.ok) {
    const err = await sendRes.text();
    throw new Error(`Graph API sendMail failed: ${err}`);
  }
}

async function sendEmail(to: string, subject: string, html: string) {
  const config = await getEmailConfig();

  if (!config) {
    logger.info(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
    return;
  }

  try {
    if (config.authMethod === 'oauth2') {
      // Microsoft 365 Graph API
      await sendViaGraphApi(
        {
          tenantId: config.tenantId!,
          clientId: config.clientId!,
          clientSecret: config.clientSecret!,
          senderEmail: config.senderEmail || config.fromAddress,
          fromName: config.fromName,
        },
        to, subject, html
      );
      logger.info(`Email sent via Graph API to ${to}: ${subject}`);
    } else {
      // Traditional SMTP
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        auth: { user: config.user, pass: config.pass },
      });
      await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromAddress}>`,
        to, subject, html,
      });
      logger.info(`Email sent via SMTP to ${to}: ${subject}`);
    }
  } catch (err) {
    logger.error(`Failed to send email to ${to}:`, err);
    throw err;
  }
}

export function startEmailWorker() {
  const worker = new Worker<EmailJob>(
    'email',
    async (job: Job<EmailJob>) => {
      const { to, subject, template, context } = job.data;
      const templateFn = templates[template] || templates.generic;
      const html = templateFn(context);
      await sendEmail(to, subject, html);
    },
    { connection: redis, concurrency: 5 }
  );

  worker.on('completed', (job) => {
    logger.info(`Email job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Email job ${job?.id} failed:`, err);
  });

  logger.info('✅ Email worker started');
  return worker;
}
