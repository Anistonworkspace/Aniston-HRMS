import { useNavigate } from 'react-router-dom';
import { Search, LogOut, User, Settings, ChevronDown, Globe } from 'lucide-react';
import NotificationBell from '../../features/notifications/NotificationBell';
import CommandPalette from './CommandPalette';
import { motion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { logout } from '../../features/auth/authSlice';
import { useLogoutMutation } from '../../features/auth/authApi';
import { getInitials, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function Topbar() {
  const { t, i18n } = useTranslation();
  const user = useAppSelector((state) => state.auth.user);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [logoutApi] = useLogoutMutation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleLogout = async () => {
    try {
      await logoutApi().unwrap();
    } catch {
      // Logout anyway
    }
    dispatch(logout());
    toast.success(t('common.loggedOut', 'Signed out successfully'));
    navigate('/login');
  };

  const currentLang = i18n.language?.startsWith('hi') ? 'hi' : 'en';

  const switchLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    setLangOpen(false);
  };

  return (
    <header
      className="flex items-center justify-between px-4 md:px-6 sticky top-0 z-30"
      style={{
        height: '48px',
        background: 'var(--primary-background-color)',
        borderBottom: '1px solid var(--layout-border-color)',
      }}
    >
      {/* Left: Search */}
      <div className="flex items-center gap-3 flex-1">
        {/* Desktop search bar */}
        <div className="relative max-w-md w-full hidden sm:block">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--icon-color)' }} />
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full pl-9 pr-14 text-sm text-left focus:outline-none cursor-pointer transition-all"
            style={{
              height: '32px',
              background: 'var(--allgrey-background-color)',
              border: '1px solid var(--layout-border-color)',
              borderRadius: 'var(--border-radius-small)',
              color: 'var(--placeholder-color)',
              fontSize: '14px',
            }}
            aria-label="Open search"
          >
            {t('common.searchPlaceholder')}
          </button>
          <kbd
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs hidden md:flex items-center gap-1 px-1.5 py-0.5 rounded"
            style={{
              color: 'var(--secondary-text-color)',
              background: 'var(--primary-background-color)',
              border: '1px solid var(--ui-border-color)',
              fontSize: '11px',
            }}
          >
            <span>⌘</span><span>K</span>
          </kbd>
        </div>
        {/* Mobile search icon button */}
        <button
          onClick={() => setSearchOpen(true)}
          className="sm:hidden p-1.5 rounded transition-colors"
          style={{ color: 'var(--icon-color)', borderRadius: 'var(--border-radius-small)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-background-hover-color)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          aria-label="Search"
        >
          <Search size={18} />
        </button>
      </div>

      {/* Right: Language + Notifications + Avatar */}
      <div className="flex items-center gap-1 md:gap-2">
        {/* Language Switcher */}
        <div className="relative" ref={langRef}>
          <button
            onClick={() => setLangOpen(!langOpen)}
            className="flex items-center gap-1.5 px-2 py-1 transition-colors rounded"
            style={{
              color: 'var(--secondary-text-color)',
              borderRadius: 'var(--border-radius-small)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-background-hover-color)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title={t('language.label')}
            aria-expanded={langOpen}
            aria-haspopup="true"
            aria-label={t('language.label')}
          >
            <Globe size={16} />
            <span className="text-xs font-semibold hidden sm:inline">
              {currentLang === 'hi' ? 'हि' : 'EN'}
            </span>
            <ChevronDown size={11} className="hidden sm:block" />
          </button>

          {langOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.1, ease: [0, 0, 0.35, 1] }}
              className="absolute right-0 top-full mt-1 w-44 py-1.5 z-50"
              style={{
                background: 'var(--dialog-background-color)',
                borderRadius: 'var(--border-radius-medium)',
                boxShadow: 'var(--box-shadow-medium)',
                border: '1px solid var(--layout-border-color)',
              }}
            >
              <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--ui-background-color)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-text-color)' }}>{t('language.label')}</p>
              </div>
              <button
                onClick={() => switchLanguage('en')}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors"
                style={{
                  background: currentLang === 'en' ? 'var(--primary-selected-color)' : 'transparent',
                  color: currentLang === 'en' ? 'var(--primary-color)' : 'var(--primary-text-color)',
                  fontWeight: currentLang === 'en' ? 600 : 400,
                }}
              >
                <span className="text-base">🇬🇧</span>
                <span>English</span>
                {currentLang === 'en' && (
                  <svg className="ml-auto w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ color: 'var(--primary-color)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => switchLanguage('hi')}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors"
                style={{
                  background: currentLang === 'hi' ? 'var(--primary-selected-color)' : 'transparent',
                  color: currentLang === 'hi' ? 'var(--primary-color)' : 'var(--primary-text-color)',
                  fontWeight: currentLang === 'hi' ? 600 : 400,
                }}
              >
                <span className="text-base">🇮🇳</span>
                <span>हिन्दी</span>
                {currentLang === 'hi' && (
                  <svg className="ml-auto w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ color: 'var(--primary-color)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            </motion.div>
          )}
        </div>

        {/* Notification bell */}
        <NotificationBell />

        {/* User dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 pl-2 pr-2 py-1 transition-colors rounded"
            style={{ borderRadius: 'var(--border-radius-small)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-background-hover-color)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {user?.avatar ? (
              <img src={getUploadUrl(user.avatar)} alt="" className="w-7 h-7 object-cover" style={{ borderRadius: 'var(--border-radius-small)' }} />
            ) : (
              <div
                className="w-7 h-7 flex items-center justify-center text-white text-xs font-semibold"
                style={{ background: 'var(--primary-color)', borderRadius: 'var(--border-radius-small)' }}
              >
                {getInitials(user?.firstName, user?.lastName)}
              </div>
            )}
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium leading-tight" style={{ color: 'var(--primary-text-color)' }}>
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs leading-tight" style={{ color: 'var(--secondary-text-color)' }}>{user?.role?.replace(/_/g, ' ')}</p>
            </div>
            <ChevronDown size={13} className="hidden md:block" style={{ color: 'var(--icon-color)' }} />
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.1, ease: [0, 0, 0.35, 1] }}
              className="absolute right-0 top-full mt-1 w-56 py-1.5 z-50"
              style={{
                background: 'var(--dialog-background-color)',
                borderRadius: 'var(--border-radius-medium)',
                boxShadow: 'var(--box-shadow-medium)',
                border: '1px solid var(--layout-border-color)',
              }}
            >
              <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--ui-background-color)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--primary-text-color)' }}>
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs" style={{ color: 'var(--secondary-text-color)' }}>{user?.email}</p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors"
                style={{ color: 'var(--primary-text-color)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-background-hover-color)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <User size={15} style={{ color: 'var(--icon-color)' }} /> {t('topbar.profile')}
              </button>
              {['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '') && (
                <button
                  onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors"
                  style={{ color: 'var(--primary-text-color)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-background-hover-color)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Settings size={15} style={{ color: 'var(--icon-color)' }} /> {t('topbar.settings')}
                </button>
              )}
              <div className="my-1" style={{ borderTop: '1px solid var(--ui-background-color)' }} />
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors"
                style={{ color: 'var(--negative-color)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--negative-color-selected)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <LogOut size={15} /> {t('topbar.signOut')}
              </button>
            </motion.div>
          )}
        </div>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
