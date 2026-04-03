import { memo } from 'react';

interface SkeletonLoaderProps {
  variant: 'kpi-grid' | 'status-grid' | 'section' | 'full-page';
  count?: number;
}

function SkeletonLoaderInner({ variant, count = 6 }: SkeletonLoaderProps) {
  if (variant === 'kpi-grid') {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="stat-card animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-16 mb-3" />
            <div className="h-7 bg-gray-200 rounded w-12 mb-1" />
            <div className="h-3 bg-gray-100 rounded w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'status-grid') {
    return (
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-6">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="layer-card p-3 animate-pulse">
            <div className="h-7 bg-gray-200 rounded w-8 mb-1" />
            <div className="h-3 bg-gray-100 rounded w-14" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'section') {
    return (
      <div className="layer-card p-5 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  // full-page
  return (
    <div className="page-container animate-pulse">
      <div className="mb-8">
        <div className="h-8 bg-gray-200 rounded-lg w-64 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-48" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="stat-card">
            <div className="h-4 bg-gray-100 rounded w-16 mb-3" />
            <div className="h-7 bg-gray-200 rounded w-12 mb-1" />
            <div className="h-3 bg-gray-100 rounded w-20" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="layer-card p-6 h-64">
            <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
            <div className="h-40 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export const SkeletonLoader = memo(SkeletonLoaderInner);
