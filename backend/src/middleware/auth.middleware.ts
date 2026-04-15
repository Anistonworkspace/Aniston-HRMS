import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError } from './errorHandler.js';
import { Role, hasPermission, type Resource, type Action } from '@aniston/shared';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  organizationId: string;
  employeeId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Verify JWT access token
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      next(err);
      return;
    }
    if (err instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
      return;
    }
    next(err);
  }
}

/**
 * Check if user has one of the allowed roles
 */
export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Not authenticated'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient role permissions'));
    }
    next();
  };
}

/**
 * Check if user has specific permission on a resource
 */
export function requirePermission(resource: Resource, action: Action) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Not authenticated'));
    }
    if (!hasPermission(req.user.role, resource, action)) {
      return next(new ForbiddenError(`No permission to ${action} on ${resource}`));
    }
    next();
  };
}

/**
 * Allow access if user has full permission OR has :own permission AND is acting on their own record.
 * Used for routes like PATCH /employees/:id where employees can update their own profile.
 * The :id param must be the employee's ID (compared against req.user.employeeId).
 */
export function requirePermissionOrOwn(resource: Resource, action: Action) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Not authenticated'));
    }
    // Full permission — allow
    if (hasPermission(req.user.role, resource, action)) {
      return next();
    }
    // Own-record permission — allow only if acting on their own employee record
    const ownAction = `${action}:own` as Action;
    const isSelf = req.user.employeeId && req.user.employeeId === req.params.id;
    if (isSelf && hasPermission(req.user.role, resource, ownAction)) {
      return next();
    }
    return next(new ForbiddenError(`No permission to ${action} on ${resource}`));
  };
}

/**
 * Route-to-feature mapping for exit access control
 */
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
 * Middleware to check exit access for exiting/terminated employees.
 * Applied globally after authenticate — only activates for employees with exit access config.
 */
export function checkExitAccess(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.employeeId) return next();

  // Skip for admin roles — they don't have exit restrictions
  const adminRoles: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR];
  if (adminRoles.includes(req.user.role)) return next();

  // Check cache first, then DB
  const cacheKey = `exit_access:${req.user.employeeId}`;

  redis.get(cacheKey).then(async (cached) => {
    let config: any = null;

    if (cached) {
      config = JSON.parse(cached);
    } else {
      config = await prisma.exitAccessConfig.findUnique({
        where: { employeeId: req.user!.employeeId! },
      });

      if (config) {
        // Cache for 5 minutes
        await redis.setex(cacheKey, 300, JSON.stringify(config));
      }
    }

    // If no exit access config, proceed normally (employee is not in exit mode)
    if (!config || !config.isActive) return next();

    // Check expiry
    if (config.accessExpiresAt && new Date(config.accessExpiresAt) < new Date()) {
      return next(new ForbiddenError('Your limited access has expired. Contact HR.'));
    }

    // Find which feature the current route maps to
    const path = req.originalUrl.split('?')[0]; // Remove query params
    let featureKey: string | undefined;

    for (const [routePrefix, key] of Object.entries(EXIT_ACCESS_ROUTE_MAP)) {
      if (path.startsWith(routePrefix)) {
        featureKey = key;
        break;
      }
    }

    // If no mapping found, allow (routes like /api/auth are always accessible)
    if (!featureKey) return next();

    // Special check: attendance POST (clock in/out) requires canMarkAttendance
    if (path.startsWith('/api/attendance') && ['POST', 'PATCH'].includes(req.method)) {
      if (!config.canMarkAttendance) {
        return next(new ForbiddenError('Attendance marking is not available in limited access mode'));
      }
      return next();
    }

    // Special check: leave POST requires canApplyLeave
    if (path.startsWith('/api/leaves') && req.method === 'POST') {
      if (!config.canApplyLeave) {
        return next(new ForbiddenError('Leave application is not available in limited access mode'));
      }
      return next();
    }

    // Special check: helpdesk POST requires canCreateTicket
    if (path.startsWith('/api/helpdesk') && req.method === 'POST') {
      if (!config.canCreateTicket) {
        return next(new ForbiddenError('Ticket creation is not available in limited access mode'));
      }
      return next();
    }

    // Check the mapped feature
    if (!(config as any)[featureKey]) {
      return next(new ForbiddenError('This feature is not available in limited access mode'));
    }

    next();
  }).catch(() => {
    // On Redis/DB error, allow through for admin roles (they need access to fix issues)
    // but deny for non-admin roles as a safety measure
    const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    if (req.user && adminRoles.includes(req.user.role)) {
      return next();
    }
    next(new UnauthorizedError('Session verification failed. Please try again.'));
  });
}

/**
 * Middleware to check employee-level permission control.
 * Applied globally after authenticate — restricts feature access based on
 * role presets and per-employee overrides set by HR.
 * Admin roles (SUPER_ADMIN, ADMIN, HR) are always allowed through.
 */
export function checkEmployeePermissions(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.employeeId) return next();

  const adminRoles: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR];
  if (adminRoles.includes(req.user.role)) return next();

  import('../modules/employee-permissions/employee-permissions.service.js').then(async ({ employeePermissionService }) => {
    try {
      const perms = await employeePermissionService.getEffectivePermissions(
        req.user!.employeeId!, req.user!.role as any, req.user!.organizationId
      );

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

      // Special POST checks for mutation actions
      if (path.startsWith('/api/attendance') && ['POST', 'PATCH'].includes(req.method)) {
        if (!(perms as any).canMarkAttendance) {
          return next(new ForbiddenError('Attendance marking has been restricted by your administrator'));
        }
        return next();
      }
      if (path.startsWith('/api/leaves') && req.method === 'POST') {
        if (!(perms as any).canApplyLeaves) {
          return next(new ForbiddenError('Leave application has been restricted by your administrator'));
        }
        return next();
      }
      if (path.startsWith('/api/helpdesk') && req.method === 'POST') {
        if (!(perms as any).canRaiseHelpdeskTickets) {
          return next(new ForbiddenError('Helpdesk access has been restricted by your administrator'));
        }
        return next();
      }

      if (!(perms as any)[permKey]) {
        return next(new ForbiddenError('This feature has been restricted by your administrator'));
      }

      next();
    } catch {
      // Permission check failed — allow through (deny-by-default is at route level)
      next();
    }
  }).catch(() => {
    // Module import or Redis error — allow through gracefully
    next();
  });
}
