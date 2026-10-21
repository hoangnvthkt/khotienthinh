import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Loader2, Plus, Sparkles, X } from 'lucide-react';
import ItemSelectionModal from './ItemSelectionModal';
import { CaptureCamera } from './wms/CaptureCamera';
import { prepareCapturePhoto } from '../lib/wmsDeliveryCaptureService';
import { InventoryItem } from '../types';
import { aiErrorMessage, aiGateway, type AiRunResult } from '../lib/aiGateway';
import { isMeasureNote, matchLines, parseRequestText, parseViNumber, qtyInUnit, sameUnit, type MatchedLine, type TextLine } from '../lib/materialRequestText';
import { recordSuggestionEvent } from '../lib/uiSuggestionEvents';

// Đề xuất vật tư · Gõ nhanh (lộ trình AI A1, chủ SP 16/10/2026): gõ / dán danh sách → dòng nháp có mã, SL, quy cách, lý do.
// Tách bằng quy tắc ngay khi gõ; câu khó thì "Nhờ AI tách" (skill mr_text_lines). Người dùng xem, đổi mã rồi mới thêm vào phiếu.
// Chụp phiếu viết tay (chủ SP 16/10): camera của Kho (tự cắt khung) → AI đọc ảnh (skill mr_photo_lines, kết nối đọc ảnh) → chữ đọc được
// hiện trong ô gõ để sửa, dòng khớp mã như Gõ nhanh. Ảnh chỉ để đọc, không lưu kèm phiếu.
// Trợ lý (T2b, 18/10): thẻ nháp trong khung chat mở form với các dòng Trợ lý đã tách (`initial`) — khớp mã ở đây như chữ AI đọc ảnh.
// Dòng chưa chắc mã có nút gợi ý mã bấm là chọn (chủ SP 18/10: nhiều phương án thì cho bấm, không bắt gõ / dò lại).

export interface QuickLine { item: InventoryItem; qty: number; specification: string; reason: string; neededDate?: string }
type AiLine = Pick<TextLine, 'name' | 'spec' | 'qty' | 'unit' | 'note'>;
export interface PhotoRead { lines: AiLine[]; purpose: string | null; neededDate: string | null; warnings: string[] }
export interface PhotoImage { mime: string; b64: string }
/** Dòng Trợ lý đã tách sẵn (thẻ nháp đề xuất vật tư). */
export interface QuickLinesInitial { lines: AiLine[]; purpose?: string | null; neededDate?: string | null }
export interface QuickLinesHooks {
  aiStatus: () => Promise<{ text: boolean; photo: boolean }>;
  split: (text: string) => Promise<AiRunResult<{ lines: AiLine[] }>>;
  readPhotos: (images: PhotoImage[]) => Promise<AiRunResult<PhotoRead>>;
  feedback: (runId: string, accepted: boolean) => void;
}
export const defaultQuickLinesHooks: QuickLinesHooks = {
  aiStatus: () => aiGateway.status()
    .then(s => ({ text: s.configured && s.skills.includes('mr_text_lines'), photo: s.configured && s.skills.includes('mr_photo_lines') }))
    .catch(() => ({ text: false, photo: false })),
  split: text => aiGateway.run<{ lines: AiLine[] }>('mr_text_lines', { text }, { screen: 'material_request' }),
  readPhotos: images => aiGateway.run<PhotoRead>('mr_photo_lines', { images }, { screen: 'material_request', pages: images.length }),
  feedback: (runId, accepted) => aiGateway.feedback(runId, accepted),
};

const fileToB64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Không đọc được ảnh.'));
  r.readAsDataURL(f);
});
/** Dòng AI đọc → một dòng chữ trong ô gõ (sửa được; gõ lại thì tách bằng quy tắc như thường). */
const lineText = (l: AiLine) => [l.name, l.spec, l.qty != null ? String(l.qty).replace('.', ',') : null, l.unit].filter(Boolean).join(' ')
  + (!l.note ? '' : isMeasureNote(l.note) ? ` (${l.note})` : ` cho ${l.note}`);
const dmy = (iso: string) => iso.split('-').reverse().join('/');

interface Row { key: string; line: MatchedLine<InventoryItem>; itemId: string | null; qty: string; spec: string; reason: string; include: boolean; showSpec: boolean; showReason: boolean }

const PICK_OTHER = '__pick';
const num = (s: string) => parseViNumber(String(s).trim()) ?? 0;
const qtyText = (q: number | null) => (q == null ? '' : String(q).replace('.', ','));
/** Số để đọc (1.332,42) — khác qtyText là giá trị ô nhập. */
const qtyShow = (q: number | null) => (q == null ? '' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(q));
const inputCls = 'w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-indigo-300';

const toRows = (lines: MatchedLine<InventoryItem>[]): Row[] => lines.map((line, i) => {
  const item = line.pick;
  // Ghi chú chỉ là số đo ("Trọng lượng tạm tính 6300 kg") không phải lý do.
  const reason = line.note && !isMeasureNote(line.note) ? line.note : '';
  return {
    key: `${i}:${line.raw}`, line, itemId: item?.id ?? null,
    // Lệch đơn vị (câu ghi "tấn", mã tính "kg") → lấy số theo đơn vị của mã nếu dòng có ghi, không thì để trống bắt nhập lại.
    qty: item && !sameUnit(line.unit, item.unit) ? qtyText(line.qtyFromText) : qtyText(line.qty),
    spec: line.specGuess || '', reason, include: Boolean(item),
    // Ô quy cách / lý do riêng chỉ mở khi câu có ghi (93% dòng đề xuất thật không ghi quy cách; lý do chung ở ô "Dùng cho").
    showSpec: Boolean(line.specGuess), showReason: Boolean(reason),
  };
});

export const QuickRequestLines: React.FC<{
  items: InventoryItem[];
  /** Mã công trường hay đề xuất — ưu tiên khi khớp ngang điểm. */
  boost?: Set<string>;
  /** Đề xuất của dự án: dòng thêm là "ngoài BOQ", có lý do. */
  withReason: boolean;
  filterWarehouseId?: string;
  allowAllItems?: boolean;
  onAdd: (lines: QuickLine[]) => void;
  onClose: () => void;
  hooks?: QuickLinesHooks;
  initial?: QuickLinesInitial | null;
}> = ({ items, boost, withReason, filterWarehouseId, allowAllItems = true, onAdd, onClose, hooks = defaultQuickLinesHooks, initial = null }) => {
  const catalog = useMemo(() => items.filter(i => i.status !== 'retired' && !i.mergedIntoId), [items]);
  const byId = useMemo(() => new Map(catalog.map(i => [i.id, i])), [catalog]);
  const [text, setText] = useState('');
  const [reasonAll, setReasonAll] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [ai, setAi] = useState<{ available: boolean; state: 'idle' | 'pending' | 'error'; message?: string; runId?: string }>({ available: false, state: 'idle' });
  const [picker, setPicker] = useState<{ key: string; query: string } | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const [camera, setCamera] = useState(false);
  const [photo, setPhoto] = useState<{ urls: string[]; state: 'reading' | 'done' | 'error'; message?: string; warnings?: string[]; runId?: string } | null>(null);
  const [neededDate, setNeededDate] = useState<string | null>(null);
  // Chữ AI vừa đổ vào ô gõ: không tách lại bằng quy tắc (giữ dòng AI đọc) cho tới khi người dùng sửa.
  const aiTextRef = useRef<string | null>(null);
  const readToken = useRef(0);
  const [fromAssistant, setFromAssistant] = useState(false);
  const initialApplied = useRef(false);

  useEffect(() => {
    let alive = true;
    hooks.aiStatus().then(v => { if (alive) { setAi(a => ({ ...a, available: v.text })); setPhotoReady(v.photo); } });
    return () => { alive = false; };
  }, [hooks]);
  // Tách bằng quy tắc khi gõ (trễ 250 ms); gõ lại sau khi AI tách / đọc ảnh thì quay về quy tắc.
  useEffect(() => {
    if (aiTextRef.current !== null && text === aiTextRef.current) return;
    aiTextRef.current = null;
    const t = window.setTimeout(() => { setRows(toRows(matchLines(parseRequestText(text), catalog, { boost }))); setAi(a => ({ ...a, runId: undefined, state: a.state === 'pending' ? a.state : 'idle' })); }, 250);
    return () => window.clearTimeout(t);
  }, [text, catalog, boost]);
  useEffect(() => () => { photo?.urls.forEach(u => URL.revokeObjectURL(u)); }, [photo?.urls]);
  // Dòng Trợ lý tách: đổ vào ô gõ + khớp mã một lần khi danh mục đã có (danh mục tải sau thì đợi). Đặt SAU hiệu ứng tách khi gõ
  // để lượt đầu không xóa dấu "chữ AI" (aiTextRef).
  useEffect(() => {
    if (initialApplied.current || !initial?.lines.length || !catalog.length) return;
    initialApplied.current = true;
    const transcript = initial.lines.map(lineText).join('\n');
    aiTextRef.current = transcript;
    setText(transcript);
    setRows(toRows(matchLines(initial.lines.map(l => ({ ...l, raw: [l.name, l.spec].filter(Boolean).join(' ') })), catalog, { boost })));
    if (initial.purpose) setReasonAll(v => v || initial.purpose || '');
    if (initial.neededDate) setNeededDate(initial.neededDate);
    setFromAssistant(true);
  }, [initial, catalog, boost]);

  const readPhotos = async (files: File[]) => {
    setCamera(false);
    const images = files.filter(f => f.type.startsWith('image/'));
    if (!images.length) { setPhoto({ urls: [], state: 'error', message: files.length ? 'Chỉ đọc được ảnh (JPG, PNG) — chụp lại phiếu.' : 'Chưa chụp ảnh nào.' }); return; }
    const token = ++readToken.current;
    const prepared = await Promise.all(images.slice(0, 4).map(f => prepareCapturePhoto(f).catch(() => f)));
    setPhoto({ urls: prepared.map(f => URL.createObjectURL(f)), state: 'reading' });
    const r = await Promise.all(prepared.map(async f => ({ mime: f.type || 'image/jpeg', b64: await fileToB64(f) })))
      .then(imgs => hooks.readPhotos(imgs))
      .catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    if (token !== readToken.current) return; // đã hủy / chụp lại
    if (r.code === 'OK' && r.result.lines.length) {
      const transcript = r.result.lines.map(lineText).join('\n');
      aiTextRef.current = transcript;
      setText(transcript);
      setRows(toRows(matchLines(r.result.lines.map(l => ({ ...l, raw: [l.name, l.spec].filter(Boolean).join(' ') })), catalog, { boost })));
      if (r.result.purpose) setReasonAll(v => v || r.result.purpose || '');
      setNeededDate(r.result.neededDate);
      setPhoto(p => p && { ...p, state: 'done', warnings: r.result.warnings, runId: r.runId });
    } else {
      setPhoto(p => p && { ...p, state: 'error', message: r.code === 'OK' ? 'AI không thấy dòng vật tư nào trên ảnh — chụp rõ hơn hoặc gõ tay.' : `${aiErrorMessage(r)} Chụp lại hoặc gõ tay.` });
    }
  };
  const clearPhoto = () => { readToken.current += 1; setPhoto(null); };

  const update = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const choose = (row: Row, item: InventoryItem) => update(row.key, {
    itemId: item.id, include: true,
    qty: sameUnit(row.line.unit, item.unit) ? (row.qty || qtyText(row.line.qty)) : qtyText(qtyInUnit(row.line, item.unit)),
  });

  const runAi = async () => {
    if (!text.trim()) return;
    setAi(a => ({ ...a, state: 'pending', message: undefined }));
    const r = await hooks.split(text).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    if (r.code === 'OK' && r.result.lines.length) {
      const lines: TextLine[] = r.result.lines.map(l => ({ ...l, raw: [l.name, l.spec].filter(Boolean).join(' ') }));
      setRows(toRows(matchLines(lines, catalog, { boost })));
      setAi(a => ({ ...a, state: 'idle', runId: r.runId }));
    } else {
      setAi(a => ({ ...a, state: 'error', message: r.code === 'OK' ? 'AI không tách được dòng nào — giữ cách tách thường.' : `${aiErrorMessage(r)} Giữ cách tách thường.` }));
    }
  };

  const ready = rows.filter(r => r.include && r.itemId && num(r.qty) > 0);
  const matched = rows.filter(r => r.itemId).length;
  const needPick = rows.filter(r => !r.itemId && r.line.candidates.length).length;
  const unknown = rows.filter(r => !r.itemId && !r.line.candidates.length).length;
  // Gợi ý nhờ AI khi quy tắc chưa chắc; AI tách rồi thì thôi nhắc.
  const fromAiText = aiTextRef.current !== null && text === aiTextRef.current; // dòng đang là kết quả AI đọc ảnh
  const shaky = !ai.runId && !fromAiText && (rows.some(r => r.line.unsure) || unknown > 0);

  const add = () => {
    const out: QuickLine[] = ready.map(r => ({ item: byId.get(r.itemId!)!, qty: num(r.qty), specification: r.spec.trim(), reason: (r.reason || reasonAll).trim(), ...(neededDate ? { neededDate } : {}) }));
    if (!out.length) return;
    const untouched = ready.every(r => r.itemId === r.line.pick?.id);
    const fromPhoto = photo?.state === 'done' && fromAiText;
    recordSuggestionEvent({ screen: 'material_request', field: fromAssistant && fromAiText ? 'assistant_lines' : fromPhoto ? 'photo_lines' : ai.runId ? 'text_lines_ai' : 'text_lines', outcome: untouched && out.length === rows.length ? 'accepted' : 'edited', suggested: rows.length, accepted: out.length });
    if (ai.runId) hooks.feedback(ai.runId, true);
    if (fromPhoto && photo?.runId) hooks.feedback(photo.runId, true);
    onAdd(out);
  };

  return <section aria-label="Gõ nhanh danh sách vật tư" data-testid="quick-lines" className="mt-3 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h3 className="text-sm font-bold text-foreground">Gõ nhanh</h3>
      {rows.length > 0 && <span className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto">{rows.length} dòng · {matched} đã khớp mã{needPick ? ` · ${needPick} chọn mã` : ''}{unknown ? ` · ${unknown} chưa có mã` : ''}</span>}
      <span className="ml-auto flex items-center gap-1">
        {photoReady && <button type="button" onClick={() => setCamera(true)} disabled={photo?.state === 'reading'} title="Chụp phiếu đề xuất viết tay, AI đọc thành dòng"
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-card px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-800 dark:text-indigo-300">
          <Camera size={14} />Chụp phiếu</button>}
        <button type="button" onClick={onClose} aria-label="Đóng gõ nhanh" className="rounded-md p-1 text-muted-foreground hover:bg-card"><X size={15} /></button>
      </span>
    </header>
    {photo && <div data-testid="quick-photo" aria-live="polite" className={`space-y-1.5 rounded-lg border bg-card p-2 text-xs ${photo.state === 'error' ? 'border-amber-300' : 'border-border'}`}>
      <div className="flex items-center gap-2">
        {photo.urls.map((u, i) => <img key={u} src={u} alt={`Ảnh phiếu ${i + 1}`} className="h-12 w-9 shrink-0 rounded-md border border-border object-cover" />)}
        {photo.state === 'reading' && <p className="flex min-w-0 flex-1 items-center gap-1.5 font-semibold text-foreground"><Loader2 size={13} className="shrink-0 animate-spin text-indigo-600" />AI đang đọc phiếu… (khoảng 20 giây)</p>}
        {photo.state === 'done' && <p className="flex min-w-0 flex-1 items-center gap-1.5 font-semibold text-foreground"><Sparkles size={13} className="shrink-0 text-indigo-600" />AI đã đọc {photo.urls.length > 1 ? `${photo.urls.length} ảnh` : 'ảnh'} — kiểm từng dòng trước khi thêm</p>}
        {photo.state === 'error' && <p className="flex min-w-0 flex-1 items-center gap-1.5 text-amber-800 dark:text-amber-200"><AlertTriangle size={13} className="shrink-0" />{photo.message}</p>}
      </div>
      {photo.warnings?.length ? <ul className="list-disc space-y-0.5 pl-4 text-amber-800 dark:text-amber-200">{photo.warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {neededDate && <span className="text-muted-foreground">Ngày cần trên phiếu <b className="text-foreground">{dmy(neededDate)}</b>
          <button type="button" onClick={() => setNeededDate(null)} className="ml-1 font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Bỏ</button></span>}
        <span className="ml-auto flex gap-1">
          {photo.state !== 'reading' && <button type="button" onClick={() => setCamera(true)} className="rounded-md px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300">Chụp lại</button>}
          <button type="button" onClick={clearPhoto} className="rounded-md px-2 py-1 font-semibold text-muted-foreground hover:bg-muted">{photo.state === 'reading' ? 'Hủy' : 'Bỏ ảnh'}</button>
        </span>
      </div>
    </div>}
    {fromAssistant && fromAiText && <div data-testid="quick-assistant" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card p-2 text-xs">
      <p className="flex min-w-0 basis-full items-center gap-1.5 font-semibold text-foreground sm:basis-auto sm:flex-1"><Sparkles size={13} className="shrink-0 text-indigo-600" />Trợ lý đã tách {rows.length} dòng · kiểm mã, số lượng rồi thêm</p>
      {neededDate && <span className="text-muted-foreground">Ngày cần <b className="text-foreground">{dmy(neededDate)}</b>
        <button type="button" onClick={() => setNeededDate(null)} className="ml-1 font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Bỏ</button></span>}
    </div>}
    <textarea value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus={!initial} aria-label="Danh sách vật tư"
      placeholder="VD: ống PVC 110 C1 20 cây, cút PVC 110 15 cái, keo dán ống 2 hộp cho thoát nước mưa xưởng 1"
      className={`${inputCls} resize-y`} />
    {withReason && <input value={reasonAll} onChange={e => setReasonAll(e.target.value)} aria-label="Dùng cho" placeholder="Dùng cho (điền các dòng chưa có lý do)" className={inputCls} />}

    {ai.available && text.trim() && !fromAiText && <div className={`flex flex-wrap items-center gap-2 text-xs ${shaky ? 'rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100' : 'text-muted-foreground'}`}>
      {shaky && <span className="flex items-center gap-1"><AlertTriangle size={13} />Câu khó tách</span>}
      {ai.state === 'error' && <span>{ai.message}</span>}
      {ai.runId && ai.state === 'idle' && <span className="flex items-center gap-1"><Sparkles size={12} />AI đã tách</span>}
      <button type="button" onClick={() => void runAi()} disabled={ai.state === 'pending'}
        className="ml-auto inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-card px-2.5 py-1 font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-800 dark:text-indigo-300">
        {ai.state === 'pending' ? <><Loader2 size={12} className="animate-spin" />AI đang tách…</> : <><Sparkles size={12} />Nhờ AI tách</>}
      </button>
    </div>}

    {rows.length > 0 && <ul className="space-y-2">
      {rows.map(row => {
        const item = row.itemId ? byId.get(row.itemId) : undefined;
        const unitClash = item && row.line.unit && !sameUnit(row.line.unit, item.unit);
        const options = [...row.line.candidates.map(c => c.item), ...(item && !row.line.candidates.some(c => c.item.id === item.id) ? [item] : [])];
        const status = item ? (row.line.unsure ? 'Chưa chắc' : 'Đã khớp') : row.line.candidates.length ? 'Chọn mã' : 'Chưa có mã';
        return <li key={row.key} className={`rounded-lg border bg-card p-2 ${row.include && item ? 'border-border' : 'border-dashed border-border opacity-90'}`}>
          <div className="flex items-start gap-2">
            <input type="checkbox" checked={row.include && Boolean(item)} disabled={!item} onChange={e => update(row.key, { include: e.target.checked })}
              aria-label={`Thêm dòng ${row.line.name}`} className="mt-1.5 h-4 w-4 shrink-0 accent-indigo-600" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${status === 'Đã khớp' ? 'bg-leaf-50 text-leaf-800 dark:bg-leaf-950/40 dark:text-leaf-200' : status === 'Chưa có mã' ? 'bg-muted text-muted-foreground' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
                  {status === 'Đã khớp' && <CheckCircle2 size={11} className="mr-0.5 inline" />}{status}</span>
                <span className="truncate">“{row.line.name}{row.line.qty != null ? ` · ${qtyShow(row.line.qty)} ${row.line.unit || ''}` : ''}”</span>
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-1.5 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <select value={row.itemId || ''} aria-label="Mã vật tư" className={inputCls}
                  onChange={e => {
                    if (e.target.value === PICK_OTHER) setPicker({ key: row.key, query: row.line.name });
                    else if (e.target.value) choose(row, byId.get(e.target.value)!);
                  }}>
                  {!item && <option value="">{row.line.candidates.length ? 'Chọn mã…' : 'Chưa có mã — chọn'}</option>}
                  {options.map(o => <option key={o.id} value={o.id}>{o.name} · {o.unit}{o.sku ? ` · ${o.sku}` : ''}</option>)}
                  <option value={PICK_OTHER}>Chọn mã khác…</option>
                </select>
                <label className="relative block">
                  <input value={row.qty} inputMode="decimal" onChange={e => update(row.key, { qty: e.target.value })} aria-label="Số lượng"
                    placeholder={unitClash ? `SL ${item?.unit}` : 'SL'} className={`${inputCls} pr-11 ${unitClash && !row.qty ? 'border-amber-400' : ''}`} />
                  <span className="pointer-events-none absolute right-2 top-1/2 max-w-[2.6rem] -translate-y-1/2 truncate text-xs text-muted-foreground">{item?.unit || row.line.unit || ''}</span>
                </label>
              </div>
              {!item && row.line.candidates.length > 0 && <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Gợi ý mã cho ${row.line.name}`}>
                <span className="text-xs text-muted-foreground">Gợi ý:</span>
                {row.line.candidates.slice(0, 3).map(c => <button key={c.item.id} type="button" onClick={() => choose(row, c.item)}
                  className="max-w-full truncate rounded-full border border-indigo-200 bg-card px-2 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300">
                  {c.item.name} · {c.item.unit}</button>)}
              </div>}
              {(row.showSpec || (withReason && row.showReason)) && <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {row.showSpec && <input value={row.spec} onChange={e => update(row.key, { spec: e.target.value })} aria-label="Quy cách" placeholder="Quy cách" className={inputCls} />}
                {withReason && row.showReason && <input value={row.reason} onChange={e => update(row.key, { reason: e.target.value })} aria-label="Lý do" placeholder={reasonAll || 'Lý do'} className={inputCls} />}
              </div>}
              {(!row.showSpec || (withReason && !row.showReason)) && <p className="flex gap-3 text-xs">
                {!row.showSpec && <button type="button" onClick={() => update(row.key, { showSpec: true })} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">+ Quy cách</button>}
                {withReason && !row.showReason && <button type="button" onClick={() => update(row.key, { showReason: true })} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">+ Lý do riêng</button>}
              </p>}
              {unitClash && (() => {
                const fromText = qtyInUnit(row.line, item?.unit);
                return <p className="flex items-center gap-1 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle size={12} className="shrink-0" />
                  {fromText != null
                    ? `Phiếu ghi ${qtyShow(row.line.qty)} ${row.line.unit} và ${qtyShow(fromText)} ${item?.unit} — mã tính theo ${item?.unit}, đã lấy ${qtyShow(fromText)}. Kiểm lại.`
                    : `Câu ghi ${qtyShow(row.line.qty)} ${row.line.unit} — mã tính theo ${item?.unit}, nhập lại số lượng.`}</p>;
              })()}
              {row.line.note && isMeasureNote(row.line.note) && !unitClash && <p className="text-xs text-muted-foreground">Phiếu ghi: {row.line.note}</p>}
            </div>
          </div>
        </li>;
      })}
    </ul>}

    <div className="flex items-center justify-end gap-2">
      {rows.length > 0 && ready.length < rows.length && <span className="mr-auto text-xs text-muted-foreground">{rows.length - ready.length} dòng chưa đủ mã / số lượng sẽ không thêm</span>}
      <button type="button" disabled={!ready.length} onClick={add}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-500/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
        <Plus size={14} />Thêm {ready.length || ''} dòng</button>
    </div>

    {camera && <CaptureCamera title="Chụp phiếu đề xuất" onClose={() => setCamera(false)} onDone={files => { void readPhotos(files); }} />}
    <ItemSelectionModal isOpen={Boolean(picker)} onClose={() => setPicker(null)} onOpenScanner={() => undefined}
      onSelect={it => { const row = rows.find(r => r.key === picker?.key); if (row) choose(row, it); setPicker(null); }}
      items={catalog} allowAllItems={allowAllItems} filterWarehouseId={filterWarehouseId} showStockQuantities={false} initialQuery={picker?.query} />
  </section>;
};
