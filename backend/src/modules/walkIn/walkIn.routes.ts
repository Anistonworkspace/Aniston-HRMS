import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { uploadDocument } from '../../middleware/upload.middleware.js';
import { walkInController } from './walkIn.controller.js';

const router = Router();

// =====================
// PUBLIC ROUTES (No Auth)
// =====================

// Get open job openings for the kiosk dropdown
router.get('/jobs', (req, res, next) => walkInController.getOpenJobs(req, res, next));

// Register a walk-in candidate (public kiosk)
router.post('/register', (req, res, next) => walkInController.register(req, res, next));

// Upload a file for walk-in candidate (public kiosk)
router.post('/upload', uploadDocument.single('file'), (req, res, next) => walkInController.uploadFile(req, res, next));

// Get walk-in record by token number (public — for completion screen)
router.get('/token/:tokenNumber', (req, res, next) => walkInController.getByToken(req, res, next));

// =====================
// HR ROUTES (Auth Required)
// =====================

// Get today's walk-ins (HR dashboard)
router.get('/today', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => walkInController.getTodayWalkIns(req, res, next)
);

// Get a specific walk-in record
router.get('/:id', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => walkInController.getById(req, res, next)
);

// Update walk-in status
router.patch('/:id/status', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => walkInController.updateStatus(req, res, next)
);

// Add HR notes
router.post('/:id/notes', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => walkInController.addNotes(req, res, next)
);

// Convert walk-in to full Application
router.patch('/:id/convert', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => walkInController.convertToApplication(req, res, next)
);

// Hire walk-in candidate (create employee + send onboarding email)
router.post('/:id/hire', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => walkInController.hire(req, res, next)
);

// Delete a walk-in record
router.delete('/:id', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => walkInController.remove(req, res, next)
);

export { router as walkInRouter };
