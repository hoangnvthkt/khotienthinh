export const buildRequestRoute = (requestId: string): string =>
  `/rq/${encodeURIComponent(requestId)}`;
