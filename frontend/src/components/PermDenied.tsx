import { Lock } from 'lucide-react';

interface PermDeniedProps {
  action?: string;
  inline?: boolean; // compact inline variant for hiding single buttons
}

/**
 * Shown when an employee's permission is denied.
 * Full-page variant (default): replaces the entire page/section.
 * Inline variant: replaces a single button/element.
 */
export default function PermDenied({ action = 'access this feature', inline }: PermDeniedProps) {
  if (inline) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 text-gray-400 text-xs font-medium cursor-not-allowed border border-gray-100"
        title={`You don't have permission to ${action}. Please contact HR.`}
      >
        <Lock size={12} />
        Restricted
      </span>
    );
  }

  return (
    <div className="page-container flex items-center justify-center min-h-[40vh]">
      <div className="layer-card p-10 flex flex-col items-center text-center gap-4 max-w-sm w-full">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
          <Lock size={24} className="text-red-400" />
        </div>
        <div>
          <p className="text-base font-semibold text-gray-800">Access Restricted</p>
          <p className="text-sm text-gray-400 mt-1.5">
            You don't have permission to {action}.<br />Please contact HR.
          </p>
        </div>
      </div>
    </div>
  );
}
