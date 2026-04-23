import { Router } from 'express';
import { authenticate, authorize, requireEmpPerm } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { helpdeskController } from './helpdesk.controller.js';
import { helpdeskService } from './helpdesk.service.js';

const router = Router();
router.use(authenticate);

router.get('/my', (req, res, next) => helpdeskController.getMyTickets(req, res, next));
router.get('/all', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) => helpdeskController.getAll(req, res, next));
router.post('/', requireEmpPerm('canRaiseHelpdeskTickets'), (req, res, next) => helpdeskController.create(req, res, next));
router.get('/:id', (req, res, next) => helpdeskController.getById(req, res, next));
router.patch('/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) => helpdeskController.update(req, res, next));
router.post('/:id/comment', (req, res, next) => helpdeskController.addComment(req, res, next));

router.post('/:id/ai-analyze', authenticate, async (req, res, next) => {
  try {
    const result = await helpdeskService.analyzeTicket(req.params.id, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/:id/ai-suggest-response', authenticate, async (req, res, next) => {
  try {
    const result = await helpdeskService.suggestResponse(req.params.id, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export { router as helpdeskRouter };
