import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Minus, PackagePlus, Plus, Search, Send, X } from 'lucide-react';
import { Drawer, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { officeSupplyService, searchVpp, vppErrorMessage, type VppDetail, type VppDraftLine, type VppHome } from '../../lib/officeSupplyService';
import { foldVi } from '../../lib/wmsCatalogService';

// Đề xuất VPP: gõ tên → chọn món có mã hoặc thêm món chưa có mã; chỉnh số lượng; gửi. Không hiện giá (người đề xuất không cần).

const key = () => Math.random().toString(36).slice(2);
const UNITS = ['Cái', 'Hộp', 'Gam', 'Tệp', 'Quyển', 'Cuộn', 'Đôi', 'Viên', 'Lọ', 'Gói', 'Bộ'];

export const VppRequestForm: React.FC<{ home: VppHome; editing?: VppDetail | null; onClose: () => void; onSaved: (d: VppDetail) => void }> = ({ home, editing, onClose, onSaved }) => {
  const toast = useToast();
  const [lines, setLines] = useState<VppDraftLine[]>(() => editing
    ? editing.lines.map(l => ({ key: key(), itemId: l.itemId, name: l.name, unit: l.unit, qty: l.requestedQty, note: l.note || undefined }))
    : []);
  const [note, setNote] = useState(editing?.note || '');
  const [q, setQ] = useState('');
  const [newUnit, setNewUnit] = useState('Cái');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const found = useMemo(() => searchVpp(q, home.catalog, home.uncoded), [q, home.catalog, home.uncoded]);
  const stock = useMemo(() => new Map(home.catalog.map(c => [c.itemId, c])), [home.catalog]);
  const exact = q.trim() && (found.coded.some(c => foldVi(c.name) === foldVi(q.trim())) || found.uncoded.some(u => foldVi(u.name) === foldVi(q.trim())));

  const add = (l: Omit<VppDraftLine, 'key' | 'qty'>) => {
    setLines(ls => {
      const i = ls.findIndex(x => (l.itemId ? x.itemId === l.itemId : !x.itemId && foldVi(x.name) === foldVi(l.name)));
      if (i >= 0) return ls.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x);
      return [...ls, { ...l, key: key(), qty: 1 }];
    });
    setQ('');
    inputRef.current?.focus();
  };
  const setQty = (k: string, qty: number) => setLines(ls => ls.map(l => l.key === k ? { ...l, qty: Math.max(0, qty) } : l));
  const valid = lines.length > 0 && lines.every(l => l.qty > 0);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const d = await officeSupplyService.save({ id: editing?.id, expectedRowVersion: editing?.rowVersion, note: note.trim(), lines });
      toast.success(editing ? 'Đã gửi lại đề xuất' : 'Đã gửi đề xuất VPP', `${d.code} · ${d.approverName ? `chờ ${d.approverName} duyệt` : 'chờ quản trị VPP duyệt thay'}`);
      onSaved(d);
    } catch (e) {
      toast.error('Chưa gửi được đề xuất', vppErrorMessage(e));
    } finally { setBusy(false); }
  };

  return <Drawer label="Đề xuất VPP" onClose={onClose}
    header={<div><p className="text-[12px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{home.warehouseName || 'Kho VPP'}</p>
      <h2 className="text-lg font-bold">{editing ? `Sửa đề xuất ${editing.code}` : 'Đề xuất VPP'}</h2></div>}
    footer={<>
      <button type="button" onClick={onClose} className={`${secondaryBtn} flex-1 md:flex-none`}>Đóng</button>
      <button type="button" onClick={submit} disabled={!valid || busy} title={!lines.length ? 'Chọn ít nhất một món' : !valid ? 'Số lượng phải lớn hơn 0' : undefined}
        className={`${primaryBtn} flex-1 md:flex-none`}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{editing ? 'Gửi lại' : 'Gửi đề xuất'}</button>
    </>}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-muted/60 px-3 py-2 text-sm">
      <span>Phòng: <b className={ENT}>{home.me.orgUnitName || '—'}</b></span>
      {home.me.approverName
        ? <span>Người duyệt: <b className={ENT}>{home.me.approverName}</b></span>
        : <span className="inline-flex items-center gap-1 font-semibold text-rose-700 dark:text-rose-300" title="Quản trị VPP sẽ duyệt thay. Báo HCNS đặt người duyệt cho phòng bạn.">
          <AlertTriangle size={14} />Chưa có người duyệt</span>}
    </div>

    <div className="relative">
      <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-teal-500/40">
        <Search size={16} className="text-muted-foreground" />
        <input ref={inputRef} autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Gõ tên VPP: giấy A4, bút bi, ghim…" aria-label="Tìm VPP"
          className="w-full bg-transparent py-2.5 text-[15px] outline-none" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Xóa ô tìm" className="text-muted-foreground"><X size={15} /></button>}
      </label>
      {q.trim() && <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-border bg-card py-1 shadow-lg">
        {found.coded.map(c => <li key={c.itemId}><button type="button" onClick={() => add({ itemId: c.itemId, name: c.name, unit: c.unit })}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
          <span className={`min-w-0 flex-1 truncate ${ENT}`}>{c.name}</span>
          {!c.inStock && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Hết hàng</span>}
          <span className="text-xs text-muted-foreground">{c.unit}</span></button></li>)}
        {found.uncoded.map(u => <li key={`u-${u.name}`}><button type="button" onClick={() => add({ itemId: null, name: u.name, unit: u.unit })}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
          <span className="min-w-0 flex-1 truncate">{u.name}</span>
          <span className="rounded-full border border-border px-2 text-[11px] text-muted-foreground">Chưa có mã</span>
          <span className="text-xs text-muted-foreground">{u.unit}</span></button></li>)}
        {!exact && <li className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button type="button" onClick={() => add({ itemId: null, name: q.trim().replace(/\s+/g, ' '), unit: newUnit })}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-teal-700 dark:text-teal-300">
            <PackagePlus size={15} /><span className="truncate">Thêm “{q.trim()}”</span></button>
          <select value={newUnit} onChange={e => setNewUnit(e.target.value)} aria-label="Đơn vị món mới" className={`${inputCls} py-1 text-[12px]`}>
            {UNITS.map(u => <option key={u}>{u}</option>)}</select>
        </li>}
      </ul>}
    </div>

    {lines.length === 0
      ? <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Chưa chọn món nào</div>
      : <ul className="divide-y divide-border rounded-xl border border-border">
        {lines.map(l => {
          const c = l.itemId ? stock.get(l.itemId) : null;
          return <li key={l.key} className="flex items-center gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm ${l.itemId ? ENT : 'font-semibold'}`}>{l.name}</p>
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">{l.unit}
                {!l.itemId && <span className="rounded-full border border-border px-1.5 text-[11px]">Chưa có mã</span>}
                {c && !c.inStock && <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Hết hàng</span>}</p>
            </div>
            <div className="flex items-center rounded-lg border border-border">
              <button type="button" onClick={() => setQty(l.key, l.qty - 1)} disabled={l.qty <= 1} aria-label={`Bớt ${l.name}`} className="grid h-9 w-9 place-items-center disabled:opacity-40"><Minus size={14} /></button>
              <input inputMode="decimal" value={l.qty || ''} onChange={e => setQty(l.key, Number(e.target.value.replace(',', '.')) || 0)} aria-label={`Số lượng ${l.name}`}
                className="h-9 w-12 bg-transparent text-center text-[15px] font-semibold tabular-nums outline-none" />
              <button type="button" onClick={() => setQty(l.key, l.qty + 1)} aria-label={`Thêm ${l.name}`} className="grid h-9 w-9 place-items-center"><Plus size={14} /></button>
            </div>
            <button type="button" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={`Bỏ ${l.name}`} className="p-1 text-muted-foreground hover:text-rose-600"><X size={16} /></button>
          </li>;
        })}
      </ul>}

    <label className="block text-sm font-semibold">Ghi chú
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Dùng cho việc gì, cần trước ngày nào…" className={`mt-1 w-full ${inputCls}`} /></label>
  </Drawer>;
};
