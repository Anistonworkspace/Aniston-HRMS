import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, LayoutDashboard, Users, Clock, CalendarOff, DollarSign,
  Target, FileText, Megaphone, GitBranch, Headphones, BarChart2,
  Settings, User, Shield, UserPlus, Activity, LogOut, Briefcase,
  FolderOpen, Package, CheckSquare, Mail, MessageCircle, Award,
  ChevronRight, Command,
} from 'lucide-react';
import { useAppSelector } from '../../app/store';

interface RouteItem {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: React.ElementType;
  category: string;
  keywords: string[];
  roles: string[]; // empty = all roles
}

const ALL_ROUTES: RouteItem[] = [
  // Core
  { id: 'dashboard', label: 'Dashboard', description: 'Overview, stats, quick actions', path: '/dashboard', icon: LayoutDashboard, category: 'Core', keywords: ['home', 'overview', 'stats', 'analytics'], roles: [] },
  { id: 'profile', label: 'My Profile', description: 'View and edit your profile', path: '/profile', icon: User, category: 'Core', keywords: ['profile', 'account', 'personal', 'me'], roles: [] },
  { id: 'pending-approvals', label: 'Pending Approvals', description: 'Leave and ticket approvals', path: '/pending-approvals', icon: CheckSquare, category: 'Core', keywords: ['approvals', 'pending', 'review', 'leave'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },

  // Employees
  { id: 'employees', label: 'Manage Employees', description: 'Employee list, profiles, onboarding', path: '/employees', icon: Users, category: 'People', keywords: ['employee', 'staff', 'team', 'hr', 'manage', 'people'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },
  { id: 'kyc-review', label: 'KYC Review', description: 'Review employee KYC documents', path: '/kyc-review', icon: Shield, category: 'People', keywords: ['kyc', 'document', 'verify', 'aadhaar', 'pan'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { id: 'exit-management', label: 'Exit Management', description: 'Employee offboarding and exit process', path: '/exit-management', icon: LogOut, category: 'People', keywords: ['exit', 'offboarding', 'resignation', 'leave company'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { id: 'walk-in-management', label: 'Walk-in Management', description: 'Manage walk-in candidates', path: '/walk-in-management', icon: UserPlus, category: 'People', keywords: ['walk-in', 'candidate', 'visitor', 'register'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },

  // Attendance & Time
  { id: 'attendance', label: 'Attendance', description: 'Mark attendance, field sales, project site', path: '/attendance', icon: Clock, category: 'Time & Attendance', keywords: ['attendance', 'check-in', 'check-out', 'clock', 'geofence', 'gps', 'regularize', 'overtime'], roles: [] },
  { id: 'roster', label: 'Roster', description: 'Employee scheduling and shifts', path: '/roster', icon: GitBranch, category: 'Time & Attendance', keywords: ['roster', 'schedule', 'shift', 'timing'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { id: 'activity-tracking', label: 'Activity Tracking', description: 'Monitor employee activity and sessions', path: '/activity-tracking', icon: Activity, category: 'Time & Attendance', keywords: ['activity', 'tracking', 'monitor', 'agent', 'session'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },

  // Leave
  { id: 'leaves', label: 'Leave Management', description: 'Apply, approve, and manage leaves', path: '/leaves', icon: CalendarOff, category: 'Leave', keywords: ['leave', 'apply', 'holiday', 'absence', 'balance', 'sick', 'casual'], roles: [] },

  // Payroll
  { id: 'payroll', label: 'Payroll', description: 'Salary, payslips, EPF, ESI, TDS', path: '/payroll', icon: DollarSign, category: 'Finance', keywords: ['payroll', 'salary', 'payslip', 'epf', 'esi', 'tds', 'ctc', 'income'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN'] },

  // Recruitment
  { id: 'recruitment', label: 'Recruitment', description: 'Job openings, candidates, Kanban pipeline', path: '/recruitment', icon: Briefcase, category: 'Recruitment', keywords: ['recruitment', 'hiring', 'job', 'candidate', 'interview', 'offer', 'pipeline'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },
  { id: 'hiring-passed', label: 'Hired Candidates', description: 'View candidates who passed hiring', path: '/hiring-passed', icon: Award, category: 'Recruitment', keywords: ['hired', 'passed', 'offer', 'accepted'], roles: [] },
  { id: 'interview-assignments', label: 'Interview Assignments', description: 'My interview assignments', path: '/interview-assignments', icon: CheckSquare, category: 'Recruitment', keywords: ['interview', 'assignment', 'task', 'panel'], roles: [] },

  // Performance
  { id: 'performance', label: 'Performance', description: 'Goals, reviews, OKRs, task integration', path: '/performance', icon: Target, category: 'Performance', keywords: ['performance', 'goals', 'okr', 'review', 'kpi', 'rating'], roles: [] },

  // Documents & Assets
  { id: 'my-documents', label: 'My Documents', description: 'Upload and manage your documents', path: '/my-documents', icon: FolderOpen, category: 'Documents & Assets', keywords: ['documents', 'files', 'upload', 'certificate', 'aadhaar', 'pan'], roles: [] },
  { id: 'my-assets', label: 'My Assets', description: 'Company assets assigned to you', path: '/my-assets', icon: Package, category: 'Documents & Assets', keywords: ['assets', 'laptop', 'device', 'equipment', 'assigned'], roles: [] },
  { id: 'policies', label: 'Policies', description: 'Company policies and documents', path: '/policies', icon: FileText, category: 'Documents & Assets', keywords: ['policy', 'policies', 'rules', 'handbook', 'compliance'], roles: [] },

  // Communication
  { id: 'announcements', label: 'Announcements', description: 'Company announcements and social wall', path: '/announcements', icon: Megaphone, category: 'Communication', keywords: ['announcement', 'news', 'update', 'post', 'social', 'wall'], roles: [] },
  { id: 'helpdesk', label: 'Helpdesk', description: 'Support tickets and IT issues', path: '/helpdesk', icon: Headphones, category: 'Communication', keywords: ['helpdesk', 'support', 'ticket', 'issue', 'it', 'help'], roles: [] },
  { id: 'whatsapp', label: 'WhatsApp', description: 'WhatsApp messaging and OTP', path: '/whatsapp', icon: MessageCircle, category: 'Communication', keywords: ['whatsapp', 'message', 'chat', 'otp', 'sms'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { id: 'bulk-email', label: 'Bulk Email', description: 'Send mass emails to employees', path: '/bulk-email', icon: Mail, category: 'Communication', keywords: ['email', 'bulk', 'send', 'mass', 'notification'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },

  // Analytics
  { id: 'reports', label: 'Reports & Analytics', description: 'Attendance, payroll, leave reports', path: '/reports', icon: BarChart2, category: 'Analytics', keywords: ['reports', 'analytics', 'export', 'excel', 'attendance', 'payroll', 'charts'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },
  { id: 'org-chart', label: 'Org Chart', description: 'Company hierarchy visualization', path: '/org-chart', icon: GitBranch, category: 'Analytics', keywords: ['org chart', 'hierarchy', 'tree', 'organization', 'structure'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },

  // Settings
  { id: 'settings', label: 'Settings', description: 'Organization settings, AI config, audit logs', path: '/settings', icon: Settings, category: 'Settings', keywords: ['settings', 'configuration', 'org', 'ai', 'audit', 'branding', 'policy'], roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const user = useAppSelector(s => s.auth.user);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Role-filtered routes
  const visibleRoutes = useMemo(() => {
    const role = user?.role || '';
    return ALL_ROUTES.filter(r => r.roles.length === 0 || r.roles.includes(role));
  }, [user?.role]);

  // Search filter
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return visibleRoutes;
    return visibleRoutes.filter(r =>
      r.label.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.keywords.some(k => k.includes(q)) ||
      r.category.toLowerCase().includes(q)
    );
  }, [query, visibleRoutes]);

  // Group by category
  const grouped = useMemo(() => {
    const map: Record<string, RouteItem[]> = {};
    for (const item of filtered) {
      if (!map[item.category]) map[item.category] = [];
      map[item.category].push(item);
    }
    return map;
  }, [filtered]);

  // Flat list for keyboard nav
  const flatList = filtered;

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleSelect = (item: RouteItem) => {
    navigate(item.path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatList[selectedIdx]) {
      handleSelect(flatList[selectedIdx]);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="cp-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="cp-panel"
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed top-[4.5rem] sm:top-[10vh] left-1/2 -translate-x-1/2 w-full max-w-xl mx-auto z-[101] px-3 sm:px-4"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[calc(100dvh-5.5rem)] sm:max-h-[70vh]">
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
                <Search size={18} className="text-gray-400 shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search features, pages, actions..."
                  className="flex-1 text-sm text-gray-800 placeholder:text-gray-400 bg-transparent outline-none"
                  autoComplete="off"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <kbd className="hidden sm:flex items-center gap-1 text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5 font-mono">
                    <Command size={9} /> K
                  </kbd>
                  <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Results */}
              <div ref={listRef} className="overflow-y-auto custom-scrollbar">
                {filtered.length === 0 ? (
                  <div className="py-12 px-6 text-center">
                    <Search size={32} className="text-gray-300 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-500">No results for "{query}"</p>
                    <p className="text-xs text-gray-400 mt-1">Try searching for a feature name or page</p>
                  </div>
                ) : (
                  <div className="py-2">
                    {Object.entries(grouped).map(([category, items]) => (
                      <div key={category}>
                        <div className="px-4 py-1.5">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{category}</p>
                        </div>
                        {items.map(item => {
                          const globalIdx = flatList.indexOf(item);
                          const Icon = item.icon;
                          const isSelected = globalIdx === selectedIdx;
                          return (
                            <button
                              key={item.id}
                              data-idx={globalIdx}
                              onClick={() => handleSelect(item)}
                              onMouseEnter={() => setSelectedIdx(globalIdx)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                isSelected ? 'bg-brand-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                                isSelected ? 'bg-brand-100' : 'bg-gray-100'
                              }`}>
                                <Icon size={15} className={isSelected ? 'text-brand-600' : 'text-gray-500'} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium leading-tight ${isSelected ? 'text-brand-700' : 'text-gray-800'}`}>
                                  {item.label}
                                </p>
                                <p className="text-xs text-gray-400 mt-0.5 truncate">{item.description}</p>
                              </div>
                              <ChevronRight size={14} className={`shrink-0 transition-colors ${isSelected ? 'text-brand-400' : 'text-gray-300'}`} />
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer hint */}
              <div className="shrink-0 px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <kbd className="text-[10px] text-gray-400 bg-white rounded border border-gray-200 px-1.5 py-0.5 font-mono">↑↓</kbd>
                  <span className="text-[10px] text-gray-400">navigate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="text-[10px] text-gray-400 bg-white rounded border border-gray-200 px-1.5 py-0.5 font-mono">↵</kbd>
                  <span className="text-[10px] text-gray-400">open</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="text-[10px] text-gray-400 bg-white rounded border border-gray-200 px-1.5 py-0.5 font-mono">esc</kbd>
                  <span className="text-[10px] text-gray-400">close</span>
                </div>
                <p className="text-[10px] text-gray-300 ml-auto">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
