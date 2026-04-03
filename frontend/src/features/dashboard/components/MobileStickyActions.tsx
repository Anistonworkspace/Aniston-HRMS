import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

interface StickyAction {
  label: string;
  path: string;
  icon: LucideIcon;
  color: string;
}

interface MobileStickyActionsProps {
  actions: StickyAction[];
}

function MobileStickyActionsInner({ actions }: MobileStickyActionsProps) {
  const navigate = useNavigate();

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 px-4 py-2 safe-area-pb z-40">
      <div className="flex items-center justify-around gap-1">
        {actions.slice(0, 4).map((action) => (
          <button
            key={action.label}
            onClick={() => navigate(action.path)}
            className="flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors flex-1 min-w-0"
          >
            <action.icon size={18} className={action.color} />
            <span className="text-[10px] font-medium text-gray-600 truncate">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const MobileStickyActions = memo(MobileStickyActionsInner);
