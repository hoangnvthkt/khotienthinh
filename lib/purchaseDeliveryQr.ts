export const PURCHASE_DELIVERY_QR_PARAM = 'deliveryToken';
const PURCHASE_DELIVERY_TOKEN_PREFIX = 'pod_';

export const buildPurchaseDeliveryReceiveUrl = (token: string): string => {
  if (typeof window === 'undefined') return `/#/inventory?${PURCHASE_DELIVERY_QR_PARAM}=${encodeURIComponent(token)}`;
  const basePath = `${window.location.origin}${window.location.pathname}`;
  return `${basePath}#/inventory?${PURCHASE_DELIVERY_QR_PARAM}=${encodeURIComponent(token)}`;
};

export const extractPurchaseDeliveryToken = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const directToken = url.searchParams.get(PURCHASE_DELIVERY_QR_PARAM);
    if (directToken) return directToken.trim();

    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [, hashQuery = ''] = hash.split('?');
    const hashToken = new URLSearchParams(hashQuery).get(PURCHASE_DELIVERY_QR_PARAM);
    if (hashToken) return hashToken.trim();
  } catch {
    // Plain token fallback below.
  }

  if (value.includes(PURCHASE_DELIVERY_QR_PARAM)) {
    const query = value.includes('?') ? value.split('?').pop() || '' : value;
    const token = new URLSearchParams(query).get(PURCHASE_DELIVERY_QR_PARAM);
    if (token) return token.trim();
  }

  return value.startsWith(PURCHASE_DELIVERY_TOKEN_PREFIX) ? value : null;
};
