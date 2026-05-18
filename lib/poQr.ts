export const PO_QR_PARAM = 'poToken';
const PO_TOKEN_PREFIX = 'po_';

export const createPoQrToken = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${PO_TOKEN_PREFIX}${crypto.randomUUID()}`;
  }
  return `${PO_TOKEN_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const buildPoReceiveUrl = (token: string): string => {
  if (typeof window === 'undefined') return `/#/inventory?${PO_QR_PARAM}=${encodeURIComponent(token)}`;
  const basePath = `${window.location.origin}${window.location.pathname}`;
  return `${basePath}#/inventory?${PO_QR_PARAM}=${encodeURIComponent(token)}`;
};

export const extractPoToken = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const directToken = url.searchParams.get(PO_QR_PARAM);
    if (directToken) return directToken.trim();

    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [, hashQuery = ''] = hash.split('?');
    const hashToken = new URLSearchParams(hashQuery).get(PO_QR_PARAM);
    if (hashToken) return hashToken.trim();
  } catch {
    // Plain token fallback below.
  }

  if (value.includes(PO_QR_PARAM)) {
    const query = value.includes('?') ? value.split('?').pop() || '' : value;
    const token = new URLSearchParams(query).get(PO_QR_PARAM);
    if (token) return token.trim();
  }

  return value;
};

