import { Request, Response, NextFunction } from 'express';
import { letterService } from './letter.service.js';
import { createLetterSchema, assignLetterSchema, updateAssignmentSchema } from './letter.validation.js';
import { Role } from '@aniston/shared';

const ADMIN_ROLES: string[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR];

export class LetterController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const letters = await letterService.list(req.user!.organizationId);
      res.json({ success: true, data: letters });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const letter = await letterService.getById(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: letter });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createLetterSchema.parse(req.body);
      const letter = await letterService.create(data, req.user!.userId, req.user!.organizationId);
      res.status(201).json({ success: true, data: letter, message: 'Letter created and assigned' });
    } catch (err) {
      next(err);
    }
  }

  async assign(req: Request, res: Response, next: NextFunction) {
    try {
      const data = assignLetterSchema.parse(req.body);
      const assignments = await letterService.assign(req.params.id as string, data, req.user!.organizationId);
      res.json({ success: true, data: assignments, message: 'Letter assigned' });
    } catch (err) {
      next(err);
    }
  }

  async updateAssignment(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateAssignmentSchema.parse(req.body);
      const assignment = await letterService.updateAssignment(
        req.params.assignmentId as string,
        data.downloadAllowed,
        req.user!.userId,
        req.user!.organizationId,
      );
      res.json({ success: true, data: assignment, message: 'Assignment updated' });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await letterService.delete(req.params.id as string, req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: null, message: 'Letter deleted' });
    } catch (err) {
      next(err);
    }
  }

  async getMyLetters(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No employee profile' } });
        return;
      }
      const letters = await letterService.getMyLetters(employeeId, req.user!.organizationId);
      res.json({ success: true, data: letters });
    } catch (err) {
      next(err);
    }
  }

  async getTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      const templates = await letterService.getTemplates(req.user!.organizationId);
      res.json({ success: true, data: templates });
    } catch (err) {
      next(err);
    }
  }

  // Secure stream — canvas rendering, no download
  async stream(req: Request, res: Response, next: NextFunction) {
    try {
      const isAdmin = ADMIN_ROLES.includes(req.user!.role);
      const { fullPath, filePath } = await letterService.getLetterFile(
        req.params.id as string,
        req.user!.employeeId,
        req.user!.organizationId,
        isAdmin,
      );
      const fileName = filePath.split('/').pop() || 'letter.pdf';

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });

      res.sendFile(fullPath, (err) => {
        if (err && !res.headersSent) {
          console.error(`[Letter:stream] sendFile error for ${fullPath}:`, err.message);
          next(err);
        }
      });
    } catch (err) {
      next(err);
    }
  }

  // Controlled download — checks per-assignment permission
  async download(req: Request, res: Response, next: NextFunction) {
    try {
      const isAdmin = ADMIN_ROLES.includes(req.user!.role);
      const employeeId = req.user!.employeeId;

      if (!isAdmin && employeeId) {
        const canDownload = await letterService.canDownload(req.params.id as string, employeeId, req.user!.organizationId);
        if (!canDownload) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Download not permitted for this letter' } });
          return;
        }
        await letterService.recordDownload(req.params.id as string, employeeId, req.user!.organizationId);
      }

      const { fullPath, filePath } = await letterService.getLetterFile(
        req.params.id as string,
        employeeId,
        req.user!.organizationId,
        isAdmin,
      );

      const fileName = filePath.split('/').pop() || 'letter.pdf';
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      });

      res.sendFile(fullPath, (err) => {
        if (err && !res.headersSent) {
          console.error(`[Letter:download] sendFile error for ${fullPath}:`, err.message);
          next(err);
        }
      });
    } catch (err) {
      next(err);
    }
  }
}

export const letterController = new LetterController();
