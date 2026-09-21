import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Loader2, PackageOpen, RefreshCcw, ShieldCheck, Truck, Users, X, type LucideIcon } from 'lucide-react';
import type { InventoryItem, Warehouse } from '../types';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { sanitizeQuantityInput, parseQuantityInput } from '../lib/quantityInput';
import { wmsWorkspaceService, type MaterialCustodyRow, type WmsInventoryWorkspace } from '../lib/wmsWorkspaceService';
import { useToast } from '../context/ToastContext';

interface Props {
  warehouseId: string | null;
  warehouses: Warehouse[];
  items: InventoryItem[];
  canCount: boolean;
  onPosted?: () => void | Promise<void>;
  service?: typeof wmsWorkspaceService;
}

type CountLine = { id: string; item_id: string; unit: string | null; snapshot_qty: number };

const number = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 6 });

const WmsControlPanel: React.FC<Props> = ({ warehouseId, warehouses, items, canCount, onPosted, service = wmsWorkspaceService }) => {
  const toast = useToast();
  const [tab, setTab] = useState<'inventory' | 'custody'>('inventory');
  const [workspace, setWorkspace] = useState<WmsInventoryWorkspace | null>(null);
  const [custody, setCustody] = useState<MaterialCustodyRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [countOpen, setCountOpen] = useState(false);
  const [countReason, setCountReason] = useState('Kiểm kê định kỳ');
  const [count, setCount] = useState<{ id: string; no: string; version: number; lines: CountLine[] } | null>(null);
  const [countDrafts, setCountDrafts] = useState<Record<string, string>>({});
  const [countSaving, setCountSaving] = useState(false);
  const countCommandRef = useRef<{ signature: string; key: string } | null>(null);

  const idempotencyKeyFor = (signature: string) => {
    if (countCommandRef.current?.signature !== signature) {
      countCommandRef.current = { signature, key: crypto.randomUUID() };
    }
    return countCommandRef.current.key;
  };

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      if (tab === 'inventory') {
        setWorkspace(await service.getInventory({ warehouseId, limit: 100 }));
      } else {
        const response = await service.getMaterialCustody({ limit: 200 });
        setCustody(response.rows);
      }
      setState('ready');
    } catch (loadError) {
      logApiError('wmsControlPanel.load', loadError);
      setError(getApiErrorMessage(loadError, 'Không thể tải dữ liệu kiểm soát kho.'));
      setState('error');
    }
  }, [service, tab, warehouseId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!countOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>('[data-g6-count-dialog]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled])') || []);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCountOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const targets = focusable();
      if (!targets.length) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.requestAnimationFrame(() => previous?.focus());
    };
  }, [countOpen]);

  const totals = useMemo(() => (workspace?.rows || []).reduce((sum, row) => ({
    transit: sum.transit + row.inTransitQty,
    receipt: sum.receipt + (row.receiptCustodyQty ?? 0),
    receiptUnknown: sum.receiptUnknown + (row.receiptCustodyQty == null ? 1 : 0),
    team: sum.team + row.teamCustodyQty,
    unknown: sum.unknown + (row.authoritative ? 0 : 1),
  }), { transit: 0, receipt: 0, receiptUnknown: 0, team: 0, unknown: 0 }), [workspace]);
  const summaryCards: Array<{ Icon: LucideIcon; label: string; value: string; color: string }> = [
    { Icon: Truck, label: 'Đang chuyển', value: number(totals.transit), color: 'text-blue-700 bg-blue-50' },
    { Icon: PackageOpen, label: 'Chờ xử lý nhận', value: totals.receiptUnknown ? 'Chưa xác định' : number(totals.receipt), color: 'text-amber-700 bg-amber-50' },
    { Icon: Users, label: 'Đội đang giữ', value: number(totals.team), color: 'text-violet-700 bg-violet-50' },
    { Icon: ShieldCheck, label: 'Dòng chưa tin cậy', value: number(totals.unknown), color: totals.unknown ? 'text-red-700 bg-red-50' : 'text-emerald-700 bg-emerald-50' },
  ];

  const openCount = () => {
    setCount(null);
    setCountDrafts({});
    setCountReason('Kiểm kê định kỳ');
    setCountOpen(true);
  };

  const startCount = async () => {
    if (!warehouseId || !countReason.trim()) return;
    setCountSaving(true);
    try {
      const reason = countReason.trim();
      const result = await service.startCount({
        warehouseId,
        itemIds: null,
        reason,
        idempotencyKey: idempotencyKeyFor(JSON.stringify({ action: 'start', warehouseId, reason })),
      });
      const rawLines = await service.listCountLines(result.inventoryCountId) as CountLine[];
      setCount({ id: result.inventoryCountId, no: result.countNo, version: result.rowVersion, lines: rawLines });
      setCountDrafts(Object.fromEntries(rawLines.map(line => [line.id, String(line.snapshot_qty)])));
      countCommandRef.current = null;
    } catch (countError) {
      logApiError('wmsControlPanel.startCount', countError);
      toast.error('Không thể mở kiểm kê', getApiErrorMessage(countError, 'Kiểm tra quyền và các lỗi đối soát đang mở.'));
    } finally {
      setCountSaving(false);
    }
  };

  const postCount = async () => {
    if (!count) return;
    const lines = count.lines.map(line => ({ countLineId: line.id, countedQty: parseQuantityInput(countDrafts[line.id] ?? ''), evidence: [] }));
    if (lines.some(line => !Number.isFinite(line.countedQty) || line.countedQty < 0)) {
      toast.warning('Số đếm không hợp lệ', 'Mỗi dòng phải có số lượng không âm.');
      return;
    }
    setCountSaving(true);
    try {
      const signature = JSON.stringify({ action: 'post', inventoryCountId: count.id, lines, expectedVersion: count.version });
      await service.postCount({
        inventoryCountId: count.id,
        lines,
        expectedVersion: count.version,
        idempotencyKey: idempotencyKeyFor(signature),
      });
      countCommandRef.current = null;
      toast.success('Đã chốt kiểm kê', 'Chênh lệch đã được ghi bằng phiếu điều chỉnh có liên kết.');
      setCountOpen(false);
      await onPosted?.();
      await load();
    } catch (countError) {
      logApiError('wmsControlPanel.postCount', countError);
      toast.error('Không thể chốt kiểm kê', getApiErrorMessage(countError, 'Dữ liệu có thể đã thay đổi; hãy tải lại trước khi thử lại.'));
    } finally {
      setCountSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950" aria-label="Kiểm soát luồng kho">
      <div className="flex flex-col gap-3 border-b border-zinc-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">Kiểm soát vật tư</p>
          <h2 className="mt-1 text-base font-black text-zinc-900 dark:text-zinc-100">Tồn, hàng đang đi và trách nhiệm giữ hàng</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
            <button type="button" onClick={() => setTab('inventory')} className={`min-h-10 rounded-lg px-3 text-xs font-black ${tab === 'inventory' ? 'bg-white text-teal-700 shadow-sm dark:bg-zinc-800 dark:text-teal-300' : 'text-zinc-500'}`}>Kho</button>
            <button type="button" onClick={() => setTab('custody')} className={`min-h-10 rounded-lg px-3 text-xs font-black ${tab === 'custody' ? 'bg-white text-teal-700 shadow-sm dark:bg-zinc-800 dark:text-teal-300' : 'text-zinc-500'}`}>Đội đang giữ</button>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-xs font-black text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"><RefreshCcw size={14} /> Tải lại</button>
          {canCount && warehouseId && tab === 'inventory' && <button type="button" onClick={openCount} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-3 text-xs font-black text-white hover:bg-teal-800"><ClipboardCheck size={15} /> Mở kiểm kê</button>}
        </div>
      </div>

      {state === 'loading' && <div className="flex min-h-36 items-center justify-center gap-2 text-sm font-bold text-zinc-500"><Loader2 size={18} className="animate-spin" /> Đang tải dữ liệu kho…</div>}
      {state === 'error' && <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"><div className="flex gap-2"><AlertTriangle size={18} className="shrink-0" /><span>{error}</span></div><button type="button" onClick={() => void load()} className="mt-3 rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white">Thử lại</button></div>}

      {state === 'ready' && tab === 'inventory' && workspace && (
        <div className="p-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {summaryCards.map(({ Icon, label, value, color }) => (
              <div key={label} className={`rounded-xl p-3 ${color}`}><div className="flex items-center gap-2 text-[10px] font-black uppercase"><Icon size={14} /> {label}</div><div className="mt-2 text-xl font-black">{value}</div></div>
            ))}
          </div>
          {!workspace.completeness.authoritative && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">Có {workspace.completeness.openReconciliationIssues} lỗi đối soát và {workspace.completeness.unknownReceiptCounts} dòng nhận chưa có bằng chứng kiểm đếm. Số chưa đủ nguồn được hiển thị “Chưa xác định”.</div>}
          {workspace.rows.length === 0 ? <div className="py-10 text-center text-sm font-bold text-zinc-500">Không có vật tư trong phạm vi kho này.</div> : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-100 dark:border-zinc-800">
              <table className="min-w-[820px] w-full text-left text-xs">
                <thead className="bg-zinc-50 text-[10px] font-black uppercase text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-3">Vật tư</th><th className="px-3 py-3 text-right">Tồn sổ</th><th className="px-3 py-3 text-right">Khả dụng</th><th className="px-3 py-3 text-right">Đang đi</th><th className="px-3 py-3 text-right">Chờ nhận</th><th className="px-3 py-3 text-right">Đội giữ</th><th className="px-3 py-3">Độ tin cậy</th></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{workspace.rows.map(row => <tr key={row.key}><td className="px-3 py-3"><div className="font-black text-zinc-800 dark:text-zinc-100">{row.materialName}</div><div className="font-mono text-[10px] text-zinc-500">{row.sku} · {row.warehouseName}</div></td><td className="px-3 py-3 text-right font-bold">{number(row.onHandQty)} {row.unit}</td><td className={`px-3 py-3 text-right font-black ${row.availableQty == null ? 'text-amber-700' : 'text-emerald-700'}`}>{row.availableQty == null ? 'Chưa xác định' : `${number(row.availableQty)} ${row.unit}`}</td><td className="px-3 py-3 text-right font-bold text-blue-700">{number(row.inTransitQty)}</td><td className="px-3 py-3 text-right font-bold text-amber-700">{row.receiptCustodyQty == null ? 'Chưa xác định' : number(row.receiptCustodyQty)}</td><td className="px-3 py-3 text-right font-bold text-violet-700">{number(row.teamCustodyQty)}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${row.authoritative ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{row.authoritative ? 'Đã đối soát' : row.classification}</span></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {state === 'ready' && tab === 'custody' && (
        <div className="p-4">
          {custody.length === 0 ? <div className="py-10 text-center text-sm font-bold text-zinc-500">Không có vật tư đang mở trách nhiệm bàn giao.</div> : <div className="grid gap-3 md:grid-cols-2">{custody.map(row => <article key={row.issueLineId} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-zinc-900 dark:text-zinc-100">{row.recipientName || 'Chưa xác định người/đội'}</div><div className="mt-1 text-xs font-semibold text-zinc-500">{row.itemName} · {row.issueNo}</div></div><div className="text-right"><div className="text-lg font-black text-violet-700">{number(Number(row.custodyQty))}</div><div className="text-[10px] font-bold text-zinc-500">{row.unit}</div></div></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]"><div className="rounded-lg bg-zinc-50 p-2"><b className="block text-sm">{number(Number(row.issuedQty))}</b>Đã giao</div><div className="rounded-lg bg-zinc-50 p-2"><b className="block text-sm">{number(Number(row.consumedQty))}</b>Đã dùng</div><div className="rounded-lg bg-zinc-50 p-2"><b className="block text-sm">{number(Number(row.returnedQty))}</b>Đã hoàn</div></div>{!row.allocationComplete && <div className="mt-3 rounded-lg bg-amber-50 p-2 text-[10px] font-black text-amber-800">Chưa đủ phân bổ công tác/ngân sách — không tự gán.</div>}</article>)}</div>}
        </div>
      )}

      {countOpen && <div data-g6-count-dialog className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Kiểm kê kho"><div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b p-4"><div><div className="text-[10px] font-black uppercase tracking-widest text-teal-700">Kiểm kê theo snapshot</div><h3 className="text-lg font-black">{count?.no || warehouses.find(warehouse => warehouse.id === warehouseId)?.name}</h3></div><button type="button" aria-label="Đóng kiểm kê" onClick={() => setCountOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-zinc-100"><X size={20} /></button></div><div className="overflow-y-auto p-4">{!count ? <label className="block text-xs font-black text-zinc-600">Lý do kiểm kê<textarea value={countReason} onChange={event => setCountReason(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-zinc-200 p-3 text-sm font-semibold outline-none focus:border-teal-600" /></label> : <div className="space-y-2">{count.lines.map(line => { const item = items.find(candidate => candidate.id === line.item_id); return <label key={line.id} className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-3 rounded-xl border border-zinc-200 p-3"><span><b className="block text-sm">{item?.name || line.item_id}</b><span className="text-[10px] text-zinc-500">Snapshot: {number(Number(line.snapshot_qty))} {line.unit}</span></span><input aria-label={`Số đếm ${item?.name || line.item_id}`} type="text" inputMode="decimal" value={countDrafts[line.id] ?? ''} onChange={event => setCountDrafts(previous => ({ ...previous, [line.id]: sanitizeQuantityInput(event.target.value, { previousValue: previous[line.id] ?? '0' }) }))} className="rounded-lg border border-zinc-200 px-3 py-2 text-right font-black outline-none focus:border-teal-600" /></label>; })}</div>}</div><div className="flex justify-end gap-2 border-t p-4"><button type="button" onClick={() => setCountOpen(false)} className="min-h-11 rounded-xl border border-zinc-200 px-4 text-sm font-black">Đóng</button><button type="button" disabled={countSaving || !countReason.trim()} onClick={() => void (count ? postCount() : startCount())} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-black text-white disabled:opacity-50">{countSaving && <Loader2 size={15} className="animate-spin" />}{count ? 'Chốt kiểm kê' : 'Chụp snapshot'}</button></div></div></div>}
    </section>
  );
};

export default WmsControlPanel;
