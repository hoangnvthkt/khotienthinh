import React, { useMemo, useRef, useState } from 'react';
import { Camera, FileText, Loader2, PackagePlus, Search, X } from 'lucide-react';
import { Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, moneyInput, parseMoney } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { officeSupplyService, searchVpp, vppErrorMessage, type VppHome, type VppReceiptLine } from '../../lib/officeSupplyService';
import { foldVi } from '../../lib/wmsCatalogService';

// Thủ kho nhập VPP mua về: chọn món (có mã hoặc món mới → tự cấp mã VPPnnn), số lượng, đơn giá, ảnh hóa đơn bắt buộc.

const key = () => Math.random().toString(36).slice(2);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const UNITS = ['Cái', 'Hộp', 'Gam', 'Tệp', 'Quyển', 'Cuộn', 'Đôi', 'Viên', 'Lọ', 'Gói', 'Bộ'];

export const VppReceiveForm: React.FC<{ home: VppHome; actorUserId: string; onClose: () => void; onSaved: () => void }> = ({ home, actorUserId, onClose, onSaved }) => {
  const toast = useToast();
  const [lines, setLines] = useState<VppReceiptLine[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [newUnit, setNewUnit] = useState('Cái');
  const [date, setDate] = useState(today());
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const found = useMemo(() => searchVpp(q, home.catalog, [], 10), [q, home.catalog]);
  const exact = found.coded.some(c => foldVi(c.name) === foldVi(q.trim()));

  const add = (l: Omit<VppReceiptLine, 'key' | 'qty' | 'price'>) => {
    setLines(ls => ls.some(x => l.itemId ? x.itemId === l.itemId : !x.itemId && foldVi(x.name) === foldVi(l.name)) ? ls : [...ls, { ...l, key: key(), qty: 1, price: 0 }]);
    setQ('');
  };
  const set = (k: string, patch: Partial<VppReceiptLine>) => setLines(ls => ls.map(l => l.key === k ? { ...l, ...patch } : l));
  const priced = lines.map(l => ({ ...l, price: parseMoney(prices[l.key] ?? '') }));
  const total = priced.reduce((s, l) => s + (Number.isFinite(l.price) ? l.price * l.qty : 0), 0);
  const problem = !lines.length ? 'Chọn ít nhất một món'
    : priced.some(l => !(l.qty > 0)) ? 'Số lượng phải lớn hơn 0'
    : priced.some(l => !Number.isFinite(l.price) || l.price <= 0) ? 'Nhập đơn giá cho mọi món'
    : !files.length ? 'Đính kèm ảnh hóa đơn' : null;

  const submit = async () => {
    if (problem) return;
    setBusy(true);
    try {
      const r = await officeSupplyService.receive({ date, supplierName: supplier.trim(), invoiceNo: invoice.trim(), note: note.trim(), lines: priced, files, actorUserId });
      const created = r.newItems.length ? ` · mã mới ${r.newItems.map(n => n.sku).join(', ')}` : '';
      if (r.filesError) toast.error(`Đã nhập kho ${r.code || ''} nhưng chưa lưu được ảnh`.trim(), r.filesError);
      else toast.success('Đã nhập kho VPP', `${r.code || ''} · ${money(total)} đ${created}`);
      onSaved();
    } catch (e) {
      toast.error('Chưa nhập được kho', vppErrorMessage(e));
    } finally { setBusy(false); }
  };

  return <Drawer label="Nhập VPP" wide onClose={onClose}
    header={<div><p className="text-[12px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{home.warehouseName || 'Kho VPP'}</p>
      <h2 className="text-lg font-bold">Nhập VPP mua về</h2></div>}
    footer={<>
      <span className="mr-auto text-sm">Tổng <b className={NUM}>{money(total)}</b> đ</span>
      <button type="button" onClick={onClose} className={`${secondaryBtn} flex-1 md:flex-none`}>Đóng</button>
      <button type="button" onClick={submit} disabled={!!problem || busy} title={problem || undefined} className={`${primaryBtn} flex-1 md:flex-none`}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}Nhập kho</button>
    </>}>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="block text-sm font-semibold">Ngày chứng từ<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="block text-sm font-semibold">Nơi mua<input value={supplier} onChange={e => setSupplier(e.target.value)} maxLength={200} placeholder="Tên cửa hàng / NCC" className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="block text-sm font-semibold">Số hóa đơn<input value={invoice} onChange={e => setInvoice(e.target.value)} maxLength={60} className={`mt-1 w-full ${inputCls}`} /></label>
    </div>

    <div className="relative">
      <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-teal-500/40">
        <Search size={16} className="text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Thêm món — gõ tên hoặc mã VPP" aria-label="Tìm VPP" className="w-full bg-transparent py-2.5 text-sm outline-none" />
      </label>
      {q.trim() && <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-card py-1 shadow-lg">
        {found.coded.map(c => <li key={c.itemId}><button type="button" onClick={() => add({ itemId: c.itemId, name: c.name, unit: c.unit })}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
          <span className="font-mono text-[12px] text-muted-foreground">{c.sku}</span><span className={`min-w-0 flex-1 truncate ${ENT}`}>{c.name}</span>
          <span className="text-xs text-muted-foreground">{c.unit}</span></button></li>)}
        {!exact && <li className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button type="button" onClick={() => add({ itemId: null, name: q.trim().replace(/\s+/g, ' '), unit: newUnit })}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-teal-700 dark:text-teal-300">
            <PackagePlus size={15} /><span className="truncate">Mã mới: “{q.trim()}”</span></button>
          <select value={newUnit} onChange={e => setNewUnit(e.target.value)} aria-label="Đơn vị món mới" className={`${inputCls} py-1 text-[12px]`}>
            {UNITS.map(u => <option key={u}>{u}</option>)}</select>
        </li>}
      </ul>}
    </div>

    {lines.length > 0 && <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-[12px] text-muted-foreground"><tr>
          <th className="px-3 py-2 text-left font-semibold">Món</th><th className="px-2 py-2 text-right font-semibold">SL</th>
          <th className="px-2 py-2 text-right font-semibold">Đơn giá</th><th className="px-2 py-2 text-right font-semibold">Thành tiền</th><th />
        </tr></thead>
        <tbody className="divide-y divide-border">{priced.map(l => <tr key={l.key}>
          <td className="px-3 py-2"><p className={l.itemId ? ENT : 'font-semibold'}>{l.name}</p>
            <p className="text-[12px] text-muted-foreground">{l.itemId ? home.catalog.find(c => c.itemId === l.itemId)?.sku : 'Mã mới'} · {l.unit}</p></td>
          <td className="px-2 py-2 text-right"><input inputMode="decimal" value={l.qty || ''} onChange={e => set(l.key, { qty: Number(e.target.value.replace(',', '.')) || 0 })}
            aria-label={`Số lượng ${l.name}`} className={`w-16 ${inputCls} text-right text-[13px] tabular-nums`} /></td>
          <td className="px-2 py-2 text-right"><input inputMode="numeric" value={prices[l.key] ?? ''} onChange={e => setPrices(p => ({ ...p, [l.key]: e.target.value }))}
            onBlur={() => { const n = parseMoney(prices[l.key] ?? ''); if (Number.isFinite(n)) setPrices(p => ({ ...p, [l.key]: moneyInput(n) })); }}
            aria-label={`Đơn giá ${l.name}`} className={`w-24 ${inputCls} text-right text-[13px] tabular-nums`} /></td>
          <td className={`px-2 py-2 text-right ${NUM}`}>{Number.isFinite(l.price) ? money(l.price * l.qty) : '—'}</td>
          <td className="px-1"><button type="button" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={`Bỏ ${l.name}`} className="p-1 text-muted-foreground hover:text-rose-600"><X size={15} /></button></td>
        </tr>)}</tbody>
      </table>
    </div>}

    <div>
      <p className="text-sm font-semibold">Ảnh hóa đơn</p>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
        onChange={e => { const f = Array.from(e.target.files || []); setFiles(x => [...x, ...f]); e.target.value = ''; }} />
      <div className="mt-1 flex flex-wrap gap-2">
        {files.map((f, i) => <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[13px]">
          <FileText size={14} className="text-teal-700" /><span className="max-w-[12rem] truncate">{f.name}</span>
          <button type="button" onClick={() => setFiles(x => x.filter((_, j) => j !== i))} aria-label={`Bỏ ${f.name}`} className="text-muted-foreground hover:text-rose-600"><X size={13} /></button></span>)}
        <button type="button" onClick={() => fileRef.current?.click()} className={secondaryBtn}><Camera size={15} />Chụp / chọn ảnh</button>
      </div>
    </div>
    <label className="block text-sm font-semibold">Ghi chú<input value={note} onChange={e => setNote(e.target.value)} maxLength={200} className={`mt-1 w-full ${inputCls}`} /></label>
  </Drawer>;
};
