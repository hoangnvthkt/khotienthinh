import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

type PushCapability = {
  supported: boolean;
  reason?: 'missing_vapid_key' | 'unsupported_browser' | 'insecure_context' | 'ios_requires_standalone';
};

const APP_MANIFEST_ID = '/';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
};

const uint8ArrayToUrlBase64 = (value: ArrayBuffer | null) => {
  if (!value) return '';
  const bytes = new Uint8Array(value);
  const binary = String.fromCharCode(...bytes);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const getSubscriptionKeys = (subscription: PushSubscription) => {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh || '',
    auth: json.keys?.auth || '',
  };
};

const usesCurrentVapidKey = (subscription: PushSubscription) => {
  const key = subscription.options?.applicationServerKey || null;
  if (!key) return true;
  return uint8ArrayToUrlBase64(key) === VAPID_PUBLIC_KEY.replace(/=+$/, '');
};

const hasWindow = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

const isLocalhost = () => hasWindow() && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

const isSecurePushContext = () => hasWindow() && (window.isSecureContext || isLocalhost());

const getUserAgent = () => hasWindow() ? navigator.userAgent : '';

const getNow = () => new Date().toISOString();

const getBrowser = () => {
  if (!hasWindow()) return 'unknown';
  const ua = getUserAgent();
  if (/CriOS/i.test(ua)) return 'chrome-ios';
  if (/FxiOS/i.test(ua)) return 'firefox-ios';
  if (/EdgiOS/i.test(ua)) return 'edge-ios';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Chrome|Chromium|CriOS/i.test(ua) && !/Edg\//i.test(ua)) return 'chrome';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg\//i.test(ua)) return 'safari';
  return 'unknown';
};

const getVapidPublicKeyHash = () => {
  let hash = 0;
  for (let i = 0; i < VAPID_PUBLIC_KEY.length; i++) {
    hash = Math.imul(31, hash) + VAPID_PUBLIC_KEY.charCodeAt(i) | 0;
  }
  return Math.abs(hash).toString(16);
};

export const webPushService = {
  isIOS() {
    if (!hasWindow()) return false;
    const ua = getUserAgent();
    const iOSDevice = /iPad|iPhone|iPod/.test(ua);
    const iPadOSDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return iOSDevice || iPadOSDesktopMode;
  },

  isStandalonePWA() {
    if (!hasWindow()) return false;
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    );
  },

  getDeviceType(): 'desktop' | 'mobile' | 'tablet' {
    if (!hasWindow()) return 'desktop';
    const ua = getUserAgent();
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return 'tablet';
    }
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile';
    return 'desktop';
  },

  getPlatform(): string {
    if (!hasWindow()) return 'unknown';
    const ua = getUserAgent();
    if (this.isIOS()) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Win/i.test(navigator.platform)) return 'windows';
    if (/Mac/i.test(navigator.platform)) return 'macos';
    if (/Linux/i.test(navigator.platform)) return 'linux';
    return 'unknown';
  },

  getCapability(): PushCapability {
    if (!VAPID_PUBLIC_KEY) return { supported: false, reason: 'missing_vapid_key' };
    if (!hasWindow() || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return { supported: false, reason: 'unsupported_browser' };
    }
    if (!isSecurePushContext()) return { supported: false, reason: 'insecure_context' };
    if (this.isIOS() && !this.isStandalonePWA()) {
      return { supported: false, reason: 'ios_requires_standalone' };
    }
    return { supported: true };
  },

  isPushSupported() {
    return this.getCapability().supported;
  },

  isSupported() {
    return this.isPushSupported();
  },

  getNotificationPermission(): NotificationPermission {
    if (!hasWindow() || !('Notification' in window)) return 'denied';
    return Notification.permission;
  },

  async requestNotificationPermission(): Promise<NotificationPermission> {
    if (!hasWindow() || !('Notification' in window)) return 'denied';
    if (!this.getCapability().supported) return 'denied';
    return Notification.requestPermission();
  },

  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!hasWindow() || !('serviceWorker' in navigator)) return null;
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) return existing;
    return navigator.serviceWorker.register('/sw.js');
  },

  async getCurrentSubscription(): Promise<PushSubscription | null> {
    if (!this.isPushSupported()) return null;
    const registration = await this.registerServiceWorker();
    if (!registration) return null;
    return registration.pushManager.getSubscription();
  },

  async syncSubscriptionToSupabase(userId: string, subscription: PushSubscription): Promise<void> {
    const keys = getSubscriptionKeys(subscription);
    if (!keys.p256dh || !keys.auth) throw new Error('Push subscription keys are missing.');

    const now = getNow();
    const { error } = await supabase.from('web_push_subscriptions').upsert({
      user_id: userId,
      endpoint: keys.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent,
      platform: this.getPlatform(),
      device_type: this.getDeviceType(),
      browser: getBrowser(),
      is_standalone_pwa: this.isStandalonePWA(),
      manifest_id: APP_MANIFEST_ID,
      vapid_public_key_hash: getVapidPublicKeyHash(),
      notification_permission: this.getNotificationPermission(),
      is_active: true,
      updated_at: now,
      last_seen_at: now,
      last_used_at: now,
    }, { onConflict: 'endpoint' });

    if (error) throw error;
  },

  async subscribeUserToPush(userId?: string): Promise<boolean> {
    if (!userId || !this.isPushSupported()) return false;
    if (this.getNotificationPermission() !== 'granted') return false;

    const registration = await this.registerServiceWorker();
    if (!registration) return false;

    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !usesCurrentVapidKey(subscription)) {
      const staleEndpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => false);
      await supabase
        .from('web_push_subscriptions')
        .update({ is_active: false, updated_at: getNow(), last_used_at: getNow() })
        .eq('user_id', userId)
        .eq('endpoint', staleEndpoint);
      subscription = null;
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    await this.syncSubscriptionToSupabase(userId, subscription);
    return true;
  },

  async unsubscribeUserFromPush(userId?: string): Promise<boolean> {
    if (!userId || !hasWindow() || !('serviceWorker' in navigator)) return false;
    const subscription = await this.getCurrentSubscription();
    if (!subscription) return false;

    const now = getNow();
    const { error } = await supabase
      .from('web_push_subscriptions')
      .update({ is_active: false, updated_at: now, last_used_at: now })
      .eq('user_id', userId)
      .eq('endpoint', subscription.endpoint);
    if (error) throw error;

    await subscription.unsubscribe();
    return true;
  },

  async disablePushForThisDevice(userId?: string): Promise<boolean> {
    return this.unsubscribeUserFromPush(userId);
  },

  async isEnabledForThisDevice(userId?: string): Promise<boolean> {
    if (!userId) return false;
    const subscription = await this.getCurrentSubscription();
    if (!subscription) return false;

    const { data, error } = await supabase
      .from('web_push_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('endpoint', subscription.endpoint)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  },

  async ensureSubscription(userId?: string) {
    return this.subscribeUserToPush(userId);
  },
};
