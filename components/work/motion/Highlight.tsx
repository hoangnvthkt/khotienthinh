import React from "react";
import { m } from "motion/react";

/** Nền hoặc gạch chân trượt sang lựa chọn mới (mẫu Highlight / Tabs của animate-ui).
 *  Đặt bên trong nút đang chọn; các nút cùng `group` thì nền trượt từ nút cũ sang. */
export function Highlight({ group, className = "work-seg-pill" }: { group: string; className?: string }) {
  return <m.span layoutId={group} className={className} aria-hidden="true" />;
}
