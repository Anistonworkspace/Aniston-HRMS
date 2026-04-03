import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

interface QuickAction {
  label: string;
  path: string;
  icon: string;
}

interface QuickActionGridProps {
  actions: QuickAction[];
  columns?: string; // Tailwind grid class
}

function QuickActionGridInner({ actions, columns = 'grid-cols-2 md:grid-cols-4' }: QuickActionGridProps) {
  const navigate = useNavigate();

  return (
    <div className={`grid ${columns} gap-2`}>
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => navigate(action.path)}
          className="flex items-center gap-2.5 p-3 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors text-left active:scale-[0.98]"
        >
          <span className="text-lg">{action.icon}</span>
          <span className="text-xs font-medium text-gray-700">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

export const QuickActionGrid = memo(QuickActionGridInner);
