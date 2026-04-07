import { useState } from 'react';
import { X, PenSquare, Loader2, CheckCircle } from 'lucide-react';
import { useMarkAttendanceMutation } from '../attendanceApi';
import { useGetEmployeesQuery } from '../../employee/employeeApi';
import { getInitials } from '../../../lib/utils';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultDate?: string;
}

const STATUSES = [
  { value: 'PRESENT', label: 'Present', color: 'bg-emerald-500' },
  { value: 'ABSENT', label: 'Absent', color: 'bg-red-500' },
  { value: 'HALF_DAY', label: 'Half Day', color: 'bg-amber-500' },
  { value: 'ON_LEAVE', label: 'On Leave', color: 'bg-purple-500' },
  { value: 'WORK_FROM_HOME', label: 'WFH', color: 'bg-teal-500' },
];

const WORK_MODES = [
  { value: 'OFFICE', label: 'Office' },
  { value: 'FIELD_SALES', label: 'Field Sales' },
  { value: 'PROJECT_SITE', label: 'Project Site' },
  { value: 'WORK_FROM_HOME', label: 'Work From Home' },
];

export default function MarkManualModal({ isOpen, onClose, defaultDate }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(defaultDate || new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState('PRESENT');
  const [workMode, setWorkMode] = useState('OFFICE');
  const [search, setSearch] = useState('');
  const [markAttendance, { isLoading }] = useMarkAttendanceMutation();
  const { data: empRes } = useGetEmployeesQuery({ limit: 100 });
  const employees = empRes?.data || [];

  if (!isOpen) return null;

  const filtered = employees.filter((e: any) =>
    !e.isSystemAccount &&
    (`${e.firstName} ${e.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
     e.employeeCode?.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedEmp = employees.find((e: any) => e.id === employeeId);

  const handleSubmit = async () => {
    if (!employeeId) { toast.error('Select an employee'); return; }
    if (!date) { toast.error('Select a date'); return; }
    try {
      await markAttendance({ employeeId, date, status, workMode }).unwrap();
      toast.success(`Attendance marked: ${selectedEmp?.firstName || 'Employee'} → ${status}`);
      setEmployeeId('');
      setSearch('');
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to mark attendance');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <PenSquare size={18} className="text-brand-500" />
            <h3 className="font-display font-bold text-gray-900 text-sm">Mark Manual Attendance</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-400" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Employee selector */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Employee *</label>
            {selectedEmp ? (
              <div className="flex items-center gap-2 border border-brand-200 bg-brand-50 rounded-xl px-3 py-2">
                <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700">
                  {getInitials(selectedEmp.firstName, selectedEmp.lastName)}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-800">{selectedEmp.firstName} {selectedEmp.lastName}</p>
                  <p className="text-[10px] text-gray-500">{selectedEmp.employeeCode} · {selectedEmp.department?.name}</p>
                </div>
                <button onClick={() => { setEmployeeId(''); setSearch(''); }} className="text-gray-400 hover:text-red-500">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
                {search.length > 0 && (
                  <div className="mt-1 max-h-36 overflow-y-auto border border-gray-200 rounded-xl bg-white shadow-sm">
                    {filtered.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-3">No employees found</p>
                    ) : (
                      filtered.slice(0, 8).map((emp: any) => (
                        <button key={emp.id} onClick={() => { setEmployeeId(emp.id); setSearch(''); }}
                          className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-50 text-left">
                          <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-600">
                            {getInitials(emp.firstName, emp.lastName)}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                            <p className="text-[10px] text-gray-400">{emp.employeeCode}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Date *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Status *</label>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(s => (
                <button key={s.value} onClick={() => setStatus(s.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    status === s.value
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}>
                  <span className={`w-2 h-2 rounded-full ${s.color}`} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Work Mode */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Work Mode</label>
            <select value={workMode} onChange={e => setWorkMode(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300">
              {WORK_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Cancel</button>
          <button onClick={handleSubmit} disabled={!employeeId || !date || isLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold">
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            Mark Attendance
          </button>
        </div>
      </div>
    </div>
  );
}
