import { memo } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: string; // e.g. 'bg-blue-500' — used as fallback
  iconBg?: string; // explicit bg class e.g. 'bg-blue-100'
  iconText?: string; // explicit text class e.g. 'text-blue-600'
  sub?: string;
  onClick?: () => void;
}

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

// Static fallback map — avoids dynamic Tailwind class generation (purge-safe)
const COLOR_FALLBACK_MAP: Record<string, { bg: string; text: string }> = {
  'bg-blue-500': { bg: 'bg-blue-100', text: 'text-blue-600' },
  'bg-emerald-500': { bg: 'bg-emerald-100', text: 'text-emerald-600' },
  'bg-red-500': { bg: 'bg-red-100', text: 'text-red-600' },
  'bg-amber-500': { bg: 'bg-amber-100', text: 'text-amber-600' },
  'bg-purple-500': { bg: 'bg-purple-100', text: 'text-purple-600' },
  'bg-indigo-500': { bg: 'bg-indigo-100', text: 'text-indigo-600' },
  'bg-teal-500': { bg: 'bg-teal-100', text: 'text-teal-600' },
  'bg-pink-500': { bg: 'bg-pink-100', text: 'text-pink-600' },
  'bg-gray-500': { bg: 'bg-gray-100', text: 'text-gray-600' },
};

function deriveIconClasses(color: string): { bg: string; text: string } {
  return COLOR_FALLBACK_MAP[color] || { bg: 'bg-gray-100', text: 'text-gray-600' };
}

function KPICardInner({ label, value, icon: Icon, color, iconBg, iconText, sub, onClick }: KPICardProps) {
  const derived = deriveIconClasses(color);
  const resolvedBg = iconBg || derived.bg;
  const resolvedText = iconText || derived.text;

  return (
    <motion.div
      variants={item}
      className={`stat-card ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`p-2 rounded-lg ${resolvedBg}`}>
          <Icon size={16} className={resolvedText} />
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
