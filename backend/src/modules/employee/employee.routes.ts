import { Router } from 'express';
import { employeeController } from './employee.controller.js';
import { authenticate, requirePermission, requirePermissionOrOwn } from '../../middleware/auth.middleware.js';
import { employeeDeletionController } from '../employee-deletion/employee-deletion.controller.js';
import { env } from '../../config/env.js';
import { uploadProfilePhoto, uploadEmailAttachment } from '../../middleware/upload.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.list(req, res, next)
);

router.get('/stats', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.stats(req, res, next)
);

// Lightweight peer list — all authenticated employees can fetch this for handover/backup selection
router.get('/peers', authenticate, async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const orgId = req.user!.organizationId;
    const myId = req.user!.employeeId;
    const peers = await prisma.employee.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isSystemAccount: false,
        status: { in: ['ACTIVE', 'PROBATION'] },
        ...(myId ? { id: { not: myId } } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: [{ department: { name: 'asc' } }, { firstName: 'asc' }],
    });
    res.json({ success: true, data: peers });
  } catch (err) { next(err); }
});

// Exit / Offboarding (must be before /:id to avoid param capture)
router.get('/exit-requests', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.getExitRequests(req, res, next)
);

router.post('/invite', requirePermission('employee', 'create'), (req, res, next) =>
  employeeController.invite(req, res, next)
);

// WhatsApp invitation
router.post('/invite-whatsapp', requirePermission('employee', 'create'), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const crypto = await import('crypto');
    const { firstName, lastName, phone, role, departmentId, designationId } = req.body;
    if (!firstName || !lastName || !phone || !role) {
      res.status(400).json({ success: false, error: { message: 'firstName, lastName, phone, and role are required' } }); return;
    }
    if (role === 'SUPER_ADMIN') { res.status(403).json({ success: false, error: { message: 'Cannot invite as Super Admin' } }); return; }
    // Strip formatting chars only — preserve country code for international support.
    // For bare 10-digit Indian numbers, add 91 prefix so sendToNumber resolves correctly.
    const rawDigits = phone.toString().replace(/\D/g, '');
    const cleanPhone = rawDigits.length === 10 ? '91' + rawDigits : rawDigits;
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      res.status(400).json({ success: false, error: { message: 'Invalid phone number — include country code, 10–15 digits (e.g. 919876543210 or 14155551234)' } }); return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const invitation = await prisma.employeeInvitation.create({
      data: {
        organizationId: req.user!.organizationId,
        invitedBy: req.user!.userId,
        mobileNumber: cleanPhone,
        role,
        departmentId: departmentId || null,
        designationId: designationId || null,
        inviteToken: token,
        expiresAt,
        status: 'PENDING',
      },
    });

    const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId } });
    const inviteUrl = `https://hr.anistonav.com/onboarding/invite/${token}`;
    const message = `🎉 *You're invited to join ${org?.name || 'the team'}!*\n\nHi ${firstName}! Your HR has set up your account.\n\n📱 *Set up your account:*\n${inviteUrl}\n\n⏰ Link expires in *72 hours*\n🎯 *Role:* ${role}`;

    let whatsappSent = false;
    try {
      const { whatsAppService } = await import('../whatsapp/whatsapp.service.js');
      const allowed = await whatsAppService.checkAutoSendQuota(req.user!.organizationId);
      if (allowed) {
        await whatsAppService.sendToNumber(cleanPhone, message, req.user!.organizationId);
        whatsappSent = true;
      } else {
        const { logger } = await import('../../lib/logger.js');
        logger.warn('[WhatsApp invite] Auto-send quota exceeded for org:', req.user!.organizationId);
      }
    } catch (e: any) {
      const { logger } = await import('../../lib/logger.js');
      logger.warn('[WhatsApp invite] Not sent:', e.message);
    }

    res.status(201).json({
      success: true,
      data: {
        invitationId: invitation.id,
        whatsappSent,
        message: whatsappSent ? `WhatsApp invitation sent to +91${cleanPhone}` : `Invitation saved. Connect WhatsApp in Settings to send automatically.`,
      },
    });
  } catch (err) { next(err); }
});

// HR: Bulk send app download / attendance instruction emails (legacy)
router.post('/send-bulk-email', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.sendBulkEmail(req, res, next)
);

// HR: Enhanced bulk email with template type, custom subject/body, and recipient filters
router.post('/bulk-email', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.bulkEmail(req, res, next)
);

// HR: Preview recipient count for bulk email filters
router.get('/bulk-email/preview', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.bulkEmailPreview(req, res, next)
);

// HR: Unified bulk email — merges all send modes + attachment support
router.post(
  '/unified-bulk-email',
  requirePermission('employee', 'manage'),
  uploadEmailAttachment.array('attachments', 5),
  (req, res, next) => employeeController.sendUnifiedBulkEmail(req, res, next)
);

// Org Chart: full hierarchy tree (no pagination)
router.get('/org-chart', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.getOrgChart(req, res, next)
);

router.post('/me/resign', (req, res, next) =>
  employeeController.submitResignation(req, res, next)
);

// Direct employee creation disabled — use invitation flow instead:
// POST /api/invitations → employee accepts → User + Employee created automatically
// router.post('/', requirePermission('employee', 'create'), (req, res, next) =>
//   employeeController.create(req, res, next)
// );

router.get('/:id', requirePermissionOrOwn('employee', 'read'), (req, res, next) =>
  employeeController.getById(req, res, next)
);

router.patch('/:id', requirePermissionOrOwn('employee', 'update'), (req, res, next) =>
  employeeController.update(req, res, next)
);

router.patch('/:id/role', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.changeRole(req, res, next)
);

router.patch('/:id/joining-date', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.updateJoiningDate(req, res, next)
);

router.delete('/:id', requirePermission('employee', 'delete'), (req, res, next) =>
  employeeController.delete(req, res, next)
);

// Super Admin: permanent delete with strong confirmation (POST to avoid accidental browser DELETE)
// POST /api/employees/:employeeId/permanent-delete
router.post('/:employeeId/permanent-delete',
  requirePermission('settings', 'manage'), // SUPER_ADMIN only via settings:manage
  (req, res, next) => {
    // Extra check: SUPER_ADMIN only — settings:manage is granted to SA only
    if (req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only Super Admin can permanently delete employees' } });
      return;
    }
    employeeDeletionController.directDelete(req, res, next);
  }
);

// Exit detail & actions
router.get('/:id/exit-details', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.getExitDetails(req, res, next)
);

router.post('/:id/approve-exit', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.approveExit(req, res, next)
);

router.post('/:id/complete-exit', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.completeExit(req, res, next)
);

router.post('/:id/withdraw-resignation', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.withdrawResignation(req, res, next)
);

router.post('/:id/terminate', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.initiateTermination(req, res, next)
);

// Activation Invite
router.post('/:id/send-activation-invite', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.sendActivationInvite(req, res, next)
);

// Lifecycle Events
router.get('/:id/events', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.getLifecycleEvents(req, res, next)
);

router.post('/:id/events', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.addLifecycleEvent(req, res, next)
);

router.delete('/:id/events/:eventId', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.deleteLifecycleEvent(req, res, next)
);

// Device sessions (admin view)
router.get('/:id/device-sessions', requirePermission('employee', 'read'), async (req, res, next) => {
  try {
    const employee = await (await import('../../lib/prisma.js')).prisma.employee.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { userId: true },
    });
    if (!employee?.userId) { res.json({ success: true, data: [] }); return; }
    const sessions = await (await import('../../lib/prisma.js')).prisma.deviceSession.findMany({
      where: { userId: employee.userId },
      orderBy: { lastActiveAt: 'desc' },
    });
    res.json({ success: true, data: sessions });
  } catch (err) { next(err); }
});

router.delete('/:id/device-sessions', requirePermission('employee', 'manage'), async (req, res, next) => {
  try {
    const employee = await (await import('../../lib/prisma.js')).prisma.employee.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { userId: true },
    });
    if (!employee?.userId) { res.json({ success: true, message: 'No sessions to clear' }); return; }
    await (await import('../../lib/prisma.js')).prisma.deviceSession.updateMany({
      where: { userId: employee.userId },
      data: { isActive: false },
    });
    res.json({ success: true, message: 'All device sessions cleared' });
  } catch (err) { next(err); }
});

// Profile photo upload
router.post(
  '/:id/photo',
  requirePermission('employee', 'update'),
  uploadProfilePhoto.single('photo'),
  (req, res, next) => employeeController.uploadProfilePhoto(req, res, next)
);

// Bank branch name campaign — sends email to all employees missing bankBranchName
router.post('/bank-branch-campaign', requirePermission('employee', 'manage'), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const { enqueueEmail } = await import('../../jobs/queues.js');
    const orgId = req.user!.organizationId;

    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    const orgName = org?.name || 'Aniston Technologies';

    // Find all active employees without a branch name who have an email
    const employees = await prisma.employee.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'PROBATION'] },
        bankBranchName: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        bankName: true,
        email: true,
      },
    });

    if (employees.length === 0) {
      res.json({ success: true, data: { sent: 0, message: 'All employees already have branch name filled.' } });
      return;
    }

    const profileBase = 'https://hr.anistonav.com/profile';
    let sent = 0;
    for (const emp of employees) {
      const email = emp.email;
      if (!email) continue;
      await enqueueEmail({
        to: email,
        subject: `Action Required: Update Your Bank Branch Name — ${orgName}`,
        template: 'bank-branch-update',
        context: {
          employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
          employeeCode: emp.employeeCode,
          bankName: emp.bankName || null,
          orgName,
          profileUrl: profileBase,
        },
      });
      sent++;
    }

    res.json({ success: true, data: { sent, total: employees.length, message: `Campaign emails queued for ${sent} employee(s).` } });
  } catch (err) { next(err); }
});

export { router as employeeRouter };
