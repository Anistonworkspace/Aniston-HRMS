import { useState, useRef } from 'react';
import { Upload, X, FileSpreadsheet, Download, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useBulkUploadAttendanceMutation } from '../attendanceApi';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ParsedRow {
  employeeCode: string;
  date: string;
  status: string;
  checkIn?: string;
  checkOut?: string;
  workMode?: string;
  remarks?: string;
}

const TEMPLATE_HEADERS = ['Employee Code', 'Date (YYYY-MM-DD)', 'Status (PRESENT/ABSENT/HALF_DAY/ON_LEAVE/WFH)', 'Check In (HH:MM)', 'Check Out (HH:MM)', 'Work Mode (OFFICE/FIELD/WFH)', 'Remarks'];

export default function BulkUploadModal({ isOpen, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [upload, { isLoading }] = useBulkUploadAttendanceMutation();
  const [result, setResult] = useState<any>(null);

  if (!isOpen) return null;

  const downloadTemplate = () => {
    const csv = TEMPLATE_HEADERS.join(',') + '\nEMP-002,2026-04-07,PRESENT,09:00,18:00,OFFICE,\nEMP-003,2026-04-07,HALF_DAY,09:00,13:00,OFFICE,Left early\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'attendance-upload-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const parseCSV = (text: string): ParsedRow[] => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const parsed: ParsedRow[] = [];
    const errs: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < 3) { errs.push(`Row ${i}: not enough columns`); continue; }
      const [employeeCode, date, status, checkIn, checkOut, workMode, remarks] = cols;
      if (!employeeCode) { errs.push(`Row ${i}: missing employee code`); continue; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errs.push(`Row ${i}: invalid date format (use YYYY-MM-DD)`); continue; }
      if (!['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'WFH', 'WORK_FROM_HOME', 'LATE'].includes(status?.toUpperCase())) {
        errs.push(`Row ${i}: invalid status "${status}"`); continue;
      }
      parsed.push({ employeeCode, date, status: status.toUpperCase(), checkIn, checkOut, workMode: workMode?.toUpperCase(), remarks });
    }
    setErrors(errs);
    return parsed;
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setRows(parsed);
    };
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (rows.length === 0) { toast.error('No valid rows to upload'); return; }
    try {
      const res = await upload({ rows }).unwrap();
      setResult(res.data);
      toast.success(`Uploaded ${res.data?.processed || rows.length} records`);
    } catch (e: any) {
      toast.error(e?.data?.error?.message || 'Upload failed');
    }
  };

  const reset = () => {
    setRows([]); setFileName(''); setErrors([]); setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
              <Upload size={20} className="text-brand-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-gray-900">Bulk Upload Attendance</h3>
              <p className="text-xs text-gray-400">Import CSV to create or correct attendance records</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-400" /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Template Download */}
          <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl p-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-blue-500" />
              <span className="text-sm text-blue-700">Download the CSV template first</span>
            </div>
            <button onClick={downloadTemplate} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800">
              <Download size={14} /> Template
            </button>
          </div>

          {/* File Input */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 hover:border-brand-300 rounded-xl p-6 text-center cursor-pointer transition-colors"
          >
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
            {fileName ? (
              <div className="flex items-center justify-center gap-2">
                <FileSpreadsheet size={20} className="text-brand-500" />
                <span className="text-sm font-medium text-gray-700">{fileName}</span>
                <span className="text-xs text-gray-400">({rows.length} valid rows)</span>
                <button onClick={(e) => { e.stopPropagation(); reset(); }} className="ml-2 text-gray-400 hover:text-red-500">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <Upload size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">Click to upload CSV file</p>
                <p className="text-xs text-gray-400 mt-1">Supported: .csv — max 500 rows</p>
              </>
            )}
          </div>

          {/* Parse Errors */}
          {errors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 max-h-32 overflow-y-auto">
              <p className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1"><AlertTriangle size={12} /> {errors.length} warning(s):</p>
              {errors.map((err, i) => <p key={i} className="text-xs text-amber-600">{err}</p>)}
            </div>
          )}

          {/* Preview Table */}
          {rows.length > 0 && !result && (
            <div className="overflow-x-auto rounded-xl border border-gray-200 max-h-52">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Code</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Date</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Status</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">In</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Out</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Mode</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-2 py-1.5 font-mono text-gray-700">{r.employeeCode}</td>
                      <td className="px-2 py-1.5 text-gray-600">{r.date}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          r.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700' :
                          r.status === 'ABSENT' ? 'bg-red-100 text-red-600' :
                          r.status === 'HALF_DAY' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{r.status}</span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-500">{r.checkIn || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.checkOut || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.workMode || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-400">{r.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 50 && <p className="text-xs text-gray-400 text-center py-2">Showing first 50 of {rows.length} rows</p>}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <CheckCircle size={32} className="mx-auto text-emerald-500 mb-2" />
              <p className="font-semibold text-emerald-800">Upload Complete</p>
              <p className="text-sm text-emerald-600 mt-1">
                {result.processed || rows.length} records processed
                {result.created > 0 && ` · ${result.created} created`}
                {result.updated > 0 && ` · ${result.updated} updated`}
                {result.skipped > 0 && ` · ${result.skipped} skipped`}
              </p>
              {result.errors?.length > 0 && (
                <div className="mt-2 text-left max-h-24 overflow-y-auto">
                  {result.errors.map((e: string, i: number) => <p key={i} className="text-xs text-red-500">{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Cancel</button>
          {!result ? (
            <button onClick={handleUpload} disabled={rows.length === 0 || isLoading}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold">
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              Upload {rows.length} Records
            </button>
          ) : (
            <button onClick={() => { reset(); onClose(); }}
              className="px-5 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
