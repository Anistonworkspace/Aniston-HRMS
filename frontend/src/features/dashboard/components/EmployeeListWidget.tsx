import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getInitials, formatDate } from '../../../lib/utils';

interface EmployeeItem {
  id: string;
  firstName: string;
  lastName: string;
  department?: string;
  joiningDate?: string;
  lastWorkingDate?: string;
  dateOfBirth?: string | null;
  avatar?: string | null;
}

interface EmployeeListWidgetProps {
  items: EmployeeItem[];
  type: 'hire' | 'exit' | 'birthday';
  emptyText?: string;
  clickable?: boolean;
}

const typeConfig = {
  hire: { bg: 'bg-emerald-100', text: 'text-emerald-700', badge: 'badge-success', badgeText: 'Joined' },
  exit: { bg: 'bg-red-100', text: 'text-red-700', badge: 'badge-danger', badgeText: 'Exited' },
  birthday: { bg: 'bg-pink-100', text: 'text-pink-700', badge: '', badgeText: '' },
};

function EmployeeListWidgetInner({ items, type, emptyText = 'No items', clickable = true }: EmployeeListWidgetProps) {
  const navigate = useNavigate();
  const cfg = typeConfig[type];

  if (items.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-6">{emptyText}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          onClick={clickable ? () => navigate(`/employees/${item.id}`) : undefined}
          className={`flex items-center gap-3 py-1.5 ${clickable ? 'cursor-pointer hover:bg-gray-50' : ''} rounded-lg px-1 transition-colors`}
        >
          <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center ${cfg.text} font-semibold text-[10px]`}>
            {getInitials(item.firstName, item.lastName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-700 truncate">{item.firstName} {item.lastName}</p>
            <p className="text-[10px] text-gray-400 font-mono" data-mono>
              {type === 'birthday' && item.dateOfBirth
                ? new Date(item.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                : type === 'exit' && item.lastWorkingDate
                ? `${item.department || 'No dept'}`
                : `${item.department || 'No dept'}${item.joiningDate ? ` · Joined ${formatDate(item.joiningDate)}` : ''}`}
            </p>
          </div>
          {cfg.badgeText && <span className={`badge ${cfg.badge} text-[10px]`}>{cfg.badgeText}</span>}
        </div>
      ))}
    </div>
  );
}

export const EmployeeListWidget = memo(EmployeeListWidgetInner);
