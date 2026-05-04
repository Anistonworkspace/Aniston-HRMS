import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { onSocketEvent, offSocketEvent } from '../../../lib/socket';
import { useAppDispatch } from '../../../app/store';
import { api } from '../../../app/api';
import {
  useGetCommandCenterStatsQuery,
  useGetEnhancedAttendanceQuery,
  useDetectAnomaliesMutation,
} from '../attendanceApi';
import { useAppSelector } from '../../../app/store';
import KpiStrip from './KpiStrip';
import ActionBar from './ActionBar';
import FilterToolbar, { type AttendanceFilters } from './FilterToolbar';
import AttendanceTable from './AttendanceTable';
import RegularizationTab from './RegularizationTab';
import MonthlyReportTab from './MonthlyReportTab';
import ShiftRotationCalendar from './ShiftRotationCalendar';
import AnomalyDetectionPanel from './AnomalyDetectionPanel';
import MarkManualModal from './MarkManualModal';
import GeoLocationsTab from './GeoLocationsTab';
import toast from 'react-hot-toast';
import { useAuthDownload } from '../../../hooks/useAuthDownload';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'regularization', label: 'Regularization' },
  { key: 'monthly', label: 'Monthly Report' },
  { key: 'roster', label: 'Shift Roster' },
  { key: 'anomalies', label: 'AI Anomalies' },
  { key: 'geo-locations', label: 'Geo Locations' },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function CommandCenter() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { download: authDownload, downloading: exportDownloading } = useAuthDownload();

  const [activeTab, setActiveTab] = useState<TabKey>('today');
  const [showMarkManual, setShowMarkManual] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');
  const [filters, setFilters] = useState<AttendanceFilters>({
    date: new Date().toISOString().split('T')[0],
    search: '',
    status: '',
    department: '',
    workMode: '',
    shiftType: '',
    anomalyType: '',
    regularizationStatus: '',
    employeeType: '',
  });
  // KPI-only filters that must NOT go into the filters object (FilterToolbar crashes on non-string values)
  const [kpiFilter, setKpiFilter] = useState<{ isLate?: boolean; workMode?: string } | null>(null);

  // Stats query — poll every 30s for live KPI updates
  const { data: statsRes, isLoading: statsLoading } = useGetCommandCenterStatsQuery({ date: filters.date }, { pollingInterval: 30000 });
  const stats = statsRes?.data;

  // Records query — poll every 15s so check-ins/outs reflect quickly
  const { data: recordsRes, isLoading: recordsLoading, refetch } = useGetEnhancedAttendanceQuery({
    page,
    limit: 30,
    startDate: filters.date,
    endDate: filters.date,
    department: filters.department || undefined,
    status: filters.status || undefined,
    workMode: kpiFilter?.workMode || filters.workMode || undefined,
    search: filters.search || undefined,
    shiftType: filters.shiftType || undefined,
    anomalyType: filters.anomalyType || undefined,
    regularizationStatus: filters.regularizationStatus || undefined,
    employeeType: filters.employeeType || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    isLate: kpiFilter?.isLate || undefined,
  }, { pollingInterval: 15000 });
  const records = recordsRes?.data || [];
  const meta = recordsRes?.meta;

  // Detect anomalies
  const [detectAnomalies, { isLoading: isDetecting }] = useDetectAnomaliesMutation();

  // WebSocket refresh — use ref to avoid listener re-registration on every refetch change
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const handler = () => refetchRef.current();
    const markedHandler = () => dispatchRef.current(api.util.invalidateTags(['Attendance'] as any));
    onSocketEvent('attendance:checkin', handler);
    onSocketEvent('attendance:checkout', handler);
    onSocketEvent('attendance:marked', markedHandler);
    return () => {
      offSocketEvent('attendance:checkin', handler);
      offSocketEvent('attendance:checkout', handler);
      offSocketEvent('attendance:marked', markedHandler);
    };
  }, []);

  const handleFiltersChange = useCallback((newFilters: AttendanceFilters) => {
    setFilters(newFilters);
    setPage(1);
  }, []);

  // KPI card click — apply status / anomalyType filter into filters; isLate/workMode go into kpiFilter (never into filters, FilterToolbar crashes on non-string values)
  const handleKpiCardClick = useCallback((filter: { status?: string; anomalyType?: string; workMode?: string; isLate?: boolean } | null) => {
    setFilters((prev) => ({
      ...prev,
      status: filter?.status ?? '',
      anomalyType: filter?.anomalyType ?? '',
    }));
    setKpiFilter(filter ? { isLate: filter.isLate, workMode: filter.workMode } : null);
    setPage(1);
    setActiveTab('today');
  }, []);

  const handleSort = useCallback((field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  }, [sortBy]);

  const handleExport = () => {
    const date = new Date(filters.date);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    authDownload(`/attendance/export?month=${month}&year=${year}`, `attendance-${month}-${year}.xlsx`);
  };

  const handleDetectAnomalies = async () => {
    try {
      const result = await detectAnomalies({ date: filters.date }).unwrap();
      toast.success(`Detected ${result.data?.detected || 0} anomalies, ${result.data?.created || 0} new`);
    } catch { toast.error('Failed to detect anomalies'); }
  };

  return (
    <div className="page-container space-y-4 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-gray-900">Attendance Command Center</h1>
          <p className="text-xs text-gray-400 mt-0.5">Real-time workforce monitoring & attendance operations</p>
        </div>
        <ActionBar
          selectedDate={filters.date}
          onExport={handleExport}
          onDetectAnomalies={handleDetectAnomalies}
          onTabChange={(tab) => setActiveTab(tab as TabKey)}
          isDetecting={isDetecting}
          onMarkManual={() => setShowMarkManual(true)}
        />
      </div>

      {/* KPI Strip */}
      <KpiStrip
        stats={stats}
        isLoading={statsLoading}
        activeFilter={(filters.status || filters.anomalyType || kpiFilter?.workMode || kpiFilter?.isLate)
          ? { status: filters.status || undefined, anomalyType: filters.anomalyType || undefined, workMode: kpiFilter?.workMode, isLate: kpiFilter?.isLate }
          : null}
        onCardClick={handleKpiCardClick}
      />

      {/* Clear KPI filter badge */}
      {(filters.status || filters.anomalyType || kpiFilter?.isLate || kpiFilter?.workMode) && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Filtered by:</span>
          <button
            onClick={() => handleKpiCardClick(null)}
            className="flex items-center gap-1 text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200 px-2.5 py-1 rounded-full hover:bg-brand-100 transition-colors"
          >
            {kpiFilter?.isLate ? 'LATE ARRIVAL' : kpiFilter?.workMode ? 'FIELD ACTIVE' : filters.status || filters.anomalyType?.replace(/_/g, ' ')}
            <X size={11} />
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <FilterToolbar filters={filters} onChange={handleFiltersChange} />

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100 -mx-1 px-1">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-brand-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <motion.div
                layoutId="attendance-tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-full"
              />
            )}
            {/* Badge counts */}
            {tab.key === 'regularization' && stats?.pendingRegularizations > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-[8px] font-bold w-4 h-4 rounded-full inline-flex items-center justify-center">
                {stats.pendingRegularizations}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'today' && (
        <AttendanceTable
          records={records}
          isLoading={recordsLoading}
          meta={meta}
          page={page}
          onPageChange={setPage}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
        />
      )}

      {activeTab === 'regularization' && <RegularizationTab />}

      {activeTab === 'monthly' && <MonthlyReportTab />}

      {activeTab === 'roster' && <ShiftRotationCalendar />}

      {activeTab === 'anomalies' && <AnomalyDetectionPanel selectedDate={filters.date} />}

      {activeTab === 'geo-locations' && <GeoLocationsTab />}

      <MarkManualModal isOpen={showMarkManual} onClose={() => setShowMarkManual(false)} defaultDate={filters.date} />
    </div>
  );
}
