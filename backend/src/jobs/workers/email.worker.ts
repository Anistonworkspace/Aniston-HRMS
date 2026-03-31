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

// Email templates
const templates: Record<string, (ctx: Record<string, any>) => string> = {
  'onboarding-invite': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to Aniston!</h1>
      </div>
      <div style="padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 0 0 12px 12px;">
        <p>Hi ${ctx.name},</p>
        <p>You've been invited to join Aniston Technologies. Please complete your onboarding by clicking the link below:</p>
        <a href="${ctx.link}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">
          Start Onboarding
        </a>
        <p style="color: #6B7280; font-size: 14px;">This link expires in 7 days.</p>
      </div>
    </div>
  `,
  'employee-invite': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F9FAFB;">
      <!-- Header with gradient -->
      <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 40px 32px; border-radius: 12px 12px 0 0; text-align: center;">
        <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          <span style="color: white; font-size: 28px; font-weight: bold;">A</span>
        </div>
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">You're Invited!</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 15px;">Join ${ctx.orgName} on Aniston HRMS</p>
      </div>

      <!-- Body -->
      <div style="padding: 36px 32px; background: #ffffff; border-left: 1px solid #E5E7EB; border-right: 1px solid #E5E7EB;">
        <p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">Hello,</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          <strong>${ctx.inviterName || 'The HR team'}</strong> has invited you to join <strong>${ctx.orgName}</strong>${ctx.role && ctx.role !== 'EMPLOYEE' ? ` as <strong>${ctx.role.replace(/_/g, ' ')}</strong>` : ''}. Click the button below to set up your password and complete your profile.
        </p>

        <!-- CTA Button -->
        <div style="text-align: center; margin: 28px 0;">
          <a href="${ctx.inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #4F46E5, #6366F1); color: white; padding: 14px 36px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; box-shadow: 0 4px 14px rgba(79,70,229,0.4);">
            Accept Invitation & Set Password
          </a>
        </div>

        <!-- What happens next -->
        <div style="background: #F0F0FF; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="color: #4338CA; font-weight: 600; margin: 0 0 10px; font-size: 14px;">What happens next?</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #6B7280; font-size: 13px; vertical-align: top; width: 24px;">1.</td>
              <td style="padding: 6px 0; color: #4B5563; font-size: 13px;">Set your password on the invite page</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6B7280; font-size: 13px; vertical-align: top;">2.</td>
              <td style="padding: 6px 0; color: #4B5563; font-size: 13px;">Log in with your email and new password</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6B7280; font-size: 13px; vertical-align: top;">3.</td>
              <td style="padding: 6px 0; color: #4B5563; font-size: 13px;">Complete your profile and upload documents</td>
            </tr>
          </table>
        </div>

        <!-- Pre-Joining Documents Section -->
        <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="color: #92400E; font-weight: 700; margin: 0 0 6px; font-size: 15px;">📋 Pre-Joining Documents Required</p>
          <p style="color: #78350F; font-size: 13px; margin: 0 0 14px; line-height: 1.5;">
            As part of the pre-joining formalities, please submit the following documents for verification and record-keeping.
            Combine all documents into <strong>one single PDF</strong> named: <strong>YourName_PreJoiningDocs.pdf</strong>
          </p>

          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0 4px; color: #92400E; font-weight: 600; font-size: 13px;" colspan="2">1. Education Certificates</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• 10th & 12th Marksheet / Certificate</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• Diploma / Degree Certificate</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• Post-Graduation Certificate (if applicable)</td>
            </tr>

            <tr>
              <td style="padding: 8px 0 4px; color: #92400E; font-weight: 600; font-size: 13px;" colspan="2">2. Identity Proof (any one)</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• Aadhaar Card / Passport / Driving License / Voter ID</td>
            </tr>

            <tr>
              <td style="padding: 8px 0 4px; color: #92400E; font-weight: 600; font-size: 13px;" colspan="2">3. PAN Card (Mandatory)</td>
            </tr>

            <tr>
              <td style="padding: 8px 0 4px; color: #92400E; font-weight: 600; font-size: 13px;" colspan="2">4. Residence Proof</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• Own House: Electricity / Water / Gas Bill</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• On Rent: Rent Agreement + Owner's Utility Bill (same address)</td>
            </tr>

            <tr>
              <td style="padding: 8px 0 4px; color: #92400E; font-weight: 600; font-size: 13px;" colspan="2">5. Passport Size Photographs</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• 2 recent photographs</td>
            </tr>

            <tr>
              <td style="padding: 8px 0 4px; color: #92400E; font-weight: 600; font-size: 13px;" colspan="2">6. Previous Employment (if applicable)</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• Offer / Appointment Letter</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• Last 3 Salary Slips OR Bank Statements (showing salary credit)</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• Relieving / Experience Letter</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• If serving notice: Resignation Acceptance Mail + HR Confirmation</td>
            </tr>

            <tr>
              <td style="padding: 8px 0 4px; color: #92400E; font-weight: 600; font-size: 13px;" colspan="2">7. Additional (if applicable)</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• Professional Certifications</td>
            </tr>
            <tr>
              <td style="padding: 2px 0 2px 16px; color: #78350F; font-size: 12px;" colspan="2">• PF / ESIC Number from last employer</td>
            </tr>
          </table>

          <div style="background: #FEF3C7; border-radius: 6px; padding: 12px; margin-top: 14px;">
            <p style="color: #92400E; font-weight: 600; font-size: 12px; margin: 0 0 6px;">📌 Submission Guidelines</p>
            <p style="color: #78350F; font-size: 12px; margin: 0; line-height: 1.6;">
              • All documents should be clearly scanned (PDF format preferred; avoid mobile screenshots)<br/>
              • Arrange in order: ID Proof → PAN Card → Education → Employment → Photographs<br/>
              • Combine all into one single PDF file<br/>
              • File name format: <strong>YourName_PreJoiningDocs.pdf</strong> (e.g., RahulSharma_PreJoiningDocs.pdf)
            </p>
          </div>
        </div>

        <p style="color: #EF4444; font-size: 13px; margin: 16px 0 0;">
          <strong>Expires:</strong> ${new Date(ctx.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (72 hours from now)
        </p>
      </div>

      <!-- Footer -->
      <div style="padding: 24px 32px; background: #F9FAFB; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
        <p style="color: #9CA3AF; font-size: 12px; margin: 0 0 8px;">If the button doesn't work, copy and paste this link:</p>
        <p style="color: #4F46E5; font-size: 12px; word-break: break-all; margin: 0 0 16px;">${ctx.inviteUrl}</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 16px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; margin: 0;">${ctx.orgName} | Powered by Aniston HRMS</p>
        <p style="color: #9CA3AF; font-size: 11px; margin: 4px 0 0;">If you didn't expect this email, you can safely ignore it.</p>
      </div>
    </div>
  `,
  'password-reset': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 12px;">
        <h2 style="color: #111827;">Password Reset</h2>
        <p>Hi ${ctx.name},</p>
        <p>We received a request to reset your password. Click the link below:</p>
        <a href="${ctx.link}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #6B7280; font-size: 14px;">If you didn't request this, ignore this email.</p>
      </div>
    </div>
  `,
  'leave-approved': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 12px;">
      <h2 style="color: #111827;">Leave ${ctx.status}</h2>
      <p>Hi ${ctx.name},</p>
      <p>Your leave request from <strong>${ctx.startDate}</strong> to <strong>${ctx.endDate}</strong> has been <strong>${ctx.status.toLowerCase()}</strong>.</p>
      ${ctx.remarks ? `<p style="color: #6B7280;">Remarks: ${ctx.remarks}</p>` : ''}
    </div>
  `,
  'resignation-submitted': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #DC2626, #EF4444); padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Resignation Notice</h1>
      </div>
      <div style="padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 0 0 12px 12px;">
        <p><strong>${ctx.name}</strong> (${ctx.employeeCode}) has submitted their resignation.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6B7280;">Department</td><td style="padding: 8px 0; font-weight: 600;">${ctx.department || 'N/A'}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Last Working Date</td><td style="padding: 8px 0; font-weight: 600;">${ctx.lastWorkingDate}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7280;">Reason</td><td style="padding: 8px 0;">${ctx.reason}</td></tr>
        </table>
        <a href="${ctx.link}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">
          Review in HRMS Portal
        </a>
      </div>
    </div>
  `,
  'exit-approved': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 12px;">
      <h2 style="color: #111827;">Resignation Approved</h2>
      <p>Hi ${ctx.name},</p>
      <p>Your resignation has been approved. Your last working date is <strong>${ctx.lastWorkingDate}</strong>.</p>
      <p>Please ensure the following before your last day:</p>
      <ul style="color: #4B5563;">
        <li>Return all assigned assets (laptop, access card, etc.)</li>
        <li>Complete knowledge transfer with your team</li>
        <li>Clear any pending no-dues items</li>
      </ul>
      ${ctx.notes ? `<p style="color: #6B7280;">Notes from HR: ${ctx.notes}</p>` : ''}
    </div>
  `,
  'exit-completed': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #059669, #10B981); padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Exit Process Complete</h1>
      </div>
      <div style="padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 0 0 12px 12px;">
        <p>Hi ${ctx.name},</p>
        <p>Your exit process from Aniston Technologies has been completed successfully.</p>
        <p>All no-dues have been cleared and your account has been deactivated.</p>
        <p style="color: #6B7280; margin-top: 24px;">We wish you all the very best for your future endeavours. Thank you for your contributions to Aniston Technologies.</p>
      </div>
    </div>
  `,
  'job-share': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #4F46E5, #0D9488); padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Job Opening at ${ctx.orgName}</h1>
      </div>
      <div style="padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 0 0 12px 12px;">
        <h2 style="color: #111827; margin-top: 0;">${ctx.jobTitle}</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          ${ctx.department ? `<tr><td style="padding: 8px 0; color: #6B7280; width: 120px;">Department</td><td style="padding: 8px 0; font-weight: 600;">${ctx.department}</td></tr>` : ''}
          ${ctx.location ? `<tr><td style="padding: 8px 0; color: #6B7280; width: 120px;">Location</td><td style="padding: 8px 0; font-weight: 600;">${ctx.location}</td></tr>` : ''}
          ${ctx.type ? `<tr><td style="padding: 8px 0; color: #6B7280; width: 120px;">Type</td><td style="padding: 8px 0; font-weight: 600;">${ctx.type.replace(/_/g, ' ')}</td></tr>` : ''}
        </table>
        ${ctx.customMessage ? `<p style="color: #4B5563; margin: 16px 0; padding: 12px; background: #F9FAFB; border-radius: 8px; border-left: 3px solid #4F46E5;">${ctx.customMessage}</p>` : ''}
        <p>We have an exciting opportunity that might interest you. Click the button below to learn more and apply:</p>
        <a href="${ctx.applyUrl}" style="display: inline-block; background: #4F46E5; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; margin: 16px 0; font-weight: 600;">
          Apply Now
        </a>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #6B7280; font-size: 13px;">If the button above doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #4F46E5; font-size: 13px; word-break: break-all;">${ctx.applyUrl}</p>
      </div>
    </div>
  `,
  'app-download': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F9FAFB;">
      <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 40px 32px; border-radius: 12px 12px 0 0; text-align: center;">
        <div style="width: 64px; height: 64px; background: rgba(255,255,255,0.2); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          <span style="color: white; font-size: 32px;">📱</span>
        </div>
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Download Aniston HRMS App</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 15px;">Mark attendance, apply leaves, and more — right from your phone</p>
      </div>
      <div style="padding: 36px 32px; background: #ffffff; border-left: 1px solid #E5E7EB; border-right: 1px solid #E5E7EB;">
        <p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">Hello <strong>${ctx.employeeName || 'there'}</strong>,</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          ${ctx.orgName} uses <strong>Aniston HRMS</strong> for attendance tracking, leave management, and more. Please install the app on your phone to mark your daily attendance.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${ctx.downloadUrl}" style="display: inline-block; background: linear-gradient(135deg, #4F46E5, #6366F1); color: white; padding: 16px 40px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; box-shadow: 0 4px 14px rgba(79,70,229,0.4);">
            📲 Install App Now
          </a>
        </div>
        <div style="background: #F0F0FF; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="color: #4338CA; font-weight: 600; margin: 0 0 12px; font-size: 14px;">📋 How to install:</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #4B5563; font-size: 13px; vertical-align: top; width: 24px;">1.</td><td style="padding: 6px 0; color: #4B5563; font-size: 13px;">Click the <strong>"Install App Now"</strong> button above</td></tr>
            <tr><td style="padding: 6px 0; color: #4B5563; font-size: 13px; vertical-align: top;">2.</td><td style="padding: 6px 0; color: #4B5563; font-size: 13px;">Tap <strong>"Install"</strong> or <strong>"Add to Home Screen"</strong> when prompted</td></tr>
            <tr><td style="padding: 6px 0; color: #4B5563; font-size: 13px; vertical-align: top;">3.</td><td style="padding: 6px 0; color: #4B5563; font-size: 13px;">Open the app from your home screen</td></tr>
            <tr><td style="padding: 6px 0; color: #4B5563; font-size: 13px; vertical-align: top;">4.</td><td style="padding: 6px 0; color: #4B5563; font-size: 13px;">Login with your email and password</td></tr>
            <tr><td style="padding: 6px 0; color: #4B5563; font-size: 13px; vertical-align: top;">5.</td><td style="padding: 6px 0; color: #4B5563; font-size: 13px;"><strong>Allow location & notification permissions</strong> when asked</td></tr>
          </table>
        </div>
        <div style="background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="color: #92400E; font-weight: 600; margin: 0 0 6px; font-size: 13px;">⚠️ Important</p>
          <p style="color: #78350F; font-size: 12px; margin: 0;">You <strong>must</strong> allow <strong>Location Permission</strong> for the attendance system to work. Without it, you cannot mark your attendance.</p>
        </div>
      </div>
      <div style="padding: 24px 32px; background: #F9FAFB; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
        <p style="color: #9CA3AF; font-size: 12px; margin: 0 0 8px;">If the button doesn't work, open this link in your phone browser:</p>
        <p style="color: #4F46E5; font-size: 12px; word-break: break-all; margin: 0 0 16px;">${ctx.downloadUrl}</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 16px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; margin: 0;">${ctx.orgName} | Powered by Aniston HRMS</p>
      </div>
    </div>
  `,
  'attendance-instructions': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F9FAFB;">
      <div style="background: linear-gradient(135deg, #059669, #10B981); padding: 40px 32px; border-radius: 12px 12px 0 0; text-align: center;">
        <div style="width: 64px; height: 64px; background: rgba(255,255,255,0.2); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          <span style="color: white; font-size: 32px;">⏰</span>
        </div>
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Attendance Instructions</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 15px;">How to mark your daily attendance using Aniston HRMS</p>
      </div>
      <div style="padding: 36px 32px; background: #ffffff; border-left: 1px solid #E5E7EB; border-right: 1px solid #E5E7EB;">
        <p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">Hello <strong>${ctx.employeeName || 'there'}</strong>,</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Please follow these instructions to mark your attendance daily using the Aniston HRMS app.
        </p>
        ${ctx.shiftInfo ? `
        <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 16px; margin: 0 0 20px;">
          <p style="color: #1E40AF; font-weight: 600; margin: 0 0 8px; font-size: 14px;">🕐 Your Shift</p>
          <p style="color: #1E3A5F; font-size: 14px; margin: 0;"><strong>${ctx.shiftInfo}</strong></p>
        </div>` : ''}
        <div style="background: #F0FDF4; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
          <p style="color: #166534; font-weight: 600; margin: 0 0 12px; font-size: 14px;">✅ Daily Attendance Steps:</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #166534; font-size: 13px; vertical-align: top; width: 24px;"><strong>1.</strong></td><td style="padding: 8px 0; color: #15803D; font-size: 13px;">Open <strong>Aniston HRMS</strong> app from your home screen</td></tr>
            <tr><td style="padding: 8px 0; color: #166534; font-size: 13px; vertical-align: top;"><strong>2.</strong></td><td style="padding: 8px 0; color: #15803D; font-size: 13px;">Tap the <strong>green "Check In"</strong> button at the bottom center</td></tr>
            <tr><td style="padding: 8px 0; color: #166534; font-size: 13px; vertical-align: top;"><strong>3.</strong></td><td style="padding: 8px 0; color: #15803D; font-size: 13px;"><strong>Allow location access</strong> if prompted (REQUIRED)</td></tr>
            <tr><td style="padding: 8px 0; color: #166534; font-size: 13px; vertical-align: top;"><strong>4.</strong></td><td style="padding: 8px 0; color: #15803D; font-size: 13px;">At the end of your shift, tap the <strong>red "Check Out"</strong> button</td></tr>
          </table>
        </div>
        <div style="background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 8px; padding: 16px; margin: 0 0 20px;">
          <p style="color: #92400E; font-weight: 600; margin: 0 0 8px; font-size: 13px;">⚠️ Mandatory Requirements</p>
          <ul style="color: #78350F; font-size: 12px; margin: 0; padding-left: 16px;">
            <li style="padding: 3px 0;"><strong>Location Permission:</strong> Must be ON at all times. Without it, attendance cannot be marked.</li>
            <li style="padding: 3px 0;"><strong>Notification Permission:</strong> Must be allowed for shift reminders and alerts.</li>
            <li style="padding: 3px 0;"><strong>Internet Connection:</strong> Required for real-time attendance sync.</li>
            <li style="padding: 3px 0;"><strong>Mark attendance from office only</strong> — geofence is enabled.</li>
          </ul>
        </div>
        <div style="background: #FEE2E2; border: 1px solid #FECACA; border-radius: 8px; padding: 16px; margin: 0 0 20px;">
          <p style="color: #991B1B; font-weight: 600; margin: 0 0 6px; font-size: 13px;">🚫 Do NOT</p>
          <ul style="color: #991B1B; font-size: 12px; margin: 0; padding-left: 16px;">
            <li style="padding: 2px 0;">Use GPS spoofing or fake location apps</li>
            <li style="padding: 2px 0;">Ask someone else to mark your attendance (proxy attendance = termination)</li>
            <li style="padding: 2px 0;">Disable location after checking in</li>
          </ul>
        </div>
        ${ctx.downloadUrl ? `
        <div style="text-align: center; margin: 24px 0;">
          <p style="color: #6B7280; font-size: 13px; margin: 0 0 12px;">Haven't installed the app yet?</p>
          <a href="${ctx.downloadUrl}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Download App</a>
        </div>` : ''}
      </div>
      <div style="padding: 24px 32px; background: #F9FAFB; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
        <p style="color: #9CA3AF; font-size: 11px; margin: 0;">For help, contact HR at ${ctx.hrEmail || 'hr@anistonav.com'}</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 12px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; margin: 0;">${ctx.orgName} | Powered by Aniston HRMS</p>
      </div>
    </div>
  `,
  'generic': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 12px;">
      <h2 style="color: #111827;">${ctx.title || 'Notification'}</h2>
      <p>${ctx.message || ''}</p>
    </div>
  `,
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
