import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, Clock, HardHat, Image as ImageIcon, Loader2, RefreshCw, Truck, Users,
} from 'lucide-react';
import { dailyLogWbsService } from '../../../lib/projectService';
import { getCachedSignedUrl, resolveStorageUrl } from '../../../lib/storageSignedUrl';
import {
  boardStage, buildAttention, buildMyTask, formatShortDate, frontName, isSentSlip, lateDays, needsNewForecast, reportedFronts, resourceTotals,
  type DailyLogTodayBoard as Board, type TodayBoardItem, type TodayBoardSlip,
} from '../../../lib/dailyLogTodayBoard';
import { Badge } from '../../procurement/hub/hubUi';
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
}

type Photo = { url: string; name: string };
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

const toPhotos = (list: Array<{ url: string; name?: string }> | undefined, prefix: string): Photo[] =>
  (list || []).filter(photo => photo?.url).map((photo, index) => ({ url: photo.url, name: photo.name || `${prefix} ${index + 1}` }));

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

const Thumbs: React.FC<{ photos: Photo[]; max?: number; onOpen: Props['onOpenPhotos'] }> = ({ photos, max = 3, onOpen }) => !photos.length
  ? <span className="text-xs text-muted-foreground">—</span>
  : <span className="flex flex-wrap gap-1">
    {photos.slice(0, max).map((photo, index) => <SignedThumb key={`${photo.url}-${index}`} url={photo.url} label={photo.name} onClick={() => onOpen(photos, index)} />)}
    {photos.length > max && <button type="button" onClick={() => onOpen(photos, max)} className="h-11 w-11 rounded-lg bg-muted text-xs font-semibold text-muted-foreground">+{photos.length - max}</button>}
  </span>;

const Kpi: React.FC<{ icon: React.ElementType; tone: string; label: string; value: React.ReactNode; hint: React.ReactNode; active?: boolean; wide?: boolean; onClick?: () => void }> =
  ({ icon: Icon, tone, label, value, hint, active, wide, onClick }) =>
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`${wide ? 'col-span-2 lg:col-span-1' : ''} min-w-0 rounded-2xl border bg-card p-3 text-left shadow-sm transition ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className={`grid h-6 w-6 place-items-center rounded-lg ${tone}`}><Icon size={14} aria-hidden /></span>{label}</span>
      <span className="mt-1.5 block text-xl font-bold tabular-nums">{value}</span>
      <span className="block truncate text-xs text-muted-foreground">{hint}</span>
    </button>;

const Notes: React.FC<{ note?: string | null }> = ({ note }) => {
  const lines = (note || '').split('\n').map(line => line.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
  if (!lines.length) return <span className="mt-0.5 block text-xs italic text-muted-foreground">Chưa ghi công tác</span>;
  return <ul className="mt-0.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
    {lines.map((line, index) => <li key={index} className="flex gap-1.5"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-mint-500" aria-hidden />{line}</li>)}
  </ul>;
};

const TodayQty: React.FC<{ item: TodayBoardItem }> = ({ item }) => {
  if (item.dailyQuantity == null) return <span className="block text-xs text-muted-foreground" title="Chưa có số lũy kế hôm trước để tính khối lượng trong ngày">—<span className="block">chưa có số hôm trước</span></span>;
  if (Number(item.dailyQuantity) === 0) return <span className="text-xs text-muted-foreground">Không tăng</span>;
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
  const missing = needsNewForecast(item, date);
  return <span className="block text-xs leading-5">
    <span className="block text-muted-foreground">Kế hoạch <b className="text-foreground">{planned ? formatShortDate(planned) : 'chưa có'}</b></span>
    {missing ? <span className="block font-semibold text-amber-700 dark:text-amber-300">Chưa có ngày dự kiến mới</span>
      : forecast && <span className="block" title={item.forecastChangeReason || undefined}>Dự kiến <b className={late ? 'text-rose-700 dark:text-rose-300' : 'text-leaf-700 dark:text-leaf-300'}>{formatShortDate(forecast)}</b></span>}
    {late != null && <Badge className="overdue-blink mt-0.5 border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Trễ {late} ngày</Badge>}
  </span>;
};

const Resources: React.FC<{ item: TodayBoardItem }> = ({ item }) => {
  const labor = item.labor || [];
  const machines = item.machines || [];
  if (!labor.length && !machines.length) return <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Chưa ghi</span>;
  return <span className="flex flex-wrap gap-1">
    {labor.map((line, index) => <span key={`l${index}`} title={[line.laborType, line.manual && !line.contractLinked ? 'chờ gắn hợp đồng' : ''].filter(Boolean).join(' · ')}
      className="inline-flex items-center gap-1 rounded-md bg-mint-50 px-1.5 py-0.5 text-xs dark:bg-mint-950/40">
      <Users size={11} className="text-mint-600" aria-hidden /><span className={ENT}>{line.provider || line.laborType || 'Tổ đội'}</span><span className={NUM}>{num(line.people)}</span></span>)}
    {machines.map((line, index) => <span key={`m${index}`} title={line.provider || undefined}
      className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-xs dark:bg-sky-950/40">
      <Truck size={11} className="text-sky-600" aria-hidden /><span className="font-semibold text-sky-800 dark:text-sky-200">{line.machineType || 'Máy'}</span><span className={NUM}>{num(line.hours)}h</span></span>)}
  </span>;
};

const slipPeople = (slip: TodayBoardSlip) => Number(slip.people || 0);

const FrontTable: React.FC<{ board: Board; onlyLate: boolean; onOpenPhotos: Props['onOpenPhotos'] }> = ({ board, onlyLate, onOpenPhotos }) => {
  const groups = board.slips.map(slip => ({ slip, items: slip.items.filter(item => !onlyLate || lateDays(item, board.date) != null || needsNewForecast(item, board.date)) }))
    .filter(group => !onlyLate || group.items.length);
  if (!groups.length && !board.missingFronts.length) return <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
    {onlyLate ? 'Không có hạng mục trễ trong các phiếu của ngày này.' : 'Chưa có phiếu nào trong ngày. Phiếu của kỹ sư sẽ hiện ở đây ngay khi được gửi.'}</p>;
  const head = (slip: TodayBoardSlip, count: number) => {
    const status = SLIP_STATUS[slip.status] || SLIP_STATUS.submitted;
    const photos = toPhotos(slip.photos, `Ảnh chung ${frontName(slip)}`);
    return <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1.5 font-bold text-mint-800 dark:text-mint-200"><HardHat size={15} aria-hidden />{frontName(slip)}</span>
      <span className="text-xs text-muted-foreground">KS <span className={ENT}>{slip.authorName || 'chưa rõ'}</span>{slip.submittedAt ? <> · gửi <b className="text-foreground">{timeOf(slip.submittedAt)}</b></> : ''}</span>
      <Badge className={status.cls}>{status.label}</Badge>
      {slip.issues && <Badge className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle size={12} aria-hidden />Có sự cố</Badge>}
      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span><span className={NUM}>{count}</span> hạng mục · <span className={NUM}>{num(slipPeople(slip))}</span> người</span>
        {photos.length > 0 && <button type="button" onClick={() => onOpenPhotos(photos, 0)} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-semibold text-teal-700 hover:bg-muted dark:text-teal-300">
          <Camera size={12} aria-hidden />{slip.photoCount} ảnh chung</button>}
      </span>
      {slip.issues && <span className="basis-full text-xs text-amber-800 dark:text-amber-200">Sự cố: {slip.issues}</span>}
      {slip.status === 'returned' && slip.returnReason && <span className="basis-full text-xs text-amber-800 dark:text-amber-200">Lý do trả: {slip.returnReason}</span>}
    </span>;
  };
  const missing = board.missingFronts.map(front => <div key={`missing-${front.areaCode}`} className="flex flex-wrap items-center gap-2 border-t border-dashed border-amber-300 bg-amber-50/40 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/20">
    <HardHat size={15} className="text-amber-700" aria-hidden /><span className="font-semibold">{frontName(front)}</span>
    {front.authorName && <span className="text-xs text-muted-foreground">KS <span className={ENT}>{front.authorName}</span></span>}
    <Badge className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Chưa gửi phiếu</Badge>
    <span className="text-xs text-muted-foreground">Lần gần nhất {formatShortDate(front.lastDate)}</span>
  </div>);
  return <>
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:block">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <tr><th className="px-3 py-2">Làm gì</th><th className="w-28 px-3 py-2">Hôm nay</th><th className="w-48 px-3 py-2">Lũy kế</th>
            <th className="w-36 px-3 py-2">Bao giờ xong</th><th className="w-60 px-3 py-2">Ai làm · nguồn lực</th><th className="w-40 px-3 py-2">Ảnh</th></tr>
        </thead>
        {groups.map(({ slip, items }) => <tbody key={slip.id} className="border-t border-border">
          <tr className="bg-mint-50/60 dark:bg-mint-950/20"><td colSpan={6} className="px-3 py-2">{head(slip, items.length)}</td></tr>
          {items.map((item, index) => {
            const late = lateDays(item, board.date) != null;
            return <tr key={`${item.taskId || item.wbsCode}-${index}`} className="border-t border-border/70 align-top hover:bg-muted/30">
              <td className="px-3 py-2.5"><span className="text-xs font-semibold text-muted-foreground">{item.wbsCode}</span> <span className="font-semibold text-foreground">{item.taskName}</span><Notes note={item.note} /></td>
              <td className="px-3 py-2.5"><TodayQty item={item} /></td>
              <td className="px-3 py-2.5"><Cumulative item={item} late={late} /></td>
              <td className="px-3 py-2.5"><Finish item={item} date={board.date} /></td>
              <td className="px-3 py-2.5"><Resources item={item} /></td>
              <td className="px-3 py-2.5"><Thumbs photos={toPhotos(item.photos, item.taskName || 'Ảnh')} onOpen={onOpenPhotos} /></td>
            </tr>;
          })}
          {!items.length && <tr><td colSpan={6} className="px-3 py-2.5 text-sm text-muted-foreground">Chưa chọn hạng mục.</td></tr>}
        </tbody>)}
      </table>
      {!onlyLate && missing}
    </div>
    <div className="space-y-3 md:hidden">
      {groups.map(({ slip, items }) => <section key={slip.id} className="overflow-hidden rounded-2xl border border-border bg-card">
        <header className="bg-mint-50/60 px-3 py-2 dark:bg-mint-950/20">{head(slip, items.length)}</header>
        {items.map((item, index) => <article key={`${item.taskId || item.wbsCode}-${index}`} className="space-y-2 border-t border-border px-3 py-2.5">
          <div><span className="text-xs font-semibold text-muted-foreground">{item.wbsCode}</span> <span className="font-semibold">{item.taskName}</span><Notes note={item.note} /></div>
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-2 text-xs">
            <div><span className="block text-muted-foreground">Hôm nay</span><TodayQty item={item} /></div>
            <div className="col-span-2"><span className="block text-muted-foreground">Lũy kế</span><Cumulative item={item} late={lateDays(item, board.date) != null} /></div>
          </div>
          <div className="flex items-start justify-between gap-2"><Finish item={item} date={board.date} /><Thumbs photos={toPhotos(item.photos, item.taskName || 'Ảnh')} onOpen={onOpenPhotos} /></div>
          <Resources item={item} />
        </article>)}
      </section>)}
      {!onlyLate && board.missingFronts.length > 0 && <div className="overflow-hidden rounded-2xl border border-border bg-card">{missing}</div>}
    </div>
  </>;
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
    const photos = [...toPhotos(slip.photos, 'Ảnh chung'), ...slip.items.flatMap(item => toPhotos(item.photos, `${item.wbsCode || ''} ${item.taskName || ''}`.trim()))];
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

export function DailyLogTodayBoard(props: Props) {
  const today = localDateKey(new Date());
  const [date, setDate] = useState(today);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [tab, setTab] = useState<Tab>('front');
  const [onlyLate, setOnlyLate] = useState(false);

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
    const sent = board.slips.filter(isSentSlip);
    const items = sent.flatMap(slip => slip.items);
    const { crews, machines } = resourceTotals(board);
    return {
      attention: buildAttention(board),
      stage: boardStage(board),
      fronts: reportedFronts(board),
      task: buildMyTask(board, { userId: props.userId, canSubmit: props.canSubmit, canSummarize: props.canSummarize, canApprove: props.canApprove }),
      sent, items, crews, machines,
      people: sent.reduce((sum, slip) => sum + Number(slip.people || 0), 0),
      laborHours: sent.reduce((sum, slip) => sum + Number(slip.laborHours || 0), 0),
      machineCount: sent.reduce((sum, slip) => sum + Number(slip.machineCount || 0), 0),
      machineHours: sent.reduce((sum, slip) => sum + Number(slip.machineHours || 0), 0),
      slipsWithLabor: sent.filter(slip => Number(slip.people || 0) > 0).length,
      late: items.filter(item => lateDays(item, board.date) != null).length,
      noForecast: items.filter(item => needsNewForecast(item, board.date)).length,
      withQuantity: items.filter(item => Number(item.dailyQuantity || 0) > 0).length,
      photos: sent.reduce((sum, slip) => sum + Number(slip.photoCount || 0) + slip.items.reduce((total, item) => total + Number(item.attachmentCount || 0), 0), 0),
      itemsWithPhotos: items.filter(item => Number(item.attachmentCount || 0) > 0).length,
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => setDate(shiftDate(date, -1))} aria-label="Ngày trước" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><ChevronLeft size={18} /></button>
          <h3 className="text-lg font-bold text-foreground first-letter:uppercase">{date === today ? 'Hôm nay, ' : ''}<span className="text-mint-700 dark:text-mint-300">{dayLabel}</span></h3>
          <button type="button" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= today} aria-label="Ngày sau" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"><ChevronRight size={18} /></button>
          {date !== today && <button type="button" onClick={() => setDate(today)} className="ml-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted">Về hôm nay</button>}
          {board?.summary?.weather && <Badge className="ml-1 border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{WEATHER_LABELS[board.summary.weather] || board.summary.weather}</Badge>}
        </div>
      </div>

      {loading && !board && <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" aria-hidden />Đang tải báo cáo ngày…</div>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{error}</span>
          <button type="button" onClick={() => setRetry(value => value + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 font-medium dark:border-rose-800"><RefreshCw size={14} aria-hidden />Thử lại</button>
        </div>
      )}

      {board && derived && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-mint-200 bg-mint-50 px-4 py-3 dark:border-mint-900 dark:bg-mint-950/30">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{derived.task.title}</p>
              <p className="text-sm text-muted-foreground">{derived.task.detail}</p>
            </div>
            {derived.task.action && <button type="button" onClick={runTask} className="inline-flex items-center gap-1.5 rounded-lg bg-leaf-600 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-600">{derived.task.actionLabel}</button>}
          </div>

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

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Kpi icon={Users} tone="bg-mint-100 text-mint-700 dark:bg-mint-950 dark:text-mint-300" label="Nhân công" active={tab === 'crew'} onClick={() => setTab('crew')}
              value={derived.people ? <><span className="text-mint-700 dark:text-mint-300">{num(derived.people)}</span> <span className="text-sm font-semibold text-muted-foreground">người</span></> : <span className="text-amber-700 dark:text-amber-300">Chưa ghi</span>}
              hint={derived.people ? <><span className="tabular-nums">{num(derived.laborHours)}</span> giờ công · {derived.crews.length} tổ đội</> : derived.sent.length ? `0/${derived.sent.length} phiếu ghi nhân công` : 'Chưa có phiếu gửi'} />
            <Kpi icon={Truck} tone="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" label="Máy thi công" onClick={() => setTab('crew')}
              value={derived.machineCount ? <><span className="text-sky-700 dark:text-sky-300">{num(derived.machineCount)}</span> <span className="text-sm font-semibold text-muted-foreground">máy</span></> : <span className="text-muted-foreground">—</span>}
              hint={derived.machineCount ? <><span className="tabular-nums">{num(derived.machineHours)}</span> giờ máy</> : 'Không phiếu nào ghi máy'} />
            <Kpi icon={HardHat} tone="bg-leaf-100 text-leaf-700 dark:bg-leaf-950 dark:text-leaf-300" label="Hạng mục làm" active={tab === 'front' && !onlyLate} onClick={() => { setTab('front'); setOnlyLate(false); }}
              value={<span className="text-leaf-700 dark:text-leaf-300">{derived.items.length}</span>} hint={<>{derived.fronts.sent} mũi · {derived.withQuantity} có khối lượng hôm nay</>} />
            <Kpi icon={Clock} tone="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" label="Trễ kế hoạch" active={tab === 'front' && onlyLate} onClick={() => { setTab('front'); setOnlyLate(true); }}
              value={<span className={derived.late ? 'overdue-blink text-rose-700 dark:text-rose-300' : 'text-leaf-700 dark:text-leaf-300'}>{derived.late}</span>}
              hint={derived.noForecast ? <span className="text-amber-700 dark:text-amber-300">{derived.noForecast} hạng mục chưa có ngày dự kiến mới</span> : 'so với ngày kết thúc kế hoạch'} />
            <Kpi wide icon={Camera} tone="bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300" label="Ảnh hiện trường" active={tab === 'photo'} onClick={() => setTab('photo')}
              value={<span className="text-teal-700 dark:text-teal-300">{derived.photos}</span>} hint={`${derived.itemsWithPhotos}/${derived.items.length} hạng mục có ảnh riêng`} />
          </div>

          {(derived.attention.length > 0 || (derived.sent.length > 0 && !derived.people)) && (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <h4 className="flex items-center gap-1.5 font-bold"><AlertTriangle size={16} aria-hidden />Cần chú ý</h4>
              <ul className="mt-1.5 space-y-1">
                {derived.sent.length > 0 && !derived.people && <li>Chưa phiếu nào ghi <b>nhân công</b> — chưa trả lời được "ai làm" trong ngày.</li>}
                {(showAllAttention ? derived.attention : derived.attention.slice(0, 4)).map(item => <li key={item.key} className="flex items-start gap-1.5">
                  {item.tone === 'danger' ? <Clock size={14} className="mt-0.5 shrink-0 text-rose-600" aria-hidden /> : <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />}
                  <span className="min-w-0 break-words">{item.text}</span></li>)}
              </ul>
              {derived.attention.length > 4 && <button type="button" onClick={() => setShowAllAttention(value => !value)} className="mt-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300">{showAllAttention ? 'Thu gọn' : `Xem thêm ${derived.attention.length - 4} mục`}</button>}
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
            <div role="tablist" aria-label="Cách xem báo cáo" className="flex flex-wrap gap-1">
              {([['front', 'Theo mũi thi công', HardHat], ['crew', 'Theo tổ đội & máy', Users], ['photo', `Ảnh hiện trường (${derived.photos})`, ImageIcon]] as const).map(([key, label, Icon]) =>
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                  className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${tab === key ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                  <Icon size={15} aria-hidden />{label}</button>)}
            </div>
            {tab === 'front' && <label className="flex items-center gap-1.5 pb-1 text-sm"><input type="checkbox" checked={onlyLate} onChange={event => setOnlyLate(event.target.checked)} className="h-4 w-4 accent-teal-700" />Chỉ hạng mục trễ</label>}
          </div>

          {tab === 'front' && <FrontTable board={board} onlyLate={onlyLate} onOpenPhotos={props.onOpenPhotos} />}
          {tab === 'crew' && <CrewView board={board} />}
          {tab === 'photo' && <PhotoView board={board} onOpenPhotos={props.onOpenPhotos} />}

          <div>
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
          </div>
        </div>
      )}
    </section>
  );
}
