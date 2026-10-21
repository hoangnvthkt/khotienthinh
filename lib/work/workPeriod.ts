/** Kỳ xem số Vioo Work (Đợt 2 PR-5): tuần này / tuần trước / 2 tuần / tháng / quý / tùy chọn, kèm kỳ trước để so. Ngày dạng YYYY-MM-DD (giờ VN). */
import { ddmm, isoWeek } from "./workMyBoard";

export type WorkPeriodPreset = "week" | "last_week" | "2weeks" | "month" | "quarter" | "custom";
export interface WorkPeriod { preset: WorkPeriodPreset; from: string; to: string }
/** Khoảng gửi máy chủ: kỳ đang xem (cắt đến hôm nay) + kỳ trước để so. */
export interface WorkPeriodQuery { from: string; to: string; prevFrom: string; prevTo: string }

export const WORK_PERIOD_PRESETS: Array<{ id: WorkPeriodPreset; label: string }> = [
  { id: "week", label: "Tuần này" }, { id: "last_week", label: "Tuần trước" }, { id: "2weeks", label: "2 tuần" },
  { id: "month", label: "Tháng này" }, { id: "quarter", label: "Quý này" }, { id: "custom", label: "Tùy chọn" },
];
export const DEFAULT_WORK_PERIOD: Exclude<WorkPeriodPreset, "custom"> = "last_week";
/** Máy chủ nhận tối đa 400 ngày một kỳ. */
export const MAX_PERIOD_DAYS = 400;

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(ms(d));
const monday = (d: string) => addDays(d, -((new Date(ms(d)).getUTCDay() + 6) % 7));
const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const monthEnd = (d: string) => addDays(monthStart(addDays(monthStart(d), 32)), -1);
const quarterStart = (d: string) => `${d.slice(0, 5)}${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
const quarterEnd = (d: string) => addDays(quarterStart(addDays(quarterStart(d), 100)), -1);
const quarterOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;

/** Khoảng ngày của một kỳ có sẵn (kỳ hiện tại hiện trọn tuần / tháng / quý; số chỉ tính đến hôm nay). */
export function presetPeriod(preset: Exclude<WorkPeriodPreset, "custom">, today: string): WorkPeriod {
  const ws = monday(today);
  switch (preset) {
    case "week": return { preset, from: ws, to: addDays(ws, 6) };
    case "last_week": return { preset, from: addDays(ws, -7), to: addDays(ws, -1) };
    case "2weeks": return { preset, from: addDays(today, -13), to: today };
    case "month": return { preset, from: monthStart(today), to: monthEnd(today) };
    case "quarter": return { preset, from: quarterStart(today), to: quarterEnd(today) };
  }
}

/** Kỳ tùy chọn: sắp lại hai đầu, không quá hôm nay, không quá 400 ngày; sai thì null. */
export function customPeriod(from: string, to: string, today: string): WorkPeriod | null {
  if (!isDay(from) || !isDay(to)) return null;
  let a = from < to ? from : to; let b = from < to ? to : from;
  if (a > today) return null;
  if (b > today) b = today;
  if (daysBetween(a, b) > MAX_PERIOD_DAYS) a = addDays(b, -MAX_PERIOD_DAYS);
  return { preset: "custom", from: a, to: b };
}

/** Hình dạng kỳ theo ngày (kể cả Tùy chọn / link bản tin): trọn tuần T2–CN, trọn tháng, trọn quý; không thì null. */
export function periodShape(p: { from: string; to: string }): "week" | "month" | "quarter" | null {
  if (monday(p.from) === p.from && daysBetween(p.from, p.to) === 6) return "week";
  if (monthStart(p.from) === p.from && monthEnd(p.from) === p.to) return "month";
  if (quarterStart(p.from) === p.from && quarterEnd(p.from) === p.to) return "quarter";
  return null;
}

/** Kỳ trước để so: tuần trước, tháng trước, quý trước; còn lại cùng số ngày liền trước. */
export function prevPeriod(p: WorkPeriod): { from: string; to: string } {
  const shape = periodShape(p);
  if (shape === "week") return { from: addDays(p.from, -7), to: addDays(p.from, -1) };
  if (shape === "month") { const end = addDays(p.from, -1); return { from: monthStart(end), to: end }; }
  if (shape === "quarter") { const end = addDays(p.from, -1); return { from: quarterStart(end), to: end }; }
  const len = daysBetween(p.from, p.to);
  return { from: addDays(p.from, -len - 1), to: addDays(p.from, -1) };
}

/** Khoảng gửi máy chủ: kỳ đang chạy chỉ tính đến hôm nay (việc chưa đến hạn không kéo tỷ lệ đúng hạn xuống). */
export function periodQuery(p: WorkPeriod, today: string): WorkPeriodQuery {
  const prev = prevPeriod(p);
  return { from: p.from, to: p.to > today ? today : p.to, prevFrom: prev.from, prevTo: prev.to };
}

/** Tên kỳ: "Tuần 43 · 19–25/10", "Tháng 10/2026", "Quý 4/2026", "06/10 – 21/10". */
export function periodLabel(p: { preset: WorkPeriodPreset; from: string; to: string }): string {
  const shape = periodShape(p);
  if (shape === "week") return `Tuần ${isoWeek(p.from)} · ${p.from.slice(8, 10)}–${ddmm(p.to)}`;
  if (shape === "month") return `Tháng ${Number(p.from.slice(5, 7))}/${p.from.slice(0, 4)}`;
  if (shape === "quarter") return `Quý ${quarterOf(p.from)}/${p.from.slice(0, 4)}`;
  return p.from === p.to ? ddmm(p.from) : `${ddmm(p.from)} – ${ddmm(p.to)}${p.from.slice(0, 4) !== p.to.slice(0, 4) ? `/${p.to.slice(0, 4)}` : ""}`;
}
/** Nhãn ngắn cho ô số: "tuần 43", "tháng 10", "quý 4", "2 tuần", "06/10–21/10". */
export function periodShort(p: WorkPeriod): string {
  const shape = periodShape(p);
  if (shape === "week") return `tuần ${isoWeek(p.from)}`;
  if (shape === "month") return `tháng ${Number(p.from.slice(5, 7))}`;
  if (shape === "quarter") return `quý ${quarterOf(p.from)}`;
  if (p.preset === "2weeks") return "2 tuần";
  return p.from === p.to ? ddmm(p.from) : `${ddmm(p.from)}–${ddmm(p.to)}`;
}
/** "so với tuần 42" / "so với tháng 9" / "so với quý 3" / "so với kỳ trước". */
export function prevShort(p: WorkPeriod): string {
  const prev = prevPeriod(p); const shape = periodShape(p);
  if (shape === "week") return `tuần ${isoWeek(prev.from)}`;
  if (shape === "month") return `tháng ${Number(prev.from.slice(5, 7))}`;
  if (shape === "quarter") return `quý ${quarterOf(prev.from)}`;
  return "kỳ trước";
}

/** Kỳ từ link (bản tin): trùng kỳ có sẵn thì dùng kỳ đó, không thì Tùy chọn; sai thì null. */
export function periodFromRange(from: string | null, to: string | null, today: string): WorkPeriod | null {
  if (!from || !to) return null;
  for (const x of WORK_PERIOD_PRESETS) {
    if (x.id === "custom") continue;
    const p = presetPeriod(x.id, today);
    if (p.from === from && p.to === to) return p;
  }
  return customPeriod(from, to, today);
}

/** Đọc kỳ đã nhớ (dùng chung Việc của tôi / Phòng tôi / Toàn công ty); kỳ có sẵn luôn tính lại theo hôm nay. */
export function restorePeriod(raw: string | null, today: string): WorkPeriod {
  try {
    const v = raw ? JSON.parse(raw) as Partial<WorkPeriod> : null;
    if (v?.preset === "custom" && v.from && v.to) { const c = customPeriod(v.from, v.to, today); if (c) return c; }
    const preset = v?.preset;
    if (preset && preset !== "custom" && WORK_PERIOD_PRESETS.some((x) => x.id === preset)) return presetPeriod(preset, today);
  } catch { /* bỏ qua */ }
  return presetPeriod(DEFAULT_WORK_PERIOD, today);
}
export const storePeriod = (p: WorkPeriod) => JSON.stringify(p.preset === "custom" ? p : { preset: p.preset });
