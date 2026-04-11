/**
 * dbInit — runs once on server startup.
 * Ensures default leave type policies are correct in the DB so the
 * Settings page reflects the right values and HR can manage from there.
 *
 * SL (Sick Leave) and EL (Emergency Leave) must always default to
 * allowSameDay=true and noticeDays=0 because they are unplanned by nature.
 */
import { prisma } from './prisma.js';
import { logger } from './logger.js';

export async function initDefaultLeaveSettings(): Promise<void> {
  try {
    const sameDayCodes = ['SL', 'EL'];

    // For every organization, ensure SL and EL are same-day with no notice
    const updated = await prisma.leaveType.updateMany({
      where: { code: { in: sameDayCodes }, allowSameDay: false },
      data: { allowSameDay: true, noticeDays: 0 },
    });

    if (updated.count > 0) {
      logger.info(`✅ dbInit: fixed allowSameDay=true for ${updated.count} SL/EL leave type(s)`);
    }
  } catch (err) {
    // Non-fatal — log and continue
    logger.warn('dbInit: could not fix leave type defaults', err);
  }
}
