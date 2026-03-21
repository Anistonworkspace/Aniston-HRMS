import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import { useCreateEmployeeMutation } from './employeeApi';
import { useGetDepartmentsQuery, useGetDesignationsQuery } from './employeeDepsApi';
import toast from 'react-hot-toast';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CreateEmployeeModal({ open, onClose }: Props) {
  const [createEmployee, { isLoading }] = useCreateEmployeeMutation();
  const { data: deptRes } = useGetDepartmentsQuery();
  const { data: desigRes } = useGetDesignationsQuery();
  const departments = deptRes?.data || [];
  const designations = desigRes?.data || [];

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    gender: 'MALE',
    departmentId: '',
    designationId: '',
    workMode: 'OFFICE',
    joiningDate: new Date().toISOString().split('T')[0],
    personalEmail: '',
    dateOfBirth: '',
    ctc: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        ...form,
        departmentId: form.departmentId || undefined,
        designationId: form.designationId || undefined,
        ctc: form.ctc ? Number(form.ctc) : undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        personalEmail: form.personalEmail || undefined,
      };
      const result = await createEmployee(payload).unwrap();
      toast.success(result.message || 'Employee created!');
      setForm({
        firstName: '', lastName: '', email: '', phone: '', gender: 'MALE',
        departmentId: '', designationId: '', workMode: 'OFFICE',
        joiningDate: new Date().toISOString().split('T')[0],
        personalEmail: '', dateOfBirth: '', ctc: '',
      });
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create employee');
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-2xl shadow-glass-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display font-semibold text-gray-800">Add New Employee</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X size={18} className="text-gray-400" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">First Name *</label>
                <input name="firstName" value={form.firstName} onChange={handleChange}
                  className="input-glass w-full" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Last Name *</label>
                <input name="lastName" value={form.lastName} onChange={handleChange}
                  className="input-glass w-full" required />
              </div>
            </div>

            {/* Email & Phone */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Email *</label>
                <input name="email" type="email" value={form.email} onChange={handleChange}
                  className="input-glass w-full" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Phone *</label>
                <input name="phone" value={form.phone} onChange={handleChange}
                  className="input-glass w-full" required />
              </div>
            </div>

            {/* Gender & DOB */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Gender *</label>
                <select name="gender" value={form.gender} onChange={handleChange} className="input-glass w-full">
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Date of Birth</label>
                <input name="dateOfBirth" type="date" value={form.dateOfBirth} onChange={handleChange}
                  className="input-glass w-full" />
              </div>
            </div>

            {/* Department & Designation */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Department</label>
                <select name="departmentId" value={form.departmentId} onChange={handleChange} className="input-glass w-full">
                  <option value="">Select department</option>
                  {departments.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Designation</label>
                <select name="designationId" value={form.designationId} onChange={handleChange} className="input-glass w-full">
                  <option value="">Select designation</option>
                  {designations.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Work Mode & Joining Date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Work Mode</label>
                <select name="workMode" value={form.workMode} onChange={handleChange} className="input-glass w-full">
                  <option value="OFFICE">Office</option>
                  <option value="HYBRID">Hybrid</option>
                  <option value="REMOTE">Remote</option>
                  <option value="FIELD_SALES">Field Sales</option>
                  <option value="PROJECT_SITE">Project Site</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Joining Date *</label>
                <input name="joiningDate" type="date" value={form.joiningDate} onChange={handleChange}
                  className="input-glass w-full" required />
              </div>
            </div>

            {/* CTC */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">CTC (Annual, INR)</label>
              <input name="ctc" type="number" value={form.ctc} onChange={handleChange}
                className="input-glass w-full" placeholder="e.g. 600000" />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-3">
              <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                type="submit" disabled={isLoading}
                className="btn-primary flex-1 flex items-center justify-center gap-2">
                {isLoading && <Loader2 size={16} className="animate-spin" />}
                Add Employee
              </motion.button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
