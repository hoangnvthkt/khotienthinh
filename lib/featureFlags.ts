const isEnabledByDefault = (value: string | undefined): boolean => value !== 'false';
const isExplicitlyEnabled = (value: string | undefined): boolean => value === 'true';

export const isChatEnabled = isEnabledByDefault(import.meta.env.VITE_ENABLE_CHAT);
export const isChatV2Enabled = isEnabledByDefault(import.meta.env.VITE_ENABLE_CHAT_V2);

export const isPurchasePackageV2Enabled =
  isExplicitlyEnabled(import.meta.env.VITE_ENABLE_PURCHASE_PACKAGE_V2);

const purchasePackageV2SiteIds = new Set(
  String(import.meta.env.VITE_PURCHASE_PACKAGE_V2_SITE_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
);

export const isPurchasePackageV2EnabledForSite = (constructionSiteId?: string | null) =>
  isPurchasePackageV2Enabled
  && (
    purchasePackageV2SiteIds.size === 0
    || (!!constructionSiteId && purchasePackageV2SiteIds.has(constructionSiteId))
  );
