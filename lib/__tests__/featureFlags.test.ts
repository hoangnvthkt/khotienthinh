import { afterEach, describe, expect, it, vi } from 'vitest';

const loadFeatureFlags = async (env: {
  purchasePackageV2?: string;
  purchasePackageV2SiteIds?: string;
  viooWork?: string;
  erpCompletionPilot?: string;
  erpCompletionPilotSiteIds?: string;
} = {}) => {
  vi.resetModules();
  vi.stubEnv('VITE_ENABLE_PURCHASE_PACKAGE_V2', env.purchasePackageV2);
  vi.stubEnv('VITE_PURCHASE_PACKAGE_V2_SITE_IDS', env.purchasePackageV2SiteIds);
  vi.stubEnv('VITE_ENABLE_VIOO_WORK', env.viooWork);
  vi.stubEnv('VITE_ENABLE_ERP_COMPLETION_PILOT', env.erpCompletionPilot);
  vi.stubEnv('VITE_ERP_COMPLETION_PILOT_SITE_IDS', env.erpCompletionPilotSiteIds);

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

  it('keeps Vioo Work disabled unless rollout explicitly enables it', async () => {
    const disabledFlags = await loadFeatureFlags();
    expect(disabledFlags.isViooWorkEnabled).toBe(false);

    const enabledFlags = await loadFeatureFlags({ viooWork: 'true' });
    expect(enabledFlags.isViooWorkEnabled).toBe(true);
  });

  it('keeps ERP completion off unless both the release and exact site are configured', async () => {
    const off = await loadFeatureFlags();
    expect(off.isErpCompletionPilotEnabled).toBe(false);
    expect(off.isErpCompletionPilotEnabledForSite('site-1')).toBe(false);

    const missingScope = await loadFeatureFlags({ erpCompletionPilot: 'true' });
    expect(missingScope.isErpCompletionPilotEnabledForSite('site-1')).toBe(false);

    const scoped = await loadFeatureFlags({
      erpCompletionPilot: 'true',
      erpCompletionPilotSiteIds: 'site-1, site-2',
    });
    expect(scoped.isErpCompletionPilotEnabledForSite('site-1')).toBe(true);
    expect(scoped.isErpCompletionPilotEnabledForSite('site-3')).toBe(false);
    expect(scoped.isErpCompletionPilotEnabledForSite(null)).toBe(false);
  });
});
