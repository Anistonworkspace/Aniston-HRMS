import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { UnauthorizedError, NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import type { JwtPayload } from '../../middleware/auth.middleware.js';
import { employeePermissionService } from '../employee-permissions/employee-permissions.service.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';

const REFRESH_TOKEN_PREFIX = 'refresh_token:';
const RESET_TOKEN_PREFIX = 'reset_token:';

export class AuthService {
  async login(email: string, password: string, deviceInfo?: { deviceId?: string; deviceType?: string; userAgent?: string; forceLogin?: boolean }) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatar: true,
            status: true, exitStatus: true, workMode: true, onboardingComplete: true,
            isSystemAccount: true,
            phone: true, dateOfBirth: true, gender: true,
            address: true, emergencyContact: true,
            bankAccountNumber: true, bankName: true, ifscCode: true, accountHolderName: true,
            documentGate: { select: { kycStatus: true } },
            exitAccessConfig: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Allow login for exiting employees with exit access config
    if (user.status !== 'ACTIVE') {
      const exitAccess = user.employee?.exitAccessConfig;
      if (!exitAccess || !exitAccess.isActive) {
        throw new UnauthorizedError('Account is inactive. Contact your administrator.');
      }
      // Check if exit access has expired
      if (exitAccess.accessExpiresAt && new Date(exitAccess.accessExpiresAt) < new Date()) {
        throw new UnauthorizedError('Your limited access has expired. Contact your administrator.');
      }
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Device binding check (1 mobile + 1 desktop per user)
    if (deviceInfo?.deviceId && deviceInfo?.deviceType && ['mobile', 'desktop'].includes(deviceInfo.deviceType)) {
      const { deviceId, deviceType } = deviceInfo;
      const existingSession = await prisma.deviceSession.findUnique({
        where: { userId_deviceType: { userId: user.id, deviceType } },
      });
      if (existingSession?.isActive && existingSession.deviceId !== deviceId) {
        if (!deviceInfo.forceLogin) {
          throw new UnauthorizedError(
            `Your account is already active on another ${deviceType}. ` +
            `Click "Login on this device" to log out the other device automatically.`
          );
        }
        // forceLogin=true — deactivate old session and immediately revoke it
        const oldDeviceId = existingSession.deviceId;
        await prisma.deviceSession.update({
          where: { userId_deviceType: { userId: user.id, deviceType } },
          data: { isActive: false },
        });
        // Blacklist old device JWT for 24h — any access token will expire within this window
        await redis.setex(`revoked:session:${user.id}:${oldDeviceId}`, 86400, '1');
        // Revoke all refresh tokens so old device cannot silently obtain a new access token
        await this.revokeAllUserTokens(user.id);
        // Real-time kick via Socket.io — AppShell listener will dispatch logout immediately
        try {
          const { emitToUser } = await import('../../sockets/index.js');
          emitToUser(user.id, 'session:revoked', { deviceType, reason: 'login_from_new_device' });
        } catch { /* non-blocking — socket may not be initialized */ }
        // Gap 6: Audit log the force-login device kick
        try {
          const { createAuditLog } = await import('../../utils/auditLogger.js');
          createAuditLog({
            userId: user.id,
            organizationId: user.organizationId,
            action: 'FORCE_LOGIN_DEVICE_KICK',
            entity: 'DeviceSession',
            entityId: user.id,
            oldValue: { deviceId: oldDeviceId, deviceType },
            newValue: { newDeviceId: deviceId, deviceType, ip: deviceInfo.userAgent },
          }).catch(() => {});
        } catch { /* non-blocking */ }
      }
      await prisma.deviceSession.upsert({
        where: { userId_deviceType: { userId: user.id, deviceType } },
        create: { userId: user.id, deviceId, deviceType, userAgent: (deviceInfo.userAgent || '').slice(0, 200), isActive: true },
        update: { deviceId, userAgent: (deviceInfo.userAgent || '').slice(0, 200), lastActiveAt: new Date(), isActive: true },
      });
    }

    // Check if MFA is enabled — if so, return temp token instead of full access
    const mfa = await prisma.userMFA.findUnique({ where: { userId: user.id } });
    if (mfa?.isEnabled) {
      // Gap 2: embed deviceId in tempToken so verifyMFA can re-embed it in the full access token
      const tempToken = jwt.sign(
        { userId: user.id, mfaPending: true, ...(deviceInfo?.deviceId ? { deviceId: deviceInfo.deviceId } : {}) },
        env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return {
        accessToken: '',
        refreshToken: '',
        mfaRequired: true,
        tempToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          employeeId: user.employee?.id,
          firstName: user.employee?.firstName,
          lastName: user.employee?.lastName,
          avatar: user.employee?.avatar,
          organizationId: user.organizationId,
        },
      } as any;
    }

    // Generate tokens — embed deviceId so middleware can check session revocation
    const accessToken = this.generateAccessToken(user, deviceInfo?.deviceId);
    const refreshToken = await this.generateRefreshToken(user.id, deviceInfo?.deviceId);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const exitAccess = user.employee?.exitAccessConfig;
    // Admin roles always bypass onboarding/KYC gates
    const isAdminRole = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(user.role);
    const kycCompleted = isAdminRole ? true : (user.employee?.documentGate?.kycStatus === 'VERIFIED');
    const kycStatus = isAdminRole ? 'VERIFIED' : (user.employee?.documentGate?.kycStatus ?? 'PENDING');
    const onboardingComplete = isAdminRole ? true : (user.employee?.onboardingComplete ?? true);
    const profileComplete = isAdminRole ? true : this.calculateProfileComplete(user.employee, mfa?.isEnabled ?? false);

    // Get feature permissions for non-admin active employees
    let featurePermissions = null;
    const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    if (user.employee?.id && !adminRoles.includes(user.role) && !exitAccess?.isActive) {
      try {
        const perms = await employeePermissionService.getEffectivePermissions(
          user.employee.id, user.role as any, user.organizationId
        );
        const hasRestrictions = Object.values(perms).some(v => v === false);
        if (hasRestrictions) featurePermissions = perms;
      } catch { /* fail silently */ }
    }

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employee?.id,
        firstName: user.employee?.firstName,
        lastName: user.employee?.lastName,
        avatar: user.employee?.avatar,
        organizationId: user.organizationId,
        workMode: user.employee?.workMode,
        isSystemAccount: user.employee?.isSystemAccount ?? false,
        kycCompleted,
        kycStatus,
        onboardingComplete,
        profileComplete,
        featurePermissions,
        exitAccess: exitAccess?.isActive ? {
          canViewDashboard: exitAccess.canViewDashboard,
          canViewPayslips: exitAccess.canViewPayslips,
          canDownloadPayslips: exitAccess.canDownloadPayslips,
          canViewAttendance: exitAccess.canViewAttendance,
          canMarkAttendance: exitAccess.canMarkAttendance,
          canApplyLeave: exitAccess.canApplyLeave,
          canViewLeaveBalance: exitAccess.canViewLeaveBalance,
          canViewDocuments: exitAccess.canViewDocuments,
          canDownloadDocuments: exitAccess.canDownloadDocuments,
          canViewHelpdesk: exitAccess.canViewHelpdesk,
          canCreateTicket: exitAccess.canCreateTicket,
          canViewAnnouncements: exitAccess.canViewAnnouncements,
          canViewProfile: exitAccess.canViewProfile,
          accessExpiresAt: exitAccess.accessExpiresAt?.toISOString(),
        } : null,
      },
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const stored = await redis.get(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
    if (!stored) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Gap 1: stored value is JSON { userId, deviceId } — fall back to plain userId string
    // for tokens issued before this change (forward-compatible migration)
    let userId: string;
    let storedDeviceId: string | undefined;
    try {
      const parsed = JSON.parse(stored) as { userId: string; deviceId?: string };
      userId = parsed.userId;
      storedDeviceId = parsed.deviceId;
    } catch {
      userId = stored; // legacy plain-string token
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            documentGate: { select: { kycStatus: true } },
            exitAccessConfig: { select: { isActive: true, accessExpiresAt: true } },
          },
        },
      },
    });

    if (!user) {
      await redis.del(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
      throw new UnauthorizedError('User not found or inactive');
    }

    // Allow refresh for exiting employees with active exit access
    if (user.status !== 'ACTIVE') {
      const exitAccess = user.employee?.exitAccessConfig;
      const hasValidExitAccess = exitAccess?.isActive &&
        (!exitAccess.accessExpiresAt || new Date(exitAccess.accessExpiresAt) > new Date());
      if (!hasValidExitAccess) {
        await redis.del(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
        throw new UnauthorizedError('User not found or inactive');
      }
    }

    // Rotate refresh token — remove old key from tracking set, add new one
    const oldKey = `${REFRESH_TOKEN_PREFIX}${refreshToken}`;
    await redis.del(oldKey);
    await redis.srem(`refresh_token_set:${user.id}`, oldKey);
    const newRefreshToken = await this.generateRefreshToken(user.id, storedDeviceId);

    // Re-embed the same deviceId that was stored with this token — exact slot, not a guess
    const accessToken = this.generateAccessToken(user, storedDeviceId);

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string, userId?: string, deviceId?: string) {
    if (refreshToken) {
      const key = `${REFRESH_TOKEN_PREFIX}${refreshToken}`;
      // Look up userId from token if not passed (needed to clean the tracking set)
      const storedUserId = userId || await redis.get(key);
      await redis.del(key);
      if (storedUserId) {
        await redis.srem(`refresh_token_set:${storedUserId}`, key);
      }
    }
    // Clear the device session slot so the next login from any device doesn't see a false conflict
    if (userId && deviceId) {
      await prisma.deviceSession.updateMany({
        where: { userId, deviceId, isActive: true },
        data: { isActive: false },
      }).catch(() => { /* non-blocking */ });
    } else if (userId) {
      // No deviceId available — clear all active sessions for this user (full logout)
      await prisma.deviceSession.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      }).catch(() => { /* non-blocking */ });
    }
  }

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      // Don't reveal whether email exists
      return { message: 'If the email exists, a reset link has been sent' };
    }

    const resetToken = randomBytes(32).toString('hex');
    await redis.setex(`${RESET_TOKEN_PREFIX}${resetToken}`, 3600, user.id); // 1 hour

    // Send password reset email
    const resetUrl = `https://hr.anistonav.com/reset-password/${resetToken}`;
    await enqueueEmail({
      to: user.email,
      subject: 'Reset Your Aniston HRMS Password',
      template: 'password-reset',
      context: {
        name: user.email.split('@')[0],
        link: resetUrl,
      },
    }).catch((err) => logger.error(`[Auth] Failed to enqueue password reset email for ${email}:`, err));

    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    const userId = await redis.get(`${RESET_TOKEN_PREFIX}${token}`);
    if (!userId) {
      throw new BadRequestError('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await redis.del(`${RESET_TOKEN_PREFIX}${token}`);

    // Invalidate all refresh tokens for this user using SCAN (non-blocking)
    await this.revokeAllUserTokens(userId);

    return { message: 'Password reset successfully' };
  }

  async adminResetPassword(
    targetUserId: string,
    caller: { id: string; role: string; organizationId: string }
  ) {
    const [target, callerUser] = await Promise.all([
      prisma.user.findUnique({
        where: { id: targetUserId },
        include: { employee: { select: { firstName: true, lastName: true } } },
      }),
      prisma.user.findUnique({
        where: { id: caller.id },
        include: { employee: { select: { firstName: true } } },
      }),
    ]);

    if (!target) throw new NotFoundError('User');

    // Multi-tenant guard: HR/Admin can only reset users in their own org
    if (caller.role !== 'SUPER_ADMIN' && target.organizationId !== caller.organizationId) {
      throw new NotFoundError('User');
    }

    // Role hierarchy: HR can only reset EMPLOYEE / INTERN / GUEST_INTERVIEWER / MANAGER
    // Admin can reset anyone except SUPER_ADMIN
    const PROTECTED_BY_HR = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    const PROTECTED_BY_ADMIN = ['SUPER_ADMIN'];
    if (caller.role === 'HR' && PROTECTED_BY_HR.includes(target.role)) {
      throw new BadRequestError('HR cannot reset passwords for Admin or Super Admin accounts');
    }
    if (caller.role === 'ADMIN' && PROTECTED_BY_ADMIN.includes(target.role)) {
      throw new BadRequestError('Admin cannot reset Super Admin passwords');
    }
    // Prevent self-reset via this endpoint (use changePassword instead)
    if (target.id === caller.id) {
      throw new BadRequestError('Use the change password option to update your own password');
    }

    const resetToken = randomBytes(32).toString('hex');
    // 24-hour window — longer than self-service since employee may not check email immediately
    await redis.setex(`${RESET_TOKEN_PREFIX}${resetToken}`, 86400, target.id);

    const resetUrl = `https://hr.anistonav.com/reset-password/${resetToken}`;
    const employeeName = target.employee
      ? `${target.employee.firstName} ${target.employee.lastName}`.trim()
      : target.email.split('@')[0];
    const initiatorName = callerUser?.employee?.firstName || caller.role;

    await enqueueEmail({
      to: target.email,
      subject: 'Your Aniston HRMS Password Has Been Reset',
      template: 'admin-password-reset',
      context: {
        name: employeeName,
        initiatorName,
        link: resetUrl,
      },
    }).catch((err) => logger.error(`[Auth] Failed to enqueue admin password reset email for ${target.email}:`, err));

    return { message: `Password reset link sent to ${target.email}` };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('User');
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestError('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      include: { employee: { select: { id: true } } },
    });

    // Invalidate ALL existing refresh token sessions (kicks other devices out on next refresh)
    await this.revokeAllUserTokens(userId);

    // Issue a fresh token pair for the requesting device so they stay logged in
    const newAccessToken = this.generateAccessToken(updatedUser);
    const newRefreshToken = await this.generateRefreshToken(userId);

    return { message: 'Password changed successfully', accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async getMe(userId: string) {
    const [user, mfa] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          employee: {
            include: {
              department: true,
              designation: true,
              documents: { select: { id: true }, take: 1 },
              documentGate: { select: { kycStatus: true } },
              exitAccessConfig: true,
            },
          },
        },
      }),
      prisma.userMFA.findUnique({ where: { userId }, select: { isEnabled: true } }),
    ]);

    if (!user) {
      throw new NotFoundError('User');
    }

    const exitAccess = user.employee?.exitAccessConfig;
    // Admin roles always bypass onboarding/KYC gates
    const isAdminRole = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(user.role);
    const kycCompleted = isAdminRole ? true : (user.employee?.documentGate?.kycStatus === 'VERIFIED');
    const kycStatus = isAdminRole ? 'VERIFIED' : (user.employee?.documentGate?.kycStatus ?? 'PENDING');
    const onboardingComplete = isAdminRole ? true : (user.employee?.onboardingComplete ?? true);
    const profileComplete = isAdminRole ? true : this.calculateProfileComplete(user.employee, mfa?.isEnabled ?? false);

    let featurePermissions = null;
    const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    if (user.employee?.id && !adminRoles.includes(user.role) && !exitAccess?.isActive) {
      try {
        const perms = await employeePermissionService.getEffectivePermissions(
          user.employee.id, user.role as any, user.organizationId
        );
        const hasRestrictions = Object.values(perms).some(v => v === false);
        if (hasRestrictions) featurePermissions = perms;
      } catch { /* fail silently */ }
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      employeeId: user.employee?.id,
      firstName: user.employee?.firstName,
      lastName: user.employee?.lastName,
      avatar: user.employee?.avatar,
      department: user.employee?.department?.name,
      designation: user.employee?.designation?.name,
      workMode: user.employee?.workMode,
      profileCompletion: this.calculateProfileCompletion(user.employee),
      kycCompleted,
      kycStatus,
      onboardingComplete,
      profileComplete,
      featurePermissions,
      exitAccess: exitAccess?.isActive ? {
        canViewDashboard: exitAccess.canViewDashboard,
        canViewPayslips: exitAccess.canViewPayslips,
        canDownloadPayslips: exitAccess.canDownloadPayslips,
        canViewAttendance: exitAccess.canViewAttendance,
        canMarkAttendance: exitAccess.canMarkAttendance,
        canApplyLeave: exitAccess.canApplyLeave,
        canViewLeaveBalance: exitAccess.canViewLeaveBalance,
        canViewDocuments: exitAccess.canViewDocuments,
        canDownloadDocuments: exitAccess.canDownloadDocuments,
        canViewHelpdesk: exitAccess.canViewHelpdesk,
        canCreateTicket: exitAccess.canCreateTicket,
        canViewAnnouncements: exitAccess.canViewAnnouncements,
        canViewProfile: exitAccess.canViewProfile,
        accessExpiresAt: exitAccess.accessExpiresAt?.toISOString(),
      } : null,
    };
  }

  private calculateProfileCompletion(employee: any): number {
    if (!employee) return 0;
    const fields = [
      employee.firstName && employee.lastName,
      employee.phone,
      employee.dateOfBirth,
      employee.gender && employee.gender !== 'PREFER_NOT_TO_SAY',
      employee.emergencyContact,
      employee.department,
      employee.designation,
      employee.bankAccountNumber || employee.bankAccount,
      (employee.documents?.length || 0) >= 1,
      employee.avatar,
    ];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }

  /** True when all required profile fields are filled (used as gate before dashboard access) */
  public calculateProfileComplete(employee: any, _mfaEnabled: boolean): boolean {
    if (!employee) return false;
    const addr = employee.address as any;
    const ec = employee.emergencyContact as any;
    const personalOk = !!(
      employee.firstName && employee.lastName &&
      employee.dateOfBirth && employee.gender &&
      employee.phone && employee.phone !== '0000000000'
    );
    const addressOk = !!(addr?.line1 && addr?.city && addr?.state && addr?.pincode);
    const emergencyOk = !!(ec?.name && ec?.relationship && ec?.phone);
    const bankOk = !!(employee.bankAccountNumber && employee.bankName && employee.ifscCode && employee.accountHolderName);
    // MFA is optional — never gates profile completion regardless of work mode
    return personalOk && addressOk && emergencyOk && bankOk;
  }

  /** Generate tokens for a user (used by login + invitation accept) */
  public generateAccessToken(user: any, deviceId?: string): string {
    const isAdminRole = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(user.role);
    const kycCompleted = isAdminRole ? true : (user.employee?.documentGate?.kycStatus === 'VERIFIED');

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as any,
      organizationId: user.organizationId,
      employeeId: user.employee?.id,
      kycCompleted,
      ...(deviceId ? { deviceId } : {}),
    };

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRY as any,
    });
  }

  /** Revoke all refresh tokens for a user via a user-scoped Redis set — O(tokens per user), not O(all tokens) */
  private async revokeAllUserTokens(userId: string): Promise<void> {
    const setKey = `refresh_token_set:${userId}`;
    const tokenKeys = await redis.smembers(setKey);
    if (tokenKeys.length > 0) {
      // Gap 4: Only del keys that still exist to avoid no-op pipeline commands for
      // expired tokens that were never removed from the tracking set
      const pipeline = redis.pipeline();
      for (const key of tokenKeys) {
        // redis.del is idempotent for non-existent keys (returns 0), so this is safe;
        // but we include all keys so the set is always fully cleaned up
        pipeline.del(key);
      }
      pipeline.del(setKey);
      await pipeline.exec();
    }
  }

  public async generateRefreshToken(userId: string, deviceId?: string): Promise<string> {
    const token = randomBytes(40).toString('hex');
    const key = `${REFRESH_TOKEN_PREFIX}${token}`;
    const expiry = 7 * 24 * 60 * 60; // 7 days in seconds
    const setKey = `refresh_token_set:${userId}`;
    // Gap 1: Store { userId, deviceId } JSON so refreshAccessToken can re-embed exact deviceId
    const storedValue = JSON.stringify({ userId, ...(deviceId ? { deviceId } : {}) });
    // Store token + register in user-scoped set atomically
    const pipeline = redis.pipeline();
    pipeline.setex(key, expiry, storedValue);
    pipeline.sadd(setKey, key);
    // Set the tracking set TTL to match the longest-lived token (7 days + 1h buffer)
    pipeline.expire(setKey, expiry + 3600);
    await pipeline.exec();
    return token;
  }
}

export const authService = new AuthService();
