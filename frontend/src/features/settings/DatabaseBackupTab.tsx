import { useState, useRef } from 'react';
import { useAppSelector } from '../../app/store';
import {
  Database, Download, Trash2, RotateCcw, Plus, Upload, Clock, CheckCircle2,
  AlertTriangle, Loader2, RefreshCw, HardDrive, Calendar, FileArchive, Shield,
  FolderOpen, AlertCircle, CheckCheck, Info,
} from 'lucide-react';
import {
  useCheckBackupAvailabilityQuery,
  useListBackupsQuery,
  useCreateBackupMutation,
  useDeleteBackupMutation,
  useRestoreBackupMutation,
  useRestoreFilesBackupMutation,
  type DatabaseBackup,
  type BackupCategory,
} from './settingsApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: string | bigint | null | undefined): string {
  if (bytes == null) return '—';
  const n = Number(bytes);
  if (isNaN(n) || n === 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function backupAge(createdAt: string): string {
  const diffDays = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

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
  danger?: boolean;
}

function ConfirmModal({ title, message, confirmLabel, confirmCls = 'btn-primary', onConfirm, onCancel, isLoading, danger = false }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 border border-gray-100">
        <div className="flex items-start gap-3 mb-4">
          <div className={cn('p-2 rounded-lg flex-shrink-0', danger ? 'bg-red-50' : 'bg-amber-50')}>
            <AlertTriangle className={danger ? 'text-red-500' : 'text-amber-500'} size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-600 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onCancel} disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isLoading}
            className={cn('px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2', confirmCls)}>
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Backup History Table ─────────────────────────────────────────────────────

interface BackupTableProps {
  category: BackupCategory;
  accessToken: string | null;
  onRestoreDb: (b: DatabaseBackup) => void;
  onRestoreFiles: (b: DatabaseBackup) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
  restoringId: string | null;
}

function BackupTable({ category, accessToken, onRestoreDb, onRestoreFiles, onDelete, deletingId, restoringId }: BackupTableProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useListBackupsQuery({ page, category });

  const backups = data?.backups ?? [];
  const meta = data?.meta;

  const handleDownload = (backup: DatabaseBackup) => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
    const url = `${apiUrl}/settings/backup/${backup.id}/download`;
    toast.promise(
      fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) throw new Error('Download failed');
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = backup.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
        }),
      { loading: 'Preparing download...', success: 'Download started', error: (e) => e.message }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-gray-300" size={28} />
      </div>
    );
  }

  if (backups.length === 0) {
    const Icon = category === 'DATABASE' ? Database : FolderOpen;
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Icon className="text-gray-200" size={36} />
        <p className="text-gray-500 mt-3 text-sm">No {category === 'DATABASE' ? 'database' : 'files'} backups yet</p>
        <p className="text-gray-400 text-xs mt-1">Create one manually or wait for the weekly scheduled backup</p>
      </div>
    );
  }

  return (
    <div>
      {isFetching && (
        <div className="flex justify-end px-4 py-1 border-b border-gray-50">
          <Loader2 size={12} className="animate-spin text-gray-300" />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Filename</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Created</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Size</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Trigger</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {backups.map((backup, idx) => (
              <tr key={backup.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <FileArchive size={14} className={cn('flex-shrink-0', category === 'DATABASE' ? 'text-indigo-400' : 'text-teal-400')} />
                    <div>
                      <p className="font-mono text-xs text-gray-800 truncate max-w-[200px]">{backup.filename}</p>
                      <div className="flex gap-1 mt-0.5">
                        <span className="text-[10px] text-gray-400">{backupAge(backup.createdAt)}</span>
                        {idx === 0 && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded-full font-medium">latest</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{formatDate(backup.createdAt)}</td>
                <td className="px-4 py-3 text-xs text-gray-600 font-mono">{formatBytes(backup.sizeBytes)}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
                    backup.type === 'MANUAL' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'
                  )}>
                    {backup.type === 'MANUAL' ? <Plus size={9} /> : <Clock size={9} />}
                    {backup.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={backup.status} />
                  {backup.notes && backup.status === 'FAILED' && (
                    <p className="text-[10px] text-red-500 mt-0.5 max-w-[140px] truncate" title={backup.notes}>{backup.notes}</p>
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    {backup.status === 'COMPLETED' && (
                      <>
                        <button onClick={() => handleDownload(backup)} title="Download"
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => category === 'DATABASE' ? onRestoreDb(backup) : onRestoreFiles(backup)}
                          disabled={restoringId === backup.id}
                          title={`Restore ${category === 'DATABASE' ? 'database' : 'files'} from this backup`}
                          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50">
                          {restoringId === backup.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                        </button>
                      </>
                    )}
                    <button onClick={() => onDelete(backup.id)} disabled={deletingId === backup.id} title="Delete"
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                      {deletingId === backup.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Showing {((page - 1) * (meta.limit ?? 20)) + 1}–{Math.min(page * (meta.limit ?? 20), meta.total)} of {meta.total}
            </p>
            <div className="flex gap-1">
              <button disabled={!meta.hasPrev} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
              <button disabled={!meta.hasNext} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DatabaseBackupTab() {
  const accessToken = useAppSelector((s) => s.auth.accessToken);

  // Data
  const { data: listData, refetch } = useListBackupsQuery({ page: 1 });
  const { data: availData, isFetching: checkingAvail } = useCheckBackupAvailabilityQuery();
  const stats = listData?.stats;
  const avail = availData?.data;

  // Mutations
  const [createBackup] = useCreateBackupMutation();
  const [creatingDb, setCreatingDb] = useState(false);
  const [creatingFiles, setCreatingFiles] = useState(false);
  const [deleteBackup] = useDeleteBackupMutation();
  const [restoreBackup, { isLoading: restoringDb }] = useRestoreBackupMutation();
  const [restoreFilesBackup, { isLoading: restoringFiles }] = useRestoreFilesBackupMutation();

  // Upload state
  const dbFileInputRef = useRef<HTMLInputElement>(null);
  const filesFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDbRestore, setUploadingDbRestore] = useState(false);
  const [uploadingFilesRestore, setUploadingFilesRestore] = useState(false);

  // Confirm modals
  const [confirmCreate, setConfirmCreate] = useState<BackupCategory | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRestoreDb, setConfirmRestoreDb] = useState<DatabaseBackup | null>(null);
  const [confirmRestoreFiles, setConfirmRestoreFiles] = useState<DatabaseBackup | null>(null);
  const [confirmUploadDb, setConfirmUploadDb] = useState<File | null>(null);
  const [confirmUploadFiles, setConfirmUploadFiles] = useState<File | null>(null);

  // Track which item is being acted on (for per-row loading indicators)
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreate = async (category: BackupCategory) => {
    setConfirmCreate(null);
    if (category === 'DATABASE') setCreatingDb(true);
    else setCreatingFiles(true);
    try {
      await createBackup({ category }).unwrap();
      toast.success(`${category === 'FILES' ? 'Files' : 'Database'} backup created successfully`);
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message ?? 'Backup failed');
    } finally {
      if (category === 'DATABASE') setCreatingDb(false);
      else setCreatingFiles(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDelete(null);
    setDeletingId(id);
    try {
      await deleteBackup(id).unwrap();
      toast.success('Backup deleted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message ?? 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestoreDb = async (backup: DatabaseBackup) => {
    setConfirmRestoreDb(null);
    setRestoringId(backup.id);
    try {
      await restoreBackup(backup.id).unwrap();
      toast.success('Database restored. Please refresh the application.');
    } catch (err: any) {
      toast.error(err?.data?.error?.message ?? 'Restore failed');
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreFiles = async (backup: DatabaseBackup) => {
    setConfirmRestoreFiles(null);
    setRestoringId(backup.id);
    try {
      await restoreFilesBackup(backup.id).unwrap();
      toast.success('Uploaded files restored successfully.');
    } catch (err: any) {
      toast.error(err?.data?.error?.message ?? 'Restore failed');
    } finally {
      setRestoringId(null);
    }
  };

  const handleUploadRestore = async (file: File, category: BackupCategory) => {
    if (category === 'DATABASE') setConfirmUploadDb(null);
    else setConfirmUploadFiles(null);

    const setSending = category === 'DATABASE' ? setUploadingDbRestore : setUploadingFilesRestore;
    setSending(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
      const endpoint = category === 'DATABASE'
        ? `${apiUrl}/settings/backup/restore/upload`
        : `${apiUrl}/settings/backup/restore-files/upload`;

      const formData = new FormData();
      formData.append('backup', file);

      const res = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json?.error?.message ?? 'Restore failed');

      toast.success(category === 'DATABASE'
        ? 'Database restored from uploaded file. Please refresh.'
        : 'Uploaded files restored from archive.');
      refetch();
    } catch (err: any) {
      toast.error(err.message ?? 'Restore failed');
    } finally {
      setSending(false);
    }
  };

  // ── Availability Banner ───────────────────────────────────────────────────

  const pgDumpMissing = avail && !avail.pgDump.available;
  const psqlMissing = avail && !avail.psql.available;
  const anyDbToolMissing = pgDumpMissing || psqlMissing;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <Database className="text-indigo-600" size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Backup & Recovery</h2>
            <p className="text-sm text-gray-500">Automated daily backups at 02:00 UTC · Super Admin only</p>
          </div>
        </div>
        <button onClick={() => refetch()} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* ── pg_dump Availability Notice ── */}
      {checkingAvail && (
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
          <Loader2 size={13} className="animate-spin" /> Checking pg_dump availability...
        </div>
      )}
      {anyDbToolMissing && (
        <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200 rounded-xl">
          <AlertCircle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-orange-800">PostgreSQL client tools not found</p>
            {pgDumpMissing && (
              <p className="text-orange-700">
                <strong>pg_dump</strong> is not installed or not in PATH — database backup will fail.{' '}
                <span className="font-mono text-xs bg-orange-100 px-1 rounded">{avail?.pgDump.hint}</span>
              </p>
            )}
            {psqlMissing && (
              <p className="text-orange-700">
                <strong>psql</strong> is not installed — database restore will fail.{' '}
                <span className="font-mono text-xs bg-orange-100 px-1 rounded">{avail?.psql.hint}</span>
              </p>
            )}
            <p className="text-xs text-orange-600 mt-1">
              Tip: Set <code className="font-mono bg-orange-100 px-1 rounded">PG_DUMP_PATH</code> / <code className="font-mono bg-orange-100 px-1 rounded">PSQL_PATH</code> env vars to absolute binary paths if not in system PATH.
              <br />Files backup works independently and does not require pg_dump.
            </p>
          </div>
        </div>
      )}
      {avail && !anyDbToolMissing && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700">
          <CheckCheck size={14} />
          {avail.pgDump.method === 'docker'
            ? `pg_dump & psql available via Docker (${avail.pgDump.path}) — database backup ready`
            : `pg_dump and psql detected (${avail.pgDump.path}) — database backup & restore ready`}
        </div>
      )}

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="layer-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database size={14} className="text-indigo-400" />
            <span className="text-xs text-gray-500 font-medium">Last DB Backup</span>
          </div>
          <p className="text-xs font-semibold text-gray-800">{formatDate(stats?.lastDbBackupAt)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{formatBytes(stats?.lastDbBackupSize)}</p>
        </div>
        <div className="layer-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen size={14} className="text-teal-400" />
            <span className="text-xs text-gray-500 font-medium">Last Files Backup</span>
          </div>
          <p className="text-xs font-semibold text-gray-800">{formatDate(stats?.lastFilesBackupAt)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{formatBytes(stats?.lastFilesBackupSize)}</p>
        </div>
        <div className="layer-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar size={14} className="text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Next Scheduled</span>
          </div>
          <p className="text-xs font-semibold text-gray-800">{formatDate(stats?.nextScheduledAt)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Daily (02:00 UTC)</p>
        </div>
        <div className="layer-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive size={14} className="text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Total Backups</span>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-gray-900">{stats?.totalBackups ?? 0}</p>
            <div className="text-[10px] text-gray-400 leading-tight">
              <p>{stats?.totalDbBackups ?? 0} DB</p>
              <p>{stats?.totalFilesBackups ?? 0} Files</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Restore Warning ── */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <Shield size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Restore Warning: </span>
          Restoring overwrites current data permanently. Only restore during a planned maintenance window.
          DB restore and Files restore are independent — restoring one does not affect the other.
        </p>
      </div>

      {/* ══════════════════════════════════════════
          DATABASE BACKUPS SECTION
      ══════════════════════════════════════════ */}
      <div className="layer-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-indigo-500" />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Database Backups</h3>
              <p className="text-[11px] text-gray-400">pg_dump compressed SQL — restore overwrites all database rows</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => dbFileInputRef.current?.click()}
              disabled={uploadingDbRestore || restoringDb}
              title="Restore database from uploaded .sql.gz file"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50">
              {uploadingDbRestore ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Restore from File
            </button>
            <input ref={dbFileInputRef} type="file" accept=".gz" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setConfirmUploadDb(f); } e.target.value = ''; }} />
            <button
              onClick={() => setConfirmCreate('DATABASE')}
              disabled={creatingDb || pgDumpMissing === true}
              title={pgDumpMissing ? 'pg_dump not found — see warning above' : 'Create database backup now'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50">
              {creatingDb ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create DB Backup
            </button>
          </div>
        </div>

        <BackupTable
          category="DATABASE"
          accessToken={accessToken}
          onRestoreDb={(b) => setConfirmRestoreDb(b)}
          onRestoreFiles={() => {}} // not used for DB table
          onDelete={(id) => setConfirmDelete(id)}
          deletingId={deletingId}
          restoringId={restoringId}
        />
      </div>

      {/* ══════════════════════════════════════════
          UPLOADED FILES BACKUPS SECTION
      ══════════════════════════════════════════ */}
      <div className="layer-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-teal-500" />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Uploaded Files Backups</h3>
              <p className="text-[11px] text-gray-400">
                tar.gz archive of <code className="font-mono text-[10px] bg-gray-100 px-1 rounded">uploads/</code> (policies, docs, photos, resumes…) — restore overwrites files on disk
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => filesFileInputRef.current?.click()}
              disabled={uploadingFilesRestore || restoringFiles}
              title="Restore files from uploaded .tar.gz archive"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50">
              {uploadingFilesRestore ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Restore from Archive
            </button>
            <input ref={filesFileInputRef} type="file" accept=".gz" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setConfirmUploadFiles(f); } e.target.value = ''; }} />
            <button
              onClick={() => setConfirmCreate('FILES')}
              disabled={creatingFiles}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50">
              {creatingFiles ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create Files Backup
            </button>
          </div>
        </div>

        <BackupTable
          category="FILES"
          accessToken={accessToken}
          onRestoreDb={() => {}} // not used for Files table
          onRestoreFiles={(b) => setConfirmRestoreFiles(b)}
          onDelete={(id) => setConfirmDelete(id)}
          deletingId={deletingId}
          restoringId={restoringId}
        />
      </div>

      {/* ── Uploads inventory info ── */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
        <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700 space-y-0.5">
          <p className="font-semibold">What is included in a Files Backup?</p>
          <p>All content under <code className="font-mono bg-blue-100 px-1 rounded">uploads/</code>: employee KYC documents, profile photos, company policies, branding assets, bulk resumes, walk-in candidate files, agent screenshots, announcements, and letter attachments.</p>
          <p className="text-blue-500">The <code className="font-mono bg-blue-100 px-1 rounded">uploads/backups/</code> and <code className="font-mono bg-blue-100 px-1 rounded">uploads/tmp/</code> directories are excluded.</p>
        </div>
      </div>

      <div className="text-xs text-gray-400 text-center">
        Daily backups run at 02:00 UTC. The latest 15 copies of each type are retained — 15 days of restore history.
      </div>

      {/* ── Confirmation Modals ── */}

      {confirmCreate === 'DATABASE' && (
        <ConfirmModal
          title="Create Database Backup"
          message="This will create a full compressed pg_dump of the database. The process runs synchronously and may take a minute for large databases."
          confirmLabel="Create DB Backup"
          confirmCls="bg-indigo-600 hover:bg-indigo-700 text-white"
          onConfirm={() => handleCreate('DATABASE')}
          onCancel={() => setConfirmCreate(null)}
          isLoading={creatingDb}
        />
      )}

      {confirmCreate === 'FILES' && (
        <ConfirmModal
          title="Create Files Backup"
          message="This will create a compressed tar.gz archive of all uploaded files (employee documents, photos, policies, resumes, etc.). This may take time if you have many large files."
          confirmLabel="Create Files Backup"
          confirmCls="bg-teal-600 hover:bg-teal-700 text-white"
          onConfirm={() => handleCreate('FILES')}
          onCancel={() => setConfirmCreate(null)}
          isLoading={creatingFiles}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Backup"
          message="This will permanently delete the backup file from disk and remove it from history. This cannot be undone."
          confirmLabel="Delete Permanently"
          confirmCls="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}

      {confirmRestoreDb && (
        <ConfirmModal
          title="Restore Database"
          message={`This will OVERWRITE ALL current database data with the backup from ${formatDate(confirmRestoreDb.createdAt)} (${formatBytes(confirmRestoreDb.sizeBytes)}). This action CANNOT be undone. Files on disk are NOT affected. Only perform this during a planned maintenance window.`}
          confirmLabel="Yes, Restore Database"
          confirmCls="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => handleRestoreDb(confirmRestoreDb)}
          onCancel={() => setConfirmRestoreDb(null)}
          isLoading={restoringDb}
          danger
        />
      )}

      {confirmRestoreFiles && (
        <ConfirmModal
          title="Restore Uploaded Files"
          message={`This will OVERWRITE files on disk from the archive backup from ${formatDate(confirmRestoreFiles.createdAt)} (${formatBytes(confirmRestoreFiles.sizeBytes)}). The database is NOT affected. Existing files in the uploads folders will be overwritten. Only perform this during a planned maintenance window.`}
          confirmLabel="Yes, Restore Files"
          confirmCls="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => handleRestoreFiles(confirmRestoreFiles)}
          onCancel={() => setConfirmRestoreFiles(null)}
          isLoading={restoringFiles}
          danger
        />
      )}

      {confirmUploadDb && (
        <ConfirmModal
          title="Restore Database from Uploaded File"
          message={`You are about to restore the database from "${confirmUploadDb.name}" (${formatBytes(String(confirmUploadDb.size))}). This will OVERWRITE ALL current data. This action cannot be undone.`}
          confirmLabel="Yes, Restore Database"
          confirmCls="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => handleUploadRestore(confirmUploadDb, 'DATABASE')}
          onCancel={() => setConfirmUploadDb(null)}
          isLoading={uploadingDbRestore}
          danger
        />
      )}

      {confirmUploadFiles && (
        <ConfirmModal
          title="Restore Files from Uploaded Archive"
          message={`You are about to restore uploaded files from "${confirmUploadFiles.name}" (${formatBytes(String(confirmUploadFiles.size))}). Existing files in the uploads folder will be overwritten. The database is NOT affected.`}
          confirmLabel="Yes, Restore Files"
          confirmCls="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => handleUploadRestore(confirmUploadFiles, 'FILES')}
          onCancel={() => setConfirmUploadFiles(null)}
          isLoading={uploadingFilesRestore}
          danger
        />
      )}
    </div>
  );
}
