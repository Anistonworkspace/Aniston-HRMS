import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { employeeService } from './employee.service.js';
import { createEmployeeSchema, updateEmployeeSchema, employeeQuerySchema, submitResignationSchema, approveExitSchema, initiateTerminationSchema, exitQuerySchema } from './employee.validation.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';
import { logger } from '../../lib/logger.js';

export class EmployeeController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = employeeQuerySchema.parse(req.query);
      const result = await employeeService.list(query, req.user!.organizationId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async stats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await employeeService.getStats(req.user!.organizationId);
      res.json({ success: true, data: stats });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const employee = await employeeService.getById(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: employee });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createEmployeeSchema.parse(req.body);
      const result = await employeeService.create(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({
        success: true,
        data: result.employee,
        message: 'Employee created. Temporary password has been sent via email.',
      });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateEmployeeSchema.parse(req.body);
      const employee = await employeeService.update(
        req.params.id,
        data,
        req.user!.organizationId,
        req.user!.userId,
        req.user!.role
      );
      res.json({ success: true, data: employee, message: 'Employee updated' });
    } catch (err) {
      next(err);
    }
  }

  async changeRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = z.object({ role: z.string() }).parse(req.body);
      const result = await employeeService.changeRole(req.params.id, role, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: `Role changed to ${role}` });
    } catch (err) { next(err); }
  }

  async updateJoiningDate(req: Request, res: Response, next: NextFunction) {
    try {
      const { joiningDate } = z.object({ joiningDate: z.string().min(1) }).parse(req.body);
      const result = await employeeService.updateJoiningDate(req.params.id, joiningDate, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: 'Joining date updated' });
    } catch (err) { next(err); }
  }

  async invite(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, firstName, lastName } = z.object({
        email: z.string().email(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
      }).parse(req.body);
      const result = await employeeService.inviteEmployee(
        email, req.user!.organizationId, req.user!.userId, firstName, lastName
      );
      res.status(201).json({
        success: true,
        data: result,
        message: `Invitation sent to ${email}`,
      });
    } catch (err) {
      next(err);
    }
  }

  async bulkEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = z.object({
        templateType: z.enum(['WELCOME', 'PAYROLL_REMINDER', 'ATTENDANCE_REMINDER', 'ANNOUNCEMENT', 'CUSTOM']),
        subject: z.string().min(1, 'Subject is required').max(200),
        body: z.string().min(1, 'Body is required').max(10000),
        recipientFilter: z.object({
          departmentIds: z.array(z.string()).optional(),
          designationIds: z.array(z.string()).optional(),
          statuses: z.array(z.string()).optional(),
          roles: z.array(z.string()).optional(),
        }).optional(),
        testEmail: z.string().email().optional(),
      });

      const { templateType, subject, body, recipientFilter, testEmail } = schema.parse(req.body);

      const { enqueueEmail } = await import('../../jobs/queues.js');
      const { prisma } = await import('../../lib/prisma.js');

      // If testEmail is provided, send a single test email without fetching employees
      if (testEmail) {
        await enqueueEmail({ to: testEmail, subject: `[TEST] ${subject}`, template: 'generic', context: { title: subject, message: body } });
        res.json({ success: true, data: { queued: 1, testMode: true }, message: `Test email queued to ${testEmail}` });
        return;
      }

      // Build employee filter
      const where: Record<string, any> = {
        organizationId: req.user!.organizationId,
        deletedAt: null,
        email: { not: null },
      };

      if (recipientFilter?.departmentIds?.length) where.departmentId = { in: recipientFilter.departmentIds };
      if (recipientFilter?.designationIds?.length) where.designationId = { in: recipientFilter.designationIds };
      if (recipientFilter?.statuses?.length) where.status = { in: recipientFilter.statuses };
      if (recipientFilter?.roles?.length) where.user = { role: { in: recipientFilter.roles } };

      const employees = await prisma.employee.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, email: true },
      });

      const org = await prisma.organization.findUnique({
        where: { id: req.user!.organizationId },
        select: { name: true },
      });
      const orgName = org?.name || 'Aniston Technologies';

      const eligible = employees.filter((emp) => !!emp.email);

      await Promise.all(
        eligible.map((emp) =>
          enqueueEmail({
            to: emp.email!,
            subject,
            template: 'generic',
            context: { title: subject, message: body, employeeName: `${emp.firstName} ${emp.lastName}`, orgName },
          }).catch((err: any) => {
            logger.error(`[BulkEmail] Failed to queue for ${emp.email}:`, { error: err?.message });
          })
        )
      );

      res.json({
        success: true,
        data: { queued: eligible.length, totalMatched: employees.length },
        message: `${eligible.length} emails queued successfully`,
      });
    } catch (err) {
      next(err);
    }
  }

  async bulkEmailPreview(req: Request, res: Response, next: NextFunction) {
    try {
      // Query params come as comma-separated strings, e.g. departmentIds=id1,id2
      const splitParam = (v: unknown): string[] | undefined => {
        if (!v) return undefined;
        const arr = String(v).split(',').map((s) => s.trim()).filter(Boolean);
        return arr.length ? arr : undefined;
      };

      const filter = {
        departmentIds: splitParam(req.query.departmentIds),
        designationIds: splitParam(req.query.designationIds),
        statuses: splitParam(req.query.statuses),
        roles: splitParam(req.query.roles),
      };
      const { prisma } = await import('../../lib/prisma.js');

      const where: Record<string, any> = {
        organizationId: req.user!.organizationId,
        deletedAt: null,
        email: { not: null },
      };

      if (filter.departmentIds?.length) where.departmentId = { in: filter.departmentIds };
      if (filter.designationIds?.length) where.designationId = { in: filter.designationIds };
      if (filter.statuses?.length) where.status = { in: filter.statuses };
      if (filter.roles?.length) where.user = { role: { in: filter.roles } };

      const count = await prisma.employee.count({ where });
      res.json({ success: true, data: { recipientCount: count } });
    } catch (err) {
      next(err);
    }
  }

  async getOrgChart(req: Request, res: Response, next: NextFunction) {
    try {
      const { prisma } = await import('../../lib/prisma.js');

      const employees = await prisma.employee.findMany({
        where: { organizationId: req.user!.organizationId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          managerId: true,
          avatar: true,
          workMode: true,
          status: true,
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
        },
      });

      // Build recursive tree
      type OrgNode = {
        id: string;
        name: string;
        employeeCode: string;
        title: string | null;
        department: string | null;
        avatar: string | null;
        workMode: string;
        status: string;
        children: OrgNode[];
      };

      const map = new Map<string, OrgNode>();
      for (const emp of employees) {
        map.set(emp.id, {
          id: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          employeeCode: emp.employeeCode,
          title: emp.designation?.name ?? null,
          department: emp.department?.name ?? null,
          avatar: emp.avatar,
          workMode: emp.workMode,
          status: emp.status,
          children: [],
        });
      }

      const roots: OrgNode[] = [];
      for (const emp of employees) {
        const node = map.get(emp.id)!;
        if (emp.managerId && map.has(emp.managerId)) {
          map.get(emp.managerId)!.children.push(node);
        } else {
          roots.push(node);
        }
      }

      res.json({ success: true, data: roots });
    } catch (err) {
      next(err);
    }
  }

  async sendBulkEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeIds, templateType } = z.object({
        employeeIds: z.array(z.string().uuid()).min(1),
        templateType: z.enum(['app-download', 'attendance-instructions']),
      }).parse(req.body);

      const { enqueueEmail } = await import('../../jobs/queues.js');
      const { prisma } = await import('../../lib/prisma.js');

      const employees = await prisma.employee.findMany({
        where: { id: { in: employeeIds }, organizationId: req.user!.organizationId, deletedAt: null },
        include: { shiftAssignments: { include: { shift: true }, orderBy: { startDate: 'desc' }, take: 1 } },
      });

      const org = await prisma.organization.findUnique({
        where: { id: req.user!.organizationId },
        select: { name: true },
      });

      const downloadUrl = `https://hr.anistonav.com/download`;
      const orgName = org?.name || 'Aniston Technologies';
      const eligibleEmployees = employees.filter((emp) => !!emp.email);

      await Promise.all(
        eligibleEmployees.map((emp) => {
          const shift = emp.shiftAssignments?.[0]?.shift;
          const shiftInfo = shift ? `${shift.name} (${shift.startTime} - ${shift.endTime})` : undefined;
          const employeeName = `${emp.firstName} ${emp.lastName}`;

          const job = templateType === 'app-download'
            ? enqueueEmail({
                to: emp.email!,
                subject: `📲 Download Aniston HRMS App — ${orgName}`,
                template: 'app-download',
                context: { employeeName, orgName, downloadUrl },
              })
            : enqueueEmail({
                to: emp.email!,
                subject: `⏰ Attendance Instructions — ${orgName}`,
                template: 'attendance-instructions',
                context: { employeeName, orgName, shiftInfo, downloadUrl, hrEmail: 'hr@anistonav.com' },
              });

          return job.catch((err: any) => {
            // Log per-employee failure but don't abort the batch
            logger.error(`[BulkEmail] Failed to queue for ${emp.email}:`, { error: err?.message });
          });
        })
      );

      const sentCount = eligibleEmployees.length;

      res.json({ success: true, data: { queued: sentCount, sentCount, totalRequested: employeeIds.length }, message: `${sentCount} emails queued` });
    } catch (err) {
      next(err);
    }
  }

  async sendUnifiedBulkEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = z.object({
        // Recipient mode: 'selected' = specific employee IDs, 'filter' = dept/role/status filters, 'manual' = raw emails (for onboarding)
        recipientMode: z.enum(['selected', 'filter', 'manual']),
        employeeIds: z.preprocess((v) => {
          if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
          return v;
        }, z.array(z.string()).optional()),
        manualEmails: z.preprocess((v) => {
          if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
          return v;
        }, z.array(z.string().email()).optional()),
        filterDepartmentIds: z.preprocess((v) => typeof v === 'string' ? JSON.parse(v) : v, z.array(z.string()).optional()),
        filterDesignationIds: z.preprocess((v) => typeof v === 'string' ? JSON.parse(v) : v, z.array(z.string()).optional()),
        filterStatuses: z.preprocess((v) => typeof v === 'string' ? JSON.parse(v) : v, z.array(z.string()).optional()),
        filterRoles: z.preprocess((v) => typeof v === 'string' ? JSON.parse(v) : v, z.array(z.string()).optional()),
        // Template
        templateType: z.enum([
          'CUSTOM', 'WELCOME', 'PAYROLL_REMINDER', 'ATTENDANCE_REMINDER', 'ANNOUNCEMENT',
          'app-download', 'attendance-instructions', 'onboarding-invite',
        ]),
        subject: z.string().max(200).optional(),
        body: z.string().max(10000).optional(),
        testEmail: z.string().email().optional(),
      });

      const data = schema.parse(req.body);
      const { enqueueEmail } = await import('../../jobs/queues.js');
      const { prisma } = await import('../../lib/prisma.js');

      // Build attachment list from uploaded files
      const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];
      const attachments = uploadedFiles.map((f) => ({
        filename: f.originalname,
        path: f.path,
      }));

      const org = await prisma.organization.findUnique({
        where: { id: req.user!.organizationId },
        select: { name: true },
      });
      const orgName = org?.name || 'Aniston Technologies';
      const downloadUrl = 'https://hr.anistonav.com/download';

      // Test email shortcut — route through the correct template so HR sees what employees will receive
      if (data.testEmail) {
        const testSubject = data.subject || `[TEST] ${data.templateType}`;
        if (data.templateType === 'app-download') {
          await enqueueEmail({
            to: data.testEmail,
            subject: `[TEST] 📲 Download Aniston HRMS App — ${orgName}`,
            template: 'app-download',
            context: { orgName, downloadUrl },
            attachments,
          });
        } else if (data.templateType === 'attendance-instructions') {
          await enqueueEmail({
            to: data.testEmail,
            subject: `[TEST] ⏰ Attendance Instructions — ${orgName}`,
            template: 'attendance-instructions',
            context: { orgName, downloadUrl, hrEmail: 'hr@anistonav.com' },
            attachments,
          });
        } else if (data.templateType === 'onboarding-invite') {
          await enqueueEmail({
            to: data.testEmail,
            subject: `[TEST] You're invited to join ${orgName} — Complete your onboarding`,
            template: 'onboarding-invite',
            context: { orgName, email: data.testEmail, downloadUrl, androidDownloadUrl: `${downloadUrl}/android`, iosDownloadUrl: `${downloadUrl}/ios` },
            attachments,
          });
        } else {
          await enqueueEmail({
            to: data.testEmail,
            subject: `[TEST] ${testSubject}`,
            template: 'generic',
            context: { title: testSubject, message: data.body || '' },
            attachments,
          });
        }
        res.json({ success: true, data: { queued: 1, testMode: true }, message: `Test email sent to ${data.testEmail}` });
        return;
      }

      // Onboarding-invite: only supports 'selected' and 'manual' modes
      if (data.templateType === 'onboarding-invite') {
        if (data.recipientMode === 'filter') {
          res.status(400).json({ success: false, error: { message: 'Onboarding invites cannot be sent using group filters. Please select employees individually or enter emails manually.' } });
          return;
        }
        let emails: string[] = [];
        if (data.recipientMode === 'manual' && data.manualEmails?.length) {
          emails = data.manualEmails;
        } else if (data.recipientMode === 'selected' && data.employeeIds?.length) {
          const emps = await prisma.employee.findMany({
            where: { id: { in: data.employeeIds }, organizationId: req.user!.organizationId, deletedAt: null },
            select: { email: true },
          });
          emails = emps.filter((e) => !!e.email).map((e) => e.email!);
        }
        if (!emails.length) {
          res.status(400).json({ success: false, error: { message: 'No emails to send onboarding invites to' } });
          return;
        }
        let sent = 0;
        const errors: string[] = [];
        await Promise.all(emails.map(async (email) => {
          try {
            await enqueueEmail({
              to: email,
              subject: `You're invited to join ${orgName} — Complete your onboarding`,
              template: 'onboarding-invite',
              context: { orgName, email, downloadUrl, androidDownloadUrl: `${downloadUrl}/android`, iosDownloadUrl: `${downloadUrl}/ios` },
              attachments,
            });
            sent++;
          } catch (e: any) {
            errors.push(`${email}: ${e?.message}`);
          }
        }));
        res.json({ success: true, data: { queued: sent, sentCount: sent, skippedCount: errors.length, errors }, message: `${sent} onboarding invites queued` });
        return;
      }

      // manual mode for non-onboarding templates: send directly to the provided email addresses
      if (data.recipientMode === 'manual') {
        if (!data.manualEmails?.length) {
          res.status(400).json({ success: false, error: { message: 'No emails provided. Add at least one email address.' } });
          return;
        }
        const isCustom = ['CUSTOM', 'WELCOME', 'PAYROLL_REMINDER', 'ATTENDANCE_REMINDER', 'ANNOUNCEMENT'].includes(data.templateType);
        if (isCustom && (!data.subject?.trim() || !data.body?.trim())) {
          res.status(400).json({ success: false, error: { message: 'Subject and body are required.' } });
          return;
        }
        let queued = 0;
        await Promise.all(data.manualEmails.map(async (email) => {
          try {
            if (data.templateType === 'app-download') {
              await enqueueEmail({ to: email, subject: `📲 Download Aniston HRMS App — ${orgName}`, template: 'app-download', context: { orgName, downloadUrl }, attachments });
            } else if (data.templateType === 'attendance-instructions') {
              await enqueueEmail({ to: email, subject: `⏰ Attendance Instructions — ${orgName}`, template: 'attendance-instructions', context: { orgName, downloadUrl, hrEmail: 'hr@anistonav.com' }, attachments });
            } else {
              await enqueueEmail({ to: email, subject: data.subject!, template: 'generic', context: { title: data.subject, message: data.body, orgName }, attachments });
            }
            queued++;
          } catch (e: any) {
            logger.error(`[UnifiedBulkEmail] Failed for ${email}:`, { error: e?.message });
          }
        }));
        res.json({ success: true, data: { queued, totalMatched: data.manualEmails.length }, message: `${queued} emails queued successfully` });
        return;
      }

      // Build recipient list (selected or filter mode)
      if (data.recipientMode === 'selected' && (!data.employeeIds || data.employeeIds.length === 0)) {
        res.status(400).json({ success: false, error: { message: 'No employees selected. Please select at least one employee.' } });
        return;
      }

      let employees: { id: string; firstName: string; lastName: string; email: string | null }[] = [];

      if (data.recipientMode === 'selected' && data.employeeIds?.length) {
        employees = await prisma.employee.findMany({
          where: { id: { in: data.employeeIds }, organizationId: req.user!.organizationId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true },
        });
      } else if (data.recipientMode === 'filter') {
        const where: Record<string, any> = { organizationId: req.user!.organizationId, deletedAt: null };
        if (data.filterDepartmentIds?.length) where.departmentId = { in: data.filterDepartmentIds };
        if (data.filterDesignationIds?.length) where.designationId = { in: data.filterDesignationIds };
        if (data.filterStatuses?.length) where.status = { in: data.filterStatuses };
        if (data.filterRoles?.length) where.user = { role: { in: data.filterRoles } };
        employees = await prisma.employee.findMany({ where, select: { id: true, firstName: true, lastName: true, email: true } });
      }

      const eligible = employees.filter((e) => !!e.email);

      const isCustom = ['CUSTOM', 'WELCOME', 'PAYROLL_REMINDER', 'ATTENDANCE_REMINDER', 'ANNOUNCEMENT'].includes(data.templateType);

      if (isCustom && (!data.subject?.trim() || !data.body?.trim())) {
        res.status(400).json({ success: false, error: { message: 'Subject and body are required for custom/generic emails' } });
        return;
      }

      let queued = 0;
      await Promise.all(eligible.map(async (emp) => {
        try {
          const employeeName = `${emp.firstName} ${emp.lastName}`;
          if (data.templateType === 'app-download') {
            await enqueueEmail({
              to: emp.email!,
              subject: `📲 Download Aniston HRMS App — ${orgName}`,
              template: 'app-download',
              context: { employeeName, orgName, downloadUrl },
              attachments,
            });
          } else if (data.templateType === 'attendance-instructions') {
            await enqueueEmail({
              to: emp.email!,
              subject: `⏰ Attendance Instructions — ${orgName}`,
              template: 'attendance-instructions',
              context: { employeeName, orgName, downloadUrl, hrEmail: 'hr@anistonav.com' },
              attachments,
            });
          } else {
            await enqueueEmail({
              to: emp.email!,
              subject: data.subject!,
              template: 'generic',
              context: { title: data.subject, message: data.body, employeeName, orgName },
              attachments,
            });
          }
          queued++;
        } catch (e: any) {
          logger.error(`[UnifiedBulkEmail] Failed for ${emp.email}:`, { error: e?.message });
        }
      }));

      res.json({
        success: true,
        data: { queued, totalMatched: employees.length },
        message: `${queued} emails queued successfully`,
      });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await employeeService.softDelete(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: null, message: 'Employee deactivated' });
    } catch (err) {
      next(err);
    }
  }

  // Lifecycle Events
  async getLifecycleEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const events = await employeeService.getLifecycleEvents(req.params.id as string);
      res.json({ success: true, data: events });
    } catch (err) {
      next(err);
    }
  }

  async addLifecycleEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const data = z.object({
        eventType: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        eventDate: z.string().min(1),
        metadata: z.any().optional(),
      }).parse(req.body);
      const event = await employeeService.addLifecycleEvent(req.params.id as string, data, req.user!.userId);
      res.status(201).json({ success: true, data: event, message: 'Event added' });
    } catch (err) {
      next(err);
    }
  }

  async deleteLifecycleEvent(req: Request, res: Response, next: NextFunction) {
    try {
      await employeeService.deleteLifecycleEvent(req.params.eventId as string, req.user!.organizationId);
      res.json({ success: true, data: null, message: 'Event deleted' });
    } catch (err) {
      next(err);
    }
  }

  // Activation Invite
  async sendActivationInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.sendActivationInvite(
        req.params.id,
        req.user!.organizationId,
        req.user!.userId
      );
      res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  // Exit / Offboarding
  async submitResignation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = submitResignationSchema.parse(req.body);
      const result = await employeeService.submitResignation(req.user!.employeeId!, data, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Resignation submitted successfully' });
    } catch (err) { next(err); }
  }

  async getExitRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const query = exitQuerySchema.parse(req.query);
      const result = await employeeService.getExitRequests(req.user!.organizationId, query);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getExitDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.getExitDetails(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async approveExit(req: Request, res: Response, next: NextFunction) {
    try {
      const data = approveExitSchema.parse(req.body);
      const result = await employeeService.approveExit(req.params.id, req.user!.userId, data, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Exit approved' });
    } catch (err) { next(err); }
  }

  async completeExit(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.completeExit(req.params.id, req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Exit completed' });
    } catch (err) { next(err); }
  }

  async withdrawResignation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.withdrawResignation(req.params.id, req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Resignation withdrawn' });
    } catch (err) { next(err); }
  }

  async initiateTermination(req: Request, res: Response, next: NextFunction) {
    try {
      const data = initiateTerminationSchema.parse(req.body);
      const result = await employeeService.initiateTermination(req.params.id, data, req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Termination initiated' });
    } catch (err) { next(err); }
  }

  async uploadProfilePhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!req.file) throw new BadRequestError('No photo uploaded');
      const photoUrl = storageService.buildUrl(StorageFolder.PROFILES, req.file.filename);
      const employee = await employeeService.updateProfilePhoto(id, photoUrl, req.user!.organizationId);
      res.json({ success: true, data: employee });
    } catch (err) { next(err); }
  }
}

export const employeeController = new EmployeeController();
