import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.post('/login', (req, res, next) => authController.login(req, res, next));
router.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));
router.post('/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
router.post('/reset-password', (req, res, next) => authController.resetPassword(req, res, next));
router.post('/change-password', authenticate, (req, res, next) => authController.changePassword(req, res, next));
router.get('/me', authenticate, (req, res, next) => authController.me(req, res, next));

// Microsoft SSO
router.get('/sso-status', (req, res, next) => authController.ssoStatus(req, res, next));
router.get('/microsoft', (req, res, next) => authController.microsoftLogin(req, res, next));
router.get('/microsoft/callback', (req, res, next) => authController.microsoftCallback(req, res, next));

export { router as authRouter };
