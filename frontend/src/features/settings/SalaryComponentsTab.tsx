import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Pencil, Trash2, Loader2, Search, ToggleLeft, ToggleRight,
  DollarSign, TrendingDown, ChevronDown, ChevronUp, Save, X, AlertTriangle,
  Settings2,
} from 'lucide-react';
import {
  useGetComponentsQuery,
  useCreateComponentMutation,
  useUpdateComponentMutation,
  useDeleteComponentMutation,
  useToggleComponentMutation,
} from '../payroll/componentMasterApi';
import { formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

const COMPONENT_TYPES = [
  { value: 'EARNING', label: 'Earning', color: 'text-emerald-600 bg-emerald-50' },
  { value: 'DEDUCTION', label: 'Deduction', color: 'text-red-600 bg-red-50' },
];

const CATEGORIES = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'ALLOWANCE', label: 'Allowance' },
  { value: 'BONUS', label: 'Bonus' },
  { value: 'REIMBURSEMENT', label: 'Reimbursement' },
  { value: 'STATUTORY', label: 'Statutory' },
  { value: 'CUSTOM', label: 'Custom' },
];

const CALC_RULES = [
  { value: 'FIXED', label: 'Fixed Amount' },
  { value: 'PERCENTAGE_CTC', label: '% of CTC' },
  { value: 'PERCENTAGE_BASIC', label: '% of Basic' },
  { value: 'SLAB', label: 'Slab-based' },
];

interface ComponentForm {
  name: string;
  code: string;
  type: string;
  category: string;
  calculationRule: string;
  percentageOf: string;
  defaultValue: string;
  defaultPercentage: string;
  isTaxable: boolean;
  isStatutory: boolean;
  description: string;
}

const emptyForm: ComponentForm = {
  name: '', code: '', type: 'EARNING', category: 'CUSTOM', calculationRule: 'FIXED',
  percentageOf: '', defaultValue: '', defaultPercentage: '', isTaxable: true,
  isStatutory: false, description: '',
};

export default function SalaryComponentsTab() {
  const { data: res, isLoading } = useGetComponentsQuery();
  const [createComp] = useCreateComponentMutation();
  const [updateComp] = useUpdateComponentMutation();
  const [deleteComp] = useDeleteComponentMutation();
  const [toggleComp] = useToggleComponentMutation();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ComponentForm>(emptyForm);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('');
  const [saving, setSaving] = useState(false);

  const components = res?.data || [];

  const filtered = useMemo(() => {
    let list = components;
    if (filterType) list = list.filter((c: any) => c.type === filterType);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter((c: any) => c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term));
    }
    return list;
  }, [components, filterType, searchTerm]);

  const earningCount = components.filter((c: any) => c.type === 'EARNING').length;
  const deductionCount = components.filter((c: any) => c.type === 'DEDUCTION').length;
  const activeCount = components.filter((c: any) => c.isActive).length;

  const handleSave = async () => {
    if (!form.name || !form.code) { toast.error('Name and code are required'); return; }
    setSaving(true);
    try {
      const payload: any = {
        name: form.name,
        code: form.code.toUpperCase(),
        type: form.type,
        category: form.category,
        calculationRule: form.calculationRule,
        percentageOf: form.percentageOf || undefined,
        defaultValue: form.defaultValue ? Number(form.defaultValue) : undefined,
        defaultPercentage: form.defaultPercentage ? Number(form.defaultPercentage) : undefined,
        isTaxable: form.isTaxable,
        isStatutory: form.isStatutory,
        description: form.description || undefined,
      };
      if (editingId) {
        await updateComp({ id: editingId, data: payload }).unwrap();
        toast.success('Component updated');
      } else {
        await createComp(payload).unwrap();
        toast.success('Component created');
      }
      resetForm();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleEdit = (c: any) => {
    setForm({
      name: c.name, code: c.code, type: c.type, category: c.category || 'CUSTOM',
      calculationRule: c.calculationRule || 'FIXED', percentageOf: c.percentageOf || '',
      defaultValue: c.defaultValue ? String(Number(c.defaultValue)) : '',
      defaultPercentage: c.defaultPercentage ? String(Number(c.defaultPercentage)) : '',
      isTaxable: c.isTaxable ?? true, isStatutory: c.isStatutory ?? false,
      description: c.description || '',
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this component?')) return;
    try { await deleteComp(id).unwrap(); toast.success('Deleted'); }
    catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to delete'); }
  };

  const handleToggle = async (id: string) => {
    try { await toggleComp(id).unwrap(); }
    catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const resetForm = () => { setForm(emptyForm); setEditingId(null); setShowForm(false); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Salary Components</h3>
          <p className="text-xs text-gray-500 mt-0.5">Manage your organization's salary component library</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> New Component
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="layer-card p-4 text-center">
          <DollarSign size={16} className="mx-auto text-emerald-500 mb-1" />
          <p className="text-xl font-bold font-mono" data-mono>{earningCount}</p>
          <p className="text-xs text-gray-500">Earnings</p>
        </div>
        <div className="layer-card p-4 text-center">
          <TrendingDown size={16} className="mx-auto text-red-500 mb-1" />
          <p className="text-xl font-bold font-mono" data-mono>{deductionCount}</p>
          <p className="text-xs text-gray-500">Deductions</p>
        </div>
        <div className="layer-card p-4 text-center">
          <Settings2 size={16} className="mx-auto text-brand-500 mb-1" />
          <p className="text-xl font-bold font-mono" data-mono>{activeCount}</p>
          <p className="text-xs text-gray-500">Active</p>
        </div>
      </div>

      {/* Create/Edit Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="layer-card overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700">{editingId ? 'Edit Component' : 'New Salary Component'}</h4>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Name *</label>
                  <input className="input-glass w-full text-sm" placeholder="e.g. Night Premium" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Code *</label>
                  <input className="input-glass w-full text-sm font-mono uppercase" placeholder="e.g. NIGHT_PREMIUM" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Type</label>
                  <select className="input-glass w-full text-sm" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                    {COMPONENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Category</label>
                  <select className="input-glass w-full text-sm" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Calculation</label>
                  <select className="input-glass w-full text-sm" value={form.calculationRule} onChange={e => setForm({ ...form, calculationRule: e.target.value })}>
                    {CALC_RULES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Default Value</label>
                  <input type="number" className="input-glass w-full text-sm font-mono" placeholder="0" value={form.defaultValue} onChange={e => setForm({ ...form, defaultValue: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Default %</label>
                  <input type="number" className="input-glass w-full text-sm font-mono" placeholder="0" value={form.defaultPercentage} onChange={e => setForm({ ...form, defaultPercentage: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Description</label>
                  <input className="input-glass w-full text-sm" placeholder="Optional" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.isTaxable} onChange={e => setForm({ ...form, isTaxable: e.target.checked })} className="rounded border-gray-300" />
                  Taxable
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.isStatutory} onChange={e => setForm({ ...form, isStatutory: e.target.checked })} className="rounded border-gray-300" />
                  Statutory (cannot be deleted)
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} disabled={saving} className="btn-primary text-xs px-4 py-2 flex items-center gap-1">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {editingId ? 'Update' : 'Create'}
                </button>
                <button onClick={resetForm} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search & Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search components..." className="input-glass text-sm py-2 pl-8 pr-3 w-full" />
        </div>
        <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-0.5">
          <button onClick={() => setFilterType('')} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${!filterType ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>All</button>
          <button onClick={() => setFilterType('EARNING')} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${filterType === 'EARNING' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>Earnings</button>
          <button onClick={() => setFilterType('DEDUCTION')} className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${filterType === 'DEDUCTION' ? 'bg-red-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>Deductions</button>
        </div>
      </div>

      {/* Components List */}
      {isLoading ? (
        <div className="text-center py-12"><Loader2 size={20} className="animate-spin text-gray-400 mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 layer-card">
          <DollarSign size={40} className="mx-auto text-gray-200 mb-2" />
          <p className="text-sm text-gray-500">No components found</p>
        </div>
      ) : (
        <div className="data-table">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Component</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Code</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Type</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Calculation</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Default</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase px-4 py-3">Active</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((comp: any) => (
                <tr key={comp.id} className={`border-b border-gray-50 hover:bg-surface-2/50 transition-colors ${!comp.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-800">{comp.name}</p>
                    <p className="text-[10px] text-gray-400">{comp.category} {comp.isTaxable ? '· Taxable' : '· Non-taxable'} {comp.isStatutory ? '· Statutory' : ''}</p>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">{comp.code}</span></td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${comp.type === 'EARNING' ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                      {comp.type === 'EARNING' ? 'Earning' : 'Deduction'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{comp.calculationRule?.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs" data-mono>
                    {comp.defaultPercentage ? `${Number(comp.defaultPercentage)}%` : comp.defaultValue ? formatCurrency(Number(comp.defaultValue)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleToggle(comp.id)} className="text-gray-400 hover:text-gray-600">
                      {comp.isActive ? <ToggleRight size={20} className="text-emerald-500" /> : <ToggleLeft size={20} />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => handleEdit(comp)} className="text-xs text-brand-600 hover:text-brand-700 p-1"><Pencil size={13} /></button>
                      {!comp.isStatutory && (
                        <button onClick={() => handleDelete(comp.id)} className="text-xs text-red-500 hover:text-red-600 p-1"><Trash2 size={13} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
