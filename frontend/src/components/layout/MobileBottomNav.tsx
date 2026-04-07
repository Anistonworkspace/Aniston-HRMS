import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, CalendarDays, MapPin, Calendar, User, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useGetTodayStatusQuery, useClockInMutation, useClockOutMutation } from '../../features/attendance/attendanceApi';
import { useAppSelector } from '../../app/store';
import { enqueueAction } from '../../lib/offlineQueue';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function MobileBottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const user = useAppSelector((state) => state.auth.user);
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const { data: todayRes } = useGetTodayStatusQuery(undefined, { skip: isManagement });
  const todayStatus = todayRes?.data;
  const [clockIn, { isLoading: clockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: clockingOut }] = useClockOutMutation();
  const [gettingLocation, setGettingLocation] = useState(false);

  const navItems = [
    { name: t('nav.home'), path: '/dashboard', icon: Home },
    { name: t('nav.leave'), path: '/leaves', icon: CalendarDays },
    // Center button handled separately
    { name: t('nav.attend'), path: '/attendance', icon: Calendar },
    { name: t('nav.profile'), path: '/profile', icon: User },
  ];

  const handleCheckInOut = async () => {
    if (gettingLocation || clockingIn || clockingOut) return;
    setGettingLocation(true);
    try {
      let coords: { latitude?: number; longitude?: number; accuracy?: number } = {};
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 30000,
            })
          );
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
        } catch {
          // GPS unavailable — proceed without (backend handles this gracefully)
        }
      }
      setGettingLocation(false);
      const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
      if (todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut) {
        await clockOut({ ...coords, deviceType }).unwrap();
        toast.success(t('attendance.checkedOut'));
      } else {
        await clockIn({ ...coords, source: 'MANUAL_APP', deviceType }).unwrap();
        toast.success(todayStatus?.isCheckedOut ? t('dashboard.reCheckedIn') : t('attendance.checkedIn'));
      }
    } catch (err: any) {
      setGettingLocation(false);
      // If offline, queue the action for later sync
      if (!navigator.onLine) {
        const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        const isCheckOut = todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut;
        const coords: Record<string, any> = {};
        enqueueAction(isCheckOut ? 'CLOCK_OUT' : 'CLOCK_IN', { ...coords, source: 'MANUAL_APP', deviceType });
        toast('Queued — will sync when you\u2019re back online', { icon: '\uD83D\uDCE1' });
        return;
      }
      toast.error(err?.data?.error?.message || t('common.failed'));
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
              className={cn('flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors', isActive ? 'text-brand-600' : 'text-gray-400')}>
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
            aria-label={isCompleted ? t('mobileNav.checkOut') : isCheckedIn ? t('mobileNav.checkOut') : t('mobileNav.checkIn')}
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
              ? (gettingLocation ? t('mobileNav.gettingGps') : clockingIn ? t('mobileNav.marking') : t('mobileNav.processing'))
              : isManagement ? t('attendance.hr') : isCheckedIn ? t('mobileNav.checkOut') : isCompleted ? t('mobileNav.reCheckIn') : t('mobileNav.checkIn')}
          </span>
        </div>

        {/* Right nav items */}
        {navItems.slice(2).map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <NavLink key={item.path} to={item.path}
              className={cn('flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors', isActive ? 'text-brand-600' : 'text-gray-400')}>
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{item.name}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
