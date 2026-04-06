import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, FileText, Pencil, Trash2, Users, Lock, Loader2,
  ChevronDown, ChevronUp, Copy, CheckCircle2, AlertTriangle, Search, X,
} from 'lucide-react';
import {
  useGetSalaryTemplatesQuery,
  useCreateSalaryTemplateMutation,
  useUpdateSalaryTemplateMutation,
  useDeleteSalaryTemplateMutation,
  useApplyTemplateMutation,
} from './salaryTemplateApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

const TEMPLATE_TYPES = [
  { value: 'INTERN', label: 'Intern', color: 'text-amber-600 bg-amber-50' },
  { value: 'FULL_TIME', label: 'Full-time', color: 'text-emerald-600 bg-emerald-50' },
  { value: 'CONTRACT', label: 'Contract', color: 'text-blue-600 bg-blue-50' },
  { value: 'CUSTOM', label: 'Custom', color: 'text-purple-600 bg-purple-50' },
];

const LOCKABLE_FIELDS = [
  { key: 'ctc', label: 'CTC' },
  { key: 'basic', label: 'Basic' },
  { key: 'hra', label: 'HRA' },
  { key: 'da', label: 'DA' },
  { key: 'ta', label: 'TA' },
  { key: 'medicalAllowance', label: 'Medical Allowance' },
  { key: 'specialAllowance', label: 'Special Allowance' },
  { key: 'lta', label: 'LTA' },
];

interface TemplateForm {
  name: string;
  type: string;
  description: string;
  ctc: string;
  basic: string;
  hra: string;
  da: string;
  ta: string;
  medicalAllowance: string;
  specialAllowance: string;
  lta: string;
  performanceBonus: string;
  incomeTaxRegime: string;
  lockedFields: string[];
  isDefault: boolean;
}

const emptyForm: TemplateForm = {
  name: '', type: 'FULL_TIME', description: '', ctc: '', basic: '', hra: '',
  da: '', ta: '', medicalAllowance: '', specialAllowance: '', lta: '',
  performanceBonus: '', incomeTaxRegime: 'NEW_REGIME', lockedFields: [], isDefault: false,
};

export default function SalaryTemplatesPage() {
  const { data: res, isLoading } = useGetSalaryTemplatesQuery();
  const [createTemplate] = useCreateSalaryTemplateMutation();
  const [updateTemplate] = useUpdateSalaryTemplateMutation();
  const [deleteTemplate] = useDeleteSalaryTemplateMutation();
  const [applyTemplate] = useApplyTemplateMutation();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showApplyModal, setShowApplyModal] = useState<string | null>(null);
  const [applyForm, setApplyForm] = useState({ selectedEmployees: [] as string[], effectiveFrom: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const templates = res?.data || [];

  const handleSave = async () => {
    if (!form.name || !form.ctc || !form.basic) {
      toast.error('Name, CTC, and Basic are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        type: form.type,
        description: form.description || undefined,
        ctc: Number(form.ctc),
        basic: Number(form.basic),
        hra: Number(form.hra) || 0,
        da: form.da ? Number(form.da) : undefined,
        ta: form.ta ? Number(form.ta) : undefined,
        medicalAllowance: form.medicalAllowance ? Number(form.medicalAllowance) : undefined,
        specialAllowance: form.specialAllowance ? Number(form.specialAllowance) : undefined,
        lta: form.lta ? Number(form.lta) : undefined,
        performanceBonus: form.performanceBonus ? Number(form.performanceBonus) : undefined,
        incomeTaxRegime: form.incomeTaxRegime,
        lockedFields: form.lockedFields.length > 0 ? form.lockedFields : undefined,
        isDefault: form.isDefault,
      };

      if (editingId) {
        await updateTemplate({ id: editingId, data: payload }).unwrap();
        toast.success('Template updated');
      } else {
        await createTemplate(payload).unwrap();
        toast.success('Template created');
      }
      resetForm();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (t: any) => {
    setForm({
      name: t.name,
      type: t.type,
      description: t.description || '',
      ctc: String(Number(t.ctc)),
      basic: String(Number(t.basic)),
      hra: String(Number(t.hra)),
      da: t.da ? String(Number(t.da)) : '',
      ta: t.ta ? String(Number(t.ta)) : '',
      medicalAllowance: t.medicalAllowance ? String(Number(t.medicalAllowance)) : '',
      specialAllowance: t.specialAllowance ? String(Number(t.specialAllowance)) : '',
      lta: t.lta ? String(Number(t.lta)) : '',
      performanceBonus: t.performanceBonus ? String(Number(t.performanceBonus)) : '',
      incomeTaxRegime: t.incomeTaxRegime || 'NEW_REGIME',
      lockedFields: (t.lockedFields as string[]) || [],
      isDefault: t.isDefault,
    });
    setEditingId(t.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this salary template?')) return;
    try {
      await deleteTemplate(id).unwrap();
      toast.success('Template deleted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to delete');
    }
  };

  const handleApply = async () => {
    if (applyForm.selectedEmployees.length === 0 || !applyForm.effectiveFrom || !applyForm.reason) {
      toast.error('Select employees, effective date, and reason');
      return;
    }
    try {
      const result = await applyTemplate({
        templateId: showApplyModal!,
        employeeIds: applyForm.selectedEmployees,
        effectiveFrom: applyForm.effectiveFrom,
        reason: applyForm.reason,
        confirmOverwrite: true,
      }).unwrap();
      toast.success(result.message || `Applied to ${result.data?.applied} employees`);
      setShowApplyModal(null);
      setApplyForm({ selectedEmployees: [], effectiveFrom: '', reason: '' });
    } catch (err: any) {
      const data = err?.data?.data;
      if (data?.requiresConfirmation) {
        toast.error(`${data.employeesWithExistingSalary?.length} employee(s) already have salary structures`);
      } else {
        toast.error(err?.data?.error?.message || 'Failed to apply template');
      }
    }
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const toggleLock = (field: string) => {
    setForm(prev => ({
      ...prev,
      lockedFields: prev.lockedFields.includes(field)
        ? prev.lockedFields.filter(f => f !== field)
        : [...prev.lockedFields, field],
    }));
  };

  const getTypeStyle = (type: string) =>
    TEMPLATE_TYPES.find(t => t.value === type) || TEMPLATE_TYPES[3];

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Salary Templates</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Create reusable salary structures for Intern, Full-time, and Contract employees
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { resetForm(); setShowForm(true); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} /> New Template
        </motion.button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {TEMPLATE_TYPES.map(tt => {
          const count = templates.filter((t: any) => t.type === tt.value).length;
          return (
            <div key={tt.value} className="stat-card">
              <FileText size={20} className={tt.color.split(' ')[0] + ' mb-2'} />
              <p className="text-sm text-gray-500">{tt.label}</p>
              <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{count}</p>
            </div>
          );
        })}
      </div>

      {/* Template Create/Edit Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="layer-card mb-6 overflow-hidden"
          >
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                {editingId ? 'Edit Template' : 'Create Salary Template'}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {/* Row 1: Name, Type, Default */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Template Name *</label>
                  <input
                    className="input-glass w-full"
                    placeholder="e.g. Junior Developer"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Type *</label>
                  <select
                    className="input-glass w-full"
                    value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value })}
                  >
                    {TEMPLATE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isDefault}
                      onChange={e => setForm({ ...form, isDefault: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    Set as default for this type
                  </label>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
                <input
                  className="input-glass w-full"
                  placeholder="Optional description"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                />
              </div>

              {/* Salary components */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-2 block">Salary Components</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { key: 'ctc', label: 'Annual CTC *', required: true },
                    { key: 'basic', label: 'Basic (Monthly) *', required: true },
                    { key: 'hra', label: 'HRA' },
                    { key: 'da', label: 'DA' },
                    { key: 'ta', label: 'TA' },
                    { key: 'medicalAllowance', label: 'Medical' },
                    { key: 'specialAllowance', label: 'Special' },
                    { key: 'lta', label: 'LTA' },
                  ].map(field => (
                    <div key={field.key} className="relative">
                      <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                        {field.label}
                        {form.lockedFields.includes(field.key) && (
                          <Lock size={10} className="text-red-500" />
                        )}
                      </label>
                      <input
                        type="number"
                        className="input-glass w-full font-mono text-sm"
                        placeholder="0"
                        value={form[field.key as keyof TemplateForm] as string}
                        onChange={e => setForm({ ...form, [field.key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Locked fields */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                  <Lock size={12} /> Locked Fields
                  <span className="font-normal text-gray-400 ml-1">(cannot be overridden when applying)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {LOCKABLE_FIELDS.map(f => (
                    <button
                      key={f.key}
                      onClick={() => toggleLock(f.key)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        form.lockedFields.includes(f.key)
                          ? 'border-red-300 bg-red-50 text-red-700'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {form.lockedFields.includes(f.key) && <Lock size={10} className="inline mr-1" />}
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tax regime */}
              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-gray-600">Tax Regime</label>
                <select
                  className="input-glass text-sm"
                  value={form.incomeTaxRegime}
                  onChange={e => setForm({ ...form, incomeTaxRegime: e.target.value })}
                >
                  <option value="NEW_REGIME">New Regime</option>
                  <option value="OLD_REGIME">Old Regime</option>
                </select>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary flex items-center gap-2"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {editingId ? 'Update Template' : 'Create Template'}
                </motion.button>
                <button onClick={resetForm} className="btn-secondary text-sm">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Templates list */}
      {isLoading ? (
        <div className="text-center py-12"><Loader2 size={24} className="animate-spin text-gray-400 mx-auto" /></div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 layer-card">
          <FileText size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">No salary templates yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t: any, index: number) => {
            const typeStyle = getTypeStyle(t.type);
            const isExpanded = expandedId === t.id;
            const locked = (t.lockedFields as string[]) || [];

            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                className="layer-card overflow-hidden"
              >
                {/* Header row */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-surface-2/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${typeStyle.color}`}>
                      {typeStyle.label}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                        {t.name}
                        {t.isDefault && (
                          <span className="text-[10px] bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded-full font-medium">
                            Default
                          </span>
                        )}
                      </p>
                      {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-gray-400">CTC</p>
                      <p className="text-sm font-bold font-mono text-gray-800" data-mono>
                        {formatCurrency(Number(t.ctc))}
                      </p>
                    </div>
                    {locked.length > 0 && (
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <Lock size={12} /> {locked.length}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-gray-100"
                    >
                      <div className="px-5 py-4">
                        {/* Component breakdown */}
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
                          {[
                            { label: 'Basic', val: t.basic },
                            { label: 'HRA', val: t.hra },
                            { label: 'DA', val: t.da },
                            { label: 'TA', val: t.ta },
                            { label: 'Medical', val: t.medicalAllowance },
                            { label: 'Special', val: t.specialAllowance },
                          ].map(c => (
                            <div key={c.label} className="text-center">
                              <p className="text-[10px] text-gray-400 uppercase tracking-wider">{c.label}</p>
                              <p className="text-sm font-mono text-gray-700" data-mono>
                                {c.val ? formatCurrency(Number(c.val)) : '—'}
                              </p>
                              {locked.includes(c.label.toLowerCase()) && (
                                <Lock size={10} className="text-red-400 mx-auto mt-0.5" />
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Locked fields list */}
                        {locked.length > 0 && (
                          <div className="flex items-center gap-2 mb-4 text-xs">
                            <AlertTriangle size={12} className="text-amber-500" />
                            <span className="text-gray-500">Locked:</span>
                            {locked.map((f: string) => (
                              <span key={f} className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-[10px] font-medium">
                                {f}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEdit(t); }}
                            className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                          >
                            <Pencil size={12} /> Edit
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowApplyModal(t.id); }}
                            className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                          >
                            <Users size={12} /> Apply to Employees
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(t.id); toast.success('Template ID copied'); }}
                            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                          >
                            <Copy size={12} /> Copy ID
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                            className="text-xs text-red-500 hover:text-red-600 font-medium flex items-center gap-1 ml-auto"
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Apply Template Modal with Employee Picker */}
      <AnimatePresence>
        {showApplyModal && (
          <ApplyTemplateModal
            templateId={showApplyModal}
            onApply={handleApply}
            applyForm={applyForm}
            setApplyForm={setApplyForm}
            onClose={() => setShowApplyModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ApplyTemplateModal({ templateId, onApply, applyForm, setApplyForm, onClose }: {
  templateId: string;
  onApply: () => void;
  applyForm: { selectedEmployees: string[]; effectiveFrom: string; reason: string };
  setApplyForm: (v: any) => void;
  onClose: () => void;
}) {
  const [empSearch, setEmpSearch] = useState('');
  const { data: empRes } = useGetEmployeesQuery({ limit: 500, status: 'ACTIVE' });
  const employees = empRes?.data || [];

  const filteredEmployees = useMemo(() => {
    if (!empSearch) return employees;
    const term = empSearch.toLowerCase();
    return employees.filter((e: any) =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(term) ||
      e.employeeCode?.toLowerCase().includes(term) ||
      e.department?.name?.toLowerCase().includes(term)
    );
  }, [employees, empSearch]);

  const toggleEmployee = (id: string) => {
    const selected = applyForm.selectedEmployees;
    setApplyForm({
      ...applyForm,
      selectedEmployees: selected.includes(id)
        ? selected.filter((eid: string) => eid !== id)
        : [...selected, id],
    });
  };

  const selectAll = () => {
    const ids = filteredEmployees.map((e: any) => e.id);
    setApplyForm({ ...applyForm, selectedEmployees: ids });
  };

  const clearAll = () => {
    setApplyForm({ ...applyForm, selectedEmployees: [] });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col"
      >
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">Apply Template to Employees</h3>
          <p className="text-xs text-gray-500 mt-1">Select employees to receive this salary structure</p>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Employee search & selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">
                Select Employees * ({applyForm.selectedEmployees.length} selected)
              </label>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-[10px] text-brand-600 font-medium hover:underline">Select All</button>
                <button onClick={clearAll} className="text-[10px] text-gray-500 font-medium hover:underline">Clear</button>
              </div>
            </div>
            <div className="relative mb-2">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                placeholder="Search by name, code, department..."
                className="input-glass text-xs py-2 pl-8 pr-3 w-full"
              />
            </div>

            {/* Selected chips */}
            {applyForm.selectedEmployees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {applyForm.selectedEmployees.slice(0, 10).map((id: string) => {
                  const emp = employees.find((e: any) => e.id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 bg-brand-50 text-brand-700 px-2 py-1 rounded-full text-[10px] font-medium">
                      {emp ? `${emp.employeeCode}` : id.slice(0, 8)}
                      <button onClick={() => toggleEmployee(id)} className="hover:text-red-500"><X size={10} /></button>
                    </span>
                  );
                })}
                {applyForm.selectedEmployees.length > 10 && (
                  <span className="text-[10px] text-gray-500 self-center">+{applyForm.selectedEmployees.length - 10} more</span>
                )}
              </div>
            )}

            {/* Employee list */}
            <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-50">
              {filteredEmployees.length === 0 ? (
                <p className="text-xs text-gray-500 p-3 text-center">No employees found</p>
              ) : (
                filteredEmployees.map((emp: any) => {
                  const isSelected = applyForm.selectedEmployees.includes(emp.id);
                  return (
                    <label
                      key={emp.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2/50 transition-colors ${isSelected ? 'bg-brand-50/50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleEmployee(emp.id)}
                        className="rounded border-gray-300 text-brand-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{emp.firstName} {emp.lastName}</p>
                        <p className="text-[10px] text-gray-500">{emp.employeeCode} · {emp.department?.name || '-'}</p>
                      </div>
                      {emp.ctc && (
                        <span className="text-[10px] font-mono text-gray-400" data-mono>
                          {formatCurrency(Number(emp.ctc))}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Effective From */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Effective From *</label>
            <input
              type="date"
              className="input-glass w-full text-sm"
              value={applyForm.effectiveFrom}
              onChange={e => setApplyForm({ ...applyForm, effectiveFrom: e.target.value })}
            />
          </div>

          {/* Reason */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Reason *</label>
            <input
              className="input-glass w-full text-sm"
              placeholder="e.g. Annual revision, New hire onboarding"
              value={applyForm.reason}
              onChange={e => setApplyForm({ ...applyForm, reason: e.target.value })}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 p-5 border-t border-gray-100">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onApply}
            disabled={applyForm.selectedEmployees.length === 0}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Users size={16} /> Apply to {applyForm.selectedEmployees.length} Employee{applyForm.selectedEmployees.length !== 1 ? 's' : ''}
          </motion.button>
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
