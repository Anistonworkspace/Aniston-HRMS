import { memo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

interface ActionCardProps {
  label: string;
  count: number;
  icon: LucideIcon;
  color: string;
  bg: string;
  border: string;
  path: string;
}

function ActionCardInner({ label, count, icon: Icon, color, bg, border, path }: ActionCardProps) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(path)}
      className={`flex items-center justify-between py-2.5 px-3 ${bg} rounded-lg border ${border} cursor-pointer hover:shadow-sm transition-all`}
    >
      <div className="flex items-center gap-2">
        <Icon size={15} className={color} />
        <span className="text-sm text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-bold text-gray-800" data-mono>{count}</span>
        <ArrowUpRight size={12} className="text-gray-400" />
      </div>
    </div>
  );
}

export const ActionCard = memo(ActionCardInner);
