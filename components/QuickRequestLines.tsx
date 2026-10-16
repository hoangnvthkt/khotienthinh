import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, X } from 'lucide-react';
import ItemSelectionModal from './ItemSelectionModal';
import { InventoryItem } from '../types';
import { aiErrorMessage, aiGateway, type AiRunResult } from '../lib/aiGateway';
import { matchLines, parseRequestText, parseViNumber, sameUnit, type MatchedLine, type TextLine } from '../lib/materialRequestText';
import { recordSuggestionEvent } from '../lib/uiSuggestionEvents';

// Đề xuất vật tư · Gõ nhanh (lộ trình AI A1, chủ SP 16/10/2026): gõ / dán danh sách → dòng nháp có mã, SL, quy cách, lý do.
// Tách bằng quy tắc ngay khi gõ; câu khó thì "Nhờ AI tách" (skill mr_text_lines). Người dùng xem, đổi mã rồi mới thêm vào phiếu.

export interface QuickLine { item: InventoryItem; qty: number; specification: string; reason: string }
type AiLine = Pick<TextLine, 'name' | 'spec' | 'qty' | 'unit' | 'note'>;
export interface QuickLinesHooks {
  aiAvailable: () => Promise<boolean>;
  split: (text: string) => Promise<AiRunResult<{ lines: AiLine[] }>>;
  feedback: (runId: string, accepted: boolean) => void;
}
export const defaultQuickLinesHooks: QuickLinesHooks = {
  aiAvailable: () => aiGateway.status().then(s => s.configured && s.skills.includes('mr_text_lines')).catch(() => false),
  split: text => aiGateway.run<{ lines: AiLine[] }>('mr_text_lines', { text }, { screen: 'material_request' }),
  feedback: (runId, accepted) => aiGateway.feedback(runId, accepted),
};

interface Row { key: string; line: MatchedLine<InventoryItem>; itemId: string | null; qty: string; spec: string; reason: string; include: boolean; showSpec: boolean; showReason: boolean }

const PICK_OTHER = '__pick';
const num = (s: string) => parseViNumber(String(s).trim()) ?? 0;
const qtyText = (q: number | null) => (q == null ? '' : String(q).replace('.', ','));
const inputCls = 'w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-indigo-300';

const toRows = (lines: MatchedLine<InventoryItem>[]): Row[] => lines.map((line, i) => {
  const item = line.pick;
  return {
    key: `${i}:${line.raw}`, line, itemId: item?.id ?? null,
    // Lệch đơn vị (câu ghi "tấn", mã tính "kg") → để trống SL, bắt nhập lại theo đơn vị của mã.
    qty: item && !sameUnit(line.unit, item.unit) ? '' : qtyText(line.qty),
    spec: line.specGuess || '', reason: line.note || '', include: Boolean(item),
    // Ô quy cách / lý do riêng chỉ mở khi câu có ghi (93% dòng đề xuất thật không ghi quy cách; lý do chung ở ô "Dùng cho").
    showSpec: Boolean(line.specGuess), showReason: Boolean(line.note),
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
}> = ({ items, boost, withReason, filterWarehouseId, allowAllItems = true, onAdd, onClose, hooks = defaultQuickLinesHooks }) => {
  const catalog = useMemo(() => items.filter(i => i.status !== 'retired' && !i.mergedIntoId), [items]);
  const byId = useMemo(() => new Map(catalog.map(i => [i.id, i])), [catalog]);
  const [text, setText] = useState('');
  const [reasonAll, setReasonAll] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [ai, setAi] = useState<{ available: boolean; state: 'idle' | 'pending' | 'error'; message?: string; runId?: string }>({ available: false, state: 'idle' });
  const [picker, setPicker] = useState<{ key: string; query: string } | null>(null);

  useEffect(() => { let alive = true; hooks.aiAvailable().then(v => { if (alive) setAi(a => ({ ...a, available: v })); }); return () => { alive = false; }; }, [hooks]);
  // Tách bằng quy tắc khi gõ (trễ 250 ms); gõ lại sau khi AI tách thì quay về quy tắc.
  useEffect(() => {
    const t = window.setTimeout(() => { setRows(toRows(matchLines(parseRequestText(text), catalog, { boost }))); setAi(a => ({ ...a, runId: undefined, state: a.state === 'pending' ? a.state : 'idle' })); }, 250);
    return () => window.clearTimeout(t);
  }, [text, catalog, boost]);

  const update = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const choose = (row: Row, item: InventoryItem) => update(row.key, {
    itemId: item.id, include: true,
    qty: sameUnit(row.line.unit, item.unit) ? (row.qty || qtyText(row.line.qty)) : '',
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
  const shaky = !ai.runId && (rows.some(r => r.line.unsure) || unknown > 0);

  const add = () => {
    const out: QuickLine[] = ready.map(r => ({ item: byId.get(r.itemId!)!, qty: num(r.qty), specification: r.spec.trim(), reason: (r.reason || reasonAll).trim() }));
    if (!out.length) return;
    const untouched = ready.every(r => r.itemId === r.line.pick?.id);
    recordSuggestionEvent({ screen: 'material_request', field: ai.runId ? 'text_lines_ai' : 'text_lines', outcome: untouched && out.length === rows.length ? 'accepted' : 'edited', suggested: rows.length, accepted: out.length });
    if (ai.runId) hooks.feedback(ai.runId, true);
    onAdd(out);
  };

  return <section aria-label="Gõ nhanh danh sách vật tư" data-testid="quick-lines" className="mt-3 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
    <header className="flex items-center gap-2">
      <h3 className="text-sm font-bold text-foreground">Gõ nhanh danh sách</h3>
      {rows.length > 0 && <span className="text-xs text-muted-foreground">{rows.length} dòng · {matched} đã khớp mã{needPick ? ` · ${needPick} chọn mã` : ''}{unknown ? ` · ${unknown} chưa có mã` : ''}</span>}
      <button type="button" onClick={onClose} aria-label="Đóng gõ nhanh" className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-card"><X size={15} /></button>
    </header>
    <textarea value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus aria-label="Danh sách vật tư"
      placeholder="VD: ống PVC 110 C1 20 cây, cút PVC 110 15 cái, keo dán ống 2 hộp cho thoát nước mưa xưởng 1"
      className={`${inputCls} resize-y`} />
    {withReason && <input value={reasonAll} onChange={e => setReasonAll(e.target.value)} aria-label="Dùng cho" placeholder="Dùng cho (điền các dòng chưa có lý do)" className={inputCls} />}

    {ai.available && text.trim() && <div className={`flex flex-wrap items-center gap-2 text-xs ${shaky ? 'rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100' : 'text-muted-foreground'}`}>
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
                <span className="truncate">“{row.line.name}{row.line.qty != null ? ` · ${qtyText(row.line.qty)} ${row.line.unit || ''}` : ''}”</span>
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
              {(row.showSpec || (withReason && row.showReason)) && <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {row.showSpec && <input value={row.spec} onChange={e => update(row.key, { spec: e.target.value })} aria-label="Quy cách" placeholder="Quy cách" className={inputCls} />}
                {withReason && row.showReason && <input value={row.reason} onChange={e => update(row.key, { reason: e.target.value })} aria-label="Lý do" placeholder={reasonAll || 'Lý do'} className={inputCls} />}
              </div>}
              {(!row.showSpec || (withReason && !row.showReason)) && <p className="flex gap-3 text-xs">
                {!row.showSpec && <button type="button" onClick={() => update(row.key, { showSpec: true })} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">+ Quy cách</button>}
                {withReason && !row.showReason && <button type="button" onClick={() => update(row.key, { showReason: true })} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">+ Lý do riêng</button>}
              </p>}
              {unitClash && <p className="flex items-center gap-1 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle size={12} />Câu ghi {qtyText(row.line.qty)} {row.line.unit} — mã tính theo {item?.unit}, nhập lại số lượng.</p>}
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

    <ItemSelectionModal isOpen={Boolean(picker)} onClose={() => setPicker(null)} onOpenScanner={() => undefined}
      onSelect={it => { const row = rows.find(r => r.key === picker?.key); if (row) choose(row, it); setPicker(null); }}
      items={catalog} allowAllItems={allowAllItems} filterWarehouseId={filterWarehouseId} showStockQuantities={false} initialQuery={picker?.query} />
  </section>;
};
