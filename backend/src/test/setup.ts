/**
 * Global test setup — runs before every test file.
 * Sets required environment variables so modules that read them at import time
 * (encryption, env config) don't throw.
 */

// Must be set BEFORE any module import that reads process.env
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-at-least-32-chars-long!!';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-that-is-at-least-32-chars';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
