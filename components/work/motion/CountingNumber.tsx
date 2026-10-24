import React, { useEffect, useRef } from "react";
import { useReducedMotion, useSpring } from "motion/react";

/** Số đếm lên tới giá trị mới (mẫu CountingNumber của animate-ui). Ghi thẳng vào DOM, không render lại React mỗi khung hình. */
export function CountingNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const spring = useSpring(reduce ? value : 0, { stiffness: 120, damping: 24 });
  useEffect(() => spring.on("change", (v) => { if (ref.current) ref.current.textContent = String(Math.round(v)); }), [spring]);
  useEffect(() => { if (reduce) spring.jump(value); else spring.set(value); }, [value, reduce, spring]);
  return <span ref={ref}>{reduce ? value : 0}</span>;
}
