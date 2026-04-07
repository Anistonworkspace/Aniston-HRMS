import { useState } from 'react';
import {
  Download, CheckSquare, FileCheck, PenSquare, AlertTriangle,
  RefreshCw, Radio, ClipboardList, MoreHorizontal, Upload,
} from 'lucide-react';
import { cn } from '../../../lib/utils';

interface ActionBarProps {
  selectedDate: string;
  onExport: () => void;
  onDetectAnomalies: () => void;
  onTabChange: (tab: string) => void;
  isDetecting?: boolean;
  onBulkUpload?: () => void;
  onMarkManual?: () => void;
}

export default function ActionBar({ selectedDate, onExport, onDetectAnomalies, onTabChange, isDetecting, onBulkUpload, onMarkManual }: ActionBarProps) {
  const [showMore, setShowMore] = useState(false);

  const primaryActions = [
    { key: 'export', label: 'Export', icon: Download, onClick: onExport },
    { key: 'regularize', label: 'Bulk Regularize', icon: CheckSquare, onClick: () => onTabChange('regularization') },
    { key: 'corrections', label: 'Approve Corrections', icon: FileCheck, onClick: () => onTabChange('regularization') },
    { key: 'manual', label: 'Mark Manual', icon: PenSquare, onClick: () => onMarkManual?.() },
    { key: 'exceptions', label: 'Exceptions Queue', icon: AlertTriangle, onClick: () => onTabChange('exceptions') },
  ];

  const secondaryActions = [
    { key: 'bulk', label: 'Bulk Upload', icon: Upload, onClick: () => onBulkUpload?.() },
    { key: 'recalculate', label: 'Detect Anomalies', icon: RefreshCw, onClick: onDetectAnomalies, loading: isDetecting },
    { key: 'live', label: 'Live Board', icon: Radio, onClick: () => onTabChange('live') },
    { key: 'audit', label: 'AI Anomalies', icon: ClipboardList, onClick: () => onTabChange('anomalies') },
  ];

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {primaryActions.map(({ key, label, icon: Icon, onClick }) => (
        <button
          key={key}
          onClick={onClick}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          <Icon size={13} /> {label}
        </button>
      ))}

      <div className="relative">
        <button
          onClick={() => setShowMore(!showMore)}
          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <MoreHorizontal size={14} />
        </button>
        {showMore && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMore(false)} />
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg z-20 min-w-[180px] py-1">
              {secondaryActions.map(({ key, label, icon: Icon, onClick, loading }) => (
                <button
                  key={key}
                  onClick={() => { onClick(); setShowMore(false); }}
                  disabled={loading}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {loading ? <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> : <Icon size={13} />}
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
