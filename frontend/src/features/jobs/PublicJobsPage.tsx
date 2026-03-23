import { motion } from 'framer-motion';
import { Briefcase, MapPin, Clock, ChevronRight, Building2, Search } from 'lucide-react';
import { useGetWalkInJobsQuery } from '../walkIn/walkInApi';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export default function PublicJobsPage() {
  const { data: jobsData, isLoading } = useGetWalkInJobsQuery();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const jobs: any[] = jobsData?.data || [];
  const filtered = jobs.filter((job: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      job.title?.toLowerCase().includes(q) ||
      job.department?.toLowerCase().includes(q) ||
      job.location?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-600 to-brand-700 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg font-display">A</span>
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-gray-900">Aniston HRMS</h1>
              <p className="text-xs text-gray-500">Career Opportunities</p>
            </div>
          </div>
          <a
            href="/walk-in"
            className="text-sm text-brand-600 hover:text-brand-700 font-medium hidden sm:inline-flex items-center gap-1"
          >
            Direct Walk-In Registration <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-8">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-gray-900 mb-3">
            Join Our Team
          </h2>
          <p className="text-gray-500 max-w-xl mx-auto text-base sm:text-lg">
            Explore open positions at Aniston Technologies LLP and take the next step in your career.
          </p>
        </motion.div>

        {/* Search */}
        <div className="max-w-md mx-auto mb-10">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search positions, departments, locations..."
              className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400
                shadow-sm transition-all"
            />
          </div>
        </div>
      </section>

      {/* Job Grid */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <Briefcase className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-1">
              {search ? 'No matching positions found' : 'No open positions right now'}
            </h3>
            <p className="text-sm text-gray-400">
              {search ? 'Try adjusting your search terms.' : 'Check back later for new opportunities.'}
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((job: any, index: number) => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.05 }}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md
                  transition-all hover:-translate-y-0.5 p-6 flex flex-col"
              >
                {/* Department Badge */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-50 text-brand-700 text-xs font-medium rounded-lg">
                    <Building2 className="w-3 h-3" />
                    {job.department || 'General'}
                  </span>
                  {job.type && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-lg">
                      <Clock className="w-3 h-3" />
                      {job.type}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h3 className="text-lg font-display font-bold text-gray-900 mb-2 leading-tight">
                  {job.title}
                </h3>

                {/* Location */}
                {job.location && (
                  <p className="flex items-center gap-1.5 text-sm text-gray-500 mb-4">
                    <MapPin className="w-3.5 h-3.5 text-gray-400" />
                    {job.location}
                  </p>
                )}

                {/* Description snippet */}
                {job.description && (
                  <p className="text-sm text-gray-400 line-clamp-2 mb-5 flex-1">
                    {job.description}
                  </p>
                )}

                {/* Apply Button */}
                <button
                  onClick={() => navigate(`/walk-in?jobId=${job.id}`)}
                  className="mt-auto w-full flex items-center justify-center gap-2 px-4 py-2.5
                    bg-brand-600 text-white rounded-xl text-sm font-medium
                    hover:bg-brand-700 transition-colors shadow-sm"
                >
                  Apply for Interview <ChevronRight className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-sm border-t border-gray-100 px-6 py-3">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 gap-1">
          <span>Aniston Technologies LLP &mdash; Building the future of HR</span>
          <span>Powered by Aniston HRMS</span>
        </div>
      </footer>
    </div>
  );
}
