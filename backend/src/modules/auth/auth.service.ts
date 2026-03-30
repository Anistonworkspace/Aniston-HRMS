import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { UnauthorizedError, NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import type { JwtPayload } from '../../middleware/auth.middleware.js';

const REFRESH_TOKEN_PREFIX = 'refresh_token:';
const RESET_TOKEN_PREFIX = 'reset_token:';

export class AuthService {
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            status: true,
            exitStatus: true,
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

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const kycCompleted = user.employee?.documentGate?.kycStatus === 'VERIFIED';
    const exitAccess = user.employee?.exitAccessConfig;

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
        kycCompleted,
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
    const userId = await redis.get(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
    if (!userId) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      await redis.del(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
      throw new UnauthorizedError('User not found or inactive');
    }

    // Rotate refresh token
    await redis.del(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
    const newRefreshToken = await this.generateRefreshToken(user.id);
    const accessToken = this.generateAccessToken(user);

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    if (refreshToken) {
      await redis.del(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
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

    // TODO: Send email with reset link
    // For dev: log the token
    console.log(`[DEV] Password reset token for ${email}: ${resetToken}`);

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

    // Invalidate all refresh tokens for this user
    const keys = await redis.keys(`${REFRESH_TOKEN_PREFIX}*`);
    for (const key of keys) {
      const storedUserId = await redis.get(key);
      if (storedUserId === userId) {
        await redis.del(key);
      }
    }

    return { message: 'Password reset successfully' };
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
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { message: 'Password changed successfully' };
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
            documentGate: { select: { kycStatus: true } },
            exitAccessConfig: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    const kycCompleted = user.employee?.documentGate?.kycStatus === 'VERIFIED';
    const exitAccess = user.employee?.exitAccessConfig;

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
      kycCompleted,
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

  private generateAccessToken(user: any): string {
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as any,
      organizationId: user.organizationId,
      employeeId: user.employee?.id,
    };

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRY,
    });
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(40).toString('hex');
    const expiry = 7 * 24 * 60 * 60; // 7 days in seconds
    await redis.setex(`${REFRESH_TOKEN_PREFIX}${token}`, expiry, userId);
    return token;
  }
}

export const authService = new AuthService();
