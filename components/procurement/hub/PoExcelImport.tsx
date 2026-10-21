import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Download, FileSpreadsheet, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { loadXlsx } from '../../../lib/loadXlsx';
import { parseTableMatrix } from '../../../lib/excelTableImport';
import {
  PO_IMPORT_ALIASES, PO_IMPORT_COLUMNS, mergeImportedLines, pickCatalogMatch, readPoImportRows, searchQueriesFor, toImportedLine,
  type CatalogMatch, type ImportedPoLine, type PoImportRow,
} from '../../../lib/procurementExcelImport';
import { procurementInboxService, type ProcurementCatalogItem } from '../../../lib/procurementInboxService';
import { fmt } from '../../project/work-plan/workPlanUi';
import { aiErrorMessage, aiGateway, type AiRunResult } from '../../../lib/aiGateway';
import { quoteChecks, quoteRows, type QuoteMeta, type QuoteRead } from '../../../lib/procurementQuoteRead';
import { prepareCapturePhoto } from '../../../lib/wmsDeliveryCaptureService';
import { recordSuggestionEvent } from '../../../lib/uiSuggestionEvents';
import { CaptureCamera } from '../../wms/CaptureCamera';
import { Badge, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';

const SKIP = '__skip__';
// index.css trên điện thoại cắt chữ `.grid > div .text-xs` thành một dòng (nowrap + …) — dòng xem trước cần xuống dòng đủ.
const WRAP = '!whitespace-normal !overflow-visible';
const CONCURRENCY = 4;

interface ReviewRow { row: PoImportRow; match: CatalogMatch; choice: string }
/** Báo giá AI đọc: thông tin đầu + kiểm số + cảnh báo, hiện ở đầu màn xem trước. */
interface QuoteInfo { read: QuoteRead; runId: string }

export interface QuoteHooks {
  available: () => Promise<boolean>;
  read: (input: { text: string; images: Array<{ mime: string; b64: string }> }) => Promise<AiRunResult<QuoteRead>>;
  feedback: (runId: string, accepted: boolean) => void;
}
export const defaultQuoteHooks: QuoteHooks = {
  available: () => aiGateway.status().then(st => st.configured && st.skills.includes('po_quote_lines')).catch(() => false),
  read: input => aiGateway.run<QuoteRead>('po_quote_lines', input, { screen: 'purchase_order', pages: input.images.length }),
  feedback: (runId, accepted) => aiGateway.feedback(runId, accepted),
};
const fileToB64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Không đọc được ảnh.'));
  r.readAsDataURL(f);
});

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string }> = {
  sku: { label: 'Khớp mã', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200' },
  name: { label: 'Khớp tên', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200' },
  suggested: { label: 'Gợi ý — kiểm tra', cls: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200' },
  none: { label: 'Chưa có trong danh mục', cls: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200' },
};

/** Tải mẫu / Nhập Excel cho danh sách vật tư của đơn: khớp danh mục, cho chọn lại, rồi mới đưa vào đơn. */
export const PoExcelImport: React.FC<{
  projectId: string | null;
  disabled?: boolean;
  existingItemIds: string[];
  /** Dòng đang có trong đơn để xuất kèm file mẫu: [mã, tên, quy cách, ĐVT, SL, đơn giá]. */
  templateRows: Array<Array<string | number>>;
  /** meta: NCC / VAT đọc từ báo giá (chỉ khi nhập bằng Chụp / dán báo giá). */
  onImport: (lines: ImportedPoLine[], meta?: QuoteMeta) => void;
  quoteHooks?: QuoteHooks;
}> = ({ projectId, disabled, existingItemIds, templateRows, onImport, quoteHooks = defaultQuoteHooks }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'read' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ fileName: string; rows: ReviewRow[]; catalog: Map<string, ProcurementCatalogItem>; quote?: QuoteInfo } | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [quote, setQuote] = useState<{ text: string; files: File[]; urls: string[]; state: 'idle' | 'reading'; error?: string } | null>(null);
  const [camera, setCamera] = useState(false);
  useEffect(() => { let alive = true; quoteHooks.available().then(v => { if (alive) setAiReady(v); }); return () => { alive = false; }; }, [quoteHooks]);
  useEffect(() => () => { quote?.urls.forEach(u => URL.revokeObjectURL(u)); }, [quote?.urls]);

  const downloadTemplate = async () => {
    setBusy('export'); setError('');
    try {
      const XLSX = await loadXlsx();
      const sheet = XLSX.utils.aoa_to_sheet([PO_IMPORT_COLUMNS, ...templateRows]);
      sheet['!cols'] = [16, 36, 22, 10, 12, 14].map(wch => ({ wch }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Vat tu');
      XLSX.writeFile(book, 'Mau_vat_tu_don_hang.xlsx');
    } catch (err) {
      console.error('PO template export failed:', err);
      setError('Chưa tạo được file mẫu. Vui lòng thử lại.');
    } finally { setBusy(null); }
  };

  /** Dòng (từ Excel hoặc báo giá AI đọc) → khớp danh mục → màn xem trước. */
  const matchRows = async (rows: PoImportRow[], fileName: string, quoteInfo?: QuoteInfo) => {
    // Nguồn ứng viên: vật tư trong BOQ dự án, rồi tìm thêm trên danh mục cho dòng chưa khớp.
    const catalog = new Map<string, ProcurementCatalogItem>();
    const cache = new Map<string, ProcurementCatalogItem[]>();
    const search = async (query: string) => {
      if (!cache.has(query)) cache.set(query, await procurementInboxService.searchItems(projectId, query).catch(() => []));
      const found = cache.get(query)!; found.forEach(item => catalog.set(item.id, item)); return found;
    };
    const pool = projectId ? await search('') : [];
    const results: ReviewRow[] = new Array(rows.length);
    let done = 0; setProgress({ done, total: rows.length });
    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const i = next++; const row = rows[i];
        let candidates = [...pool];
        let match = pickCatalogMatch(row, candidates);
        if (match.confidence !== 'sku' && match.confidence !== 'name') {
          for (const query of searchQueriesFor(row)) {
            const found = await search(query);
            if (!found.length) continue;
            candidates = [...candidates, ...found];
            match = pickCatalogMatch(row, candidates);
            break;
          }
        }
        results[i] = { row, match, choice: match.item?.id || (match.options[0] && match.confidence ? match.options[0].id : SKIP) };
        done += 1; setProgress({ done, total: rows.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    setReview({ fileName, rows: results, catalog, quote: quoteInfo });
  };

  const readQuote = async () => {
    if (!quote) return;
    const images = quote.files.filter(f => f.type.startsWith('image/'));
    if (!images.length && quote.text.trim().length < 10) { setQuote({ ...quote, error: 'Dán chữ báo giá hoặc chụp ảnh trước.' }); return; }
    setQuote({ ...quote, state: 'reading', error: undefined });
    try {
      const prepared = await Promise.all(images.slice(0, 4).map(f => prepareCapturePhoto(f).catch(() => f)));
      const payload = { text: quote.text.trim(), images: await Promise.all(prepared.map(async f => ({ mime: f.type || 'image/jpeg', b64: await fileToB64(f) }))) };
      const r = await quoteHooks.read(payload).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
      if (r.code !== 'OK') { setQuote(q => q && { ...q, state: 'idle', error: `${aiErrorMessage(r)} Thử lại hoặc nhập từ Excel.` }); return; }
      const rows = quoteRows(r.result);
      if (!rows.length) { setQuote(q => q && { ...q, state: 'idle', error: 'AI không thấy dòng hàng nào — chụp rõ hơn hoặc dán chữ.' }); return; }
      setBusy('read');
      await matchRows(rows, r.result.vendorName ? `Báo giá ${r.result.vendorName}` : 'Báo giá (AI đọc)', { read: r.result, runId: r.runId });
      setQuote(null);
    } catch (err) {
      console.error('PO quote read failed:', err);
      setQuote(q => q && { ...q, state: 'idle', error: 'Chưa đọc được báo giá. Thử lại.' });
    } finally { setBusy(null); setProgress(null); }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('read'); setError(''); setProgress(null);
    try {
      const XLSX = await loadXlsx();
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: true });
      const parsed = parseTableMatrix(matrix, PO_IMPORT_COLUMNS, PO_IMPORT_ALIASES);
      const rows = readPoImportRows(parsed);
      if (parsed.byPosition || (!parsed.sourceHeaders[0] && !parsed.sourceHeaders[1])) {
        setError(`Không thấy cột "Tên vật tư" hoặc "Mã vật tư" trong "${file.name}". Hãy tải file mẫu và điền theo đúng cột.`); return;
      }
      if (rows.length === 0) { setError(`Không tìm thấy dòng vật tư nào trong "${file.name}".`); return; }

      await matchRows(rows, file.name);
    } catch (err) {
      console.error('PO Excel import failed:', err);
      setError(`Không đọc được "${file.name}". Chỉ nhận file Excel (.xlsx, .xls) hoặc .csv.`);
    } finally { setBusy(null); setProgress(null); }
  };

  // Esc chỉ đóng màn xem trước, không lan tới ngăn đơn hàng phía sau (mất đơn đang soạn).
  useEffect(() => {
    if (!review) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setReview(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [review]);

  // Esc đóng hộp Đọc báo giá (không lan tới ngăn đơn hàng); đang mở camera thì để camera tự xử lý.
  useEffect(() => {
    if (!quote || camera) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); if (quote.state !== 'reading') setQuote(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [quote, camera]);

  const choose = (index: number, choice: string) =>
    setReview(cur => cur && { ...cur, rows: cur.rows.map((r, i) => (i === index ? { ...r, choice } : r)) });

  const chosen = review ? review.rows.filter(r => r.choice !== SKIP && review.catalog.has(r.choice)) : [];
  const merged = review ? mergeImportedLines(chosen.map(r => toImportedLine(r.row, review.catalog.get(r.choice)!))) : [];
  const counts = review ? {
    sure: review.rows.filter(r => r.match.confidence === 'sku' || r.match.confidence === 'name').length,
    suggested: review.rows.filter(r => r.match.confidence === 'suggested').length,
    none: review.rows.filter(r => !r.match.confidence).length,
    updating: merged.filter(l => existingItemIds.includes(l.item.id)).length,
  } : null;

  return <>
    <span className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => void downloadTemplate()} disabled={busy !== null} className={`${secondaryBtn} bg-card py-1.5`}
        title={templateRows.length ? 'Tải danh sách vật tư đang có ra Excel để sửa rồi nhập lại' : 'Tải file Excel có sẵn cột để điền'}>
        {busy === 'export' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Tải mẫu Excel</button>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled || busy !== null} className={`${secondaryBtn} bg-card py-1.5`}
        title={disabled ? 'Chọn dự án / kho nhận trước' : 'Nhập danh sách vật tư, SL, đơn giá từ file Excel (báo giá NCC, bảng kê…)'}>
        {busy === 'read' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {busy === 'read' ? (progress ? `Đang dò danh mục ${progress.done}/${progress.total}…` : 'Đang đọc file…') : 'Nhập từ Excel'}</button>
      <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv" onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ''; }} />
      {aiReady && <button type="button" onClick={() => setQuote({ text: '', files: [], urls: [], state: 'idle' })} disabled={disabled || busy !== null} className={`${secondaryBtn} bg-card py-1.5`}
        title={disabled ? 'Chọn dự án / kho nhận trước' : 'Chụp ảnh hoặc dán chữ báo giá NCC — AI đọc thành dòng đơn (SL, đơn giá, VAT)'}>
        <Camera size={14} />Chụp / dán báo giá</button>}
    </span>
    {error && <p role="alert" className="w-full text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</p>}

    {quote && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Đọc báo giá">
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-700 text-white"><Sparkles size={18} /></span>
          <p className="min-w-0 flex-1 font-bold text-foreground">Đọc báo giá</p>
          <button type="button" onClick={() => setQuote(null)} disabled={quote.state === 'reading'} aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>
        </header>
        <div className="space-y-3 overflow-y-auto px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {quote.urls.map((u, i) => <img key={u} src={u} alt={`Ảnh báo giá ${i + 1}`} className="h-16 w-12 rounded-md border border-border object-cover" />)}
            <button type="button" onClick={() => setCamera(true)} disabled={quote.state === 'reading'} className={`${secondaryBtn} bg-card py-1.5`}>
              <Camera size={14} />{quote.files.length ? 'Chụp thêm' : 'Chụp / chọn ảnh'}</button>
          </div>
          <textarea value={quote.text} onChange={e => setQuote({ ...quote, text: e.target.value })} rows={5} disabled={quote.state === 'reading'} aria-label="Chữ báo giá"
            placeholder="Hoặc dán chữ báo giá / tin nhắn NCC — VD: Thép D16 CB500 10.192 kg × 14.750 đ" className={`w-full resize-y ${inputCls}`} />
          {quote.error && <p role="alert" className="flex gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{quote.error}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          {quote.state === 'reading' && <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin text-teal-600" />
            {progress ? `Đang dò danh mục ${progress.done}/${progress.total}…` : 'AI đang đọc… (khoảng 20 giây)'}</span>}
          <button type="button" onClick={() => setQuote(null)} disabled={quote.state === 'reading'} className={`${secondaryBtn} flex-1 sm:flex-none`}>Hủy</button>
          <button type="button" onClick={() => void readQuote()} disabled={quote.state === 'reading' || (!quote.files.length && quote.text.trim().length < 10)} className={`${primaryBtn} flex-1 sm:flex-none`}
            title={!quote.files.length && quote.text.trim().length < 10 ? 'Chụp ảnh hoặc dán chữ báo giá trước' : undefined}>
            {quote.state === 'reading' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}Đọc báo giá</button>
        </footer>
      </div>
    </div>}
    {camera && <CaptureCamera title="Chụp báo giá" onClose={() => setCamera(false)} onDone={files => {
      setCamera(false);
      const imgs = files.filter(f => f.type.startsWith('image/'));
      setQuote(q => q && { ...q, files: [...q.files, ...imgs].slice(0, 4), urls: [...q.urls, ...imgs.map(f => URL.createObjectURL(f))].slice(0, 4),
        error: files.length && !imgs.length ? 'Chỉ đọc được ảnh (JPG, PNG). Tệp PDF / Excel dùng "Nhập từ Excel".' : undefined });
    }} />}

    {review && counts && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={review.quote ? 'Xem trước vật tư từ báo giá' : 'Xem trước vật tư nhập từ Excel'}>
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
        <header className="flex items-start gap-3 border-b border-border px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-700 text-white"><FileSpreadsheet size={18} /></span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-foreground">Nhập vật tư vào đơn</p>
            <p className="truncate text-xs text-muted-foreground" title={review.fileName}>{review.fileName} · {review.rows.length} dòng</p>
          </div>
          <button type="button" onClick={() => setReview(null)} aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>
        </header>

        {review.quote && <div data-testid="quote-info" className="space-y-1 border-b border-border bg-teal-50/40 px-4 py-2.5 text-xs dark:bg-teal-950/20">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground">
            <span className="flex items-center gap-1 font-semibold"><Sparkles size={12} className="text-teal-600" />AI đọc báo giá</span>
            <span>NCC: {review.quote.read.vendorName ? <b>{review.quote.read.vendorName}{review.quote.read.vendorTaxCode ? ` · MST ${review.quote.read.vendorTaxCode}` : ''}</b> : <span className="text-muted-foreground">không ghi rõ — chọn ở ô NCC của đơn</span>}</span>
            {review.quote.read.vatRate != null && <span>VAT <b>{review.quote.read.vatRate}%</b></span>}
          </p>
          {quoteChecks(review.quote.read).map(c => <p key={c.text} className={`flex gap-1 ${c.level === 'warn' ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}`}>
            {c.level === 'warn' ? <AlertTriangle size={12} className="mt-0.5 shrink-0" /> : <Check size={12} className="mt-0.5 shrink-0 text-leaf-600" />}{c.text}</p>)}
          {review.quote.read.warnings.length > 0 && <details className="text-muted-foreground"><summary className="cursor-pointer font-semibold text-amber-800 dark:text-amber-200">{review.quote.read.warnings.length} lưu ý của AI</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{review.quote.read.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
        </div>}
        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5 text-xs">
          {counts.sure > 0 && <Badge className={CONFIDENCE_BADGE.sku.cls}><Check size={12} />{counts.sure} khớp chắc chắn</Badge>}
          {counts.suggested > 0 && <Badge className={CONFIDENCE_BADGE.suggested.cls}>{counts.suggested} gợi ý theo tên — kiểm tra</Badge>}
          {counts.none > 0 && <Badge className={CONFIDENCE_BADGE.none.cls}>{counts.none} chưa có trong danh mục</Badge>}
          {counts.updating > 0 && <Badge className="border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200">{counts.updating} vật tư đã có trong đơn — sẽ cập nhật SL & giá</Badge>}
        </div>

        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {review.rows.map((r, i) => {
            const status = r.match.confidence || 'none';
            const picked = review.catalog.get(r.choice);
            const line = picked ? toImportedLine(r.row, picked) : null;
            const options = Array.from(new Map([...(r.match.item ? [r.match.item] : []), ...r.match.options].map(o => [o.id, o])).values());
            return <li key={r.row.index} className={`grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start ${r.choice === SKIP ? 'opacity-60' : ''}`}>
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="w-6 text-xs font-bold tabular-nums text-muted-foreground">{r.row.index}</span>
                  <span className="font-medium text-foreground">{r.row.name || r.row.sku}</span>
                  <Badge className={CONFIDENCE_BADGE[status].cls}>{CONFIDENCE_BADGE[status].label}</Badge>
                </p>
                <p className={`pl-7 text-xs text-muted-foreground ${WRAP}`}>
                  {[r.row.sku && `Mã ${r.row.sku}`, r.row.spec, r.row.qty != null && `SL ${fmt(r.row.qty, 3)} ${r.row.unit}`.trim(), r.row.note, r.row.price != null && `${money(r.row.price)} đ`].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="min-w-0 space-y-1 pl-7 md:pl-0">
                <select value={r.choice} onChange={e => choose(i, e.target.value)} aria-label={`Vật tư cho dòng ${r.row.index}`} className={`w-full ${inputCls} ${r.choice === SKIP ? '' : status === 'suggested' ? 'border-amber-400' : ''}`}>
                  {options.map(o => <option key={o.id} value={o.id}>{o.name}{o.sku ? ` · ${o.sku}` : ''}{o.unit ? ` (${o.unit})` : ''}{projectId ? (o.inBoq ? ' · trong BOQ' : ' · ngoài BOQ') : ''}</option>)}
                  <option value={SKIP}>— Bỏ dòng này —</option>
                </select>
                {r.choice === SKIP && !options.length && <p className="text-xs text-muted-foreground">Chưa có mã trong danh mục. Đề xuất cấp mã ở Vật tư rồi nhập lại.</p>}
                {line && <p className={`text-xs text-muted-foreground ${WRAP}`}>
                  → {line.altUnit ? <>Mua {fmt(line.purchaseQty || 0, 3)} {picked!.purchaseUnit} = </> : null}<b className="tabular-nums text-leaf-700 dark:text-leaf-300">{fmt(line.stockQty, 3)}</b> {picked!.unit}
                  {line.price != null && <> · {money(line.price)} đ/{line.altUnit ? picked!.purchaseUnit : picked!.unit}</>}</p>}
                {line?.warnings.map(w => <p key={w} className={`flex gap-1 text-xs text-amber-700 dark:text-amber-300 ${WRAP}`}><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span className="min-w-0">{w}</span></p>)}
              </div>
            </li>;
          })}
        </ul>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          {merged.length < chosen.length && <span className="w-full text-xs text-muted-foreground sm:mr-auto sm:w-auto">Gộp {chosen.length - merged.length} dòng trùng vật tư thành một.</span>}
          <button type="button" onClick={() => setReview(null)} className={`${secondaryBtn} flex-1 sm:flex-none`}>Hủy</button>
          <button type="button" disabled={!merged.length} onClick={() => {
            const q = review.quote;
            if (q) {
              recordSuggestionEvent({ screen: 'purchase_order', field: 'quote_ai', outcome: merged.length === review.rows.length ? 'accepted' : 'edited', suggested: review.rows.length, accepted: merged.length });
              quoteHooks.feedback(q.runId, true);
            }
            onImport(merged, q ? { vendorName: q.read.vendorName, vendorTaxCode: q.read.vendorTaxCode, vatRate: q.read.vatRate, runId: q.runId } : undefined);
            setReview(null);
          }} className={`${primaryBtn} flex-1 sm:flex-none`}>
            <Check size={15} />Đưa {merged.length} vật tư vào đơn</button>
        </footer>
      </div>
    </div>}
  </>;
};

export default PoExcelImport;
