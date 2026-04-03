import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { employeeService } from './employee.service.js';
import { createEmployeeSchema, updateEmployeeSchema, employeeQuerySchema, submitResignationSchema, approveExitSchema, initiateTerminationSchema, exitQuerySchema } from './employee.validation.js';

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
      let sentCount = 0;

      for (const emp of employees) {
        if (!emp.email) continue;
        const shift = emp.shiftAssignments?.[0]?.shift;
        const shiftInfo = shift ? `${shift.name} (${shift.startTime} - ${shift.endTime})` : undefined;

        if (templateType === 'app-download') {
          await enqueueEmail({
            to: emp.email,
            subject: `📲 Download Aniston HRMS App — ${org?.name || 'Aniston Technologies'}`,
            template: 'app-download',
            context: {
              employeeName: `${emp.firstName} ${emp.lastName}`,
              orgName: org?.name || 'Aniston Technologies',
              downloadUrl,
            },
          });
        } else {
          await enqueueEmail({
            to: emp.email,
            subject: `⏰ Attendance Instructions — ${org?.name || 'Aniston Technologies'}`,
            template: 'attendance-instructions',
            context: {
              employeeName: `${emp.firstName} ${emp.lastName}`,
              orgName: org?.name || 'Aniston Technologies',
              shiftInfo,
              downloadUrl,
              hrEmail: 'hr@anistonav.com',
            },
          });
        }
        sentCount++;
      }

      res.json({ success: true, data: { queued: sentCount, sentCount, totalRequested: employeeIds.length }, message: `${sentCount} emails queued` });
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
}

export const employeeController = new EmployeeController();
