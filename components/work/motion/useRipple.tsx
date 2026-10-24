import React, { useCallback, useState } from "react";
import { m } from "motion/react";

type Ripple = { id: number; x: number; y: number; size: number };

/** Gợn lan từ chỗ bấm (mẫu RippleButton của animate-ui). Nút cần class có `position: relative; overflow: hidden`. */
export function useRipple() {
  const [items, setItems] = useState<Ripple[]>([]);
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const size = Math.max(box.width, box.height) * 2;
    setItems((list) => [...list.slice(-2), { id: event.timeStamp, x: event.clientX - box.left - size / 2, y: event.clientY - box.top - size / 2, size }]);
  }, []);
  const ripples = items.map((it) => (
    <m.span key={it.id} className="work-ripple" aria-hidden="true" style={{ left: it.x, top: it.y, width: it.size, height: it.size }}
      initial={{ scale: 0, opacity: 0.35 }} animate={{ scale: 1, opacity: 0 }} transition={{ duration: 0.55, ease: "easeOut" }}
      onAnimationComplete={() => setItems((list) => list.filter((x) => x.id !== it.id))} />
  ));
  return { onPointerDown, ripples };
}
