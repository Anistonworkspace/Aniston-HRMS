import { memo } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: string; // e.g. 'bg-blue-500'
  sub?: string;
  onClick?: () => void;
}

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function KPICardInner({ label, value, icon: Icon, color, sub, onClick }: KPICardProps) {
  return (
    <motion.div
      variants={item}
      className={`stat-card ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`p-2 rounded-lg ${color}/10`}>
          <Icon size={16} className={color.replace('bg-', 'text-')} />
        </div>
      </div>
      <p className="text-xl md:text-2xl font-bold font-mono text-gray-900 truncate" data-mono>
        {value}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </motion.div>
  );
}

export const KPICard = memo(KPICardInner);
