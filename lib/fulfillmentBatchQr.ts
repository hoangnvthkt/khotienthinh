export const FULFILLMENT_BATCH_QR_PARAM = 'mrBatchToken';
const FULFILLMENT_BATCH_TOKEN_PREFIX = 'mrb_';

export const createFulfillmentBatchQrToken = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${FULFILLMENT_BATCH_TOKEN_PREFIX}${crypto.randomUUID()}`;
  }
  return `${FULFILLMENT_BATCH_TOKEN_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const buildFulfillmentBatchReceiveUrl = (token: string): string => {
  if (typeof window === 'undefined') return `/#/inventory?${FULFILLMENT_BATCH_QR_PARAM}=${encodeURIComponent(token)}`;
  const basePath = `${window.location.origin}${window.location.pathname}`;
  return `${basePath}#/inventory?${FULFILLMENT_BATCH_QR_PARAM}=${encodeURIComponent(token)}`;
};

export const extractFulfillmentBatchToken = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const directToken = url.searchParams.get(FULFILLMENT_BATCH_QR_PARAM);
    if (directToken) return directToken.trim();

    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [, hashQuery = ''] = hash.split('?');
    const hashToken = new URLSearchParams(hashQuery).get(FULFILLMENT_BATCH_QR_PARAM);
    if (hashToken) return hashToken.trim();
  } catch {
    // Plain token fallback below.
  }

  if (value.includes(FULFILLMENT_BATCH_QR_PARAM)) {
    const query = value.includes('?') ? value.split('?').pop() || '' : value;
    const token = new URLSearchParams(query).get(FULFILLMENT_BATCH_QR_PARAM);
    if (token) return token.trim();
  }

  return value.startsWith(FULFILLMENT_BATCH_TOKEN_PREFIX) ? value : null;
};
