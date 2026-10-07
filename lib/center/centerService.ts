import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

// Trung tâm điều hành đọc mọi thứ qua RPC dưới quyền người dùng (JWT); không có dữ liệu riêng.

export type CenterOffReason = 'no_permission' | 'not_in_rollout';
export type CenterAccess =
  | { status: 'enabled'; mode: 'on' | 'read_only'; expiresAt: string | null }
  | { status: 'off'; reason: CenterOffReason };
export type CenterAccessState = { status: 'loading' } | { status: 'error'; message: string } | CenterAccess;

export const parseCenterAccess = (raw: unknown): CenterAccess => {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (row.enabled === true) {
    return {
      status: 'enabled',
      mode: row.mode === 'read_only' ? 'read_only' : 'on',
      expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : null,
    };
  }
  return { status: 'off', reason: row.reason === 'not_in_rollout' ? 'not_in_rollout' : 'no_permission' };
};

// Sidebar và trang Center dùng chung một lần gọi cho mỗi người dùng.
let accessCache: { userId: string; promise: Promise<CenterAccess> } | null = null;

export const fetchCenterAccess = (userId: string, force = false): Promise<CenterAccess> => {
  if (!force && accessCache?.userId === userId) return accessCache.promise;
  const promise = Promise.resolve(supabase.rpc('get_center_access_v1')).then(({ data, error }) => {
    if (error) throw error;
    return parseCenterAccess(data);
  });
  accessCache = { userId, promise };
  promise.catch(() => {
    if (accessCache?.promise === promise) accessCache = null;
  });
  return promise;
};

/** canRequest = quyền phía trình duyệt; không có quyền thì không gọi máy chủ. */
export const useCenterAccess = (userId: string | undefined, canRequest: boolean) => {
  const [state, setState] = useState<CenterAccessState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId || !canRequest) {
      setState({ status: 'off', reason: 'no_permission' });
      return;
    }
    let alive = true;
    setState({ status: 'loading' });
    fetchCenterAccess(userId, attempt > 0)
      .then(access => { if (alive) setState(access); })
      .catch(error => {
        console.warn('Center access check failed:', error);
        if (alive) setState({ status: 'error', message: 'Chưa kiểm tra được quyền vào Trung tâm điều hành. Kiểm tra mạng rồi thử lại.' });
      });
    return () => { alive = false; };
  }, [userId, canRequest, attempt]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { state, retry };
};
