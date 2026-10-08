import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { loadXlsx } from '../../../lib/loadXlsx';
import { parseTableMatrix } from '../../../lib/excelTableImport';
import {
  PO_IMPORT_ALIASES, PO_IMPORT_COLUMNS, mergeImportedLines, pickCatalogMatch, readPoImportRows, searchQueriesFor, toImportedLine,
  type CatalogMatch, type ImportedPoLine, type PoImportRow,
} from '../../../lib/procurementExcelImport';
import { procurementInboxService, type ProcurementCatalogItem } from '../../../lib/procurementInboxService';
import { fmt } from '../../project/work-plan/workPlanUi';
import { Badge, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';

const SKIP = '__skip__';
const CONCURRENCY = 4;

interface ReviewRow { row: PoImportRow; match: CatalogMatch; choice: string }

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
  onImport: (lines: ImportedPoLine[]) => void;
}> = ({ projectId, disabled, existingItemIds, templateRows, onImport }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'read' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ fileName: string; rows: ReviewRow[]; catalog: Map<string, ProcurementCatalogItem> } | null>(null);

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
      setReview({ fileName: file.name, rows: results, catalog });
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
    </span>
    {error && <p role="alert" className="w-full text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</p>}

    {review && counts && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Xem trước vật tư nhập từ Excel">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
        <header className="flex items-start gap-3 border-b border-border px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-700 text-white"><FileSpreadsheet size={18} /></span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-foreground">Nhập vật tư vào đơn</p>
            <p className="truncate text-xs text-muted-foreground" title={review.fileName}>{review.fileName} · {review.rows.length} dòng</p>
          </div>
          <button type="button" onClick={() => setReview(null)} aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>
        </header>

        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5 text-xs">
          <Badge className={CONFIDENCE_BADGE.sku.cls}><Check size={12} />{counts.sure} khớp chắc chắn</Badge>
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
                <p className="pl-7 text-xs text-muted-foreground">
                  {[r.row.sku && `Mã ${r.row.sku}`, r.row.spec, r.row.qty != null && `SL ${fmt(r.row.qty, 3)} ${r.row.unit}`.trim(), r.row.price != null && `${money(r.row.price)} đ`].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="min-w-0 space-y-1 pl-7 md:pl-0">
                <select value={r.choice} onChange={e => choose(i, e.target.value)} aria-label={`Vật tư cho dòng ${r.row.index}`} className={`w-full ${inputCls} ${r.choice === SKIP ? '' : status === 'suggested' ? 'border-amber-400' : ''}`}>
                  {options.map(o => <option key={o.id} value={o.id}>{o.name}{o.sku ? ` · ${o.sku}` : ''}{o.unit ? ` (${o.unit})` : ''}{projectId ? (o.inBoq ? ' · trong BOQ' : ' · ngoài BOQ') : ''}</option>)}
                  <option value={SKIP}>— Bỏ dòng này —</option>
                </select>
                {r.choice === SKIP && !options.length && <p className="text-xs text-muted-foreground">Chưa có mã trong danh mục. Đề xuất cấp mã ở Vật tư rồi nhập lại.</p>}
                {line && <p className="text-xs text-muted-foreground">
                  → {line.altUnit ? <>Mua {fmt(line.purchaseQty || 0, 3)} {picked!.purchaseUnit} = </> : null}<b className="tabular-nums text-leaf-700 dark:text-leaf-300">{fmt(line.stockQty, 3)}</b> {picked!.unit}
                  {line.price != null && <> · {money(line.price)} đ/{line.altUnit ? picked!.purchaseUnit : picked!.unit}</>}</p>}
                {line?.warnings.map(w => <p key={w} className="flex gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</p>)}
              </div>
            </li>;
          })}
        </ul>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          {merged.length < chosen.length && <span className="w-full text-xs text-muted-foreground sm:mr-auto sm:w-auto">Gộp {chosen.length - merged.length} dòng trùng vật tư thành một.</span>}
          <button type="button" onClick={() => setReview(null)} className={`${secondaryBtn} flex-1 sm:flex-none`}>Hủy</button>
          <button type="button" disabled={!merged.length} onClick={() => { onImport(merged); setReview(null); }} className={`${primaryBtn} flex-1 sm:flex-none`}>
            <Check size={15} />Đưa {merged.length} vật tư vào đơn</button>
        </footer>
      </div>
    </div>}
  </>;
};

export default PoExcelImport;
