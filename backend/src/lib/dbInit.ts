/**
 * dbInit — runs once on server startup.
 *
 * BUG-005 FIX: The previous implementation ran an unscoped updateMany across ALL
 * organizations, resetting allowSameDay=true on every restart.  This silently
 * overrode any deliberate HR configuration of allowSameDay=false for SL/EL.
 * It was also a multi-tenancy violation (no organizationId filter).
 *
 * The function is kept as a no-op so the call site in server.ts continues to
 * compile without changes.  HR configures leave-type settings from the Settings UI.
 */
export async function initDefaultLeaveSettings(): Promise<void> {
  // Intentionally no-op — do not reset HR-configured leave type settings on startup.
}
