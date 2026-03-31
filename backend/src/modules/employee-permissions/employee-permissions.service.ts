import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import type { UpsertPresetInput, UpsertOverrideInput } from './employee-permissions.validation.js';

const PRESET_CACHE_PREFIX = 'perm_preset:';
const OVERRIDE_CACHE_PREFIX = 'perm_override:';
const CACHE_TTL = 300; // 5 minutes

export class EmployeePermissionService {
  static readonly PERMISSION_KEYS = [
    'canMarkAttendance',
    'canViewAttendanceHistory',
    'canApplyLeaves',
    'canViewLeaveBalance',
    'canViewPayslips',
    'canDownloadPayslips',
    'canViewDocuments',
    'canDownloadDocuments',
    'canViewDashboardStats',
    'canViewAnnouncements',
    'canViewPolicies',
    'canRaiseHelpdeskTickets',
    'canViewOrgChart',
    'canViewPerformance',
    'canViewEditProfile',
  ] as const;

  // ───────────────────────── Presets ─────────────────────────

  async getPresets(organizationId: string) {
    const presets = await prisma.permissionPreset.findMany({
      where: { organizationId },
    });
    return presets;
  }

  async upsertPreset(organizationId: string, data: UpsertPresetInput, createdBy: string) {
    const { role, ...permissions } = data;

    const preset = await prisma.permissionPreset.upsert({
      where: {
        organizationId_role: { organizationId, role: role as any },
      },
      create: {
        organizationId,
        role: role as any,
        createdBy,
        ...permissions,
      },
      update: {
        ...permissions,
      },
    });

    // Invalidate Redis cache
    try {
      await redis.del(`${PRESET_CACHE_PREFIX}${organizationId}:${role}`);
    } catch {
      // Redis unavailable — cache will expire naturally
    }

    await createAuditLog({
      userId: createdBy,
      organizationId,
      entity: 'PermissionPreset',
      entityId: preset.id,
      action: 'UPSERT',
      newValue: data,
    });

    return preset;
  }

  // ───────────────────────── Overrides ─────────────────────────

  async getOverride(employeeId: string) {
    const override = await prisma.permissionOverride.findUnique({
      where: { employeeId },
    });
    return override;
  }

  async upsertOverride(
    employeeId: string,
    organizationId: string,
    data: UpsertOverrideInput,
    createdBy: string,
  ) {
    const override = await prisma.permissionOverride.upsert({
      where: { employeeId },
      create: {
        employeeId,
        organizationId,
        createdBy,
        ...data,
      },
      update: {
        ...data,
      },
    });

    // Invalidate Redis cache
    try {
      await redis.del(`${OVERRIDE_CACHE_PREFIX}${employeeId}`);
    } catch {
      // Redis unavailable — cache will expire naturally
    }

    await createAuditLog({
      userId: createdBy,
      organizationId,
      entity: 'PermissionOverride',
      entityId: override.id,
      action: 'UPSERT',
      newValue: data,
    });

    return override;
  }

  async deleteOverride(employeeId: string, userId: string, organizationId: string) {
    const existing = await prisma.permissionOverride.findUnique({
      where: { employeeId },
    });

    if (!existing) {
      throw new NotFoundError('Permission override');
    }

    await prisma.permissionOverride.delete({
      where: { employeeId },
    });

    // Invalidate Redis cache
    try {
      await redis.del(`${OVERRIDE_CACHE_PREFIX}${employeeId}`);
    } catch {
      // Redis unavailable — cache will expire naturally
    }

    await createAuditLog({
      userId,
      organizationId,
      entity: 'PermissionOverride',
      entityId: existing.id,
      action: 'DELETE',
      oldValue: existing,
    });
  }

  // ───────────────────── Effective Permissions ─────────────────────

  /**
   * Compute effective permissions for an employee by merging:
   *   1. Role-based preset (org-level defaults)
   *   2. Per-employee override (null fields inherit from preset)
   *   3. Fallback to `true` if neither preset nor override defines a field
   */
  async getEffectivePermissions(employeeId: string, role: string, organizationId: string) {
    // 1. Load preset (cache → DB)
    let preset: Record<string, any> | null = null;
    const presetCacheKey = `${PRESET_CACHE_PREFIX}${organizationId}:${role}`;

    try {
      const cached = await redis.get(presetCacheKey);
      if (cached) {
        preset = JSON.parse(cached);
      }
    } catch {
      // Redis unavailable — fall through to DB
    }

    if (!preset) {
      const dbPreset = await prisma.permissionPreset.findUnique({
        where: { organizationId_role: { organizationId, role: role as any } },
      });
      if (dbPreset) {
        preset = dbPreset;
        try {
          await redis.setex(presetCacheKey, CACHE_TTL, JSON.stringify(dbPreset));
        } catch {
          // Redis unavailable
        }
      }
    }

    // 2. Load override (cache → DB)
    let override: Record<string, any> | null = null;
    const overrideCacheKey = `${OVERRIDE_CACHE_PREFIX}${employeeId}`;

    try {
      const cached = await redis.get(overrideCacheKey);
      if (cached) {
        override = JSON.parse(cached);
      }
    } catch {
      // Redis unavailable — fall through to DB
    }

    if (!override) {
      const dbOverride = await prisma.permissionOverride.findUnique({
        where: { employeeId },
      });
      if (dbOverride) {
        override = dbOverride;
        try {
          await redis.setex(overrideCacheKey, CACHE_TTL, JSON.stringify(dbOverride));
        } catch {
          // Redis unavailable
        }
      }
    }

    // 3. Merge: override[field] ?? preset[field] ?? true
    const effective: Record<string, boolean> = {};
    for (const key of EmployeePermissionService.PERMISSION_KEYS) {
      const overrideVal = override ? override[key] : undefined;
      const presetVal = preset ? preset[key] : undefined;
      effective[key] = overrideVal ?? presetVal ?? true;
    }

    return effective;
  }
}

export const employeePermissionService = new EmployeePermissionService();
