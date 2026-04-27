import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { bulkResumeService } from './bulk-resume.service.js';
import { recruitmentService } from './recruitment.service.js';

export class BulkResumeController {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, error: { message: 'No files uploaded' } });
      }
      const { jobOpeningId } = z.object({ jobOpeningId: z.string().uuid('Invalid job opening ID') }).parse(req.body);
      const result = await bulkResumeService.uploadBulkResumes(
        files, jobOpeningId, req.user!.userId, req.user!.organizationId
      );
      res.status(201).json({ success: true, data: result, message: `${files.length} resumes uploaded for processing` });
    } catch (err) { next(err); }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const uploads = await bulkResumeService.listBulkUploads(req.user!.organizationId);
      res.json({ success: true, data: uploads });
    } catch (err) { next(err); }
  }

  async getUpload(req: Request, res: Response, next: NextFunction) {
    try {
      const upload = await bulkResumeService.getBulkUpload(req.params.uploadId as string, req.user!.organizationId);
      res.json({ success: true, data: upload });
    } catch (err) { next(err); }
  }

  async createApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobOpeningId } = z.object({ jobOpeningId: z.string().uuid('Invalid job opening ID') }).parse(req.body);
      const application = await recruitmentService.createApplicationFromBulkItem(
        req.params.itemId as string, jobOpeningId, req.user!.organizationId
      );
      res.status(201).json({ success: true, data: application, message: 'Application created' });
    } catch (err) { next(err); }
  }

  async sendInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const { inviteType, phone, jobId } = z.object({
        inviteType: z.enum(['email', 'whatsapp']),
        phone: z.string().min(10).optional(),
        jobId: z.string().uuid(),
      }).parse(req.body);

      const { prisma } = await import('../../lib/prisma.js');
      const [item, org] = await Promise.all([
        prisma.bulkResumeItem.findFirst({
          where: { id: req.params.itemId, organizationId: req.user!.organizationId },
          include: { bulkUpload: { include: { jobOpening: { select: { title: true, publicFormToken: true, publicFormEnabled: true } } } } },
        }),
        prisma.organization.findUnique({ where: { id: req.user!.organizationId }, select: { name: true, address: true } }),
      ]);
      if (!item) { res.status(404).json({ success: false, error: { message: 'Resume item not found' } }); return; }

      const job = item.bulkUpload?.jobOpening;
      const candidateName = item.candidateName || 'Candidate';
      const baseUrl = 'https://hr.anistonav.com';
      const companyName = org?.name || 'Aniston Technologies LLP';
      const addr = org?.address as any;
      const venue = addr ? [addr.street, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ') : '207B, Jaksons Crown Heights, Sec-10, Rohini, New Delhi - 110085';

      if (inviteType === 'email') {
        if (!item.email) { res.status(400).json({ success: false, error: { message: 'No email found for this candidate' } }); return; }
        const { enqueueEmail } = await import('../../jobs/queues.js');
        const applyLink = job?.publicFormEnabled && job?.publicFormToken ? `${baseUrl}/apply/${job.publicFormToken}` : baseUrl;
        await enqueueEmail({
          to: item.email,
          subject: `Interview Invitation — ${job?.title || 'Open Position'} at ${companyName}`,
          template: 'interview-invite',
          context: {
            candidateName,
            jobTitle: job?.title || 'Open Position',
            applyLink,
            venue,
          },
        });
        res.json({ success: true, data: { sent: true, to: item.email, type: 'email' } });
      } else {
        const toPhone = phone || item.phone;
        if (!toPhone) { res.status(400).json({ success: false, error: { message: 'Phone number required for WhatsApp invite' } }); return; }
        const applyLink = job?.publicFormEnabled && job?.publicFormToken ? `${baseUrl}/apply/${job.publicFormToken}` : baseUrl;
        const message = `Hello ${candidateName},\n\nWe have reviewed your profile and would like to invite you to interview for the *${job?.title || 'open position'}* role at *${companyName}*.\n\nPlease complete your application here:\n${applyLink}\n\nVenue: ${venue}\n\nBest regards,\nHR Team | ${companyName}`;
        const { whatsAppService } = await import('../whatsapp/whatsapp.service.js');
        try {
          await whatsAppService.sendMessage({ to: toPhone, message }, req.user!.organizationId, req.user!.userId, 'INTERVIEW_INVITE');
          res.json({ success: true, data: { sent: true, to: toPhone, type: 'whatsapp' } });
        } catch (waErr: any) {
          // Return success with sent:false so the recruiter knows WhatsApp failed but the record is not lost
          res.json({ success: true, data: { sent: false, to: toPhone, type: 'whatsapp', reason: waErr.message?.includes('not connected') || waErr.message?.includes('Initialize') ? 'WhatsApp is not connected. Go to Settings → WhatsApp to connect.' : waErr.message || 'WhatsApp send failed' } });
        }
      }
    } catch (err) { next(err); }
  }

  async deleteUpload(req: Request, res: Response, next: NextFunction) {
    try {
      await bulkResumeService.deleteUpload(req.params.uploadId as string, req.user!.organizationId);
      res.json({ success: true, message: 'Upload and all items deleted' });
    } catch (err) { next(err); }
  }

  async deleteItem(req: Request, res: Response, next: NextFunction) {
    try {
      await bulkResumeService.deleteItem(req.params.itemId as string, req.user!.organizationId);
      res.json({ success: true, message: 'Resume item deleted' });
    } catch (err) { next(err); }
  }
}

export const bulkResumeController = new BulkResumeController();
