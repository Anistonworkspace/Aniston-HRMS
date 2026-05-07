import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, mfaCodeSchema, mfaVerifySchema, adminResetPasswordSchema } from './auth.validation.js';
import { employeeService } from '../employee/employee.service.js';
import { createAuditLog } from '../../utils/auditLogger.js';

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = loginSchema.parse(req.body);
      const result = await authService.login(data.email, data.password, {
        deviceId: data.deviceId,
        deviceType: data.deviceType,
        userAgent: data.userAgent,
        forceLogin: data.forceLogin,
      });

      // MFA required — return temp token, do NOT set httpOnly cookie yet
      if ((result as any).mfaRequired) {
        res.json({
          success: true,
          data: {
            mfaRequired: true,
            tempToken: (result as any).tempToken,
            user: result.user,
            accessToken: '',
          },
          message: 'MFA verification required',
        });
        return;
      }

      // Set refresh token as httpOnly cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/auth',
      });

      // Native Capacitor clients can't use httpOnly cookies cross-origin (capacitor://localhost →
      // hr.anistonav.com). Return the token in the body so it can be persisted in localStorage.
      const isNativeApp = req.headers['x-native-app'] === 'true';
      res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
          user: result.user,
          ...(isNativeApp ? { refreshToken: result.refreshToken } : {}),
        },
        message: 'Login successful',
      });
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      // Accept token from httpOnly cookie (web) OR request body (native Capacitor clients
      // which can't send cross-origin cookies from capacitor://localhost).
      const refreshToken = req.cookies.refreshToken || req.body?.refreshToken;
      if (!refreshToken) {
        res.status(401).json({
          success: false,
          data: null,
          error: { code: 'UNAUTHORIZED', message: 'No refresh token provided' },
        });
        return;
      }

      const result = await authService.refreshAccessToken(refreshToken);

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });

      const isNativeApp = req.headers['x-native-app'] === 'true';
      res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
          ...(isNativeApp ? { refreshToken: result.refreshToken } : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = req.cookies.refreshToken;
      // Pass userId + deviceId from JWT so the service can free the DeviceSession slot
      // preventing a false DEVICE_CONFLICT on the next login from any device
      await authService.logout(
        refreshToken,
        req.user?.userId,
        req.user?.deviceId,
      );

      res.clearCookie('refreshToken', { path: '/api/auth' });
      res.json({ success: true, data: null, message: 'Logged out' });
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = forgotPasswordSchema.parse(req.body);
      const result = await authService.forgotPassword(data.email);
      res.json({ success: true, data: null, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = resetPasswordSchema.parse(req.body);
      const result = await authService.resetPassword(data.token, data.password);
      res.json({ success: true, data: null, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  async adminResetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = adminResetPasswordSchema.parse(req.body);
      const caller = req.user!;
      const result = await authService.adminResetPassword(data.targetUserId, {
        id: caller.userId,
        role: caller.role,
        organizationId: caller.organizationId,
      });
      await createAuditLog({
        userId: caller.userId,
        organizationId: caller.organizationId,
        action: 'ADMIN_PASSWORD_RESET',
        entity: 'User',
        entityId: data.targetUserId,
        newValue: { initiatedBy: caller.role },
      });
      res.json({ success: true, data: null, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = changePasswordSchema.parse(req.body);
      const result = await authService.changePassword(
        req.user!.userId,
        data.currentPassword,
        data.newPassword
      );
      // Rotate the refresh token cookie for this device
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });
      // Return new access token so the frontend can replace the old one in-memory
      res.json({ success: true, data: { accessToken: result.accessToken }, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await authService.getMe(req.user!.userId);
      res.json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  // Employee Activation
  async validateActivation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.validateActivationToken(req.params.token);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async completeActivation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.completeActivation(req.params.token);
      res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      next(err);
    }
  }
  // =================== MFA ===================

  async getMFAStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const mfa = await prisma.userMFA.findUnique({ where: { userId: req.user!.userId } });
      res.json({ success: true, data: { isEnabled: mfa?.isEnabled ?? false, enabledAt: mfa?.enabledAt ?? null } });
    } catch (err) { next(err); }
  }

  async setupMFA(req: Request, res: Response, next: NextFunction) {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const otplib = await import('otplib');
      const QRCode = await import('qrcode');
      const bcrypt = await import('bcryptjs');
      const crypto = await import('crypto');

      const secret = otplib.generateSecret();
      const otpauthUrl = otplib.generateURI({ issuer: 'Aniston HRMS', label: req.user!.email, secret });
      const qrCode = await QRCode.toDataURL(otpauthUrl);

      // Generate plain codes to show user once, then store hashed
      const plainCodes = Array.from({ length: 8 }, () => {
        const bytes = crypto.randomBytes(5);
        const hex = bytes.toString('hex').toUpperCase();
        return hex.slice(0, 4) + '-' + hex.slice(4, 8);
      });
      const hashedCodes = await Promise.all(plainCodes.map(c => bcrypt.default.hash(c, 10)));

      const { encrypt } = await import('../../utils/encryption.js');
      const encSecret = encrypt(secret);

      await prisma.userMFA.upsert({
        where: { userId: req.user!.userId },
        create: { userId: req.user!.userId, secret: encSecret, isEnabled: false, backupCodes: hashedCodes },
        update: { secret: encSecret, isEnabled: false, backupCodes: hashedCodes },
      });

      // Return plain codes to user — only time they are ever visible
      res.json({ success: true, data: { qrCode, secret, otpauthUrl, backupCodes: plainCodes } });
    } catch (err) { next(err); }
  }

  async verifyMFASetup(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = mfaCodeSchema.parse(req.body);
      const { prisma } = await import('../../lib/prisma.js');
      const otplib = await import('otplib');
      const mfa = await prisma.userMFA.findUnique({ where: { userId: req.user!.userId } });
      if (!mfa) { res.status(404).json({ success: false, error: { message: 'MFA not initialized. Call /mfa/setup first.' } }); return; }

      const { decrypt } = await import('../../utils/encryption.js');
      const secret = decrypt(mfa.secret);
      let setupCodeValid = false;
      try { setupCodeValid = otplib.verifySync({ token: code, secret })?.valid ?? false; } catch { setupCodeValid = false; }
      if (!setupCodeValid) {
        res.status(400).json({ success: false, error: { message: 'Invalid code. Check your authenticator app and try again.' } });
        return;
      }

      await prisma.userMFA.update({ where: { userId: req.user!.userId }, data: { isEnabled: true, enabledAt: new Date() } });
      createAuditLog({ userId: req.user!.userId, organizationId: req.user!.organizationId, entity: 'UserMFA', entityId: req.user!.userId, action: 'MFA_ENABLED', newValue: { enabledAt: new Date().toISOString() }, ipAddress: req.ip }).catch(() => {});
      res.json({ success: true, data: { message: 'Two-factor authentication enabled!' } });
    } catch (err) { next(err); }
  }

  async verifyMFA(req: Request, res: Response, next: NextFunction) {
    try {
      const { tempToken, token: code } = mfaVerifySchema.parse(req.body);
      const { prisma } = await import('../../lib/prisma.js');
      const otplib = await import('otplib');
      const jwt = await import('jsonwebtoken');
      const { env } = await import('../../config/env.js');

      let payload: any;
      try { payload = jwt.default.verify(tempToken, env.JWT_SECRET); }
      catch { res.status(401).json({ success: false, error: { message: 'Session expired. Please login again.' } }); return; }

      if (!payload.mfaPending) { res.status(401).json({ success: false, error: { message: 'Invalid token' } }); return; }

      const mfa = await prisma.userMFA.findUnique({ where: { userId: payload.userId } });
      if (!mfa?.isEnabled) { res.status(401).json({ success: false, error: { message: 'MFA not enabled' } }); return; }

      const { decrypt } = await import('../../utils/encryption.js');
      const secret = decrypt(mfa.secret);

      const isBackupCodeFormat = /^[A-F0-9]{4}-[A-F0-9]{4}$/i.test(code);
      let isValid = false;

      if (!isBackupCodeFormat) {
        // Only pass to TOTP verifier if it looks like a 6-digit code (avoids TokenLengthError)
        try {
          isValid = otplib.verifySync({ token: code, secret })?.valid ?? false;
        } catch { isValid = false; }
      }

      // Check backup codes (stored as bcrypt hashes)
      if (!isValid && isBackupCodeFormat) {
        const bcrypt = await import('bcryptjs');
        const upperCode = code.toUpperCase();
        let matchIdx = -1;
        for (let i = 0; i < mfa.backupCodes.length; i++) {
          if (await bcrypt.default.compare(upperCode, mfa.backupCodes[i])) { matchIdx = i; break; }
        }
        if (matchIdx !== -1) {
          isValid = true;
          const codes = [...mfa.backupCodes];
          codes.splice(matchIdx, 1);
          await prisma.userMFA.update({ where: { userId: payload.userId }, data: { backupCodes: codes } });
        }
      }

      if (!isValid) { res.status(401).json({ success: false, error: { message: 'Invalid code. Try again or use a backup code.' } }); return; }

      // Issue full tokens
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { employee: { include: { department: true, designation: true, documentGate: { select: { kycStatus: true } }, exitAccessConfig: true } } },
      });
      if (!user) { res.status(404).json({ success: false, error: { message: 'User not found' } }); return; }

      const accessToken = authService.generateAccessToken(user);
      const refreshToken = await authService.generateRefreshToken(user.id);

      // Update last login timestamp (same as normal login flow)
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/auth' });

      const userData = await authService.getMe(user.id);
      const isNativeAppMfa = req.headers['x-native-app'] === 'true';
      res.json({ success: true, data: { accessToken, user: userData, ...(isNativeAppMfa ? { refreshToken } : {}) } });
    } catch (err) { next(err); }
  }

  async disableMFA(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = mfaCodeSchema.parse(req.body);
      const { prisma } = await import('../../lib/prisma.js');
      const otplib = await import('otplib');
      const mfa = await prisma.userMFA.findUnique({ where: { userId: req.user!.userId } });
      if (!mfa?.isEnabled) { res.status(400).json({ success: false, error: { message: 'MFA is not enabled' } }); return; }

      const { decrypt } = await import('../../utils/encryption.js');
      const secret = decrypt(mfa.secret);
      let codeValid = false;
      try { codeValid = otplib.verifySync({ token: code, secret })?.valid ?? false; } catch { codeValid = false; }
      if (!codeValid) {
        res.status(401).json({ success: false, error: { message: 'Invalid code. MFA was NOT disabled.' } });
        return;
      }

      await prisma.userMFA.update({ where: { userId: req.user!.userId }, data: { isEnabled: false, enabledAt: null } });
      createAuditLog({ userId: req.user!.userId, organizationId: req.user!.organizationId, entity: 'UserMFA', entityId: req.user!.userId, action: 'MFA_DISABLED', newValue: { disabledAt: new Date().toISOString() }, ipAddress: req.ip }).catch(() => {});
      res.json({ success: true, data: { message: 'Two-factor authentication disabled.' } });
    } catch (err) { next(err); }
  }

  // =================== ADMIN MFA CONTROLS ===================

  async getEmployeeMFAStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const { prisma } = await import('../../lib/prisma.js');
      const targetUser = await prisma.user.findFirst({
        where: { id: userId, organizationId: req.user!.organizationId },
      });
      if (!targetUser) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
        return;
      }
      const mfa = await prisma.userMFA.findUnique({ where: { userId } });
      res.json({
        success: true,
        data: {
          isEnabled: mfa?.isEnabled ?? false,
          isConfigured: !!(mfa?.secret),
          enabledAt: mfa?.enabledAt ?? null,
        },
      });
    } catch (err) { next(err); }
  }

  async adminToggleMFA(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const { enabled } = req.body as { enabled: boolean };
      const { prisma } = await import('../../lib/prisma.js');

      const targetUser = await prisma.user.findFirst({
        where: { id: userId, organizationId: req.user!.organizationId },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });
      if (!targetUser) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
        return;
      }

      const mfa = await prisma.userMFA.findUnique({ where: { userId } });

      if (enabled) {
        if (!mfa?.secret) {
          res.status(400).json({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'Employee has not configured MFA. They must set it up from their profile first.' },
          });
          return;
        }
        await prisma.userMFA.update({ where: { userId }, data: { isEnabled: true, enabledAt: new Date() } });
      } else {
        if (!mfa) {
          res.json({ success: true, data: { message: 'MFA was not configured for this employee.' } });
          return;
        }
        await prisma.userMFA.update({ where: { userId }, data: { isEnabled: false, enabledAt: null } });
      }

      const empName = targetUser.employee
        ? `${targetUser.employee.firstName} ${targetUser.employee.lastName}`
        : targetUser.email;
      createAuditLog({
        userId: req.user!.userId,
        organizationId: req.user!.organizationId,
        entity: 'UserMFA',
        entityId: userId,
        action: enabled ? 'ADMIN_MFA_ENABLED' : 'ADMIN_MFA_DISABLED',
        newValue: { targetUserId: userId, targetEmployee: empName },
        ipAddress: req.ip,
      }).catch(() => {});

      res.json({
        success: true,
        data: {
          message: enabled
            ? 'MFA re-enabled for this employee.'
            : 'MFA disabled. Employee can now log in with password only.',
        },
      });
    } catch (err) { next(err); }
  }
}

export const authController = new AuthController();
