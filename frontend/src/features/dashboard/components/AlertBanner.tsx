import { memo } from 'react';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { DashboardAlert } from '@aniston/shared';

interface AlertBannerProps {
  alerts: DashboardAlert[];
}

const colorMap = {
  danger: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

function AlertBannerInner({ alerts }: AlertBannerProps) {
  const navigate = useNavigate();

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      {alerts.map((alert, i) => (
        <div
          key={i}
          onClick={() => alert.action && navigate(alert.action)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all hover:shadow-sm ${colorMap[alert.type]}`}
        >
          <AlertTriangle size={16} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{alert.title}</p>
            <p className="text-xs opacity-80">{alert.message}</p>
          </div>
          {alert.action && <ArrowUpRight size={14} className="shrink-0 opacity-60" />}
        </div>
      ))}
    </div>
  );
}

export const AlertBanner = memo(AlertBannerInner);
