import { Router } from 'express';
import { authenticate, authorize, requireEmpPerm } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { profileEditRequestController } from './profile-edit-request.controller.js';

const router = Router();

// Employee: create a request
router.post('/', authenticate, requireEmpPerm('canViewEditProfile'), (req, res, next) =>
  profileEditRequestController.create(req, res, next)
);

// Employee: view own requests
router.get('/my', authenticate, requireEmpPerm('canViewEditProfile'), (req, res, next) =>
  profileEditRequestController.listMine(req, res, next)
);

// Employee: apply an approved edit (employee submits actual new data)
router.post('/:id/apply', authenticate, requireEmpPerm('canViewEditProfile'), (req, res, next) =>
  profileEditRequestController.apply(req, res, next)
);

// HR: view all pending requests (org-wide)
router.get('/', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  profileEditRequestController.listForOrg(req, res, next)
);

// HR: view requests for a specific employee
router.get('/employee/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  profileEditRequestController.listForEmployee(req, res, next)
);

// HR: approve or reject
router.patch('/:id/review', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  profileEditRequestController.review(req, res, next)
);

// HR or Employee: get profile completion status
router.get('/completion/:employeeId', authenticate, (req, res, next) =>
  profileEditRequestController.getProfileCompletion(req, res, next)
);

// Employee: own profile completion
router.get('/completion', authenticate, (req, res, next) =>
  profileEditRequestController.getProfileCompletion(req, res, next)
);

export { router as profileEditRequestRouter };
