import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { helpdeskController } from './helpdesk.controller.js';

const router = Router();
router.use(authenticate);

router.get('/my', (req, res, next) => helpdeskController.getMyTickets(req, res, next));
router.get('/all', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) => helpdeskController.getAll(req, res, next));
router.post('/', (req, res, next) => helpdeskController.create(req, res, next));
router.get('/:id', (req, res, next) => helpdeskController.getById(req, res, next));
router.patch('/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) => helpdeskController.update(req, res, next));
router.post('/:id/comment', (req, res, next) => helpdeskController.addComment(req, res, next));

export { router as helpdeskRouter };
