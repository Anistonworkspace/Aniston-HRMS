import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();

router.post('/login', (req, res, next) => authController.login(req, res, next));
router.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));
router.post('/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
router.post('/reset-password', (req, res, next) => authController.resetPassword(req, res, next));
router.post('/change-password', authenticate, (req, res, next) => authController.changePassword(req, res, next));
router.post('/admin-reset-password', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) => authController.adminResetPassword(req, res, next));
router.get('/me', authenticate, (req, res, next) => authController.me(req, res, next));

// MFA (TOTP Authenticator App)
router.get('/mfa/status', authenticate, (req, res, next) => authController.getMFAStatus(req, res, next));
router.post('/mfa/setup', authenticate, (req, res, next) => authController.setupMFA(req, res, next));
router.post('/mfa/verify-setup', authenticate, (req, res, next) => authController.verifyMFASetup(req, res, next));
router.post('/mfa/verify', (req, res, next) => authController.verifyMFA(req, res, next)); // no auth — mid-login
router.post('/mfa/disable', authenticate, (req, res, next) => authController.disableMFA(req, res, next));

// Employee Activation (public, no auth)
router.get('/activate/:token', (req, res, next) => authController.validateActivation(req, res, next));
router.patch('/activate/:token/complete', (req, res, next) => authController.completeActivation(req, res, next));

export { router as authRouter };
