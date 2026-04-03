import { useState } from 'react';
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
  const [gettingLocation, setGettingLocation] = useState(false);

  const handleCheckInOut = async () => {
    if (gettingLocation || clockingIn || clockingOut) return;
    setGettingLocation(true);
    try {
      let coords: { latitude?: number; longitude?: number } = {};
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch { /* proceed without GPS */ }
      }
      setGettingLocation(false);
      if (todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut) {
        await clockOut(coords).unwrap();
        toast.success('Checked out successfully!');
      } else {
        await clockIn({ ...coords, source: 'MANUAL_APP' }).unwrap();
        toast.success(todayStatus?.isCheckedOut ? 'Re-checked in!' : 'Checked in successfully!');
      }
    } catch (err: any) {
      setGettingLocation(false);
      toast.error(err?.data?.error?.message || 'Failed');
    }
  };

  const isCheckedIn = todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut;
  const isCompleted = !!todayStatus?.isCheckedOut && !gettingLocation;
  const isLoading = gettingLocation || clockingIn || clockingOut;

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
        <div className="flex flex-col items-center justify-center flex-1 -mt-6">
          <button
            onClick={handleCheckInOut}
            disabled={isLoading || isManagement}
            className={cn(
              'w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all',
              isLoading
                ? 'bg-brand-500 shadow-brand-200 animate-pulse'
                : isCheckedIn
                ? 'bg-red-500 shadow-red-200 active:scale-90'
                : isCompleted
                ? 'bg-amber-500 shadow-amber-200 active:scale-90'
                : 'bg-emerald-500 shadow-emerald-200 active:scale-90',
              isManagement && 'bg-gray-300 opacity-60'
            )}
          >
            {isLoading ? (
              <Loader2 size={24} className="text-white animate-spin" />
            ) : isCompleted ? (
              <MapPin size={24} className="text-white" />
            ) : (
              <MapPin size={24} className="text-white" />
            )}
          </button>
          {isCheckedIn && !isLoading && <div className="w-2 h-2 bg-emerald-400 rounded-full mt-1 animate-pulse" />}
          <span className="text-[10px] text-gray-500 mt-0.5 font-medium">
            {isLoading
              ? (gettingLocation ? 'Getting GPS...' : clockingIn ? 'Marking...' : 'Processing...')
              : isManagement ? 'HR' : isCheckedIn ? 'Check Out' : isCompleted ? 'Re-Check In' : 'Check In'}
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
