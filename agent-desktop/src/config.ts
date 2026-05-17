export const CONFIG = {
  API_URL: process.env.ANISTON_API_URL || 'https://hr.anistonav.com/api',
  TRACKING_INTERVAL_MS: 30_000,         // 30 seconds — check active window
  SCREENSHOT_INTERVAL_MS: 600_000,      // 10 minutes — take screenshot (overridden by live mode)
  SYNC_INTERVAL_MS: 60_000,             // 1 minute — sync heartbeat batch to server
  CONFIG_POLL_INTERVAL_MS: 300_000,     // 5 minutes — poll server config (was 30s = 120 req/hr)
  IDLE_THRESHOLD_S: 300,                // 5 minutes idle = inactive
  APP_NAME: 'Aniston Agent',
};

// App categories for productivity classification
export const PRODUCTIVE_APPS = [
  'code', 'visual studio', 'intellij', 'webstorm', 'sublime', 'notepad++',
  'terminal', 'powershell', 'cmd', 'git',
  'excel', 'word', 'powerpoint', 'outlook', 'teams', 'slack',
  'figma', 'photoshop', 'illustrator',
  'postman', 'pgadmin', 'mongodb compass',
  'chrome', 'firefox', 'edge', // browsers counted as productive by default
];

export const UNPRODUCTIVE_APPS = [
  'netflix', 'youtube music', 'spotify', 'vlc', 'whatsapp desktop',
  'telegram', 'discord', 'facebook', 'instagram', 'twitter',
  'steam', 'epic games', 'minecraft',
];

export function categorizeApp(appName: string): 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE' {
  const lower = appName.toLowerCase();
  if (PRODUCTIVE_APPS.some(a => lower.includes(a))) return 'PRODUCTIVE';
  if (UNPRODUCTIVE_APPS.some(a => lower.includes(a))) return 'UNPRODUCTIVE';
  return 'NEUTRAL';
}
