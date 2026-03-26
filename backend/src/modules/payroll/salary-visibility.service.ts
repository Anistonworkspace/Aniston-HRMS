import { prisma } from '../../lib/prisma.js';

export class SalaryVisibilityService {
  /**
   * Check if the requesting user can view a target employee's salary.
   * Rules:
   * - SUPER_ADMIN → always true
   * - Employee viewing own salary → always true
   * - HR → check rule.visibleToHR (default true if no rule)
   * - MANAGER → check rule.visibleToManager (default false if no rule)
   * - Others → false
   */
  async canViewSalary(requestingRole: string, requestingEmployeeId: string | undefined, targetEmployeeId: string): Promise<boolean> {
    if (requestingRole === 'SUPER_ADMIN') return true;
    if (requestingEmployeeId === targetEmployeeId) return true;

    const rule = await prisma.salaryVisibilityRule.findUnique({
      where: { employeeId: targetEmployeeId },
    });

    if (requestingRole === 'ADMIN') return true;

    if (requestingRole === 'HR') {
      return rule ? rule.visibleToHR : true; // default visible to HR
    }

    if (requestingRole === 'MANAGER') {
      return rule ? rule.visibleToManager : false; // default hidden from manager
    }

    return false;
  }

  async getVisibilityRules(organizationId: string) {
    const rules = await prisma.salaryVisibilityRule.findMany({
      where: { employee: { organizationId } },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Also get employees without rules (they use defaults)
    const employeesWithRules = new Set(rules.map(r => r.employeeId));
    const allEmployees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        department: { select: { name: true } },
      },
    });

    return allEmployees.map(emp => {
      const rule = rules.find(r => r.employeeId === emp.id);
      return {
        employee: emp,
        visibleToHR: rule?.visibleToHR ?? true,
        visibleToManager: rule?.visibleToManager ?? false,
        hiddenReason: rule?.hiddenReason || null,
        setBy: rule?.setBy || null,
        updatedAt: rule?.updatedAt || null,
        hasCustomRule: !!rule,
      };
    });
  }

  async setVisibilityRule(employeeId: string, data: {
    visibleToHR: boolean;
    visibleToManager: boolean;
    hiddenReason?: string;
  }, setBy: string) {
    return prisma.salaryVisibilityRule.upsert({
      where: { employeeId },
      update: {
        visibleToHR: data.visibleToHR,
        visibleToManager: data.visibleToManager,
        hiddenReason: data.hiddenReason || null,
        setBy,
      },
      create: {
        employeeId,
        visibleToHR: data.visibleToHR,
        visibleToManager: data.visibleToManager,
        hiddenReason: data.hiddenReason || null,
        setBy,
      },
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
      },
    });
  }

  /**
   * Mask salary value — returns '****' if not allowed to view.
   * Call this when building employee list/detail responses.
   */
  maskSalary(value: any, canView: boolean): any {
    return canView ? value : null;
  }
}

export const salaryVisibilityService = new SalaryVisibilityService();
