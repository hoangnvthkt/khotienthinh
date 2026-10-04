// "Hôm nay tại công trường": types for get_daily_log_today_board_v1 and the
// pure rules that turn one day's slips into what each role should see first.

export interface TodayBoardLaborLine { provider?: string | null; laborType?: string | null; people: number; hours: number; manual?: boolean; contractLinked?: boolean }
export interface TodayBoardMachineLine { machineType?: string | null; provider?: string | null; count: number; hours: number }

export interface TodayBoardItem {
  taskId?: string | null;
  wbsCode?: string | null;
  taskName?: string | null;
  unit?: string | null;
  dailyQuantity?: number | null;
  cumulativeQuantity?: number | null;
  cumulativePercent?: number | null;
  forecastFinishDate?: string | null;
  scheduleFinishDate?: string | null;
  attachmentCount?: number;
  plannedQuantity?: number | null;
  forecastChangeReason?: string | null;
  /** Công tác hôm nay (dòng gạch đầu). */
  note?: string | null;
  photos?: Array<{ url: string; name?: string }>;
  labor?: TodayBoardLaborLine[];
  machines?: TodayBoardMachineLine[];
}

export type TodayBoardSlipStatus = 'draft' | 'submitted' | 'returned' | 'included';

export interface TodayBoardSlip {
  id: string;
  areaCode?: string | null;
  areaName?: string | null;
  authorUserId?: string | null;
  authorName?: string | null;
  status: TodayBoardSlipStatus;
  submittedAt?: string | null;
  returnReason?: string | null;
  returnedByName?: string | null;
  issues?: string | null;
  photos: Array<{ url: string; name?: string }>;
  photoCount: number;
  items: TodayBoardItem[];
  people: number;
  laborHours: number;
  machineCount: number;
  machineHours: number;
}

export interface TodayBoardMissingFront {
  areaCode?: string | null;
  areaName?: string | null;
  authorUserId?: string | null;
  authorName?: string | null;
  lastDate: string;
}

export interface TodayBoardSummary {
  id: string;
  status: 'draft' | 'submitted' | 'verified' | 'rejected' | string;
  summarizedByName?: string | null;
  submittedToName?: string | null;
  verifiedBy?: string | null;
  weather?: string | null;
  issues?: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
}

export interface TodayBoardDay {
  date: string;
  slips: number;
  people: number;
  machineHours: number;
  summaryStatus?: string | null;
  /** Số người trên bản tổng hợp (nhật ký trước cutover chỉ có số này). */
  summaryPeople?: number | null;
  hasIssue: boolean;
}

export interface DailyLogTodayBoard {
  date: string;
  slips: TodayBoardSlip[];
  missingFronts: TodayBoardMissingFront[];
  summary: TodayBoardSummary | null;
  yesterday: { slips: number; people: number; machineHours: number } | null;
  days: TodayBoardDay[];
}

export const isSentSlip = (slip: TodayBoardSlip) => slip.status !== 'draft';

/** Late when the engineer's forecast passes the plan, or the plan date passed unfinished. */
export const isItemDelayed = (item: TodayBoardItem, date: string): boolean => {
  const planned = item.scheduleFinishDate?.slice(0, 10);
  const forecast = item.forecastFinishDate?.slice(0, 10);
  if (!planned || Number(item.cumulativePercent ?? 0) >= 100) return false;
  // A forecast equal to a plan date already passed does not make the item on time.
  return Boolean(forecast && forecast > planned) || planned < date;
};

/** Ngày trễ so với kế hoạch: theo ngày dự kiến mới nếu có, không thì tính đến ngày báo cáo. */
export const lateDays = (item: TodayBoardItem, date: string): number | null => {
  if (!isItemDelayed(item, date)) return null;
  const planned = item.scheduleFinishDate!.slice(0, 10);
  const forecast = item.forecastFinishDate?.slice(0, 10);
  const until = forecast && forecast > planned ? forecast : date;
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${planned}T00:00:00Z`)) / 86_400_000);
  return days > 0 ? days : null;
};

/** Đã quá ngày kế hoạch, chưa xong và kỹ sư chưa ghi ngày dự kiến mới. */
export const needsNewForecast = (item: TodayBoardItem, date: string): boolean => {
  const planned = item.scheduleFinishDate?.slice(0, 10);
  const forecast = item.forecastFinishDate?.slice(0, 10);
  return Boolean(planned && planned < date && Number(item.cumulativePercent ?? 0) < 100 && (!forecast || forecast <= planned));
};

export interface CrewTotal { name: string; people: number; hours: number; manual: boolean; contractLinked: boolean; items: Array<{ item: TodayBoardItem; slip: TodayBoardSlip }> }
export interface MachineTotal { name: string; provider?: string | null; count: number; hours: number; items: Array<{ item: TodayBoardItem; slip: TodayBoardSlip }> }

/** "Ai làm": cộng nhân công theo tổ đội và máy theo loại máy, trên các phiếu đã gửi. */
export const resourceTotals = (board: DailyLogTodayBoard) => {
  const crews = new Map<string, CrewTotal>();
  const machines = new Map<string, MachineTotal>();
  for (const slip of board.slips.filter(isSentSlip)) for (const item of slip.items) {
    for (const line of item.labor || []) {
      const name = line.provider?.trim() || line.laborType?.trim() || 'Chưa rõ tổ đội';
      const crew = crews.get(name) || { name, people: 0, hours: 0, manual: Boolean(line.manual), contractLinked: false, items: [] };
      crew.people += Number(line.people || 0); crew.hours += Number(line.hours || 0);
      crew.contractLinked ||= Boolean(line.contractLinked); crew.manual &&= Boolean(line.manual);
      if (!crew.items.some(entry => entry.item === item)) crew.items.push({ item, slip });
      crews.set(name, crew);
    }
    for (const line of item.machines || []) {
      const name = line.machineType?.trim() || 'Máy chưa đặt tên';
      const key = `${name}|${line.provider || ''}`;
      const total = machines.get(key) || { name, provider: line.provider, count: 0, hours: 0, items: [] };
      total.count += Number(line.count || 0); total.hours += Number(line.hours || 0);
      if (!total.items.some(entry => entry.item === item)) total.items.push({ item, slip });
      machines.set(key, total);
    }
  }
  const byPeople = (a: CrewTotal, b: CrewTotal) => b.people - a.people || a.name.localeCompare(b.name, 'vi');
  return { crews: [...crews.values()].sort(byPeople), machines: [...machines.values()].sort((a, b) => b.hours - a.hours) };
};

export const delayDays = (item: TodayBoardItem): number | null => {
  const planned = item.scheduleFinishDate?.slice(0, 10);
  const forecast = item.forecastFinishDate?.slice(0, 10);
  if (!planned || !forecast || forecast <= planned) return null;
  return Math.round((Date.parse(`${forecast}T00:00:00Z`) - Date.parse(`${planned}T00:00:00Z`)) / 86_400_000);
};

export const frontName = (value: { areaName?: string | null; areaCode?: string | null }) =>
  value.areaName?.trim() || value.areaCode?.trim() || 'Mũi chưa đặt tên';

export type AttentionTone = 'danger' | 'warning';
export interface AttentionItem { key: string; tone: AttentionTone; text: string; slipId?: string }

export const buildAttention = (board: DailyLogTodayBoard): AttentionItem[] => {
  const items: AttentionItem[] = [];
  for (const slip of board.slips.filter(isSentSlip)) {
    for (const item of slip.items.filter(entry => isItemDelayed(entry, board.date))) {
      const days = lateDays(item, board.date);
      const noForecast = needsNewForecast(item, board.date);
      items.push({
        key: `late:${slip.id}:${item.wbsCode}:${item.taskName}`, tone: 'danger', slipId: slip.id,
        text: `${[item.wbsCode, item.taskName].filter(Boolean).join(' ')} ${days ? `trễ ${days} ngày` : 'quá hạn kế hoạch'}${noForecast
          ? `, kế hoạch xong ${formatShortDate(item.scheduleFinishDate!)}, chưa có ngày dự kiến mới`
          : item.forecastFinishDate ? `, dự kiến xong ${formatShortDate(item.forecastFinishDate)}` : ''} (${frontName(slip)})`,
      });
    }
  }
  for (const slip of board.slips) {
    if (isSentSlip(slip) && slip.issues) items.push({ key: `issue:${slip.id}`, tone: 'warning', slipId: slip.id, text: `Sự cố ${frontName(slip)}: ${slip.issues}` });
    if (slip.status === 'returned') items.push({ key: `returned:${slip.id}`, tone: 'warning', slipId: slip.id, text: `Phiếu ${frontName(slip)} (${slip.authorName || 'kỹ sư'}) bị trả, chờ sửa${slip.returnReason ? `: ${slip.returnReason}` : ''}` });
  }
  if (board.summary?.issues) items.push({ key: 'summary-issue', tone: 'warning', text: `Sự cố trong bản tổng hợp: ${board.summary.issues}` });
  if (board.summary?.status === 'rejected') items.push({ key: 'summary-rejected', tone: 'warning', text: 'Bản tổng hợp bị CHT trả lại, chờ người tổng hợp sửa' });
  for (const front of board.missingFronts) {
    items.push({ key: `missing:${front.areaCode}`, tone: 'warning', text: `${frontName(front)}${front.authorName ? ` (${front.authorName})` : ''} chưa gửi phiếu hôm nay` });
  }
  return items;
};

/** 0 phiếu kỹ sư · 1 tổng hợp · 2 CHT duyệt · 3 đã công bố */
export const boardStage = (board: DailyLogTodayBoard): 0 | 1 | 2 | 3 => {
  const status = board.summary?.status;
  if (status === 'verified') return 3;
  if (status === 'submitted') return 2;
  if (status === 'draft' || status === 'rejected') return 1;
  return 0;
};

export const reportedFronts = (board: DailyLogTodayBoard) => {
  const sent = new Set(board.slips.filter(isSentSlip).map(slip => slip.areaCode || slip.id)).size;
  return { sent, expected: sent + board.missingFronts.length };
};

export const boardTotals = (board: DailyLogTodayBoard) => {
  const sent = board.slips.filter(isSentSlip);
  return {
    people: sent.reduce((sum, slip) => sum + Number(slip.people || 0), 0),
    machineHours: sent.reduce((sum, slip) => sum + Number(slip.machineHours || 0), 0),
    delayedItems: sent.reduce((sum, slip) => sum + slip.items.filter(item => isItemDelayed(item, board.date)).length, 0),
  };
};

export type BoardAction = 'create' | 'fixReturned' | 'summarize' | 'review' | null;
export interface MyTask { title: string; detail: string; action: BoardAction; actionLabel?: string }

export const buildMyTask = (board: DailyLogTodayBoard, input: {
  userId?: string | null; canSubmit: boolean; canSummarize: boolean; canApprove: boolean;
}): MyTask => {
  const sent = board.slips.filter(isSentSlip);
  const { sent: sentFronts, expected } = reportedFronts(board);
  const summary = board.summary;
  if (input.canApprove && summary?.status === 'submitted') {
    return { title: 'Bản tổng hợp chờ bạn duyệt', detail: `${summary.summarizedByName || 'Người tổng hợp'} đã gửi, gồm ${sentFronts} mũi thi công.`, action: 'review', actionLabel: 'Xem và duyệt' };
  }
  const mine = board.slips.filter(slip => input.userId && slip.authorUserId === input.userId);
  const returned = mine.find(slip => slip.status === 'returned');
  if (input.canSubmit && returned) {
    return { title: `Phiếu ${frontName(returned)} bị trả, cần sửa`, detail: returned.returnReason || 'Mở phiếu để xem yêu cầu sửa.', action: 'fixReturned', actionLabel: 'Sửa phiếu' };
  }
  if (input.canSummarize && sent.length > 0 && (!summary || summary.status === 'draft' || summary.status === 'rejected')) {
    const missing = board.missingFronts.length;
    return {
      title: summary?.status === 'rejected' ? 'Bản tổng hợp bị trả, cần sửa' : `${sentFronts}/${expected} mũi đã gửi phiếu, chờ tổng hợp`,
      detail: missing ? `Còn ${missing} mũi chưa gửi. Bạn có thể tổng hợp các phiếu đã có.` : 'Đủ phiếu các mũi. Tổng hợp rồi gửi CHT duyệt.',
      action: 'summarize', actionLabel: summary ? 'Mở bản tổng hợp' : 'Bắt đầu tổng hợp',
    };
  }
  if (input.canSubmit && mine.length === 0) {
    return { title: 'Bạn chưa gửi phiếu hôm nay', detail: 'Ghi công việc, % hoàn thành, nhân công, máy và ảnh của mũi bạn phụ trách.', action: 'create', actionLabel: 'Ghi phiếu hôm nay' };
  }
  const draft = mine.find(slip => slip.status === 'draft');
  if (input.canSubmit && draft) {
    return { title: `Phiếu ${frontName(draft)} đang là nháp`, detail: 'Hoàn thiện rồi bấm Gửi tổng hợp để người tổng hợp nhận được.', action: 'create', actionLabel: 'Mở phiếu' };
  }
  if (summary?.status === 'verified') {
    return { title: 'Nhật ký hôm nay đã được duyệt', detail: `${summary.verifiedBy || 'CHT'} đã duyệt bản tổng hợp.`, action: null };
  }
  if (summary?.status === 'submitted') {
    return { title: 'Bản tổng hợp đang chờ CHT duyệt', detail: `Đã gửi ${summary.submittedToName || 'CHT'}.`, action: null };
  }
  if (mine.length > 0) {
    return { title: 'Bạn đã gửi phiếu hôm nay', detail: 'Bạn sẽ được báo nếu phiếu bị trả hoặc được duyệt.', action: null };
  }
  return {
    title: sent.length ? `${sentFronts}/${expected} mũi đã gửi phiếu` : 'Chưa có phiếu nào hôm nay',
    detail: sent.length ? 'Đang chờ người tổng hợp.' : 'Phiếu của kỹ sư sẽ hiện ở đây khi được gửi.',
    action: null,
  };
};

export const formatShortDate = (value: string) => {
  const [, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}`;
};
