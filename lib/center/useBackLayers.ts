import { useCallback, useEffect, useRef, useState } from 'react';

// Nút Back (trình duyệt, vuốt iPhone, nút Back Android) đóng lớp trên cùng của Trung tâm điều hành
// thay vì rời trang: mỗi lớp đang mở (thư mục thao tác, form, hồ sơ mở từ danh sách trên điện thoại)
// đẩy một mốc lịch sử cùng URL. Đóng lớp bằng nút trên màn thì gỡ mốc; rời Center thì thay mốc
// (replace) để không còn lần Back "chết".

const MARK = 'vccLayer';

export const useBackLayers = (depth: number, closeTop: () => void) => {
  const pushed = useRef(0);
  const ignorePops = useRef(0);
  const closeTopRef = useRef(closeTop);
  closeTopRef.current = closeTop;

  useEffect(() => {
    const onPop = () => {
      if (ignorePops.current > 0) { ignorePops.current -= 1; return; }
      if (pushed.current === 0) return;
      pushed.current -= 1;
      closeTopRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (depth > pushed.current) {
      for (let level = pushed.current + 1; level <= depth; level += 1) {
        window.history.pushState({ ...(window.history.state || {}), [MARK]: level }, '', window.location.href);
      }
      pushed.current = depth;
    } else if (depth < pushed.current) {
      const steps = pushed.current - depth;
      pushed.current = depth;
      ignorePops.current += 1;
      window.history.go(-steps);
    }
  }, [depth]);

  /** Rời Center khi còn lớp: điều hướng thay mốc trên cùng; các mốc đã tính là đã dùng. */
  const consumeForNavigation = useCallback((): boolean => {
    const hadLayers = pushed.current > 0;
    pushed.current = 0;
    return hadLayers;
  }, []);

  return { consumeForNavigation };
};

/** Bề rộng điện thoại / máy tính bảng (cùng mốc 1023px với center.css). */
export const useNarrowViewport = (): boolean => {
  const query = '(max-width: 1023px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return narrow;
};
