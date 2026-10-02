import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CalendarClock, CircleSlash, Link2, Loader2, Pencil, Send, Trash2, Truck, Unlink, UserRound, Warehouse } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import { DELIVERY_STATUS_LABELS, PROACTIVE_REASON_LABELS, procurementInboxService, type ProcurementDelivery, type ProcurementOrderDetail, type ProcurementOrderLine } from '../../../lib/procurementInboxService';
import { SUPPLIER_RETURN_REASONS, type SupplierReturnReasonCode } from '../../../lib/purchaseOrderSupplierReturnService';
import { dateVi, fmt } from '../../project/work-plan/workPlanUi';
import { DeliveryEditor } from './DeliveryEditor';
import { Badge, Drawer, PoStatusChip, StateBox, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';

const EVENT_LABELS: Record<string, string> = {
  create: 'Lập đơn', update: 'Sửa đơn', submit: 'Gửi duyệt', approve: 'Duyệt đơn', return: 'Trả lại', delete: 'Xóa nháp',
  delivery_create: 'Lập đợt giao', delivery_request: 'Xin duyệt bổ sung đợt giao', delivery_approve: 'Duyệt bổ sung đợt giao',
  delivery_return: 'Trả lại đợt giao', delivery_cancel: 'Hủy đợt giao', close_short: 'Kết thúc thiếu',
  return_replace: 'Trả NCC — đổi hàng', return_credit: 'Trả NCC — giảm trừ',
  link_need: 'Gắn nhu cầu', unlink_need: 'Gỡ gắn nhu cầu',
};
const BOQ_TEXT = { within: 'Trong BOQ', over: 'Vượt BOQ', outside: 'Ngoài BOQ' } as const;

const DELIVERY_TONE: Record<string, string> = {
  receiving: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200',
  quality_approved: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200',
  received: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  received_short: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  received_over: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  cancelled: 'border-border bg-muted text-muted-foreground',
};
const deliveryLabel = (d: ProcurementDelivery) => d.status === 'planned'
  ? d.approvalStatus === 'pending_approval' ? 'Chờ duyệt bổ sung' : d.approvalStatus === 'rejected' ? 'Bị trả lại' : 'Nháp'
  : DELIVERY_STATUS_LABELS[d.status] || d.status;
const deliveryTone = (d: ProcurementDelivery) => d.status === 'planned'
  ? d.approvalStatus === 'rejected' ? DELIVERY_TONE.received_short : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
  : DELIVERY_TONE[d.status] || DELIVERY_TONE.cancelled;

/** Link to the PO inside its project, where the site schedules deliveries and receives goods. */
export const projectPoLink = (o: Pick<ProcurementOrderDetail, 'id' | 'projectId' | 'constructionSiteId'>) => {
  if (!o.projectId) return null;
  const p = new URLSearchParams({ projectId: o.projectId, ...(o.constructionSiteId ? { siteId: o.constructionSiteId } : {}), tab: 'material', materialTab: 'po', poId: o.id });
  return `#/da?${p.toString()}`;
};

export const OrderDrawer: React.FC<{
  orderId: string; today: string; currentUserId: string; onClose: () => void; onChanged: () => void; onEdit: (order: ProcurementOrderDetail) => void;
}> = ({ orderId, today, currentUserId, onClose, onChanged, onEdit }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [order, setOrder] = useState<ProcurementOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approver, setApprover] = useState('');
  const [deliveryEditor, setDeliveryEditor] = useState<{ delivery: ProcurementDelivery | null } | null>(null);
  const [shortOpen, setShortOpen] = useState(false);
  const [shortReason, setShortReason] = useState('');
  const [returnToNeed, setReturnToNeed] = useState(true);

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
        action === 'approve' ? (order.purchaseMode === 'multiple' ? 'Gửi đơn cho NCC. Khi NCC báo giao, bấm "Lập đợt giao" với SL, giá, VAT của đợt.'
          : 'Gửi đơn cho NCC. Phiếu nhập kho (QR) đã sẵn sàng cho thủ kho.') : undefined);
      onChanged();
      if (action === 'delete') onClose(); else load();
    } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  const late = order?.expectedDeliveryDate && ['ordered', 'delivering'].includes(order.stage) && order.expectedDeliveryDate < today;
  const vatAmount = order ? order.totalAmount * order.vatRate / 100 : 0;
  const perms = order?.permissions;
  const link = order ? projectPoLink(order) : null;
  const unpriced = order ? order.lines.filter(l => !(l.unitPrice > 0)).length : 0;

  const runDelivery = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast.success(done); onChanged(); load(); }
    catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  const closeShort = async () => {
    if (!order || !shortReason.trim()) return;
    await runDelivery(() => procurementInboxService.closeShort({ purchaseOrderId: order.id, expectedRowVersion: order.rowVersion, reason: shortReason.trim(), returnToNeed }),
      returnToNeed ? `Đã kết thúc thiếu ${order.poNumber} — phần thiếu quay lại Cần mua` : `Đã kết thúc thiếu ${order.poNumber}`);
    setShortOpen(false); setShortReason('');
  };

  const unlink = async (line: ProcurementOrderLine, a: ProcurementOrderLine['allocations'][number]) => {
    if (!order) return;
    const reason = await askReason({ title: 'Gỡ gắn nhu cầu', targetName: `${a.code} khỏi ${order.poNumber}`,
      subtitle: `${line.name}: ${fmt(a.qty, 3)} ${line.stockUnit || ''} sẽ quay lại "Cần mua" của ${a.code}.`, reasonLabel: 'Lý do gỡ',
      reasonPlaceholder: 'VD: Gắn nhầm phiếu, nhu cầu lấy từ kho tổng…', actionLabel: 'Gỡ gắn', intent: 'warning' });
    if (!reason) return;
    await runDelivery(() => procurementInboxService.linkProactive({ action: 'unlink', purchaseOrderId: order.id, poLineId: line.lineId,
      sourceType: a.sourceType, sourceId: a.sourceId, lineId: a.lineId, reason }),
    `Đã gỡ ${a.code} khỏi ${order.poNumber} — phần này quay lại Cần mua`);
  };

  const footer = order && <>
    {link && <a href={link} className={`${secondaryBtn} mr-auto`}><ArrowUpRight size={15} />Mở trong dự án</a>}
    {perms?.canDelete && <button type="button" disabled={busy} className={secondaryBtn}
      onClick={async () => { if (await confirm({ title: 'Xóa đơn nháp?', targetName: order.poNumber || '', actionLabel: 'Xóa nháp' })) void act('delete'); }}>
      <Trash2 size={15} />Xóa nháp</button>}
    {perms?.canEdit && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => onEdit(order)}><Pencil size={15} />Sửa</button>}
    {perms?.canCloseShort && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setShortOpen(true)}><CircleSlash size={15} />Kết thúc thiếu</button>}
    {perms?.canAddDelivery && <button type="button" disabled={busy} className={primaryBtn} onClick={() => setDeliveryEditor({ delivery: null })}>
      <Truck size={15} />{order.status === 'partial' ? 'Giao bù phần thiếu' : 'Lập đợt giao'}</button>}
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

  if (order && deliveryEditor) return <DeliveryEditor order={order} delivery={deliveryEditor.delivery} onClose={() => setDeliveryEditor(null)}
    onSaved={needsApproval => {
      toast.success(needsApproval ? 'Đã gửi đợt giao chờ duyệt bổ sung' : 'Đã lập đợt giao — phiếu nhập kho (QR) sẵn sàng cho thủ kho');
      setDeliveryEditor(null); onChanged(); load();
    }} />;

  return <Drawer label={order?.poNumber ? `Đơn ${order.poNumber}` : 'Đơn hàng'} onClose={onClose} footer={footer || undefined}
    header={order ? <>
      <div className="flex flex-wrap items-center gap-1.5"><PoStatusChip status={order.status} />
        <Badge className={order.isHub ? 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200' : 'border-border bg-muted text-muted-foreground'}>
          {order.isHub ? 'Lập tại Mua hàng' : 'Lập ở dự án'}</Badge>
        {order.kind === 'proactive' && <Badge className="border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-800 dark:bg-teal-900/50 dark:text-teal-100">Đơn chủ động</Badge>}
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
        {order.purchaseMode === 'multiple' ? 'Đã duyệt — gửi đơn cho NCC. Khi NCC báo giao, lập đợt giao với SL, giá và VAT của đợt.'
          : 'Đã duyệt — gửi đơn cho NCC. Phiếu nhập kho (QR) đang chờ thủ kho nhận theo SL thực tế.'}</p>}
      {order.kind === 'proactive' && order.proactive && <div className="space-y-1 rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2.5 text-sm dark:border-teal-900 dark:bg-teal-950/20">
        <p><span className="text-muted-foreground">Mua chủ động: </span><b className="text-foreground">{PROACTIVE_REASON_LABELS[order.proactive.reasonCode]?.label || order.proactive.reasonCode}</b>
          {order.proactive.reason && <span className="text-foreground"> — {order.proactive.reason}</span>}</p>
        {order.proactive.overBoqReason && <p className="flex gap-1.5 text-amber-800 dark:text-amber-200"><AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span><b>Vượt/ngoài BOQ:</b> {order.proactive.overBoqReason}</span></p>}
        <p className="text-xs text-muted-foreground">Nhu cầu cùng vật tư của dự án được gắn vào phần chưa phân bổ ở phiếu nhu cầu (Cần mua) thay vì lập đơn mới.</p>
      </div>}
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
              {line.receivedQty > 0 && <span className="font-semibold text-emerald-700 dark:text-emerald-300">Đã nhận {fmt(line.receivedQty, 3)} {line.unit}</span>}
              {['confirmed', 'in_transit', 'partial'].includes(order.status) && line.remainingToDeliver > 0 && <span className="font-semibold text-amber-700 dark:text-amber-300">Còn phải giao {fmt(line.remainingToDeliver, 3)} {line.unit}</span>}
              {line.stockUnit && line.stockUnit !== line.unit && <span>= {fmt(line.qty * line.factor, 3)} {line.stockUnit}</span>}
              {order.kind === 'proactive' && line.boq && <Badge className={line.boq.status === 'within'
                ? 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200'
                : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}
                title={`Lúc lập đơn: BOQ ${fmt(line.boq.boqQty, 3)} · đã đặt đơn khác ${fmt(line.boq.orderedBefore, 3)} ${line.stockUnit || ''}`}>{BOQ_TEXT[line.boq.status]}</Badge>}
              {order.kind !== 'proactive' && line.allocations.map(a => <span key={`${a.sourceId}:${a.lineId}`}>{a.code}: {fmt(a.qty)} {line.stockUnit || ''}</span>)}
              {order.kind !== 'proactive' && line.allocations.length === 0 && <span>Không gắn phiếu nhu cầu</span>}
            </div>
            {order.kind === 'proactive' && <div className="mt-1.5 space-y-1 text-xs">
              <p className="text-muted-foreground">Đã gắn nhu cầu <b className="text-teal-700 dark:text-teal-300">{fmt(line.allocatedQty, 3)}</b> / {fmt(line.stockQty, 3)} {line.stockUnit || ''}
                {line.stockQty - line.allocatedQty > 0.0005 && <> · <b className="text-foreground">còn {fmt(line.stockQty - line.allocatedQty, 3)}</b> chưa phân bổ (nhập kho dự phòng)</>}</p>
              {line.allocations.map(a => <p key={`${a.sourceId}:${a.lineId}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-2 py-1">
                <Link2 size={12} className="text-teal-700 dark:text-teal-300" /><span className="font-semibold text-mint-700 dark:text-mint-300">{a.code}</span>
                <span className="text-muted-foreground">{fmt(a.qty, 3)} {line.stockUnit || ''} (phiếu cần {fmt(a.needQty, 3)})</span>
                {perms?.canLink && <button type="button" disabled={busy} onClick={() => void unlink(line, a)}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-muted-foreground hover:bg-card hover:text-rose-700"><Unlink size={12} />Gỡ</button>}</p>)}
            </div>}
          </li>)}
        </ul>
        <dl className="ml-auto mt-2 w-full max-w-xs space-y-0.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Tiền hàng</dt><dd className="tabular-nums">{money(order.totalAmount)} đ</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">VAT {fmt(order.vatRate)}%</dt><dd className="tabular-nums">{money(vatAmount)} đ</dd></div>
          <div className="flex justify-between font-bold"><dt>Tổng cộng</dt><dd className="tabular-nums">{money(order.totalAmount + vatAmount)} đ</dd></div>
          {order.approvedTotalAmount > order.totalAmount + 1 && <div className="flex justify-between text-amber-700 dark:text-amber-300"><dt>Đã duyệt gồm bổ sung</dt><dd className="tabular-nums">{money(order.approvedTotalAmount)} đ</dd></div>}
          {order.deliveries.some(d => d.acceptedAmount > 0) && <div className="flex justify-between text-muted-foreground"><dt>Thực nhận (trước VAT)</dt>
            <dd className="tabular-nums">{money(order.deliveries.filter(d => d.status !== 'cancelled').reduce((sum, d) => sum + d.acceptedAmount, 0))} đ</dd></div>}
        </dl>
      </section>
      {order.note && <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm"><span className="text-muted-foreground">Ghi chú: </span>{order.note}</p>}
      {order.shortClose && <p className="rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-sm">
        <b>Đã kết thúc thiếu</b> {fmt(order.shortClose.shortStockQty, 3)} {new Set(order.lines.map(l => l.stockUnit)).size === 1 ? order.lines[0]?.stockUnit : '(ĐV kho)'} — {order.shortClose.reason}.
        <span className="text-muted-foreground"> {order.shortClose.returnToNeed ? 'Phần thiếu đã quay lại Cần mua.' : 'Không mua thêm.'} · {order.shortClose.by}</span></p>}

      {shortOpen && <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/20">
        <p className="font-semibold text-foreground">Kết thúc thiếu {order.poNumber}</p>
        <p className="text-xs text-muted-foreground">Không nhận thêm hàng cho đơn này. Phần chưa giao xử lý thế nào?</p>
        {([[true, 'Đưa phần thiếu về Cần mua', 'Mua tiếp ở NCC khác hoặc đơn khác.'], [false, 'Không cần nữa', 'Nhu cầu coi như xong với số đã nhận.']] as const).map(([v, label, hint]) =>
          <label key={String(v)} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <input type="radio" name="short-mode" checked={returnToNeed === v} onChange={() => setReturnToNeed(v)} className="mt-1 accent-teal-600" />
            <span><span className="font-medium text-foreground">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span></label>)}
        <textarea value={shortReason} onChange={e => setShortReason(e.target.value)} rows={2} placeholder="Lý do (bắt buộc) — VD: NCC hết hàng" className={`w-full ${inputCls}`} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setShortOpen(false)} className={secondaryBtn}>Thôi</button>
          <button type="button" disabled={busy || !shortReason.trim()} onClick={() => void closeShort()} className={primaryBtn}>Kết thúc thiếu</button>
        </div>
      </section>}

      {(order.deliveries.length > 0 || ['confirmed', 'in_transit', 'partial'].includes(order.status)) && <section>
        <h3 className="mb-2 font-semibold text-foreground">Đợt giao ({order.deliveries.filter(d => d.status !== 'cancelled').length})</h3>
        {order.deliveries.length === 0
          ? <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            {order.purchaseMode === 'multiple' ? 'Chưa có đợt giao. Khi NCC báo giao, bấm "Lập đợt giao" với SL, giá và VAT của đợt.' : 'Chưa có phiếu giao.'}</p>
          : <ul className="space-y-2">{order.deliveries.map(d => {
            const mine = d.approvalAssigneeId === currentUserId;
            const pending = d.status === 'planned' && d.approvalStatus === 'pending_approval';
            const rejected = d.status === 'planned' && d.approvalStatus === 'rejected';
            const cancellable = d.status === 'planned' || d.status === 'receiving';
            return <li key={d.id} className={`rounded-xl border bg-card px-3 py-2.5 ${d.status === 'cancelled' ? 'border-dashed border-border opacity-60' : 'border-border'}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-foreground">Đợt {d.deliveryNo}</span>
                <Badge className={deliveryTone(d)}>{deliveryLabel(d)}</Badge>
                <span className="text-xs text-muted-foreground">{d.plannedDate ? `Giao ${dateVi(d.plannedDate)}` : ''} · VAT {fmt(d.vatRate)}%</span>
                <span className="ml-auto text-sm font-semibold tabular-nums">{money(d.amount * (1 + d.vatRate / 100))} đ</span>
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">{d.lines.map(l => <li key={l.lineId}>
                <span className="text-foreground">{l.name}</span>: giao {fmt(l.plannedQty, 3)} {l.unit}{l.stockUnit && l.stockUnit !== l.unit ? ` = ${fmt(l.stockPlannedQty, 3)} ${l.stockUnit}` : ''} × {money(l.unitPrice)}
                {['received', 'received_short', 'received_over'].includes(d.status) && <b className={l.acceptedQty < l.plannedQty ? ' text-rose-700 dark:text-rose-300' : ' text-emerald-700 dark:text-emerald-300'}>
                  {' '}· kho nhận {fmt(l.acceptedQty, 3)} {l.unit}{l.stockUnit && l.stockUnit !== l.unit ? ` = ${fmt(l.acceptedStockQty, 3)} ${l.stockUnit}` : ''}</b>}
              </li>)}</ul>
              {pending && <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-200">Vượt giá trị đơn — chờ {d.approvalAssigneeName} duyệt bổ sung.</p>}
              {rejected && d.decisionNote && <p className="mt-1.5 text-xs text-rose-700 dark:text-rose-300">Bị trả lại: {d.decisionNote}</p>}
              {d.note && <p className="mt-1 text-xs text-muted-foreground">Ghi chú: {d.note}</p>}
              {(pending && mine) || (rejected && d.createdById === currentUserId) || cancellable ? <div className="mt-2 flex flex-wrap justify-end gap-2">
                {pending && mine && <>
                  <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
                    const reason = await askReason({ title: `Trả lại đợt ${d.deliveryNo}`, targetName: order.poNumber || '', reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' });
                    if (reason) void runDelivery(() => procurementInboxService.decideDelivery({ deliveryId: d.id, action: 'return', reason }), `Đã trả lại đợt ${d.deliveryNo}`);
                  }}>Trả lại</button>
                  <button type="button" disabled={busy} className={primaryBtn} onClick={() => void runDelivery(() => procurementInboxService.decideDelivery({ deliveryId: d.id, action: 'approve' }), `Đã duyệt bổ sung đợt ${d.deliveryNo} — phiếu nhập kho đã tạo`)}>Duyệt bổ sung</button>
                </>}
                {rejected && d.createdById === currentUserId && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setDeliveryEditor({ delivery: d })}><Pencil size={14} />Sửa đợt</button>}
                {cancellable && !(pending && mine) && <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
                  const reason = await askReason({ title: `Hủy đợt giao ${d.deliveryNo}`, targetName: order.poNumber || '', subtitle: 'Chỉ hủy được khi kho chưa bắt đầu nhận.', reasonLabel: 'Lý do hủy', actionLabel: 'Hủy đợt', intent: 'danger' });
                  if (reason) void runDelivery(() => procurementInboxService.cancelDelivery({ deliveryId: d.id, reason }), `Đã hủy đợt ${d.deliveryNo}`);
                }}>Hủy đợt</button>}
              </div> : null}
            </li>;
          })}</ul>}
      </section>}

      {order.returns.length > 0 && <section>
        <h3 className="mb-2 font-semibold text-foreground">Trả hàng NCC ({order.returns.length})</h3>
        <ul className="space-y-2">{order.returns.map(rt => {
          const value = rt.lines.reduce((sum, l) => sum + l.returnQty * l.unitPrice, 0);
          return <li key={rt.id} className={`rounded-xl border bg-card px-3 py-2.5 ${!rt.resolution ? 'border-amber-300' : 'border-border'}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-foreground">{rt.returnNo}</span>
              <Badge className={rt.status === 'completed' ? 'border-mint-200 bg-mint-50 text-mint-800' : 'border-slate-200 bg-slate-100 text-slate-700'}>
                {rt.status === 'completed' ? 'Kho đã xuất trả' : 'Chờ kho xuất trả'}</Badge>
              <Badge className={rt.resolution === 'replace' ? 'border-leaf-200 bg-leaf-50 text-leaf-800' : rt.resolution === 'credit' ? 'border-mint-200 bg-mint-50 text-mint-800'
                : 'border-amber-300 bg-amber-50 text-amber-800'}>
                {rt.resolution === 'replace' ? 'Đổi hàng — NCC giao lại' : rt.resolution === 'credit' ? 'Giảm trừ công nợ' : 'Chờ Mua hàng quyết định'}</Badge>
              <span className="ml-auto text-sm font-semibold tabular-nums text-leaf-700 dark:text-leaf-300">{money(value)} đ</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {SUPPLIER_RETURN_REASONS[(rt.reasonCode || 'other') as SupplierReturnReasonCode]}: {rt.reason} · {rt.warehouseName} · <span className="text-mint-700 dark:text-mint-300">{rt.createdByName}</span>, {dateVi(rt.createdAt)}</p>
            <ul className="mt-1 text-xs text-muted-foreground">{rt.lines.map(l => <li key={l.lineId}>{l.name}: trả <b className="text-leaf-700 dark:text-leaf-300">{fmt(l.returnQty, 3)} {l.unit}</b>
              {l.stockUnit && l.stockUnit !== l.unit ? ` = ${fmt(l.stockReturnQty, 3)} ${l.stockUnit}` : ''}</li>)}</ul>
            {rt.resolutionByName && <p className="mt-1 text-xs text-muted-foreground">Quyết định bởi {rt.resolutionByName}{rt.resolutionNote ? `: ${rt.resolutionNote}` : ''}</p>}
            {perms?.canDecideReturn && (!rt.resolution || rt.status === 'pending') && <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-muted-foreground">Đã thống nhất với NCC?</span>
              <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void runDelivery(() => procurementInboxService.decideReturn({ returnId: rt.id, resolution: 'credit' }),
                `${rt.returnNo}: giảm trừ — phần trả quay lại Cần mua khi kho xuất trả xong`)}>Giảm trừ</button>
              <button type="button" disabled={busy} className={primaryBtn} onClick={() => void runDelivery(() => procurementInboxService.decideReturn({ returnId: rt.id, resolution: 'replace' }),
                `${rt.returnNo}: đổi hàng — lập đợt giao bù khi NCC giao lại`)}>Đổi hàng</button>
            </div>}
          </li>;
        })}</ul>
      </section>}

      {order.events.length > 0 && <section>
        <h3 className="mb-2 font-semibold text-foreground">Lịch sử</h3>
        <ol className="space-y-1 text-sm">{order.events.map((e, i) => <li key={i} className="flex flex-wrap gap-x-2 text-muted-foreground">
          <span className="tabular-nums">{new Date(e.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span className="font-medium text-foreground">{EVENT_LABELS[e.action] || e.action}</span><span>· {e.actorName}</span>
          {e.payload?.sourceCode && <span>· {e.payload.sourceCode}{e.payload.qty != null ? ` (${fmt(e.payload.qty, 3)})` : ''}</span>}
          {e.reason && <span className="w-full pl-4 italic">“{e.reason}”</span>}</li>)}</ol>
      </section>}
    </>}
  </Drawer>;
};

export default OrderDrawer;
