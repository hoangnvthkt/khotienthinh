import React from "react";
import { LazyMotion, MotionConfig } from "motion/react";

const loadFeatures = () => import("./features").then((mod) => mod.default);

/** Bọc Vioo Work: chỉ dùng `m.*` (strict), tôn trọng "giảm chuyển động" của máy. Chuyển động chỉ đổi transform / opacity / height một lần. */
export function WorkMotion({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.8 }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
