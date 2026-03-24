import { NavLink, useLocation } from 'react-router-dom';
import { Home, CalendarDays, MapPin, Bell, User, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useGetTodayStatusQuery, useClockInMutation, useClockOutMutation } from '../../features/attendance/attendanceApi';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

const navItems = [
  { name: 'Home', path: '/dashboard', icon: Home },
  { name: 'Leave', path: '/leaves', icon: CalendarDays },
  // Center button handled separately
  { name: 'Alerts', path: '/helpdesk', icon: Bell },
  { name: 'Profile', path: '/profile', icon: User },
];

export default function MobileBottomNav() {
  const location = useLocation();
  const user = useAppSelector((state) => state.auth.user);
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const { data: todayRes } = useGetTodayStatusQuery(undefined, { skip: isManagement });
  const todayStatus = todayRes?.data;
  const [clockIn, { isLoading: clockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: clockingOut }] = useClockOutMutation();

  const handleCheckInOut = async () => {
    try {
      let coords: { latitude?: number; longitude?: number } = {};
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch { /* proceed */ }
      }
      if (todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut) {
        await clockOut(coords).unwrap();
        toast.success('Checked out!');
      } else if (!todayStatus?.isCheckedOut) {
        await clockIn({ ...coords, source: 'MANUAL_APP' }).unwrap();
        toast.success('Checked in!');
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed');
    }
  };

  const isCheckedIn = todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut;
  const isCompleted = !!todayStatus?.isCheckedOut;
  const isLoading = clockingIn || clockingOut;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-50 safe-area-pb">
      <div className="flex items-center justify-around h-16 relative">
        {/* Left nav items */}
        {navItems.slice(0, 2).map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <NavLink key={item.path} to={item.path}
              className={cn('flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors', isActive ? 'text-brand-600' : 'text-gray-400')}>
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{item.name}</span>
            </NavLink>
          );
        })}

        {/* Center Check In/Out button */}
        <div className="flex flex-col items-center justify-center flex-1 -mt-5">
          <button
            onClick={handleCheckInOut}
            disabled={isLoading || isCompleted || isManagement}
            className={cn(
              'w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all',
              isCheckedIn
                ? 'bg-red-500 hover:bg-red-600'
                : isCompleted
                ? 'bg-gray-300'
                : 'bg-emerald-500 hover:bg-emerald-600',
              (isLoading || isCompleted || isManagement) && 'opacity-60'
            )}
          >
            {isLoading ? (
              <Loader2 size={22} className="text-white animate-spin" />
            ) : (
              <MapPin size={22} className="text-white" />
            )}
          </button>
          {isCheckedIn && <div className="w-2 h-2 bg-emerald-400 rounded-full mt-1 animate-pulse" />}
          <span className="text-[9px] text-gray-400 mt-0.5">
            {isManagement ? 'HR' : isCheckedIn ? 'Check Out' : isCompleted ? 'Done' : 'Check In'}
          </span>
        </div>

        {/* Right nav items */}
        {navItems.slice(2).map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <NavLink key={item.path} to={item.path}
              className={cn('flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors', isActive ? 'text-brand-600' : 'text-gray-400')}>
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{item.name}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
