import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CENTER_ROUTE } from './centerPermissions';
import { isEmbeddableRoute } from './drill';

// Giao diện Trung tâm điều hành: mở màn nào cũng thành một tab mới trong Trung tâm (chủ SP 10/10) — từ thanh bên trái,
// ô tìm kiếm, nút trên Hôm nay, menu avatar. Ngoài Trung tâm (đang ở màn khác) thì quay về /center rồi mở tab.

export interface CenterOpenRequest {
  route: string;
  /** Tên tab (nhãn chức năng); không có thì Trung tâm tự đặt theo màn. */
  title?: string;
  /** location.state của màn (ví dụ mở đúng phiếu). */
  state?: unknown;
}

type Opener = (request: CenterOpenRequest) => void;
let opener: Opener | null = null;
let pending: CenterOpenRequest | null = null;

/** CenterShell đăng ký khi mở; nhận luôn yêu cầu đang chờ (bấm khi còn ở màn khác). */
export const registerCenterOpener = (fn: Opener): (() => void) => {
  opener = fn;
  if (pending) { const request = pending; pending = null; fn(request); }
  return () => { if (opener === fn) opener = null; };
};

/** Gửi yêu cầu mở tab; false = Trung tâm chưa mở (yêu cầu được giữ tới khi Trung tâm mở). */
export const requestCenterOpen = (request: CenterOpenRequest): boolean => {
  if (opener) { opener(request); return true; }
  pending = request;
  return false;
};

/**
 * Điều hướng theo giao diện: đang dùng Trung tâm và màn chạy được trong tab → mở tab; còn lại → chuyển trang như cũ.
 * centerActive = useCenterUi(user).active.
 */
export const useCenterNavigate = (centerActive: boolean) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback((route: string, options: { title?: string; state?: unknown } = {}) => {
    if (!centerActive || !isEmbeddableRoute(route)) {
      navigate(route, options.state !== undefined ? { state: options.state } : undefined);
      return;
    }
    requestCenterOpen({ route, title: options.title, state: options.state });
    if (pathname !== CENTER_ROUTE) navigate(CENTER_ROUTE);
  }, [centerActive, navigate, pathname]);
};
