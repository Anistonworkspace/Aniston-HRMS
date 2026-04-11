import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import './i18n'; // Initialize i18n before app renders

// ===== PWA Install Prompt — capture BEFORE any lazy routes load =====
// beforeinstallprompt fires once during page load. DownloadPage is lazy-loaded,
// so its own listener would miss it. We capture here and store on window.
(window as any).__pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as any).__pwaInstallPrompt = e;
  window.dispatchEvent(new Event('pwa-prompt-ready'));
});

// ===== PWA Native App Behaviors =====
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || (navigator as any).standalone === true;

// Always prevent zoom on mobile (browser + standalone)
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

if (isMobile || isStandalone) {
  // Prevent pinch-to-zoom
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

  // Prevent multi-touch zoom
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // Prevent double-tap zoom on iOS
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
