import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Search, Filter, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGetEmployeesQuery } from './employeeApi';
import CreateEmployeeModal from './CreateEmployeeModal';
import { getInitials, getStatusColor, formatDate } from '../../lib/utils';

export default function EmployeeListPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchDebounce, setSearchDebounce] = useState('');

  const { data, isLoading } = useGetEmployeesQuery({
    page,
    limit: 10,
    search: searchDebounce,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const employees = data?.data || [];
  const meta = data?.meta;

  // Debounced search
  let searchTimer: ReturnType<typeof setTimeout>;
  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setSearchDebounce(value);
      setPage(1);
    }, 300);
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Manage your team — {meta?.total ?? 0} total
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2 self-start"
        >
          <Plus size={18} />
          Add Employee
        </motion.button>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, email, code..."
            className="input-glass w-full pl-9 text-sm"
          />
        </div>
        <button className="btn-secondary flex items-center gap-2 text-sm">
          <Filter size={16} />
          <span className="hidden sm:inline">Filters</span>
        </button>
      </div>

      {/* Table */}
      <div className="data-table overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Employee
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">
                Department
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">
                Work Mode
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">
                Joined
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Status
              </th>
              <th className="w-12 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td colSpan={6} className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse" />
                      <div className="space-y-2">
                        <div className="w-32 h-3 bg-gray-100 rounded animate-pulse" />
                        <div className="w-48 h-2.5 bg-gray-50 rounded animate-pulse" />
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            ) : employees.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400 text-sm">
                  No employees found
                </td>
              </tr>
            ) : (
              employees.map((emp, index) => (
                <motion.tr
                  key={emp.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => navigate(`/employees/${emp.id}`)}
                  className="border-b border-gray-50 hover:bg-surface-2/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm flex-shrink-0">
                        {getInitials(emp.firstName, emp.lastName)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {emp.firstName} {emp.lastName}
                        </p>
                        <p className="text-xs text-gray-400">
                          <span className="font-mono" data-mono>{emp.employeeCode}</span>
                          {' · '}
                          {emp.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <span className="text-sm text-gray-600">{emp.department?.name || '—'}</span>
                    {emp.designation?.name && (
                      <p className="text-xs text-gray-400">{emp.designation.name}</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5 hidden lg:table-cell">
                    <span className="badge badge-info text-xs">
                      {emp.workMode?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 hidden sm:table-cell">
                    <span className="text-sm text-gray-500">{formatDate(emp.joiningDate)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`badge ${getStatusColor(emp.status)}`}>
                      {emp.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                    >
                      <MoreHorizontal size={16} className="text-gray-400" />
                    </button>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              Showing {(meta.page - 1) * meta.limit + 1}-{Math.min(meta.page * meta.limit, meta.total)} of{' '}
              <span className="font-mono" data-mono>{meta.total}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!meta.hasPrev}
                className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-gray-600 font-mono px-2" data-mono>
                {meta.page} / {meta.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!meta.hasNext}
                className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Employee Modal */}
      <CreateEmployeeModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </div>
  );
}
