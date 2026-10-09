import React, { Suspense, useEffect, useState } from 'react';
import { OPEN_SEARCH_EVENT } from '../lib/search/openGlobalSearch';
import type { SearchEntry } from '../lib/search/searchTypes';

// Tìm kiếm toàn hệ thống (Ctrl/⌘ K, nút Tìm kiếm ở thanh bên / đầu trang điện thoại / nút nổi).
// Phần này chỉ nghe phím tắt và sự kiện mở; hộp tìm kiếm tải lười và được nạp sẵn ngầm sau khi app mở.

const loadDialog = () => import('./search/GlobalSearchDialog');
const GlobalSearchDialog = React.lazy(loadDialog);
const CenterModalHost = React.lazy(() => import('./center/CenterModals'));

type Modal = NonNullable<SearchEntry['modal']>;

const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState<{ query: string } | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(current => (current ? null : { query: '' }));
      }
    };
    const onOpen = (event: Event) => {
      const query = (event as CustomEvent<{ query?: string }>).detail?.query;
      setOpen({ query: typeof query === 'string' ? query : '' });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    // Nạp sẵn hộp tìm kiếm khi trình duyệt rảnh để lần bấm đầu mở ngay.
    const warm = window.setTimeout(() => { void loadDialog().catch(() => undefined); }, 4000);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
      window.clearTimeout(warm);
    };
  }, []);

  return (
    <>
      {open && (
        <Suspense fallback={null}>
          <GlobalSearchDialog initialQuery={open.query} onClose={() => setOpen(null)} onModal={next => { setOpen(null); setModal(next); }} />
        </Suspense>
      )}
      {modal && (
        <Suspense fallback={null}>
          <CenterModalHost modal={modal} onClose={() => setModal(null)} onDone={() => setModal(null)} />
        </Suspense>
      )}
    </>
  );
};

export default CommandPalette;
