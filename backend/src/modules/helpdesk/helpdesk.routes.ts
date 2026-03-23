import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { helpdeskController } from './helpdesk.controller.js';

const router = Router();
router.use(authenticate);

router.get('/my', helpdeskController.getMyTickets);
router.get('/all', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), helpdeskController.getAll);
router.post('/', helpdeskController.create);
router.get('/:id', helpdeskController.getById);
router.patch('/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), helpdeskController.update);
router.post('/:id/comment', helpdeskController.addComment);

export { router as helpdeskRouter };
