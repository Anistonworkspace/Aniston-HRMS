import { useState, useEffect } from 'react';
import { X, Save, UserCog, Link2, Link2Off, ExternalLink, Loader2 } from 'lucide-react';
import { cn, getInitials } from '../../../lib/utils';
import toast from 'react-hot-toast';
import type { OrgEmployee } from '../types';
import { getRoleConfig } from '../constants';

interface NodeDetailPanelProps {
  employee: OrgEmployee;
  manager: OrgEmployee | null;
  employees: OrgEmployee[];
  canEdit: boolean;
  editMode: boolean;
  saving: boolean;
  onClose: () => void;
  onDelink: () => void;
  onShowLinkModal: () => void;
  onUpdateEmployee: (args: { id: string; data: { firstName: string; lastName: string } }) => { unwrap: () => Promise<unknown> };
}

export default function NodeDetailPanel({
  employee, manager, employees, canEdit, editMode, saving, onClose, onDelink, onShowLinkModal, onUpdateEmployee,
}: NodeDetailPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState(employee.firstName);
  const [editLastName, setEditLastName] = useState(employee.lastName);

  useEffect(() => {
    setEditFirstName(employee.firstName);
    setEditLastName(employee.lastName);
    setIsEditing(false);
  }, [employee]);

  const role = employee.user?.role || 'EMPLOYEE';
  const config = getRoleConfig(role);
  const hasManager = !!(employee.managerId || employee.manager?.id);
  const directReports = employees.filter((e) => (e.managerId || e.manager?.id) === employee.id);

  const handleSave = async () => {
    if (!editFirstName.trim() || !editLastName.trim()) {
      toast.error('First name and last name are required');
      return;
    }
    try {
      await onUpdateEmployee({ id: employee.id, data: { firstName: editFirstName.trim(), lastName: editLastName.trim() } }).unwrap();
      toast.success('Employee details updated');
      setIsEditing(false);
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'data' in err
        ? (err as { data?: { error?: { message?: string } } }).data?.error?.message || 'Failed to update'
        : 'Failed to update';
      toast.error(message);
    }
  };

  return (
    <div className="layer-card p-4 h-full overflow-y-auto" role="complementary" aria-label="Employee details panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Employee Details</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" aria-label="Close details panel">
          <X size={16} className="text-gray-400" />
        </button>
      </div>

      {/* Avatar + Name */}
      <div className="text-center mb-4">
        <div className={cn('w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-2', config.avatar)} aria-hidden="true">
          {getInitials(employee.firstName, employee.lastName)}
        </div>
        {isEditing ? (
          <div className="space-y-2">
            <label className="sr-only" htmlFor="edit-first-name">First Name</label>
            <input id="edit-first-name" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)}
              className="input-glass w-full text-sm text-center" placeholder="First Name" />
            <label className="sr-only" htmlFor="edit-last-name">Last Name</label>
            <input id="edit-last-name" value={editLastName} onChange={(e) => setEditLastName(e.target.value)}
              className="input-glass w-full text-sm text-center" placeholder="Last Name" />
          </div>
        ) : (
          <>
            <p className="font-semibold text-gray-800">{employee.firstName} {employee.lastName}</p>
            <p className="text-xs text-gray-500">{employee.designation?.name || 'No designation'}</p>
          </>
        )}
        <span className="inline-block mt-1 text-[10px] font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded" data-mono>
          {employee.employeeCode}
        </span>
      </div>

      {/* Info grid */}
      <div className="space-y-2.5 mb-4">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Department</span>
          <span className="text-gray-700 font-medium">{employee.department?.name || '\u2014'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Role</span>
          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', config.badge)}>{config.label}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Reports to</span>
          <span className="text-gray-700 font-medium">
            {manager ? `${manager.firstName} ${manager.lastName}` : 'None (Root)'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Direct reports</span>
          <span className="text-gray-700 font-medium">{directReports.length}</span>
        </div>
      </div>

      {/* Direct reports list */}
      {directReports.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 mb-1.5">Direct Reports</p>
          <div className="space-y-1 max-h-32 overflow-y-auto" role="list" aria-label="Direct reports">
            {directReports.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs p-1.5 rounded-lg bg-gray-50" role="listitem">
                <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-bold" aria-hidden="true">
                  {getInitials(r.firstName, r.lastName)}
                </div>
                <span className="text-gray-700">{r.firstName} {r.lastName}</span>
                <span className="text-gray-400 ml-auto font-mono" data-mono>{r.employeeCode}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {canEdit && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          {isEditing ? (
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
              </button>
              <button onClick={() => setIsEditing(false)}
                className="flex-1 px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setIsEditing(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 border border-brand-200">
              <UserCog size={13} /> Edit Details
            </button>
          )}

          <button onClick={onShowLinkModal}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 border border-emerald-200">
            <Link2 size={13} /> {hasManager ? 'Change Manager' : 'Assign Manager'}
          </button>

          {hasManager && (
            <button onClick={onDelink}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100 border border-red-200">
              <Link2Off size={13} /> Remove Manager (Delink)
            </button>
          )}

          <a href={`/employees/${employee.id}`} target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 border border-gray-200">
            <ExternalLink size={13} /> View Full Profile
          </a>
        </div>
      )}
    </div>
  );
}
