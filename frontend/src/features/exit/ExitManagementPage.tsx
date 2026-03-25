import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserMinus, Eye, Search, Filter } from 'lucide-react';
import { useGetExitRequestsQuery } from './exitApi';
import { cn } from '../../lib/utils';

const statusColors: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-blue-50 text-blue-700',
  NO_DUES_PENDING: 'bg-orange-50 text-orange-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  WITHDRAWN: 'bg-gray-100 text-gray-500',
};

const exitTypeColors: Record<string, string> = {
  RESIGNATION: 'bg-blue-50 text-blue-600',
  TERMINATION: 'bg-red-50 text-red-600',
  END_OF_CONTRACT: 'bg-purple-50 text-purple-600',
  ABSCONDING: 'bg-gray-100 text-gray-600',
};

export default function ExitManagementPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const { data: res, isLoading } = useGetExitRequestsQuery({ page, status: statusFilter || undefined });
  const employees = res?.data || [];
  const meta = res?.meta;

  const filtered = search
    ? employees.filter((e: any) =>
        `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase().includes(search.toLowerCase())
      )
    : employees;

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <UserMinus size={24} className="text-brand-600" />
          <h1 className="text-2xl font-display font-bold text-gray-900">Employee Exit Management</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="layer-card p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-glass w-full pl-9 text-sm"
              placeholder="Search by name or code..."
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="input-glass text-sm min-w-[160px]"
          >
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="NO_DUES_PENDING">No Dues Pending</option>
            <option value="COMPLETED">Completed</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="layer-card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-gray-400">Loading exit requests...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <UserMinus size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No exit requests found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Employee</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Department</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Resignation Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Last Working Day</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp: any) => (
                  <tr key={emp.id} className="border-b border-gray-50 hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                        <p className="text-xs text-gray-400 font-mono" data-mono>{emp.employeeCode}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{emp.department?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs font-medium px-2 py-1 rounded-full', exitTypeColors[emp.exitType] || 'bg-gray-100 text-gray-500')}>
                        {(emp.exitType || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs" data-mono>
                      {emp.resignationDate ? new Date(emp.resignationDate).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs" data-mono>
                      {emp.lastWorkingDate ? new Date(emp.lastWorkingDate).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs font-medium px-2 py-1 rounded-full', statusColors[emp.exitStatus] || 'bg-gray-100 text-gray-500')}>
                        {(emp.exitStatus || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/exit-management/${emp.id}`)}
                        className="text-brand-600 hover:text-brand-700 p-1.5 rounded-lg hover:bg-brand-50"
                        title="View Details"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
            </p>
            <div className="flex gap-1">
              <button disabled={!meta.hasPrev} onClick={() => setPage(p => p - 1)} className="btn-secondary text-xs px-3 py-1 disabled:opacity-40">Prev</button>
              <button disabled={!meta.hasNext} onClick={() => setPage(p => p + 1)} className="btn-secondary text-xs px-3 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
