import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { salaryTemplateController } from './salary-template.controller.js';

const router = Router();
router.use(authenticate);

// All salary template operations require HR/Admin/SuperAdmin
const authRoles = authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR);

// CRUD
router.get('/', authRoles, (req, res, next) => salaryTemplateController.list(req, res, next));
router.post('/', authRoles, (req, res, next) => salaryTemplateController.create(req, res, next));
router.get('/:id', authRoles, (req, res, next) => salaryTemplateController.getById(req, res, next));
router.patch('/:id', authRoles, (req, res, next) => salaryTemplateController.update(req, res, next));
router.delete('/:id', authRoles, (req, res, next) => salaryTemplateController.delete(req, res, next));

// Apply template to employees
router.post('/apply', authRoles, (req, res, next) => salaryTemplateController.applyToEmployees(req, res, next));

// Save an employee's salary as a template
router.post('/save-from-employee', authRoles, (req, res, next) => salaryTemplateController.saveFromEmployee(req, res, next));

export { router as salaryTemplateRouter };
