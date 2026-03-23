const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

interface UploadResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Upload a file to the backend with progress tracking.
 */
export function uploadFile(
  file: File,
  endpoint: string,
  extraFields?: Record<string, string>,
  onProgress?: (progress: UploadProgress) => void,
  token?: string
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    if (extraFields) {
      Object.entries(extraFields).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percentage: Math.round((e.loaded / e.total) * 100),
        });
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ success: true, data: response.data });
        } else {
          resolve({ success: false, error: response.error?.message || 'Upload failed' });
        }
      } catch {
        resolve({ success: false, error: 'Invalid server response' });
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.open('POST', `${API_URL}${endpoint}`);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}

/**
 * Validate a file before upload.
 */
export function validateFile(
  file: File,
  options: { maxSizeMB?: number; allowedTypes?: string[] } = {}
): string | null {
  const { maxSizeMB = 10, allowedTypes } = options;

  if (file.size > maxSizeMB * 1024 * 1024) {
    return `File size exceeds ${maxSizeMB}MB limit`;
  }

  if (allowedTypes && !allowedTypes.includes(file.type)) {
    return `File type "${file.type}" is not allowed`;
  }

  return null; // Valid
}

/**
 * Get a human-readable file size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
