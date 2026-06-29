type NavigatorWithBadging = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

const normalizeBadgeCount = (count: number) => {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(100, Math.floor(count)));
};

const logBadgeError = (error: unknown) => {
  if (import.meta.env.DEV) {
    console.warn('App badge update failed:', error);
  }
};

export const appBadgeService = {
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'setAppBadge' in navigator;
  },

  async setUnreadCount(count: number): Promise<boolean> {
    if (typeof navigator === 'undefined') return false;

    const badgeNavigator = navigator as NavigatorWithBadging;
    if (!badgeNavigator.setAppBadge) return false;

    const normalizedCount = normalizeBadgeCount(count);
    try {
      if (normalizedCount > 0) {
        await badgeNavigator.setAppBadge(normalizedCount);
      } else if (badgeNavigator.clearAppBadge) {
        await badgeNavigator.clearAppBadge();
      } else {
        await badgeNavigator.setAppBadge(0);
      }
      return true;
    } catch (error) {
      logBadgeError(error);
      return false;
    }
  },
};
