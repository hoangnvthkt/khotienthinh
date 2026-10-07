// Ngày dân sự (civil date) "yyyy-mm-dd": ngày trên lịch, không có giờ / múi giờ.
// KHÔNG BAO GIỜ new Date('yyyy-mm-dd') — trình duyệt hiểu là 00:00 UTC, sang giờ Việt Nam (hoặc múi giờ âm)
// lệch một ngày. Chuỗi ngày so sánh trực tiếp được (thứ tự chữ = thứ tự ngày); chỉ đổi sang Date ở
// mép giao diện (DayPicker) bằng giờ địa phương 00:00.

export type CivilDate = string;
export interface CivilRange { from: CivilDate; to: CivilDate }

/** Múi giờ của công ty: hạn việc (timestamp) quy ra ngày theo giờ Việt Nam, không theo máy người xem. */
export const COMPANY_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, '0');

export const isCivilDate = (value: unknown): value is CivilDate => {
  if (typeof value !== 'string') return false;
  const match = CIVIL_RE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
};

/** Date (giờ địa phương, từ DayPicker) → ngày dân sự theo ô lịch người dùng bấm. */
export const toCivil = (date: Date): CivilDate => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Ngày dân sự → Date 00:00 giờ địa phương (cho DayPicker). */
export const fromCivil = (civil: CivilDate): Date => {
  const match = CIVIL_RE.exec(civil);
  if (!match) throw new Error(`Không phải ngày yyyy-mm-dd: ${civil}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const companyDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Ngày dân sự của một mốc: "yyyy-mm-dd" giữ nguyên (không parse); timestamp ISO → ngày theo giờ Việt Nam.
 * null khi trống / sai định dạng.
 */
export const civilOf = (value: string | Date | null | undefined): CivilDate | null => {
  if (!value) return null;
  if (typeof value === 'string' && CIVIL_RE.test(value)) return isCivilDate(value) ? value : null;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = Object.fromEntries(companyDayFormat.formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** Cộng / trừ ngày trên lịch (không qua mili-giây nên không lệch khi đổi giờ mùa hè). */
export const addCivilDays = (civil: CivilDate, days: number): CivilDate => {
  const date = fromCivil(civil);
  date.setDate(date.getDate() + days);
  return toCivil(date);
};

/** from > to thì đảo; thiếu to thì là một ngày. */
export const civilRange = (from: CivilDate, to?: CivilDate | null): CivilRange =>
  !to || to === from ? { from, to: from } : to < from ? { from: to, to: from } : { from, to };

export const inCivilRange = (civil: CivilDate | null, range: CivilRange): boolean =>
  !!civil && civil >= range.from && civil <= range.to;

/** "dd/mm/yyyy". */
export const formatCivil = (civil: CivilDate): string => `${civil.slice(8, 10)}/${civil.slice(5, 7)}/${civil.slice(0, 4)}`;

/** "07/10/2026" hoặc "07/10 – 13/10/2026" (khác năm thì ghi đủ cả hai). */
export const formatCivilRange = (range: CivilRange): string => {
  if (range.from === range.to) return formatCivil(range.from);
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${sameYear ? formatCivil(range.from).slice(0, 5) : formatCivil(range.from)} – ${formatCivil(range.to)}`;
};
