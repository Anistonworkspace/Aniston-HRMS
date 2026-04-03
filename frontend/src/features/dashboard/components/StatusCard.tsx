import { memo } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface StatusCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string; // e.g. 'text-emerald-600'
  bg: string;    // e.g. 'bg-emerald-50'
  onClick?: () => void;
}

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function StatusCardInner({ label, value, icon: Icon, color, bg, onClick }: StatusCardProps) {
  return (
    <motion.div
      variants={item}
      onClick={onClick}
      className={`${bg} rounded-xl p-3 cursor-pointer hover:shadow-sm transition-all border border-transparent hover:border-gray-200`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={color} />
      </div>
      <p className="text-xl font-bold font-mono text-gray-900" data-mono>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
    </motion.div>
  );
}

export const StatusCard = memo(StatusCardInner);
