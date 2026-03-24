export const CONFIG = {
  API_URL: process.env.ANISTON_API_URL || 'http://localhost:4000/api',
  TRACKING_INTERVAL_MS: 30 * 1000,       // 30 seconds — active window check
  SCREENSHOT_INTERVAL_MS: 10 * 60 * 1000, // 10 minutes
  SYNC_INTERVAL_MS: 5 * 60 * 1000,        // 5 minutes — batch sync to API
  IDLE_THRESHOLD_MS: 5 * 60 * 1000,       // 5 minutes — mark as idle
  IDLE_CHECK_INTERVAL_MS: 10 * 1000,      // 10 seconds — idle detection polling
  SCREENSHOT_QUALITY: 60,                  // JPEG quality (0-100)
  MAX_OFFLINE_QUEUE: 500,                  // Max queued entries before oldest dropped
};
