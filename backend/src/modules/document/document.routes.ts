import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize, requirePermission } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { uploadDocument, createEmployeeKycUpload, getEmployeeKycUrl } from '../../middleware/upload.middleware.js';
import { documentController } from './document.controller.js';
import { prisma } from '../../lib/prisma.js';

const router = Router();
router.use(authenticate);

// Employee: get own documents (must be BEFORE /:id to avoid conflict)
router.get('/my', (req, res, next) =>
  documentController.myDocuments(req, res, next)
);

router.get('/', requirePermission('document', 'read'), (req, res, next) =>
  documentController.list(req, res, next)
);

// HR: issue a letter document (Offer, Joining, Experience, Relieving)
router.post('/issue/:employeeId', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  documentController.issueLetter(req, res, next)
);

router.get('/:id', requirePermission('document', 'read'), (req, res, next) =>
  documentController.getById(req, res, next)
);

// Upload document — saves to employee-specific folder if employeeId is provided
router.post('/', requirePermission('document', 'create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Determine the employee to save file in their folder
    const employeeId = req.user?.employeeId || req.body?.employeeId || req.query?.employeeId;

    if (employeeId) {
      // Use employee-specific KYC folder: uploads/employees/{employeeId}/kyc/
      const kycUpload = createEmployeeKycUpload(employeeId as string);
      kycUpload.document.single('file')(req, res, (err: any) => {
        if (err) return next(err);
        if (!req.file) {
          res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
          return;
        }
        // Set the file URL to the structured path
        const fileUrl = getEmployeeKycUrl(employeeId as string, req.file.filename);
        // Attach to req for controller to use
        (req as any)._structuredFileUrl = fileUrl;
        documentController.upload(req, res, next);
      });
    } else {
      // Fallback to default uploads/ folder
      uploadDocument.single('file')(req, res, (err: any) => {
        if (err) return next(err);
        documentController.upload(req, res, next);
      });
    }
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/verify', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  documentController.verify(req, res, next)
);
router.delete('/:id', requirePermission('document', 'delete'), (req, res, next) =>
  documentController.remove(req, res, next)
);

// AI Offer Letter Preview
router.post('/ai-offer-preview/:employeeId', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { generateAiOfferLetterContent } = await import('../../utils/letterTemplates.js');
    const employee = await prisma.employee.findFirst({
      where: { id: req.params.employeeId, organizationId: req.user!.organizationId },
      include: { department: true, designation: true, salaryStructure: true, organization: true },
    });
    if (!employee) {
      res.status(404).json({ success: false, error: { message: 'Employee not found' } });
      return;
    }
    const content = await generateAiOfferLetterContent(req.user!.organizationId, {
      name: `${employee.firstName} ${employee.lastName}`,
      employeeCode: employee.employeeCode,
      email: employee.email,
      joiningDate: employee.joiningDate,
      designation: employee.designation?.name || '',
      department: employee.department?.name || '',
      ctc: employee.ctc?.toString() || '0',
      organization: employee.organization?.name || 'Aniston Technologies LLP',
    });
    res.json({ success: true, data: content });
  } catch (err) { next(err); }
});

export { router as documentRouter };
