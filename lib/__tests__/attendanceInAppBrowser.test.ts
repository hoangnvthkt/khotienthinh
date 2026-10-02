import { describe, expect, it } from 'vitest';
import { chromeIntentUrl, detectInAppBrowser, isIosDevice } from '../attendancePasskey';

// Real user agents seen on punches, 01–02/10/2026.
const ZALO_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007;) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.36 Mobile Safari/537.36 Zalo android/260901903 ZaloTheme/light ZaloLanguage/vi';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/130.0.0.0 Mobile Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const FACEBOOK_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]';
const ANDROID_WEBVIEW = 'Mozilla/5.0 (Linux; Android 13; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0 Mobile Safari/537.36';

describe('detectInAppBrowser', () => {
  it('names the app whose built-in browser cannot do fingerprint / Face ID', () => {
    expect(detectInAppBrowser(ZALO_ANDROID)).toBe('Zalo');
    expect(detectInAppBrowser(FACEBOOK_IPHONE)).toBe('Facebook');
    expect(detectInAppBrowser(ANDROID_WEBVIEW)).toBe('ứng dụng này');
  });

  it('leaves real browsers alone', () => {
    expect(detectInAppBrowser(CHROME_ANDROID)).toBeNull();
    expect(detectInAppBrowser(SAMSUNG)).toBeNull();
    expect(detectInAppBrowser(SAFARI_IPHONE)).toBeNull();
  });

  it('builds an Android link that reopens the app in Chrome', () => {
    expect(isIosDevice(SAFARI_IPHONE)).toBe(true);
    expect(chromeIntentUrl('https://khotienthinh.vercel.app')).toBe(
      'intent://khotienthinh.vercel.app/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fkhotienthinh.vercel.app%2F;end',
    );
  });
});
