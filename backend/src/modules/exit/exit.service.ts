import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError, BadRequestError, ForbiddenError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { letterService } from '../letter/letter.service.js';
import { assertHRActionAllowed } from '../../utils/hrRestrictions.js';
import type { SetLastWorkingDayInput, AddHandoverTaskInput, UpdateHandoverTaskInput, ConfirmAssetReturnInput, UpdateITChecklistInput, SaveExitInterviewInput, SaveITNotesInput } from './exit.validation.js';

export class ExitService {
  // ========================
  // LAST WORKING DAY
  // ========================

  async setLastWorkingDay(employeeId: string, data: SetLastWorkingDayInput, userId: string, orgId: string, userRole?: string) {
    if (userRole === 'HR') {
      await assertHRActionAllowed('HR', employeeId, 'canHRManageExit');
    }

    const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundError('Employee');
    if (!['APPROVED', 'NO_DUES_PENDING'].includes(emp.exitStatus || ''))
      throw new ConflictError('Resignation must be approved before setting last working day');

    const lwdDate = new Date(data.lastWorkingDate);
    if (isNaN(lwdDate.getTime())) throw new BadRequestError('Invalid last working date');

    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: { lastWorkingDate: lwdDate },
    });

    await createAuditLog({
      userId,
      organizationId: orgId,
      entity: 'Employee',
      entityId: employeeId,
      action: 'LWD_UPDATED',
      newValue: { lastWorkingDate: updated.lastWorkingDate },
    });

    return updated;
  }

  // ========================
  // HANDOVER TASKS
  // ========================

  async getHandoverData(employeeId: string, orgId: string) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundError('Employee');

    const checklist = await prisma.exitChecklist.findUnique({
      where: { employeeId },
      include: {
        handoverTasks: {
          include: {
            assignedTo: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          },
          orderBy: [{ isCompleted: 'asc' }, { createdAt: 'asc' }],
        },
        items: {
          include: { asset: { select: { id: true, name: true, assetCode: true, category: true, condition: true } } },
          orderBy: [{ isReturned: 'asc' }, { itemName: 'asc' }],
        },
      },
    });

    return checklist;
  }

  async addHandoverTask(employeeId: string, data: AddHandoverTaskInput, userId: string, orgId: string) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundError('Employee');
    if (!['PENDING', 'APPROVED', 'NO_DUES_PENDING'].includes(emp.exitStatus || ''))
      throw new ConflictError('No active exit process for this employee');

    // SEC-002: ensure assignee belongs to same org
    if (data.assignedToId) {
      const assignee = await prisma.employee.findFirst({ where: { id: data.assignedToId, organizationId: orgId } });
      if (!assignee) throw new BadRequestError('Assigned employee not found in your organisation');
    }

    let checklist = await prisma.exitChecklist.findUnique({ where: { employeeId } });
    if (!checklist) {
      checklist = await prisma.exitChecklist.create({ data: { employeeId } });
    }

    const task = await prisma.handoverTask.create({
      data: {
        checklistId: checklist.id,
        title: data.title,
        description: data.description ?? null,
        category: data.category || 'TASK',
        assignedToId: data.assignedToId ?? null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });

    return task;
  }

  async updateHandoverTask(
    taskId: string,
    data: UpdateHandoverTaskInput,
    userId: string,
    orgId: string,
    requestorRole: string,
    requestorEmployeeId: string | null,
  ) {
    const task = await prisma.handoverTask.findFirst({
      where: { id: taskId, checklist: { employee: { organizationId: orgId } } },
      include: { checklist: { select: { id: true, employeeId: true } } },
    });
    if (!task) throw new NotFoundError('Handover task');

    // SEC-003: only HR/admin, the exiting employee, or the assignee may update
    const isHR = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(requestorRole);
    const isOwner = requestorEmployeeId === task.checklist.employeeId;
    const isAssignee = requestorEmployeeId === task.assignedToId;
    if (!isHR && !isOwner && !isAssignee) {
      throw new ForbiddenError('You do not have permission to update this task');
    }

    const becameCompleted = data.isCompleted === true && !task.isCompleted;
    const becameIncomplete = data.isCompleted === false && task.isCompleted;

    // SEC-002: validate new assignee org boundary
    if (data.assignedToId) {
      const assignee = await prisma.employee.findFirst({ where: { id: data.assignedToId, organizationId: orgId } });
      if (!assignee) throw new BadRequestError('Assigned employee not found in your organisation');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedTask = await tx.handoverTask.update({
        where: { id: taskId },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.category !== undefined && { category: data.category }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.assignedToId !== undefined && { assignedToId: data.assignedToId }),
          ...(data.dueDate !== undefined && { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
          ...(data.isCompleted !== undefined && { isCompleted: data.isCompleted }),
          ...(becameCompleted && { completedAt: new Date(), completedBy: userId }),
          ...(becameIncomplete && { completedAt: null, completedBy: null }),
        },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      });

      // GAP-002: auto-set knowledgeTransferDone when all tasks complete
      if (data.isCompleted !== undefined) {
        const allTasks = await tx.handoverTask.findMany({ where: { checklistId: task.checklistId } });
        const allDone = allTasks.every((t) => (t.id === taskId ? data.isCompleted : t.isCompleted));
        await tx.exitChecklist.update({
          where: { id: task.checklistId },
          data: { knowledgeTransferDone: allDone },
        });
      }

      return updatedTask;
    });

    return updated;
  }

  async deleteHandoverTask(taskId: string, orgId: string) {
    const task = await prisma.handoverTask.findFirst({
      where: { id: taskId, checklist: { employee: { organizationId: orgId } } },
    });
    if (!task) throw new NotFoundError('Handover task');
    await prisma.handoverTask.delete({ where: { id: taskId } });
  }

  // ========================
  // FULL & FINAL
  // ========================

  async getFnFDetails(employeeId: string, orgId: string) {
    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId: orgId },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    if (!emp) throw new NotFoundError('Employee');

    // Last 3 processed payroll records
    const payslips = await prisma.payrollRecord.findMany({
      where: {
        employeeId,
        payrollRun: { organizationId: orgId, status: { in: ['COMPLETED', 'LOCKED'] } },
      },
      orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }],
      take: 3,
      select: {
        id: true,
        grossSalary: true,
        netSalary: true,
        otherDeductions: true,
        epfEmployee: true,
        esiEmployee: true,
        presentDays: true,
        payrollRun: { select: { id: true, month: true, year: true, status: true } },
      },
    });

    // Most recent experience letter already generated
    const experienceLetterAssignment = await prisma.letterAssignment.findFirst({
      where: {
        employeeId,
        letter: { organizationId: orgId, deletedAt: null, type: 'EXPERIENCE_LETTER' },
      },
      include: {
        letter: { select: { id: true, title: true, filePath: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // FnF payroll adjustment
    const fnfAdjustment = await prisma.payrollAdjustment.findFirst({
      where: { employeeId, componentName: 'Full & Final Settlement' },
      orderBy: { createdAt: 'desc' },
    });

    return {
      employee: {
        id: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeCode,
        joiningDate: emp.joiningDate,
        lastWorkingDate: emp.lastWorkingDate,
        department: emp.department?.name,
        designation: emp.designation?.name,
        exitStatus: emp.exitStatus,
        exitType: emp.exitType,
      },
      payslips,
      experienceLetter: experienceLetterAssignment?.letter ?? null,
      fnfAdjustment,
    };
  }

  async generateExperienceLetter(employeeId: string, userId: string, orgId: string) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundError('Employee');
    if (!['APPROVED', 'NO_DUES_PENDING', 'COMPLETED'].includes(emp.exitStatus || ''))
      throw new ConflictError('Resignation must be approved before generating an experience letter');

    const letter = await letterService.create(
      {
        type: 'EXPERIENCE_LETTER',
        title: `Experience Letter — ${emp.firstName} ${emp.lastName}`,
        employeeId,
        downloadAllowed: true,
        templateSlug: 'modern-minimal',
      },
      userId,
      orgId,
    );

    return letter;
  }

  // ========================
  // EMPLOYEE SELF-SERVICE
  // ========================

  async getMyExitStatus(userId: string, orgId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employee: { select: { id: true } } },
    });
    const employeeId = user?.employee?.id;
    if (!employeeId) throw new NotFoundError('Employee profile');

    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId: orgId },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    if (!emp) throw new NotFoundError('Employee');
    if (!emp.exitStatus || emp.exitStatus === 'WITHDRAWN') {
      throw new ConflictError('No active exit process found');
    }

    const checklist = await prisma.exitChecklist.findUnique({
      where: { employeeId },
      include: {
        items: {
          include: { asset: { select: { id: true, name: true, assetCode: true, category: true, condition: true } } },
          orderBy: [{ isReturned: 'asc' }, { itemName: 'asc' }],
        },
        handoverTasks: {
          where: { assignedToId: employeeId },
          include: {
            assignedTo: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: [{ isCompleted: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    // F&F docs for employee view
    const experienceLetterAssignment = await prisma.letterAssignment.findFirst({
      where: {
        employeeId,
        letter: { organizationId: orgId, deletedAt: null, type: 'EXPERIENCE_LETTER' },
      },
      include: { letter: { select: { id: true, title: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const payslips = await prisma.payrollRecord.findMany({
      where: {
        employeeId,
        payrollRun: { organizationId: orgId, status: { in: ['COMPLETED', 'LOCKED'] } },
      },
      orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }],
      take: 3,
      select: {
        id: true,
        grossSalary: true,
        netSalary: true,
        payrollRun: { select: { month: true, year: true } },
      },
    });

    // M-2: also return IT checklist and exit interview for employee awareness
    const itChecklist = await prisma.iTOffboardingChecklist.findFirst({ where: { employeeId, organizationId: orgId, deletedAt: null } });
    const exitInterview = await prisma.exitInterview.findFirst({
      where: { employeeId, organizationId: orgId, deletedAt: null },
      select: { primaryReason: true, submittedAt: true, conductedBy: { select: { firstName: true, lastName: true } } },
    });

    return {
      employee: {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        employeeCode: emp.employeeCode,
        exitStatus: emp.exitStatus,
        exitType: emp.exitType,
        resignationDate: emp.resignationDate,
        lastWorkingDate: emp.lastWorkingDate,
        resignationReason: emp.resignationReason,
        department: emp.department?.name,
        designation: emp.designation?.name,
      },
      checklist,
      payslips,
      experienceLetter: experienceLetterAssignment?.letter ?? null,
      itChecklist,
      exitInterview,
    };
  }

  async confirmAssetReturn(
    checklistItemId: string,
    userId: string,
    orgId: string,
    data: ConfirmAssetReturnInput,
  ) {
    // Resolve employee from user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employee: { select: { id: true } } },
    });
    const employeeId = user?.employee?.id;
    if (!employeeId) throw new NotFoundError('Employee profile');

    // Verify item belongs to this employee's checklist
    const item = await prisma.exitChecklistItem.findFirst({
      where: {
        id: checklistItemId,
        checklist: { employeeId, employee: { organizationId: orgId } },
      },
    });
    if (!item) throw new NotFoundError('Checklist item');
    if (item.isReturned) throw new ConflictError('This asset has already been confirmed returned by HR');

    const updated = await prisma.exitChecklistItem.update({
      where: { id: checklistItemId },
      data: {
        employeeConfirmedReturn: true,
        employeeConfirmedAt: new Date(),
        employeeNotes: data.employeeNotes ?? null,
      },
      include: { asset: { select: { id: true, name: true, assetCode: true, category: true } } },
    });

    return updated;
  }

  async undoAssetReturnConfirmation(checklistItemId: string, userId: string, orgId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employee: { select: { id: true } } },
    });
    const employeeId = user?.employee?.id;
    if (!employeeId) throw new NotFoundError('Employee profile');

    const item = await prisma.exitChecklistItem.findFirst({
      where: {
        id: checklistItemId,
        checklist: { employeeId, employee: { organizationId: orgId } },
      },
    });
    if (!item) throw new NotFoundError('Checklist item');
    if (item.isReturned) throw new ConflictError('HR has already confirmed this return — contact HR to modify');

    return prisma.exitChecklistItem.update({
      where: { id: checklistItemId },
      data: { employeeConfirmedReturn: false, employeeConfirmedAt: null, employeeNotes: null },
      include: { asset: { select: { id: true, name: true, assetCode: true, category: true } } },
    });
  }

  // ========================
  // IT OFFBOARDING CHECKLIST
  // ========================

  async getITChecklist(employeeId: string, orgId: string) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundError('Employee');

    // C-3: only create checklist when exit is approved/active
    if (!['APPROVED', 'NO_DUES_PENDING', 'COMPLETED'].includes(emp.exitStatus || '')) {
      return prisma.iTOffboardingChecklist.findFirst({ where: { employeeId, organizationId: orgId, deletedAt: null } });
    }

    let checklist = await prisma.iTOffboardingChecklist.findFirst({ where: { employeeId, organizationId: orgId, deletedAt: null } });
    if (!checklist) {
      checklist = await prisma.iTOffboardingChecklist.create({
        data: { employeeId, organizationId: orgId },
      });
    }
    return checklist;
  }

  async updateITChecklist(employeeId: string, data: UpdateITChecklistInput, userId: string, orgId: string) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundError('Employee');

    // H-5: explicit org boundary check on checklist
    const existing = await prisma.iTOffboardingChecklist.findFirst({ where: { employeeId, organizationId: orgId, deletedAt: null } });
    if (!existing) throw new NotFoundError('IT Offboarding Checklist');

    // C-2: explicit field map — Prisma does not support dynamic computed keys
    const now = new Date();
    const fieldData: Record<string, object> = {
      emailDisabled:     { emailDisabled:     data.value, emailDisabledAt:     data.value ? now : null, emailDisabledBy:     data.value ? userId : null },
      ssoRevoked:        { ssoRevoked:        data.value, ssoRevokedAt:        data.value ? now : null, ssoRevokedBy:        data.value ? userId : null },
      vpnRevoked:        { vpnRevoked:        data.value, vpnRevokedAt:        data.value ? now : null, vpnRevokedBy:        data.value ? userId : null },
      githubRemoved:     { githubRemoved:     data.value, githubRemovedAt:     data.value ? now : null, githubRemovedBy:     data.value ? userId : null },
      jiraRemoved:       { jiraRemoved:       data.value, jiraRemovedAt:       data.value ? now : null, jiraRemovedBy:       data.value ? userId : null },
      slackRemoved:      { slackRemoved:      data.value, slackRemovedAt:      data.value ? now : null, slackRemovedBy:      data.value ? userId : null },
      licensesReclaimed: { licensesReclaimed: data.value, licensesReclaimedAt: data.value ? now : null, licensesReclaimedBy: data.value ? userId : null },
      deviceWiped:       { deviceWiped:       data.value, deviceWipedAt:       data.value ? now : null, deviceWipedBy:       data.value ? userId : null },
    };

    const fieldUpdate = fieldData[data.field];
    if (!fieldUpdate) throw new BadRequestError('Invalid IT checklist field');

    const updated = await prisma.iTOffboardingChecklist.update({
      where: { id: existing.id },
      data: {
        ...fieldUpdate,
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });

    // Auto-set completedAt when all 8 items ticked
    const allDone = [
      updated.emailDisabled, updated.ssoRevoked, updated.vpnRevoked,
      updated.githubRemoved, updated.jiraRemoved, updated.slackRemoved,
      updated.licensesReclaimed, updated.deviceWiped,
    ].every(Boolean);

    const final = await prisma.iTOffboardingChecklist.update({
      where: { id: existing.id },
      data: { completedAt: allDone ? (existing.completedAt ?? now) : null },
    });

    await createAuditLog({
      userId,
      organizationId: orgId,
      entity: 'ITOffboardingChecklist',
      entityId: existing.id,
      action: 'IT_ITEM_UPDATED',
      newValue: { field: data.field, value: data.value },
    });

    return final;
  }

  async saveITNotes(employeeId: string, data: SaveITNotesInput, orgId: string) {
    const existing = await prisma.iTOffboardingChecklist.findFirst({ where: { employeeId, organizationId: orgId, deletedAt: null } });
    if (!existing) throw new NotFoundError('IT Offboarding Checklist');
    return prisma.iTOffboardingChecklist.update({ where: { id: existing.id }, data: { notes: data.notes } });
  }

  // ========================
  // EXIT INTERVIEW
  // ========================

  async getExitInterview(employeeId: string, orgId: string) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundError('Employee');

    const interview = await prisma.exitInterview.findFirst({
      where: { employeeId, organizationId: orgId, deletedAt: null },
      include: { conductedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    return interview;
  }

  async saveExitInterview(employeeId: string, data: SaveExitInterviewInput, userId: string, orgId: string) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundError('Employee');

    const payload = {
      primaryReason: data.primaryReason,
      otherReasonDetail: data.otherReasonDetail ?? null,
      overallSatisfaction: data.overallSatisfaction ?? null,
      managementRating: data.managementRating ?? null,
      compensationRating: data.compensationRating ?? null,
      cultureRating: data.cultureRating ?? null,
      growthRating: data.growthRating ?? null,
      workLifeBalanceRating: data.workLifeBalanceRating ?? null,
      likedMost: data.likedMost ?? null,
      dislikedMost: data.dislikedMost ?? null,
      improvementSuggestions: data.improvementSuggestions ?? null,
      wouldRehire: data.wouldRehire ?? null,
      additionalComments: data.additionalComments ?? null,
      rehireEligible: data.rehireEligible ?? null,
      rehireNotes: data.rehireNotes ?? null,
      conductedById: userId,
      ...(data.submit && { submittedAt: new Date() }),
    };

    // Atomic check-then-write to prevent concurrent submission race condition
    const interview = await prisma.$transaction(async (tx) => {
      const current = await tx.exitInterview.findUnique({ where: { employeeId } });
      if (current?.submittedAt) throw new ConflictError('Exit interview has already been submitted');
      return current
        ? await tx.exitInterview.update({ where: { employeeId }, data: payload, include: { conductedBy: { select: { id: true, firstName: true, lastName: true } } } })
        : await tx.exitInterview.create({ data: { employeeId, organizationId: orgId, ...payload }, include: { conductedBy: { select: { id: true, firstName: true, lastName: true } } } });
    });

    await createAuditLog({
      userId,
      organizationId: orgId,
      entity: 'ExitInterview',
      entityId: interview.id,
      action: data.submit ? 'EXIT_INTERVIEW_SUBMITTED' : 'EXIT_INTERVIEW_SAVED',
      newValue: { primaryReason: data.primaryReason },
    });

    return interview;
  }
}

export const exitService = new ExitService();
