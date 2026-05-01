import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { bullmqConnection } from '../queues.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

interface EmailJob {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
  attachments?: { filename: string; path: string }[];
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

/** Escape user-provided strings before injecting into HTML email templates */
function esc(text: any): string {
  if (text == null) return '';
  const s = String(text);
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return s.replace(/[&<>"']/g, (ch) => map[ch]);
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
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.name)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">You've been invited to join Aniston Technologies. Please complete your onboarding by clicking the button below:</p>
    ${ctaButton(ctx.link, 'Start Onboarding')}
    <p style="color:#6B7280;font-size:13px;margin:16px 0 0;">This link expires in 7 days.</p>`,
    standardFooter('Aniston Technologies', ctx.link)
  ),

  'employee-invite': (ctx) => emailLayout(
    '#4F46E5', 'A', "You're Invited!", `Join ${esc(ctx.orgName)} on Aniston HRMS`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      <strong>${esc(ctx.inviterName || 'The HR team')}</strong> has invited you to join <strong>${esc(ctx.orgName)}</strong>${ctx.role && ctx.role !== 'EMPLOYEE' ? ` as <strong>${esc(ctx.role.replace(/_/g, ' '))}</strong>` : ''}. Click the button below to set up your password and complete your profile.
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

    <!-- Install App Section -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 24px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="vertical-align:top;width:44px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:40px;height:40px;background:#DBEAFE;text-align:center;vertical-align:middle;font-size:20px;">&#128241;</td></tr></table>
            </td>
            <td style="padding-left:12px;">
              <p style="color:#1E40AF;font-weight:700;margin:0 0 4px;font-size:14px;">Get the Aniston HRMS App</p>
              <p style="color:#1E3A5F;font-size:12px;margin:0 0 14px;line-height:1.5;">Install the app on your phone to mark attendance, apply for leaves, view payslips and more. Tap your platform below for step-by-step install instructions.</p>
              <!-- Download buttons — side by side on desktop, stacked on mobile -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:8px;padding-bottom:8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:#16A34A;padding:10px 20px;text-align:center;">
                          <a href="https://hr.anistonav.com/download/android" style="color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;display:inline-block;">&#129504; Install on Android</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="padding-bottom:8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:#1F2937;padding:10px 20px;text-align:center;">
                          <a href="https://hr.anistonav.com/download/ios" style="color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;display:inline-block;">&#63743; Install on iPhone / iPad</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;">
                <tr><td style="padding:3px 0;color:#3B82F6;font-size:11px;">&#8226; Allow Location &amp; Notification permissions after install (required for attendance)</td></tr>
                <tr><td style="padding:3px 0;color:#3B82F6;font-size:11px;">&#8226; App updates automatically when a new version is available</td></tr>
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
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.name)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">We received a request to reset your password. Click the button below to create a new password:</p>
    ${ctaButton(ctx.link, 'Reset Password')}
    <p style="color:#6B7280;font-size:13px;margin:16px 0 0;">If you didn't request this, you can safely ignore this email.</p>`,
    standardFooter('Aniston Technologies', ctx.link)
  ),

  'admin-password-reset': (ctx) => emailLayout(
    '#DC2626', 'K', 'Password Reset Required', 'Action required for your Aniston HRMS account',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.name)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px;">Your password has been reset by <strong>${esc(ctx.initiatorName)}</strong> from the HR/Admin team.</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Please click the button below to set a new password and regain access to your account:</p>
    ${ctaButton(ctx.link, 'Set New Password', '#DC2626')}
    <div style="background:#FEF2F2;border:1px solid #FECACA;padding:14px 16px;margin:20px 0 0;">
      <p style="color:#991B1B;font-size:13px;margin:0;line-height:1.5;">
        <strong>Security notice:</strong> This link expires in 24 hours. If you did not expect this reset or believe it was done in error, please contact your HR team immediately.
      </p>
    </div>`,
    standardFooter('Aniston Technologies', ctx.link)
  ),

  'resignation-submitted': (ctx) => emailLayout(
    '#DC2626', '!', 'Resignation Notice', 'Employee resignation submitted',
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;"><strong>${esc(ctx.name)}</strong> (${esc(ctx.employeeCode)}) has submitted their resignation.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
      <tr><td style="padding:10px 0;color:#6B7280;font-size:14px;width:140px;border-bottom:1px solid #F3F4F6;">Department</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">${esc(ctx.department || 'N/A')}</td></tr>
      <tr><td style="padding:10px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Last Working Date</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">${esc(ctx.lastWorkingDate)}</td></tr>
      <tr><td style="padding:10px 0;color:#6B7280;font-size:14px;">Reason</td><td style="padding:10px 0;font-size:14px;color:#111827;">${esc(ctx.reason)}</td></tr>
    </table>
    ${ctaButton(ctx.link, 'Review in HRMS Portal')}`,
    standardFooter('Aniston Technologies', ctx.link)
  ),

  'exit-approved': (ctx) => emailLayout(
    '#4F46E5', '&#10003;', 'Resignation Approved', 'Your resignation has been approved',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.name)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Your resignation has been approved. Your last working date is <strong>${esc(ctx.lastWorkingDate)}</strong>.</p>
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
    ${ctx.notes ? `<p style="color:#6B7280;font-size:14px;margin:16px 0 0;"><strong>Notes from HR:</strong> ${esc(ctx.notes)}</p>` : ''}`,
    standardFooter('Aniston Technologies')
  ),

  'exit-completed': (ctx) => emailLayout(
    '#059669', '&#10003;', 'Exit Process Complete', 'All formalities have been completed',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.name)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">Your exit process from Aniston Technologies has been completed successfully.</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">All no-dues have been cleared and your account has been deactivated.</p>
    <p style="color:#6B7280;font-size:14px;line-height:1.6;margin:24px 0 0;">We wish you all the very best for your future endeavours. Thank you for your contributions to Aniston Technologies.</p>`,
    standardFooter('Aniston Technologies')
  ),

  'job-share': (ctx) => emailLayout(
    '#4F46E5', 'A', `Job Opening at ${esc(ctx.orgName)}`, esc(ctx.jobTitle),
    `<h2 style="color:#111827;margin:0 0 16px;font-size:20px;">${esc(ctx.jobTitle)}</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
      ${ctx.department ? `<tr><td style="padding:10px 0;color:#6B7280;font-size:14px;width:120px;border-bottom:1px solid #F3F4F6;">Department</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">${esc(ctx.department)}</td></tr>` : ''}
      ${ctx.location ? `<tr><td style="padding:10px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Location</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">${esc(ctx.location)}</td></tr>` : ''}
      ${ctx.type ? `<tr><td style="padding:10px 0;color:#6B7280;font-size:14px;">Type</td><td style="padding:10px 0;font-weight:600;font-size:14px;color:#111827;">${esc(ctx.type.replace(/_/g, ' '))}</td></tr>` : ''}
    </table>
    ${ctx.customMessage ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;"><tr><td style="padding:12px;background:#F9FAFB;border-left:3px solid #4F46E5;color:#4B5563;font-size:14px;">${esc(ctx.customMessage)}</td></tr></table>` : ''}
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px;">We have an exciting opportunity that might interest you. Click the button below to learn more and apply:</p>
    ${ctaButton(ctx.applyUrl, 'Apply Now')}`,
    standardFooter(ctx.orgName, ctx.applyUrl, 'If the button doesn\'t work, copy and paste this link into your browser:')
  ),

  'interview-invite': (ctx) => emailLayout(
    '#4F46E5', 'A', `Interview Invitation — ${esc(ctx.jobTitle)}`, `You're invited to interview at Aniston Technologies`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Dear <strong>${esc(ctx.candidateName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      We have reviewed your profile and are pleased to invite you to interview for the
      <strong>${esc(ctx.jobTitle)}</strong> position at <strong>Aniston Technologies LLP</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border-radius:8px;margin:0 0 24px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:8px 0;color:#6B7280;font-size:13px;width:100px;border-bottom:1px solid #E5E7EB;">Venue</td>
            <td style="padding:8px 0;font-weight:600;font-size:13px;color:#111827;border-bottom:1px solid #E5E7EB;">${esc(ctx.venue)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6B7280;font-size:13px;">Position</td>
            <td style="padding:8px 0;font-weight:600;font-size:13px;color:#111827;">${esc(ctx.jobTitle)}</td>
          </tr>
        </table>
      </td></tr>
    </table>
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Please complete your application form before attending:
    </p>
    ${ctaButton(ctx.applyLink, 'Complete Application')}
    <p style="color:#6B7280;font-size:13px;margin:24px 0 0;">Please bring your original documents — ID proof, educational certificates, and a copy of your resume.</p>`,
    standardFooter('Aniston Technologies', ctx.applyLink)
  ),

  'app-download': (ctx) => emailLayout(
    '#4F46E5', 'A', 'Download Aniston HRMS App', 'Mark attendance, apply leaves, and more — right from your phone',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello <strong>${esc(ctx.employeeName || 'there')}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">
      ${esc(ctx.orgName)} uses <strong>Aniston HRMS</strong> for attendance tracking, leave management, and more. Please install the app on your phone to mark your daily attendance.
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
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello <strong>${esc(ctx.employeeName || 'there')}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Please follow these instructions to mark your attendance daily using the Aniston HRMS app.
    </p>

    ${ctx.shiftInfo ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#1E40AF;font-weight:600;margin:0 0 8px;font-size:14px;">Your Shift</p>
        <p style="color:#1E3A5F;font-size:14px;margin:0;"><strong>${esc(ctx.shiftInfo)}</strong></p>
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

  'document-batch-submitted': (ctx) => emailLayout(
    '#4F46E5', 'A', 'Documents Uploaded', esc(ctx.orgName),
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
      <strong>${esc(ctx.employeeName)}</strong> (${esc(ctx.employeeCode)}) has uploaded <strong>${ctx.documents.length}</strong> document${ctx.documents.length > 1 ? 's' : ''} for review:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
      <tr style="background:#F9FAFB;">
        <td style="text-align:left;padding:8px 12px;font-size:12px;color:#6B7280;border-bottom:1px solid #E5E7EB;font-weight:600;">Document</td>
        <td style="text-align:left;padding:8px 12px;font-size:12px;color:#6B7280;border-bottom:1px solid #E5E7EB;font-weight:600;">Type</td>
      </tr>
      ${ctx.documents.map((d: any) => `
        <tr>
          <td style="padding:8px 12px;font-size:13px;color:#111827;border-bottom:1px solid #F3F4F6;">${esc(d.name)}</td>
          <td style="padding:8px 12px;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F6;">${esc(d.type.replace(/_/g, ' '))}</td>
        </tr>
      `).join('')}
    </table>
    ${ctaButton(ctx.reviewUrl, 'Review Documents')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies', ctx.reviewUrl)
  ),

  'generic': (ctx) => emailLayout(
    '#4F46E5', 'A', ctx.title || 'Notification', '',
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0;">${ctx.message || ''}</p>`,
    standardFooter('Aniston Technologies')
  ),

  'document-submitted': (ctx) => emailLayout(
    '#4F46E5', 'A', 'Document Submitted for Review', `${esc(ctx.employeeName)} uploaded a document`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello HR Team,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      <strong>${esc(ctx.employeeName)}</strong> (${esc(ctx.employeeCode)}) has uploaded a new document that requires your review.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;margin:16px 0;">
      <tr><td style="padding:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;width:130px;">Document Type</td><td style="padding:6px 0;font-weight:600;font-size:14px;color:#111827;">${esc(ctx.documentType?.replace(/_/g, ' ') || 'N/A')}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;">Document Name</td><td style="padding:6px 0;font-weight:600;font-size:14px;color:#111827;">${esc(ctx.documentName)}</td></tr>
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
      A document uploaded by <strong>${esc(ctx.employeeName)}</strong> (${esc(ctx.employeeCode)}) has been automatically flagged as suspicious by the OCR verification system.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;margin:16px 0;">
      <tr><td style="padding:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;width:130px;">Document Type</td><td style="padding:6px 0;font-weight:600;font-size:14px;color:#111827;">${esc(ctx.documentType || 'N/A')}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:14px;">Document Name</td><td style="padding:6px 0;font-weight:600;font-size:14px;color:#111827;">${esc(ctx.documentName)}</td></tr>
        </table>
      </td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEE2E2;border:1px solid #FECACA;margin:16px 0;">
      <tr><td style="padding:16px;">
        <p style="color:#991B1B;font-weight:600;margin:0 0 8px;font-size:14px;">Issues Detected:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${(ctx.issues || []).map((issue: string) => `<tr><td style="padding:3px 0;color:#991B1B;font-size:13px;">&#8226; ${esc(issue)}</td></tr>`).join('')}
        </table>
      </td></tr>
    </table>
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0;">Please review this document immediately and take appropriate action.</p>
    ${ctaButton(ctx.reviewUrl, 'Review in HRMS Portal', '#DC2626')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies', ctx.reviewUrl)
  ),

  'activation-invite': (ctx) => emailLayout(
    '#4F46E5', 'A', 'Activate Your Account', `Welcome to ${esc(ctx.organizationName)}`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.name)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Your account on <strong>${esc(ctx.organizationName)}</strong>'s Aniston HRMS has been created. Please activate your account by setting a password.
    </p>
    ${ctaButton(ctx.link, 'Activate Account & Set Password')}

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F0FF;margin:24px 0;">
      <tr><td style="padding:20px;">
        <p style="color:#4338CA;font-weight:600;margin:0 0 10px;font-size:14px;">What happens next?</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;width:24px;">1.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Click the button above to set your password</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">2.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Log in with your email and new password</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">3.</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">Complete your profile and start using Aniston HRMS</td></tr>
        </table>
      </td></tr>
    </table>

    <p style="color:#EF4444;font-size:13px;margin:16px 0 0;">
      <strong>Expires:</strong> This link is valid for ${ctx.expiresIn || '72 hours'}.
    </p>`,
    standardFooter(ctx.organizationName || 'Aniston Technologies', ctx.link)
  ),

  'holiday-notification': (ctx) => emailLayout(
    ctx.color || '#4F46E5',
    ctx.isEvent ? '&#128197;' : '&#127881;',
    ctx.isEvent ? 'Company Event' : 'Holiday Announcement',
    ctx.holidayName || '',
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 12px;">Hello <strong>${esc(ctx.employeeName || 'there')}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      ${ctx.isEvent ? 'A new company event has been scheduled' : 'A holiday has been announced'}:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${ctx.isEvent ? '#FFF7ED' : '#EEF2FF'};border:1px solid ${ctx.isEvent ? '#FED7AA' : '#C7D2FE'};margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:${ctx.isEvent ? '#C2410C' : '#4338CA'};font-weight:700;font-size:18px;margin:0 0 8px;">${esc(ctx.holidayName)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;width:80px;">Date</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${esc(ctx.holidayDate)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;">Type</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${esc(ctx.typeLabel)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;">Timing</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${esc(ctx.timingInfo)}</td>
          </tr>
        </table>
        ${ctx.description ? `<p style="color:#4B5563;font-size:13px;margin:12px 0 0;line-height:1.5;border-top:1px solid ${ctx.isEvent ? '#FED7AA' : '#C7D2FE'};padding-top:12px;">${esc(ctx.description)}</p>` : ''}
      </td></tr>
    </table>`,
    standardFooter(ctx.orgName)
  ),

  'geofence-violation': (ctx) => emailLayout(
    '#DC2626', '!', 'Geofence Alert', `Employee attendance marked outside office location`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hello HR Team,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      <strong>${esc(ctx.employeeName)}</strong> (${esc(ctx.employeeCode)}) has marked attendance <strong>outside</strong> the assigned office geofence.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF2F2;margin:16px 0;">
      <tr><td style="padding:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;width:130px;">Employee</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${esc(ctx.employeeName)} (${esc(ctx.employeeCode)})</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6B7280;font-size:13px;">Assigned Location</td>
            <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${esc(ctx.locationName)}</td>
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

  // ── Leave Notification Templates ──

  // Sent to HR / Manager when an employee submits a leave request
  'leave-submitted': (ctx) => emailLayout(
    'linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)', '&#128203;', 'New Leave Request', `Action required — ${esc(ctx.employeeName)} applied for ${esc(ctx.leaveType)}`,
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">A new leave request is pending your review and approval.</p>

    <!-- Employee card -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EEF2FF;border:1px solid #C7D2FE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#4338CA;font-weight:700;font-size:14px;margin:0 0 12px;">&#128100; Employee Details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:5px 0;color:#6B7280;font-size:13px;width:130px;">Name</td>
            <td style="padding:5px 0;color:#111827;font-size:13px;font-weight:600;">${esc(ctx.employeeName)}${ctx.employeeCode ? ` <span style="color:#6B7280;font-weight:400;">(${esc(ctx.employeeCode)})</span>` : ''}</td>
          </tr>
          ${ctx.department ? `<tr><td style="padding:5px 0;color:#6B7280;font-size:13px;">Department</td><td style="padding:5px 0;color:#111827;font-size:13px;">${esc(ctx.department)}</td></tr>` : ''}
          ${ctx.designation ? `<tr><td style="padding:5px 0;color:#6B7280;font-size:13px;">Designation</td><td style="padding:5px 0;color:#111827;font-size:13px;">${esc(ctx.designation)}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <!-- Leave details -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border:1px solid #E5E7EB;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#374151;font-weight:700;font-size:14px;margin:0 0 12px;">&#128197; Leave Details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:130px;border-bottom:1px solid #F3F4F6;">Leave Type</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${esc(ctx.leaveType)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">From</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${new Date(ctx.startDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">To</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${new Date(ctx.endDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Duration</td>
            <td style="padding:6px 0;color:#4F46E5;font-size:15px;font-weight:700;border-bottom:1px solid #F3F4F6;">${ctx.days} day${ctx.days !== 1 ? 's' : ''}</td>
          </tr>
          ${ctx.reason ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;">Reason</td><td style="padding:6px 0;color:#4B5563;font-size:13px;font-style:italic;">"${esc(ctx.reason)}"</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <!-- Risk badge -->
    ${ctx.riskLevel && ctx.riskLevel !== 'LOW' ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${ctx.riskLevel === 'CRITICAL' ? '#FEF2F2' : ctx.riskLevel === 'HIGH' ? '#FFF7ED' : '#FFFBEB'};border:1px solid ${ctx.riskLevel === 'CRITICAL' ? '#FECACA' : ctx.riskLevel === 'HIGH' ? '#FED7AA' : '#FDE68A'};margin:0 0 20px;">
      <tr><td style="padding:14px 16px;">
        <p style="color:${ctx.riskLevel === 'CRITICAL' ? '#991B1B' : ctx.riskLevel === 'HIGH' ? '#9A3412' : '#92400E'};font-weight:700;font-size:13px;margin:0 0 4px;">&#9888; Risk Level: ${esc(ctx.riskLevel)}</p>
        <p style="color:${ctx.riskLevel === 'CRITICAL' ? '#B91C1C' : ctx.riskLevel === 'HIGH' ? '#C2410C' : '#B45309'};font-size:12px;margin:0;">This leave request has been flagged with a ${esc(ctx.riskLevel.toLowerCase())} risk level. Please review carefully before approving.</p>
      </td></tr>
    </table>` : ''}

    ${ctaButton(`${ctx.appUrl || 'https://hr.anistonav.com'}/leaves`, 'Review &amp; Approve Leave Request')}

    <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:8px 0 0;">You are receiving this because you are a manager or HR administrator.</p>`,
    standardFooter(ctx.orgName || 'Aniston Technologies')
  ),

  // Sent to the employee confirming their leave was submitted
  'leave-confirmation': (ctx) => emailLayout(
    'linear-gradient(135deg,#0EA5E9 0%,#4F46E5 100%)', '&#10003;', 'Leave Request Submitted', `Your ${esc(ctx.leaveType)} request is now under review`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Your leave request has been <strong>successfully submitted</strong> and is now awaiting approval from your manager and HR team.</p>

    <!-- Leave summary -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#1E40AF;font-weight:700;font-size:14px;margin:0 0 12px;">&#128197; Your Leave Summary</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:110px;border-bottom:1px solid #DBEAFE;">Leave Type</td>
            <td style="padding:6px 0;color:#1E3A8A;font-size:13px;font-weight:600;border-bottom:1px solid #DBEAFE;">${esc(ctx.leaveType)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #DBEAFE;">From</td>
            <td style="padding:6px 0;color:#1E3A8A;font-size:13px;font-weight:600;border-bottom:1px solid #DBEAFE;">${new Date(ctx.startDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #DBEAFE;">To</td>
            <td style="padding:6px 0;color:#1E3A8A;font-size:13px;font-weight:600;border-bottom:1px solid #DBEAFE;">${new Date(ctx.endDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">Duration</td>
            <td style="padding:6px 0;color:#1D4ED8;font-size:16px;font-weight:700;">${ctx.days} day${ctx.days !== 1 ? 's' : ''}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- What happens next -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0FDF4;border:1px solid #BBF7D0;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#166534;font-weight:700;font-size:14px;margin:0 0 12px;">What happens next?</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#166534;font-size:13px;vertical-align:top;width:24px;">1.</td>
            <td style="padding:6px 0;color:#15803D;font-size:13px;">Your manager will review and approve / reject the request</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#166534;font-size:13px;vertical-align:top;">2.</td>
            <td style="padding:6px 0;color:#15803D;font-size:13px;">HR will do the final approval</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#166534;font-size:13px;vertical-align:top;">3.</td>
            <td style="padding:6px 0;color:#15803D;font-size:13px;">You will receive an email once the decision is made</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#166534;font-size:13px;vertical-align:top;">4.</td>
            <td style="padding:6px 0;color:#15803D;font-size:13px;">You can track the status anytime in the HRMS portal</td>
          </tr>
        </table>
      </td></tr>
    </table>

    ${ctaButton(`${ctx.appUrl || 'https://hr.anistonav.com'}/leaves`, 'Track Your Leave Status')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies')
  ),

  // Sent to employee when leave is approved
  'leave-approved': (ctx) => emailLayout(
    'linear-gradient(135deg,#16A34A 0%,#059669 100%)', '&#10003;', 'Leave Approved!', `Your ${esc(ctx.leaveType)} has been approved`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Great news! Your leave request has been <strong style="color:#16A34A;">approved</strong>.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0FDF4;border:1px solid #BBF7D0;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:110px;border-bottom:1px solid #BBF7D0;">Leave Type</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #BBF7D0;">${esc(ctx.leaveType)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #BBF7D0;">From</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #BBF7D0;">${new Date(ctx.startDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #BBF7D0;">To</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #BBF7D0;">${new Date(ctx.endDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #BBF7D0;">Duration</td>
            <td style="padding:6px 0;color:#16A34A;font-size:16px;font-weight:700;border-bottom:1px solid #BBF7D0;">${ctx.days} day${ctx.days !== 1 ? 's' : ''}</td>
          </tr>
          ${ctx.remarks ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;">Remarks</td><td style="padding:6px 0;color:#4B5563;font-size:13px;font-style:italic;">"${esc(ctx.remarks)}"</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFBEB;border:1px solid #FDE68A;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#92400E;font-weight:600;font-size:13px;margin:0 0 6px;">Before you go</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Complete any handover notes and brief your backup colleague</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Set your out-of-office reply on email</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Ensure all pending tasks are handed over or rescheduled</td></tr>
        </table>
      </td></tr>
    </table>

    ${ctaButton(`${ctx.appUrl || 'https://hr.anistonav.com'}/leaves`, 'View Leave Details')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies')
  ),

  // Sent to employee when leave is rejected
  'leave-rejected': (ctx) => emailLayout(
    '#DC2626', '&#10005;', 'Leave Not Approved', `Your ${esc(ctx.leaveType)} request was not approved`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">We regret to inform you that your leave request has been <strong style="color:#DC2626;">rejected</strong>.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF2F2;border:1px solid #FECACA;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:110px;border-bottom:1px solid #FECACA;">Leave Type</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #FECACA;">${esc(ctx.leaveType)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #FECACA;">Dates</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #FECACA;">${new Date(ctx.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} — ${new Date(ctx.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
          ${ctx.remarks ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;">Reason</td><td style="padding:6px 0;color:#B91C1C;font-size:13px;font-weight:600;">${esc(ctx.remarks)}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F9FF;border:1px solid #BAE6FD;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#0369A1;font-weight:600;font-size:13px;margin:0 0 6px;">What you can do</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:3px 0;color:#0C4A6E;font-size:12px;">&#8226; Contact your manager to discuss alternate dates</td></tr>
          <tr><td style="padding:3px 0;color:#0C4A6E;font-size:12px;">&#8226; Reapply with different dates that suit business requirements</td></tr>
          <tr><td style="padding:3px 0;color:#0C4A6E;font-size:12px;">&#8226; Reach out to HR if you believe this rejection was in error</td></tr>
        </table>
      </td></tr>
    </table>

    ${ctaButton(`${ctx.appUrl || 'https://hr.anistonav.com'}/leaves`, 'View Leave Status')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies')
  ),

  // Sent to backup employee when they are assigned
  'leave-backup-assigned': (ctx) => emailLayout(
    '#7C3AED', '&#8644;', 'Backup Assignment', `You have been assigned as backup for ${esc(ctx.employeeName)}`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">You have been designated as <strong>backup</strong> for <strong>${esc(ctx.employeeName)}</strong> during their upcoming approved leave.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F3FF;border:1px solid #DDD6FE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:110px;border-bottom:1px solid #DDD6FE;">Employee</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #DDD6FE;">${esc(ctx.employeeName)}${ctx.designation ? ` — ${esc(ctx.designation)}` : ''}</td>
          </tr>
          ${ctx.department ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #DDD6FE;">Department</td><td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #DDD6FE;">${esc(ctx.department)}</td></tr>` : ''}
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #DDD6FE;">Leave Dates</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #DDD6FE;">${new Date(ctx.startDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} — ${new Date(ctx.endDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">Duration</td>
            <td style="padding:6px 0;color:#7C3AED;font-size:15px;font-weight:700;">${ctx.days} day${ctx.days !== 1 ? 's' : ''}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFBEB;border:1px solid #FDE68A;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#92400E;font-weight:600;font-size:13px;margin:0 0 6px;">&#128203; Your responsibilities during this period</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Review the handover notes shared by the employee</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Handle any escalations or time-sensitive tasks from their queue</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Contact the manager if you need additional support or clarification</td></tr>
        </table>
      </td></tr>
    </table>

    ${ctaButton(`${ctx.appUrl || 'https://hr.anistonav.com'}/leaves`, 'View Handover Details')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies')
  ),

  // Sent to employee when HR adjusts their leave balance allocation
  'leave-balance-adjusted': (ctx) => emailLayout(
    '#4F46E5', '&#9998;', 'Leave Balance Updated', `Your ${esc(ctx.leaveTypeName)} balance has been adjusted`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">HR has adjusted your leave balance. Here are the updated details:</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EEF2FF;border:1px solid #C7D2FE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:130px;border-bottom:1px solid #C7D2FE;">Leave Type</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #C7D2FE;">${esc(ctx.leaveTypeName)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #C7D2FE;">Year</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #C7D2FE;">${esc(ctx.year)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">New Balance</td>
            <td style="padding:6px 0;color:#4F46E5;font-size:16px;font-weight:700;">${esc(ctx.allocated)} day${Number(ctx.allocated) !== 1 ? 's' : ''}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    ${ctx.reason ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border:1px solid #E5E7EB;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#374151;font-weight:600;font-size:13px;margin:0 0 6px;">HR Note</p>
        <p style="color:#6B7280;font-size:13px;margin:0;line-height:1.5;">${esc(ctx.reason)}</p>
      </td></tr>
    </table>` : ''}

    ${ctaButton(ctx.appUrl || 'https://hr.anistonav.com/leaves', 'View My Leave Balance')}`,
    standardFooter(ctx.organizationName || 'Aniston Technologies')
  ),

  // ── Regularization Templates ──

  // Sent to HR/Admin when employee submits an attendance regularization request
  'regularization-submitted': (ctx) => emailLayout(
    'linear-gradient(135deg,#0EA5E9 0%,#6366F1 100%)', '&#128338;', 'Regularization Request', `${esc(ctx.employeeName)} has submitted an attendance correction`,
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">A new attendance regularization request requires your review.</p>

    <!-- Employee details -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#1E40AF;font-weight:700;font-size:14px;margin:0 0 12px;">&#128100; Employee</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:5px 0;color:#6B7280;font-size:13px;width:130px;">Name</td>
            <td style="padding:5px 0;color:#111827;font-size:13px;font-weight:600;">${esc(ctx.employeeName)}${ctx.employeeCode ? ` <span style="color:#6B7280;font-weight:400;">(${esc(ctx.employeeCode)})</span>` : ''}</td>
          </tr>
          ${ctx.department ? `<tr><td style="padding:5px 0;color:#6B7280;font-size:13px;">Department</td><td style="padding:5px 0;color:#111827;font-size:13px;">${esc(ctx.department)}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <!-- Request details -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border:1px solid #E5E7EB;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#374151;font-weight:700;font-size:14px;margin:0 0 12px;">&#128197; Regularization Details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:130px;border-bottom:1px solid #F3F4F6;">Attendance Date</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${esc(ctx.date)}</td>
          </tr>
          ${ctx.requestedCheckIn ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Requested Check-In</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${esc(ctx.requestedCheckIn)}</td></tr>` : ''}
          ${ctx.requestedCheckOut ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Requested Check-Out</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${esc(ctx.requestedCheckOut)}</td></tr>` : ''}
          ${ctx.reason ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;">Reason</td><td style="padding:6px 0;color:#4B5563;font-size:13px;font-style:italic;">"${esc(ctx.reason)}"</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    ${ctaButton(ctx.reviewUrl || ctx.link || 'https://hr.anistonav.com/attendance', 'Review in HRMS Portal')}`,
    standardFooter('Aniston HRMS', ctx.reviewUrl || ctx.link)
  ),

  // Sent to employee when HR approves or rejects their regularization request
  'regularization-reviewed': (ctx) => emailLayout(
    ctx.status === 'APPROVED' ? '#059669' : '#DC2626',
    ctx.status === 'APPROVED' ? '&#10003;' : '&#10007;',
    ctx.status === 'APPROVED' ? 'Regularization Approved' : 'Regularization Rejected',
    `Your attendance correction request has been ${ctx.status === 'APPROVED' ? 'approved' : 'rejected'}`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Your attendance regularization request for <strong>${esc(ctx.date)}</strong> has been <strong>${ctx.status === 'APPROVED' ? 'approved' : 'rejected'}</strong>.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${ctx.status === 'APPROVED' ? '#F0FDF4' : '#FEF2F2'};border:1px solid ${ctx.status === 'APPROVED' ? '#BBF7D0' : '#FECACA'};margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:130px;border-bottom:1px solid ${ctx.status === 'APPROVED' ? '#BBF7D0' : '#FECACA'};">Date</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid ${ctx.status === 'APPROVED' ? '#BBF7D0' : '#FECACA'};">${esc(ctx.date)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid ${ctx.status === 'APPROVED' ? '#BBF7D0' : '#FECACA'};">Status</td>
            <td style="padding:6px 0;font-size:13px;font-weight:700;color:${ctx.status === 'APPROVED' ? '#166534' : '#991B1B'};border-bottom:1px solid ${ctx.status === 'APPROVED' ? '#BBF7D0' : '#FECACA'};">${esc(ctx.status)}</td>
          </tr>
          ${ctx.remarks ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;">Remarks</td><td style="padding:6px 0;color:#4B5563;font-size:13px;font-style:italic;">"${esc(ctx.remarks)}"</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    ${ctaButton('https://hr.anistonav.com/attendance', 'View Attendance')}`,
    standardFooter('Aniston HRMS')
  ),

  // ── Payroll Deletion Templates ──

  // Sent to SuperAdmin(s) when HR submits a payroll deletion request
  // Context fields: requestorName, runLabel, reason, notes, reviewUrl
  'payroll-deletion-request': (ctx) => emailLayout(
    '#DC2626', '!', 'Payroll Deletion Request', `${esc(ctx.requestorName)} has requested deletion of a payroll run`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">A payroll deletion request is awaiting your approval.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF2F2;border:1px solid #FECACA;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#991B1B;font-weight:700;font-size:14px;margin:0 0 12px;">&#128203; Payroll Run Details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:140px;border-bottom:1px solid #FECACA;">Payroll Period</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #FECACA;">${esc(ctx.runLabel)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #FECACA;">Requested By</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #FECACA;">${esc(ctx.requestorName)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #FECACA;">Reason</td>
            <td style="padding:6px 0;color:#4B5563;font-size:13px;font-style:italic;border-bottom:1px solid #FECACA;">"${esc(ctx.reason)}"</td>
          </tr>
          ${ctx.notes ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;">Additional Notes</td><td style="padding:6px 0;color:#4B5563;font-size:13px;">${esc(ctx.notes)}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFBEB;border:1px solid #FDE68A;margin:0 0 20px;">
      <tr><td style="padding:16px;">
        <p style="color:#92400E;font-weight:600;font-size:13px;margin:0 0 6px;">&#9888; This will permanently delete the payroll run and all associated records.</p>
        <p style="color:#78350F;font-size:12px;margin:0;">Please review carefully before approving. Deleted payroll data cannot be recovered.</p>
      </td></tr>
    </table>

    ${ctaButton(ctx.reviewUrl || ctx.link || 'https://hr.anistonav.com/payroll', 'Review Request in HRMS', '#DC2626')}`,
    standardFooter('Aniston HRMS', ctx.reviewUrl || ctx.link)
  ),

  // Sent to HR requestor when SuperAdmin approves or rejects the deletion request
  // Context fields: firstName, runLabel, outcome, rejectionReason, appUrl
  'payroll-deletion-reviewed': (ctx) => emailLayout(
    ctx.outcome === 'APPROVED' ? '#059669' : '#4F46E5',
    ctx.outcome === 'APPROVED' ? '&#10003;' : '&#10007;',
    ctx.outcome === 'APPROVED' ? 'Payroll Deletion Approved' : 'Payroll Deletion Rejected',
    `Your request to delete payroll run ${esc(ctx.runLabel)} has been ${ctx.outcome === 'APPROVED' ? 'approved' : 'rejected'}`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.firstName || 'there')}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Your payroll deletion request for <strong>${esc(ctx.runLabel)}</strong> has been <strong>${ctx.outcome === 'APPROVED' ? 'approved and the payroll run has been permanently deleted' : 'rejected'}</strong>.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${ctx.outcome === 'APPROVED' ? '#F0FDF4' : '#EEF2FF'};border:1px solid ${ctx.outcome === 'APPROVED' ? '#BBF7D0' : '#C7D2FE'};margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:140px;border-bottom:1px solid ${ctx.outcome === 'APPROVED' ? '#BBF7D0' : '#C7D2FE'};">Payroll Period</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid ${ctx.outcome === 'APPROVED' ? '#BBF7D0' : '#C7D2FE'};">${esc(ctx.runLabel)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid ${ctx.outcome === 'APPROVED' ? '#BBF7D0' : '#C7D2FE'};">Decision</td>
            <td style="padding:6px 0;font-size:13px;font-weight:700;color:${ctx.outcome === 'APPROVED' ? '#166534' : '#3730A3'};border-bottom:1px solid ${ctx.outcome === 'APPROVED' ? '#BBF7D0' : '#C7D2FE'};">${ctx.outcome === 'APPROVED' ? 'APPROVED — Payroll run deleted' : 'REJECTED'}</td>
          </tr>
          ${ctx.rejectionReason ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;">Reason for Rejection</td><td style="padding:6px 0;color:#4B5563;font-size:13px;font-style:italic;">"${esc(ctx.rejectionReason)}"</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    ${ctx.outcome === 'APPROVED'
      ? `<p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">You may now create a new payroll run for the same period if needed.</p>`
      : `<p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">If you have questions about this decision, please contact your Super Admin.</p>`
    }

    ${ctaButton(ctx.appUrl || 'https://hr.anistonav.com/payroll', 'Go to Payroll')}`,
    standardFooter('Aniston HRMS')
  ),

  // ── Helpdesk Templates ──

  // Sent to HR/Admin when an employee raises a new support ticket
  'helpdesk-ticket-created': (ctx) => emailLayout(
    'linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%)', '&#127381;', 'New Support Ticket', `[${esc(ctx.ticketCode)}] ${esc(ctx.subject)}`,
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">A new helpdesk ticket has been raised and requires your attention.</p>

    <!-- Employee -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F3FF;border:1px solid #DDD6FE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#5B21B6;font-weight:700;font-size:14px;margin:0 0 10px;">&#128100; Raised by</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:5px 0;color:#6B7280;font-size:13px;width:130px;">Employee</td>
            <td style="padding:5px 0;color:#111827;font-size:13px;font-weight:600;">${esc(ctx.employeeName)}${ctx.employeeCode ? ` (${esc(ctx.employeeCode)})` : ''}</td>
          </tr>
          ${ctx.department ? `<tr><td style="padding:5px 0;color:#6B7280;font-size:13px;">Department</td><td style="padding:5px 0;color:#111827;font-size:13px;">${esc(ctx.department)}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <!-- Ticket details -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border:1px solid #E5E7EB;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#374151;font-weight:700;font-size:14px;margin:0 0 12px;">&#128203; Ticket Details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:130px;border-bottom:1px solid #F3F4F6;">Ticket #</td>
            <td style="padding:6px 0;color:#4F46E5;font-size:13px;font-weight:700;border-bottom:1px solid #F3F4F6;">${esc(ctx.ticketCode)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Subject</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${esc(ctx.subject)}</td>
          </tr>
          ${ctx.category ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Category</td><td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #F3F4F6;">${esc(ctx.category)}</td></tr>` : ''}
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Priority</td>
            <td style="padding:6px 0;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;color:${ctx.priority === 'HIGH' || ctx.priority === 'CRITICAL' ? '#DC2626' : ctx.priority === 'MEDIUM' ? '#D97706' : '#059669'};">${esc(ctx.priority || 'MEDIUM')}</td>
          </tr>
          ${ctx.description ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">Description</td><td style="padding:6px 0;color:#4B5563;font-size:13px;line-height:1.5;">${esc(ctx.description)}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    ${ctaButton(ctx.link || 'https://hr.anistonav.com/helpdesk', 'View &amp; Respond in HRMS')}`,
    standardFooter('Aniston HRMS', ctx.link)
  ),

  // Sent to employee when HR replies to their ticket OR changes its status
  'helpdesk-ticket-updated': (ctx) => emailLayout(
    '#4F46E5', '&#128236;', ctx.newStatus ? `Ticket ${ctx.newStatus === 'RESOLVED' ? 'Resolved' : 'Updated'}` : 'New Reply on Your Ticket',
    `[${esc(ctx.ticketCode)}] ${esc(ctx.subject)}`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    ${ctx.newStatus
      ? `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Your support ticket <strong>[${esc(ctx.ticketCode)}]</strong> has been <strong>${esc(ctx.newStatus.toLowerCase())}</strong>.</p>`
      : `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">HR has replied to your support ticket <strong>[${esc(ctx.ticketCode)}]</strong>.</p>`
    }

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EEF2FF;border:1px solid #C7D2FE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:100px;border-bottom:1px solid #C7D2FE;">Ticket #</td>
            <td style="padding:6px 0;color:#4F46E5;font-size:13px;font-weight:700;border-bottom:1px solid #C7D2FE;">${esc(ctx.ticketCode)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #C7D2FE;">Subject</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #C7D2FE;">${esc(ctx.subject)}</td>
          </tr>
          ${ctx.newStatus ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #C7D2FE;">Status</td><td style="padding:6px 0;color:#4F46E5;font-size:13px;font-weight:700;border-bottom:1px solid #C7D2FE;">${esc(ctx.newStatus)}</td></tr>` : ''}
          ${ctx.commentPreview ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">Reply</td><td style="padding:6px 0;color:#4B5563;font-size:13px;line-height:1.5;font-style:italic;">"${esc(ctx.commentPreview)}"</td></tr>` : ''}
          ${ctx.resolution ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">Resolution</td><td style="padding:6px 0;color:#059669;font-size:13px;line-height:1.5;">${esc(ctx.resolution)}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    ${ctaButton(ctx.link || 'https://hr.anistonav.com/helpdesk', 'View Ticket')}`,
    standardFooter('Aniston HRMS')
  ),

  // Sent to HR/Admin when an employee adds a comment on their own ticket
  'helpdesk-comment-received': (ctx) => emailLayout(
    '#7C3AED', '&#128172;', 'Employee Replied to Ticket', `[${esc(ctx.ticketCode)}] ${esc(ctx.subject)}`,
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;"><strong>${esc(ctx.employeeName)}</strong> has added a new reply to their support ticket.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F3FF;border:1px solid #DDD6FE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:100px;border-bottom:1px solid #DDD6FE;">Ticket #</td>
            <td style="padding:6px 0;color:#7C3AED;font-size:13px;font-weight:700;border-bottom:1px solid #DDD6FE;">${esc(ctx.ticketCode)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #DDD6FE;">Subject</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #DDD6FE;">${esc(ctx.subject)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #DDD6FE;">Employee</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #DDD6FE;">${esc(ctx.employeeName)}</td>
          </tr>
          ${ctx.commentPreview ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;vertical-align:top;">Comment</td><td style="padding:6px 0;color:#4B5563;font-size:13px;line-height:1.5;font-style:italic;">"${esc(ctx.commentPreview)}"</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    ${ctaButton(ctx.link || 'https://hr.anistonav.com/helpdesk', 'Reply in HRMS Portal')}`,
    standardFooter('Aniston HRMS', ctx.link)
  ),

  // ── KYC Verified — employee portal access granted ──
  'kyc-verified': (ctx) => emailLayout(
    'linear-gradient(135deg,#059669 0%,#047857 100%)', '&#9989;',
    'KYC Verified — Your Portal Access is Now Active!',
    `Welcome to the Aniston HRMS dashboard`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Great news! Your KYC verification has been completed and your HRMS portal access is now fully active.
      You can now log in and access all features including payslips, leave management, attendance, and more.
    </p>

    <!-- Success banner -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0FDF4;border:1px solid #BBF7D0;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#14532D;font-weight:700;font-size:14px;margin:0 0 4px;">&#127881; KYC Successfully Verified</p>
        <p style="color:#166534;font-size:13px;margin:0;line-height:1.5;">
          Verified on ${esc(ctx.verifiedAt || new Date().toLocaleDateString('en-IN', { dateStyle: 'long' }))} by the HR team.
        </p>
      </td></tr>
    </table>

    <!-- What's unlocked -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border:1px solid #E5E7EB;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#374151;font-weight:700;font-size:14px;margin:0 0 12px;">&#128274; What's now unlocked for you</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${['Dashboard & announcements', 'Payslip download', 'Leave management', 'Attendance tracking', 'Profile management', 'Performance goals'].map(f =>
            `<tr><td style="padding:6px 0;color:#374151;font-size:13px;border-bottom:1px solid #F3F4F6;">&#10003;&nbsp; ${f}</td></tr>`
          ).join('')}
        </table>
      </td></tr>
    </table>

    ${ctx.autoFilledFields && ctx.autoFilledFields.length > 0 ? `
    <!-- Auto-filled profile fields -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#1E40AF;font-weight:700;font-size:14px;margin:0 0 8px;">&#128196; Profile fields auto-filled from your documents</p>
        <p style="color:#1D4ED8;font-size:13px;margin:0;line-height:1.6;">${esc(ctx.autoFilledFields.join(', '))}</p>
      </td></tr>
    </table>` : ''}

    ${ctaButton('https://hr.anistonav.com/dashboard', 'Go to Your Dashboard', '#059669')}`,
    standardFooter('Aniston HRMS', 'https://hr.anistonav.com/dashboard')
  ),

  // ── KYC Rejected — employee must re-submit ──
  'kyc-rejected': (ctx) => emailLayout(
    'linear-gradient(135deg,#DC2626 0%,#B91C1C 100%)', '&#10060;',
    'KYC Verification Unsuccessful — Action Required',
    `Your KYC submission could not be verified`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      We were unable to verify your KYC submission. Your access to the HRMS portal will remain restricted until you
      re-submit the required documents and they are approved by the HR team.
    </p>

    <!-- Rejection banner -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF2F2;border:1px solid #FECACA;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#991B1B;font-weight:700;font-size:14px;margin:0 0 4px;">&#9888;&#65039; KYC Verification Rejected on ${esc(ctx.rejectedAt || '')}</p>
        <p style="color:#7F1D1D;font-size:13px;margin:0;line-height:1.5;">
          Your access to the Aniston HRMS dashboard will remain restricted until a new KYC submission is approved.
        </p>
      </td></tr>
    </table>

    <!-- HR reason -->
    ${ctx.rejectionReason ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border:1px solid #E5E7EB;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#374151;font-weight:700;font-size:14px;margin:0 0 8px;">&#128221; Reason from HR</p>
        <p style="color:#4B5563;font-size:14px;font-style:italic;line-height:1.6;margin:0;">"${esc(ctx.rejectionReason)}"</p>
      </td></tr>
    </table>` : ''}

    <!-- Next steps -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFF7ED;border:1px solid #FED7AA;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#92400E;font-weight:700;font-size:14px;margin:0 0 8px;">&#128073; What to do next</p>
        <ul style="color:#78350F;font-size:13px;line-height:1.8;margin:0;padding-left:18px;">
          <li>Log in to the Aniston HRMS portal</li>
          <li>Navigate to KYC &amp; Documents section</li>
          <li>Re-upload clear, valid copies of the required documents</li>
          <li>Ensure documents are not expired and clearly legible</li>
          <li>Submit for HR review again</li>
        </ul>
      </td></tr>
    </table>

    ${ctaButton('https://hr.anistonav.com/kyc-pending', 'Re-submit KYC Documents', '#DC2626')}`,
    standardFooter('Aniston HRMS', 'https://hr.anistonav.com/kyc-pending')
  ),

  // ── Document Deleted / Re-upload Required ──

  'document-deleted': (ctx) => emailLayout(
    'linear-gradient(135deg,#DC2626 0%,#B91C1C 100%)', '&#128274;',
    'Document Removed — Action Required',
    `Re-upload required to continue your onboarding`,
    `<p style="color:#111827;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${esc(ctx.employeeName)}</strong>,</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Your HR team has removed one of your uploaded documents from the system.
      You must re-upload the correct document to continue your onboarding and regain dashboard access.
    </p>

    <!-- Alert banner -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF2F2;border:1px solid #FECACA;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#991B1B;font-weight:700;font-size:14px;margin:0 0 4px;">&#9888;&#65039; Document Removed by HR</p>
        <p style="color:#7F1D1D;font-size:13px;margin:0;line-height:1.5;">
          Your access to the dashboard will remain restricted until you re-upload the required document and it is approved by HR.
        </p>
      </td></tr>
    </table>

    <!-- Document details -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border:1px solid #E5E7EB;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#374151;font-weight:700;font-size:14px;margin:0 0 12px;">&#128196; Document Details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:140px;border-bottom:1px solid #F3F4F6;">Document Name</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${esc(ctx.docName)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Document Type</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${esc(ctx.docType)}</td>
          </tr>
          ${ctx.isCombinedPdf ? `
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Upload Type</td>
            <td style="padding:6px 0;color:#7C3AED;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">Combined PDF (all documents in one file)</td>
          </tr>` : ''}
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">Removed By</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">HR / Document Review Team</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Reason box -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFBEB;border:1px solid #FDE68A;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#92400E;font-weight:700;font-size:14px;margin:0 0 6px;">&#128221; Reason from HR</p>
        <p style="color:#78350F;font-size:13px;margin:0;line-height:1.6;">${esc(ctx.reason)}</p>
      </td></tr>
    </table>

    <!-- What to do next -->
    ${ctx.isCombinedPdf ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#1E40AF;font-weight:700;font-size:14px;margin:0 0 8px;">&#128221; Re-uploading a Combined PDF</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:3px 0;color:#1E3A5F;font-size:12px;">&#8226; Scan all your documents clearly (avoid dark, blurry, or cropped scans)</td></tr>
          <tr><td style="padding:3px 0;color:#1E3A5F;font-size:12px;">&#8226; Combine into one PDF: ID Proof &#8594; PAN Card &#8594; Education &#8594; Employment &#8594; Photographs</td></tr>
          <tr><td style="padding:3px 0;color:#1E3A5F;font-size:12px;">&#8226; Name the file: <strong>YourName_PreJoiningDocs.pdf</strong></td></tr>
          <tr><td style="padding:3px 0;color:#1E3A5F;font-size:12px;">&#8226; Maximum file size: 10MB</td></tr>
        </table>
      </td></tr>
    </table>` : `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EFF6FF;border:1px solid #BFDBFE;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#1E40AF;font-weight:700;font-size:14px;margin:0 0 8px;">&#128221; How to Re-upload</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:3px 0;color:#1E3A5F;font-size:12px;">&#8226; Ensure the document is clearly legible with no blur or glare</td></tr>
          <tr><td style="padding:3px 0;color:#1E3A5F;font-size:12px;">&#8226; Upload the correct document matching the type: <strong>${esc(ctx.docType)}</strong></td></tr>
          <tr><td style="padding:3px 0;color:#1E3A5F;font-size:12px;">&#8226; Accepted formats: PDF, JPG, PNG (max 5MB)</td></tr>
          <tr><td style="padding:3px 0;color:#1E3A5F;font-size:12px;">&#8226; Make sure all four corners are visible and the text is readable</td></tr>
        </table>
      </td></tr>
    </table>`}

    ${ctaButton(ctx.reuploadUrl || 'https://hr.anistonav.com/kyc-pending', 'Re-upload Document Now', '#DC2626')}

    <p style="color:#6B7280;font-size:12px;text-align:center;margin:8px 0 0;">
      Your dashboard access will be restored once the new document is reviewed and approved by HR.
    </p>`,
    standardFooter(ctx.orgName || 'Aniston Technologies', ctx.reuploadUrl)
  ),

  // ── Onboarding Completed — sent to admin when an employee finishes onboarding ──
  'asset-assigned': (ctx) => emailLayout(
    'linear-gradient(135deg,#0EA5E9 0%,#0284C7 100%)', '&#128187;',
    'Asset Assigned to You',
    `${esc(ctx.assetName)} has been assigned to you`,
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Hi <strong>${esc(ctx.employeeName)}</strong>, an asset has been assigned to you. Please acknowledge receipt and take good care of it.
    </p>

    <!-- Asset details -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F9FF;border:1px solid #BAE6FD;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#0369A1;font-weight:700;font-size:14px;margin:0 0 12px;">&#128187; Asset Details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:140px;border-bottom:1px solid #E0F2FE;">Asset Name</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:700;border-bottom:1px solid #E0F2FE;">${esc(ctx.assetName)}</td>
          </tr>
          ${ctx.assetCode ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #E0F2FE;">Asset Code</td><td style="padding:6px 0;color:#0369A1;font-size:13px;font-weight:600;font-family:monospace;border-bottom:1px solid #E0F2FE;">${esc(ctx.assetCode)}</td></tr>` : ''}
          ${ctx.category ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #E0F2FE;">Category</td><td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #E0F2FE;">${esc(ctx.category)}</td></tr>` : ''}
          ${ctx.brand ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #E0F2FE;">Brand / Model</td><td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #E0F2FE;">${esc(ctx.brand)}${ctx.model ? ` ${esc(ctx.model)}` : ''}</td></tr>` : ''}
          ${ctx.serialNumber ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #E0F2FE;">Serial No.</td><td style="padding:6px 0;color:#111827;font-size:13px;font-family:monospace;border-bottom:1px solid #E0F2FE;">${esc(ctx.serialNumber)}</td></tr>` : ''}
          ${ctx.condition ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #E0F2FE;">Condition</td><td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #E0F2FE;">${esc(ctx.condition)}</td></tr>` : ''}
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">Assigned On</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;">${ctx.assignedAt ? new Date(ctx.assignedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    ${ctx.notes ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFBEB;border:1px solid #FDE68A;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#92400E;font-weight:600;font-size:13px;margin:0 0 6px;">&#128221; Notes from Admin</p>
        <p style="color:#78350F;font-size:13px;margin:0;font-style:italic;">"${esc(ctx.notes)}"</p>
      </td></tr>
    </table>` : ''}

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0FDF4;border:1px solid #BBF7D0;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#14532D;font-weight:600;font-size:13px;margin:0 0 8px;">&#9989; Your Responsibilities</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:3px 0;color:#166534;font-size:12px;">&#8226; Keep this asset in good condition</td></tr>
          <tr><td style="padding:3px 0;color:#166534;font-size:12px;">&#8226; Report any damage or theft immediately to IT/Admin</td></tr>
          <tr><td style="padding:3px 0;color:#166534;font-size:12px;">&#8226; Return the asset when requested or upon exit</td></tr>
          <tr><td style="padding:3px 0;color:#166534;font-size:12px;">&#8226; Do not share company assets with external parties</td></tr>
        </table>
      </td></tr>
    </table>

    ${ctaButton(ctx.hrmsUrl || 'https://hr.anistonav.com/my-assets', 'View My Assets')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies')
  ),

  'onboarding-completed': (ctx) => emailLayout(
    'linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)', '&#127881;',
    'New Employee Onboarding Complete',
    `${esc(ctx.employeeName)} has completed their onboarding`,
    `<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">
      A new employee has successfully completed their onboarding process. Please prepare their workspace, laptop, and access credentials.
    </p>

    <!-- Photo + Name banner -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EEF2FF;border:1px solid #C7D2FE;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            ${ctx.photoUrl ? `<td style="width:64px;vertical-align:top;padding-right:16px;">
              <img src="${ctx.photoUrl}" width="56" height="56" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #C7D2FE;" alt="${esc(ctx.employeeName)}" />
            </td>` : ''}
            <td style="vertical-align:middle;">
              <p style="color:#3730A3;font-weight:700;font-size:18px;margin:0 0 2px;">${esc(ctx.employeeName)}</p>
              <p style="color:#4338CA;font-size:13px;margin:0;">${esc(ctx.designation || '')}${ctx.department ? ` &bull; ${esc(ctx.department)}` : ''}</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Employee details table -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border:1px solid #E5E7EB;margin:0 0 20px;">
      <tr><td style="padding:20px;">
        <p style="color:#374151;font-weight:700;font-size:14px;margin:0 0 12px;">&#128203; Employee Details</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;width:140px;border-bottom:1px solid #F3F4F6;">Employee Code</td>
            <td style="padding:6px 0;color:#4F46E5;font-size:13px;font-weight:700;border-bottom:1px solid #F3F4F6;">${esc(ctx.employeeCode || 'N/A')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Designation</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #F3F4F6;">${esc(ctx.designation || 'N/A')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Department</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #F3F4F6;">${esc(ctx.department || 'N/A')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Mobile Number</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #F3F4F6;">${esc(ctx.phone || 'N/A')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Work Mode</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #F3F4F6;">${esc((ctx.workMode || 'OFFICE').replace(/_/g, ' '))}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6;">Joining Date</td>
            <td style="padding:6px 0;color:#111827;font-size:13px;border-bottom:1px solid #F3F4F6;">${ctx.joiningDate ? new Date(ctx.joiningDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280;font-size:13px;">Onboarding Completed</td>
            <td style="padding:6px 0;color:#059669;font-size:13px;font-weight:600;">${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Action required box -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFBEB;border:1px solid #FDE68A;margin:0 0 20px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#92400E;font-weight:700;font-size:14px;margin:0 0 8px;">&#128085; Action Required — Prepare for this Employee</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Arrange laptop / desktop setup with required software</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Create company email account (if not done via Teams sync)</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Assign seating and issue access card / ID card</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Grant access to internal tools and shared drives</td></tr>
          <tr><td style="padding:3px 0;color:#78350F;font-size:12px;">&#8226; Inform the respective team / manager of the joining date</td></tr>
        </table>
      </td></tr>
    </table>

    ${ctaButton(ctx.hrmsUrl || 'https://hr.anistonav.com/employees', 'View Employee Profile in HRMS')}`,
    standardFooter(ctx.orgName || 'Aniston Technologies', ctx.hrmsUrl)
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
      let clientSecret = email.clientSecret;
      try { const { decrypt } = await import('../../utils/encryption.js'); clientSecret = decrypt(email.clientSecret); } catch { /* already plaintext (legacy) */ }
      return {
        authMethod: 'oauth2',
        host: '', port: 0, user: '', pass: '',
        fromAddress: email.senderEmail || email.fromAddress || '',
        fromName: email.fromName || 'Aniston HRMS',
        tenantId: email.tenantId,
        clientId: email.clientId,
        clientSecret,
        senderEmail: email.senderEmail || email.fromAddress,
      };
    }

    if (email?.host && email?.user && email?.pass) {
      let pass = email.pass;
      try { const { decrypt } = await import('../../utils/encryption.js'); pass = decrypt(email.pass); } catch { /* already plaintext (legacy) */ }
      return {
        authMethod: 'smtp',
        host: email.host,
        port: email.port || 587,
        user: email.user,
        pass,
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

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; path: string }[]
) {
  const config = await getEmailConfig();

  if (!config) {
    logger.info(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
    return;
  }

  try {
    if (config.authMethod === 'oauth2') {
      // Microsoft 365 Graph API — attachments not supported via this path
      if (attachments?.length) {
        logger.warn(`[EmailAttachment] ${attachments.length} attachment(s) skipped — Graph API path does not support file attachments. Use SMTP to send attachments.`);
      }
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
        requireTLS: true,
        auth: { user: config.user, pass: config.pass },
        tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
      });
      await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromAddress}>`,
        to, subject, html,
        attachments: attachments?.map((a) => ({ filename: a.filename, path: a.path })),
      });
      logger.info(`Email sent via SMTP to ${to}: ${subject}`);
    }
  } catch (err) {
    logger.error(`Failed to send email to ${to}:`, err);
    throw err;
  }
}

let emailWorkerInstance: Worker<EmailJob> | null = null;

export function startEmailWorker() {
  const worker = new Worker<EmailJob>(
    'email',
    async (job: Job<EmailJob>) => {
      const { to, subject, template, context, attachments } = job.data;
      const templateFn = templates[template] || templates.generic;
      const html = templateFn(context);
      await sendEmail(to, subject, html, attachments);
    },
    { connection: bullmqConnection, concurrency: 5 }
  );

  worker.on('completed', (job) => {
    logger.info(`Email job ${job.id} completed`);
  });

  worker.on('failed', async (job, err) => {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = (job?.opts?.attempts ?? 3);
    logger.error(`Email job ${job?.id} failed (attempt ${attempts}/${maxAttempts}):`, err);

    // Persist failed email record to Redis when all retries are exhausted
    if (job && attempts >= maxAttempts) {
      try {
        const failedRecord = JSON.stringify({
          jobId: job.id,
          to: job.data.to,
          subject: job.data.subject,
          template: job.data.template,
          error: err?.message || 'Unknown error',
          attempts,
          failedAt: new Date().toISOString(),
        });
        // Store in a Redis list (capped at 500 most recent failures)
        await redis.lpush('email:failed-log', failedRecord);
        await redis.ltrim('email:failed-log', 0, 499);
        logger.warn(`[EmailAudit] Permanently failed email logged: to=${job.data.to}, template=${job.data.template}`);
      } catch (auditErr) {
        logger.error(`[EmailAudit] Failed to persist email failure log:`, auditErr);
      }
    }
  });

  emailWorkerInstance = worker;
  logger.info('✅ Email worker started');
  return worker;
}

/**
 * Get email worker health status (for /api/health endpoint)
 */
export async function getEmailWorkerHealth(): Promise<{
  status: 'running' | 'stopped' | 'unknown';
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  try {
    const { emailQueue } = await import('../../jobs/queues.js');
    const [waiting, active, completed, failed] = await Promise.all([
      emailQueue.getWaitingCount(),
      emailQueue.getActiveCount(),
      emailQueue.getCompletedCount(),
      emailQueue.getFailedCount(),
    ]);
    return {
      status: emailWorkerInstance?.isRunning() ? 'running' : 'stopped',
      waiting,
      active,
      completed,
      failed,
    };
  } catch {
    return { status: 'unknown', waiting: 0, active: 0, completed: 0, failed: 0 };
  }
}

/**
 * Retrieve recent permanently failed email logs from Redis
 */
export async function getRecentFailedEmails(limit: number = 20): Promise<any[]> {
  try {
    const raw = await redis.lrange('email:failed-log', 0, limit - 1);
    return raw.map(r => JSON.parse(r));
  } catch {
    return [];
  }
}
