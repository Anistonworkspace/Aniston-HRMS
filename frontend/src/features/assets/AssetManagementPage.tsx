import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor, Plus, Search, Laptop, Smartphone, CreditCard, Eye, Pencil, UserPlus,
  RotateCcw, X, Loader2, CheckCircle2, Package, Wrench, Archive, Shield,
  ChevronLeft, ChevronRight, AlertTriangle, Lock, Unlock, ClipboardList, BarChart3,
  Calendar, Building2, MapPin,
} from 'lucide-react';
import {
  useGetAssetsQuery, useCreateAssetMutation, useUpdateAssetMutation,
  useAssignAssetMutation, useReturnAssetMutation, useGetAssetAssignmentsQuery,
  useGetAssetStatsQuery, useGetExitChecklistQuery, useMarkChecklistItemMutation,
} from './assetApi';
import { useGetExitRequestsQuery } from '../exit/exitApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const CATEGORIES: Record<string, { label: string; icon: any }> = {
  LAPTOP: { label: 'Laptop', icon: Laptop },
  MOBILE: { label: 'Mobile', icon: Smartphone },
  SIM_CARD: { label: 'SIM Card', icon: CreditCard },
  ACCESS_CARD: { label: 'Access Card', icon: CreditCard },
  VISITING_CARD: { label: 'Visiting Card', icon: CreditCard },
  MONITOR: { label: 'Monitor', icon: Monitor },
  OTHER: { label: 'Other', icon: Package },
};

const STATUSES: Record<string, { label: string; color: string; icon: any }> = {
  AVAILABLE: { label: 'Available', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  ASSIGNED: { label: 'Assigned', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: UserPlus },
  MAINTENANCE: { label: 'Maintenance', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Wrench },
  RETIRED: { label: 'Retired', color: 'bg-gray-50 text-gray-500 border-gray-200', icon: Archive },
};

const CONDITIONS: Record<string, { label: string; color: string }> = {
  EXCELLENT: { label: 'Excellent', color: 'bg-emerald-50 text-emerald-700' },
  GOOD: { label: 'Good', color: 'bg-blue-50 text-blue-700' },
  FAIR: { label: 'Fair', color: 'bg-amber-50 text-amber-700' },
  DAMAGED: { label: 'Damaged', color: 'bg-red-50 text-red-700' },
  LOST: { label: 'Lost', color: 'bg-gray-100 text-gray-500' },
};

const TABS = ['All Assets', 'Exit Checklists'] as const;

export default function AssetManagementPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('All Assets');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any>(null);
  const [assigningAsset, setAssigningAsset] = useState<any>(null);
  const [viewingAsset, setViewingAsset] = useState<any>(null);
  const [returningAsset, setReturningAsset] = useState<any>(null);

  const { data: res, isLoading } = useGetAssetsQuery({
    page, limit: 20,
    search: search || undefined,
    category: categoryFilter || undefined,
    status: statusFilter || undefined,
  });
  const { data: statsRes } = useGetAssetStatsQuery();

  const assets = res?.data || [];
  const meta = res?.meta;
  const stats = statsRes?.data;

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
            <Monitor className="text-brand-600" size={28} /> Asset Management
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage IT assets, assignments, and tracking</p>
        </div>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2 self-start">
          <Plus size={18} /> Add Asset
        </motion.button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Total', value: stats.total, icon: Package, bg: 'bg-blue-50', text: 'text-blue-700', iconColor: 'text-blue-500' },
            { label: 'Assigned', value: stats.assigned, icon: UserPlus, bg: 'bg-purple-50', text: 'text-purple-700', iconColor: 'text-purple-500' },
            { label: 'Available', value: stats.available, icon: CheckCircle2, bg: 'bg-emerald-50', text: 'text-emerald-700', iconColor: 'text-emerald-500' },
            { label: 'Maintenance', value: stats.maintenance, icon: Wrench, bg: 'bg-amber-50', text: 'text-amber-700', iconColor: 'text-amber-500' },
            { label: 'Retired', value: stats.retired, icon: Archive, bg: 'bg-gray-50', text: 'text-gray-600', iconColor: 'text-gray-400' },
          ].map(s => (
            <div key={s.label} className={`layer-card p-4 flex items-center gap-3`}>
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
                <s.icon size={20} className={s.iconColor} />
              </div>
              <div>
                <p className={`text-xl font-bold font-mono ${s.text}`} data-mono>{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn('px-4 py-2 text-sm font-medium rounded-lg transition-all',
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'All Assets' && (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search assets..." className="input-glass w-full pl-9 text-sm" />
            </div>
            <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
              className="input-glass w-full sm:w-40 text-sm">
              <option value="">All Categories</option>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="input-glass w-full sm:w-40 text-sm">
              <option value="">All Statuses</option>
              {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {/* Asset Table */}
          {isLoading ? (
            <div className="layer-card p-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto" /></div>
          ) : assets.length === 0 ? (
            <div className="layer-card p-16 text-center">
              <Package size={48} className="mx-auto text-gray-200 mb-4" />
              <h3 className="text-lg font-display font-semibold text-gray-600 mb-1">No assets found</h3>
              <p className="text-sm text-gray-400">Add your first asset to get started</p>
            </div>
          ) : (
            <div className="layer-card overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Asset</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Category</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Brand</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Serial #</th>
                    <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">Condition</th>
                    <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">Status</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Assigned To</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset: any) => {
                    const cat = CATEGORIES[asset.category] || CATEGORIES.OTHER;
                    const st = STATUSES[asset.status] || STATUSES.AVAILABLE;
                    const cond = CONDITIONS[asset.condition] || CONDITIONS.GOOD;
                    const CatIcon = cat.icon;
                    const activeAssignment = asset.assignments?.find((a: any) => !a.returnedAt);

                    return (
                      <tr key={asset.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center">
                              <CatIcon size={18} className="text-brand-600" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-800">{asset.name}</p>
                              <p className="text-xs font-mono text-gray-400" data-mono>{asset.assetCode}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 hidden md:table-cell">
                          <span className="text-xs text-gray-500">{cat.label}</span>
                        </td>
                        <td className="py-3 px-4 hidden lg:table-cell">
                          <span className="text-xs text-gray-500">{asset.brand || '—'}</span>
                        </td>
                        <td className="py-3 px-4 hidden lg:table-cell">
                          <span className="text-xs font-mono text-gray-400" data-mono>{asset.serialNumber || '—'}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${cond.color}`}>
                            {cond.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${st.color}`}>
                            <st.icon size={12} /> {st.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 hidden md:table-cell">
                          {activeAssignment ? (
                            <span className="text-sm text-gray-700">
                              {activeAssignment.employee?.firstName} {activeAssignment.employee?.lastName}
                            </span>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setViewingAsset(asset)} title="View"
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><Eye size={14} /></button>
                            <button onClick={() => setEditingAsset(asset)} title="Edit"
                              className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={14} /></button>
                            {asset.status === 'AVAILABLE' && (
                              <button onClick={() => setAssigningAsset(asset)} title="Assign"
                                className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg"><UserPlus size={14} /></button>
                            )}
                            {asset.status === 'ASSIGNED' && activeAssignment && (
                              <button onClick={() => setReturningAsset({ asset, assignmentId: activeAssignment.id })} title="Return"
                                className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg"><RotateCcw size={14} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              </div>
              {meta && meta.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400">Page {meta.page} of {meta.totalPages} ({meta.total} total)</p>
                  <div className="flex gap-2">
                    <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                      className="flex items-center gap-1 px-3 py-1 text-xs border rounded-lg disabled:opacity-30"><ChevronLeft size={14} /> Prev</button>
                    <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                      className="flex items-center gap-1 px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Next <ChevronRight size={14} /></button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'Exit Checklists' && <ExitChecklistsTab />}

      {/* Modals */}
      <AnimatePresence>
        {showAddModal && <AddAssetModal onClose={() => setShowAddModal(false)} />}
        {editingAsset && <EditAssetModal asset={editingAsset} onClose={() => setEditingAsset(null)} />}
        {assigningAsset && <AssignAssetModal asset={assigningAsset} onClose={() => setAssigningAsset(null)} />}
        {viewingAsset && <AssetDetailModal asset={viewingAsset} onClose={() => setViewingAsset(null)} />}
        {returningAsset && <ReturnAssetModal data={returningAsset} onClose={() => setReturningAsset(null)} />}
      </AnimatePresence>
    </div>
  );
}

// =================== Exit Checklists Tab ===================
function ExitChecklistsTab() {
  const { data: exitRes, isLoading } = useGetExitRequestsQuery({ page: 1, status: '' });
  const exitRequests = (exitRes?.data || []).filter((e: any) =>
    ['APPROVED', 'NO_DUES_PENDING'].includes(e.exitStatus)
  );

  if (isLoading) return <div className="layer-card p-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto" /></div>;

  if (exitRequests.length === 0) return (
    <div className="layer-card p-16 text-center">
      <ClipboardList size={48} className="mx-auto text-gray-200 mb-4" />
      <h3 className="text-lg font-display font-semibold text-gray-600 mb-1">No pending exit checklists</h3>
      <p className="text-sm text-gray-400">Exit checklists appear when employee resignations are approved</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {exitRequests.map((emp: any) => (
        <ExitChecklistCard key={emp.id} employee={emp} />
      ))}
    </div>
  );
}

function ExitChecklistCard({ employee }: { employee: any }) {
  const { data: checklistRes, isLoading } = useGetExitChecklistQuery(employee.id);
  const [markItem, { isLoading: marking }] = useMarkChecklistItemMutation();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});

  const checklist = checklistRes?.data;
  const items = checklist?.items || [];
  const returned = items.filter((i: any) => i.isReturned).length;
  const total = items.length;
  const allCleared = total > 0 && returned === total;

  const handleToggle = async (itemId: string, isReturned: boolean) => {
    try {
      await markItem({ employeeId: employee.id, itemId, isReturned, notes: itemNotes[itemId] || undefined }).unwrap();
      toast.success(isReturned ? 'Item marked as returned' : 'Item marked as pending');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="layer-card overflow-hidden">
      <div className="p-4 flex items-center justify-between bg-gray-50/50 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-600 font-bold text-sm">
            {employee.firstName?.[0]}{employee.lastName?.[0]}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">{employee.firstName} {employee.lastName}</p>
            <p className="text-xs text-gray-400 font-mono" data-mono>{employee.employeeCode}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(returned / total) * 100}%` }} />
              </div>
              <span className="text-xs font-mono text-gray-500" data-mono>{returned}/{total}</span>
            </div>
          )}
          {allCleared ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              <Unlock size={12} /> Salary Unblocked
            </span>
          ) : total > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700">
              <Lock size={12} /> Salary Blocked
            </span>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center"><Loader2 size={20} className="animate-spin text-gray-300 mx-auto" /></div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">No assets to return</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {items.map((item: any) => (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center',
                    item.isReturned ? 'bg-emerald-50' : 'bg-amber-50')}>
                    {item.isReturned ? <CheckCircle2 size={16} className="text-emerald-600" />
                      : <Package size={16} className="text-amber-600" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.itemName}</p>
                    {item.asset && (
                      <p className="text-xs text-gray-400">{CATEGORIES[item.asset.category]?.label} · {CONDITIONS[item.asset.condition]?.label}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {item.isReturned && item.returnedAt && (
                    <span className="text-[10px] text-gray-400">{new Date(item.returnedAt).toLocaleDateString('en-IN')}</span>
                  )}
                  <button
                    disabled={marking}
                    onClick={() => handleToggle(item.id, !item.isReturned)}
                    className={cn('px-3 py-1 text-xs font-medium rounded-lg transition-all',
                      item.isReturned
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    )}>
                    {marking ? <Loader2 size={12} className="animate-spin" /> : item.isReturned ? 'Returned' : 'Mark Returned'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =================== Return Asset Modal ===================
function ReturnAssetModal({ data, onClose }: { data: { asset: any; assignmentId: string }; onClose: () => void }) {
  const [returnAsset, { isLoading }] = useReturnAssetMutation();
  const [returnCondition, setReturnCondition] = useState('GOOD');
  const [returnNotes, setReturnNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await returnAsset({ assignmentId: data.assignmentId, returnCondition, returnNotes: returnNotes || undefined }).unwrap();
      toast.success('Asset returned!');
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <ModalWrapper onClose={onClose} title="Return Asset">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
            <RotateCcw size={20} className="text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">{data.asset.name}</p>
            <p className="text-xs text-gray-400">{data.asset.assetCode}</p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Return Condition *</label>
          <select value={returnCondition} onChange={e => setReturnCondition(e.target.value)} className="input-glass w-full">
            {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Return Notes</label>
          <textarea value={returnNotes} onChange={e => setReturnNotes(e.target.value)}
            className="input-glass w-full h-16 resize-none" placeholder="Any damage or remarks..." />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {isLoading && <Loader2 size={16} className="animate-spin" />} Confirm Return
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// =================== Add Asset Modal ===================
function AddAssetModal({ onClose }: { onClose: () => void }) {
  const [createAsset, { isLoading }] = useCreateAssetMutation();
  const [form, setForm] = useState({
    name: '', assetCode: '', category: 'LAPTOP', brand: '', modelNumber: '',
    serialNumber: '', condition: 'GOOD', purchaseDate: '', purchaseCost: '',
    warrantyExpiry: '', vendor: '', location: '', notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAsset({
        ...form,
        purchaseCost: form.purchaseCost ? Number(form.purchaseCost) : undefined,
        purchaseDate: form.purchaseDate || undefined,
        warrantyExpiry: form.warrantyExpiry || undefined,
        serialNumber: form.serialNumber || undefined,
        brand: form.brand || undefined,
        modelNumber: form.modelNumber || undefined,
        vendor: form.vendor || undefined,
        location: form.location || undefined,
        notes: form.notes || undefined,
      }).unwrap();
      toast.success('Asset created!');
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <ModalWrapper onClose={onClose} title="Add New Asset">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Asset Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="input-glass w-full" placeholder="e.g. MacBook Pro 14" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Asset Code *</label>
            <input value={form.assetCode} onChange={e => setForm({ ...form, assetCode: e.target.value })}
              className="input-glass w-full" placeholder="e.g. LAP-001" required />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="input-glass w-full">
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Condition</label>
            <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })} className="input-glass w-full">
              {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Serial Number</label>
            <input value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })}
              className="input-glass w-full" placeholder="Optional" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Brand</label>
            <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })}
              className="input-glass w-full" placeholder="e.g. Dell, Apple" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Model Number</label>
            <input value={form.modelNumber} onChange={e => setForm({ ...form, modelNumber: e.target.value })}
              className="input-glass w-full" placeholder="e.g. Latitude 5540" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Vendor</label>
            <input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })}
              className="input-glass w-full" placeholder="e.g. Amazon Business" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Location</label>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
              className="input-glass w-full" placeholder="e.g. Floor 2, Rack A" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Purchase Date</label>
            <input type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} className="input-glass w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Cost (INR)</label>
            <input type="number" value={form.purchaseCost} onChange={e => setForm({ ...form, purchaseCost: e.target.value })} className="input-glass w-full" placeholder="0" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Warranty Expiry</label>
            <input type="date" value={form.warrantyExpiry} onChange={e => setForm({ ...form, warrantyExpiry: e.target.value })} className="input-glass w-full" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            className="input-glass w-full h-16 resize-none" placeholder="Optional notes..." />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {isLoading && <Loader2 size={16} className="animate-spin" />} Create Asset
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// =================== Edit Asset Modal ===================
function EditAssetModal({ asset, onClose }: { asset: any; onClose: () => void }) {
  const [updateAsset, { isLoading }] = useUpdateAssetMutation();
  const [form, setForm] = useState({
    name: asset.name || '', assetCode: asset.assetCode || '', category: asset.category || 'LAPTOP',
    serialNumber: asset.serialNumber || '', status: asset.status || 'AVAILABLE',
    condition: asset.condition || 'GOOD', brand: asset.brand || '', modelNumber: asset.modelNumber || '',
    vendor: asset.vendor || '', location: asset.location || '',
    purchaseDate: asset.purchaseDate ? new Date(asset.purchaseDate).toISOString().split('T')[0] : '',
    purchaseCost: asset.purchaseCost ? String(Number(asset.purchaseCost)) : '',
    warrantyExpiry: asset.warrantyExpiry ? new Date(asset.warrantyExpiry).toISOString().split('T')[0] : '',
    notes: asset.notes || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateAsset({ id: asset.id, data: {
        ...form,
        purchaseCost: form.purchaseCost ? Number(form.purchaseCost) : undefined,
        purchaseDate: form.purchaseDate || undefined,
        warrantyExpiry: form.warrantyExpiry || undefined,
      }}).unwrap();
      toast.success('Asset updated!');
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <ModalWrapper onClose={onClose} title="Edit Asset">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Asset Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-glass w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Asset Code *</label>
            <input value={form.assetCode} onChange={e => setForm({ ...form, assetCode: e.target.value })} className="input-glass w-full" required />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="input-glass w-full">
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Status</label>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="input-glass w-full">
              {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Condition</label>
            <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })} className="input-glass w-full">
              {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Brand</label>
            <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className="input-glass w-full" placeholder="e.g. Dell" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Model Number</label>
            <input value={form.modelNumber} onChange={e => setForm({ ...form, modelNumber: e.target.value })} className="input-glass w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Vendor</label>
            <input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} className="input-glass w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Location</label>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="input-glass w-full" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Purchase Date</label>
            <input type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} className="input-glass w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Cost (INR)</label>
            <input type="number" value={form.purchaseCost} onChange={e => setForm({ ...form, purchaseCost: e.target.value })} className="input-glass w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Warranty Expiry</label>
            <input type="date" value={form.warrantyExpiry} onChange={e => setForm({ ...form, warrantyExpiry: e.target.value })} className="input-glass w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Serial #</label>
            <input value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} className="input-glass w-full" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-glass w-full h-16 resize-none" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {isLoading && <Loader2 size={16} className="animate-spin" />} Save Changes
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// =================== Assign Asset Modal ===================
function AssignAssetModal({ asset, onClose }: { asset: any; onClose: () => void }) {
  const [assignAsset, { isLoading }] = useAssignAssetMutation();
  const { data: employeesRes } = useGetEmployeesQuery({ limit: 200 });
  const [employeeId, setEmployeeId] = useState('');
  const [condition, setCondition] = useState('Good');
  const [notes, setNotes] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const employees = employeesRes?.data || [];
  const employeeList = Array.isArray(employees) ? employees : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) { toast.error('Select an employee'); return; }
    try {
      await assignAsset({ assetId: asset.id, employeeId, condition: condition || undefined, notes: notes || undefined }).unwrap();
      toast.success(`${asset.name} assigned!`);
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const filteredEmployees = employeeList.filter((e: any) =>
    !searchTerm || `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedEmployee = employeeList.find((e: any) => e.id === employeeId);

  const cat = CATEGORIES[asset.category] || CATEGORIES.OTHER;
  const cond = CONDITIONS[asset.condition] || CONDITIONS.GOOD;
  const CatIcon = cat.icon;

  return (
    <ModalWrapper onClose={onClose} title={`Assign ${asset.name}`} wide>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* LEFT: Asset Details */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Asset Details</h3>
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center">
                  <CatIcon size={24} className="text-brand-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{asset.name}</p>
                  <p className="text-xs font-mono text-gray-400" data-mono>{asset.assetCode}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200/60">
                <div>
                  <p className="text-[10px] text-gray-400">Category</p>
                  <p className="text-xs font-medium text-gray-700">{cat.label}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">Serial Number</p>
                  <p className="text-xs font-mono text-gray-700" data-mono>{asset.serialNumber || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">Condition</p>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${cond.color}`}>{cond.label}</span>
                </div>
                {asset.brand && (
                  <div>
                    <p className="text-[10px] text-gray-400">Brand</p>
                    <p className="text-xs font-medium text-gray-700">{asset.brand}</p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Assign Condition</label>
              <select value={condition} onChange={e => setCondition(e.target.value)} className="input-glass w-full text-sm">
                <option value="New">New</option><option value="Good">Good</option>
                <option value="Fair">Fair</option><option value="Poor">Poor</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="input-glass w-full h-16 resize-none text-sm" placeholder="Optional notes..." />
            </div>
          </div>

          {/* RIGHT: Employee Selection + Preview */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Assign To</h3>
            <div>
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search employees..." className="input-glass w-full text-sm mb-2" />
              <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="input-glass w-full text-sm" required>
                <option value="">Select employee...</option>
                {filteredEmployees.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeCode})</option>
                ))}
              </select>
            </div>

            {/* Selected Employee Preview */}
            {selectedEmployee ? (
              <div className="bg-brand-50/50 border border-brand-100 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">
                    {selectedEmployee.firstName?.[0]}{selectedEmployee.lastName?.[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {selectedEmployee.firstName} {selectedEmployee.lastName}
                    </p>
                    <p className="text-xs font-mono text-gray-500" data-mono>{selectedEmployee.employeeCode}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-brand-100/60">
                  {selectedEmployee.designation?.name && (
                    <div>
                      <p className="text-[10px] text-gray-400">Designation</p>
                      <p className="text-xs font-medium text-gray-700">{selectedEmployee.designation.name}</p>
                    </div>
                  )}
                  {selectedEmployee.department?.name && (
                    <div>
                      <p className="text-[10px] text-gray-400">Department</p>
                      <p className="text-xs font-medium text-gray-700">{selectedEmployee.department.name}</p>
                    </div>
                  )}
                  {(selectedEmployee as any).officeLocation?.name && (
                    <div>
                      <p className="text-[10px] text-gray-400">Location</p>
                      <p className="text-xs font-medium text-gray-700">{(selectedEmployee as any).officeLocation.name}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-6 text-center">
                <UserPlus size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">Select an employee to preview</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-5 mt-5 border-t border-gray-100">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={isLoading || !employeeId} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {isLoading && <Loader2 size={16} className="animate-spin" />} Assign Asset
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// =================== Asset Detail Modal ===================
function AssetDetailModal({ asset, onClose }: { asset: any; onClose: () => void }) {
  const { data: historyRes } = useGetAssetAssignmentsQuery(asset.id);
  const assignments = historyRes?.data || [];
  const cat = CATEGORIES[asset.category] || CATEGORIES.OTHER;
  const st = STATUSES[asset.status] || STATUSES.AVAILABLE;
  const cond = CONDITIONS[asset.condition] || CONDITIONS.GOOD;

  return (
    <ModalWrapper onClose={onClose} title="Asset Details" wide>
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Asset', value: asset.name, sub: asset.assetCode },
            { label: 'Status', badge: true, badgeClass: st.color, badgeIcon: st.icon, badgeLabel: st.label },
            { label: 'Category', value: cat.label },
            { label: 'Condition', badge: true, badgeClass: cond.color, badgeLabel: cond.label },
            { label: 'Brand', value: asset.brand },
            { label: 'Model', value: asset.modelNumber },
            { label: 'Serial #', value: asset.serialNumber, mono: true },
            { label: 'Vendor', value: asset.vendor },
            { label: 'Location', value: asset.location },
            asset.purchaseDate && { label: 'Purchase Date', value: new Date(asset.purchaseDate).toLocaleDateString('en-IN') },
            asset.purchaseCost && { label: 'Cost', value: `₹${Number(asset.purchaseCost).toLocaleString('en-IN')}`, mono: true },
            asset.warrantyExpiry && { label: 'Warranty Until', value: new Date(asset.warrantyExpiry).toLocaleDateString('en-IN') },
          ].filter(Boolean).map((item: any, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 mb-1">{item.label}</p>
              {item.badge ? (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${item.badgeClass}`}>
                  {item.badgeIcon && <item.badgeIcon size={12} />} {item.badgeLabel}
                </span>
              ) : (
                <>
                  <p className={cn('text-sm text-gray-700', item.mono && 'font-mono')} data-mono={item.mono || undefined}>
                    {item.value || '—'}
                  </p>
                  {item.sub && <p className="text-xs font-mono text-gray-400 mt-0.5" data-mono>{item.sub}</p>}
                </>
              )}
            </div>
          ))}
        </div>
        {asset.notes && (
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-[10px] text-gray-400 mb-1">Notes</p>
            <p className="text-sm text-gray-600">{asset.notes}</p>
          </div>
        )}
        <div>
          <h4 className="text-sm font-semibold text-gray-800 mb-3">Assignment History</h4>
          {assignments.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No assignment history</p>
          ) : (
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Employee</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Assigned</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Returned</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Return Condition</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a: any) => (
                    <tr key={a.id} className="border-t border-gray-50">
                      <td className="py-2 px-3 text-gray-700 font-medium">
                        {a.employee?.firstName} {a.employee?.lastName}
                        <span className="text-gray-400 ml-1">({a.employee?.employeeCode})</span>
                      </td>
                      <td className="py-2 px-3 text-gray-600">{new Date(a.assignedAt).toLocaleDateString('en-IN')}</td>
                      <td className="py-2 px-3">{a.returnedAt ? (
                        <span className="text-gray-600">{new Date(a.returnedAt).toLocaleDateString('en-IN')}</span>
                      ) : <span className="text-emerald-600 font-medium">Active</span>}</td>
                      <td className="py-2 px-3">
                        {a.returnCondition ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CONDITIONS[a.returnCondition]?.color || ''}`}>
                            {CONDITIONS[a.returnCondition]?.label || a.returnCondition}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 px-3 text-gray-400 max-w-[150px] truncate">{a.returnNotes || a.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalWrapper>
  );
}

// =================== Shared Modal Wrapper ===================
function ModalWrapper({ onClose, title, children, wide }: { onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        className={cn('bg-white rounded-2xl shadow-glass-lg overflow-y-auto', wide ? 'w-full max-w-2xl' : 'w-full max-w-lg')} style={{ maxHeight: 'min(90dvh, calc(100dvh - 2rem))' }}>
        <div className="flex items-center justify-between sticky top-0 bg-white z-10 px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-lg font-display font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}
