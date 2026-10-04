import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, CircleSlash, Combine, Info, Layers } from 'lucide-react';
import { Badge, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, shortMoney } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { catalogErrorMessage, wmsCatalogService } from '../../lib/wmsCatalogService';
import { VERDICT_LABEL, isUsed, suggestKeep, verdictOf, type DuplicateGroup, type DuplicateVerdict } from '../../lib/wmsCatalogMerge';
import { BAD, GREY, OK, Panel, Section, WARN, dateVi, fmtQty } from './wmsUi';

// V1-3a: so một nhóm mã có thể trùng, chọn mã giữ rồi gộp — hoặc ghi "không phải trùng". Chỉ người Cấp mã thao tác.

export const VERDICT_CLS: Record<DuplicateVerdict, string> = { dup: OK, accent: WARN, unit: WARN, diffnum: GREY };

const Dialog: React.FC<{ title: string; sub?: React.ReactNode; onClose: () => void; foot: React.ReactNode; children: React.ReactNode }> = ({ title, sub, onClose, foot, children }) =>
  <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 px-4" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => e.key === 'Escape' && onClose()}>
    <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl">
      <h2 className="text-lg font-bold">{title}</h2>{sub && <p className={`mt-0.5 ${ENT}`}>{sub}</p>}
      <div className="mt-3 space-y-3 text-sm">{children}</div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">{foot}</div>
    </div></div>;

export const CatalogMergePanel: React.FC<{ group: DuplicateGroup; canMerge: boolean; onDone: (ids: string[]) => void; onBack: () => void; onOpenItem: (id: string) => void }> =
  ({ group, canMerge, onDone, onBack, onOpenItem }) => {
    const toast = useToast();
    const verdict = useMemo(() => verdictOf(group), [group]);
    const [keepId, setKeepId] = useState(() => suggestKeep(group).id);
    const [blockers, setBlockers] = useState<Record<string, string[]> | null>(null);
    const [unitOk, setUnitOk] = useState(false);
    const [ask, setAsk] = useState<'merge' | 'notdup' | null>(null);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const keep = group.items.find(i => i.id === keepId)!;
    const others = group.items.filter(i => i.id !== keepId);
    useEffect(() => {
      setBlockers(null);
      let live = true;
      wmsCatalogService.previewMerge(keepId, others.map(i => i.id)).then(b => { if (live) setBlockers(b); }).catch(() => { if (live) setBlockers({}); });
      return () => { live = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keepId, group.key]);
    const blocked = others.some(i => (blockers?.[i.id] || []).length > 0);
    const otherUnit = group.items.find(i => i.unit.trim().toLowerCase() !== group.items[0].unit.trim().toLowerCase())?.unit;
    const canSubmit = canMerge && verdict.v !== 'diffnum' && blockers !== null && !blocked && (verdict.v !== 'unit' || unitOk);
    const submit = async () => {
      setBusy(true);
      try {
        if (ask === 'merge') {
          const r = await wmsCatalogService.merge({ keepId, mergeIds: others.map(i => i.id), unitConfirmed: unitOk, note: text.trim() || undefined });
          toast.success('Đã gộp mã', `${others.map(i => i.sku).join(', ')} → ${keep.sku}${r.warehouses ? ` · chuyển tồn ${r.warehouses} kho` : ''}`);
        } else {
          await wmsCatalogService.dismissDuplicate({ itemIds: group.items.map(i => i.id), reason: text.trim() });
          toast.success('Đã ghi nhận', 'Nhóm này không hiện lại trong “Có thể trùng”.');
        }
        setAsk(null); setText(''); onDone(group.items.map(i => i.id));
      } catch (e) { toast.error('Chưa thực hiện được', catalogErrorMessage(e)); }
      finally { setBusy(false); }
    };

    return <Panel onBack={onBack}
      head={<div><p className="text-xs text-muted-foreground">Có thể trùng · {group.items.length} mã</p><h2 className={`text-lg ${ENT}`}>{keep.name}</h2>
        <span className="mt-1 flex flex-wrap items-center gap-1"><Badge className={VERDICT_CLS[verdict.v]}>{VERDICT_LABEL[verdict.v]}</Badge><span className="text-xs text-muted-foreground">{verdict.why}</span></span></div>}
      foot={canMerge ? <>
        <button type="button" className={secondaryBtn} disabled={busy} onClick={() => { setText(''); setAsk('notdup'); }}><CircleSlash size={15} />Không phải trùng</button>
        {verdict.v !== 'diffnum' && <button type="button" className={primaryBtn} disabled={busy || !canSubmit} onClick={() => { setText(''); setAsk('merge'); }}><Combine size={15} />Gộp vào {keep.sku}</button>}
      </> : <span className="text-xs text-muted-foreground">Chỉ người có ô quyền “Cấp mã” gộp mã.</span>}>
      {verdict.v === 'diffnum' && <div className={`rounded-xl border px-3 py-2 text-sm ${GREY}`}><b>Khác số kích thước</b> — là vật tư khác, không gộp. Bấm “Không phải trùng” để không hiện lại.</div>}
      {verdict.v === 'unit' && <div className={`rounded-xl border px-3 py-2 text-sm ${WARN}`}><b>Khác đơn vị tính.</b> Chỉ gộp khi 1 {group.items[0].unit} = 1 {otherUnit}. Nếu “Bộ” gồm bulong + đai ốc + long đen còn “Cái” chỉ là con bulong → hai vật tư khác nhau, bấm <b>Không phải trùng</b>.
        {canMerge && <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" className="h-4 w-4 accent-teal-600" checked={unitOk} onChange={e => setUnitOk(e.target.checked)} />Tôi đã kiểm: cùng một vật tư, số lượng tính như nhau</label>}</div>}
      {verdict.v === 'accent' && <div className={`rounded-xl border px-3 py-2 text-sm ${WARN}`}><b>Tên khác nhau ở chữ / dấu.</b> “Bu lông” với “Bulong” là cùng vật tư; nhưng “nhỏ / nhỡ”, “Tụ / Tủ” là vật tư khác. Đọc kỹ trước khi gộp.</div>}
      <Section title="Chọn mã giữ lại" right={<span className="text-xs text-muted-foreground">gợi ý: mã có kế hoạch / đơn mua / tồn</span>}>
        <div className="space-y-2">{group.items.map(i => { const isKeep = i.id === keepId; const b = blockers?.[i.id] || [];
          return <label key={i.id} className={`block rounded-xl border p-3 ${canMerge ? 'cursor-pointer' : ''} ${isKeep ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'}`}>
            <span className="flex items-start gap-2"><input type="radio" name={`keep-${group.key}`} className="mt-1 h-4 w-4 accent-teal-600" disabled={!canMerge} checked={isKeep} onChange={() => setKeepId(i.id)} />
              <span className="min-w-0 flex-1">
                <button type="button" onClick={e => { e.preventDefault(); onOpenItem(i.id); }} className={`${ENT} hover:underline`}>{i.sku}</button> · {i.name} <Badge className={GREY}>{i.unit}</Badge>
                {isKeep ? <Badge className={OK}>giữ</Badge> : <Badge className={GREY}>gộp vào mã giữ</Badge>}
                <span className="mt-1.5 grid grid-cols-3 gap-1.5 text-xs sm:grid-cols-6">
                  {([['Sổ kho', i.usage.ledger], ['Phiếu', i.usage.transactions], ['Đơn mua', i.usage.purchaseOrders], ['Đề xuất', i.usage.requests], ['BOQ / KH', i.plan]] as const).map(([l, n]) =>
                    <span key={l} className="rounded-lg bg-muted/60 px-2 py-1"><span className="block text-muted-foreground">{l}</span><span className={n ? NUM : 'text-muted-foreground'}>{n}</span></span>)}
                  <span className="rounded-lg bg-muted/60 px-2 py-1"><span className="block text-muted-foreground">Dùng cuối</span>{i.lastUsed ? dateVi(i.lastUsed) : <span className="text-muted-foreground">chưa</span>}</span>
                </span>
                <span className="mt-1.5 block text-xs">{i.stock.length === 0 ? <span className="text-muted-foreground">Không có tồn.</span> : i.stock.map(s => <span key={s.warehouseId} className="mr-3">{s.warehouseName}: <span className={NUM}>{fmtQty(Number(s.qty))}</span> {i.unit} · {Number(s.value) > 0 ? <span className={NUM}>{shortMoney(Number(s.value))}</span> : Number(s.qty) > 0 ? <span className="font-semibold text-amber-700 dark:text-amber-300">chưa có giá</span> : <span className="font-semibold text-rose-700">giá trị treo {shortMoney(Number(s.value))}</span>}</span>)}</span>
                {!isKeep && blockers === null && <span className="mt-1.5 block text-xs text-muted-foreground">Đang kiểm chứng từ mở…</span>}
                {!isKeep && b.length > 0 && <span className={`mt-1.5 block rounded-lg border px-2 py-1 text-xs ${BAD}`}>Chưa gộp được: {b.join('; ')}. Xử lý xong (hoặc đổi dòng sang mã giữ) rồi gộp.</span>}
                {!isKeep && !isUsed(i) && <span className="mt-1.5 block text-xs text-muted-foreground">Mã thừa, chưa dùng lần nào — gộp = ngừng dùng và chuyển hướng tìm kiếm.</span>}
              </span></span></label>; })}</div>
      </Section>
      {verdict.v !== 'diffnum' && <Section title={`Khi gộp vào ${keep.sku}`}>
        <ul className="space-y-1.5 rounded-xl border border-border p-3 text-sm">{others.map(i => <React.Fragment key={i.id}>
          {i.stock.filter(s => Number(s.qty) > 0).map(s => <li key={s.warehouseId} className="flex gap-2"><ArrowRightLeft size={15} className="mt-0.5 shrink-0 text-teal-700" />
            <span>Phiếu điều chỉnh ở {s.warehouseName}: xuất <span className={NUM}>{fmtQty(Number(s.qty))}</span> {i.unit} khỏi {i.sku}, nhập vào {keep.sku},{' '}
              {Number(s.value) > 0 ? <>giữ nguyên giá trị <b>{shortMoney(Number(s.value))}</b>.</> : <>chưa có giá — kế toán kho bổ sung sau.</>}</span></li>)}
          {i.plan > 0 && <li className="flex gap-2"><Layers size={15} className="mt-0.5 shrink-0 text-teal-700" /><span>{i.plan} dòng BOQ / kế hoạch vật tư chuyển sang {keep.sku}.</span></li>}
          {i.usage.ledger + i.usage.transactions + i.usage.purchaseOrders > 0 && <li className="flex gap-2"><Info size={15} className="mt-0.5 shrink-0 text-teal-700" />
            <span>Lịch sử của {i.sku} ({i.usage.ledger} dòng sổ, {i.usage.transactions} phiếu, {i.usage.purchaseOrders} đơn mua) <b>giữ nguyên</b>; thẻ kho {keep.sku} hiện kèm, ghi “từ {i.sku}”.</span></li>}
          <li className="flex gap-2"><CircleSlash size={15} className="mt-0.5 shrink-0 text-slate-500" /><span>{i.sku} thành “Đã gộp vào {keep.sku}”. Gõ tìm {i.sku} hoặc tên cũ sẽ ra {keep.sku}.</span></li>
        </React.Fragment>)}</ul>
      </Section>}
      {ask && <Dialog title={ask === 'merge' ? `Gộp vào ${keep.sku}?` : 'Không phải trùng?'} sub={group.items.map(i => i.sku).join(' / ')} onClose={() => !busy && setAsk(null)}
        foot={<><button type="button" className={secondaryBtn} disabled={busy} onClick={() => setAsk(null)}>Không</button>
          <button type="button" className={primaryBtn} disabled={busy || (ask === 'notdup' && !text.trim())} onClick={() => void submit()}>{busy ? 'Đang lưu…' : ask === 'merge' ? 'Gộp' : 'Ghi nhận'}</button></>}>
        {ask === 'merge' ? <>
          <p>{others.map(i => i.sku).join(', ')} sẽ thành “Đã gộp”. Không xóa lịch sử, không sửa phiếu cũ. Tồn chuyển bằng phiếu điều chỉnh có ghi sổ.</p>
          <p className={`rounded-xl border px-3 py-2 text-xs ${WARN}`}>Không hoàn tác bằng một nút. Nếu gộp nhầm: cấp lại mã và lập phiếu chuyển ngược.</p>
          <label className="block font-medium">Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span><input value={text} onChange={e => setText(e.target.value)} className={`mt-1 w-full ${inputCls}`} placeholder="VD: cùng bulong móng, nhập 2 lần với 2 tên" /></label>
        </> : <>
          <p>Nhóm này sẽ không hiện lại trong “Có thể trùng”.</p>
          <label className="block font-medium">Vì sao khác nhau? <span className="text-rose-600">*</span><input autoFocus value={text} onChange={e => setText(e.target.value)} className={`mt-1 w-full ${inputCls}`} placeholder="VD: Bộ gồm bulong + đai ốc + long đen" /></label>
        </>}
      </Dialog>}
    </Panel>;
  };
