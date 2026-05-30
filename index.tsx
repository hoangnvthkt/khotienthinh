import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const normalizeHashRouterUrl = () => {
  if (typeof window === 'undefined') return;

  const { pathname, search, hash } = window.location;
  if (hash || pathname === '/' || pathname === '/index.html') return;
  if (/\.[a-z0-9]+$/i.test(pathname)) return;

  window.history.replaceState(null, '', `/#${pathname}${search}`);
};

normalizeHashRouterUrl();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const clearDevAppCaches = async () => {
  if (!('caches' in window)) return;

  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('vioo-'))
        .map(key => caches.delete(key))
    );
  } catch (err) {
    console.warn('Dev cache cleanup failed:', err);
  }
};

const reloadDevOnceAfterServiceWorkerCleanup = () => {
  const key = 'dev_sw_cleanup_reload_at';
  const now = Date.now();
  const lastReloadAt = Number(sessionStorage.getItem(key) || 0);

  if (Number.isFinite(lastReloadAt) && now - lastReloadAt < 30000) return;

  sessionStorage.setItem(key, String(now));
  window.location.reload();
};

const unregisterDevServiceWorkers = async () => {
  if (!('serviceWorker' in navigator)) return;

  let shouldReload = Boolean(navigator.serviceWorker.controller);

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const sameOriginRegistrations = registrations.filter(registration => {
      const scriptUrl =
        registration.active?.scriptURL ||
        registration.waiting?.scriptURL ||
        registration.installing?.scriptURL ||
        '';

      if (!scriptUrl) return true;
      return new URL(scriptUrl, window.location.origin).origin === window.location.origin;
    });

    if (sameOriginRegistrations.length > 0) {
      shouldReload = true;
      await Promise.all(sameOriginRegistrations.map(registration => registration.unregister()));
    }
  } catch (err) {
    console.warn('Dev service worker cleanup failed:', err);
  }

  await clearDevAppCaches();

  if (shouldReload) {
    reloadDevOnceAfterServiceWorkerCleanup();
  }
};

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    });
  } else {
    void unregisterDevServiceWorkers();
  }
}
