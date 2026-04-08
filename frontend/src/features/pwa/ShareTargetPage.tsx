import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Share2, ExternalLink, FileText, Loader2 } from 'lucide-react';

/**
 * PWA Share Target handler — receives shared content from the OS share sheet.
 * Manifest declares: { action: '/share-target', method: 'GET', params: { title, text, url } }
 * Browser navigates here when user picks "Aniston HRMS" from share tray.
 */
export default function ShareTargetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);

  const title = params.get('title') || '';
  const text  = params.get('text')  || '';
  const url   = params.get('url')   || '';

  const hasContent = title || text || url;

  // Auto-redirect to helpdesk after 5 s so the user can act on the shared content
  useEffect(() => {
    if (!hasContent) {
      navigate('/dashboard', { replace: true });
      return;
    }
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          // Encode shared content as a pre-filled helpdesk ticket URL
          const subject = encodeURIComponent(title || text || 'Shared content');
          navigate(`/helpdesk?subject=${subject}&body=${encodeURIComponent([title, text, url].filter(Boolean).join('\n'))}`, { replace: true });
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [hasContent, navigate, title, text, url]);

  return (
    <div className="min-h-screen bg-surface-1 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
          <Share2 size={28} className="text-indigo-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Content Received</h1>
        <p className="text-sm text-gray-500 mb-6">
          Opening in Helpdesk in {countdown}s…
        </p>

        {(title || text || url) && (
          <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2 mb-6">
            {title && (
              <div className="flex items-start gap-2">
                <FileText size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-gray-700 font-medium">{title}</span>
              </div>
            )}
            {text && (
              <p className="text-sm text-gray-600 break-words">{text}</p>
            )}
            {url && (
              <div className="flex items-center gap-2">
                <ExternalLink size={14} className="text-indigo-500 flex-shrink-0" />
                <a href={url} target="_blank" rel="noopener noreferrer"
                   className="text-sm text-indigo-600 hover:underline truncate">{url}</a>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => navigate('/dashboard', { replace: true })}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => {
              const subject = encodeURIComponent(title || text || 'Shared content');
              navigate(`/helpdesk?subject=${subject}&body=${encodeURIComponent([title, text, url].filter(Boolean).join('\n'))}`, { replace: true });
            }}
            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <Loader2 size={14} className="animate-spin" />
            Open Now
          </button>
        </div>
      </div>
    </div>
  );
}
