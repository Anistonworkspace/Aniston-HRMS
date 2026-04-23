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
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
      {/* Left: Search */}
      <div className="flex items-center gap-4 flex-1">
        {/* Desktop search bar */}
        <div className="relative max-w-md w-full hidden sm:block">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full pl-10 pr-16 py-2 bg-surface-2 border-0 rounded-lg text-sm text-gray-400 text-left focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all hover:bg-gray-100 cursor-pointer"
            aria-label="Open search"
          >
            {t('common.searchPlaceholder')}
          </button>
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 bg-white px-1.5 py-0.5 rounded border border-gray-200 hidden md:flex items-center gap-1">
            <span>⌘</span><span>K</span>
          </kbd>
        </div>
        {/* Mobile search icon button */}
        <button
          onClick={() => setSearchOpen(true)}
          className="sm:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Search"
        >
          <Search size={20} />
        </button>
      </div>

      {/* Right: Language + Notifications + Avatar */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Language Switcher */}
        <div className="relative" ref={langRef}>
          <button
            onClick={() => setLangOpen(!langOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-2 transition-colors text-gray-500 hover:text-gray-700"
            title={t('language.label')}
            aria-expanded={langOpen}
            aria-haspopup="true"
            aria-label={t('language.label')}
          >
            <Globe size={18} />
            <span className="text-xs font-semibold hidden sm:inline">
              {currentLang === 'hi' ? 'हि' : 'EN'}
            </span>
            <ChevronDown size={12} className="hidden sm:block" />
          </button>

          {langOpen && (
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl shadow-layer-lg border border-gray-100 py-1.5 z-50"
            >
              <div className="px-3 py-2 border-b border-gray-50">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{t('language.label')}</p>
              </div>
              <button
                onClick={() => switchLanguage('en')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  currentLang === 'en'
                    ? 'bg-brand-50 text-brand-700 font-medium'
                    : 'text-gray-600 hover:bg-surface-2'
                }`}
              >
                <span className="text-base">🇬🇧</span>
                <span>English</span>
                {currentLang === 'en' && (
                  <svg className="ml-auto w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => switchLanguage('hi')}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  currentLang === 'hi'
                    ? 'bg-brand-50 text-brand-700 font-medium'
                    : 'text-gray-600 hover:bg-surface-2'
                }`}
              >
                <span className="text-base">🇮🇳</span>
                <span>हिन्दी</span>
                {currentLang === 'hi' && (
                  <svg className="ml-auto w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
            className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          >
            {user?.avatar ? (
              <img src={getUploadUrl(user.avatar)} alt="" className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white text-sm font-semibold">
                {getInitials(user?.firstName, user?.lastName)}
              </div>
            )}
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium text-gray-800 leading-tight">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-400 leading-tight">{user?.role?.replace(/_/g, ' ')}</p>
            </div>
            <ChevronDown size={14} className="text-gray-400 hidden md:block" />
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-layer-lg border border-gray-100 py-1.5 z-50"
            >
              <div className="px-4 py-2.5 border-b border-gray-50">
                <p className="text-sm font-medium text-gray-800">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-gray-400">{user?.email}</p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-surface-2 transition-colors"
              >
                <User size={16} /> {t('topbar.profile')}
              </button>
              {['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '') && (
                <button
                  onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-surface-2 transition-colors"
                >
                  <Settings size={16} /> {t('topbar.settings')}
                </button>
              )}
              <div className="border-t border-gray-50 my-1" />
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut size={16} /> {t('topbar.signOut')}
              </button>
            </motion.div>
          )}
        </div>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
