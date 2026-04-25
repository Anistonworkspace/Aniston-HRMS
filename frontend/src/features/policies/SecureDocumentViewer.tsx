import { useState, useRef, useEffect, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Download, Loader2, Maximize2 } from 'lucide-react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../app/store';

// pdf.js loaded dynamically
let pdfjsLib: any = null;

interface SecureDocumentViewerProps {
  /** API endpoint that returns the PDF stream */
  streamUrl: string;
  /** Document title for the header */
  title: string;
  /** Whether download is allowed */
  downloadAllowed?: boolean;
  /** Download URL (only used if downloadAllowed) */
  downloadUrl?: string;
  /** Close callback */
  onClose: () => void;
}

/**
 * Secure canvas-based PDF viewer — no iframe, no native PDF viewer.
 * Renders PDF pages to canvas elements, preventing easy extraction.
 * Right-click, print, and text selection are disabled.
 */
export default function SecureDocumentViewer({
  streamUrl,
  title,
  downloadAllowed = false,
  downloadUrl,
  onClose,
}: SecureDocumentViewerProps) {
  const [pages, setPages] = useState<ImageData[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const token = useSelector((state: RootState) => state.auth.accessToken);

  const API_BASE = import.meta.env.VITE_API_URL === '/api' ? '' : (import.meta.env.VITE_API_URL?.replace('/api', '') || '');

  // Load pdf.js library dynamically — uses local worker (no CDN dependency)
  const loadPdfJs = useCallback(async () => {
    if (pdfjsLib) return pdfjsLib;
    // @ts-ignore
    const lib = await import('pdfjs-dist');
    // Use local worker file from /public — served at root, not under /uploads
    lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    pdfjsLib = lib;
    return lib;
  }, []);

  // Fetch and render PDF
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      try {
        setLoading(true);
        setError('');

        const lib = await loadPdfJs();

        // Fetch PDF with auth token
        const fullUrl = `${API_BASE}/api${streamUrl}`;
        const response = await fetch(fullUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          let msg = 'Failed to load document';
          try { const body = await response.json(); msg = body?.error?.message || msg; } catch { /* ignore */ }
          throw new Error(msg);
        }

        const arrayBuffer = await response.arrayBuffer();
        const pdf = await lib.getDocument({ data: arrayBuffer }).promise;

        if (cancelled) return;

        setTotalPages(pdf.numPages);

        // Render all pages to image data
        const renderedPages: ImageData[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const scale = 2; // High DPI rendering
          const viewport = page.getViewport({ scale });

          const offscreen = document.createElement('canvas');
          offscreen.width = viewport.width;
          offscreen.height = viewport.height;
          const ctx = offscreen.getContext('2d')!;

          await page.render({ canvasContext: ctx, viewport }).promise;
          const imageData = ctx.getImageData(0, 0, viewport.width, viewport.height);
          renderedPages.push(imageData);
        }

        if (cancelled) return;
        setPages(renderedPages);
        setCurrentPage(1);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load document');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [streamUrl, token, API_BASE, loadPdfJs]);

  // Render current page to canvas
  useEffect(() => {
    if (!canvasRef.current || pages.length === 0 || currentPage < 1) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pageData = pages[currentPage - 1];
    if (!pageData) return;

    canvas.width = pageData.width;
    canvas.height = pageData.height;

    // Apply zoom via CSS transform (keeps canvas crisp)
    canvas.style.transform = `scale(${zoom})`;
    canvas.style.transformOrigin = 'top center';

    ctx.putImageData(pageData, 0, 0);
  }, [currentPage, pages, zoom]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && currentPage < totalPages) setCurrentPage((p) => p + 1);
      if (e.key === 'ArrowLeft' && currentPage > 1) setCurrentPage((p) => p - 1);
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(z + 0.25, 3));
      if (e.key === '-') setZoom((z) => Math.max(z - 0.25, 0.5));
      // Block Ctrl+S, Ctrl+P
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'p')) {
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentPage, totalPages, onClose]);

  const handleDownload = async () => {
    if (!downloadAllowed || !downloadUrl) return;
    const fullUrl = `${API_BASE}/api${downloadUrl}`;
    const response = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/\s+/g, '_') + '.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-gray-900/95 flex flex-col"
      onContextMenu={(e) => e.preventDefault()}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {/* Print blocker */}
      <style>{`@media print { body * { display: none !important; } }`}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800/90 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
          <h3 className="text-white text-sm font-medium truncate max-w-md">{title}</h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors">
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors">
            <ZoomIn size={16} />
          </button>

          <div className="w-px h-5 bg-gray-600 mx-1" />

          {/* Page navigation */}
          <button onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))} disabled={currentPage <= 1}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded disabled:opacity-30 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-gray-400 w-20 text-center">
            {totalPages > 0 ? `${currentPage} / ${totalPages}` : '...'}
          </span>
          <button onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} disabled={currentPage >= totalPages}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded disabled:opacity-30 transition-colors">
            <ChevronRight size={16} />
          </button>

          <div className="w-px h-5 bg-gray-600 mx-1" />

          <button onClick={toggleFullscreen}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors">
            <Maximize2 size={16} />
          </button>

          {downloadAllowed && downloadUrl && (
            <button onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors">
              <Download size={14} /> Download
            </button>
          )}
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 overflow-auto flex items-start justify-center p-4"
        style={{ WebkitUserDrag: 'none' } as any}>
        {loading && (
          <div className="flex flex-col items-center gap-3 mt-32">
            <Loader2 size={32} className="animate-spin text-indigo-400" />
            <p className="text-gray-400 text-sm">Loading document...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 mt-32">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-sm underline">Close</button>
          </div>
        )}

        {!loading && !error && (
          <canvas
            ref={canvasRef}
            className="shadow-2xl rounded-sm"
            style={{
              maxWidth: '100%',
              pointerEvents: 'none',
              imageRendering: 'auto',
            }}
            onDragStart={(e) => e.preventDefault()}
          />
        )}
      </div>
    </div>
  );
}
