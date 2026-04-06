import { AlertCircle, AlertTriangle, CheckCircle, Clock, Shield, Users } from 'lucide-react';
import { formatDate } from '../../../lib/utils';

const RISK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  LOW: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  MEDIUM: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  HIGH: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  CRITICAL: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
};

interface TaskAuditPanelProps {
  auditData: any;
  compact?: boolean;
}

export default function TaskAuditPanel({ auditData, compact = false }: TaskAuditPanelProps) {
  if (!auditData) return null;

  const risk = RISK_COLORS[auditData.riskLevel] || RISK_COLORS.LOW;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className={`grid ${compact ? 'grid-cols-3' : 'grid-cols-3 md:grid-cols-6'} gap-2`}>
        <StatCard label="Open Tasks" value={auditData.totalOpenTasks} icon={<Clock size={14} />} />
        <StatCard label="Overdue" value={auditData.overdueTasks} icon={<AlertCircle size={14} />} highlight={auditData.overdueTasks > 0} color="red" />
        <StatCard label="Due in Leave" value={auditData.dueWithinLeave} icon={<AlertTriangle size={14} />} highlight={auditData.dueWithinLeave > 0} color="amber" />
        {!compact && (
          <>
            <StatCard label="Critical" value={auditData.criticalTasks} icon={<Shield size={14} />} highlight={auditData.criticalTasks > 0} color="red" />
            <StatCard label="Blocked" value={auditData.blockedTasks} icon={<AlertCircle size={14} />} highlight={auditData.blockedTasks > 0} color="orange" />
            <StatCard label="No Backup" value={auditData.noBackupTasks} icon={<Users size={14} />} highlight={auditData.noBackupTasks > 0} color="amber" />
          </>
        )}
      </div>

      {/* Risk Level Badge */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${risk.bg} ${risk.border}`}>
        <span className={`text-sm font-semibold ${risk.text}`}>Risk: {auditData.riskLevel}</span>
        <span className={`text-xs ${risk.text} opacity-80`}>
          (Score: {auditData.riskScore}/100)
        </span>
        {auditData.riskExplanation && (
          <span className={`text-xs ${risk.text} opacity-70 ml-auto`}>{auditData.riskExplanation}</span>
        )}
      </div>

      {/* Integration warnings */}
      {auditData.integrationStatus === 'NOT_CONFIGURED' && (
        <p className="text-xs text-gray-400 italic">Task manager not configured. Contact admin to enable task impact assessment.</p>
      )}
      {auditData.integrationStatus === 'ERROR' && (
        <p className="text-xs text-amber-600 italic">Task manager connection failed. Proceeding without task impact data.</p>
      )}

      {/* Important Tasks Table */}
      {auditData.items?.length > 0 && !compact && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="pb-2 font-medium text-xs">Task</th>
                <th className="pb-2 font-medium text-xs">Project</th>
                <th className="pb-2 font-medium text-xs">Priority</th>
                <th className="pb-2 font-medium text-xs">Due Date</th>
                <th className="pb-2 font-medium text-xs">Status</th>
                <th className="pb-2 font-medium text-xs">Risk</th>
              </tr>
            </thead>
            <tbody>
              {auditData.items.map((item: any, i: number) => {
                const itemRisk = RISK_COLORS[item.riskLevel] || RISK_COLORS.LOW;
                return (
                  <tr key={item.externalTaskId || i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-800 text-xs max-w-[200px] truncate">
                      {item.taskTitle}
                      {item.blockerFlag && <span className="ml-1 text-red-500 text-[10px] font-bold">BLOCKER</span>}
                    </td>
                    <td className="py-2 text-gray-500 text-xs">{item.projectName || '—'}</td>
                    <td className="py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        item.priority?.toLowerCase() === 'critical' || item.priority?.toLowerCase() === 'highest' ? 'bg-red-50 text-red-700' :
                        item.priority?.toLowerCase() === 'high' ? 'bg-orange-50 text-orange-700' :
                        'bg-gray-50 text-gray-600'
                      }`}>{item.priority || '—'}</span>
                    </td>
                    <td className="py-2 text-gray-600 text-xs font-mono" data-mono>
                      {item.dueDate ? formatDate(item.dueDate) : '—'}
                    </td>
                    <td className="py-2 text-gray-500 text-xs">{item.currentStatus || '—'}</td>
                    <td className="py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${itemRisk.bg} ${itemRisk.text}`}>
                        {item.riskLevel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, highlight, color }: { label: string; value: number; icon: React.ReactNode; highlight?: boolean; color?: string }) {
  const bgClass = highlight
    ? color === 'red' ? 'bg-red-50' : color === 'orange' ? 'bg-orange-50' : 'bg-amber-50'
    : 'bg-gray-50';
  const textClass = highlight
    ? color === 'red' ? 'text-red-700' : color === 'orange' ? 'text-orange-700' : 'text-amber-700'
    : 'text-gray-900';

  return (
    <div className={`${bgClass} rounded-lg p-2.5 text-center`}>
      <div className={`flex items-center justify-center gap-1 mb-1 ${highlight ? textClass : 'text-gray-400'}`}>
        {icon}
      </div>
      <p className={`text-lg font-bold font-mono ${textClass}`} data-mono>{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}
