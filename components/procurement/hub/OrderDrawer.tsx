import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CalendarClock, Loader2, Pencil, Send, Trash2, UserRound, Warehouse } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import { procurementInboxService, type ProcurementOrderDetail } from '../../../lib/procurementInboxService';
import { dateVi, fmt } from '../../project/work-plan/workPlanUi';
import { Badge, Drawer, PoStatusChip, StateBox, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';

const EVENT_LABELS: Record<string, string> = {
  create: 'Lập đơn', update: 'Sửa đơn', submit: 'Gửi duyệt', approve: 'Duyệt đơn', return: 'Trả lại', delete: 'Xóa nháp',
};

/** Link to the PO inside its project, where the site schedules deliveries and receives goods. */
export const projectPoLink = (o: Pick<ProcurementOrderDetail, 'id' | 'projectId' | 'constructionSiteId'>) => {
  if (!o.projectId) return null;
  const p = new URLSearchParams({ projectId: o.projectId, ...(o.constructionSiteId ? { siteId: o.constructionSiteId } : {}), tab: 'material', materialTab: 'po', poId: o.id });
  return `#/da?${p.toString()}`;
};

export const OrderDrawer: React.FC<{
  orderId: string; today: string; onClose: () => void; onChanged: () => void; onEdit: (order: ProcurementOrderDetail) => void;
}> = ({ orderId, today, onClose, onChanged, onEdit }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [order, setOrder] = useState<ProcurementOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approver, setApprover] = useState('');

  const load = useCallback(() => {
    setError(null);
    procurementInboxService.getOrder(orderId).then(o => { setOrder(o); setApprover(a => a || o.submittedToUserId || ''); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [orderId]);
  useEffect(load, [load]);

  const act = async (action: 'submit' | 'approve' | 'return' | 'delete', reason?: string) => {
    if (!order) return;
    setBusy(true);
    try {
      await procurementInboxService.transitionOrder({ purchaseOrderId: order.id, expectedRowVersion: order.rowVersion, action,
        approverUserId: action === 'submit' ? approver : undefined, reason });
      const who = order.approvers.find(a => a.id === approver)?.name;
      toast.success({ submit: `Đã gửi ${order.poNumber} cho ${who} duyệt`, approve: `Đã duyệt ${order.poNumber}`, return: `Đã trả lại ${order.poNumber}`, delete: `Đã xóa nháp ${order.poNumber}` }[action],
        action === 'approve' ? 'Gửi đơn cho NCC. Công trường lập đợt giao và nhận hàng ở tab Vật tư của dự án.' : undefined);
      onChanged();
      if (action === 'delete') onClose(); else load();
    } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  const late = order?.expectedDeliveryDate && ['ordered', 'delivering'].includes(order.stage) && order.expectedDeliveryDate < today;
  const vatAmount = order ? order.totalAmount * order.vatRate / 100 : 0;
  const perms = order?.permissions;
  const link = order ? projectPoLink(order) : null;
  const unpriced = order ? order.lines.filter(l => !(l.unitPrice > 0)).length : 0;

  const footer = order && <>
    {link && <a href={link} className={`${secondaryBtn} mr-auto`}><ArrowUpRight size={15} />Mở trong dự án</a>}
    {perms?.canDelete && <button type="button" disabled={busy} className={secondaryBtn}
      onClick={async () => { if (await confirm({ title: 'Xóa đơn nháp?', targetName: order.poNumber || '', actionLabel: 'Xóa nháp' })) void act('delete'); }}>
      <Trash2 size={15} />Xóa nháp</button>}
    {perms?.canEdit && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => onEdit(order)}><Pencil size={15} />Sửa</button>}
    {perms?.canSubmit && <span className="flex flex-wrap items-center gap-2">
      <select aria-label="Người duyệt" value={approver} onChange={e => setApprover(e.target.value)} className={`min-w-[12rem] ${inputCls}`}>
        <option value="">Chọn người duyệt…</option>
        {order.approvers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <button type="button" disabled={busy || !approver || unpriced > 0} title={unpriced > 0 ? 'Nhập đủ đơn giá trước khi gửi duyệt' : undefined} className={primaryBtn} onClick={() => void act('submit')}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Gửi duyệt</button></span>}
    {perms?.canApprove && <>
      <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
        const reason = await askReason({ title: 'Trả lại đơn hàng', targetName: order.poNumber || '', reasonLabel: 'Lý do trả lại', reasonPlaceholder: 'VD: Đơn giá cao hơn báo giá, đổi NCC…', actionLabel: 'Trả lại', intent: 'warning' });
        if (reason) void act('return', reason);
      }}>Trả lại</button>
      <button type="button" disabled={busy} className={primaryBtn} onClick={() => void act('approve')}>{busy && <Loader2 size={15} className="animate-spin" />}Duyệt đơn</button>
    </>}
  </>;

  return <Drawer label={order?.poNumber ? `Đơn ${order.poNumber}` : 'Đơn hàng'} onClose={onClose} footer={footer || undefined}
    header={order ? <>
      <div className="flex flex-wrap items-center gap-1.5"><PoStatusChip status={order.status} />
        <Badge className={order.isHub ? 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200' : 'border-border bg-muted text-muted-foreground'}>
          {order.isHub ? 'Lập tại Mua hàng' : 'Lập ở dự án'}</Badge>
        {late && <Badge className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Quá ngày giao</Badge>}</div>
      <h2 className="mt-2 text-lg font-bold text-foreground">{order.poNumber}<span className="font-medium text-muted-foreground"> · {order.vendorName || 'Chưa chọn NCC'}</span></h2>
      <p className="text-sm text-muted-foreground">{[order.projectCode, order.projectName].filter(Boolean).join(' — ')}</p>
    </> : <h2 className="text-lg font-bold">Đơn hàng</h2>}>
    {error ? <StateBox kind="error" message={error} onRetry={load} /> : !order ? <StateBox kind="loading" title="Đang tải đơn hàng…" /> : <>
      {order.status === 'returned' && order.returnReason && <p role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><b>Bị trả lại:</b> {order.returnReason}</span></p>}
      {perms?.canSubmit && unpriced > 0 && <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />{unpriced} vật tư chưa có đơn giá. Bấm Sửa để nhập giá rồi gửi duyệt.</p>}
      {order.status === 'sent' && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        Đang chờ <b>{order.submittedToName || 'người duyệt'}</b> duyệt.</p>}
      {order.stage === 'ordered' && <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100">
        Đã duyệt — gửi đơn cho NCC. Công trường lập đợt giao và nhận hàng ở tab Vật tư của dự án.</p>}
      {!order.isHub && <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">Đơn này lập ở tab dự án trước khi có Mua hàng — chỉ xem tại đây.</p>}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
        {([
          [Warehouse, 'Kho nhận', order.warehouseName || 'Chưa chọn kho'],
          [CalendarClock, 'Ngày cần giao', order.expectedDeliveryDate ? dateVi(order.expectedDeliveryDate) : 'Chưa hẹn'],
          [UserRound, 'Người lập', order.createdByName || '—'],
          [UserRound, 'Người duyệt', order.submittedToName || '—'],
        ] as const).map(([Icon, label, value]) => <div key={label} className="min-w-0">
          <dt className="flex items-center gap-1 text-xs text-muted-foreground"><Icon size={12} />{label}</dt>
          <dd className="truncate font-medium text-foreground">{value}</dd></div>)}
      </dl>

      <section>
        <h3 className="mb-2 font-semibold text-foreground">Vật tư ({order.lines.length})</h3>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {order.lines.map(line => <li key={line.lineId} className="px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-foreground">{line.name}<span className="ml-2 text-xs text-muted-foreground">{line.sku}</span></span>
              <span className="text-sm tabular-nums">{fmt(line.qty)} {line.unit} × {money(line.unitPrice)} = <b>{money(line.qty * line.unitPrice)} đ</b></span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {line.receivedQty > 0 && <span className="font-semibold text-emerald-700 dark:text-emerald-300">Đã nhận {fmt(line.receivedQty)}</span>}
              {line.stockUnit && line.stockUnit !== line.unit && <span>= {fmt(line.qty * line.factor, 3)} {line.stockUnit}</span>}
              {line.allocations.map(a => <span key={`${a.sourceId}:${a.lineId}`}>{a.code}: {fmt(a.qty)} {line.stockUnit || ''}</span>)}
              {line.allocations.length === 0 && <span>Không gắn phiếu nhu cầu</span>}
            </div>
          </li>)}
        </ul>
        <dl className="ml-auto mt-2 w-full max-w-xs space-y-0.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Tiền hàng</dt><dd className="tabular-nums">{money(order.totalAmount)} đ</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">VAT {fmt(order.vatRate)}%</dt><dd className="tabular-nums">{money(vatAmount)} đ</dd></div>
          <div className="flex justify-between font-bold"><dt>Tổng cộng</dt><dd className="tabular-nums">{money(order.totalAmount + vatAmount)} đ</dd></div>
        </dl>
      </section>
      {order.note && <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm"><span className="text-muted-foreground">Ghi chú: </span>{order.note}</p>}
      {order.events.length > 0 && <section>
        <h3 className="mb-2 font-semibold text-foreground">Lịch sử</h3>
        <ol className="space-y-1 text-sm">{order.events.map((e, i) => <li key={i} className="flex flex-wrap gap-x-2 text-muted-foreground">
          <span className="tabular-nums">{new Date(e.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span className="font-medium text-foreground">{EVENT_LABELS[e.action] || e.action}</span><span>· {e.actorName}</span>
          {e.reason && <span className="w-full pl-4 italic">“{e.reason}”</span>}</li>)}</ol>
      </section>}
    </>}
  </Drawer>;
};

export default OrderDrawer;
