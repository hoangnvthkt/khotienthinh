import { useCallback, useEffect, useRef, useState } from 'react';
import { mapRequestRpcError, requestRuntimeService, RequestRpcError, type RequestDetail } from '../lib/requestRuntimeService';

export interface UseRequestDetailResult {
  detail: RequestDetail | null;
  loading: boolean;
  error: Error | null;
  forbiddenOrMissing: boolean;
  refresh(): Promise<void>;
  applySnapshot(detail: RequestDetail): void;
}

export const useRequestDetail = (requestId?: string): UseRequestDetailResult => {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(requestId));
  const [error, setError] = useState<Error | null>(null);
  const tokenRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!requestId) { setDetail(null); setLoading(false); setError(null); return; }
    const token = ++tokenRef.current;
    setLoading(true); setError(null);
    try {
      const next = await requestRuntimeService.getDetail(requestId);
      if (token === tokenRef.current) setDetail(next);
    } catch (cause) {
      if (token !== tokenRef.current) return;
      const errorValue = cause instanceof RequestRpcError ? cause : mapRequestRpcError(cause);
      setDetail(null); setError(errorValue);
    } finally { if (token === tokenRef.current) setLoading(false); }
  }, [requestId]);

  useEffect(() => { void refresh(); }, [refresh]);
  const forbiddenOrMissing = error instanceof RequestRpcError && error.code === 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  return { detail, loading, error, forbiddenOrMissing, refresh, applySnapshot: setDetail };
};
