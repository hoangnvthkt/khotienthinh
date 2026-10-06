import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Clock, FileCode2, FileText, Loader2, Plus, ReceiptText, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import SearchableSelect from '../common/SearchableSelect';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { parseEInvoiceXml } from '../../lib/einvoiceXml';
import {
  financeService, type FinanceAttachment, type FinanceInvoice, type FinanceInvoices, type InvoiceDocument, type InvoiceStatus,
} from '../../lib/financeService';
import { partnerService } from '../../lib/partnerService';
import { Badge, Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, FieldError, NUM, moneyInput, parseMoney, shortMoney, viDate } from './financeUi';

// K3c — hóa đơn đầu vào NCC + khớp 3 bên (đơn mua → nhận hàng / đối soát → hóa đơn). Dung sai 0,5% hoặc 50.000 đ:
// trong dung sai ghi ngay và tự điều chỉnh công nợ + chi phí phần lệch; vượt dung sai ghi lý do, người khác duyệt.

const STATUS: Record<InvoiceStatus, { label: string; cls: string }> = {
  pending_approval: { label: 'Chờ duyệt lệch', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  awaiting_goods: { label: 'Chờ hàng', cls: 'border-sky-200 bg-sky-50 text-sky-800' },
  posted: { label: 'Đã ghi', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  rejected: { label: 'Trả lại', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  reversed: { label: 'Đã đảo', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
};
const SRC: Record<string, string> = { purchase_delivery_receipt: 'Nhận hàng PO', supplier_delivery_statement: 'Bảng đối soát HĐ', direct_supplier_receipt: 'Nhập trực tiếp',
  site_direct_purchase: 'Mua tại công trường', opening_balance: 'Số dư đầu kỳ', manual_adjustment: 'Điều chỉnh' };
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
const tolOf = (expected: number) => Math.max(Math.round(Math.abs(expected) * 0.005 * 100) / 100, 50000);
type Tab = 'pending_approval' | 'awaiting_goods' | 'posted' | 'closed' | 'docs';

export const InvoicesView: React.FC<{ onChanged: () => void; initialSupplierId?: string | null }> = ({ onChanged, initialSupplierId }) => {
  const toast = useToast(); const confirm = useConfirm(); const askReason = useReasonConfirm();
  const [data, setData] = useState<FinanceInvoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ supplierId?: string | null; invoice?: FinanceInvoice; xml?: boolean } | null>(initialSupplierId ? { supplierId: initialSupplierId } : null);
  const load = useCallback(() => { setError(null); financeService.invoices({ withReversed: true }).then(d => { setData(d);
    setTab(t => t ?? (d.counts.pendingApproval ? 'pending_approval' : d.counts.awaitingGoods ? 'awaiting_goods' : d.counts.posted ? 'posted' : 'docs')); })
    .catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  if (error) return <StateBox kind="error" title="Chưa tải được hóa đơn NCC" message={error} onRetry={load} />;
  if (!data || !tab) return <StateBox kind="loading" title="Đang tải hóa đơn…" />;
  const k = data.counts; const can = data.can;
  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); toast.success('Hóa đơn NCC', msg); load(); onChanged(); } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(null); }
  };
  const list = data.invoices.filter(i => tab === 'closed' ? i.status === 'rejected' || i.status === 'reversed' : i.status === tab);
  const closed = data.invoices.filter(i => i.status === 'rejected' || i.status === 'reversed').length;

  return <div className="space-y-3">
    <section className="flex flex-wrap items-start gap-3 rounded-2xl border border-teal-200 bg-teal-50/60 px-4 py-3 text-sm text-teal-950 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-100">
      <ReceiptText size={18} className="mt-0.5 shrink-0" />
      <span className="min-w-[14rem] flex-1"><b>Hóa đơn NCC — khớp 3 bên</b> (đơn mua → nhận hàng → hóa đơn). Lệch ≤ 0,5% hoặc 50.000 đ: ghi ngay, công nợ và chi phí tự điều chỉnh phần lệch.
        Lệch hơn: ghi lý do, người khác duyệt. Hóa đơn đến trước hàng: ghi "Chờ hàng", khớp sau.</span>
      {can.record && <span className="flex flex-wrap gap-2"><button type="button" onClick={() => setDrawer({ xml: true })} className={`${secondaryBtn} bg-card`}><FileCode2 size={15} />Đọc file XML</button>
        <button type="button" onClick={() => setDrawer({})} className={primaryBtn}><Plus size={15} />Ghi hóa đơn</button></span>}
    </section>
    {k.requiredMissing > 0 && <p className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <AlertTriangle size={15} className="shrink-0" /><span><b>{k.requiredMissing} chứng từ</b> thuộc hợp đồng "bắt buộc hóa đơn trước khi chi" còn nợ nhưng chưa có hóa đơn — chưa lập đề nghị chi được.</span></p>}

    <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {([['pending_approval', 'Chờ duyệt lệch', String(k.pendingApproval), 'vượt dung sai', k.pendingApproval ? 'text-amber-700' : 'text-foreground'],
        ['awaiting_goods', 'Chờ hàng', String(k.awaitingGoods), 'hóa đơn đến trước hàng', 'text-foreground'],
        ['posted', 'Đã ghi', String(k.posted), 'đã khớp chứng từ', 'text-leaf-700'],
        ['docs', 'Chứng từ chưa có hóa đơn', String(k.docsWithout), shortMoney(k.docsWithoutAmount), k.docsWithout ? 'text-amber-700' : 'text-leaf-700']] as const).map(([key, l, v, h, tone]) =>
        <button key={key} type="button" aria-pressed={tab === key} onClick={() => { setTab(key); setLimit(20); }}
          className={`rounded-2xl border bg-card p-3 text-left shadow-sm ${tab === key ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{l}</span><b className={`mt-1 block text-xl tabular-nums ${tone}`}>{v}</b>
          <span className="block text-[11px] text-muted-foreground">{h}</span></button>)}
    </section>

    {tab === 'docs' ? <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <h3 className="border-b border-border px-4 py-2.5 font-semibold">NCC còn chứng từ chưa có hóa đơn ({data.suppliers.length})</h3>
      {data.suppliers.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Mọi chứng từ công nợ đã có hóa đơn.</p>
        : <ul className="divide-y divide-border text-sm">{data.suppliers.slice(0, limit).map(s => <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <span className="min-w-0 flex-1"><b className={ENT}>{s.name}</b><span className="block text-xs text-muted-foreground">{s.taxCode ? `MST ${s.taxCode} · ` : ''}{s.docs} chứng từ</span></span>
          <span className="font-semibold tabular-nums">{shortMoney(s.remaining)}</span>
          {can.record && <button type="button" onClick={() => setDrawer({ supplierId: s.id })} className="text-xs font-semibold text-teal-700 hover:underline">Ghi hóa đơn</button>}</li>)}</ul>}
      {data.suppliers.length > limit && <button type="button" onClick={() => setLimit(n => n + 20)} className="w-full border-t border-border py-2 text-sm font-semibold text-teal-700 hover:bg-muted/40">Xem thêm</button>}
    </section> : <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <div role="tablist" aria-label="Trạng thái" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border p-0.5 text-sm">
          {([['pending_approval', `Chờ duyệt ${k.pendingApproval}`], ['awaiting_goods', `Chờ hàng ${k.awaitingGoods}`], ['posted', `Đã ghi ${k.posted}`], ['closed', `Trả lại / đảo ${closed}`]] as const).map(([key, l]) =>
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setLimit(20); }} className={`shrink-0 rounded-md px-2.5 py-1 font-semibold ${tab === key ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{l}</button>)}</div></div>
      {list.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Không có hóa đơn nào.</p>
        : <ul className="divide-y divide-border text-sm">{list.slice(0, limit).map(i => { const st = STATUS[i.status]; const b = busy === i.id; const v = i.variance ?? 0;
          return <li key={i.id} className="px-4 py-3">
            <p className="flex flex-wrap items-start gap-2"><span className="min-w-[12rem] flex-1"><b className={ENT}>{i.supplierName}</b>
              <span className="block text-xs text-muted-foreground">HĐ {i.symbol ? `${i.symbol} · ` : ''}số {i.number} · {viDate(i.date)}{i.source === 'xml' ? ' · từ XML' : ''} · lập: {i.createdByName || '—'}</span></span>
              <span className="text-right"><b className="tabular-nums">{money(i.gross)} đ</b><span className="block text-[11px] text-muted-foreground">hàng {money(i.net)} · VAT {money(i.vat)}</span></span>
              <Badge className={st.cls}>{st.label}</Badge></p>
            {i.status !== 'awaiting_goods' && i.expected != null && <p className="mt-1 text-xs text-muted-foreground">Theo nhận hàng {money(i.expected)} đ · lệch <b className={Math.abs(v) < 0.5 ? 'text-leaf-700' : Math.abs(v) <= (i.tolerance ?? 0) ? 'text-teal-700' : 'text-amber-700'}>{Math.abs(v) < 0.5 ? '0' : signed(v)} đ</b>
              {Math.abs(v) >= 0.5 && ` (dung sai ${money(i.tolerance ?? 0)} đ)`}{i.adjustmentCode ? ` · điều chỉnh ${i.adjustmentCode}` : ''}{i.reason ? ` · lý do: ${i.reason}` : ''}</p>}
            {i.documents.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{i.documents.map(d => <Badge key={d.id} className="border-border bg-muted text-muted-foreground">{d.documentNo || d.code}{d.projectCode ? ` · ${d.projectCode}` : ''} · {shortMoney(d.amount)}</Badge>)}</p>}
            {i.status === 'awaiting_goods' && <p className="mt-1 text-xs text-sky-800">Chưa gắn chứng từ nhận hàng — chưa thành công nợ. Khi kho nhận, bấm Khớp chứng từ.</p>}
            {(i.decisionNote || i.reversalReason) && <p className="mt-1 text-xs text-muted-foreground">{i.status === 'reversed' ? `Đảo: ${i.reversedByName || ''} ${viDate(i.reversedAt)} — ${i.reversalReason}` : `${i.status === 'rejected' ? 'Trả lại' : 'Duyệt'}: ${i.decidedByName || ''} ${viDate(i.decidedAt)}${i.decisionNote ? ` — ${i.decisionNote}` : ''}`}</p>}
            <p className="mt-1.5 flex flex-wrap items-center gap-3 text-xs font-semibold">
              {i.attachments.map(a => <button key={a.path} type="button" onClick={() => void financeService.openAttachment(a.path)} className="text-teal-700 hover:underline"><FileText size={11} className="mr-0.5 inline" />{a.name}</button>)}
              {i.canEdit && <button type="button" onClick={() => setDrawer({ invoice: i, supplierId: i.supplierId })} className="text-teal-700 hover:underline">{i.status === 'awaiting_goods' ? 'Khớp chứng từ' : 'Sửa'}</button>}
              {i.canDecide && <><button type="button" disabled={b} className="text-rose-700 hover:underline" onClick={async () => {
                  const r = await askReason({ title: 'Trả lại hóa đơn lệch', targetName: `${i.supplierName} · số ${i.number}`, reasonLabel: 'Lý do', reasonPlaceholder: 'VD: NCC phải xuất hóa đơn điều chỉnh', actionLabel: 'Trả lại', intent: 'warning' });
                  if (r) void act(i.id, () => financeService.decideInvoice({ id: i.id, expectedRowVersion: i.rowVersion, action: 'reject', reason: r }), 'Đã trả lại hóa đơn.'); }}><X size={11} className="mr-0.5 inline" />Trả lại</button>
                <button type="button" disabled={b} className="text-leaf-700 hover:underline" onClick={async () => {
                  if (await confirm({ title: 'Duyệt hóa đơn lệch?', targetName: `${i.supplierName} · số ${i.number} · lệch ${signed(v)} đ`, confirmText: 'Duyệt', actionLabel: 'Duyệt', intent: 'success', countdownSeconds: 0,
                    warningText: `Ghi hóa đơn và ${v > 0 ? `tăng công nợ + chi phí ${money(v)} đ` : `giảm công nợ + chi phí ${money(-v)} đ`}. Lý do người lập: ${i.reason || '—'}` }))
                    void act(i.id, () => financeService.decideInvoice({ id: i.id, expectedRowVersion: i.rowVersion, action: 'approve' }), 'Đã duyệt — hóa đơn đã ghi.'); }}><Check size={11} className="mr-0.5 inline" />Duyệt</button></>}
              {can.confirm && (i.status === 'posted' || i.status === 'awaiting_goods') && <button type="button" disabled={b} className="text-muted-foreground hover:text-rose-700 hover:underline" onClick={async () => {
                const r = await askReason({ title: 'Đảo hóa đơn', targetName: `${i.supplierName} · số ${i.number}`, subtitle: 'Gỡ hóa đơn khỏi chứng từ; phần điều chỉnh công nợ / chi phí do lệch (nếu có) được đảo. Ghi lại hóa đơn đúng sau.',
                  reasonLabel: 'Lý do', actionLabel: 'Đảo hóa đơn', intent: 'danger' });
                if (r) void act(i.id, () => financeService.decideInvoice({ id: i.id, expectedRowVersion: i.rowVersion, action: 'reverse', reason: r }), 'Đã đảo hóa đơn.'); }}><RotateCcw size={11} className="mr-0.5 inline" />Đảo</button>}
            </p>
          </li>; })}</ul>}
      {list.length > limit && <button type="button" onClick={() => setLimit(n => n + 20)} className="w-full border-t border-border py-2 text-sm font-semibold text-teal-700 hover:bg-muted/40">Xem thêm</button>}
    </section>}

    {drawer && <InvoiceDrawer suppliers={data.suppliers} supplierId={drawer.supplierId || null} invoice={drawer.invoice} openXml={drawer.xml} onClose={() => setDrawer(null)}
      onSaved={m => { setDrawer(null); toast.success('Hóa đơn NCC', m); load(); onChanged(); }} />}
  </div>;
};

// Chọn chứng từ khớp tổng hóa đơn: một chứng từ trong dung sai, không có thì cộng dần từ chứng từ cũ nhất.
export const suggestDocuments = (docs: InvoiceDocument[], gross: number): Record<string, number> => {
  if (!(gross > 0) || !docs.length) return {};
  const one = docs.filter(d => Math.abs(d.remaining - gross) <= tolOf(d.remaining)).sort((a, b) => Math.abs(a.remaining - gross) - Math.abs(b.remaining - gross))[0];
  if (one) return { [one.id]: one.remaining };
  const out: Record<string, number> = {}; let sum = 0;
  for (const d of [...docs].sort((a, b) => String(a.documentDate).localeCompare(String(b.documentDate)))) {
    if (sum >= gross - tolOf(sum)) break;
    const take = Math.min(d.remaining, Math.max(gross - sum, 0)); if (take <= 0.5) break;
    out[d.id] = Math.round(take * 100) / 100; sum += take;
  }
  return out;
};

const InvoiceDrawer: React.FC<{ suppliers: FinanceInvoices['suppliers']; supplierId: string | null; invoice?: FinanceInvoice; openXml?: boolean; onClose: () => void; onSaved: (m: string) => void }> =
  ({ suppliers, supplierId, invoice, openXml, onClose, onSaved }) => {
  const toast = useToast(); const confirm = useConfirm();
  const xmlRef = useRef<HTMLInputElement>(null);
  const [partners, setPartners] = useState<Array<{ id: string; name: string; taxCode: string | null }>>(suppliers.map(s => ({ id: s.id, name: s.name, taxCode: s.taxCode })));
  const [sup, setSup] = useState<string>(invoice?.supplierId || supplierId || '');
  const [docs, setDocs] = useState<InvoiceDocument[] | null>(null);
  const [symbol, setSymbol] = useState(invoice?.symbol || ''); const [no, setNo] = useState(invoice?.number || ''); const [date, setDate] = useState(invoice?.date || '');
  const [rate, setRate] = useState(invoice?.vatPercent != null ? String(invoice.vatPercent) : '8');
  const [net, setNet] = useState(moneyInput(invoice?.net)); const [vat, setVat] = useState(moneyInput(invoice?.vat)); const [gross, setGross] = useState(moneyInput(invoice?.gross));
  const [files, setFiles] = useState<FinanceAttachment[]>(invoice?.attachments || []);
  const [pick, setPick] = useState<Record<string, number>>(() => Object.fromEntries((invoice?.documents || []).map(d => [d.id, d.amount])));
  const [reason, setReason] = useState(invoice?.reason || ''); const [source, setSource] = useState<'manual' | 'xml'>(invoice?.source || 'manual');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [xmlNote, setXmlNote] = useState<string | null>(null);
  useEffect(() => { partnerService.list().then(ps => setPartners(cur => { const m = new Map(cur.map(x => [x.id, x]));
    ps.forEach(p => { if (!m.has(p.id)) m.set(p.id, { id: p.id, name: p.name, taxCode: (p as { taxCode?: string | null }).taxCode || null }); }); return [...m.values()]; })).catch(() => undefined); }, []);
  useEffect(() => { if (!sup) { setDocs(null); return; } setDocs(null);
    financeService.invoices({ supplierId: sup }).then(d => { const own = invoice ? invoice.documents.map(x => ({ id: x.id, code: x.code, documentNo: x.documentNo, sourceType: x.sourceType, projectCode: x.projectCode, contractCode: null,
      documentDate: null, recognized: x.recognized, outstanding: 0, invoiced: 0, remaining: x.amount, requireInvoice: false, poNumber: null })) : [];
      const list = d.documents || []; setDocs([...own.filter(o => !list.some(l => l.id === o.id)), ...list.map(l => { const mine = own.find(o => o.id === l.id); return mine ? { ...l, remaining: l.remaining + mine.remaining } : l; })]); })
      .catch(e => setErr(e instanceof Error ? e.message : String(e))); }, [sup, invoice]);
  useEffect(() => { if (openXml) setTimeout(() => xmlRef.current?.click(), 50); }, [openXml]);

  const n = parseMoney(net); const vv = parseMoney(vat); const g = parseMoney(gross);
  const setFromNet = (v: string) => { setNet(v); const x = parseMoney(v); const r = Number(rate); if (x >= 0 && Number.isFinite(r)) { const t = Math.round(x * r / 100); setVat(moneyInput(t)); setGross(moneyInput(x + t)); } };
  const setFromRate = (r: string) => { setRate(r); const x = parseMoney(net); const p = Number(r); if (x >= 0 && Number.isFinite(p)) { const t = Math.round(x * p / 100); setVat(moneyInput(t)); setGross(moneyInput(x + t)); } };
  const expected = Object.values(pick).reduce((a, b) => a + b, 0);
  const lines = Object.entries(pick).filter(([, a]) => a > 0);
  const variance = lines.length ? Math.round((g - expected) * 100) / 100 : null; const tol = tolOf(expected);
  const result = !lines.length ? 'awaiting' : Math.abs(variance!) < 0.5 ? 'exact' : Math.abs(variance!) <= tol ? 'within' : 'over';
  const sumOk = Number.isFinite(n) && Number.isFinite(vv) && Number.isFinite(g) && Math.abs(n + vv - g) <= 1;
  const blockers = [!sup && 'Chọn NCC', !no.trim() && 'Nhập số hóa đơn', !date && 'Chọn ngày hóa đơn', !(g > 0) && 'Nhập tổng tiền', g > 0 && !sumOk && 'Tiền hàng + VAT ≠ tổng',
    !files.length && 'Đính kèm hóa đơn', result === 'over' && !reason.trim() && 'Ghi lý do lệch'].filter(Boolean) as string[];

  const readXml = async (file: File) => {
    try {
      const x = parseEInvoiceXml(await file.text());
      if (!x.number && !x.gross) { toast.error('Không đọc được hóa đơn', 'File XML không đúng định dạng hóa đơn điện tử (thiếu số hóa đơn, tổng tiền).'); return; }
      setSymbol(x.symbol || ''); setNo(x.number || ''); setDate(x.date || ''); if (x.vatPercent != null) setRate(String(x.vatPercent));
      setNet(moneyInput(x.net)); setVat(moneyInput(x.vat)); setGross(moneyInput(x.gross)); setSource('xml');
      const att = await financeService.upload(`invoice/${x.sellerTaxCode || 'xml'}`, [file]); setFiles(f => [...f, ...att]);
      if (x.sellerTaxCode) {
        const found = await financeService.findSupplierByTax(x.sellerTaxCode).catch(() => null);
        // Danh mục có thể trùng NCC cùng MST: ưu tiên NCC đang có chứng từ chưa có hóa đơn.
        const best = found?.find(f => suppliers.some(x2 => x2.id === f.id)) || found?.[0];
        if (best) { setPartners(ps => ps.some(p => p.id === best.id) ? ps : [...ps, best]); setSup(best.id);
          setXmlNote(`Người bán MST ${x.sellerTaxCode} → ${best.name}${found!.length > 1 ? ` (danh mục có ${found!.length} NCC trùng MST — đã chọn NCC đang có chứng từ; nên gộp trùng ở danh mục đối tác)` : ''}.`); }
        else setXmlNote(`Không tìm thấy NCC có MST ${x.sellerTaxCode} (${x.sellerName || ''}) — chọn NCC tay, hoặc bổ sung MST ở danh mục đối tác.`);
      }
      setPick({});
    } catch (e) { toast.error('Không đọc được file XML', e instanceof Error ? e.message : ''); }
  };
  const save = async () => {
    if (result === 'within' && !await confirm({ title: 'Ghi hóa đơn lệch trong dung sai?', targetName: `Lệch ${signed(variance!)} đ (dung sai ${money(tol)} đ)`, confirmText: 'Ghi', actionLabel: 'Ghi hóa đơn',
      intent: 'success', countdownSeconds: 0, warningText: `Công nợ và chi phí dự án tự ${variance! > 0 ? 'tăng' : 'giảm'} ${money(Math.abs(variance!))} đ theo hóa đơn.` })) return;
    setBusy(true); setErr(null);
    try {
      const r = await financeService.saveInvoice({ id: invoice?.id, expectedRowVersion: invoice?.rowVersion, supplierId: sup, invoiceNumber: no.trim(), invoiceSymbol: symbol.trim() || null, invoiceDate: date,
        netAmount: n, vatAmount: vv, grossAmount: g, vatPercent: Number.isFinite(Number(rate)) ? Number(rate) : null, attachments: files,
        lines: lines.map(([documentId, amount]) => ({ documentId, amount })), reason: reason.trim() || null, source });
      onSaved(r.status === 'posted' ? 'Đã ghi hóa đơn.' : r.status === 'pending_approval' ? 'Đã gửi duyệt hóa đơn lệch.' : 'Đã ghi hóa đơn chờ hàng.');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const supName = partners.find(p => p.id === sup)?.name;

  return <Drawer label="Hóa đơn NCC" wide onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phải trả · hóa đơn NCC</p><h2 className={`text-lg ${ENT}`}>{invoice ? `Hóa đơn số ${invoice.number}` : 'Ghi hóa đơn đầu vào'}</h2>
      <p className="text-sm text-muted-foreground">Nhập tay hoặc đọc file XML hóa đơn điện tử; chọn chứng từ nhận hàng / đối soát mà hóa đơn này thanh toán.</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto basis-full text-xs text-amber-700 sm:basis-auto">{blockers.join(' · ')}</span>}
      <button type="button" onClick={onClose} className={`hidden sm:inline-flex ${secondaryBtn}`}>Huỷ</button>
      <button type="button" disabled={busy || blockers.length > 0} onClick={() => void save()} className={primaryBtn}>{busy ? <Loader2 size={15} className="animate-spin" /> : result === 'over' ? <Send size={15} /> : result === 'awaiting' ? <Clock size={15} /> : <CheckCircle2 size={15} />}
        {result === 'over' ? 'Gửi duyệt lệch' : result === 'awaiting' ? 'Ghi chờ hàng' : 'Ghi hóa đơn'}</button></>}>
    <input ref={xmlRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readXml(f); }} />
    {!invoice && <button type="button" onClick={() => xmlRef.current?.click()} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-teal-300 bg-teal-50/40 px-3 py-2.5 text-left text-sm hover:bg-teal-50 dark:border-teal-900 dark:bg-teal-950/20">
      <FileCode2 size={18} className="shrink-0 text-teal-700" /><span><b>Đọc file XML hóa đơn điện tử</b><span className="block text-xs text-muted-foreground">Tự điền ký hiệu, số, ngày, tiền hàng, VAT, tổng và tìm NCC theo mã số thuế; file XML được đính kèm luôn.</span></span></button>}
    {xmlNote && <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs">{xmlNote}</p>}
    <div className="grid gap-3 md:grid-cols-3">
      <label className="block text-sm font-medium md:col-span-3">Nhà cung cấp
        {invoice ? <p className={`mt-1 ${ENT}`}>{supName || invoice.supplierName}</p>
          : <SearchableSelect value={sup || null} options={partners} onChange={p => { setSup(p?.id || ''); setPick({}); }} getOptionValue={p => p.id} getOptionLabel={p => p.name}
            getOptionSearchText={p => `${p.name} ${p.taxCode || ''}`} renderOption={p => <span>{p.name}{p.taxCode ? <span className="text-xs text-muted-foreground"> · MST {p.taxCode}</span> : null}</span>}
            placeholder="Tìm theo tên hoặc mã số thuế…" ariaLabel="Nhà cung cấp" className="mt-1" />}</label>
      <label className="block text-sm font-medium">Ký hiệu<input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="VD: 1C26TNZ" className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="block text-sm font-medium">Số hóa đơn<input value={no} onChange={e => setNo(e.target.value)} placeholder="VD: 0000101" className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="block text-sm font-medium">Ngày hóa đơn<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="block text-sm font-medium">Tiền hàng (chưa VAT)<input value={net} onChange={e => setFromNet(e.target.value)} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></label>
      <label className="block text-sm font-medium">Thuế suất<select value={rate} onChange={e => setFromRate(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
        {['0', '5', '8', '10'].map(r => <option key={r} value={r}>{r}%</option>)}{!['0', '5', '8', '10'].includes(rate) && <option value={rate}>{rate}%</option>}</select></label>
      <label className="block text-sm font-medium">Tiền VAT<input value={vat} onChange={e => { setVat(e.target.value); const t = parseMoney(e.target.value); if (Number.isFinite(n) && Number.isFinite(t)) setGross(moneyInput(n + t)); }} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></label>
      <label className="block text-sm font-medium md:col-start-3">Tổng thanh toán<input value={gross} onChange={e => setGross(e.target.value)} inputMode="numeric" className={`mt-1 w-full text-right font-semibold tabular-nums ${inputCls}`} /></label>
    </div>
    {sup && <AttachmentPicker supplierId={`invoice/${sup}`} value={files} onChange={setFiles} label="Hóa đơn (PDF / XML / ảnh)" required />}

    {sup && <section className="overflow-hidden rounded-2xl border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2"><h3 className="mr-auto text-sm font-semibold">Chứng từ hóa đơn này thanh toán</h3>
        {docs && docs.length > 0 && g > 0 && <button type="button" onClick={() => setPick(suggestDocuments(docs, g))} className="text-xs font-semibold text-teal-700 hover:underline"><Sparkles size={12} className="mr-0.5 inline" />Chọn tự động theo tổng tiền</button>}</div>
      {!docs ? <p className="px-3 py-4 text-sm text-muted-foreground"><Loader2 size={14} className="mr-1 inline animate-spin" />Đang tải chứng từ…</p>
        : docs.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">NCC này chưa có chứng từ nhận hàng nào chưa có hóa đơn — ghi hóa đơn ở trạng thái <b>Chờ hàng</b>, khớp khi kho nhận.</p>
        : <ul className="divide-y divide-border text-sm">{docs.map(d => { const on = pick[d.id] != null;
          return <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <input type="checkbox" checked={on} aria-label={`Chọn ${d.documentNo || d.code}`} onChange={e => setPick(p => { const x = { ...p }; if (e.target.checked) x[d.id] = d.remaining; else delete x[d.id]; return x; })} />
            <span className="min-w-0 flex-1"><b>{d.documentNo || d.code}</b> <span className="text-xs text-muted-foreground">{SRC[d.sourceType] || d.sourceType}{d.poNumber ? ` · ${d.poNumber}` : ''}{d.projectCode ? ` · ${d.projectCode}` : ''}{d.documentDate ? ` · ${viDate(d.documentDate)}` : ''}</span>
              {d.requireInvoice && <Badge className="ml-1 border-amber-300 bg-amber-50 text-amber-800">HĐ bắt buộc hóa đơn</Badge>}
              <span className="block text-[11px] text-muted-foreground">Ghi nợ {money(d.recognized)} đ{d.invoiced > 0.5 ? ` · đã có hóa đơn ${money(d.invoiced)} đ` : ''}</span></span>
            {on ? <input value={moneyInput(pick[d.id])} onChange={e => { const x = parseMoney(e.target.value); setPick(p => ({ ...p, [d.id]: Number.isFinite(x) ? Math.min(x, d.remaining) : 0 })); }} inputMode="numeric" aria-label="Số tiền gắn"
              className={`w-36 text-right tabular-nums ${inputCls}`} /> : <span className="w-36 text-right text-xs tabular-nums text-muted-foreground">còn {money(d.remaining)} đ</span>}
          </li>; })}</ul>}
    </section>}

    {sup && <section className={`rounded-xl border p-3 text-sm ${result === 'over' ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100' : result === 'awaiting' ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-leaf-200 bg-leaf-50 text-leaf-900'}`}>
      {result === 'awaiting' ? <p className="flex items-start gap-2"><Clock size={15} className="mt-0.5 shrink-0" />Chưa chọn chứng từ — hóa đơn ghi ở trạng thái <b>Chờ hàng</b>, chưa thành công nợ.</p>
        : <><p className="flex flex-wrap items-center gap-x-4 gap-y-1"><span>Theo nhận hàng <b className="tabular-nums">{money(expected)} đ</b></span><span>Hóa đơn <b className="tabular-nums">{Number.isFinite(g) ? money(g) : '—'} đ</b></span>
          <span>Lệch <b className="tabular-nums">{signed(variance ?? 0)} đ</b></span><span className="text-xs">dung sai {money(tol)} đ</span></p>
          <p className="mt-1 flex items-start gap-2 font-semibold">{result === 'exact' ? <><CheckCircle2 size={15} className="mt-0.5 shrink-0" />Khớp — ghi ngay.</>
            : result === 'within' ? <><CheckCircle2 size={15} className="mt-0.5 shrink-0" />Lệch trong dung sai — ghi ngay; công nợ và chi phí tự {variance! > 0 ? 'tăng' : 'giảm'} {money(Math.abs(variance!))} đ.</>
            : <><AlertTriangle size={15} className="mt-0.5 shrink-0" />Vượt dung sai — ghi lý do, người khác duyệt mới ghi. Báo Mua hàng làm việc với NCC nếu giá / lượng sai.</>}</p>
          {result === 'over' && <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="VD: NCC tính thêm phí bốc xếp 200.000 đ theo phụ lục HĐ" className={`mt-2 w-full ${inputCls}`} />}</>}
    </section>}
  </Drawer>;
};
