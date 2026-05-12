/**
 * Strips internal paths, stack traces, and sensitive details from error messages
 * before they are sent in API responses.
 */
export function sanitizeErrorMessage(message: string): string {
  // Remove file system paths (Windows and Unix)
  let sanitized = message.replace(/([A-Za-z]:)?[\\/][\w\s\\/.-]+\.(ts|js|json)/g, '[internal]');
  // Remove PostgreSQL connection strings
  sanitized = sanitized.replace(/postgresql:\/\/[^@]+@[^\s]+/gi, '[connection-string]');
  sanitized = sanitized.replace(/postgres:\/\/[^@]+@[^\s]+/gi, '[connection-string]');
  // Remove Redis connection strings
  sanitized = sanitized.replace(/redis:\/\/[^\s]+/gi, '[connection-string]');
  // Remove stack trace lines (e.g. "    at Object.<anonymous> ...")
  sanitized = sanitized.replace(/\s+at\s+\S+.*$/gm, '');
  // Cap length to prevent oversized error payloads
  if (sanitized.length > 200) sanitized = sanitized.substring(0, 200) + '...';
  return sanitized.trim();
}
