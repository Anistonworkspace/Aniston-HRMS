import { memo } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface DashboardSectionProps {
  title: string;
  icon?: LucideIcon;
  iconColor?: string;
  badge?: string | number;
  badgeVariant?: 'warning' | 'info' | 'success' | 'danger';
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const badgeClasses = {
  warning: 'badge-warning',
  info: 'badge-info',
  success: 'badge-success',
  danger: 'badge-danger',
};

function DashboardSectionInner({
  title,
  icon: Icon,
  iconColor = 'text-brand-500',
  badge,
  badgeVariant = 'info',
  headerAction,
  children,
  className = '',
}: DashboardSectionProps) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
      className={`layer-card p-5 ${className}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          {Icon && <Icon size={15} className={iconColor} />}
          {title}
          {badge != null && (
            <span className={`badge ${badgeClasses[badgeVariant]} font-mono text-[10px]`} data-mono>
              {badge}
            </span>
          )}
        </h3>
        {headerAction}
      </div>
      {children}
    </motion.div>
  );
}

export const DashboardSection = memo(DashboardSectionInner);
