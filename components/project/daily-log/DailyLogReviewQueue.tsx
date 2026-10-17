// Nhật ký · Duyệt nhanh (PR-1): thẻ "Chờ bạn duyệt" đầu trang và dải duyệt lần lượt trong màn xem phiếu.
// Không tự duyệt — chỉ đưa người duyệt tới đúng phiếu, nút Duyệt / Xác nhận / Trả lại vẫn là của màn xem phiếu sẵn có.
import React from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCheck, Loader2, UserRoundCheck } from 'lucide-react';
import { primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { NUM } from '../../finance/financeUi';
import { ageLabel, dateListLabel, ddmm, waitingLabel, type DailyLogReviewItem } from '../../../lib/dailyLogReviewQueue';

// index.css trên điện thoại cắt `.grid > div .text-xs` thành 1 dòng — các dòng giải thích ở đây phải xuống dòng đủ.
const WRAP = '!whitespace-normal !overflow-visible';

export interface OtherProjectGroup { projectId: string | null; siteId: string | null; projectCode: string; count: number; firstId: string }

const oldestHours = (items: readonly DailyLogReviewItem[]) => items.reduce((max, item) => Math.max(max, item.waitingHours), 0);

/** Thẻ đầu trang Nhật ký: phiếu chờ tôi ở dự án này, phiếu treo tôi được duyệt thay, phiếu ở dự án khác. */
export const DailyLogReviewQueueCard: React.FC<{
  mine: DailyLogReviewItem[];
  takeover: DailyLogReviewItem[];
  takeoverDays: number;
  others: OtherProjectGroup[];
  onOpen: (item: DailyLogReviewItem) => void;
  otherLink: (group: OtherProjectGroup) => string;
}> = ({ mine, takeover, takeoverDays, others, onOpen, otherLink }) => {
  if (!mine.length && !takeover.length && !others.length) return null;
  const assignees = Array.from(new Set(takeover.map(item => item.assigneeName).filter(Boolean)));
  return (
    <section data-testid="daily-log-review-queue" aria-label="Nhật ký chờ duyệt"
      className="overflow-hidden rounded-2xl border border-amber-200 border-l-4 border-l-amber-400 bg-card shadow-sm dark:border-amber-900/60">
      {mine.length > 0 && (
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"><ClipboardCheck size={20} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground"><span className={NUM}>{mine.length}</span> nhật ký chờ bạn duyệt</p>
              <p className={`text-xs text-muted-foreground ${WRAP}`}>{dateListLabel(mine.map(item => item.date))} · lâu nhất {ageLabel(oldestHours(mine))}</p>
            </div>
          </div>
          <button type="button" onClick={() => onOpen(mine[0])} className={`${primaryBtn} w-full sm:w-auto`}>
            <ClipboardCheck size={15} />Duyệt lần lượt</button>
        </div>
      )}
      {takeover.length > 0 && (
        <div className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${mine.length ? 'border-t border-border' : ''}`}>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><AlertTriangle size={19} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground"><span className="tabular-nums">{takeover.length}</span> nhật ký treo quá {takeoverDays} ngày</p>
              <p className={`text-xs text-muted-foreground ${WRAP}`}>{dateListLabel(takeover.map(item => item.date))} · chờ {assignees.join(', ') || 'người được giao'} · bạn là người duyệt dự phòng</p>
            </div>
          </div>
          <button type="button" onClick={() => onOpen(takeover[0])} className={`${secondaryBtn} w-full bg-card sm:w-auto`}>
            <UserRoundCheck size={15} />Xem để duyệt thay</button>
        </div>
      )}
      {others.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs ${mine.length || takeover.length ? 'border-t border-border bg-muted/30' : ''}`}>
          <span className="text-muted-foreground">Ở dự án khác:</span>
          {others.map(group => (
            <a key={`${group.projectId}|${group.siteId}`} href={otherLink(group)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 font-semibold text-foreground hover:border-teal-400">
              {group.projectCode} · <span className="tabular-nums">{group.count}</span><ChevronRight size={12} /></a>
          ))}
        </div>
      )}
    </section>
  );
};

/** Dải trong màn xem phiếu: vị trí trong hàng, các ngày còn chờ, trước / sau; phiếu treo thì có nút Duyệt thay. */
export const DailyLogReviewQueueBar: React.FC<{
  items: DailyLogReviewItem[];
  currentId: string;
  mode: 'mine' | 'takeover';
  takeoverDays: number;
  busy?: boolean;
  onOpen: (item: DailyLogReviewItem) => void;
  onTakeOver?: (item: DailyLogReviewItem) => void;
}> = ({ items, currentId, mode, takeoverDays, busy, onOpen, onTakeOver }) => {
  const index = items.findIndex(item => item.id === currentId);
  if (index < 0) return null;
  const current = items[index];
  const prev = index > 0 ? items[index - 1] : null;
  const next = index < items.length - 1 ? items[index + 1] : null;
  return (
    <div data-testid="daily-log-review-bar" className="sticky top-0 z-20 border-b border-amber-200 bg-amber-50/95 px-3 py-2 backdrop-blur dark:border-amber-900/60 dark:bg-amber-950/80 sm:px-5">
      <div className="flex items-center gap-2">
        <button type="button" disabled={!prev || busy} onClick={() => prev && onOpen(prev)} aria-label="Nhật ký trước"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-amber-900 hover:bg-amber-100 disabled:opacity-30 dark:text-amber-100 dark:hover:bg-amber-900/50"><ChevronLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-amber-900 dark:text-amber-100">
            {mode === 'mine' ? 'Chờ bạn duyệt' : `Treo quá ${takeoverDays} ngày`} · <span className="tabular-nums">{index + 1}/{items.length}</span>
          </p>
          <div className="no-scrollbar mt-1 flex gap-1 overflow-x-auto">
            {items.map(item => (
              <button key={item.id} type="button" disabled={busy} onClick={() => onOpen(item)} aria-current={item.id === currentId ? 'true' : undefined}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${item.id === currentId
                  ? 'bg-teal-700 text-white' : 'border border-amber-200 bg-white text-amber-900 hover:border-teal-400 dark:border-amber-800 dark:bg-transparent dark:text-amber-100'}`}>
                {ddmm(item.date)}</button>
            ))}
          </div>
        </div>
        <button type="button" disabled={!next || busy} onClick={() => next && onOpen(next)} aria-label="Nhật ký sau"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-amber-900 hover:bg-amber-100 disabled:opacity-30 dark:text-amber-100 dark:hover:bg-amber-900/50"><ChevronRight size={18} /></button>
      </div>
      {mode === 'takeover' && onTakeOver && (
        <div className="mt-2 flex flex-col gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 dark:border-rose-900/60 dark:bg-transparent sm:flex-row sm:items-center">
          <p className={`min-w-0 flex-1 text-xs text-rose-800 dark:text-rose-200 ${WRAP}`}>
            <AlertTriangle size={13} className="mr-1 inline -translate-y-px" />
            <b>{current.assigneeName || 'Người được giao'}</b> chưa {current.permission === 'approve' ? 'duyệt' : 'xác nhận'} · {waitingLabel(current.waitingHours)}.
            Nhận duyệt thay rồi bấm {current.permission === 'approve' ? 'Duyệt' : 'Xác nhận'} bên dưới.
          </p>
          <button type="button" disabled={busy} onClick={() => onTakeOver(current)} className={`${primaryBtn} w-full sm:w-auto`}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserRoundCheck size={15} />}Duyệt thay</button>
        </div>
      )}
    </div>
  );
};
