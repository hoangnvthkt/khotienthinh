import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, Loader2, RefreshCw, Undo2, Upload } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { contractCostItemService } from '../../lib/contractMetadataService';
import { inferProjectCostCategoryFromCostItem } from '../../lib/contractCostItemOptions';
import {
  financeService, type FinanceMisaImports, type FinanceMisaRowCheck, type FinanceMisaRowInput, type FinanceMisaRowStatus,
} from '../../lib/financeService';
import { partnerService } from '../../lib/partnerService';
import { downloadProjectTransactionImportTemplate, parseProjectTransactionImportPreviewRows, readTransactionImportRows } from '../../lib/projectTransactionImport';
import type { ContractCostItem } from '../../types';
import { Badge, Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, shortMoney, viDate } from './financeUi';

// Nhập số MISA ở Tài chính (doc 14 câu 5): đọc file → máy chủ kiểm từng dòng (mốc chi phí vật tư, trùng chứng từ, tháng khoá sổ,
// khoản mục) → nhập theo lô (quyền Ghi nhận) → huỷ cả lô khi nhập nhầm (quyền Xác nhận). Khoản thu không nhập ở đây (ghi ở Phải thu).

const STATUS: Record<FinanceMisaRowStatus, { label: string; cls: string }> = {
  ok: { label: 'Sẽ nhập', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  no_cost_item: { label: 'Thiếu khoản mục', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  after_cutover: { label: 'Vật tư sau mốc', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
  duplicate: { label: 'Đã nhập trước', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
  duplicate_in_file: { label: 'Trùng trong file', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
  period_locked: { label: 'Tháng đã khoá', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  bad_amount: { label: 'Số tiền sai', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  bad_date: { label: 'Ngày sai', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
};
const PAGE = 100;

type Line = FinanceMisaRowInput & { check?: FinanceMisaRowCheck; picked: boolean };

export const MisaImportDrawer: React.FC<{ projectId: string; projectLabel: string; onClose: () => void; onSaved: () => void }> = ({ projectId, projectLabel, onClose, onSaved }) => {
  const toast = useToast(); const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<FinanceMisaImports | null>(null);
  const [items, setItems] = useState<ContractCostItem[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [skipped, setSkipped] = useState({ revenue: 0, total: 0 });
  const [phase, setPhase] = useState<'idle' | 'reading' | 'checking' | 'saving'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<'all' | 'ok' | 'skip'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [bulk, setBulk] = useState('');

  useEffect(() => {
    financeService.misaImports(projectId).then(setInfo).catch(e => setErr(e instanceof Error ? e.message : String(e)));
    contractCostItemService.list().then(setItems).catch(() => setItems([]));
  }, [projectId]);
  const leafItems = useMemo(() => {
    const parents = new Set(items.map(i => i.parentId).filter(Boolean));
    return items.filter(i => i.status === 'active' && !parents.has(i.id)).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [items]);

  const check = useCallback(async (next: Line[]) => {
    setPhase('checking'); setErr(null);
    try {
      const r = await financeService.previewMisaImport(projectId, next.map(({ check: _c, picked: _p, ...row }) => row));
      const byRow = new Map(r.rows.map(x => [x.row, x]));
      setLines(next.map(l => { const c = byRow.get(l.row); return { ...l, check: c, picked: c?.status === 'ok' ? (l.check?.status === 'ok' ? l.picked : true) : false }; }));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setLines(next); }
    finally { setPhase('idle'); }
  }, [projectId]);

  const onFile = async (f: File) => {
    setPhase('reading'); setErr(null); setFile(f.name); setLines(null); setShow('all'); setLimit(PAGE);
    try {
      const [rows, costItems, partners] = await Promise.all([readTransactionImportRows(await f.arrayBuffer()),
        items.length ? Promise.resolve(items) : contractCostItemService.list(), partnerService.list().catch(() => [])]);
      if (!items.length) setItems(costItems);
      const parsed = parseProjectTransactionImportPreviewRows(rows, { projectId, projectFinanceId: '', constructionSiteId: '', costItems, partners, strictDate: true });
      const usable = parsed.items.filter(i => !i.isTotal);
      const costs = usable.filter(i => i.tx.type === 'expense');
      setSkipped({ revenue: usable.length - costs.length, total: parsed.items.length - usable.length });
      if (!costs.length) { setPhase('idle'); setErr('File không có dòng chi phí nào. Kiểm tra cột "Số tiền", "Ngày", "Mã khoản mục" (tải file mẫu để xem).'); return; }
      if (costs.length > 3000) { setPhase('idle'); setErr(`File có ${costs.length.toLocaleString('vi-VN')} dòng — mỗi lần nhập tối đa 3.000 dòng. Tách file theo tháng.`); return; }
      await check(costs.map(i => ({ row: i.rowNumber, date: String(i.tx.date || ''), amount: Number(i.tx.amount) || 0, costItemId: i.tx.contractCostItemId || null,
        category: i.tx.category, description: i.tx.description || '', invoiceNo: i.tx.invoiceNo || null, invoiceDate: i.tx.invoiceDate || null,
        partnerId: i.tx.counterpartyPartnerId || null, partnerName: i.tx.counterpartyName || null, picked: true })));
    } catch (e) { setPhase('idle'); setErr(`Không đọc được file: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const setItem = (rows: number[], costItemId: string) => {
    if (!lines) return;
    const it = items.find(i => i.id === costItemId);
    const set = new Set(rows);
    void check(lines.map(l => set.has(l.row) ? { ...l, costItemId: costItemId || null, category: it ? inferProjectCostCategoryFromCostItem(it) : 'other' } : l));
  };

  const ok = (lines || []).filter(l => l.check?.status === 'ok');
  const picked = ok.filter(l => l.picked);
  const total = picked.reduce((s, l) => s + l.amount, 0);
  const skip = (lines || []).filter(l => l.check && l.check.status !== 'ok');
  const missing = skip.filter(l => l.check?.status === 'no_cost_item');
  const reasons = Object.entries(skip.reduce<Record<string, number>>((m, l) => { const k = l.check!.status; m[k] = (m[k] || 0) + 1; return m; }, {}));
  const shown = (lines || []).filter(l => show === 'all' || (show === 'ok' ? l.check?.status === 'ok' : l.check?.status !== 'ok'));
  const busy = phase !== 'idle';
  const blockers = [!lines && 'Chọn file Excel', lines && !picked.length && 'Chưa có dòng nào hợp lệ để nhập', missing.length > 0 && `${missing.length} dòng thiếu khoản mục (gán hoặc bỏ qua)`].filter(Boolean) as string[];

  const save = async () => {
    if (!picked.length || busy) return;
    if (!await confirm({ title: 'Nhập số MISA?', targetName: `${projectLabel} · ${picked.length.toLocaleString('vi-VN')} dòng · ${money(total)}`, confirmText: 'Nhập', actionLabel: 'Nhập', intent: 'success', countdownSeconds: 0,
      warningText: `${skip.length ? `${skip.length} dòng bị bỏ (không nhập). ` : ''}Ghi vào chi phí dự án theo khoản mục; nhập nhầm thì Kế toán trưởng huỷ được cả lô.` })) return;
    setPhase('saving'); setErr(null);
    try {
      const r = await financeService.importMisa({ projectId, fileName: file || '', rows: picked.map(({ check: _c, picked: _p, ...row }) => row) });
      toast.success('Đã nhập số MISA', `${r.inserted.toLocaleString('vi-VN')} dòng · ${money(r.total)} vào ${projectLabel}.`);
      onSaved();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      toast.error('Chưa nhập được số MISA', m); setErr(m); setPhase('idle');
    }
  };

  return <Drawer label="Nhập số MISA" wide onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chi phí & ngân sách · nhập số MISA</p>
      <h2 className={`text-lg ${ENT}`}>{projectLabel}</h2>
      <p className="text-sm text-muted-foreground">Chi phí theo khoản mục từ sổ chi tiết MISA. Máy chủ kiểm tra trùng chứng từ, mốc chi phí vật tư và tháng đã khoá sổ trước khi ghi.</p></>}
    footer={<>{err ? <span className="mr-auto basis-full text-xs font-semibold text-rose-700 sm:basis-auto">{err}</span> : blockers.length > 0 && <span className="mr-auto basis-full text-xs text-amber-700 sm:basis-auto dark:text-amber-300">{blockers.join(' · ')}</span>}
      <button type="button" onClick={onClose} className={`hidden sm:inline-flex ${secondaryBtn}`}>Đóng</button>
      {lines && <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={secondaryBtn}><Upload size={15} />File khác</button>}
      <button type="button" disabled={busy || !picked.length} onClick={() => void save()} className={primaryBtn}>
        {phase === 'saving' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Nhập {picked.length ? `${picked.length.toLocaleString('vi-VN')} dòng · ${shortMoney(total)}` : ''}</button></>}>
    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
    {info && !info.canRecord && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Bạn chưa có quyền Tài chính — Ghi nhận nên chưa nhập được số MISA.</p>}
    {info?.cutoverDate && <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>Vật tư (CPNVL) từ <b>{viDate(info.cutoverDate)}</b> Vioo tự ghi khi nhận hàng — dòng vật tư từ ngày này trong file sẽ tự bỏ để không tính 2 lần. Các khoản mục khác nhập bình thường.</span></p>}

    {!lines && <section className="rounded-2xl border border-dashed border-teal-300 bg-teal-50/40 p-5 text-center dark:border-teal-900 dark:bg-teal-950/20">
      <FileSpreadsheet size={28} className="mx-auto text-teal-700" />
      <p className="mt-2 font-semibold">Chọn file Excel xuất từ MISA</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">Cột cần có: <b>Ngày</b>, <b>Mã khoản mục</b> (CPNC, CPMTC, CPQL…), <b>Số tiền</b>, <b>Nội dung</b>; nên có <b>Số chứng từ</b> và <b>Đối tác</b> để chặn trùng. Dòng tiêu đề công ty, dòng tổng cộng và khoản thu tự bỏ qua.</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button type="button" disabled={busy || (info ? !info.canRecord : false)} onClick={() => fileRef.current?.click()} className={primaryBtn}>{phase === 'reading' || phase === 'checking' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}{phase === 'reading' ? 'Đang đọc file…' : phase === 'checking' ? 'Đang kiểm tra…' : 'Chọn file'}</button>
        <button type="button" onClick={() => void downloadProjectTransactionImportTemplate()} className={secondaryBtn}><Download size={15} />Tải file mẫu</button></div>
    </section>}

    {lines && <>
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <button type="button" onClick={() => setShow('ok')} className={`rounded-xl border p-3 text-left ${show === 'ok' ? 'border-leaf-400 ring-2 ring-leaf-200' : 'border-border'} bg-card`}>
          <span className="block text-xs text-muted-foreground">Sẽ nhập</span><b className="block text-lg tabular-nums text-leaf-700">{picked.length.toLocaleString('vi-VN')} dòng</b>
          <span className="text-xs text-muted-foreground">{money(total)}</span></button>
        <button type="button" onClick={() => setShow('skip')} className={`rounded-xl border p-3 text-left ${show === 'skip' ? 'border-amber-400 ring-2 ring-amber-200' : 'border-border'} bg-card`}>
          <span className="block text-xs text-muted-foreground">Bị bỏ / cần xử lý</span><b className={`block text-lg tabular-nums ${skip.length ? 'text-amber-700' : 'text-foreground'}`}>{skip.length.toLocaleString('vi-VN')} dòng</b>
          <span className="text-xs text-muted-foreground">{reasons.length ? reasons.map(([k, n]) => `${STATUS[k as FinanceMisaRowStatus].label.toLowerCase()} ${n}`).join(' · ') : 'không có'}</span></button>
        <article className="rounded-xl border border-border bg-card p-3"><span className="block text-xs text-muted-foreground">Khoản thu trong file</span><b className="block text-lg tabular-nums">{skipped.revenue.toLocaleString('vi-VN')} dòng</b>
          <span className="text-xs text-muted-foreground">không nhập — ghi ở Phải thu</span></article>
        <article className="min-w-0 rounded-xl border border-border bg-card p-3"><span className="block text-xs text-muted-foreground">File</span><b className="block truncate text-sm" title={file || ''}>{file}</b>
          <span className="text-xs text-muted-foreground">{skipped.total ? `bỏ ${skipped.total} dòng tổng` : 'không có dòng tổng'}</span></article>
      </section>

      {missing.length > 0 && <section className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle size={16} className="shrink-0" /><span className="min-w-[14rem] flex-1"><b>{missing.length} dòng chưa có khoản mục</b> (mã trong file không khớp danh mục). Gán một lần cho tất cả, hoặc chọn từng dòng bên dưới.</span>
        <select value={bulk} onChange={e => setBulk(e.target.value)} aria-label="Khoản mục cho các dòng thiếu" className={`max-w-full ${inputCls}`}>
          <option value="">Chọn khoản mục…</option>{leafItems.map(i => <option key={i.id} value={i.id}>{i.symbol} — {i.name}</option>)}</select>
        <button type="button" disabled={!bulk || busy} onClick={() => { setItem(missing.map(l => l.row), bulk); setBulk(''); }} className={secondaryBtn}>Gán cho {missing.length} dòng</button>
      </section>}

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <div role="tablist" aria-label="Lọc dòng" className="inline-flex rounded-lg border border-border p-0.5 text-sm">
            {([['all', `Tất cả ${lines.length}`], ['ok', `Sẽ nhập ${ok.length}`], ['skip', `Bị bỏ ${skip.length}`]] as const).map(([k, l]) =>
              <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => { setShow(k); setLimit(PAGE); }} className={`rounded-md px-2.5 py-1 font-semibold ${show === k ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{l}</button>)}</div>
          {ok.length > 0 && <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={picked.length === ok.length} onChange={e => setLines(ls => ls && ls.map(l => l.check?.status === 'ok' ? { ...l, picked: e.target.checked } : l))} />Chọn tất cả dòng hợp lệ</label>}
          <button type="button" disabled={busy} onClick={() => void check(lines)} className={`ml-auto ${secondaryBtn}`}>{phase === 'checking' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Kiểm tra lại</button>
        </div>
        <ul className="divide-y divide-border text-sm">{shown.slice(0, limit).map(l => { const st = l.check ? STATUS[l.check.status] : null; const can = l.check?.status === 'ok';
          return <li key={l.row} className={`flex items-start gap-3 px-3 py-2 ${can && !l.picked ? 'opacity-60' : ''}`}>
            <input type="checkbox" aria-label={`Nhập dòng ${l.row}`} disabled={!can} checked={can && l.picked} onChange={e => setLines(ls => ls && ls.map(x => x.row === l.row ? { ...x, picked: e.target.checked } : x))} className="mt-1" />
            <div className="min-w-0 flex-1">
              <p className="flex items-start gap-2"><span className="min-w-0 flex-1 truncate font-medium">{l.description || '(không có nội dung)'}</span>
                <span className="shrink-0 font-semibold tabular-nums text-rose-700">−{money(l.amount)}</span></p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">#{l.row}</span><span className={`tabular-nums ${l.date ? '' : 'font-semibold text-rose-700'}`}>{l.date ? viDate(l.date) : 'không có ngày'}</span>
                {l.invoiceNo && <span>CT {l.invoiceNo}</span>}{l.partnerName && <span className="max-w-[14rem] truncate">{l.partnerName}</span>}
                {l.check?.status === 'no_cost_item' || (!l.costItemId && l.check)
                  ? <select value={l.costItemId || ''} onChange={e => setItem([l.row], e.target.value)} aria-label={`Khoản mục dòng ${l.row}`} className={`max-w-[14rem] text-xs ${inputCls}`}>
                    <option value="">Chọn khoản mục…</option>{leafItems.map(i => <option key={i.id} value={i.id}>{i.symbol} — {i.name}</option>)}</select>
                  : <span className="font-semibold text-foreground">{l.check?.symbol || '—'}</span>}
                {st && <Badge className={st.cls}>{st.label}</Badge>}</p>
              {l.check?.message && l.check.status !== 'ok' && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{l.check.message}</p>}
            </div>
          </li>; })}</ul>
        {shown.length > limit && <button type="button" onClick={() => setLimit(n => n + PAGE)} className="w-full border-t border-border py-2 text-sm font-semibold text-teal-700 hover:bg-muted/40">Xem thêm {Math.min(PAGE, shown.length - limit)} dòng (còn {shown.length - limit})</button>}
        {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Không có dòng nào.</p>}
      </section>
    </>}
  </Drawer>;
};

/** Lịch sử nhập MISA của dự án (dưới bảng khoản mục). Huỷ cả lô khi nhập nhầm: quyền Xác nhận, cần lý do. */
export const MisaImportHistory: React.FC<{ projectId: string; reloadKey: number; onChanged: () => void }> = ({ projectId, reloadKey, onChanged }) => {
  const toast = useToast(); const askReason = useReasonConfirm();
  const [data, setData] = useState<FinanceMisaImports | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setError(null); financeService.misaImports(projectId).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [projectId]);
  useEffect(load, [load, reloadKey]);
  if (error) return <p className="rounded-xl border border-border bg-card px-4 py-2 text-xs text-muted-foreground">Chưa tải được lịch sử nhập MISA: {error}</p>;
  if (!data) return null;
  const active = data.batches.filter(b => !b.cancelledAt);
  const cancel = async (b: FinanceMisaImports['batches'][number]) => {
    const reason = await askReason({ title: 'Huỷ lô nhập MISA', targetName: `${b.fileName || 'Lô không tên'} · ${b.rows} dòng · ${shortMoney(b.total)}`,
      subtitle: 'Xoá toàn bộ dòng chi phí của lô này khỏi dự án. Lô và các dòng đã xoá vẫn lưu trong nhật ký để truy vết; sau đó nhập lại file đúng.',
      reasonLabel: 'Lý do huỷ', reasonPlaceholder: 'VD: nhập nhầm file tháng 8 / nhầm dự án', actionLabel: 'Huỷ lô', intent: 'danger' });
    if (!reason) return;
    setBusy(true);
    try { const r = await financeService.cancelMisaImport({ batchId: b.id, reason }); toast.success('Đã huỷ lô nhập MISA', `Bỏ ${r.removed} dòng · ${money(r.total)}.`); load(); onChanged(); }
    catch (e) { toast.error('Chưa huỷ được lô', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  };
  return <section id="misa-imports" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
    <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 text-left">
      <FileSpreadsheet size={16} className="text-teal-700" /><h3 className="flex-1 font-semibold">Số MISA đã nhập
        <span className="ml-1 text-sm font-normal text-muted-foreground">· {data.legacy.count ? `${data.legacy.count.toLocaleString('vi-VN')} dòng từ sổ Dự án cũ` : 'chưa có từ sổ Dự án cũ'} · {active.length} lô nhập ở Tài chính</span></h3>
      <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} /></button>
    {open && <ul className="mt-2 divide-y divide-border text-sm">
      {data.legacy.count > 0 && <li className="py-2"><p className="flex flex-wrap items-center gap-2"><b>Nhập ở sổ Dự án (trước khi chuyển sang Tài chính)</b><span className="ml-auto tabular-nums">{shortMoney(data.legacy.total)}</span></p>
        <p className="text-xs text-muted-foreground">{data.legacy.count.toLocaleString('vi-VN')} dòng · {viDate(data.legacy.from)} – {viDate(data.legacy.to)} · không theo lô nên không huỷ ở đây.</p></li>}
      {data.batches.map(b => <li key={b.id} className={`py-2 ${b.cancelledAt ? 'opacity-60' : ''}`}>
        <p className="flex flex-wrap items-center gap-2"><FileSpreadsheet size={14} className="text-muted-foreground" /><b className="min-w-0 truncate">{b.fileName || 'Lô không tên'}</b>
          {b.cancelledAt && <Badge className="border-slate-200 bg-slate-100 text-slate-600">đã huỷ</Badge>}
          <span className="ml-auto tabular-nums">{b.rows.toLocaleString('vi-VN')} dòng · <b>{shortMoney(b.total)}</b></span></p>
        <p className="text-xs text-muted-foreground">Chứng từ {viDate(b.from)} – {viDate(b.to)} · nhập: {b.createdBy || '—'} {viDate(b.createdAt)}
          {b.cancelledAt ? ` · huỷ: ${b.cancelledBy || '—'} ${viDate(b.cancelledAt)}${b.cancelReason ? ` — ${b.cancelReason}` : ''}` : ''}</p>
        {!b.cancelledAt && b.byItem.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{b.byItem.map(x => <Badge key={x.symbol} className="border-border bg-muted text-muted-foreground" >{x.symbol} {shortMoney(x.amount)}</Badge>)}</p>}
        {!b.cancelledAt && data.canCancel && <button type="button" disabled={busy} onClick={() => void cancel(b)} className="mt-1 text-xs font-semibold text-rose-700 hover:underline"><Undo2 size={11} className="mr-0.5 inline" />Huỷ lô</button>}
      </li>)}
      {data.legacy.count === 0 && data.batches.length === 0 && <li className="py-2 text-muted-foreground">Chưa nhập số MISA nào cho dự án này.</li>}
    </ul>}
  </section>;
};
