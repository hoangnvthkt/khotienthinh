import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Camera, CheckCircle2, FileText, ImagePlus, Images, Loader2, Plus, RefreshCw, Sparkles, Truck, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useReasonConfirm } from '../../context/ConfirmContext';
import { Badge, StateBox, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM } from '../finance/financeUi';
import { formatQuantityInput, parseQuantityInput, sanitizeQuantityInput } from '../../lib/quantityInput';
import { foldVi, type StockOverview } from '../../lib/wmsCatalogService';
import {
  captureErrorMessage, initialMapping, wmsDeliveryCaptureService as svc,
  type CaptureLine, type CapturePhoto, type CaptureSuggestion, type DeliveryCapture,
} from '../../lib/wmsDeliveryCaptureService';
import { GREY, Panel, Section, TEAL, WARN, dateVi, fmtQty } from './wmsUi';
import { CaptureCamera } from './CaptureCamera';
import { CaptureSupplier } from './CaptureSupplier';

// Kho Đợt 1 — Phiếu giao chụp: ảnh → AI điền (hoặc nhập tay) → chọn đơn mua → Nhận hàng (mỗi xe một phiếu nhập).
// Chỉ tiêu đề + số liệu (chủ SP 10/10). Ô vàng = AI đọc chưa chắc.

type Wh = StockOverview['warehouses'][number];
type EditLine = { name: string; unit: string; qty: string; low: boolean; note: string | null };
type Form = { supplierName: string; docNo: string; docDate: string; truckNo: string; lines: EditLine[] };
type Ai = 'idle' | 'reading' | 'done' | 'off' | 'failed';
export const CAPTURE_ACCEPT = 'image/*,application/pdf';

const toForm = (c: DeliveryCapture): Form => ({
  supplierName: c.supplierName || '', docNo: c.docNo || '', docDate: c.docDate || '', truckNo: c.truckNo || '',
  lines: c.lines.map(l => ({ name: l.name || '', unit: l.unit || '', qty: formatQuantityInput(l.qty), low: l.confidence === 'low', note: l.note || null })),
});
const toLines = (f: Form): CaptureLine[] => f.lines.filter(l => l.name.trim()).map(l => {
  const n = parseQuantityInput(l.qty);
  return { name: l.name.trim(), unit: l.unit.trim() || null, qty: Number.isFinite(n) ? n : null, note: l.note, confidence: l.low ? 'low' : 'high' };
});
const blankLine = (): EditLine => ({ name: '', unit: '', qty: '', low: false, note: null });
const sameUnit = (a?: string | null, b?: string | null) => !a || !b || foldVi(a).replace(/\s/g, '') === foldVi(b).replace(/\s/g, '');

const Photo: React.FC<{ p: CapturePhoto; onRemove?: () => void; onSplit?: () => void }> = ({ p, onRemove, onSplit }) => {
  const [url, setUrl] = useState<string | null>(null);
  const isImg = p.mimeType.startsWith('image/');
  useEffect(() => { let live = true; if (isImg) svc.photoUrl(p.path).then(u => { if (live) setUrl(u); }).catch(() => undefined); return () => { live = false; }; }, [p.path, isImg]);
  const open = async () => {
    const w = window.open('about:blank', '_blank');
    try { const u = url || await svc.photoUrl(p.path); if (w) { w.opener = null; w.location.href = u; } else window.location.assign(u); }
    catch { w?.close(); }
  };
  return <div className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
    <button type="button" onClick={() => void open()} className="block h-full w-full" aria-label={`Xem ${p.name}`}>
      {isImg ? url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Loader2 size={16} className="m-auto mt-9 animate-spin text-muted-foreground" />
        : <FileText size={22} className="m-auto mt-8 text-teal-700" />}</button>
    {onRemove && <button type="button" onClick={onRemove} aria-label="Bỏ ảnh" className="absolute right-0.5 top-0.5 grid h-7 w-7 !min-h-0 !min-w-0 place-items-center rounded-full bg-black/55 text-white"><X size={13} /></button>}
    {onSplit && <button type="button" onClick={onSplit} title="Ảnh này là phiếu khác: tách thành phiếu riêng" className="absolute inset-x-0 bottom-0 !min-h-0 bg-black/55 py-1 text-[11px] font-semibold text-white">Tách</button>}
  </div>;
};

export const KhoCapture: React.FC<{
  initial?: DeliveryCapture; files?: File[]; warehouseId: string; warehouses: Wh[];
  onBack: () => void; onSaved: (c: DeliveryCapture) => void; onOpenTx: (transactionId: string) => void;
}> = ({ initial, files, warehouseId, warehouses, onBack, onSaved, onOpenTx }) => {
  const toast = useToast();
  const askReason = useReasonConfirm();
  const operable = warehouses.filter(w => w.canOperate);
  const [whId, setWhId] = useState(initial?.warehouseId || (operable.some(w => w.id === warehouseId) ? warehouseId : operable.length === 1 ? operable[0].id : ''));
  const [cap, setCap] = useState<DeliveryCapture | null>(initial || null);
  const [stage, setStage] = useState<'pickWh' | 'uploading' | 'ready' | 'error'>(initial ? 'ready' : 'uploading');
  const [err, setErr] = useState('');
  const [ai, setAi] = useState<Ai>(initial?.ai ? 'done' : 'idle');
  const [aiErr, setAiErr] = useState('');
  const [form, setForm] = useState<Form>(() => initial ? toForm(initial) : { supplierName: '', docNo: '', docDate: '', truckNo: '', lines: [] });
  const [dirty, setDirty] = useState(false);
  const [sugs, setSugs] = useState<CaptureSuggestion[] | null>(null);
  const [sugBusy, setSugBusy] = useState(false);
  const [poId, setPoId] = useState('');
  const [map, setMap] = useState<string[]>([]);
  const [busy, setBusy] = useState<'' | 'save' | 'receive' | 'photo'>('');
  const started = useRef(false);
  const addRef = useRef<HTMLInputElement>(null);
  const whName = warehouses.find(w => w.id === whId)?.name;
  const locked = cap?.status === 'received' || cap?.status === 'discarded';

  const accept = useCallback((c: DeliveryCapture) => { setCap(c); onSaved(c); }, [onSaved]);

  const pickSuggestion = useCallback((c: DeliveryCapture, list: CaptureSuggestion[], keep?: string) => {
    const s = list.find(x => x.purchaseOrderId === keep) || (list[0] && list[0].score >= 0.45 && list[0].lines.some(l => l.poLineId) ? list[0] : undefined);
    setPoId(s?.purchaseOrderId || '');
    setMap(s ? initialMapping(c, s).map(m => m.poLineId) : c.lines.map(() => ''));
  }, []);

  const loadSugs = useCallback(async (c: DeliveryCapture, keep?: string) => {
    if (!c.lines.length && !c.supplierName) { setSugs([]); return; }
    setSugBusy(true);
    try { const list = await svc.suggest(c.id); setSugs(list); pickSuggestion(c, list, keep); }
    catch (e) { setSugs([]); toast.error('Chưa tìm được đơn khớp', captureErrorMessage(e)); }
    finally { setSugBusy(false); }
  }, [pickSuggestion, toast]);

  const read = useCallback(async (c: DeliveryCapture) => {
    if (!c.photos.length) return;
    setAi('reading'); setAiErr('');
    const r = await svc.read(c);
    if (r.code === 'OK') {
      accept(r.capture);
      // Ô người dùng đã gõ trong lúc AI đọc được giữ nguyên.
      setForm(prev => {
        const next = toForm(r.capture);
        return { supplierName: prev.supplierName || next.supplierName, docNo: prev.docNo || next.docNo, docDate: prev.docDate || next.docDate,
          truckNo: prev.truckNo || next.truckNo, lines: prev.lines.some(l => l.name.trim()) ? prev.lines : next.lines };
      });
      setAi('done');
      void loadSugs(r.capture);
    } else if (r.code === 'AI_NOT_CONFIGURED') {
      setAi('off');
      setForm(f => f.lines.length ? f : { ...f, lines: [blankLine()] });
    } else { setAi('failed'); setAiErr(r.error); setForm(f => f.lines.length ? f : { ...f, lines: [blankLine()] }); }
  }, [accept, loadSugs]);

  const start = useCallback(async (wh: string, list: File[]) => {
    setStage('uploading');
    try {
      let c = await svc.create(wh);
      c = await svc.addPhotos(c, list);
      accept(c); setForm(toForm(c)); setStage('ready');
      void read(c);
    } catch (e) { setErr(captureErrorMessage(e)); setStage('error'); }
  }, [accept, read]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initial) {
      if (initial.status === 'new' && initial.photos.length && !initial.ai) void read(initial);
      else { void loadSugs(initial, initial.purchaseOrderId || undefined); if (!initial.lines.length && !locked) setForm(f => ({ ...f, lines: [blankLine()] })); }
      return;
    }
    if (!files?.length) { setStage('error'); setErr('Chưa có ảnh phiếu giao.'); return; }
    if (!whId) { setStage('pickWh'); return; }
    void start(whId, files);
  }, [initial, files, whId, start, read, loadSugs, locked]);

  const edit = (patch: Partial<Form>) => { setForm(f => ({ ...f, ...patch })); setDirty(true); };
  const editLine = (i: number, patch: Partial<EditLine>) => { setForm(f => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, ...patch, low: false } : l) })); setDirty(true); };
  const addLine = () => { setForm(f => ({ ...f, lines: [...f.lines, blankLine()] })); setMap(m => [...m, '']); setDirty(true); };
  const removeLine = (i: number) => { setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) })); setMap(m => m.filter((_, j) => j !== i)); setDirty(true); };

  const save = async (silent = false): Promise<DeliveryCapture | null> => {
    if (!cap) return null;
    setBusy('save');
    try {
      // Dòng chưa có tên không lưu: bỏ luôn khỏi gán đơn để chỉ số dòng khớp phiếu đã lưu.
      const keep = form.lines.map(l => !!l.name.trim());
      const c = await svc.save(cap.id, { supplierName: form.supplierName, docNo: form.docNo, docDate: form.docDate, truckNo: form.truckNo, lines: toLines(form) });
      accept(c); setDirty(false);
      setForm(f => ({ ...f, lines: f.lines.filter((_, i) => keep[i]) }));
      setMap(m => m.filter((_, i) => keep[i]));
      if (!silent) { toast.success('Đã lưu phiếu giao', c.status === 'received' ? undefined : 'Nhận sau ở Việc cần làm.'); void loadSugs(c, poId); }
      return c;
    } catch (e) { toast.error('Chưa lưu được', captureErrorMessage(e)); return null; }
    finally { setBusy(''); }
  };

  // Chọn NCC (hoặc đánh dấu NCC mới): lưu ngay kèm tên đang gõ để hệ thống học, rồi tìm lại đơn theo NCC.
  const pickSupplier = async (patch: { supplierId: string | null; supplierMatch?: 'new'; supplierTaxCode?: string | null; supplierAddress?: string | null }) => {
    if (!cap) return;
    try {
      const c = await svc.save(cap.id, { supplierName: form.supplierName, ...patch });
      accept(c);
      if (patch.supplierId !== undefined && !('supplierTaxCode' in patch) && !('supplierAddress' in patch)) void loadSugs(c, poId);
    } catch (e) { toast.error('Chưa lưu được NCC', captureErrorMessage(e)); }
  };
  const findOrders = async () => { const c = dirty ? await save(true) : cap; if (c) await loadSugs(c, poId); };

  const addPhotos = async (list: FileList | null) => {
    if (!cap || !list?.length) return;
    setBusy('photo');
    try { const c = await svc.addPhotos(cap, Array.from(list)); accept(c); if (ai === 'off' || ai === 'failed' || (ai === 'idle' && !form.lines.some(l => l.name.trim()))) void read(c); }
    catch (e) { toast.error('Chưa tải được ảnh', captureErrorMessage(e)); }
    finally { setBusy(''); if (addRef.current) addRef.current.value = ''; }
  };
  // Ảnh bị gộp nhầm (khác phiếu): tách thành phiếu riêng, AI đọc phiếu mới ở nền.
  const splitPhoto = async (p: CapturePhoto) => {
    if (!cap) return;
    setBusy('photo');
    try {
      const { current, created } = await svc.split(cap, p.path);
      accept(current); onSaved(created);
      toast.success('Đã tách thành phiếu riêng', 'Xem lại hàng trên phiếu này.');
      void svc.read(created).then(r => { if (r.code === 'OK') onSaved(r.capture); });
    } catch (e) { toast.error('Chưa tách được', captureErrorMessage(e)); }
    finally { setBusy(''); }
  };
  const removePhoto = async (p: CapturePhoto) => {
    if (!cap) return;
    try { accept(await svc.removePhoto(cap, p.path)); } catch (e) { toast.error('Chưa bỏ được ảnh', captureErrorMessage(e)); }
  };

  const sug = sugs?.find(s => s.purchaseOrderId === poId);
  const poLine = (id: string) => sug?.poLines.find(l => l.poLineId === id);
  // Nhiều dòng phiếu cùng một dòng đơn: so tổng với phần đơn còn lại.
  const sumBy = new Map<string, { qty: number; n: number }>();
  form.lines.forEach((l, i) => {
    const q = parseQuantityInput(l.qty);
    if (!map[i] || !l.name.trim() || !Number.isFinite(q) || q <= 0) return;
    const cur = sumBy.get(map[i]) || { qty: 0, n: 0 };
    sumBy.set(map[i], { qty: cur.qty + q, n: cur.n + 1 });
  });
  // Mua nóng nhận cả phiếu theo số đã duyệt: không gán / so từng dòng.
  const rows = form.lines.map((l, i) => {
    const pl = sug?.kind === 'hot' ? undefined : poLine(map[i] || '');
    const qty = parseQuantityInput(l.qty);
    const sum = pl ? sumBy.get(pl.poLineId) : undefined;
    return { pl, qty, sum, over: !!pl && !!sum && sum.qty > pl.remaining + 0.0005, unitDiff: !!pl && !sameUnit(l.unit, pl.unit) };
  });
  const toReceive = rows.filter((r, i) => r.pl && Number.isFinite(r.qty) && r.qty > 0 && form.lines[i].name.trim());
  const isHot = sug?.kind === 'hot';
  const blocker = !sug ? 'Chọn đơn mua' : isHot ? (sug.approved ? '' : 'Mua nóng vượt số duyệt — chờ CHT xác nhận')
    : !sug.approved ? 'Đơn chờ duyệt — Mua hàng duyệt xong mới nhận được'
    : toReceive.length === 0 ? 'Gán dòng đơn cho hàng trên phiếu' : rows.some(r => r.over) ? 'Số nhận vượt phần đơn còn lại' : '';

  const receive = async () => {
    if (!cap || !sug || blocker) return;
    // Chỉ số dòng theo phiếu đã lưu (dòng chưa có tên không lưu) — tính trước khi lưu.
    const lines = form.lines.map((l, i) => ({ l, poLineId: map[i] || '' })).filter(x => x.l.name.trim()).flatMap((x, captureIndex) => {
      const q = parseQuantityInput(x.l.qty);
      return x.poLineId && Number.isFinite(q) && q > 0 ? [{ captureIndex, poLineId: x.poLineId, qty: q }] : [];
    });
    const c = dirty ? await save(true) : cap;
    if (!c) return;
    setBusy('receive');
    // Mua nóng: nhận cả phiếu theo số đã duyệt (luật M2c), không gán từng dòng.
    if (isHot) {
      try {
        const done = await svc.receiveHot(c.id, sug.purchaseOrderId);
        accept(done);
        toast.success(`Đã nhận Mua nóng ${sug.poNumber}`, done.wmsTransactionId ? 'Phiếu nhập kho đã ghi sổ.' : 'Phiếu chỉ có CCDC — đã vào sổ CCDC.');
        if (done.wmsTransactionId) onOpenTx(done.wmsTransactionId);
      } catch (e) { toast.error('Chưa nhận được Mua nóng', captureErrorMessage(e)); }
      finally { setBusy(''); }
      return;
    }
    try {
      const done = await svc.receive({ captureId: c.id, purchaseOrderId: sug.purchaseOrderId, lines });
      accept(done);
      toast.success(`Đã nhập kho${done.code ? ` ${done.code}` : ''}`, `${sug.poNumber} · đợt giao ${done.deliveryNo ?? ''}`.trim());
      if (done.wmsTransactionId) onOpenTx(done.wmsTransactionId);
    } catch (e) { toast.error('Chưa nhận được hàng', captureErrorMessage(e)); }
    finally { setBusy(''); }
  };

  const discard = async () => {
    if (!cap) return;
    const reason = await askReason({ title: 'Bỏ phiếu giao', targetName: [form.supplierName, form.docNo].filter(Boolean).join(' · ') || 'Phiếu giao chụp',
      reasonLabel: 'Lý do', reasonPlaceholder: 'VD: chụp trùng, NCC chở hàng về', actionLabel: 'Bỏ phiếu', intent: 'danger' });
    if (!reason) return;
    try { accept(await svc.discard(cap.id, reason)); toast.success('Đã bỏ phiếu giao'); onBack(); }
    catch (e) { toast.error('Chưa bỏ được phiếu', captureErrorMessage(e)); }
  };

  const head = <div>
    {whName && <p className="text-[12px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{whName}</p>}
    <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold"><Truck size={18} />Phiếu giao
      {cap?.status === 'received' && <Badge className={TEAL}>Đã nhận</Badge>}
      {cap?.status === 'discarded' && <Badge className={GREY}>Đã bỏ</Badge>}</h2>
  </div>;

  if (stage === 'pickWh') return <Panel onBack={onBack} head={head}>
    <Section title="Kho nhận"><div className="flex flex-wrap gap-2">{operable.map(w =>
      <button key={w.id} type="button" onClick={() => { setWhId(w.id); if (files?.length) void start(w.id, files); }} className={secondaryBtn}>{w.name}</button>)}</div></Section>
  </Panel>;
  if (stage === 'uploading') return <Panel onBack={onBack} head={head}><StateBox kind="loading" title="Đang tải ảnh phiếu…" /></Panel>;
  if (stage === 'error' || !cap) return <Panel onBack={onBack} head={head}><StateBox kind="error" title="Chưa lưu được phiếu giao" message={err} /></Panel>;

  if (locked) return <Panel onBack={onBack} head={head}
    foot={cap.wmsTransactionId ? <button type="button" onClick={() => onOpenTx(cap.wmsTransactionId!)} className={primaryBtn}>Mở phiếu nhập</button> : undefined}>
    <div className="flex gap-2 overflow-x-auto pb-1">{cap.photos.map(p => <Photo key={p.path} p={p} />)}</div>
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <div><dt className="text-[12px] text-muted-foreground">NCC</dt><dd className={ENT}>{cap.supplierPartnerName || cap.supplierName || '—'}</dd></div>
      <div><dt className="text-[12px] text-muted-foreground">Số phiếu · xe</dt><dd>{[cap.docNo, cap.truckNo].filter(Boolean).join(' · ') || '—'}</dd></div>
      <div><dt className="text-[12px] text-muted-foreground">Ngày giao</dt><dd>{dateVi(cap.docDate)}</dd></div>
      {cap.status === 'received' && <div><dt className="text-[12px] text-muted-foreground">Phiếu nhập</dt><dd className="font-mono font-semibold text-teal-700 dark:text-teal-300">{cap.code || '—'}{cap.poNumber && ` · ${cap.poNumber}`}</dd></div>}
    </dl>
    <ul className="divide-y divide-border rounded-xl border border-border">{cap.lines.map((l, i) =>
      <li key={i} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm"><span className="min-w-0">{l.name}</span>
        <span className="whitespace-nowrap"><b className={NUM}>{l.qty == null ? '—' : fmtQty(l.qty)}</b> <span className="text-[12px] text-muted-foreground">{l.unit}</span></span></li>)}</ul>
  </Panel>;

  const warnings = cap.ai?.result?.warnings || [];
  const lowCount = form.lines.filter(l => l.low).length;
  const field = (label: string, key: 'supplierName' | 'docNo' | 'truckNo', cls = '') =>
    <label className={`block text-[12px] font-semibold text-muted-foreground ${cls}`}>{label}
      <input value={form[key]} onChange={e => edit({ [key]: key === 'truckNo' ? e.target.value.toUpperCase() : e.target.value } as Partial<Form>)} className={`mt-1 w-full ${inputCls}`} /></label>;

  return <Panel onBack={onBack} head={head}
    foot={<>
      <button type="button" onClick={() => void discard()} className="mr-auto text-sm font-semibold text-rose-700 hover:underline dark:text-rose-300">Bỏ phiếu</button>
      <button type="button" onClick={() => void save()} disabled={!!busy} className={secondaryBtn}>{busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : null}Lưu, nhận sau</button>
      <button type="button" onClick={() => void receive()} disabled={!!blocker || !!busy} title={blocker || undefined} className={`${primaryBtn} flex-1 md:flex-none`}>
        {busy === 'receive' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{isHot ? 'Nhận Mua nóng' : 'Nhận hàng'}</button>
    </>}>
    <div className="flex gap-2 overflow-x-auto pb-1">
      {cap.photos.map(p => <Photo key={p.path} p={p} onRemove={cap.photos.length > 1 ? () => void removePhoto(p) : undefined}
        onSplit={cap.photos.length > 1 && !busy ? () => void splitPhoto(p) : undefined} />)}
      <label className="grid h-24 w-[4.5rem] shrink-0 cursor-pointer place-items-center rounded-lg border border-dashed border-teal-400 text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30" aria-label="Thêm ảnh">
        {busy === 'photo' ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={20} />}
        <input ref={addRef} type="file" accept={CAPTURE_ACCEPT} multiple className="sr-only" onChange={e => void addPhotos(e.target.files)} /></label>
    </div>

    {ai === 'reading' && <p className="flex items-center gap-2 rounded-xl bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-200"><Loader2 size={15} className="animate-spin" />AI đang đọc phiếu…</p>}
    {ai === 'off' && <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground" title="Admin gán kết nối AI ở Cài đặt → Kết nối để tự đọc phiếu">Chưa bật AI · nhập tay<button type="button" onClick={() => void read(cap)} className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline dark:text-teal-300"><RefreshCw size={12} />Đọc lại</button></p>}
    {ai === 'failed' && <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" title={aiErr}>
      <AlertTriangle size={15} />AI chưa đọc được{aiErr ? `: ${aiErr}` : ''} · nhập tay<button type="button" onClick={() => void read(cap)} className="ml-auto inline-flex items-center gap-1 font-semibold hover:underline"><RefreshCw size={13} />Đọc lại</button></p>}
    {ai === 'done' && (lowCount > 0 || warnings.length > 0) && <div className={`rounded-xl border px-3 py-2 text-sm ${WARN}`}>
      <p className="flex items-center gap-2 font-semibold"><Sparkles size={14} />AI đã đọc{lowCount > 0 && ` · ${lowCount} ô vàng cần xem lại`}</p>
      {warnings.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">{warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>}</div>}

    <Section title="Nhà cung cấp"><CaptureSupplier capture={cap} name={form.supplierName} onName={v => edit({ supplierName: v })} onPick={pickSupplier} /></Section>
    <div className="grid grid-cols-2 gap-2">
      {field('Số phiếu', 'docNo')}
      <label className="block text-[12px] font-semibold text-muted-foreground">Ngày giao
        <input type="date" value={form.docDate} onChange={e => edit({ docDate: e.target.value })} className={`mt-1 w-full ${inputCls}`} /></label>
      {field('Biển số xe', 'truckNo')}
    </div>

    <Section title="Đơn mua" right={<button type="button" onClick={() => void findOrders()} disabled={sugBusy || !!busy}
      className="inline-flex items-center gap-1 text-[13px] font-semibold text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300"><RefreshCw size={13} className={sugBusy ? 'animate-spin' : ''} />Tìm đơn</button>}>
      {sugs === null || (sugBusy && !sugs.length) ? <p className="text-sm text-muted-foreground">{sugBusy ? 'Đang tìm đơn khớp…' : 'Nhập NCC, hàng rồi bấm Tìm đơn'}</p>
        : sugs.length === 0 ? <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Chưa thấy đơn khớp · lưu phiếu, Mua hàng lập đơn rồi nhận sau</p>
        : <ul className="space-y-1.5">{sugs.map(s => {
          const on = s.purchaseOrderId === poId;
          const hit = s.lines.filter(l => l.poLineId).length;
          return <li key={s.purchaseOrderId}><button type="button" aria-pressed={on} onClick={() => { setPoId(s.purchaseOrderId); setMap(form.lines.map((_, i) => initialMapping(cap, s)[i]?.poLineId || '')); }}
            className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left ${on ? 'border-teal-500 bg-teal-50/60 ring-2 ring-teal-500/20 dark:bg-teal-950/30' : 'border-border hover:border-teal-300'}`}>
            <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-teal-600' : 'border-slate-300'}`}>{on && <span className="h-2 w-2 rounded-full bg-teal-600" />}</span>
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-sm font-semibold text-teal-700 dark:text-teal-300">{s.poNumber}</span>
                <Badge className={s.kind === 'hot' ? WARN : s.kind === 'contract' ? TEAL : GREY} title={s.kind === 'hot' ? 'Mua nóng: nhận cả phiếu theo số đã duyệt' : s.kind === 'contract' ? 'Gọi hàng theo hợp đồng nguyên tắc' : 'Đơn hàng PO'}>
                  {s.kind === 'hot' ? 'Mua nóng' : s.kind === 'contract' ? `HĐ${s.contractCode ? ` ${s.contractCode}` : ' nguyên tắc'}` : 'PO'}</Badge></span>
              <span className="block truncate text-[12px] text-muted-foreground">{s.vendorName}</span></span>
            <span className="text-right text-[12px]">{form.lines.length > 0 && <span className="block">khớp <b className="tabular-nums">{hit}/{s.lines.length || form.lines.length}</b></span>}
              {!s.approved && <Badge className={WARN}>{s.kind === 'hot' ? 'Chờ xác nhận' : 'Chờ duyệt'}</Badge>}</span>
          </button></li>; })}</ul>}
    </Section>

    <Section title={<>Hàng trên phiếu <span className="tabular-nums text-muted-foreground">{form.lines.filter(l => l.name.trim()).length}</span></>}
      right={<button type="button" onClick={addLine} className="inline-flex items-center gap-1 text-[13px] font-semibold text-teal-700 hover:underline dark:text-teal-300"><Plus size={13} />Dòng</button>}>
      <ul className="space-y-2">{form.lines.map((l, i) => {
        const r = rows[i];
        const low = l.low ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30' : '';
        return <li key={i} className="rounded-xl border border-border p-2">
          <div className="flex items-start gap-2">
            <input value={l.name} onChange={e => editLine(i, { name: e.target.value })} placeholder="Tên hàng trên phiếu" aria-label="Tên hàng" className={`min-w-0 flex-1 ${inputCls} ${low}`} />
            <button type="button" onClick={() => removeLine(i)} aria-label="Bỏ dòng" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><X size={15} /></button>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input inputMode="decimal" value={l.qty} onChange={e => editLine(i, { qty: sanitizeQuantityInput(e.target.value, { previousValue: l.qty }) })} placeholder="SL" aria-label="Số lượng"
              className={`w-24 text-right tabular-nums ${inputCls} ${low} ${r.over ? '!border-rose-400' : ''}`} />
            <input value={l.unit} onChange={e => editLine(i, { unit: e.target.value })} placeholder="ĐVT" aria-label="Đơn vị" className={`w-20 ${inputCls}`} />
            {l.note && <span className="min-w-0 truncate text-[12px] text-muted-foreground" title={l.note}>{l.note}</span>}
          </div>
          {sug && !isHot && <div className="mt-1.5">
            <select value={map[i] || ''} onChange={e => setMap(m => { const n = [...m]; n[i] = e.target.value; return n; })} aria-label="Dòng đơn"
              className={`w-full ${inputCls} ${map[i] ? '' : 'text-muted-foreground'}`}>
              <option value="">Không nhận dòng này</option>
              {sug.poLines.map(pl => <option key={pl.poLineId} value={pl.poLineId} disabled={pl.remaining <= 0.0005}>
                {pl.itemName}{pl.specification ? ` · ${pl.specification}` : ''} — còn {fmtQty(pl.remaining)} {pl.unit || ''}</option>)}
            </select>
            {r.pl && <p className="mt-1 text-[12px]">
              {r.over ? <span className="font-semibold text-rose-700 dark:text-rose-300">Vượt · đơn còn {fmtQty(r.pl.remaining)} {r.pl.unit}</span>
                : <span className="text-muted-foreground">đơn còn <b className={NUM}>{fmtQty(r.pl.remaining)}</b> {r.pl.unit}</span>}
              {r.sum && r.sum.n > 1 && <span className="ml-2 text-muted-foreground">gộp {r.sum.n} dòng = <b className={NUM}>{fmtQty(r.sum.qty)}</b></span>}
              {r.unitDiff && <span className="ml-2 font-semibold text-amber-700 dark:text-amber-300">đơn tính theo {r.pl.unit}</span>}</p>}
          </div>}
        </li>; })}
        {form.lines.length === 0 && <li><button type="button" onClick={addLine} className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border py-3 text-sm font-semibold text-teal-700 dark:text-teal-300"><Plus size={14} />Thêm dòng hàng</button></li>}
      </ul>
    </Section>
    {sug && isHot && <Section title={<>Nhận theo Mua nóng <span className="font-mono text-teal-700 dark:text-teal-300">{sug.poNumber}</span></>}>
      <ul className="divide-y divide-border rounded-xl border border-border">{sug.poLines.map(pl =>
        <li key={pl.poLineId} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm"><span className="min-w-0">{pl.itemName}</span>
          <span className="whitespace-nowrap"><b className={NUM}>{fmtQty(pl.remaining)}</b> <span className="text-[12px] text-muted-foreground">{pl.unit}</span></span></li>)}</ul>
      <p className="mt-1 text-[12px] text-muted-foreground">Nhận đúng số đã duyệt của phiếu Mua nóng · thiếu / sai báo Mua hàng sửa phiếu trước</p>
    </Section>}
    {sug && !sug.approved && <p className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${WARN}`}><AlertTriangle size={15} />{isHot ? `${sug.poNumber} vượt số duyệt · chờ CHT xác nhận rồi nhận` : `${sug.poNumber} chờ duyệt · lưu phiếu, nhận khi Mua hàng duyệt`}</p>}
  </Panel>;
};

/** Nút chụp phiếu giao (chủ SP 16/10): chọn Chụp liên tiếp (camera trong app) hoặc Chọn từ album (nhiều ảnh / PDF). */
export const CaptureButton: React.FC<{ onFiles: (files: File[]) => void; className?: string; children?: React.ReactNode }> = ({ onFiles, className, children }) => {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [camera, setCamera] = useState(false);
  const albumRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);
  const option = (icon: React.ReactNode, label: string, hint: string, onClick: () => void) =>
    <button type="button" role="menuitem" onClick={() => { setMenu(null); onClick(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">{icon}</span>
      <span><span className="block font-semibold">{label}</span><span className="block text-[12px] text-muted-foreground">{hint}</span></span></button>;
  return <>
    <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={!!menu} onClick={() => setMenu(m => m ? null : btnRef.current?.getBoundingClientRect() || null)}
      className={className || primaryBtn}>{children || <><Camera size={15} />Chụp phiếu giao</>}</button>
    <input ref={albumRef} type="file" accept={CAPTURE_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden="true"
      onChange={e => { const list = Array.from(e.target.files || []); e.target.value = ''; if (list.length) onFiles(list); }} />
    {menu && createPortal(<div className="fixed inset-0 z-[250]" onClick={() => setMenu(null)}>
      <div className="absolute inset-0 bg-black/30 sm:bg-transparent" />
      <div role="menu" aria-label="Chụp phiếu giao" onClick={e => e.stopPropagation()}
        style={window.innerWidth >= 640 ? { top: menu.bottom + 6, right: Math.max(8, window.innerWidth - menu.right) } : undefined}
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-border bg-card p-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-xl sm:inset-x-auto sm:bottom-auto sm:w-72 sm:rounded-2xl sm:pb-2">
        {option(<Camera size={20} />, 'Chụp phiếu', 'Chụp liền nhiều tờ', () => setCamera(true))}
        {option(<Images size={20} />, 'Chọn từ album', 'Nhiều ảnh hoặc PDF', () => albumRef.current?.click())}
      </div>
    </div>, document.body)}
    {camera && <CaptureCamera onClose={() => setCamera(false)} onDone={files => { setCamera(false); if (files.length) onFiles(files); }} />}
  </>;
};
