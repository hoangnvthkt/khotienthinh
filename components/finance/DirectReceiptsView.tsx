import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookCheck, ChevronDown, ChevronRight, Lock, Undo2 } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceDirectReceipt, type FinanceDirectReceipts, type FinanceVatChoice } from '../../lib/financeService';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, parseMoney, shortMoney, viDate } from './financeUi';

// Phiếu nhập kho trực tiếp từ NCC (không qua PO): kế toán kiểm giá + VAT rồi ghi công nợ; chi phí dự án ghi cùng lúc.

const WARN = 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const RED = 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200';
const GREY = 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
const VATS: Array<{ v: '' | FinanceVatChoice; l: string }> = [
  { v: '', l: 'Chọn VAT' }, { v: '0', l: '0% / không chịu thuế' }, { v: '5', l: '5%' }, { v: '8', l: '8%' }, { v: '10', l: '10%' }, { v: 'incl', l: 'Giá đã gồm VAT' },
];
// VAT kho đã khai trên phiếu (nếu mọi dòng cùng một mức).
const vatHint = (rows: FinanceDirectReceipt[]): '' | FinanceVatChoice => {
  const set = new Set(rows.flatMap(r => r.lines.map(l => l.priceIncludesVat ? 'incl' : l.vatRate == null ? '' : String(l.vatRate))));
  const [only] = Array.from(set);
  return set.size === 1 && only && VATS.some(o => o.v === only) ? only as FinanceVatChoice : '';
};

type Group = { key: string; supplier: string; project: string; list: FinanceDirectReceipt[]; value: number; missing: number; dup: number };

export const DirectReceiptsView: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [data, setData] = useState<FinanceDirectReceipts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [vat, setVat] = useState<'' | FinanceVatChoice>('');
  const [invoice, setInvoice] = useState('');
  const [dupOk, setDupOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showReturned, setShowReturned] = useState(false);

  const load = useCallback(() => { setError(null); financeService.directReceipts().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);

  const groups = useMemo<Group[]>(() => Array.from((data?.receipts || []).reduce((m, d) => {
    const k = `${d.supplierId || '?'}|${d.projectId || 'company'}`; m.set(k, [...(m.get(k) || []), d]); return m;
  }, new Map<string, FinanceDirectReceipt[]>()).entries()).map(([key, list]) => ({
    key, list, supplier: list[0].supplierName || 'Chưa rõ NCC', project: list[0].projectCode || 'Kho công ty',
    value: list.reduce((s, d) => s + d.value, 0), missing: list.filter(d => d.missingPrice > 0).length, dup: list.filter(d => d.duplicateOf).length,
  })).sort((a, b) => b.missing - a.missing || b.value - a.value), [data]);
  const g = groups.find(x => x.key === selKey) || groups[0];
  const resetSelection = (key: string | null) => { setSelKey(key); setChecked({}); setPrices({}); setVat(''); setInvoice(''); setDupOk(false); };

  if (error) return <StateBox kind="error" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải phiếu nhập trực tiếp…" />;

  const sel = g ? g.list.filter(d => checked[d.id]) : [];
  const priceKey = (d: FinanceDirectReceipt, index: number) => `${d.id}:${index}`;
  const priceOf = (d: FinanceDirectReceipt, l: FinanceDirectReceipt['lines'][number]) => l.price > 0 ? l.price : (parseMoney(prices[priceKey(d, l.index)] || '') || 0);
  const net = sel.reduce((s, d) => s + d.lines.reduce((t, l) => t + l.qty * priceOf(d, l), 0), 0);
  const vatAmt = vat === '' || vat === 'incl' ? 0 : Math.round(net * Number(vat)) / 100;
  const missing = sel.some(d => d.lines.some(l => !(priceOf(d, l) > 0)));
  const hasDup = sel.some(d => d.duplicateOf);
  const own = sel.some(d => !d.canPost);
  const blockers = [
    !sel.length && 'Chọn phiếu cần ghi nợ', missing && 'Nhập đơn giá cho dòng chưa có giá', vat === '' && 'Chọn VAT',
    hasDup && !dupOk && 'Có phiếu nghi trùng — đối chiếu với kho rồi tích xác nhận',
    own && (data.can.record ? 'Có phiếu do bạn lập/duyệt — nhờ kế toán khác ghi nợ' : 'Cần quyền Tài chính — Ghi nhận'),
  ].filter(Boolean) as string[];

  const post = async () => {
    const before = sel.filter(d => d.beforeCutover).length;
    if (!await confirm({
      title: 'Ghi công nợ phiếu nhập?', targetName: `${sel.length} phiếu · ${money(net + vatAmt)} đ`, confirmText: 'Ghi công nợ', actionLabel: 'Ghi công nợ',
      intent: 'success', countdownSeconds: 0,
      warningText: `Sinh ${sel.length} chứng từ công nợ ${g.supplier} và ghi chi phí vật tư ${g.project}${before ? ` (${before} phiếu trước mốc MISA chỉ ghi nợ, không cộng chi phí)` : ''}. Dòng vừa nhập giá được cập nhật vào sổ kho. Sai thì đảo bằng chứng từ điều chỉnh.`,
    })) return;
    setBusy(true);
    try {
      const r = await financeService.postDirectReceipts({
        vat: vat as FinanceVatChoice, invoiceNo: invoice.trim() || undefined, duplicateChecked: hasDup ? dupOk : undefined,
        receipts: sel.map(d => ({ transactionId: d.id, rowVersion: d.rowVersion,
          prices: Object.fromEntries(d.lines.filter(l => !(l.price > 0)).map(l => [String(l.index), priceOf(d, l)])) })),
      });
      toast.success(`Đã ghi công nợ ${r.documents.length} phiếu`, `${g.supplier}: ${money(r.total)} đ — xem ở bước Đang nợ.`);
      resetSelection(g.key); load(); onChanged();
    } catch (e) { toast.error('Chưa ghi được công nợ', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  const giveBack = async () => {
    const reason = await askReason({ title: `Trả lại ${sel.length} phiếu cho kho`, targetName: sel.map(d => d.id).join(', '), reasonLabel: 'Lý do (kho sửa hoặc hủy phiếu)',
      reasonPlaceholder: 'VD: Nghi trùng với phiếu ngày 10/09 — kho kiểm tra', actionLabel: 'Trả lại', intent: 'warning' });
    if (!reason) return;
    setBusy(true);
    try {
      await financeService.returnDirectReceipts({ transactionIds: sel.map(d => d.id), reason });
      toast.success(`Đã trả ${sel.length} phiếu cho kho`, 'Người lập phiếu nhận thông báo. Phiếu quay lại đây khi kho sửa xong.');
      resetSelection(g.key); load();
    } catch (e) { toast.error('Chưa trả lại được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  return <div className="space-y-3">
    {!groups.length ? <StateBox kind="empty" title="Không còn phiếu nhập trực tiếp chờ ghi nợ" message="Phiếu kho nhập thẳng từ NCC (không qua PO) sẽ hiện ở đây để kế toán kiểm giá, VAT rồi ghi công nợ." />
      : <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <ul className={`h-fit overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${mobile ? 'hidden md:block' : ''}`}>
          {groups.map(x => <li key={x.key}><button type="button" onClick={() => { resetSelection(x.key); setMobile(true); setTimeout(() => document.getElementById('direct-receipt-detail')?.scrollIntoView({ block: 'start' }), 0); }}
            className={`flex w-full items-start gap-3 border-b border-l-4 border-border px-3 py-3 text-left ${x.missing || x.dup ? 'border-l-amber-400' : 'border-l-leaf-500'} ${g?.key === x.key ? 'bg-teal-50/70 dark:bg-teal-950/20' : 'hover:bg-muted/40'}`}>
            <span className="min-w-0 flex-1"><span className={`block truncate ${ENT}`}>{x.supplier}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{x.project} · {x.list.length} phiếu
                {x.missing > 0 && <Badge className={WARN}>{x.missing} chưa có giá</Badge>}{x.dup > 0 && <Badge className={RED}>Nghi trùng</Badge>}</span></span>
            <span className={`whitespace-nowrap text-sm ${NUM}`}>{x.value > 0 ? shortMoney(x.value) : <span className="font-normal text-muted-foreground">chưa có giá</span>}</span>
          </button></li>)}
        </ul>
        {g && <section id="direct-receipt-detail" className={`min-w-0 scroll-mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm ${mobile ? '' : 'hidden md:block'}`}>
          <button type="button" onClick={() => setMobile(false)} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 md:hidden"><ArrowLeft size={15} />Danh sách</button>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h2 className={`text-lg ${ENT}`}>{g.supplier}</h2>
              <p className="text-sm text-muted-foreground">{g.project}{g.list[0].contractCode ? ` · HĐ ${g.list[0].contractCode}` : ' · không gắn HĐ'}</p></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={g.list.every(d => checked[d.id])}
              onChange={e => { setChecked(Object.fromEntries(g.list.map(d => [d.id, e.target.checked]))); if (e.target.checked && !vat) setVat(vatHint(g.list)); }} />Chọn tất cả</label>
          </div>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {g.list.map(d => <li key={d.id} className={`px-3 py-2.5 ${checked[d.id] ? 'bg-teal-50/50 dark:bg-teal-950/20' : ''}`}>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={!!checked[d.id]} onChange={e => { setChecked(c => ({ ...c, [d.id]: e.target.checked })); if (e.target.checked && !vat) setVat(vatHint([d])); }} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5"><span className={ENT}>{d.id}</span><span className="text-xs text-muted-foreground">{viDate(d.date)} · {d.warehouse}</span>
                    {d.beforeCutover && <Badge className={GREY} title={`Trước mốc chi phí ${viDate(d.cutoverDate)}: chỉ ghi nợ, không cộng chi phí dự án (đã có trong MISA)`}>Trước mốc MISA</Badge>}
                    {d.duplicateOf && <Badge className={RED} title={`Cùng NCC, cùng ngày, cùng số tiền với ${d.duplicateOf}`}>Nghi trùng {d.duplicateOf.slice(-5)}</Badge>}
                    {!d.canPost && data.can.record && <Badge className={GREY}><Lock size={11} />Bạn lập/duyệt</Badge>}
                    {d.attachments === 0 && <Badge className={GREY}>Không có ảnh phiếu</Badge>}</span>
                  {d.note && <span className="block text-sm">{d.note}</span>}
                  <span className="block text-xs text-muted-foreground">Lập: {d.createdByName || '—'} · Duyệt nhập: {d.approvedByName || '—'}</span>
                </span>
              </label>
              <table className="mt-1.5 w-full text-xs sm:ml-7 sm:w-[calc(100%-1.75rem)]"><tbody>
                {d.lines.map(l => <tr key={l.index} className="text-muted-foreground">
                  <td className="py-0.5 pr-2 text-foreground">{l.itemName}</td>
                  <td className="!whitespace-nowrap px-2 text-right tabular-nums">{money(l.qty)} {l.unit || ''}</td>
                  <td className="!whitespace-nowrap px-2 text-right">{l.price > 0 ? <span className="tabular-nums">× {money(l.price)}</span>
                    : <input aria-label={`Đơn giá ${l.itemName}`} inputMode="numeric" placeholder={l.catalogPrice ? `giá DM ${money(l.catalogPrice)}` : 'Nhập giá'}
                      value={prices[priceKey(d, l.index)] || ''} onChange={e => setPrices(p => ({ ...p, [priceKey(d, l.index)]: e.target.value }))}
                      onBlur={() => { const n = parseMoney(prices[priceKey(d, l.index)] || ''); if (n > 0) setPrices(p => ({ ...p, [priceKey(d, l.index)]: money(n) })); }}
                      className={`w-28 border-amber-400 text-right tabular-nums ${inputCls}`} />}</td>
                  <td className={`!whitespace-nowrap pl-2 text-right ${NUM}`}>{priceOf(d, l) > 0 ? money(l.qty * priceOf(d, l)) : <span className="font-normal text-amber-700 dark:text-amber-300">chưa có giá</span>}</td>
                </tr>)}
              </tbody></table>
            </li>)}
          </ul>
          <div className="sticky bottom-0 z-10 -mx-4 mt-3 flex flex-wrap items-end gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
            {hasDup && <label className="flex w-full items-center gap-2 text-xs text-rose-700 dark:text-rose-300"><input type="checkbox" checked={dupOk} onChange={e => setDupOk(e.target.checked)} />
              Đã đối chiếu với kho: phiếu cùng ngày, cùng số tiền là các chuyến giao khác nhau, không trùng</label>}
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Thuế VAT
              <select value={vat} onChange={e => setVat(e.target.value as '' | FinanceVatChoice)} className={`${inputCls} ${vat === '' && sel.length ? 'border-amber-400' : ''}`}>
                {VATS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Số hóa đơn (nếu có)<input value={invoice} onChange={e => setInvoice(e.target.value)} className={`w-32 ${inputCls}`} /></label>
            <span className="min-w-[9rem] flex-1 text-right text-sm"><span className="block text-xs text-muted-foreground">{sel.length} phiếu · tiền hàng {money(net)}{vat && vat !== 'incl' ? ` + VAT ${money(vatAmt)}` : ''}</span>
              <span className={`text-lg ${NUM}`}>{money(net + vatAmt)} đ</span></span>
            <button type="button" className={secondaryBtn} disabled={!sel.length || busy || !data.can.record} onClick={() => void giveBack()}><Undo2 size={15} />Trả lại kho</button>
            <button type="button" className={primaryBtn} disabled={blockers.length > 0 || busy} title={blockers.join(' · ') || undefined} onClick={() => void post()}><BookCheck size={15} />Ghi công nợ</button>
            {blockers.length > 0 && sel.length > 0 && <span className="w-full text-right text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
          </div>
        </section>}
      </div>}
    {data.returned.length > 0 && <section className="rounded-2xl border border-border bg-card shadow-sm">
      <button type="button" onClick={() => setShowReturned(s => !s)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold">
        {showReturned ? <ChevronDown size={16} /> : <ChevronRight size={16} />}Đã trả lại kho, chờ kho sửa ({data.returned.length})</button>
      {showReturned && <ul className="divide-y divide-border border-t border-border">{data.returned.map(d => <li key={d.id} className="px-4 py-2.5 text-sm">
        <span className={ENT}>{d.id}</span> <span className="text-muted-foreground">· {d.supplierName} · {viDate(d.date)} · {d.projectCode || 'Kho công ty'}</span>
        <span className="block text-xs text-muted-foreground">Trả lại bởi {d.returned?.byName || '—'} {viDate(d.returned?.at)}: {d.returned?.reason}</span>
      </li>)}</ul>}
    </section>}
  </div>;
};
