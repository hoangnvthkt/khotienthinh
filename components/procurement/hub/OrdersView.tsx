import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronRight, Search } from 'lucide-react';
import {
  procurementInboxService, type ProcurementOrderList, type ProcurementOrderStage, type ProcurementOrderSummary,
} from '../../../lib/procurementInboxService';
import { dateVi } from '../../project/work-plan/workPlanUi';
import { Badge, PoStatusChip, StateBox, inputCls, money } from './hubUi';

const STAGE_COPY: Record<ProcurementOrderStage, { empty: string; hint: string }> = {
  drafting: { empty: 'Không có đơn đang lập hoặc chờ duyệt.', hint: 'Đơn nháp, chờ duyệt và bị trả lại.' },
  ordered: { empty: 'Không có đơn đã duyệt đang chờ giao.', hint: 'Đã duyệt — chờ NCC giao. Công trường lập đợt giao ở tab dự án.' },
  delivering: { empty: 'Không có đơn đang giao.', hint: 'Hàng đang về từng đợt.' },
  received: { empty: 'Chưa có đơn giao đủ.', hint: 'Đã giao đủ — đối chiếu chứng từ và đóng đơn.' },
};

const OrderRow: React.FC<{ order: ProcurementOrderSummary; onOpen: () => void }> = ({ order, onOpen }) => {
  const pct = order.qtyTotal > 0 ? Math.min(100, Math.round(order.qtyReceived / order.qtyTotal * 100)) : 0;
  const due = order.expectedDeliveryDate;
  return <li>
    <button type="button" onClick={onOpen} className={`flex w-full flex-col gap-1.5 border-t border-border px-3 py-3 text-left md:flex-row md:items-center md:gap-4 ${order.awaitingMe ? 'bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-950/20' : 'bg-card hover:bg-muted/40'}`}>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-foreground">{order.poNumber}</span>
          <PoStatusChip status={order.status} />
          {order.awaitingMe && <Badge className="border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-100">Chờ bạn duyệt</Badge>}
          {!order.isHub && <Badge className="border-border bg-muted text-muted-foreground" title="Lập ở tab dự án trước khi có Mua hàng">Lập ở dự án</Badge>}
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
          {order.vendorName || 'Chưa chọn NCC'} · {order.projectCode || 'Không gắn dự án'}{order.sources.length > 0 && ` · ${order.sources.map(s => s.code).filter(Boolean).slice(0, 3).join(', ')}${order.sources.length > 3 ? '…' : ''}`}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs md:w-[30rem] md:shrink-0 md:justify-end">
        <span className={`inline-flex items-center gap-1 ${order.late ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-muted-foreground'}`}>
          <CalendarClock size={12} />{due ? `${order.late ? 'Quá hẹn · ' : 'Giao '}${dateVi(due)}` : 'Chưa hẹn ngày giao'}</span>
        {order.stage !== 'drafting' && <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={`Đã nhận ${pct}% số lượng`}>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>{pct}%</span>}
        {order.totalAmount > 0
          ? <span className="w-28 text-right font-semibold tabular-nums text-foreground">{money(order.totalAmount * (1 + order.vatRate / 100))} đ</span>
          : <span className="w-28 text-right text-amber-700 dark:text-amber-300">Chưa có giá</span>}
      </span>
      <ChevronRight size={16} className="hidden shrink-0 text-muted-foreground md:block" />
    </button>
  </li>;
};

export const OrdersView: React.FC<{
  stage: ProcurementOrderStage; projects: Array<{ id: string; code: string | null; name: string | null }>;
  reloadKey: number; onOpen: (orderId: string) => void;
}> = ({ stage, projects, reloadKey, onOpen }) => {
  const [data, setData] = useState<ProcurementOrderList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(() => {
    setError(null);
    procurementInboxService.listOrders({ stage, projectId: projectId || undefined, mine, search: query || undefined })
      .then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [stage, projectId, mine, query]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const groups = useMemo(() => {
    const orders = data?.orders || [];
    if (stage !== 'drafting') return [{ key: 'all', label: '', orders }];
    return [
      { key: 'me', label: 'Chờ bạn duyệt', orders: orders.filter(o => o.awaitingMe) },
      { key: 'returned', label: 'Bị trả lại — cần sửa', orders: orders.filter(o => !o.awaitingMe && o.status === 'returned') },
      { key: 'sent', label: 'Chờ duyệt', orders: orders.filter(o => !o.awaitingMe && o.status === 'sent') },
      { key: 'draft', label: 'Nháp', orders: orders.filter(o => o.status === 'draft') },
    ].filter(g => g.orders.length > 0);
  }, [data, stage]);

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
      <p className="px-1 text-sm text-muted-foreground">{STAGE_COPY[stage].hint}</p>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} className="h-4 w-4 accent-teal-600" />Của tôi</label>
        <select aria-label="Dự án" value={projectId} onChange={e => setProjectId(e.target.value)} className={`max-w-[12rem] ${inputCls}`}>
          <option value="">Mọi dự án</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}
        </select>
        <label className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Số PO, NCC, dự án…" className={`w-52 pl-8 ${inputCls}`} />
        </label>
      </span>
    </div>
    {error ? <StateBox kind="error" message={error} onRetry={load} />
      : !data ? <StateBox kind="loading" title="Đang tải đơn hàng…" />
        : data.orders.length === 0 ? <StateBox kind="empty" title={STAGE_COPY[stage].empty} message={projectId || mine || query ? 'Thử bỏ bớt bộ lọc.' : undefined} />
          : <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {groups.map(g => <div key={g.key}>
              {g.label && <p className="border-t border-border bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:border-t-0">{g.label} · {g.orders.length}</p>}
              <ul>{g.orders.map(o => <OrderRow key={o.id} order={o} onOpen={() => onOpen(o.id)} />)}</ul>
            </div>)}
            {data.orders.length >= 300 && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Hiển thị 300 đơn đầu — dùng bộ lọc để thu hẹp.</p>}
          </div>}
  </section>;
};

export default OrdersView;
