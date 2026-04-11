import { useState } from 'react';
import { Users, Plus, Trash2 } from 'lucide-react';
import { useGetEmployeesQuery } from '../../employee/employeeApi';

interface HandoverSectionProps {
  handovers: any[];
  editable: boolean;
  backupEmployeeId?: string;
  handoverNotes?: string;
  auditItems?: any[];
  onUpdate?: (data: { backupEmployeeId: string; handoverNotes?: string; taskHandovers?: any[] }) => void;
}

export default function HandoverSection({
  handovers,
  editable,
  backupEmployeeId,
  handoverNotes,
  auditItems,
  onUpdate,
}: HandoverSectionProps) {
  const [selectedBackup, setSelectedBackup] = useState(backupEmployeeId || '');
  const [notes, setNotes] = useState(handoverNotes || '');
  const [taskHandovers, setTaskHandovers] = useState<Array<{ taskExternalId?: string; taskTitle?: string; handoverNote: string; backupEmployeeId: string }>>([]);
  const { data: empRes } = useGetEmployeesQuery({ limit: 100 }, { skip: !editable });
  const employees = empRes?.data || [];

  const handleSave = () => {
    if (!onUpdate) return;
    onUpdate({
      backupEmployeeId: selectedBackup || undefined,
      handoverNotes: notes || undefined,
      taskHandovers: selectedBackup ? taskHandovers.filter(h => h.handoverNote.length >= 3) : undefined,
    });
  };

  // Read-only view
  if (!editable) {
    return (
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Users size={14} className="text-purple-500" /> Handover / Backup Plan
        </h4>
        {handovers.length === 0 && !backupEmployeeId && (
          <p className="text-xs text-gray-400 italic">No handover plan submitted.</p>
        )}
        {backupEmployeeId && (
          <div className="text-xs text-gray-600">
            <span className="font-medium">Backup Assignee:</span> {backupEmployeeId}
          </div>
        )}
        {handoverNotes && (
          <div className="text-xs text-gray-600">
            <span className="font-medium">Notes:</span> {handoverNotes}
          </div>
        )}
        {handovers.map((h: any, i: number) => (
          <div key={h.id || i} className="bg-gray-50 rounded-lg p-3 text-xs">
            {h.taskTitle && <p className="font-medium text-gray-800 mb-1">{h.taskTitle}</p>}
            <p className="text-gray-600">{h.handoverNote}</p>
          </div>
        ))}
      </div>
    );
  }

  // Editable view
  const criticalTasks = (auditItems || []).filter(
    (t: any) => t.riskLevel === 'HIGH' || t.riskLevel === 'CRITICAL'
  );

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <Users size={14} className="text-purple-500" /> Handover / Backup Plan
      </h4>

      {/* Backup Employee Selector (optional) */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">
          Backup Employee <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <select
          value={selectedBackup}
          onChange={(e) => setSelectedBackup(e.target.value)}
          className="input-glass w-full text-sm"
        >
          <option value="">Select backup... (optional)</option>
          {employees.map((emp: any) => (
            <option key={emp.id} value={emp.id}>
              {emp.firstName} {emp.lastName} ({emp.employeeCode})
            </option>
          ))}
        </select>
        {employees.length === 0 && (
          <p className="text-[11px] text-gray-400 mt-1">No other employees found in your organization.</p>
        )}
      </div>

      {/* General Handover Notes */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">General Handover Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="input-glass w-full text-sm"
          rows={2}
          placeholder="Any general instructions for your backup..."
        />
      </div>

      {/* Per-task handovers for critical tasks */}
      {criticalTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 font-medium">Critical/High-Risk Task Handovers</p>
          {criticalTasks.map((task: any, i: number) => {
            const existing = taskHandovers.find(h => h.taskExternalId === task.externalTaskId);
            return (
              <div key={task.externalTaskId || i} className="bg-amber-50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-gray-800">{task.taskTitle}</p>
                <input
                  type="text"
                  className="input-glass w-full text-xs"
                  placeholder="Handover note for this task..."
                  value={existing?.handoverNote || ''}
                  onChange={(e) => {
                    setTaskHandovers(prev => {
                      const idx = prev.findIndex(h => h.taskExternalId === task.externalTaskId);
                      if (idx >= 0) {
                        const copy = [...prev];
                        copy[idx] = { ...copy[idx], handoverNote: e.target.value };
                        return copy;
                      }
                      return [...prev, {
                        taskExternalId: task.externalTaskId,
                        taskTitle: task.taskTitle,
                        handoverNote: e.target.value,
                        backupEmployeeId: selectedBackup,
                      }];
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        className="btn-primary text-sm"
      >
        Save Handover Plan
      </button>
      {!selectedBackup && (
        <p className="text-[11px] text-gray-400 -mt-1">
          No backup assigned. You can still proceed without assigning a backup.
        </p>
      )}
    </div>
  );
}
