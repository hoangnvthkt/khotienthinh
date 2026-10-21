// Quản lý trực tiếp: the org chart is the only place to set it. Accounts in a unit without a head
// still show the old per-account manager ("tạm") until HR picks the head.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type UserManagerSource = 'org_chart' | 'legacy' | 'none';

export interface UserDirectManager {
  userId: string;
  managerUserId: string | null;
  source: UserManagerSource;
}

export const USER_MANAGER_SOURCE_LABEL: Record<UserManagerSource, string> = {
  org_chart: 'Theo sơ đồ',
  legacy: 'Tạm theo quản lý cũ',
  none: 'Chưa có',
};

export const userDirectManagerService = {
  async list(): Promise<Map<string, UserDirectManager>> {
    const { data, error } = await supabase.rpc('list_user_direct_managers');
    if (error) throw new Error('Không tải được quản lý trực tiếp.');
    return new Map(((data || []) as UserDirectManager[]).map(row => [row.userId, row]));
  },
};

/** null while loading; an empty map when it could not be read (the caller shows "—", never a wrong name). */
export const useUserDirectManagers = (reloadKey: unknown = null) => {
  const [managers, setManagers] = useState<Map<string, UserDirectManager> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    userDirectManagerService.list()
      .then(map => { if (alive) { setManagers(map); setFailed(false); } })
      .catch(() => { if (alive) { setManagers(new Map()); setFailed(true); } });
    return () => { alive = false; };
  }, [reloadKey]);
  return { managers, failed };
};
