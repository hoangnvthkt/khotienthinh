import { webPushService } from './webPushService';

export type ServiceWorkerRuntimeState = 'unsupported' | 'unregistered' | 'installing' | 'waiting' | 'active';

export interface PWAStatus {
  isStandalone: boolean;
  isIOS: boolean;
  platform: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  isSecureContext: boolean;
  serviceWorkerSupported: boolean;
  serviceWorkerControlled: boolean;
  serviceWorkerState: ServiceWorkerRuntimeState;
  scope?: string;
  manifestHref?: string;
}

const hasWindow = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

const getServiceWorkerState = (registration?: ServiceWorkerRegistration | null): ServiceWorkerRuntimeState => {
  if (!hasWindow() || !('serviceWorker' in navigator)) return 'unsupported';
  if (!registration) return 'unregistered';
  if (registration.waiting) return 'waiting';
  if (registration.installing) return 'installing';
  if (registration.active) return 'active';
  return 'unregistered';
};

export const pwaService = {
  async getStatus(): Promise<PWAStatus> {
    const serviceWorkerSupported = hasWindow() && 'serviceWorker' in navigator;
    const registration = serviceWorkerSupported
      ? await navigator.serviceWorker.getRegistration('/').catch(() => null)
      : null;
    const manifestLink = hasWindow()
      ? document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
      : null;

    return {
      isStandalone: webPushService.isStandalonePWA(),
      isIOS: webPushService.isIOS(),
      platform: webPushService.getPlatform(),
      deviceType: webPushService.getDeviceType(),
      isSecureContext: hasWindow() ? window.isSecureContext : false,
      serviceWorkerSupported,
      serviceWorkerControlled: Boolean(serviceWorkerSupported && navigator.serviceWorker.controller),
      serviceWorkerState: getServiceWorkerState(registration),
      scope: registration?.scope,
      manifestHref: manifestLink?.href,
    };
  },

  getInstallModeLabel(status: PWAStatus): string {
    return status.isStandalone ? 'Đang mở bằng ứng dụng' : 'Đang mở bằng trình duyệt';
  },

  getServiceWorkerLabel(status: PWAStatus): string {
    if (!status.serviceWorkerSupported) return 'Không hỗ trợ';
    if (status.serviceWorkerState === 'unregistered') return 'Chưa đăng ký';
    if (status.serviceWorkerState === 'waiting') return 'Có bản cập nhật đang chờ';
    if (status.serviceWorkerState === 'installing') return 'Đang cài service worker';
    if (status.serviceWorkerControlled) return 'Đang kiểm soát app';
    return 'Đã active, sẽ kiểm soát ở lần tải tiếp theo';
  },
};
