import { useState } from 'react';
import { motion } from 'framer-motion';
import { Target, TrendingUp, Star, Plus, ChevronRight, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { api } from '../../app/api';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const performanceApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getGoals: builder.query<any, void>({ query: () => '/performance/goals' }),
    createGoal: builder.mutation<any, any>({ query: (body) => ({ url: '/performance/goals', method: 'POST', body }) }),
    updateGoal: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/performance/goals/${id}`, method: 'PATCH', body: data }),
    }),
    getReviews: builder.query<any, void>({ query: () => '/performance/reviews' }),
    getCycles: builder.query<any, void>({ query: () => '/performance/cycles' }),
  }),
});

const { useGetGoalsQuery, useCreateGoalMutation, useUpdateGoalMutation, useGetReviewsQuery, useGetCyclesQuery } = performanceApi;

const STATUS_ICONS: Record<string, React.ReactNode> = {
  NOT_STARTED: <Clock size={14} className="text-gray-400" />,
  IN_PROGRESS: <AlertCircle size={14} className="text-blue-500" />,
  COMPLETED: <CheckCircle size={14} className="text-emerald-500" />,
  ON_HOLD: <Clock size={14} className="text-amber-500" />,
};

export default function PerformancePage() {
  const { data: goalsRes } = useGetGoalsQuery();
  const { data: reviewsRes } = useGetReviewsQuery();
  const { data: cyclesRes } = useGetCyclesQuery();
  const [updateGoal] = useUpdateGoalMutation();

  const goals = goalsRes?.data || [];
  const reviews = reviewsRes?.data || [];
  const cycles = cyclesRes?.data || [];

  const goalStats = {
    total: goals.length,
    completed: goals.filter((g: any) => g.status === 'COMPLETED').length,
    inProgress: goals.filter((g: any) => g.status === 'IN_PROGRESS').length,
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await updateGoal({ id, data: { status } }).unwrap();
      toast.success(`Goal marked as ${status.toLowerCase().replace('_', ' ')}`);
    } catch { toast.error('Failed to update'); }
  };

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Performance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track goals and performance reviews</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="stat-card">
          <Target size={20} className="text-brand-500 mb-2" />
          <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{goalStats.total}</p>
          <p className="text-sm text-gray-500">Total Goals</p>
        </div>
        <div className="stat-card">
          <TrendingUp size={20} className="text-blue-500 mb-2" />
          <p className="text-2xl font-bold font-mono text-blue-600" data-mono>{goalStats.inProgress}</p>
          <p className="text-sm text-gray-500">In Progress</p>
        </div>
        <div className="stat-card">
          <CheckCircle size={20} className="text-emerald-500 mb-2" />
          <p className="text-2xl font-bold font-mono text-emerald-600" data-mono>{goalStats.completed}</p>
          <p className="text-sm text-gray-500">Completed</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Goals */}
        <div className="layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Target size={18} className="text-brand-500" /> My Goals
          </h2>
          {goals.length === 0 ? (
            <div className="text-center py-8">
              <Target size={36} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">No goals set yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {goals.map((goal: any) => (
                <div key={goal.id} className="p-4 bg-surface-2 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-2">
                      {STATUS_ICONS[goal.status] || STATUS_ICONS.NOT_STARTED}
                      <div>
                        <p className="text-sm font-medium text-gray-800">{goal.title}</p>
                        {goal.description && <p className="text-xs text-gray-400 mt-0.5">{goal.description}</p>}
                      </div>
                    </div>
                    <select
                      value={goal.status}
                      onChange={(e) => handleStatusChange(goal.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                    >
                      <option value="NOT_STARTED">Not Started</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="ON_HOLD">On Hold</option>
                    </select>
                  </div>
                  {goal.targetValue && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Progress</span>
                        <span className="font-mono" data-mono>{Number(goal.currentValue || 0)} / {Number(goal.targetValue)} {goal.unit || ''}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-brand-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${Math.min((Number(goal.currentValue || 0) / Number(goal.targetValue)) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reviews */}
        <div className="layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Star size={18} className="text-amber-500" /> Performance Reviews
          </h2>
          {reviews.length === 0 ? (
            <div className="text-center py-8">
              <Star size={36} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">No reviews yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((review: any) => (
                <div key={review.id} className="p-4 bg-surface-2 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-800">{review.reviewCycle?.name}</p>
                    <span className={cn('badge text-xs', review.status === 'REVIEWED' ? 'badge-success' : 'badge-warning')}>
                      {review.status}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    {review.selfRating && <span>Self: <strong className="text-gray-700">{Number(review.selfRating)}/5</strong></span>}
                    {review.managerRating && <span>Manager: <strong className="text-gray-700">{Number(review.managerRating)}/5</strong></span>}
                    {review.overallRating && <span>Overall: <strong className="text-brand-600">{Number(review.overallRating)}/5</strong></span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review Cycles */}
        <div className="layer-card p-6 lg:col-span-2">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">Review Cycles</h2>
          {cycles.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No review cycles configured</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cycles.map((cycle: any) => (
                <div key={cycle.id} className="p-4 bg-surface-2 rounded-lg">
                  <p className="text-sm font-semibold text-gray-800">{cycle.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{cycle.type} · {cycle.status}</p>
                  <p className="text-xs text-gray-400">{cycle._count?.reviews || 0} reviews · {cycle._count?.goals || 0} goals</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
