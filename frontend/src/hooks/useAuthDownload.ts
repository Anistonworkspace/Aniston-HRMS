import { useState, useCallback } from 'react';
import { useAppSelector } from '../app/store';
import toast from 'react-hot-toast';

/**
 * Hook for authenticated file downloads.
 * Uses fetch() with Authorization header instead of window.open() which loses the JWT.
 */
export function useAuthDownload() {
  const token = useAppSelector((state) => state.auth.accessToken);
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = useCallback(async (
    url: string,
    filename: string,
    options?: { onError?: (msg: string) => void }
  ) => {
    setDownloading(url);
    try {
      const apiBase = import.meta.env.VITE_API_URL === '/api' ? '/api' : (import.meta.env.VITE_API_URL || '/api');
      const fullUrl = url.startsWith('http') ? url : `${apiBase}${url}`;

      const res = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const msg = errorData?.error?.message || `Download failed (${res.status})`;
        if (options?.onError) options.onError(msg);
        else toast.error(msg);
        return null;
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      return blob;
    } catch (err: any) {
      const msg = err?.message || 'Download failed';
      if (options?.onError) options.onError(msg);
      else toast.error(msg);
      return null;
    } finally {
      setDownloading(null);
    }
  }, [token]);

  /**
   * Open file in new tab (for PDF viewing inline)
   */
  const openInline = useCallback(async (url: string) => {
    setDownloading(url);
    try {
      const apiBase = import.meta.env.VITE_API_URL === '/api' ? '/api' : (import.meta.env.VITE_API_URL || '/api');
      const fullUrl = url.startsWith('http') ? url : `${apiBase}${url}`;

      const res = await fetch(fullUrl, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        toast.error(errorData?.error?.message || `Failed to load (${res.status})`);
        return;
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to open file');
    } finally {
      setDownloading(null);
    }
  }, [token]);

  return { download, openInline, downloading };
}
