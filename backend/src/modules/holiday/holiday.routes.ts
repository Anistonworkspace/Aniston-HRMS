import { Router } from 'express';
import { holidayController } from './holiday.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();

router.use(authenticate);

// All authenticated users can list holidays
router.get('/', (req, res, next) => holidayController.list(req, res, next));

// Only HR/Admin can create, update, delete
router.post('/',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => holidayController.create(req, res, next)
);

// Bulk create holidays (e.g. from AI suggestions)
router.post('/bulk',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => holidayController.bulkCreate(req, res, next)
);

// Get AI-suggested Indian holidays for a year
router.get('/suggestions',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => holidayController.getSuggestions(req, res, next)
);

router.patch('/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => holidayController.update(req, res, next)
);

router.delete('/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => holidayController.delete(req, res, next)
);

export { router as holidayRouter };
