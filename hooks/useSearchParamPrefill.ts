import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Ô tìm của màn danh sách nhận sẵn từ khóa khi mở từ Tìm kiếm toàn hệ thống (…?q=PO-2026-015). */
export const useSearchParamPrefill = (apply: (value: string) => void) => {
  const { search } = useLocation();
  useEffect(() => {
    const value = new URLSearchParams(search).get('q');
    if (value) apply(value);
    // apply là setState của màn — ổn định; chỉ chạy lại khi đường dẫn đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
};
