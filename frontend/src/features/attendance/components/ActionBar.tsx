import { useState } from 'react';
import {
  Download, PenSquare, RefreshCw, Radio, ClipboardList, MoreHorizontal,
} from 'lucide-react';

interface ActionBarProps {
  selectedDate: string;
  onExport: () => void;
  onDetectAnomalies: () => void;
  onTabChange: (tab: string) => void;
  isDetecting?: boolean;
  onMarkManual?: () => void;
}

export default function ActionBar({ onExport, onDetectAnomalies, onTabChange, isDetecting, onMarkManual }: ActionBarProps) {
  const [showMore, setShowMore] = useState(false);

  const primaryActions = [
    { key: 'export',      label: 'Export',           icon: Download,   onClick: onExport,              loading: false },
    { key: 'manual',      label: 'Mark Manual',      icon: PenSquare,  onClick: () => onMarkManual?.(), loading: false },
    { key: 'anomalies',   label: isDetecting ? 'Detecting…' : 'Detect Anomalies', icon: RefreshCw, onClick: onDetectAnomalies, loading: !!isDetecting },
  ];

  const moreActions = [
    { key: 'live',  label: 'Live Board',   icon: Radio,       onClick: () => onTabChange('live') },
    { key: 'audit', label: 'AI Anomalies', icon: ClipboardList, onClick: () => onTabChange('anomalies') },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {primaryActions.map(({ key, label, icon: Icon, onClick, loading }) => (
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

      <div className="relative">
        <button
          onClick={() => setShowMore(!showMore)}
          className="flex items-center px-2 py-1.5 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <MoreHorizontal size={14} />
        </button>
        {showMore && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMore(false)} />
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg z-20 min-w-[160px] py-1">
              {moreActions.map(({ key, label, icon: Icon, onClick }) => (
                <button
                  key={key}
                  onClick={() => { onClick(); setShowMore(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Icon size={13} />
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
