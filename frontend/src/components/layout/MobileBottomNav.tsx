import { NavLink, useLocation } from 'react-router-dom';
import { Home, Users, Clock, CalendarDays, MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';

const mobileNavItems = [
  { name: 'Home', path: '/dashboard', icon: Home },
  { name: 'People', path: '/employees', icon: Users },
  { name: 'Attendance', path: '/attendance', icon: Clock },
  { name: 'Leave', path: '/leaves', icon: CalendarDays },
  { name: 'More', path: '/more', icon: MoreHorizontal },
];

export default function MobileBottomNav() {
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-50 safe-area-pb">
      <div className="flex items-center justify-around h-16">
        {mobileNavItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors',
                isActive ? 'text-brand-600' : 'text-gray-400'
              )}
            >
              <item.icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{item.name}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
