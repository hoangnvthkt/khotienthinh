// Mở Tìm kiếm toàn hệ thống từ bất kỳ đâu (nút thanh bên, đầu trang điện thoại, nút nổi…).
export const OPEN_SEARCH_EVENT = 'vioo:open-search';

export const openGlobalSearch = (query?: string) =>
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { query } }));

/** Nhãn phím tắt theo máy: ⌘K trên Mac/iPad, Ctrl K nơi khác. */
export const searchShortcutLabel = (): string =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';

/** Mở hộp thoại thao tác nhanh (Xin nghỉ phép / Tạo đề xuất) mà không qua hộp Tìm kiếm — CommandPalette nghe sự kiện này. */
export const OPEN_MODAL_EVENT = 'vioo:open-modal';
export const openSearchModal = (modal: 'leave' | 'request') =>
  window.dispatchEvent(new CustomEvent(OPEN_MODAL_EVENT, { detail: { modal } }));
