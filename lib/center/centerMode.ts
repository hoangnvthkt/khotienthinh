import { useCallback, useEffect, useState } from 'react';
import { canAccessRoute } from '../routeAccess';
import { CENTER_ROUTE } from './centerPermissions';
import { useCenterAccess } from './centerService';

// Chọn giao diện: "classic" = giao diện hiện tại (mặc định), "center" = Trung tâm điều hành làm trang chính.
// Chỉ người đã được bật Center mới chọn được. Lưu theo người trên từng máy (localStorage) — chọn lại trên máy khác.

export type UiMode = 'classic' | 'center';

const EVENT = 'vioo-ui-mode';
const storageKey = (userId: string) => `vioo_ui_mode:${userId}`;

export const readUiMode = (userId: string | undefined): UiMode => {
  if (!userId) return 'classic';
  try { return window.localStorage.getItem(storageKey(userId)) === 'center' ? 'center' : 'classic'; } catch { return 'classic'; }
};

export const writeUiMode = (userId: string, mode: UiMode) => {
  try { window.localStorage.setItem(storageKey(userId), mode); } catch { /* chế độ riêng tư: chỉ giữ trong phiên */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId, mode } }));
};

/** Chế độ giao diện của người dùng, đồng bộ giữa các component (và các tab) khi đổi. */
export const useUiMode = (userId: string | undefined): [UiMode, (mode: UiMode) => void] => {
  const [mode, setModeState] = useState<UiMode>(() => readUiMode(userId));
  useEffect(() => {
    setModeState(readUiMode(userId));
    const sync = () => setModeState(readUiMode(userId));
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, [userId]);
  const setMode = useCallback((next: UiMode) => {
    if (!userId) return;
    writeUiMode(userId, next);
    setModeState(next);
  }, [userId]);
  return [mode, setMode];
};

/** available = được bật Center; active = đang dùng giao diện Trung tâm điều hành. */
export const useCenterUi = (user: Parameters<typeof canAccessRoute>[0] & { id?: string } | null | undefined) => {
  const { state } = useCenterAccess(user?.id, !!user && canAccessRoute(user, CENTER_ROUTE));
  const available = state.status === 'enabled';
  const [mode, setMode] = useUiMode(user?.id);
  return { available, active: available && mode === 'center', mode, setMode };
};
