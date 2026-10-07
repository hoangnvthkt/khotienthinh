import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Camera, ChevronsDownUp, ChevronsUpDown, FileText, Search, Check, ChevronLeft, ChevronRight, Clock, HardHat, Image as ImageIcon, Loader2, RefreshCw, Truck, Users,
} from 'lucide-react';
import { dailyLogWbsService } from '../../../lib/projectService';
import { getCachedSignedUrl, resolveStorageUrl } from '../../../lib/storageSignedUrl';
import {
  boardStage, buildAttention, buildMyTask, formatShortDate, frontName, isSentSlip, lateDays, needsNewForecast, reportedFronts, resourceTotals,
  type DailyLogTodayBoard as Board, type TodayBoardItem, type TodayBoardSlip,
} from '../../../lib/dailyLogTodayBoard';
import { Badge } from '../../procurement/hub/hubUi';
import { normalizeSearch } from '../../../lib/dailyLogSlipRules';
import { ENT, NUM } from '../../finance/financeUi';

// Báo cáo ngày (v3, chủ SP duyệt 04/10/2026): một màn trả lời "hôm nay ai, làm gì, làm được bao nhiêu,
// bao giờ xong, nguồn lực nào, ảnh bằng chứng" cho CHT và lãnh đạo; vẫn chỉ ra việc tiếp theo của từng vai trò.

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
  /** Mở từ ô lịch: một ngày cố định, không có thanh chuyển ngày và dải 7 ngày. */
  fixedDate?: string;
}

type Photo = { url: string; name: string; fileType?: string };
type Tab = 'front' | 'crew' | 'photo';

const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shiftDate = (value: string, days: number) => {
  const [year, month, day] = value.split('-').map(Number);
  return localDateKey(new Date(year, month - 1, day + days));
};
const num = (value: number | null | undefined, digits = 1) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: digits });
const timeOf = (value?: string | null) => {
  if (!value) return null;
  const at = new Date(value);
  return `${String(at.getDate()).padStart(2, '0')}/${String(at.getMonth() + 1).padStart(2, '0')} ${at.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
};
const WEATHER_LABELS: Record<string, string> = { sunny: 'Nắng', cloudy: 'Nhiều mây', rainy: 'Mưa', storm: 'Mưa bão', hot: 'Nắng nóng' };

const SLIP_STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Đã gửi', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200' },
  included: { label: 'Đã tổng hợp', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200' },
  returned: { label: 'Bị trả, chờ sửa', cls: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' },
  draft: { label: 'Nháp của bạn', cls: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200' },
};

const DAY_TONE: Record<string, string> = {
  verified: 'border-leaf-200 bg-leaf-50 dark:border-leaf-900 dark:bg-leaf-950/30',
  pending: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  issue: 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30',
  empty: 'border-border bg-card',
};

const isImagePhoto = (photo: { url: string; name?: string; fileType?: string }) => photo.fileType
  ? /^(image|jpe?g|png|webp|gif|heic)/i.test(photo.fileType)
  : /\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(photo.url) || !/\.[a-z0-9]{2,5}(\?|$)/i.test(photo.url);
/** Ảnh để xem: chú thích theo mũi / hạng mục thay cho tên file máy ảnh. */
export const toFiles = (list: Array<{ url: string; name?: string; fileType?: string }> | undefined) => (list || []).filter(photo => photo?.url && !isImagePhoto(photo));
export const toPhotos = (list: Array<{ url: string; name?: string; fileType?: string }> | undefined, label: string): Photo[] => {
  const images = (list || []).filter(photo => photo?.url && isImagePhoto(photo));
  return images.map((photo, index) => ({ url: photo.url, name: images.length > 1 ? `${label} · ảnh ${index + 1}` : label, fileType: 'image/jpeg' }));
};

function SignedThumb({ url, label, onClick, className = 'h-11 w-11' }: { url: string; label: string; onClick: () => void; className?: string }) {
  const [src, setSrc] = useState(() => getCachedSignedUrl(url));
  useEffect(() => {
    let active = true;
    if (!src) resolveStorageUrl(url).then(value => { if (active) setSrc(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [url, src]);
  return (
    <button type="button" onClick={onClick} aria-label={`Xem ảnh ${label}`} title={label}
      className={`${className} shrink-0 overflow-hidden rounded-lg border border-border bg-muted hover:ring-2 hover:ring-teal-500/40`}>
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Camera size={15} className="m-auto text-muted-foreground" aria-hidden />}
    </button>
  );
}

const Thumbs: React.FC<{ photos: Photo[]; files?: Array<{ url: string; name?: string }>; max?: number; onOpen: Props['onOpenPhotos'] }> = ({ photos, files = [], max = 3, onOpen }) => !photos.length && !files.length
  ? <span className="text-xs text-muted-foreground">—</span>
  : <span className="flex flex-wrap gap-1">
    {photos.slice(0, max).map((photo, index) => <SignedThumb key={`${photo.url}-${index}`} url={photo.url} label={photo.name} onClick={() => onOpen(photos, index)} />)}
    {photos.length > max && <button type="button" onClick={() => onOpen(photos, max)} className="h-11 w-11 rounded-lg bg-muted text-xs font-semibold text-muted-foreground">+{photos.length - max}</button>}
    {files.map(file => <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs font-semibold text-teal-700 hover:bg-muted dark:text-teal-300"><FileText size={12} aria-hidden />{file.name || 'Tệp đính kèm'}</a>)}
  </span>;

const Kpi: React.FC<{ icon: React.ElementType; tone: string; label: string; value: React.ReactNode; hint?: React.ReactNode; active?: boolean; wide?: boolean; onClick?: () => void }> =
  ({ icon: Icon, tone, label, value, hint, active, wide, onClick }) =>
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`${wide ? 'col-span-2 lg:col-span-1' : ''} min-w-0 rounded-2xl border bg-card p-3 text-left shadow-sm transition ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className={`grid h-6 w-6 place-items-center rounded-lg ${tone}`}><Icon size={14} aria-hidden /></span>{label}</span>
      <span className="mt-1.5 block text-2xl font-bold tabular-nums">{value}</span>
      {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
    </button>;

const Notes: React.FC<{ note?: string | null }> = ({ note }) => {
  const lines = (note || '').split('\n').map(line => line.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
  if (!lines.length) return null;
  return <ul className="mt-0.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
    {lines.map((line, index) => <li key={index} className="flex gap-1.5"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-mint-500" aria-hidden />{line}</li>)}
  </ul>;
};

const TodayQty: React.FC<{ item: TodayBoardItem }> = ({ item }) => {
  if (item.dailyQuantity == null) return <span className="text-muted-foreground" title="Chưa có số lũy kế hôm trước để tính khối lượng trong ngày">—</span>;
  return <span className="block whitespace-nowrap"><span className={`${NUM} text-base`}>+{num(item.dailyQuantity, 2)}</span> <span className="text-xs text-muted-foreground">{item.unit}</span></span>;
};

const Cumulative: React.FC<{ item: TodayBoardItem; late: boolean }> = ({ item, late }) => {
  if (item.cumulativePercent == null) return <span className="text-xs text-muted-foreground">—</span>;
  const percent = Math.max(0, Math.min(100, Number(item.cumulativePercent)));
  return <span className="block min-w-[7rem]">
    <span className="flex items-baseline justify-between gap-2 whitespace-nowrap"><span className={NUM}>{num(item.cumulativePercent)}%</span>
      {item.cumulativeQuantity != null && <span className="text-xs text-muted-foreground"><span className="tabular-nums">{num(item.cumulativeQuantity, 0)}</span>
        {item.plannedQuantity ? `/${num(item.plannedQuantity, 0)}` : ''} {item.unit}</span>}</span>
    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className={`block h-full rounded-full ${late ? 'bg-rose-400' : 'bg-leaf-500'}`} style={{ width: `${percent}%` }} /></span>
  </span>;
};

const Finish: React.FC<{ item: TodayBoardItem; date: string }> = ({ item, date }) => {
  if (Number(item.cumulativePercent ?? 0) >= 100) return <Badge className="border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200"><Check size={12} aria-hidden />Đã xong</Badge>;
  const planned = item.scheduleFinishDate?.slice(0, 10);
  const forecast = item.forecastFinishDate?.slice(0, 10);
  const late = lateDays(item, date);
  const shown = forecast && !needsNewForecast(item, date) ? forecast : planned;
  const title = [planned && `Kế hoạch ${formatShortDate(planned)}`, forecast && forecast !== planned && `Dự kiến ${formatShortDate(forecast)}`, item.forecastChangeReason].filter(Boolean).join(' · ');
  return <span className="flex flex-wrap items-center gap-1.5" title={title || undefined}>
    {shown ? <b className={`tabular-nums ${late ? 'text-rose-700 dark:text-rose-300' : 'text-foreground'}`}>{formatShortDate(shown)}</b> : <span className="text-muted-foreground">—</span>}
    {late != null && <Badge className="overdue-blink border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Trễ {late} ngày</Badge>}
  </span>;
};

const Resources: React.FC<{ item: TodayBoardItem }> = ({ item }) => {
  const labor = item.labor || [];
  const machines = item.machines || [];
  if (!labor.length && !machines.length) return <span className="text-muted-foreground">—</span>;
  return <span className="flex flex-wrap gap-1">
    {labor.map((line, index) => <span key={`l${index}`} title={[line.laborType, line.manual && !line.contractLinked ? 'chờ gắn hợp đồng' : ''].filter(Boolean).join(' · ')}
      className="inline-flex items-center gap-1 rounded-md bg-mint-50 px-1.5 py-0.5 text-xs dark:bg-mint-950/40">
      <Users size={11} className="text-mint-600" aria-hidden /><span className={ENT}>{line.provider || line.laborType || 'Tổ đội'}</span><span className={NUM}>{num(line.people)}</span></span>)}
    {machines.map((line, index) => <span key={`m${index}`} title={line.provider || undefined}
      className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-xs dark:bg-sky-950/40">
      <Truck size={11} className="text-sky-600" aria-hidden /><span className="font-semibold text-sky-800 dark:text-sky-200">{line.machineType || 'Máy'}</span><span className={NUM}>{line.hours == null ? '?' : `${num(line.hours)}h`}</span></span>)}
  </span>;
};

const slipPeople = (slip: TodayBoardSlip) => Number(slip.people || 0);

const GRID = 'md:grid md:grid-cols-[minmax(0,1fr)_6.5rem_10rem_8.5rem_minmax(0,12rem)_8rem] md:items-start md:gap-3';

const FrontTable: React.FC<{ board: Board; onlyLate: boolean; onOpenPhotos: Props['onOpenPhotos']; renderSlipExtra?: (slip: TodayBoardSlip) => React.ReactNode; emptyItemsText?: string }> = ({ board, onlyLate, onOpenPhotos, renderSlipExtra, emptyItemsText = '—' }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const words = normalizeSearch(query.trim()).split(/\s+/).filter(Boolean);
  const matches = (slip: TodayBoardSlip, item: TodayBoardItem) => !words.length || (() => {
    const hay = normalizeSearch([frontName(slip), slip.authorName, item.wbsCode, item.taskName, item.note,
      ...(item.labor || []).map(line => line.provider), ...(item.machines || []).map(line => `${line.machineType} ${line.provider || ''}`)].filter(Boolean).join(' '));
    return words.every(word => hay.includes(word));
  })();
  const groups = board.slips.map(slip => ({ slip, items: slip.items.filter(item => (!onlyLate || lateDays(item, board.date) != null || needsNewForecast(item, board.date)) && matches(slip, item)) }))
    .filter(group => (!onlyLate && !words.length) || group.items.length);
  const isOpen = (id: string) => words.length > 0 || onlyLate || open.has(id);
  const allOpen = groups.length > 0 && groups.every(group => isOpen(group.slip.id));
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => set(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const expandAll = () => { setOpen(new Set(groups.map(group => group.slip.id))); setOpenItems(new Set(groups.flatMap(group => group.items.map((item, index) => `${group.slip.id}:${index}`)))); };
  const collapseAll = () => { setOpen(new Set()); setOpenItems(new Set()); };
  const toolbar = <div className="mb-2 flex flex-wrap items-center gap-2">
    <label className="relative min-w-[12rem] flex-1">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm hạng mục, mũi, kỹ sư, tổ đội, máy…" aria-label="Tìm trong báo cáo ngày"
        className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
    </label>
    <button type="button" onClick={allOpen ? collapseAll : expandAll} disabled={!groups.length}
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted disabled:opacity-50">
      {allOpen ? <><ChevronsDownUp size={15} aria-hidden />Thu gọn hết</> : <><ChevronsUpDown size={15} aria-hidden />Mở rộng hết</>}</button>
  </div>;
  if (!groups.length && !board.missingFronts.length) return <>{toolbar}<p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
    {words.length ? `Không có hạng mục khớp "${query.trim()}".` : onlyLate ? 'Không có hạng mục trễ trong các phiếu của ngày này.' : 'Chưa có phiếu nào trong ngày. Phiếu của kỹ sư sẽ hiện ở đây ngay khi được gửi.'}</p></>;
  const head = (slip: TodayBoardSlip, count: number, expanded: boolean) => {
    const status = SLIP_STATUS[slip.status] || SLIP_STATUS.submitted;
    const photos = toPhotos(slip.photos, `${frontName(slip)} · ảnh chung`);
    return <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={() => toggle(setOpen, slip.id)} aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 text-left font-bold text-mint-800 hover:underline dark:text-mint-200">
        <ChevronRight size={16} className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden /><HardHat size={15} aria-hidden />{frontName(slip)}</button>
      <span className="text-xs text-muted-foreground">KS <span className={ENT}>{slip.authorName || '—'}</span>{slip.submittedAt ? <> · <b className="text-foreground">{timeOf(slip.submittedAt)}</b></> : ''}</span>
      <Badge className={status.cls}>{status.label}</Badge>
      {slip.issues && <Badge className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" title={slip.issues}><AlertTriangle size={12} aria-hidden />Có sự cố</Badge>}
      <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span title="Hạng mục"><HardHat size={12} className="mr-0.5 inline" aria-hidden /><span className={NUM}>{count}</span></span>
        <span title="Nhân công"><Users size={12} className="mr-0.5 inline" aria-hidden /><span className={NUM}>{num(slipPeople(slip))}</span></span>
        {photos.length > 0 && <button type="button" onClick={() => onOpenPhotos(photos, 0)} title="Ảnh chung" className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-semibold text-teal-700 hover:bg-muted dark:text-teal-300">
          <Camera size={12} aria-hidden />{slip.photoCount}</button>}
      </span>
      {renderSlipExtra?.(slip)}
      {expanded && slip.issues && <span className="basis-full text-xs text-amber-800 dark:text-amber-200">Sự cố: {slip.issues}</span>}
      {slip.status === 'returned' && slip.returnReason && <span className="basis-full text-xs text-amber-800 dark:text-amber-200">Lý do trả: {slip.returnReason}</span>}
    </div>;
  };
  const row = (slip: TodayBoardSlip, item: TodayBoardItem, index: number) => {
    const key = `${slip.id}:${index}`;
    const late = lateDays(item, board.date) != null;
    const hasNote = Boolean(item.note?.trim());
    const itemOpen = openItems.has(key);
    const label = `${frontName(slip)} · ${[item.wbsCode, item.taskName].filter(Boolean).join(' ')}`;
    return <article key={`${item.taskId || item.wbsCode}-${index}`}
      className={`rounded-xl border border-border bg-card px-3 py-2.5 text-sm shadow-sm transition hover:border-teal-300 hover:shadow-md ${late ? 'border-l-4 border-l-rose-400' : 'border-l-4 border-l-leaf-400'}`}>
      <div className={`space-y-2 md:space-y-0 ${GRID}`}>
        <div className="min-w-0">
          <button type="button" disabled={!hasNote} onClick={() => toggle(setOpenItems, key)} aria-expanded={hasNote ? itemOpen : undefined}
            className="flex w-full items-start gap-1.5 text-left disabled:cursor-default">
            {hasNote && <ChevronRight size={14} className={`mt-1 shrink-0 text-muted-foreground transition-transform ${itemOpen ? 'rotate-90' : ''}`} aria-hidden />}
            <span><span className="text-xs font-semibold text-mint-700 dark:text-mint-300">{item.wbsCode}</span> <span className="font-semibold text-foreground">{item.taskName}</span></span>
          </button>
          {hasNote && <div className={itemOpen ? 'pl-5' : 'hidden'}><Notes note={item.note} /></div>}
        </div>
        <div className="flex items-center justify-between gap-2 md:block"><span className="text-xs text-muted-foreground md:hidden">Hôm nay</span><TodayQty item={item} /></div>
        <div className="flex items-center justify-between gap-2 md:block"><span className="text-xs text-muted-foreground md:hidden">Lũy kế</span><Cumulative item={item} late={late} /></div>
        <div className="flex items-center justify-between gap-2 md:block"><span className="text-xs text-muted-foreground md:hidden">Ngày hoàn thành</span><Finish item={item} date={board.date} /></div>
        <div className="flex items-start justify-between gap-2 md:block"><span className="text-xs text-muted-foreground md:hidden">Nguồn lực</span><Resources item={item} /></div>
        <div className="flex items-start justify-between gap-2 md:block"><span className="text-xs text-muted-foreground md:hidden">Ảnh</span><Thumbs photos={toPhotos(item.photos, label)} files={toFiles(item.photos)} onOpen={onOpenPhotos} /></div>
      </div>
    </article>;
  };
  const missing = board.missingFronts.map(front => <div key={`missing-${front.areaCode}`} className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-amber-300 bg-amber-50/40 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/20">
    <HardHat size={15} className="text-amber-700" aria-hidden /><span className="font-semibold">{frontName(front)}</span>
    {front.authorName && <span className="text-xs text-muted-foreground">KS <span className={ENT}>{front.authorName}</span></span>}
    <Badge className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Chưa gửi phiếu</Badge>
    <span className="text-xs text-muted-foreground">{formatShortDate(front.lastDate)}</span>
  </div>);
  return <div>
    {toolbar}
    <div className={`hidden px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${GRID}`}>
      <span className="pl-4">Hạng mục thi công</span><span>Hôm nay</span><span>Lũy kế</span><span>Ngày hoàn thành</span><span>Nguồn lực</span><span>Ảnh</span>
    </div>
    <div className="space-y-2">
      {groups.map(({ slip, items }) => {
        const expanded = isOpen(slip.id);
        return <section key={slip.id} className="rounded-2xl border border-mint-200 bg-mint-50/50 p-2 dark:border-mint-900 dark:bg-mint-950/20">
          <div className="px-1.5 py-1">{head(slip, items.length, expanded)}</div>
          <div className={expanded ? 'mt-2 space-y-1.5' : 'hidden'}>
            {items.map((item, index) => row(slip, item, index))}
            {!items.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyItemsText}</p>}
          </div>
        </section>;
      })}
      {!onlyLate && !words.length && missing}
    </div>
  </div>;
};

const CrewView: React.FC<{ board: Board }> = ({ board }) => {
  const { crews, machines } = useMemo(() => resourceTotals(board), [board]);
  if (!crews.length && !machines.length) return <div className="rounded-2xl border border-dashed border-amber-300 bg-card px-6 py-10 text-center">
    <Users size={26} className="mx-auto text-amber-600" aria-hidden />
    <p className="mt-2 font-semibold">Chưa phiếu nào ghi nhân công hoặc máy</p>
    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Kỹ sư thêm tổ đội và máy ngay tại dòng hạng mục trên phiếu; số liệu sẽ cộng ở đây theo tổ đội.</p>
  </div>;
  const tasks = (items: Array<{ item: TodayBoardItem; slip: TodayBoardSlip }>) => items.map(({ item, slip }, index) =>
    <span key={index} className="mb-0.5 mr-1 inline-block rounded-md bg-muted px-1.5 py-0.5"><b>{item.wbsCode}</b> {item.taskName} · <span className="text-mint-700 dark:text-mint-300">{frontName(slip)}</span></span>);
  return <div className="grid gap-3 2xl:grid-cols-[3fr_2fr]">
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <h4 className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2 text-sm font-bold"><Users size={15} className="text-mint-600" aria-hidden />Nhân công theo tổ đội</h4>
      {crews.length ? <table className="w-full text-sm"><thead className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <tr><th className="px-3 py-2">Tổ đội / nhà thầu</th><th className="w-24 px-3 py-2 text-right">Số người</th><th className="w-24 px-3 py-2 text-right">Giờ công</th><th className="px-3 py-2">Làm hạng mục nào</th></tr></thead>
        <tbody>{crews.map(crew => <tr key={crew.name} className="border-t border-border/70 align-top">
          <td className="px-3 py-2"><span className={ENT}>{crew.name}</span>
            {crew.manual && !crew.contractLinked && <span className="mt-0.5 block"><Badge className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Chờ gắn hợp đồng</Badge></span>}</td>
          <td className="px-3 py-2 text-right"><span className={NUM}>{num(crew.people)}</span></td>
          <td className="px-3 py-2 text-right"><span className={NUM}>{num(crew.hours)}</span></td>
          <td className="px-3 py-2 text-xs">{tasks(crew.items)}</td>
        </tr>)}
          <tr className="border-t border-border bg-muted/40 font-semibold"><td className="px-3 py-2">Tổng</td>
            <td className="px-3 py-2 text-right"><span className={NUM}>{num(crews.reduce((sum, crew) => sum + crew.people, 0))}</span></td>
            <td className="px-3 py-2 text-right"><span className={NUM}>{num(crews.reduce((sum, crew) => sum + crew.hours, 0))}</span></td><td /></tr>
        </tbody></table> : <p className="px-3 py-4 text-sm text-muted-foreground">Chưa ghi nhân công.</p>}
    </section>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <h4 className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2 text-sm font-bold"><Truck size={15} className="text-sky-600" aria-hidden />Máy thi công</h4>
      {machines.length ? <table className="w-full text-sm"><thead className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <tr><th className="px-3 py-2">Máy · đơn vị</th><th className="w-20 px-3 py-2 text-right">Số máy</th><th className="w-24 px-3 py-2 text-right">Giờ máy</th><th className="px-3 py-2">Hạng mục</th></tr></thead>
        <tbody>{machines.map(machine => <tr key={`${machine.name}|${machine.provider}`} className="border-t border-border/70 align-top">
          <td className="px-3 py-2"><span className="font-semibold text-sky-800 dark:text-sky-200">{machine.name}</span>{machine.provider && <span className={`block text-xs ${ENT}`}>{machine.provider}</span>}</td>
          <td className="px-3 py-2 text-right"><span className={NUM}>{num(machine.count)}</span></td>
          <td className="px-3 py-2 text-right"><span className={NUM}>{num(machine.hours)}</span></td>
          <td className="px-3 py-2 text-xs">{tasks(machine.items)}</td>
        </tr>)}</tbody></table> : <p className="px-3 py-4 text-sm text-muted-foreground">Chưa ghi máy.</p>}
    </section>
  </div>;
};

const PhotoView: React.FC<{ board: Board; onOpenPhotos: Props['onOpenPhotos'] }> = ({ board, onOpenPhotos }) => {
  const groups = board.slips.map(slip => {
    const photos = [...toPhotos(slip.photos, 'Ảnh chung'), ...slip.items.flatMap(item => toPhotos(item.photos, [item.wbsCode, item.taskName].filter(Boolean).join(' ')))];
    return { slip, photos };
  }).filter(group => group.photos.length);
  if (!groups.length) return <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">Chưa có ảnh hiện trường trong ngày.</p>;
  return <div className="space-y-3">{groups.map(({ slip, photos }) => <section key={slip.id} className="rounded-2xl border border-border bg-card p-3">
    <h4 className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-mint-800 dark:text-mint-200"><HardHat size={15} aria-hidden />{frontName(slip)}
      <span className="text-xs font-normal text-muted-foreground">· KS <span className={ENT}>{slip.authorName || 'chưa rõ'}</span> · <span className={NUM}>{photos.length}</span> ảnh</span></h4>
    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
      {photos.map((photo, index) => <figure key={`${photo.url}-${index}`} className="min-w-0">
        <SignedThumb url={photo.url} label={photo.name} className="aspect-square w-full" onClick={() => onOpenPhotos(photos, index)} />
        <figcaption className="mt-0.5 truncate text-[11px] text-muted-foreground" title={photo.name}>{photo.name}</figcaption>
      </figure>)}
    </div>
    {slip.photoCount > (slip.photos || []).length && <p className="mt-1 text-xs text-muted-foreground">Còn {slip.photoCount - slip.photos.length} ảnh chung khác — mở phiếu để xem đủ.</p>}
  </section>)}</div>;
};

/** Thân báo cáo một ngày (ô số, cần chú ý, bảng theo mũi / tổ đội / ảnh) — dùng cho Báo cáo ngày và màn duyệt bản tổng hợp. */
export function DayReportBody({ board, onOpenPhotos, renderSlipExtra, unknownTotals = false, emptyItemsText }: {
  board: Board; onOpenPhotos: Props['onOpenPhotos']; renderSlipExtra?: (slip: TodayBoardSlip) => React.ReactNode;
  /** Hồ sơ đã duyệt thiếu bản lưu: không suy ra tổng số. */
  unknownTotals?: boolean; emptyItemsText?: string;
}) {
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [tab, setTab] = useState<Tab>('front');
  const [onlyLate, setOnlyLate] = useState(false);
  const d = useMemo(() => {
    const sent = board.slips.filter(isSentSlip);
    const items = sent.flatMap(slip => slip.items);
    const { crews, machines } = resourceTotals(board);
    return {
      attention: buildAttention(board), fronts: reportedFronts(board).sent, sent, items, crews, machines,
      people: sent.reduce((sum, slip) => sum + Number(slip.people || 0), 0),
      laborHours: sent.some(slip => slip.laborHours == null) ? null : sent.reduce((sum, slip) => sum + Number(slip.laborHours || 0), 0),
      machineCount: sent.reduce((sum, slip) => sum + Number(slip.machineCount || 0), 0),
      machineHours: sent.some(slip => slip.machineHours == null) ? null : sent.reduce((sum, slip) => sum + Number(slip.machineHours || 0), 0),
      late: items.filter(item => lateDays(item, board.date) != null).length,
      noForecast: items.filter(item => needsNewForecast(item, board.date)).length,
      withQuantity: items.filter(item => Number(item.dailyQuantity || 0) > 0).length,
      photos: sent.reduce((sum, slip) => sum + Number(slip.photoCount || 0) + slip.items.reduce((total, item) => total + Number(item.attachmentCount || 0), 0), 0),
      itemsWithPhotos: items.filter(item => Number(item.attachmentCount || 0) > 0).length,
    };
  }, [board]);
  return <>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      <Kpi icon={Users} tone="bg-mint-100 text-mint-700 dark:bg-mint-950 dark:text-mint-300" label="Nhân công" active={tab === 'crew'} onClick={() => setTab('crew')}
        value={unknownTotals ? <span className="text-base font-semibold text-muted-foreground">Chưa xác định</span> : d.people ? <><span className="text-mint-700 dark:text-mint-300">{num(d.people)}</span> <span className="text-sm font-semibold text-muted-foreground">người · {d.laborHours == null ? 'Chưa xác định giờ công' : <><span className="tabular-nums">{num(d.laborHours)}</span> giờ</>}</span></> : <span className="text-muted-foreground">—</span>} />
      <Kpi icon={Truck} tone="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" label="Máy thi công" onClick={() => setTab('crew')}
        value={unknownTotals ? <span className="text-base font-semibold text-muted-foreground">Chưa xác định</span> : d.machineCount ? <><span className="text-sky-700 dark:text-sky-300">{num(d.machineCount)}</span> <span className="text-sm font-semibold text-muted-foreground">máy · {d.machineHours == null ? '?' : num(d.machineHours)} giờ</span></> : <span className="text-muted-foreground">—</span>} />
      <Kpi icon={HardHat} tone="bg-leaf-100 text-leaf-700 dark:bg-leaf-950 dark:text-leaf-300" label="Hạng mục làm" active={tab === 'front' && !onlyLate} onClick={() => { setTab('front'); setOnlyLate(false); }}
        value={unknownTotals ? <span className="text-base font-semibold text-muted-foreground">Chưa xác định</span> : <><span className="text-leaf-700 dark:text-leaf-300">{d.items.length}</span> <span className="text-sm font-semibold text-muted-foreground">· {d.fronts} mũi</span></>} />
      <Kpi icon={Clock} tone="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" label="Trễ kế hoạch" active={tab === 'front' && onlyLate} onClick={() => { setTab('front'); setOnlyLate(true); }}
        value={d.late ? <span className="overdue-blink text-rose-700 dark:text-rose-300">{d.late}</span> : <span className="text-muted-foreground">—</span>} />
      <Kpi wide icon={Camera} tone="bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300" label="Ảnh hiện trường" active={tab === 'photo'} onClick={() => setTab('photo')}
        value={d.photos ? <span className="text-teal-700 dark:text-teal-300">{d.photos}</span> : <span className="text-muted-foreground">—</span>} />
    </div>

    {(d.attention.length > 0 || (d.sent.length > 0 && !d.people)) && (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        <button type="button" onClick={() => setShowAllAttention(value => !value)} aria-expanded={showAllAttention}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-bold">
          <AlertTriangle size={16} aria-hidden />Cần chú ý
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{d.attention.length + (d.sent.length > 0 && !d.people ? 1 : 0)}</span>
          <ChevronRight size={16} className={`ml-auto transition-transform ${showAllAttention ? 'rotate-90' : ''}`} aria-hidden />
        </button>
        <ul className={showAllAttention ? 'space-y-1 px-3 pb-3' : 'hidden'}>
          {d.sent.length > 0 && !d.people && <li>Chưa phiếu nào ghi <b>nhân công</b>.</li>}
          {d.attention.map(item => <li key={item.key} className="flex items-start gap-1.5">
            {item.tone === 'danger' ? <Clock size={14} className="mt-0.5 shrink-0 text-rose-600" aria-hidden /> : <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />}
            <span className="min-w-0 break-words">{item.text}</span></li>)}
        </ul>
      </section>
    )}

    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
      <div role="tablist" aria-label="Cách xem báo cáo" className="-mb-px flex max-w-full gap-1 overflow-x-auto">
        {([['front', 'Theo mũi thi công', HardHat], ['crew', 'Theo tổ đội & máy', Users], ['photo', `Ảnh hiện trường (${d.photos})`, ImageIcon]] as const).map(([key, label, Icon]) =>
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === key ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <Icon size={15} aria-hidden />{label}</button>)}
      </div>
      {tab === 'front' && <button type="button" aria-pressed={onlyLate} onClick={() => setOnlyLate(value => !value)}
        className={`mb-1 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${onlyLate ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}><Clock size={12} aria-hidden />Chỉ hạng mục trễ</button>}
    </div>

    {tab === 'front' && <FrontTable board={board} onlyLate={onlyLate} onOpenPhotos={onOpenPhotos} renderSlipExtra={renderSlipExtra} emptyItemsText={emptyItemsText} />}
    {tab === 'crew' && <CrewView board={board} />}
    {tab === 'photo' && <PhotoView board={board} onOpenPhotos={onOpenPhotos} />}
  </>;
}

export function DailyLogTodayBoard(props: Props) {
  const today = localDateKey(new Date());
  const [stateDate, setDate] = useState(today);
  const date = props.fixedDate || stateDate;
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
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

  const derived = useMemo(() => {
    if (!board) return null;
    return {
      stage: boardStage(board),
      fronts: reportedFronts(board),
      task: buildMyTask(board, { userId: props.userId, canSubmit: props.canSubmit, canSummarize: props.canSummarize, canApprove: props.canApprove }),
    };
  }, [board, props.userId, props.canSubmit, props.canSummarize, props.canApprove]);

  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const runTask = () => {
    const action = derived?.task.action;
    if (action === 'review' && board?.summary) props.onReview(board.summary.id);
    else if (action === 'summarize') props.onSummarize(date);
    else if (action === 'create' || action === 'fixReturned') props.onCreate(date);
  };
  const steps = derived && board ? [
    { label: 'Phiếu kỹ sư', who: `${derived.fronts.sent}/${derived.fronts.expected || derived.fronts.sent} mũi đã gửi`, entity: false },
    { label: 'Tổng hợp', who: board.summary?.summarizedByName || 'Chưa tổng hợp', entity: Boolean(board.summary?.summarizedByName) },
    { label: 'CHT duyệt', who: board.summary?.submittedToName || 'Chưa gửi duyệt', entity: Boolean(board.summary?.submittedToName) },
    { label: 'Công bố', who: board.summary?.status === 'verified' ? `Đã duyệt${board.summary.verifiedBy ? ` · ${board.summary.verifiedBy}` : ''}` : 'Tiến độ chính thức', entity: false },
  ] : [];

  return (
    <section aria-label="Báo cáo ngày" className="space-y-4">
      {!props.fixedDate && <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => setDate(shiftDate(date, -1))} aria-label="Ngày trước" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><ChevronLeft size={18} /></button>
          <h3 className="text-lg font-bold text-foreground first-letter:uppercase">{date === today ? 'Hôm nay, ' : ''}<span className="text-mint-700 dark:text-mint-300">{dayLabel}</span></h3>
          <button type="button" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= today} aria-label="Ngày sau" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"><ChevronRight size={18} /></button>
          {date !== today && <button type="button" onClick={() => setDate(today)} className="ml-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted">Về hôm nay</button>}
          {board?.summary?.weather && <Badge className="ml-1 border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{WEATHER_LABELS[board.summary.weather] || board.summary.weather}</Badge>}
        </div>
      </div>}

      {loading && !board && <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" aria-hidden />Đang tải báo cáo ngày…</div>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{error}</span>
          <button type="button" onClick={() => setRetry(value => value + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 font-medium dark:border-rose-800"><RefreshCw size={14} aria-hidden />Thử lại</button>
        </div>
      )}

      {board && derived && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          {!props.fixedDate && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-mint-200 bg-mint-50 px-4 py-3 dark:border-mint-900 dark:bg-mint-950/30">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{derived.task.title}</p>
              <p className="text-sm text-muted-foreground">{derived.task.detail}</p>
            </div>
            {derived.task.action && <button type="button" onClick={runTask} className="inline-flex items-center gap-1.5 rounded-lg bg-leaf-600 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-600">{derived.task.actionLabel}</button>}
          </div>}

          <ol className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Tiến trình trong ngày">
            {steps.map((step, index) => {
              const done = index < derived.stage || derived.stage === 3;
              const current = index === derived.stage && derived.stage !== 3;
              return <li key={step.label} aria-current={current ? 'step' : undefined}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${current ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20' : 'border-border bg-card'}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? 'bg-leaf-500 text-white' : current ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                  {done ? <Check size={14} aria-hidden /> : index + 1}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold">{step.label}</span>
                  <span className={`block truncate text-xs ${step.entity ? ENT : 'text-muted-foreground'}`}>{step.who}</span></span>
              </li>;
            })}
          </ol>

          <DayReportBody board={board} onOpenPhotos={props.onOpenPhotos} />

          {!props.fixedDate && <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">7 ngày gần đây · nhân công</h4>
            <div className="grid grid-cols-7 gap-1.5">
              {board.days.map(day => {
                const key = day.date.slice(0, 10);
                const people = Number(day.people || 0) || Number(day.summaryPeople || 0);
                const tone = day.hasIssue ? 'issue' : day.summaryStatus === 'verified' ? 'verified' : day.slips > 0 || day.summaryStatus ? 'pending' : 'empty';
                return <button key={key} type="button" onClick={() => setDate(key)} aria-pressed={key === date}
                  className={`rounded-xl border px-1 py-2 text-center text-xs ${DAY_TONE[tone]} ${key === date ? 'ring-2 ring-teal-500' : ''}`}>
                  <span className="block text-muted-foreground">{new Date(`${key}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                  <span className={`block text-base ${people ? NUM : 'font-semibold text-muted-foreground'}`}>{people ? num(people) : '—'}</span>
                  <span className="block text-[10px] text-muted-foreground">{tone === 'issue' ? 'có sự cố' : people ? 'người' : day.slips ? `${day.slips} phiếu` : 'trống'}</span>
                </button>;
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Xanh: đã duyệt · Vàng: đang chờ · Đỏ: có sự cố · Trắng: chưa có phiếu</p>
          </div>}
        </div>
      )}
    </section>
  );
}
