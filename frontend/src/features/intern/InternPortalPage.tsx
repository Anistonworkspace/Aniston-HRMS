import { useSelector } from 'react-redux';
import { type RootState } from '../../app/store';
import {
  useGetInternProfileQuery,
  useGetAchievementLettersQuery,
} from './internApi';
import { Loader2, Award, User, BookOpen, Calendar, Mail } from 'lucide-react';

export default function InternPortalPage() {
  const user = useSelector((s: RootState) => s.auth.user);
  const employeeId = user?.employeeId ?? '';

  const { data: profileData, isLoading: profileLoading } = useGetInternProfileQuery(employeeId, { skip: !employeeId });
  const { data: lettersData, isLoading: lettersLoading } = useGetAchievementLettersQuery(employeeId, { skip: !employeeId });

  const profile = profileData?.data;
  const letters = lettersData?.data ?? [];

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900" style={{ fontFamily: 'Sora, sans-serif' }}>
          Intern Portal
        </h1>
        <p className="text-sm text-gray-500 mt-1">Your internship profile, mentor, and achievement letters</p>
      </div>

      {!profile ? (
        <div className="layer-card p-8 text-center">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No intern profile found. Contact HR to set up your internship profile.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Profile Card */}
          <div className="layer-card p-6 space-y-4">
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-indigo-600" />
              <h2 className="font-semibold text-gray-900">Profile Details</h2>
            </div>
            <div className="space-y-3 text-sm">
              {profile.college && (
                <div className="flex justify-between">
                  <span className="text-gray-500">College</span>
                  <span className="font-medium text-gray-900">{profile.college}</span>
                </div>
              )}
              {profile.department && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Department</span>
                  <span className="font-medium text-gray-900">{profile.department}</span>
                </div>
              )}
              {profile.stipend != null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Monthly Stipend</span>
                  <span className="font-medium text-gray-900 font-mono">
                    ₹{Number(profile.stipend).toLocaleString('en-IN')}
                  </span>
                </div>
              )}
              {profile.startDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Start Date</span>
                  <span className="font-medium text-gray-900">
                    {new Date(profile.startDate).toLocaleDateString('en-IN')}
                  </span>
                </div>
              )}
              {profile.endDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">End Date</span>
                  <span className="font-medium text-gray-900">
                    {new Date(profile.endDate).toLocaleDateString('en-IN')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Mentor Card */}
          {profile.mentor && (
            <div className="layer-card p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-indigo-600" />
                <h2 className="font-semibold text-gray-900">Your Mentor</h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-indigo-700 font-semibold text-sm">
                    {profile.mentor.firstName?.[0]}{profile.mentor.lastName?.[0]}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {profile.mentor.firstName} {profile.mentor.lastName}
                  </p>
                  {profile.mentor.designation && (
                    <p className="text-sm text-gray-500">{profile.mentor.designation}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Achievement Letters */}
      <div className="layer-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Award className="w-5 h-5 text-indigo-600" />
          <h2 className="font-semibold text-gray-900">Achievement Letters</h2>
        </div>

        {lettersLoading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading letters...
          </div>
        ) : letters.length === 0 ? (
          <p className="text-sm text-gray-500">No achievement letters yet. Complete your internship milestones to earn letters.</p>
        ) : (
          <div className="space-y-3">
            {letters.map((letter: any) => (
              <div key={letter.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{letter.title || 'Achievement Letter'}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(letter.createdAt).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                </div>
                {letter.pdfUrl && (
                  <a
                    href={letter.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Download
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
