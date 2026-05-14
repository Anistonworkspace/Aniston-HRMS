import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import './styles/globals.css';
import './i18n'; // Initialize i18n before app renders

// Disable backdrop-filter on native Android/iOS to prevent ANR during keyboard/resize events
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('capacitor-native');
}

// ===== PWA Install Prompt — capture BEFORE any lazy routes load =====
// beforeinstallprompt fires once during page load. DownloadPage is lazy-loaded,
// so its own listener would miss it. We capture here and store on window.
// Suppress entirely inside the native APK — users already have the app.
(window as any).__pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (Capacitor.isNativePlatform()) return; // inside APK — never show PWA install banner
  (window as any).__pwaInstallPrompt = e;
  window.dispatchEvent(new Event('pwa-prompt-ready'));
});

// ===== PWA Native App Behaviors =====
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || (navigator as any).standalone === true;

// Only disable double-tap zoom in standalone PWA mode.
// WCAG 1.4.4 requires that users can zoom to 200% — we must NOT prevent
// pinch-to-zoom in the browser. Standalone PWA is treated as a native app
// where the OS controls zoom separately; browser users must retain full zoom.
if (isStandalone) {
  // Prevent double-tap zoom on iOS (standalone only)
  // touch-action:manipulation in globals.css handles this for most cases,
  // but this JS fallback catches older iOS versions.
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}

if (isStandalone) {
  // Prevent long-press context menu in PWA mode
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    e.preventDefault();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
