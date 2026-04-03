import { memo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, AreaChart, Area,
} from 'recharts';

interface TrendChartsProps {
  hiringTrend: { month: string; hires: number; exits: number }[];
  attendanceTrend: { month: string; avgPercentage: number }[];
  leaveTrend: { month: string; totalDays: number }[];
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

const tooltipStyle = { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 };

function TrendCharts({ hiringTrend, attendanceTrend, leaveTrend }: TrendChartsProps) {
  return (
    <motion.div variants={container} initial="hidden" animate="show" className="grid lg:grid-cols-3 gap-4 mb-6">
      {/* Hiring Trend */}
      <motion.div variants={item} className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Hiring vs Exits</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hiringTrend} barSize={14} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="hires" fill="#10b981" radius={[4,4,0,0]} name="Hires" />
            <Bar dataKey="exits" fill="#ef4444" radius={[4,4,0,0]} name="Exits" />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Attendance Trend */}
      <motion.div variants={item} className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Attendance %</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={attendanceTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" domain={[0, 100]} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v}%`} />
            <defs>
              <linearGradient id="attendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="avgPercentage" stroke="#6366f1" fill="url(#attendGrad)" strokeWidth={2} name="Avg %" />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Leave Trend */}
      <motion.div variants={item} className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Leave Days Used</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={leaveTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="totalDays" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} name="Days" />
          </LineChart>
        </ResponsiveContainer>
      </motion.div>
    </motion.div>
  );
}

export default memo(TrendCharts);
