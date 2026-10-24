import { useLayoutEffect, useState } from "react";

/** Nền / gạch chân trượt của một nhóm nút (thay layoutId: một phần tử cố định, trượt bằng CSS transform + width).
 *  Nút đang chọn có aria-pressed="true" hoặc aria-current="page". Nhóm đổi kích thước (xuống dòng, đổi chữ) thì nền
 *  nhảy thẳng tới chỗ mới, không trượt chậm theo. Trả về callback ref: nhóm hiện muộn (sau khi tải) vẫn được đặt nền. */
export function useSlidingPill<T extends HTMLElement>(active: unknown) {
  const [group, setGroup] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!group) return;
    const place = (animate: boolean) => {
      const on = group.querySelector<HTMLElement>(':scope > [aria-pressed="true"], :scope > [aria-current="page"]');
      group.classList.toggle("pill-still", !animate);
      group.classList.toggle("pill-none", !on);
      if (!on) return;
      group.style.setProperty("--pill-x", `${on.offsetLeft}px`);
      group.style.setProperty("--pill-y", `${on.offsetTop}px`);
      group.style.setProperty("--pill-w", `${on.offsetWidth}px`);
      group.style.setProperty("--pill-h", `${on.offsetHeight}px`);
    };
    place(group.dataset.pillReady === "1");
    group.dataset.pillReady = "1";
    if (typeof ResizeObserver === "undefined") return;
    let first = true;
    const observer = new ResizeObserver(() => { if (first) { first = false; return; } place(false); });
    observer.observe(group);
    return () => observer.disconnect();
  }, [group, active]);
  return setGroup;
}
