import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError, AppError } from './errorHandler.js';
import { Role, hasPermission, type Resource, type Action } from '@aniston/shared';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  organizationId: string;
  employeeId?: string;
  mfaPending?: boolean;
  kycCompleted?: boolean;
  deviceId?: string;
  isAgent?: boolean; // FIX 8: flag set in agent JWTs to enable revocation check
}

/** Shape of an ExitAccessConfig row (subset used by the middleware). */
interface ExitAccessConfigFields {
  isActive: boolean;
  accessExpiresAt?: Date | string | null;
  canViewDashboard: boolean;
  canViewPayslips: boolean;
  canViewAttendance: boolean;
  canMarkAttendance: boolean;
  canApplyLeave: boolean;
  canViewLeaveBalance: boolean;
  canViewDocuments: boolean;
  canViewHelpdesk: boolean;
  canCreateTicket: boolean;
  canViewAnnouncements: boolean;
  canViewProfile: boolean;
  [key: string]: unknown;
}

/** Shape returned by employeePermissionService.getEffectivePermissions(). */
interface EffectivePermissions {
  canMarkAttendance: boolean;
  canViewAttendanceHistory: boolean;
  canApplyLeaves: boolean;
  canViewLeaveBalance: boolean;
  canViewPayslips: boolean;
  canDownloadPayslips: boolean;
  canViewDocuments: boolean;
  canDownloadDocuments: boolean;
  canViewDashboardStats: boolean;
  canViewAnnouncements: boolean;
  canViewPolicies: boolean;
  canRaiseHelpdeskTickets: boolean;
  canViewOrgChart: boolean;
  canViewPerformance: boolean;
  canViewEditProfile: boolean;
  [key: string]: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (decoded.mfaPending) {
      throw new UnauthorizedError('MFA verification required. Complete two-factor authentication first.');
    }
    // Single-session enforcement: check if this device's session was revoked by a force-login
    if (decoded.deviceId) {
      const revoked = await redis.get(`revoked:session:${decoded.userId}:${decoded.deviceId}`);
      if (revoked) {
        return next(new AppError('Your session was ended because you signed in from another device.', 401, 'SESSION_REVOKED'));
      }
      // Update lastActiveAt at most once per 5 minutes per device (rate-limited via Redis)
      // Avoids a DB write on every API call while keeping the field reasonably fresh
      const touchKey = `session_touch:${decoded.userId}:${decoded.deviceId}`;
      const alreadyTouched = await redis.get(touchKey);
      if (!alreadyTouched) {
        await redis.setex(touchKey, 300, '1');
        prisma.deviceSession.updateMany({
          where: { userId: decoded.userId, deviceId: decoded.deviceId, isActive: true },
          data: { lastActiveAt: new Date() },
        }).catch(() => { /* non-blocking */ });
      }
    }
    // FIX 8: Check agent JWT revocation flag in Redis.
    // Only applies to agent tokens (isAgent flag in payload) OR requests to agent data endpoints.
    // Admin routes (setup, config, report) are excluded — they use regular user tokens.
    const isAgentDataPath = /^\/api\/agent\/(heartbeat|ping|screenshot|config)/.test(req.path);
    if ((decoded.isAgent === true || isAgentDataPath) && decoded.employeeId) {
      const revoked = await redis.get(`revoked:agent:${decoded.employeeId}`);
      if (revoked) {
        return next(new UnauthorizedError('Agent token has been revoked — please re-pair'));
      }
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err instanceof jwt.TokenExpiredError) return next(new UnauthorizedError('Token expired'));
    if (err instanceof jwt.JsonWebTokenError) return next(new UnauthorizedError('Invalid token'));
    next(err);
  }
}

export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError('Not authenticated'));
    if (!allowedRoles.includes(req.user.role)) return next(new ForbiddenError('Insufficient role permissions'));
    next();
  };
}

export function requirePermission(resource: Resource, action: Action) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError('Not authenticated'));
    if (!hasPermission(req.user.role, resource, action)) {
      return next(new ForbiddenError(`No permission to ${action} on ${resource}`));
    }
    next();
  };
}

export function requirePermissionOrOwn(resource: Resource, action: Action) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError('Not authenticated'));
    if (hasPermission(req.user.role, resource, action)) return next();
    const ownAction = `${action}:own` as Action;
    const isSelf = req.user.employeeId && req.user.employeeId === req.params.id;
    if (isSelf && hasPermission(req.user.role, resource, ownAction)) return next();
    return next(new ForbiddenError(`No permission to ${action} on ${resource}`));
  };
}

const EXIT_ACCESS_ROUTE_MAP: Record<string, string> = {
  '/api/dashboard': 'canViewDashboard',
  '/api/payroll': 'canViewPayslips',
  '/api/attendance': 'canViewAttendance',
  '/api/leaves': 'canViewLeaveBalance',
  '/api/documents': 'canViewDocuments',
  '/api/helpdesk': 'canViewHelpdesk',
  '/api/announcements': 'canViewAnnouncements',
  '/api/employees/me': 'canViewProfile',
};

/**
 * BUG-003 FIX: Converted from .then()/.catch() to async/await so Express
 * cannot advance to the route handler before this check completes.
 * Fails CLOSED (403) on Redis/DB error for non-admin roles.
 */
export async function checkExitAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user?.employeeId) return next();

    const adminRoles: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR];
    if (adminRoles.includes(req.user.role)) return next();

    const cacheKey = `exit_access:${req.user.employeeId}`;
    let config: ExitAccessConfigFields | null = null;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        config = JSON.parse(cached) as ExitAccessConfigFields;
      } else {
        config = await prisma.exitAccessConfig.findUnique({
          where: { employeeId: req.user.employeeId },
        }) as ExitAccessConfigFields | null;
        if (config) {
          await redis.setex(cacheKey, 300, JSON.stringify(config));
        }
      }
    } catch {
      // Fail closed — cannot verify exit access, deny non-admins
      return next(new UnauthorizedError('Session verification failed. Please try again.'));
    }

    if (!config || !config.isActive) return next();

    if (config.accessExpiresAt && new Date(config.accessExpiresAt) < new Date()) {
      return next(new ForbiddenError('Your limited access has expired. Contact HR.'));
    }

    const path = req.originalUrl.split('?')[0];
    let featureKey: string | undefined;

    for (const [routePrefix, key] of Object.entries(EXIT_ACCESS_ROUTE_MAP)) {
      if (path.startsWith(routePrefix)) { featureKey = key; break; }
    }

    if (!featureKey) return next();

    if (path.startsWith('/api/attendance') && ['POST', 'PATCH'].includes(req.method)) {
      return config.canMarkAttendance
        ? next()
        : next(new ForbiddenError('Attendance marking is not available in limited access mode'));
    }

    if (path.startsWith('/api/leaves') && req.method === 'POST') {
      return config.canApplyLeave
        ? next()
        : next(new ForbiddenError('Leave application is not available in limited access mode'));
    }

    if (path.startsWith('/api/helpdesk') && req.method === 'POST') {
      return config.canCreateTicket
        ? next()
        : next(new ForbiddenError('Ticket creation is not available in limited access mode'));
    }

    if (!config[featureKey]) {
      return next(new ForbiddenError('This feature is not available in limited access mode'));
    }

    next();
  } catch (err) {
    next(err);
  }
}

const PERM_ACTION_LABELS: Record<string, string> = {
  canMarkAttendance: 'mark attendance',
  canViewAttendanceHistory: 'view attendance history',
  canApplyLeaves: 'apply for leave',
  canViewLeaveBalance: 'view leave balance',
  canViewPayslips: 'view payslips',
  canDownloadPayslips: 'download payslips',
  canViewDocuments: 'view documents',
  canDownloadDocuments: 'download documents',
  canViewDashboardStats: 'view dashboard',
  canViewAnnouncements: 'view announcements',
  canViewPolicies: 'view policies',
  canRaiseHelpdeskTickets: 'raise helpdesk tickets',
  canViewOrgChart: 'view org chart',
  canViewPerformance: 'view performance',
  canViewEditProfile: 'edit profile',
};

/**
 * Per-route employee permission guard factory.
 * Skips SUPER_ADMIN, ADMIN, HR, MANAGER — only enforces for EMPLOYEE and INTERN.
 * Fails CLOSED on cache/DB error. Layered on top of existing RBAC.
 */
export function requireEmpPerm(permKey: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user?.employeeId) return next();

      const skipRoles: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER];
      if (skipRoles.includes(req.user.role)) return next();

      let perms: EffectivePermissions;
      try {
        const { employeePermissionService } = await import('../modules/employee-permissions/employee-permissions.service.js');
        perms = await employeePermissionService.getEffectivePermissions(
          req.user.employeeId, req.user.role, req.user.organizationId
        ) as EffectivePermissions;
      } catch {
        return next(new ForbiddenError('Permission verification failed. Please contact HR.'));
      }

      if (!perms[permKey]) {
        const action = PERM_ACTION_LABELS[permKey] || permKey;
        return next(new ForbiddenError(`You don't have permission to ${action}. Please contact HR.`));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * BUG-004 FIX: Converted to async/await and now fails CLOSED (403) on any
 * error instead of failing open (allowing unrestricted access on outage).
 */
export async function checkEmployeePermissions(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user?.employeeId) return next();

    const adminRoles: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR];
    if (adminRoles.includes(req.user.role)) return next();

    let perms: EffectivePermissions;
    try {
      const { employeePermissionService } = await import('../modules/employee-permissions/employee-permissions.service.js');
      perms = await employeePermissionService.getEffectivePermissions(
        req.user.employeeId, req.user.role, req.user.organizationId
      ) as EffectivePermissions;
    } catch {
      // Fail closed — cannot verify permissions, deny access
      return next(new ForbiddenError('Permission verification failed. Please try again.'));
    }

    const PERM_ROUTE_MAP: Record<string, string> = {
      '/api/dashboard': 'canViewDashboardStats',
      '/api/payroll': 'canViewPayslips',
      '/api/attendance': 'canViewAttendanceHistory',
      '/api/leaves': 'canViewLeaveBalance',
      '/api/documents': 'canViewDocuments',
      '/api/helpdesk': 'canRaiseHelpdeskTickets',
      '/api/announcements': 'canViewAnnouncements',
      '/api/policies': 'canViewPolicies',
      '/api/performance': 'canViewPerformance',
      '/api/employees/me': 'canViewEditProfile',
    };

    const path = req.originalUrl.split('?')[0];
    let permKey: string | undefined;

    for (const [routePrefix, key] of Object.entries(PERM_ROUTE_MAP)) {
      if (path.startsWith(routePrefix)) { permKey = key; break; }
    }

    if (!permKey) return next();

    if (path.startsWith('/api/attendance') && ['POST', 'PATCH'].includes(req.method)) {
      return perms.canMarkAttendance
        ? next()
        : next(new ForbiddenError('Attendance marking has been restricted by your administrator'));
    }
    if (path.startsWith('/api/leaves') && req.method === 'POST') {
      return perms.canApplyLeaves
        ? next()
        : next(new ForbiddenError('Leave application has been restricted by your administrator'));
    }
    if (path.startsWith('/api/helpdesk') && req.method === 'POST') {
      return perms.canRaiseHelpdeskTickets
        ? next()
        : next(new ForbiddenError('Helpdesk access has been restricted by your administrator'));
    }

    if (!perms[permKey]) {
      return next(new ForbiddenError('This feature has been restricted by your administrator'));
    }

    next();
  } catch (err) {
    next(err);
  }
}
