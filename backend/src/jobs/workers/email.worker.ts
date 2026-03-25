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
  'generic': (ctx) => `
    <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #fff; border: 1px solid #E5E7EB; border-radius: 12px;">
      <h2 style="color: #111827;">${ctx.title || 'Notification'}</h2>
      <p>${ctx.message || ''}</p>
    </div>
  `,
};

async function sendEmail(to: string, subject: string, html: string) {
  // Use nodemailer if SMTP is configured, otherwise log
  if (env.SMTP_USER && env.SMTP_PASS) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
      await transporter.sendMail({ from: `"Aniston HRMS" <${env.SMTP_FROM}>`, to, subject, html });
      logger.info(`Email sent to ${to}: ${subject}`);
    } catch (err) {
      logger.error(`Failed to send email to ${to}:`, err);
      throw err;
    }
  } else {
    logger.info(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
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
