import { useState, useRef } from 'react';
import { useAppSelector } from '../../app/store';
import { Database, Download, Trash2, RotateCcw, Plus, Upload, Clock, CheckCircle2, AlertTriangle, Loader2, RefreshCw, HardDrive, Calendar, FileArchive, Shield } from 'lucide-react';
import { useListBackupsQuery, useCreateBackupMutation, useDeleteBackupMutation, useRestoreBackupMutation, type DatabaseBackup } from './settingsApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: string | null): string {
  if (!bytes) return '—';
  const n = Number(bytes);
  if (n === 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function backupAge(createdAt: string): string {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1-day backup';
  return `${diffDays}-day backup`;
}

function StatusBadge({ status }: { status: DatabaseBackup['status'] }) {
  const map: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
    COMPLETED: { label: 'Completed', cls: 'bg-green-100 text-green-700', icon: CheckCircle2 },
    IN_PROGRESS: { label: 'In Progress', cls: 'bg-blue-100 text-blue-700', icon: Loader2 },
    PENDING: { label: 'Pending', cls: 'bg-yellow-100 text-yellow-700', icon: Clock },
    FAILED: { label: 'Failed', cls: 'bg-red-100 text-red-700', icon: AlertTriangle },
    DELETED: { label: 'Deleted', cls: 'bg-gray-100 text-gray-500', icon: Trash2 },
  };
  const { label, cls, icon: Icon } = map[status] ?? map.PENDING;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cls)}>
      <Icon size={11} className={status === 'IN_PROGRESS' ? 'animate-spin' : ''} />
      {label}
    </span>
  );
}

// ─── Confirmation Modal ───────────────────────────────────────────────────────

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  confirmCls?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function ConfirmModal({ title, message, confirmLabel, confirmCls = 'btn-primary', onConfirm, onCancel, isLoading }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 border border-gray-100">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-red-50 rounded-lg flex-shrink-0">
            <AlertTriangle className="text-red-500" size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-600 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={cn('px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2', confirmCls)}
          >
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DatabaseBackupTab() {
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, refetch } = useListBackupsQuery({ page });
  const [createBackup, { isLoading: creating }] = useCreateBackupMutation();
  const [deleteBackup, { isLoading: deleting }] = useDeleteBackupMutation();
  const [restoreBackup, { isLoading: restoring }] = useRestoreBackupMutation();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRestore, setUploadingRestore] = useState(false);

  // Modal state
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<DatabaseBackup | null>(null);
  const [confirmRestoreUpload, setConfirmRestoreUpload] = useState<File | null>(null);

  const backups = data?.backups ?? [];
  const stats = data?.stats;
  const meta = data?.meta;

  // ── Handlers ──

  const handleCreateBackup = async () => {
    setConfirmCreate(false);
    try {
      await createBackup().unwrap();
      toast.success('Backup created successfully');
    } catch (err: any) {
      toast.error(err?.data?.error?.message ?? 'Backup failed');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDelete(null);
    try {
      await deleteBackup(id).unwrap();
      toast.success('Backup deleted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message ?? 'Delete failed');
    }
  };

  const handleRestore = async (backup: DatabaseBackup) => {
    setConfirmRestore(null);
    try {
      await restoreBackup(backup.id).unwrap();
      toast.success('Database restored successfully. Please refresh the application.');
    } catch (err: any) {
      toast.error(err?.data?.error?.message ?? 'Restore failed');
    }
  };

  const handleDownload = (backup: DatabaseBackup) => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
    const url = `${apiUrl}/settings/backup/${backup.id}/download`;

    toast.promise(
      fetch(url, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: 'include',
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('Download failed');
          const blob = await res.blob();
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = backup.filename;
          link.click();
          URL.revokeObjectURL(link.href);
        }),
      { loading: 'Preparing download...', success: 'Download started', error: (e) => e.message }
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setConfirmRestoreUpload(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleRestoreFromUpload = async (file: File) => {
    setConfirmRestoreUpload(null);
    setUploadingRestore(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
      const formData = new FormData();
      formData.append('backup', file);

      const res = await fetch(`${apiUrl}/settings/backup/restore/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message ?? 'Restore failed');
      }
      toast.success('Database restored from uploaded file. Please refresh the application.');
      refetch();
    } catch (err: any) {
      toast.error(err.message ?? 'Restore failed');
    } finally {
      setUploadingRestore(false);
    }
  };

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <Database className="text-indigo-600" size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Database Backup</h2>
            <p className="text-sm text-gray-500">Automated backups every 2 days · Super Admin only</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingRestore || restoring}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
          >
            {uploadingRestore ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Restore from File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gz,.sql"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => setConfirmCreate(true)}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create Backup Now
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="layer-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={15} className="text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Last Backup</span>
          </div>
          <p className="text-sm font-semibold text-gray-800">{formatDate(stats?.lastBackupAt ?? null)}</p>
        </div>
        <div className="layer-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar size={15} className="text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Next Scheduled</span>
          </div>
          <p className="text-sm font-semibold text-gray-800">{formatDate(stats?.nextScheduledAt ?? null)}</p>
        </div>
        <div className="layer-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileArchive size={15} className="text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Total Backups</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats?.totalBackups ?? 0}</p>
        </div>
        <div className="layer-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive size={15} className="text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Latest Size</span>
          </div>
          <p className="text-sm font-semibold text-gray-800">{formatBytes(stats?.lastBackupSize ?? null)}</p>
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <Shield size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <span className="font-semibold">Restore Warning: </span>
          Restoring a backup will overwrite all current database data. This action cannot be undone. Only perform a restore during planned maintenance windows.
        </div>
      </div>

      {/* Backup History Table */}
      <div className="layer-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Backup History</h3>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-gray-300" size={32} />
          </div>
        ) : backups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Database className="text-gray-200" size={40} />
            <p className="text-gray-500 mt-3 text-sm">No backups yet</p>
            <p className="text-gray-400 text-xs mt-1">Backups run automatically every 2 days, or create one manually</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Filename</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Created</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Size</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {backups.map((backup, idx) => (
                  <tr key={backup.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <FileArchive size={14} className="text-indigo-400 flex-shrink-0" />
                        <div>
                          <p className="font-mono text-xs text-gray-800 truncate max-w-[220px]">{backup.filename}</p>
                          <div className="flex gap-1 mt-0.5">
                            <span className="text-[10px] text-gray-400">{backupAge(backup.createdAt)}</span>
                            {idx === 0 && (
                              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded-full font-medium">latest</span>
                            )}
                            {idx === 1 && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 rounded-full font-medium">previous</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{formatDate(backup.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 font-mono">{formatBytes(backup.sizeBytes)}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
                        backup.type === 'MANUAL'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-sky-100 text-sky-700'
                      )}>
                        {backup.type === 'MANUAL' ? <Plus size={9} /> : <Clock size={9} />}
                        {backup.type === 'MANUAL' ? 'Manual' : 'Scheduled'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={backup.status} />
                      {backup.notes && (
                        <p className="text-[10px] text-red-500 mt-0.5 max-w-[140px] truncate">{backup.notes}</p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {backup.status === 'COMPLETED' && (
                          <>
                            <button
                              onClick={() => handleDownload(backup)}
                              title="Download"
                              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            >
                              <Download size={14} />
                            </button>
                            <button
                              onClick={() => setConfirmRestore(backup)}
                              disabled={restoring}
                              title="Restore from this backup"
                              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                            >
                              <RotateCcw size={14} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setConfirmDelete(backup.id)}
                          disabled={deleting}
                          title="Delete backup"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  Showing {((page - 1) * (meta.limit ?? 20)) + 1}–{Math.min(page * (meta.limit ?? 20), meta.total)} of {meta.total}
                </p>
                <div className="flex gap-1">
                  <button
                    disabled={!meta.hasPrev}
                    onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <button
                    disabled={!meta.hasNext}
                    onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Retention note */}
      <div className="text-xs text-gray-400 text-center">
        Scheduled backups retain the latest 15 copies. Older backups are automatically purged. You can delete individual backups manually at any time.
      </div>

      {/* ── Confirmation Modals ── */}

      {confirmCreate && (
        <ConfirmModal
          title="Create Database Backup"
          message="This will create a full compressed backup of the database. The process runs in the background and may take a minute for large databases."
          confirmLabel="Create Backup"
          confirmCls="bg-indigo-600 hover:bg-indigo-700 text-white"
          onConfirm={handleCreateBackup}
          onCancel={() => setConfirmCreate(false)}
          isLoading={creating}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Backup"
          message="This will permanently delete the backup file from disk and remove it from history. This action cannot be undone."
          confirmLabel="Delete Permanently"
          confirmCls="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          isLoading={deleting}
        />
      )}

      {confirmRestore && (
        <ConfirmModal
          title="Restore Database"
          message={`This will overwrite ALL current database data with the backup from ${formatDate(confirmRestore.createdAt)} (${formatBytes(confirmRestore.sizeBytes)}). This action CANNOT be undone. Perform this only during a planned maintenance window.`}
          confirmLabel="Yes, Restore Now"
          confirmCls="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => handleRestore(confirmRestore)}
          onCancel={() => setConfirmRestore(null)}
          isLoading={restoring}
        />
      )}

      {confirmRestoreUpload && (
        <ConfirmModal
          title="Restore from Uploaded File"
          message={`You are about to restore the database from "${confirmRestoreUpload.name}" (${formatBytes(String(confirmRestoreUpload.size))}). This will OVERWRITE ALL current data. This action cannot be undone.`}
          confirmLabel="Yes, Restore from File"
          confirmCls="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => handleRestoreFromUpload(confirmRestoreUpload)}
          onCancel={() => setConfirmRestoreUpload(null)}
          isLoading={uploadingRestore}
        />
      )}
    </div>
  );
}
