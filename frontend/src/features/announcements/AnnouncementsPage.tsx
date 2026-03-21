import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Megaphone, Plus, X, Heart, MessageCircle, Send, ThumbsUp, Loader2 } from 'lucide-react';
import { api } from '../../app/api';
import { cn, formatDate, getInitials } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

const socialApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getAnnouncements: builder.query<any, void>({ query: () => '/announcements' }),
    createAnnouncement: builder.mutation<any, any>({
      query: (body) => ({ url: '/announcements', method: 'POST', body }),
    }),
    getSocialPosts: builder.query<any, void>({ query: () => '/announcements/social' }),
    createPost: builder.mutation<any, any>({
      query: (body) => ({ url: '/announcements/social', method: 'POST', body }),
    }),
    likePost: builder.mutation<any, string>({
      query: (id) => ({ url: `/announcements/social/${id}/like`, method: 'POST' }),
    }),
    commentPost: builder.mutation<any, { id: string; content: string }>({
      query: ({ id, content }) => ({ url: `/announcements/social/${id}/comment`, method: 'POST', body: { content } }),
    }),
  }),
});

const { useGetAnnouncementsQuery, useGetSocialPostsQuery, useCreatePostMutation, useLikePostMutation, useCommentPostMutation } = socialApi;

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  NORMAL: 'bg-blue-50 text-blue-600',
  HIGH: 'bg-amber-50 text-amber-700',
  URGENT: 'bg-red-50 text-red-700',
};

export default function AnnouncementsPage() {
  const [tab, setTab] = useState<'announcements' | 'social'>('announcements');

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Community</h1>
          <p className="text-gray-500 text-sm mt-0.5">Announcements and social wall</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-2 rounded-lg p-1 w-fit mb-6">
        <button onClick={() => setTab('announcements')}
          className={cn('px-4 py-2 rounded-md text-sm font-medium transition-colors',
            tab === 'announcements' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          )}>
          Announcements
        </button>
        <button onClick={() => setTab('social')}
          className={cn('px-4 py-2 rounded-md text-sm font-medium transition-colors',
            tab === 'social' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          )}>
          Social Wall
        </button>
      </div>

      {tab === 'announcements' ? <AnnouncementsList /> : <SocialWall />}
    </div>
  );
}

function AnnouncementsList() {
  const { data: res } = useGetAnnouncementsQuery();
  const announcements = res?.data || [];

  return announcements.length === 0 ? (
    <div className="layer-card p-16 text-center">
      <Megaphone size={48} className="mx-auto text-gray-200 mb-4" />
      <h3 className="text-lg font-display font-semibold text-gray-600">No announcements</h3>
      <p className="text-sm text-gray-400 mt-1">Check back later for updates</p>
    </div>
  ) : (
    <div className="space-y-4">
      {announcements.map((ann: any, i: number) => (
        <motion.div key={ann.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }} className="layer-card p-6">
          <div className="flex items-start justify-between mb-2">
            <h3 className="text-base font-semibold text-gray-800">{ann.title}</h3>
            <span className={cn('badge text-xs', PRIORITY_COLORS[ann.priority] || PRIORITY_COLORS.NORMAL)}>
              {ann.priority}
            </span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">{ann.content}</p>
          <p className="text-xs text-gray-400 mt-3">{formatDate(ann.createdAt, 'long')}</p>
        </motion.div>
      ))}
    </div>
  );
}

function SocialWall() {
  const { data: res, refetch } = useGetSocialPostsQuery();
  const [createPost, { isLoading: posting }] = useCreatePostMutation();
  const [likePost] = useLikePostMutation();
  const [commentPost] = useCommentPostMutation();
  const [newPost, setNewPost] = useState('');
  const user = useAppSelector((s) => s.auth.user);
  const posts = res?.data || [];

  const handlePost = async () => {
    if (!newPost.trim()) return;
    try {
      await createPost({ content: newPost }).unwrap();
      setNewPost('');
      refetch();
      toast.success('Posted!');
    } catch { toast.error('Failed to post'); }
  };

  return (
    <div className="max-w-2xl">
      {/* New post */}
      <div className="layer-card p-4 mb-6">
        <div className="flex gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm flex-shrink-0">
            {getInitials(user?.firstName, user?.lastName)}
          </div>
          <div className="flex-1">
            <textarea value={newPost} onChange={(e) => setNewPost(e.target.value)}
              placeholder="Share something with your team..."
              className="input-glass w-full h-16 resize-none text-sm" />
            <div className="flex justify-end mt-2">
              <button onClick={handlePost} disabled={posting || !newPost.trim()}
                className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50">
                {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Post
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Posts */}
      {posts.length === 0 ? (
        <div className="layer-card p-12 text-center">
          <MessageCircle size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">No posts yet. Be the first to share!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post: any) => (
            <motion.div key={post.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="layer-card p-5">
              <div className="flex gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 font-semibold text-sm">
                  {post.authorId?.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">Team Member</p>
                  <p className="text-xs text-gray-400">{formatDate(post.createdAt)}</p>
                </div>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{post.content}</p>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-50">
                <button onClick={() => likePost(post.id).then(() => refetch())}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 transition-colors">
                  <ThumbsUp size={14} /> {post._count?.likes || 0}
                </button>
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <MessageCircle size={14} /> {post._count?.comments || 0}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
