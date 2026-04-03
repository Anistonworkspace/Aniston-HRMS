import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Megaphone, Plus, X, MessageCircle, Send, ThumbsUp, Loader2,
  Trash2, Edit3, Clock, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  useGetAnnouncementsQuery, useCreateAnnouncementMutation, useUpdateAnnouncementMutation,
  useDeleteAnnouncementMutation, useGetSocialPostsQuery, useCreatePostMutation,
  useLikePostMutation, useCommentPostMutation, useDeleteSocialPostMutation,
} from './announcementApi';
import { cn, formatDate, getInitials } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  NORMAL: 'bg-blue-50 text-blue-600',
  HIGH: 'bg-amber-50 text-amber-700',
  URGENT: 'bg-red-50 text-red-700',
};

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

function getAuthorName(author: any): string {
  if (!author) return 'Unknown';
  if (author.employee) return `${author.employee.firstName} ${author.employee.lastName}`;
  return author.email?.split('@')[0] || 'Unknown';
}

function getAuthorInitials(author: any): string {
  if (!author) return '?';
  if (author.employee) return getInitials(author.employee.firstName, author.employee.lastName);
  return (author.email?.charAt(0) || '?').toUpperCase();
}

function timeAgo(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(date);
}

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

      <div className="flex gap-1 bg-surface-2 rounded-lg p-1 w-fit mb-6">
        <button onClick={() => setTab('announcements')}
          className={cn('px-4 py-2 rounded-md text-sm font-medium transition-colors',
            tab === 'announcements' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          )}>
          <Megaphone size={14} className="inline mr-1.5 -mt-0.5" /> Announcements
        </button>
        <button onClick={() => setTab('social')}
          className={cn('px-4 py-2 rounded-md text-sm font-medium transition-colors',
            tab === 'social' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          )}>
          <MessageCircle size={14} className="inline mr-1.5 -mt-0.5" /> Social Wall
        </button>
      </div>

      {tab === 'announcements' ? <AnnouncementsList /> : <SocialWall />}
    </div>
  );
}

/* ===== ANNOUNCEMENTS LIST ===== */
function AnnouncementsList() {
  const user = useAppSelector(s => s.auth.user);
  const isManagement = user?.role ? MANAGEMENT_ROLES.includes(user.role) : false;
  const { data: res, isLoading, isError } = useGetAnnouncementsQuery();
  const [createAnnouncement, { isLoading: creating }] = useCreateAnnouncementMutation();
  const [updateAnnouncement] = useUpdateAnnouncementMutation();
  const [deleteAnnouncement] = useDeleteAnnouncementMutation();
  const announcements = res?.data || [];
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', content: '', priority: 'NORMAL', expiresAt: '' });

  const resetForm = () => {
    setForm({ title: '', content: '', priority: 'NORMAL', expiresAt: '' });
    setEditId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!form.title || !form.content) { toast.error('Title and content required'); return; }
    try {
      if (editId) {
        await updateAnnouncement({ id: editId, body: form }).unwrap();
        toast.success('Announcement updated');
      } else {
        await createAnnouncement(form).unwrap();
        toast.success('Announcement published');
      }
      resetForm();
    } catch { toast.error('Failed'); }
  };

  const handleEdit = (ann: any) => {
    setForm({
      title: ann.title,
      content: ann.content,
      priority: ann.priority || 'NORMAL',
      expiresAt: ann.expiresAt ? new Date(ann.expiresAt).toISOString().split('T')[0] : '',
    });
    setEditId(ann.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    try {
      await deleteAnnouncement(id).unwrap();
      toast.success('Deleted');
    } catch { toast.error('Failed'); }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
          <p className="text-sm text-gray-400">Loading announcements...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-3xl flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <AlertTriangle className="w-8 h-8 text-red-400" />
          <p className="text-sm text-gray-400">Failed to load announcements. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Create button for HR/Admin */}
      {isManagement && (
        <div className="mb-4">
          {!showForm ? (
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="btn-primary text-sm flex items-center gap-1.5">
              <Plus size={14} /> New Announcement
            </button>
          ) : (
            <div className="layer-card p-5 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-gray-700">{editId ? 'Edit Announcement' : 'New Announcement'}</h3>
                <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title *</label>
                <input value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                  className="input-glass w-full text-sm" placeholder="Announcement title" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Content *</label>
                <textarea value={form.content} onChange={e => setForm({...form, content: e.target.value})}
                  className="input-glass w-full text-sm h-24 resize-none" placeholder="Write your announcement..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Priority</label>
                  <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}
                    className="input-glass w-full text-sm">
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Expires At</label>
                  <input type="date" value={form.expiresAt} onChange={e => setForm({...form, expiresAt: e.target.value})}
                    className="input-glass w-full text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSubmit} disabled={creating} className="btn-primary text-sm">
                  {creating ? 'Saving...' : editId ? 'Update' : 'Publish'}
                </button>
                <button onClick={resetForm} className="btn-secondary text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Announcements list */}
      {announcements.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <Megaphone size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600">No announcements</h3>
          <p className="text-sm text-gray-400 mt-1">Check back later for updates</p>
        </div>
      ) : (
        <div className="space-y-4">
          {announcements.map((ann: any, i: number) => (
            <motion.div key={ann.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }} className="layer-card p-6">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center text-brand-700 font-semibold text-sm flex-shrink-0">
                    {getAuthorInitials(ann.author)}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-800">{ann.title}</h3>
                    <p className="text-xs text-gray-400">
                      {getAuthorName(ann.author)} · {timeAgo(ann.createdAt)}
                      {ann.expiresAt && (
                        <span className="ml-2 text-amber-500">
                          <Clock size={10} className="inline -mt-0.5 mr-0.5" />
                          Expires {formatDate(ann.expiresAt)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('badge text-xs', PRIORITY_COLORS[ann.priority] || PRIORITY_COLORS.NORMAL)}>
                    {ann.priority}
                  </span>
                  {isManagement && (
                    <div className="flex gap-1">
                      <button onClick={() => handleEdit(ann)} className="text-gray-300 hover:text-brand-600 p-1">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => handleDelete(ann.id)} className="text-gray-300 hover:text-red-500 p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed ml-12">{ann.content}</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== SOCIAL WALL ===== */
function SocialWall() {
  const { data: res } = useGetSocialPostsQuery();
  const [createPost, { isLoading: posting }] = useCreatePostMutation();
  const [likePost] = useLikePostMutation();
  const [commentPost] = useCommentPostMutation();
  const [deleteSocialPost] = useDeleteSocialPostMutation();
  const [newPost, setNewPost] = useState('');
  const user = useAppSelector(s => s.auth.user);
  const posts = res?.data || [];

  const handlePost = async () => {
    if (!newPost.trim()) return;
    try {
      await createPost({ content: newPost }).unwrap();
      setNewPost('');
      toast.success('Posted!');
    } catch { toast.error('Failed to post'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    try {
      await deleteSocialPost(id).unwrap();
      toast.success('Post deleted');
    } catch { toast.error('Failed'); }
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
            <textarea value={newPost} onChange={e => setNewPost(e.target.value)}
              placeholder="Share something with your team..."
              className="input-glass w-full h-16 resize-none text-sm"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost(); }}
            />
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
            <SocialPostCard key={post.id} post={post} user={user}
              onLike={() => likePost(post.id)}
              onComment={(content: string) => commentPost({ id: post.id, content })}
              onDelete={() => handleDelete(post.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== SINGLE POST CARD ===== */
function SocialPostCard({ post, user, onLike, onComment, onDelete }: {
  post: any; user: any;
  onLike: () => void;
  onComment: (content: string) => void;
  onDelete: () => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isAuthor = post.authorId === user?.userId;
  const isManagement = user?.role ? MANAGEMENT_ROLES.includes(user.role) : false;

  const handleComment = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    try {
      await onComment(commentText);
      setCommentText('');
      toast.success('Comment added');
    } catch { toast.error('Failed'); }
    setSubmitting(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="layer-card p-5">
      {/* Author header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600 font-semibold text-sm flex-shrink-0">
            {getAuthorInitials(post.author)}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">{getAuthorName(post.author)}</p>
            <p className="text-xs text-gray-400">{timeAgo(post.createdAt)}</p>
          </div>
        </div>
        {(isAuthor || isManagement) && (
          <button onClick={onDelete} className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>
        )}
      </div>

      {/* Content */}
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{post.content}</p>

      {post.imageUrl && (
        <img src={post.imageUrl} alt="" className="mt-3 rounded-lg max-h-64 object-cover w-full" />
      )}

      {/* Actions */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
        <button onClick={onLike}
          className={cn('flex items-center gap-1.5 text-xs transition-colors',
            post.likedByMe ? 'text-brand-600 font-medium' : 'text-gray-400 hover:text-brand-600'
          )}>
          <ThumbsUp size={14} className={post.likedByMe ? 'fill-brand-600' : ''} />
          {post._count?.likes || 0} {(post._count?.likes || 0) === 1 ? 'Like' : 'Likes'}
        </button>
        <button onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <MessageCircle size={14} />
          {post._count?.comments || 0} Comments
          {showComments ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Comments section */}
      <AnimatePresence>
        {showComments && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 pt-3 border-t border-gray-50 space-y-3">
              {/* Existing comments */}
              {(post.comments || []).map((c: any) => (
                <div key={c.id} className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-gray-50 flex items-center justify-center text-gray-500 font-medium text-[10px] flex-shrink-0">
                    {getAuthorInitials(c.author)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="bg-surface-2 rounded-lg px-3 py-2">
                      <p className="text-xs font-medium text-gray-700">{getAuthorName(c.author)}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{c.content}</p>
                    </div>
                    <p className="text-[10px] text-gray-300 mt-0.5 ml-1">{timeAgo(c.createdAt)}</p>
                  </div>
                </div>
              ))}

              {/* New comment input */}
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-md bg-brand-50 flex items-center justify-center text-brand-700 font-medium text-[10px] flex-shrink-0">
                  {getInitials(user?.firstName, user?.lastName)}
                </div>
                <div className="flex-1 flex gap-2">
                  <input value={commentText} onChange={e => setCommentText(e.target.value)}
                    placeholder="Write a comment..."
                    className="input-glass flex-1 text-xs py-1.5"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment(); } }}
                  />
                  <button onClick={handleComment} disabled={submitting || !commentText.trim()}
                    className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
                    {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
