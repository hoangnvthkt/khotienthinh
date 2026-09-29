import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, Clock, HardHat, Loader2, RefreshCw, Truck, Users } from 'lucide-react';
import { dailyLogWbsService } from '../../../lib/projectService';
import { getCachedSignedUrl, resolveStorageUrl } from '../../../lib/storageSignedUrl';
import {
  boardStage, boardTotals, buildAttention, buildMyTask, frontName, isItemDelayed, isSentSlip, reportedFronts,
  type DailyLogTodayBoard as Board, type TodayBoardSlip,
} from '../../../lib/dailyLogTodayBoard';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  userId?: string | null;
  canSubmit: boolean;
  canSummarize: boolean;
  canApprove: boolean;
  /** Changes whenever the tab reloads its records, so the board follows. */
  refreshKey: unknown;
  onCreate: (date: string) => void;
  onSummarize: (date: string) => void;
  onReview: (dailyLogId: string) => void;
  onOpenPhotos: (photos: Array<{ url: string; name: string }>, index: number) => void;
}

const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shiftDate = (value: string, days: number) => {
  const [year, month, day] = value.split('-').map(Number);
  return localDateKey(new Date(year, month - 1, day + days));
};
const num = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const WEATHER_LABELS: Record<string, string> = { sunny: 'Nắng', cloudy: 'Nhiều mây', rainy: 'Mưa', storm: 'Mưa bão', hot: 'Nắng nóng' };
const STAGES = ['Phiếu kỹ sư', 'Tổng hợp', 'CHT duyệt', 'Đã công bố'];

const SLIP_STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Đã gửi', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  included: { label: 'Đã tổng hợp', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  returned: { label: 'Bị trả, chờ sửa', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  draft: { label: 'Nháp của bạn', cls: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
};

const DAY_TONE: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  pending: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  issue: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  empty: 'bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800',
};

function SignedThumb({ url, label, onClick }: { url: string; label: string; onClick: () => void }) {
  const [src, setSrc] = useState(() => getCachedSignedUrl(url));
  useEffect(() => {
    let active = true;
    if (!src) resolveStorageUrl(url).then(value => { if (active) setSrc(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [url, src]);
  return (
    <button type="button" onClick={onClick} aria-label={`Xem ảnh ${label}`}
      className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Camera size={16} className="m-auto text-zinc-400" aria-hidden />}
    </button>
  );
}

function FrontCard({ slip, date, onOpenPhotos }: { slip: TodayBoardSlip; date: string; onOpenPhotos: Props['onOpenPhotos'] }) {
  const status = SLIP_STATUS[slip.status] || SLIP_STATUS.submitted;
  const photos = slip.photos.map((photo, index) => ({ url: photo.url, name: photo.name || `Ảnh ${index + 1}` }));
  const shown = slip.items.slice(0, 3);
  const time = slip.submittedAt ? new Date(slip.submittedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <article className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{frontName(slip)}</h4>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{slip.authorName || 'Kỹ sư'}{time ? ` · gửi ${time}` : ''}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>{status.label}</span>
          {slip.issues && <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">Có sự cố</span>}
        </div>
      </div>
      <ul className="mt-3 space-y-2.5">
        {shown.map((item, index) => {
          const percent = Math.max(0, Math.min(100, Number(item.cumulativePercent ?? 0)));
          const late = isItemDelayed(item, date);
          return (
            <li key={`${item.wbsCode}-${index}`} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">{[item.wbsCode, item.taskName].filter(Boolean).join(' ')}</span>
                <span className={`shrink-0 tabular-nums ${late ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-600 dark:text-zinc-300'}`}>
                  {item.dailyQuantity != null ? `+${num(item.dailyQuantity)}${item.unit ? ` ${item.unit}` : ''} · ` : ''}{item.cumulativePercent != null ? `${num(percent)}%` : '—'}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
                <div className={`h-full rounded-full ${late ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
              </div>
            </li>
          );
        })}
        {slip.items.length > shown.length && <li className="text-xs text-zinc-500 dark:text-zinc-400">+{slip.items.length - shown.length} hạng mục khác</li>}
        {slip.items.length === 0 && <li className="text-sm text-zinc-500 dark:text-zinc-400">Chưa chọn hạng mục.</li>}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="flex flex-wrap gap-x-3 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1"><Users size={12} aria-hidden />{slip.people ? `${num(slip.people)} người` : 'Chưa ghi nhân công'}</span>
          {slip.machineHours > 0 && <span className="inline-flex items-center gap-1"><Truck size={12} aria-hidden />{num(slip.machineHours)} giờ máy</span>}
        </p>
        {photos.length > 0 && (
          <div className="flex gap-1.5">
            {photos.slice(0, 3).map((photo, index) => <SignedThumb key={photo.url} url={photo.url} label={photo.name} onClick={() => onOpenPhotos(photos, index)} />)}
            {slip.photoCount > 3 && <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">+{slip.photoCount - 3}</span>}
          </div>
        )}
      </div>
    </article>
  );
}

export function DailyLogTodayBoard(props: Props) {
  const today = localDateKey(new Date());
  const [date, setDate] = useState(today);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [showAllAttention, setShowAllAttention] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    dailyLogWbsService.getTodayBoard({ projectId: props.projectId, constructionSiteId: props.constructionSiteId, date })
      .then(next => { if (active) setBoard(next); })
      .catch(caught => { if (active) { setBoard(null); setError(caught instanceof Error ? caught.message : 'Không tải được dữ liệu ngày.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.projectId, props.constructionSiteId, date, retry, props.refreshKey]);

  const derived = useMemo(() => board && {
    attention: buildAttention(board),
    stage: boardStage(board),
    fronts: reportedFronts(board),
    totals: boardTotals(board),
    task: buildMyTask(board, { userId: props.userId, canSubmit: props.canSubmit, canSummarize: props.canSummarize, canApprove: props.canApprove }),
  }, [board, props.userId, props.canSubmit, props.canSummarize, props.canApprove]);

  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const runTask = () => {
    const action = derived?.task.action;
    if (action === 'review' && board?.summary) props.onReview(board.summary.id);
    else if (action === 'summarize') props.onSummarize(date);
    else if (action === 'create' || action === 'fixReturned') props.onCreate(date);
  };
  const delta = (current: number, previous?: number | null) => {
    if (previous == null) return 'Chưa có số liệu hôm qua';
    const diff = current - previous;
    return diff === 0 ? 'Bằng hôm qua' : `${diff > 0 ? '+' : ''}${num(diff)} so với hôm qua`;
  };

  return (
    <section aria-label="Hôm nay tại công trường" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setDate(shiftDate(date, -1))} aria-label="Ngày trước" className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"><ChevronLeft size={18} /></button>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{date === today ? `Hôm nay, ${dayLabel}` : dayLabel}</h3>
          <button type="button" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= today} aria-label="Ngày sau" className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800"><ChevronRight size={18} /></button>
          {date !== today && <button type="button" onClick={() => setDate(today)} className="ml-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Về hôm nay</button>}
        </div>
        {board?.summary?.weather && <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{WEATHER_LABELS[board.summary.weather] || board.summary.weather}</span>}
      </div>

      {loading && !board && <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"><Loader2 size={16} className="animate-spin" aria-hidden />Đang tải tình hình trong ngày…</div>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{error}</span>
          <button type="button" onClick={() => setRetry(value => value + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 font-medium dark:border-rose-800"><RefreshCw size={14} aria-hidden />Thử lại</button>
        </div>
      )}

      {board && derived && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          <ol className="grid grid-cols-4 gap-1.5" aria-label="Tiến trình trong ngày">
            {STAGES.map((label, index) => {
              const done = index < derived.stage || derived.stage === 3;
              const current = index === derived.stage && derived.stage !== 3;
              return (
                <li key={label} className={`border-t-[3px] pt-1.5 ${done ? 'border-emerald-500' : current ? 'border-amber-500' : 'border-zinc-200 dark:border-zinc-700'}`} aria-current={current ? 'step' : undefined}>
                  <span className={`block text-[11px] ${current ? 'text-amber-700 dark:text-amber-300' : done ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-400'}`}>{done ? 'Xong' : current ? 'Đang ở bước này' : `Bước ${index + 1}`}</span>
                  <span className="block truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{index === 0 ? `${label} ${derived.fronts.sent}/${derived.fronts.expected || derived.fronts.sent}` : label}</span>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/40">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{derived.task.title}</p>
              <p className="text-sm text-blue-800 dark:text-blue-200">{derived.task.detail}</p>
            </div>
            {derived.task.action && <button type="button" onClick={runTask} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{derived.task.actionLabel}</button>}
          </div>

          {derived.attention.length > 0 ? (
            <div>
              <h4 className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Cần chú ý ({derived.attention.length})</h4>
              <ul className="space-y-1.5">
                {(showAllAttention ? derived.attention : derived.attention.slice(0, 4)).map(item => (
                  <li key={item.key} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${item.tone === 'danger' ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>
                    {item.tone === 'danger' ? <Clock size={15} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />}
                    <span className="min-w-0 break-words">{item.text}</span>
                  </li>
                ))}
              </ul>
              {derived.attention.length > 4 && <button type="button" onClick={() => setShowAllAttention(value => !value)} className="mt-1.5 text-xs font-medium text-blue-700 dark:text-blue-300">{showAllAttention ? 'Thu gọn' : `Xem thêm ${derived.attention.length - 4} mục`}</button>}
            </div>
          ) : board.slips.some(isSentSlip) && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">Không có sự cố hay hạng mục trễ trong các phiếu đã gửi.</p>}

          <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[
              { label: 'Nhân công', value: derived.totals.people ? `${num(derived.totals.people)} người` : '—', note: derived.totals.people ? delta(derived.totals.people, board.yesterday?.people || null) : 'Chưa có phiếu ghi nhân công' },
              { label: 'Giờ máy', value: derived.totals.machineHours ? `${num(derived.totals.machineHours)} giờ` : '—', note: derived.totals.machineHours ? delta(derived.totals.machineHours, board.yesterday?.machineHours || null) : 'Chưa có phiếu ghi máy' },
              { label: 'Mũi đã báo cáo', value: `${derived.fronts.sent}/${derived.fronts.expected || derived.fronts.sent}`, note: board.missingFronts.length ? `Còn ${board.missingFronts.length} mũi chưa gửi` : 'Đủ các mũi', warn: board.missingFronts.length > 0 },
              { label: 'Hạng mục trễ', value: String(derived.totals.delayedItems), note: derived.totals.delayedItems ? 'So với ngày kết thúc kế hoạch' : 'Đúng kế hoạch', danger: derived.totals.delayedItems > 0 },
            ].map(tile => (
              <div key={tile.label} className="rounded-2xl bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</dt>
                <dd className={`mt-0.5 text-2xl font-semibold tabular-nums ${tile.danger ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-900 dark:text-zinc-100'}`}>{tile.value}</dd>
                <dd className={`text-xs ${tile.warn ? 'text-amber-700 dark:text-amber-300' : tile.danger ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-500 dark:text-zinc-400'}`}>{tile.note}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"><HardHat size={13} aria-hidden />Các mũi thi công</h4>
            {board.slips.length === 0 && board.missingFronts.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">Chưa có phiếu nào trong ngày. Phiếu của kỹ sư sẽ hiện ở đây ngay khi được gửi.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {board.slips.map(slip => <FrontCard key={slip.id} slip={slip} date={board.date} onOpenPhotos={props.onOpenPhotos} />)}
                {board.missingFronts.map(front => (
                  <article key={`missing-${front.areaCode}`} className="rounded-2xl border border-dashed border-amber-300 bg-white p-4 dark:border-amber-800 dark:bg-zinc-900">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h4 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{frontName(front)}</h4><p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{front.authorName || 'Kỹ sư'}</p></div>
                      <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Chưa gửi</span>
                    </div>
                    <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Lần gửi gần nhất: {new Date(`${front.lastDate}T00:00:00`).toLocaleDateString('vi-VN')}.</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">7 ngày gần đây</h4>
            <div className="grid grid-cols-7 gap-1.5">
              {board.days.map(day => {
                const tone = day.hasIssue ? 'issue' : day.summaryStatus === 'verified' ? 'verified' : day.slips > 0 || day.summaryStatus ? 'pending' : 'empty';
                const label = new Date(`${day.date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit' });
                return (
                  <button key={day.date} type="button" onClick={() => setDate(day.date.slice(0, 10))} aria-pressed={day.date.slice(0, 10) === date}
                    className={`rounded-xl border px-1 py-2 text-center text-[11px] leading-tight ${DAY_TONE[tone]} ${day.date.slice(0, 10) === date ? 'ring-2 ring-blue-500' : ''}`}>
                    <span className="block font-medium">{label}</span>
                    <span className="block">{tone === 'issue' ? 'Sự cố' : day.people ? `${num(day.people)} người` : day.slips ? `${day.slips} phiếu` : 'Trống'}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">Xanh: đã duyệt · Vàng: đang chờ · Đỏ: có sự cố · Xám: chưa có phiếu</p>
          </div>
        </div>
      )}
    </section>
  );
}
