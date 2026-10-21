import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CircleSlash, GitMerge, Loader2, PencilLine, Plus, RotateCcw } from 'lucide-react';
import { Badge, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { NUM } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { specKey } from '../../lib/materialLineDescription';
import {
  SPEC_RETIRE_REASONS, SPEC_SOURCE_LABELS, itemSpecErrorMessage, itemSpecService, specSizeConflict, type ItemSpec, type ItemSpecAction,
} from '../../lib/itemSpecService';
import { GREY, Section, TEAL, WARN, dateVi, fmtQty } from './wmsUi';

// Danh sách quy cách chuẩn của một mã (doc 13 mục 9.3, 16.3). Người Cấp mã: Giữ / Sửa chữ / Gộp vào… / Ngừng dùng / Dùng lại.
// Sửa chữ, gộp: tồn chuyển sang quy cách mới bằng phiếu chuyển quy cách; tên cũ giữ làm "tên khác".

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'mới · chờ rà', cls: TEAL }, active: { label: 'đang dùng', cls: GREY }, retired: { label: 'ngừng dùng', cls: GREY },
};
// Cỡ chữ 12px thay cho text-xs: index.css ép text-xs trong khung lưới thành một dòng trên mobile.
const SMALL = 'text-[12px]';

type Mode = { id: string; kind: 'rename' | 'merge' | 'retire'; value: string } | null;

export const ItemSpecsSection: React.FC<{ itemId: string; itemName: string; unit: string | null; focusId?: string | null; onChanged?: () => void }> = ({ itemId, itemName, unit, focusId, onChanged }) => {
  const toast = useToast();
  const [data, setData] = useState<{ canManage: boolean; specs: ItemSpec[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    itemSpecService.list(itemId).then(setData).catch(e => setError(itemSpecErrorMessage(e)));
  }, [itemId]);
  useEffect(load, [load]);

  const specs = data?.specs || [];
  const live = specs.filter(s => s.status !== 'retired');
  const addDup = useMemo(() => {
    const k = specKey(adding);
    return k ? specs.find(s => specKey(s.name) === k || s.aliases.some(a => specKey(a) === k)) : undefined;
  }, [adding, specs]);

  const run = async (input: ItemSpecAction, done: string) => {
    setBusy(true); setProblem(null);
    try {
      const r = await itemSpecService.manage(input);
      toast.success(done, r.moved ? `Đã chuyển tồn ${r.moved} kho sang quy cách mới bằng phiếu chuyển quy cách.` : undefined);
      setMode(null); setAdding(''); load(); onChanged?.();
    } catch (e) { setProblem(itemSpecErrorMessage(e)); } finally { setBusy(false); }
  };

  if (error) return <Section title="Quy cách"><p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p></Section>;
  if (!data) return <Section title="Quy cách"><p className="text-sm text-muted-foreground">Đang tải quy cách…</p></Section>;
  const can = data.canManage;

  return <Section title="Quy cách" right={<span className={`${SMALL} text-muted-foreground`}>tồn của mã = cộng các quy cách</span>}>
    {specs.length === 0 && <p className="text-sm text-muted-foreground">Mã chưa có quy cách. {can ? 'Thêm khi cùng mã có nhiều loại thay được cho nhau (thương hiệu, màu, cách đóng gói…).' : ''}</p>}
    {specs.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border text-sm">{specs.map(s => {
      const stock = s.stock.filter(x => Math.abs(Number(x.qty)) > 0.0000005);
      const size = s.status === 'pending' ? specSizeConflict(itemName, s.name) : null;
      const open = mode?.id === s.id ? mode : null;
      // Máy chủ chặn ngừng dùng khi còn tồn / đang về (mục 16.3) — khóa nút ngay, ghi rõ lý do.
      const retireBlock = [stock.some(x => Number(x.qty) > 0) ? `còn tồn ${stock.filter(x => Number(x.qty) > 0).map(x => `${x.warehouseName} ${fmtQty(Number(x.qty))}`).join(', ')}` : '',
        Number(s.incoming) > 0 ? `còn hàng đang về ${fmtQty(Number(s.incoming))}${unit ? ` ${unit}` : ''}` : ''].filter(Boolean).join('; ');
      return <li key={s.id} className={`px-3 py-2 ${focusId === s.id ? 'bg-teal-50/70 dark:bg-teal-950/30' : ''}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`min-w-0 font-medium ${s.status === 'retired' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{s.name}</span>
          <Badge className={STATUS[s.status]?.cls || GREY}>{STATUS[s.status]?.label || s.status}</Badge>
          {size && <Badge className={WARN}>khác kích thước?</Badge>}
          <span className={`ml-auto ${SMALL} text-muted-foreground`}>{stock.length ? stock.map(x => `${x.warehouseName} ${fmtQty(Number(x.qty))}`).join(' · ') : 'không tồn'}
            {Number(s.incoming) > 0 && <> · đang về <span className={NUM}>{fmtQty(Number(s.incoming))}</span></>}{unit && (stock.length || Number(s.incoming) > 0) ? ` ${unit}` : ''}</span>
        </div>
        <p className={`${SMALL} text-muted-foreground`}>
          {SPEC_SOURCE_LABELS[s.source]}{s.createdByName ? ` · ${s.createdByName}` : ''} · {dateVi(s.createdAt)} · {s.orders} dòng đơn mua
          {s.aliases.length > 0 && <> · tên khác: {s.aliases.join(', ')}</>}
          {s.status === 'retired' && s.note && <> · {s.note}</>}
          {s.reviewedByName && s.status !== 'pending' && <> · rà: {s.reviewedByName} {dateVi(s.reviewedAt)}</>}</p>
        {size && <p className={`${SMALL} text-amber-700 dark:text-amber-300`}><AlertTriangle size={12} className="mr-1 inline" />{size}</p>}

        {can && !open && <div className="mt-1.5 flex flex-wrap gap-1.5">
          {s.status === 'pending' && <button type="button" disabled={busy} className={`${secondaryBtn} py-1 ${SMALL}`} onClick={() => void run({ action: 'approve', specId: s.id }, `Giữ quy cách “${s.name}”`)}><Check size={14} />Giữ</button>}
          {s.status !== 'retired' && <>
            <button type="button" disabled={busy} className={`${secondaryBtn} py-1 ${SMALL}`} onClick={() => { setProblem(null); setMode({ id: s.id, kind: 'rename', value: s.name }); }}><PencilLine size={14} />Sửa chữ</button>
            {live.length > 1 && <button type="button" disabled={busy} className={`${secondaryBtn} py-1 ${SMALL}`} onClick={() => { setProblem(null); setMode({ id: s.id, kind: 'merge', value: live.find(o => o.id !== s.id)?.id || '' }); }}><GitMerge size={14} />Gộp vào…</button>}
            <button type="button" disabled={busy} className={`${secondaryBtn} py-1 ${SMALL}`} onClick={() => { setProblem(null); setMode({ id: s.id, kind: 'retire', value: s.status === 'pending' ? SPEC_RETIRE_REASONS[0] : '' }); }}><CircleSlash size={14} />Ngừng dùng</button>
          </>}
          {s.status === 'retired' && <button type="button" disabled={busy} className={`${secondaryBtn} py-1 ${SMALL}`} onClick={() => void run({ action: 'reactivate', specId: s.id }, `Dùng lại “${s.name}”`)}><RotateCcw size={14} />Dùng lại</button>}
        </div>}

        {open && <div className="mt-2 space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-2 dark:border-teal-900 dark:bg-teal-950/20">
          {open.kind === 'rename' && <label className="block"><span className={`block ${SMALL} font-semibold text-muted-foreground`}>Tên đúng</span>
            <input autoFocus value={open.value} maxLength={80} onChange={e => setMode({ ...open, value: e.target.value })} className={`mt-1 w-full ${inputCls}`} />
            {stock.length > 0 && specKey(open.value) !== specKey(s.name) && <span className={`mt-1 block ${SMALL} text-muted-foreground`}>Tồn {stock.map(x => `${x.warehouseName} ${fmtQty(Number(x.qty))}`).join(', ')} sẽ chuyển sang tên mới bằng phiếu chuyển quy cách.</span>}</label>}
          {open.kind === 'merge' && <label className="block"><span className={`block ${SMALL} font-semibold text-muted-foreground`}>Gộp “{s.name}” vào</span>
            <select value={open.value} onChange={e => setMode({ ...open, value: e.target.value })} className={`mt-1 w-full ${inputCls}`}>
              {live.filter(o => o.id !== s.id).map(o => <option key={o.id} value={o.id}>{o.name}{o.status === 'pending' ? ' (mới)' : ''}</option>)}</select>
            <span className={`mt-1 block ${SMALL} text-muted-foreground`}>“{s.name}” thành tên khác của quy cách giữ{stock.length ? '; tồn chuyển sang quy cách giữ' : ''}. Chứng từ cũ giữ nguyên chữ đã ghi.</span></label>}
          {open.kind === 'retire' && <div>
            <span className={`block ${SMALL} font-semibold text-muted-foreground`}>Lý do ngừng dùng</span>
            <div className="mt-1 flex flex-wrap gap-1">{SPEC_RETIRE_REASONS.map(x => <button key={x} type="button" onClick={() => setMode({ ...open, value: x })}
              className={`rounded-full border px-2 py-0.5 ${SMALL} ${open.value === x ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card hover:bg-muted'}`}>{x}</button>)}</div>
            <input value={open.value} onChange={e => setMode({ ...open, value: e.target.value })} placeholder="Hoặc ghi lý do khác" className={`mt-1 w-full ${inputCls}`} />
            {retireBlock && <span className={`mt-1 block ${SMALL} text-amber-700 dark:text-amber-300`}>Chưa ngừng dùng được: {retireBlock}. Gộp vào quy cách khác, hoặc giữ đến khi hết.</span>}</div>}
          {problem && <p role="alert" className={`${SMALL} text-rose-700 dark:text-rose-300`}>{problem}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setMode(null)}>Hủy</button>
            <button type="button" className={primaryBtn} disabled={busy || !open.value.trim() || (open.kind === 'retire' && !!retireBlock)} onClick={() => void run(
              open.kind === 'rename' ? { action: 'rename', specId: s.id, name: open.value.trim() }
                : open.kind === 'merge' ? { action: 'merge', specId: s.id, targetId: open.value }
                : { action: 'retire', specId: s.id, reason: open.value.trim() },
              open.kind === 'rename' ? 'Đã sửa chữ quy cách' : open.kind === 'merge' ? 'Đã gộp quy cách' : `Ngừng dùng “${s.name}”`)}>
              {busy && <Loader2 size={15} className="animate-spin" />}{open.kind === 'rename' ? 'Lưu tên' : open.kind === 'merge' ? 'Gộp' : 'Ngừng dùng'}</button>
          </div>
        </div>}
      </li>; })}</ul>}

    {can && <div className="mt-2">
      <div className="flex gap-2">
        <input value={adding} onChange={e => { setAdding(e.target.value); setProblem(null); }} maxLength={80} placeholder="Thêm quy cách — VD Hòa Phát CB300" aria-label="Thêm quy cách"
          className={`min-w-0 flex-1 ${inputCls}`} onKeyDown={e => { if (e.key === 'Enter' && adding.trim() && (!addDup || addDup.status !== 'active')) void run({ action: 'add', itemId, name: adding.trim() }, `Đã thêm quy cách “${adding.trim()}”`); }} />
        <button type="button" className={secondaryBtn} disabled={busy || !adding.trim() || addDup?.status === 'active'}
          onClick={() => void run({ action: 'add', itemId, name: adding.trim() }, `Đã thêm quy cách “${adding.trim()}”`)}><Plus size={15} />{addDup && addDup.status !== 'active' ? 'Dùng lại' : 'Thêm'}</button>
      </div>
      {adding.trim() && addDup && <p className={`mt-1 ${SMALL} ${addDup.status === 'active' ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'}`}>
        {addDup.status === 'active' ? `Trùng “${addDup.name}” đã có (so sau khi bỏ dấu, dấu cách, x/*).` : `Đã có “${addDup.name}” (${STATUS[addDup.status]?.label}) — bấm để đưa vào dùng.`}</p>}
      {adding.trim() && !addDup && specSizeConflict(itemName, adding) && <p className={`mt-1 ${SMALL} text-amber-700 dark:text-amber-300`}>{specSizeConflict(itemName, adding)}</p>}
      {!mode && problem && <p role="alert" className={`mt-1 ${SMALL} text-rose-700 dark:text-rose-300`}>{problem}</p>}
    </div>}
    {!can && specs.some(s => s.status === 'pending') && <p className={`mt-1 ${SMALL} text-muted-foreground`}>Quy cách mới do Mua hàng / thủ kho gõ — người có ô quyền “Cấp mã” rà.</p>}
  </Section>;
};
