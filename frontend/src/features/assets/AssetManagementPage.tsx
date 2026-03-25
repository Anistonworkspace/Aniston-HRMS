import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor, Plus, Search, Laptop, Smartphone, CreditCard, Eye, Pencil, UserPlus,
  RotateCcw, X, Loader2, CheckCircle2, Package, Wrench, Archive,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  useGetAssetsQuery, useCreateAssetMutation, useUpdateAssetMutation,
  useAssignAssetMutation, useReturnAssetMutation, useGetAssetAssignmentsQuery,
} from './assetApi';
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

export default function AssetManagementPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any>(null);
  const [assigningAsset, setAssigningAsset] = useState<any>(null);
  const [viewingAsset, setViewingAsset] = useState<any>(null);

  const { data: res, isLoading } = useGetAssetsQuery({
    page, limit: 20,
    search: search || undefined,
    category: categoryFilter || undefined,
    status: statusFilter || undefined,
  });
  const [returnAsset] = useReturnAssetMutation();

  const assets = res?.data || [];
  const meta = res?.meta;

  const handleReturn = async (assignmentId: string) => {
    if (!confirm('Mark this asset as returned?')) return;
    try {
      await returnAsset(assignmentId).unwrap();
      toast.success('Asset returned!');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

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
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Asset</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Category</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Serial #</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">Status</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Assigned To</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset: any) => {
                const cat = CATEGORIES[asset.category] || CATEGORIES.OTHER;
                const st = STATUSES[asset.status] || STATUSES.AVAILABLE;
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
                      <span className="text-xs font-mono text-gray-400" data-mono>{asset.serialNumber || '—'}</span>
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
                          <button onClick={() => handleReturn(activeAssignment.id)} title="Return"
                            className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg"><RotateCcw size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

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

      {/* Modals */}
      <AnimatePresence>
        {showAddModal && <AddAssetModal onClose={() => setShowAddModal(false)} />}
        {editingAsset && <EditAssetModal asset={editingAsset} onClose={() => setEditingAsset(null)} />}
        {assigningAsset && <AssignAssetModal asset={assigningAsset} onClose={() => setAssigningAsset(null)} />}
        {viewingAsset && <AssetDetailModal asset={viewingAsset} onClose={() => setViewingAsset(null)} />}
      </AnimatePresence>
    </div>
  );
}

// =================== Add Asset Modal ===================
function AddAssetModal({ onClose }: { onClose: () => void }) {
  const [createAsset, { isLoading }] = useCreateAssetMutation();
  const [form, setForm] = useState({
    name: '', assetCode: '', category: 'LAPTOP', serialNumber: '', purchaseDate: '', purchaseCost: '', notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAsset({
        ...form,
        purchaseCost: form.purchaseCost ? Number(form.purchaseCost) : undefined,
        purchaseDate: form.purchaseDate || undefined,
        serialNumber: form.serialNumber || undefined,
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="input-glass w-full">
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
            <label className="block text-sm font-medium text-gray-600 mb-1">Purchase Date</label>
            <input type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })}
              className="input-glass w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Purchase Cost (INR)</label>
            <input type="number" value={form.purchaseCost} onChange={e => setForm({ ...form, purchaseCost: e.target.value })}
              className="input-glass w-full" placeholder="0" />
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
    purchaseDate: asset.purchaseDate ? new Date(asset.purchaseDate).toISOString().split('T')[0] : '',
    purchaseCost: asset.purchaseCost ? String(Number(asset.purchaseCost)) : '', notes: asset.notes || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateAsset({ id: asset.id, data: {
        ...form,
        purchaseCost: form.purchaseCost ? Number(form.purchaseCost) : undefined,
        purchaseDate: form.purchaseDate || undefined,
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
            <label className="block text-sm font-medium text-gray-600 mb-1">Serial #</label>
            <input value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} className="input-glass w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Purchase Date</label>
            <input type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} className="input-glass w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Cost (INR)</label>
            <input type="number" value={form.purchaseCost} onChange={e => setForm({ ...form, purchaseCost: e.target.value })} className="input-glass w-full" />
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
  const [employeeId, setEmployeeId] = useState('');
  const [condition, setCondition] = useState('Good');
  const [notes, setNotes] = useState('');
  const [employees, setEmployees] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch employees for dropdown
  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
    fetch(`${API_URL}/employees?limit=200`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    }).then(r => r.json()).then(d => setEmployees(d.data || [])).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) { toast.error('Select an employee'); return; }
    try {
      await assignAsset({ assetId: asset.id, employeeId, condition: condition || undefined, notes: notes || undefined }).unwrap();
      toast.success(`${asset.name} assigned!`);
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const filteredEmployees = employees.filter((e: any) =>
    !searchTerm || `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <ModalWrapper onClose={onClose} title={`Assign ${asset.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
            <Monitor size={20} className="text-brand-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">{asset.name}</p>
            <p className="text-xs text-gray-400">{asset.assetCode} · {CATEGORIES[asset.category]?.label}</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Assign to Employee *</label>
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search employees..." className="input-glass w-full text-sm mb-2" />
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="input-glass w-full" required>
            <option value="">Select employee...</option>
            {filteredEmployees.map((emp: any) => (
              <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeCode})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Condition</label>
          <select value={condition} onChange={e => setCondition(e.target.value)} className="input-glass w-full">
            <option value="New">New</option>
            <option value="Good">Good</option>
            <option value="Fair">Fair</option>
            <option value="Poor">Poor</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            className="input-glass w-full h-16 resize-none" placeholder="Optional notes..." />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
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

  return (
    <ModalWrapper onClose={onClose} title="Asset Details" wide>
      <div className="space-y-5">
        {/* Asset Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Asset</p>
            <p className="text-sm font-semibold text-gray-800">{asset.name}</p>
            <p className="text-xs font-mono text-gray-400 mt-0.5" data-mono>{asset.assetCode}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Status</p>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${st.color}`}>
              <st.icon size={12} /> {st.label}
            </span>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Category</p>
            <p className="text-sm text-gray-700">{cat.label}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Serial Number</p>
            <p className="text-sm font-mono text-gray-700" data-mono>{asset.serialNumber || '—'}</p>
          </div>
          {asset.purchaseDate && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Purchase Date</p>
              <p className="text-sm text-gray-700">{new Date(asset.purchaseDate).toLocaleDateString('en-IN')}</p>
            </div>
          )}
          {asset.purchaseCost && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Purchase Cost</p>
              <p className="text-sm font-mono text-gray-700" data-mono>₹{Number(asset.purchaseCost).toLocaleString('en-IN')}</p>
            </div>
          )}
        </div>
        {asset.notes && (
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Notes</p>
            <p className="text-sm text-gray-600">{asset.notes}</p>
          </div>
        )}

        {/* Assignment History */}
        <div>
          <h4 className="text-sm font-semibold text-gray-800 mb-3">Assignment History</h4>
          {assignments.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No assignment history</p>
          ) : (
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Employee</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Assigned</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Returned</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Condition</th>
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
                      <td className="py-2 px-3 text-gray-500">{a.condition || '—'}</td>
                      <td className="py-2 px-3 text-gray-400 max-w-[150px] truncate">{a.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
        className={cn('bg-white rounded-2xl shadow-glass-lg p-6 max-h-[90vh] overflow-y-auto', wide ? 'w-full max-w-2xl' : 'w-full max-w-lg')}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-400" /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
