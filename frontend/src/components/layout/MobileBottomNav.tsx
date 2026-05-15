import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, CalendarDays, MapPin, Calendar, User, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useGetTodayStatusQuery, useClockInMutation, useClockOutMutation } from '../../features/attendance/attendanceApi';
import { useAppSelector } from '../../app/store';
import { enqueueAction } from '../../lib/offlineQueue';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { startNativeGpsService, stopNativeGpsService, isNativeAndroid } from '../../lib/capacitorGPS';

export default function MobileBottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const user = useAppSelector((state) => state.auth.user);
  const accessToken = useAppSelector((state) => state.auth.accessToken);
  // SUPER_ADMIN/ADMIN are pure management accounts — no personal clock-in.
  // HR role employees are real people who CAN clock in on mobile (they just cannot
  // use the manual calendar to mark other HR accounts — that is enforced by the backend).
  // System HR account (isSystemAccount=true) has no employeeId so the backend rejects it anyway.
  const isManagement = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role || '');
  const canUseCenterButton = !isManagement && !!user?.employeeId;
  const { data: todayRes } = useGetTodayStatusQuery(undefined, { skip: !canUseCenterButton });
  const todayStatus = todayRes?.data;
  const [clockIn, { isLoading: clockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: clockingOut }] = useClockOutMutation();
  const [gettingLocation, setGettingLocation] = useState(false);

  const isFieldShift = (todayStatus?.shift as any)?.shiftType === 'FIELD';

  // On /attendance page, FIELD employees own their own Check Out button inside
  // FieldSalesView — hide the center button to avoid showing two checkout buttons.
  const onAttendancePage = location.pathname.startsWith('/attendance');
  const hideCenterButton = onAttendancePage && isFieldShift;

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
    let coords: { latitude?: number; longitude?: number; accuracy?: number } = {};
    try {
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
        } catch (gpsErr: any) {
          if (isFieldShift) {
            setGettingLocation(false);
            const msg =
              gpsErr?.code === 1
                ? 'Location access denied. Field employees must enable GPS to mark attendance.'
                : gpsErr?.code === 2
                ? 'GPS signal unavailable. Please move to an open area and try again.'
                : 'Could not get your location. Field employees must have GPS enabled to mark attendance.';
            toast.error(msg, { duration: 5000 });
            return;
          }
          // Non-field shifts: proceed without GPS (backend enforces for OFFICE shifts)
        }
      }
      setGettingLocation(false);
      const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';

      if (todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut) {
        // ── CHECK OUT ──────────────────────────────────────────────────────────
        await clockOut({ ...coords, deviceType }).unwrap();
        toast.success(t('attendance.checkedOut'));

        // Stop native GPS service for FIELD employees on check-out
        if (isFieldShift && isNativeAndroid) {
          stopNativeGpsService().catch(() => {});
        }
      } else {
        // ── CHECK IN ───────────────────────────────────────────────────────────
        const result = await clockIn({ ...coords, source: 'MANUAL_APP', deviceType }).unwrap();
        toast.success(todayStatus?.isCheckedOut ? t('dashboard.reCheckedIn') : t('attendance.checkedIn'));

        // For FIELD shift employees on Android: start native GPS service immediately
        // so live tracking begins right from check-in without visiting Attendance page.
        if (isFieldShift && isNativeAndroid && accessToken) {
          const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
          const backendBase = rawApiUrl
            ? rawApiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')
            : 'https://hr.anistonav.com';
          const intervalMins = (todayStatus?.shift as any)?.trackingIntervalMinutes as number | undefined;
          // Attendance record ID from the clock-in response (if returned) or from todayStatus
          const attendanceId: string = result?.data?.id ?? result?.id ?? '';
          startNativeGpsService({
            backendUrl: backendBase,
            authToken: accessToken,
            employeeId: user?.employeeId || '',
            orgId: user?.organizationId || '',
            ...(attendanceId ? { attendanceId } : {}),
            ...(intervalMins != null ? { trackingIntervalMinutes: intervalMins } : {}),
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      setGettingLocation(false);
      // If offline, queue the action for later sync
      if (!navigator.onLine) {
        const deviceType = /Android|iPhone|iPad|IPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        const isCheckOut = todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut;
        enqueueAction(isCheckOut ? 'CLOCK_OUT' : 'CLOCK_IN', { ...coords, source: 'MANUAL_APP', deviceType });
        toast(t('attendance.queuedOffline', 'Queued — will sync when you’re back online'), { icon: '📡' });
        return;
      }
      toast.error(err?.data?.error?.message || t('common.failed'));
    }
  };

  const isCheckedIn = todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut;
  const isCompleted = !!todayStatus?.isCheckedOut && !gettingLocation;
  const isLoading = gettingLocation || clockingIn || clockingOut;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 safe-area-pb"
      style={{
        background: 'var(--primary-background-color)',
        borderTop: '1px solid var(--layout-border-color)',
      }}
    >
      <div className="flex items-center justify-around h-16 relative">
        {/* Left nav items */}
        {navItems.slice(0, 2).map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <NavLink key={item.path} to={item.path}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors"
              style={{ color: isActive ? 'var(--primary-color)' : 'var(--icon-color)' }}
            >
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{item.name}</span>
            </NavLink>
          );
        })}

        {/* Center Check In/Out button
            Hidden on /attendance for FIELD employees — FieldSalesView owns that action. */}
        <div className="flex flex-col items-center justify-center flex-1 -mt-6">
          {hideCenterButton ? (
            <div className="w-16 h-16" />
          ) : (
            <>
              <button
                onClick={handleCheckInOut}
                disabled={isLoading || !canUseCenterButton}
                aria-label={isCheckedIn ? t('mobileNav.checkOut') : t('mobileNav.checkIn')}
                className={cn(
                  'w-16 h-16 rounded-full flex items-center justify-center transition-all',
                  isLoading ? 'animate-pulse' : 'active:scale-90'
                )}
                style={{
                  boxShadow: 'var(--box-shadow-small)',
                  background: isLoading
                    ? 'var(--primary-color)'
                    : isCheckedIn
                    ? 'var(--negative-color)'
                    : isCompleted
                    ? 'var(--warning-color-hover)'
                    : canUseCenterButton
                    ? 'var(--positive-color)'
                    : 'var(--disabled-background-color)',
                  opacity: canUseCenterButton || isLoading ? 1 : 0.6,
                }}
              >
                {isLoading ? (
                  <Loader2 size={24} className="text-white animate-spin" />
                ) : (
                  <MapPin size={24} className="text-white" />
                )}
              </button>
              {isCheckedIn && !isLoading && (
                <div className="w-2 h-2 rounded-full mt-1 animate-pulse" style={{ background: 'var(--positive-color)' }} />
              )}
              <span className="text-[10px] mt-0.5 font-medium" style={{ color: 'var(--secondary-text-color)' }}>
                {isLoading
                  ? (gettingLocation ? t('mobileNav.gettingGps') : clockingIn ? t('mobileNav.marking') : t('mobileNav.processing'))
                  : !canUseCenterButton ? t('attendance.hr') : isCheckedIn ? t('mobileNav.checkOut') : isCompleted ? t('mobileNav.reCheckIn') : t('mobileNav.checkIn')}
              </span>
            </>
          )}
        </div>

        {/* Right nav items */}
        {navItems.slice(2).map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <NavLink key={item.path} to={item.path}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors"
              style={{ color: isActive ? 'var(--primary-color)' : 'var(--icon-color)' }}
            >
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{item.name}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
