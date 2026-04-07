import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Search } from 'lucide-react';
import { cn, getInitials } from '../../../lib/utils';
import type { OrgEmployee } from '../types';
import { getRoleConfig } from '../constants';

interface LinkManagerModalProps {
  employees: OrgEmployee[];
  currentId: string;
  currentManagerId?: string;
  onLink: (managerId: string) => void;
  onClose: () => void;
}

export default function LinkManagerModal({ employees, currentId, currentManagerId, onLink, onClose }: LinkManagerModalProps) {
  const [search, setSearch] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus trap: auto-focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const available = employees.filter((e) => {
    if (e.id === currentId) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || e.employeeCode?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Select Manager"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-display font-semibold text-gray-900">Select Manager</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" aria-label="Close modal">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="px-5 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <label className="sr-only" htmlFor="search-manager">Search employees</label>
            <input
              ref={searchRef}
              id="search-manager"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1" role="listbox" aria-label="Available managers">
          {available.map((emp) => {
            const isCurrent = emp.id === currentManagerId;
            const role = emp.user?.role || 'EMPLOYEE';
            const config = getRoleConfig(role);
            return (
              <button
                key={emp.id}
                role="option"
                aria-selected={isCurrent}
                onClick={() => !isCurrent && onLink(emp.id)}
                className={cn('w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors',
                  isCurrent ? 'bg-brand-50 border border-brand-200 cursor-default' : 'hover:bg-gray-50')}
              >
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0', config.avatar)} aria-hidden="true">
                  {getInitials(emp.firstName, emp.lastName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-gray-400 truncate">{emp.designation?.name || 'Employee'} {emp.department?.name ? `\u00b7 ${emp.department.name}` : ''}</p>
                </div>
                <span className="text-[10px] font-mono text-gray-400" data-mono>{emp.employeeCode}</span>
                {isCurrent && <span className="text-[10px] text-brand-600 font-medium">Current</span>}
              </button>
            );
          })}
          {available.length === 0 && <p className="text-center text-gray-400 text-sm py-6">No employees found</p>}
        </div>
      </motion.div>
    </div>
  );
}
