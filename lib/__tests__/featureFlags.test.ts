import { afterEach, describe, expect, it, vi } from 'vitest';

const loadFeatureFlags = async (env: {
  purchasePackageV2?: string;
  purchasePackageV2SiteIds?: string;
} = {}) => {
  vi.resetModules();
  vi.stubEnv('VITE_ENABLE_PURCHASE_PACKAGE_V2', env.purchasePackageV2);
  vi.stubEnv('VITE_PURCHASE_PACKAGE_V2_SITE_IDS', env.purchasePackageV2SiteIds);

  return import('../featureFlags');
};

describe('feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enables purchase package V2 by default when no rollout env is configured', async () => {
    const flags = await loadFeatureFlags();

    expect(flags.isPurchasePackageV2Enabled).toBe(true);
    expect(flags.isPurchasePackageV2EnabledForSite('site-1')).toBe(true);
    expect(flags.isPurchasePackageV2EnabledForSite(null)).toBe(true);
  });

  it('allows purchase package V2 to be disabled explicitly', async () => {
    const flags = await loadFeatureFlags({ purchasePackageV2: 'false' });

    expect(flags.isPurchasePackageV2Enabled).toBe(false);
    expect(flags.isPurchasePackageV2EnabledForSite('site-1')).toBe(false);
  });

  it('can still limit purchase package V2 to selected construction sites', async () => {
    const flags = await loadFeatureFlags({
      purchasePackageV2SiteIds: 'site-1, site-2',
    });

    expect(flags.isPurchasePackageV2EnabledForSite('site-1')).toBe(true);
    expect(flags.isPurchasePackageV2EnabledForSite('site-2')).toBe(true);
    expect(flags.isPurchasePackageV2EnabledForSite('site-3')).toBe(false);
    expect(flags.isPurchasePackageV2EnabledForSite(null)).toBe(false);
  });
});
