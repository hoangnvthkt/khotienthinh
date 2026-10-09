// Mở Tìm kiếm toàn hệ thống từ bất kỳ đâu (nút thanh bên, đầu trang điện thoại, nút nổi…).
export const OPEN_SEARCH_EVENT = 'vioo:open-search';

export const openGlobalSearch = (query?: string) =>
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { query } }));

/** Nhãn phím tắt theo máy: ⌘K trên Mac/iPad, Ctrl K nơi khác. */
export const searchShortcutLabel = (): string =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
