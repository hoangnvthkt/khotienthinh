import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  isFreshPhoto,
  locationPermissionSteps,
  locationPromptTip,
  PHOTO_MAX_AGE_MS,
  shouldUseNativeCamera,
} from '../attendanceCapture';

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

describe('chấm công trên điện thoại', () => {
  it('dùng camera của máy trên iPhone, iPad, Android; máy tính giữ camera trực tiếp', () => {
    expect(detectPlatform(SAFARI_IPHONE, 5)).toBe('ios');
    expect(detectPlatform(IPAD_DESKTOP_MODE, 5)).toBe('ios');
    expect(detectPlatform(IPAD_DESKTOP_MODE, 0)).toBe('other');
    expect(detectPlatform(CHROME_ANDROID, 5)).toBe('android');
    expect(detectPlatform(CHROME_WINDOWS, 0)).toBe('other');

    expect(shouldUseNativeCamera('ios')).toBe(true);
    expect(shouldUseNativeCamera('android')).toBe(true);
    expect(shouldUseNativeCamera('other')).toBe(false);
  });

  it('chỉ nhận ảnh vừa chụp', () => {
    const now = 1_800_000_000_000;
    expect(isFreshPhoto(now - 5_000, now)).toBe(true);
    expect(isFreshPhoto(now - PHOTO_MAX_AGE_MS, now)).toBe(true);
    expect(isFreshPhoto(now - PHOTO_MAX_AGE_MS - 1, now)).toBe(false);
    expect(isFreshPhoto(now - 3 * 24 * 3600 * 1000, now)).toBe(false);
    expect(isFreshPhoto(now + 5 * 60 * 1000, now)).toBe(false);
    expect(isFreshPhoto(0, now)).toBe(false);
    expect(isFreshPhoto(Number.NaN, now)).toBe(false);
  });

  it('hướng dẫn cấp quyền vị trí đúng theo loại máy', () => {
    expect(locationPermissionSteps('ios').join(' ')).toMatch(/Safari/);
    expect(locationPermissionSteps('android').join(' ')).toMatch(/Chrome/);
    expect(locationPermissionSteps('other').length).toBeGreaterThan(0);
    expect(locationPromptTip('android')).toMatch(/Khi dùng trang web/);
    expect(locationPromptTip('ios')).toMatch(/Cho phép/);
    expect(locationPromptTip('other')).toBeNull();
  });

  it('màn chấm công: không xin quyền camera trên điện thoại, chụp bằng camera của máy', () => {
    const page = readFileSync(join(process.cwd(), 'pages', 'hrm', 'CheckIn.tsx'), 'utf8');
    expect(page).toContain('if (!nativeCamera) void startCamera();');
    expect(page).toContain('capture="user"');
    expect(page).toContain("const permission = await queryLocationPermission();");
    expect(page).toContain('<InAppBrowserNotice');
  });
});
