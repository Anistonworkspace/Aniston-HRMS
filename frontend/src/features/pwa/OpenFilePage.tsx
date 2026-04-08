import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download, AlertCircle, Loader2 } from 'lucide-react';

/**
 * PWA File Handler — receives files opened with Aniston HRMS from the OS file picker.
 * Manifest declares: { action: '/open-file', accept: { 'application/pdf': ['.pdf'] } }
 * The browser passes opened file via window.launchQueue (File Handling API).
 */
export default function OpenFilePage() {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUrl,  setFileUrl]  = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const launchQueue = (window as any).launchQueue;

    if (!launchQueue) {
      // File Handling API not supported — redirect to documents page
      navigate('/my-documents', { replace: true });
      return;
    }

    launchQueue.setConsumer(async (launchParams: any) => {
      try {
        if (!launchParams.files || launchParams.files.length === 0) {
          navigate('/my-documents', { replace: true });
          return;
        }

        const fileHandle = launchParams.files[0];
        const file: File = await fileHandle.getFile();
        setFileName(file.name);

        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        setFileUrl(url);
      } catch (err) {
        setError('Could not open the file. Please try again.');
      } finally {
        setLoading(false);
      }
    });

    // Timeout fallback if launchQueue never fires (e.g. navigated directly)
    const fallback = setTimeout(() => {
      setLoading(false);
      navigate('/my-documents', { replace: true });
    }, 3000);

    return () => {
      clearTimeout(fallback);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-1 flex items-center justify-center">
        <Loader2 size={32} className="text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-red-100 p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={28} className="text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Could Not Open File</h1>
          <p className="text-sm text-gray-500 mb-6">{error}</p>
          <button
            onClick={() => navigate('/my-documents', { replace: true })}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Go to Documents
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-1 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
          <FileText size={18} className="text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{fileName}</p>
          <p className="text-xs text-gray-400">Opened in Aniston HRMS</p>
        </div>
        {fileUrl && (
          <a
            href={fileUrl}
            download={fileName || 'document.pdf'}
            className="p-2 text-gray-500 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors"
            title="Download"
          >
            <Download size={18} />
          </a>
        )}
        <button
          onClick={() => navigate('/my-documents', { replace: true })}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          My Docs
        </button>
      </div>

      {/* PDF Viewer */}
      {fileUrl && (
        <iframe
          src={fileUrl}
          title={fileName || 'Document'}
          className="flex-1 w-full"
          style={{ minHeight: 'calc(100vh - 57px)', border: 'none' }}
        />
      )}
    </div>
  );
}
