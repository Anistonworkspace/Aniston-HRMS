import { Download, Upload, PenSquare, RefreshCw } from 'lucide-react';

interface ActionBarProps {
  selectedDate: string;
  onExport: () => void;
  onImport?: () => void;
  onDetectAnomalies: () => void;
  onTabChange: (tab: string) => void;
  isDetecting?: boolean;
  onMarkManual?: () => void;
}

export default function ActionBar({ onExport, onImport, onDetectAnomalies, isDetecting, onMarkManual }: ActionBarProps) {
  const actions = [
    { key: 'export',    label: 'Export',           icon: Download,  onClick: onExport,              loading: false },
    { key: 'import',    label: 'Import',            icon: Upload,    onClick: () => onImport?.(),    loading: false },
    { key: 'manual',    label: 'Mark Manual',       icon: PenSquare, onClick: () => onMarkManual?.(), loading: false },
    { key: 'anomalies', label: isDetecting ? 'Detecting…' : 'Detect Anomalies', icon: RefreshCw, onClick: onDetectAnomalies, loading: !!isDetecting },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {actions.map(({ key, label, icon: Icon, onClick, loading }) => (
        <button
          key={key}
          onClick={onClick}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-60"
        >
          <Icon size={13} className={loading ? 'animate-spin' : ''} />
          {label}
        </button>
      ))}
    </div>
  );
}
