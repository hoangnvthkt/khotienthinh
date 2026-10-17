// Nhật ký · Duyệt nhanh (PR-1, chủ SP 17/10/2026): hàng chờ duyệt của người đang đăng nhập + duyệt thay khi phiếu treo quá hạn.
// Máy chủ (get_daily_log_review_queue_v1) đã lọc theo phân công và quyền; tệp này chỉ chuẩn hóa, sắp xếp, chọn phiếu tiếp theo.
import { supabase } from './supabase';

export interface DailyLogReviewItem {
  id: string;
  projectId: string | null;
  constructionSiteId: string | null;
  projectCode: string;
  projectName: string | null;
  siteName: string | null;
  /** YYYY-MM-DD */
  date: string;
  submittedAt: string | null;
  waitingHours: number;
  senderName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  permission: 'approve' | 'verify';
  summary: boolean;
}

export interface DailyLogReviewQueue {
  /** Phiếu đang giao cho tôi duyệt / xác nhận. */
  mine: DailyLogReviewItem[];
  /** Phiếu người khác chưa duyệt quá hạn — tôi là người duyệt dự phòng và đủ quyền. */
  takeover: DailyLogReviewItem[];
  isBackup: boolean;
  takeoverDays: number;
}

export const EMPTY_REVIEW_QUEUE: DailyLogReviewQueue = { mine: [], takeover: [], isBackup: false, takeoverDays: 2 };

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

export const parseReviewItem = (raw: unknown): DailyLogReviewItem | null => {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = text(row.id);
  const date = text(row.date);
  if (!id || !date) return null;
  const hours = Number(row.waitingHours);
  return {
    id,
    projectId: text(row.projectId),
    constructionSiteId: text(row.constructionSiteId),
    projectCode: text(row.projectCode) || text(row.projectName) || 'Dự án',
    projectName: text(row.projectName),
    siteName: text(row.siteName),
    date: date.slice(0, 10),
    submittedAt: text(row.submittedAt),
    waitingHours: Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 0,
    senderName: text(row.senderName),
    assigneeId: text(row.assigneeId),
    assigneeName: text(row.assigneeName),
    permission: row.permission === 'approve' ? 'approve' : 'verify',
    summary: row.summary === true,
  };
};

/** Cũ trước: gửi sớm nhất lên đầu, cùng lúc gửi thì ngày nhật ký sớm hơn trước. */
const byOldest = (a: DailyLogReviewItem, b: DailyLogReviewItem) =>
  (a.submittedAt || '').localeCompare(b.submittedAt || '') || a.date.localeCompare(b.date);

export const parseReviewQueue = (raw: unknown): DailyLogReviewQueue => {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
    .map(parseReviewItem).filter((item): item is DailyLogReviewItem => item !== null).sort(byOldest);
  const days = Number(row.takeoverDays);
  return {
    mine: list(row.mine),
    takeover: list(row.takeover),
    isBackup: row.isBackup === true,
    takeoverDays: Number.isFinite(days) && days > 0 ? Math.floor(days) : 2,
  };
};

const sameScope = (item: DailyLogReviewItem, projectId: string | null | undefined, siteId: string | null | undefined) =>
  (!projectId || item.projectId === projectId) && (!siteId || !item.constructionSiteId || item.constructionSiteId === siteId);

/** Hàng chờ của dự án đang mở, theo ngày nhật ký (duyệt lần lượt từ ngày cũ). */
export const scopeQueue = (items: readonly DailyLogReviewItem[], projectId?: string | null, siteId?: string | null): DailyLogReviewItem[] =>
  items.filter(item => sameScope(item, projectId, siteId)).sort((a, b) => a.date.localeCompare(b.date));

/** Phiếu ở dự án khác, gộp theo dự án: "DA29 · 4". */
export const otherProjects = (items: readonly DailyLogReviewItem[], projectId?: string | null, siteId?: string | null) => {
  const groups = new Map<string, { projectId: string | null; siteId: string | null; projectCode: string; count: number; firstId: string }>();
  items.filter(item => !sameScope(item, projectId, siteId)).forEach(item => {
    const key = `${item.projectId}|${item.constructionSiteId}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { projectId: item.projectId, siteId: item.constructionSiteId, projectCode: item.projectCode, count: 1, firstId: item.id });
  });
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.projectCode.localeCompare(b.projectCode));
};

/** Phiếu kế tiếp sau khi xử lý xong `doneId`: ngày sau trong hàng, hết thì quay lại ngày đầu còn lại. */
export const nextReviewItem = (items: readonly DailyLogReviewItem[], doneId: string): DailyLogReviewItem | null => {
  const rest = items.filter(item => item.id !== doneId);
  if (!rest.length) return null;
  const done = items.find(item => item.id === doneId);
  return (done && rest.find(item => item.date > done.date)) || rest[0];
};

/** "7 ngày", "5 giờ", "dưới 1 giờ". */
export const ageLabel = (hours: number): string => {
  if (hours >= 24) return `${Math.floor(hours / 24)} ngày`;
  if (hours >= 1) return `${hours} giờ`;
  return 'dưới 1 giờ';
};

/** "chờ 7 ngày", "chờ 5 giờ", "vừa gửi". */
export const waitingLabel = (hours: number): string => (hours >= 1 ? `chờ ${ageLabel(hours)}` : 'vừa gửi');

export const ddmm = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Ngày gọn như tin gộp của máy chủ: "01, 05–08/10"; khác tháng "28/09, 01–02/10"; quá 6 đoạn "01–15/10 (9 ngày)". */
export const dateListLabel = (dates: readonly string[]): string => {
  const days = Array.from(new Set(dates.map(d => d.slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort();
  if (!days.length) return '';
  const toMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  const runs: Array<[string, string]> = [];
  days.forEach(day => {
    const last = runs[runs.length - 1];
    if (last && toMs(day) - toMs(last[1]) === 86_400_000) last[1] = day; else runs.push([day, day]);
  });
  const dd = (d: string) => d.slice(8, 10);
  const oneMonth = new Set(days.map(d => d.slice(0, 7))).size === 1;
  if (runs.length > 6) return `${oneMonth ? dd(days[0]) : ddmm(days[0])}–${ddmm(days[days.length - 1])} (${days.length} ngày)`;
  if (oneMonth) return `${runs.map(([a, b]) => (a === b ? dd(a) : `${dd(a)}–${dd(b)}`)).join(', ')}/${days[0].slice(5, 7)}`;
  return runs.map(([a, b]) => (a === b ? ddmm(a) : a.slice(5, 7) === b.slice(5, 7) ? `${dd(a)}–${ddmm(b)}` : `${ddmm(a)}–${ddmm(b)}`)).join(', ');
};

const TAKEOVER_ERRORS: Record<string, string> = {
  DAILY_LOG_TAKEOVER_REASON_REQUIRED: 'Nhập lý do duyệt thay (ít nhất 3 ký tự).',
  DAILY_LOG_TAKEOVER_NOT_BACKUP: 'Bạn không nằm trong danh sách người duyệt dự phòng (Cài đặt → Cảnh báo → Nhật ký chờ xác nhận quá lâu).',
  DAILY_LOG_TAKEOVER_TOO_EARLY: 'Phiếu chưa treo đủ lâu để duyệt thay. Nhắc người được giao duyệt trước.',
  DAILY_LOG_TAKEOVER_NO_ASSIGNEE: 'Phiếu chưa giao cho ai duyệt nên không cần duyệt thay.',
  DAILY_LOG_APPROVER_REQUIRED: 'Bạn chưa có quyền Duyệt / Xác nhận (và Công bố tiến độ với bản tổng hợp) trong Room Nhật ký của dự án này.',
  DAILY_LOG_NOT_WAITING: 'Phiếu không còn chờ duyệt — có thể vừa được duyệt hoặc trả lại. Tải lại để xem.',
  DAILY_LOG_NOT_FOUND: 'Không tìm thấy nhật ký.',
};

export const takeoverErrorMessage = (error: unknown): string => {
  const raw = [(error as { message?: string })?.message, (error as { details?: string })?.details].filter(Boolean).join(' ');
  const code = Object.keys(TAKEOVER_ERRORS).find(key => raw.includes(key));
  return code ? TAKEOVER_ERRORS[code] : ((error as { message?: string })?.message || 'Chưa nhận duyệt thay được. Thử lại.');
};

export const dailyLogReviewQueueService = {
  async get(): Promise<DailyLogReviewQueue> {
    const { data, error } = await supabase.rpc('get_daily_log_review_queue_v1');
    if (error) throw error;
    return parseReviewQueue(data);
  },
  async takeOver(dailyLogId: string, reason: string): Promise<{ dailyLogId: string; alreadyMine: boolean }> {
    const { data, error } = await supabase.rpc('take_over_daily_log_review_v1', { p_daily_log_id: dailyLogId, p_reason: reason });
    if (error) throw new Error(takeoverErrorMessage(error));
    const row = (data || {}) as Record<string, unknown>;
    return { dailyLogId: String(row.dailyLogId || dailyLogId), alreadyMine: row.alreadyMine === true };
  },
};
