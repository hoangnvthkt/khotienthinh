import React, { useLayoutEffect, useRef, useState } from "react";
import { m } from "motion/react";

/** Khung co giãn mượt khi nội dung đổi (mẫu AutoHeight của animate-ui). Chỉ cắt tràn trong lúc đang co giãn để không che viền focus. */
export function AutoHeight({ children, className }: { children: React.ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <m.div className={className} initial={false} animate={{ height }} transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ overflow: moving ? "hidden" : "visible" }} onAnimationStart={() => setMoving(true)} onAnimationComplete={() => setMoving(false)}>
      <div ref={inner}>{children}</div>
    </m.div>
  );
}
