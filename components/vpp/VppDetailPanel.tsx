import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpFromLine, Check, CornerUpLeft, History, Loader2, Pencil, Undo2, X, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM } from '../finance/financeUi';
import { Panel, Section, dateVi } from '../wms/wmsUi';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import {
  VPP_STATUS_LABEL, isVppConflict, officeSupplyService, qtyText, vppErrorMessage,
  type VppCatalogItem, type VppDetail, type VppStatus,
} from '../../lib/officeSupplyService';

// Chi tiết một đề xuất VPP: người duyệt sửa số duyệt; thủ kho cấp (cấp thiếu được), gán mã cho món chưa có mã, nhận trả lại.

export const VPP_STATUS_TONE: Record<VppStatus, string> = {
  pending: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  pending_threshold: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  returned: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  approved: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
  partial: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200',
  issued: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200',
  closed: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  rejected: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};
export const VppStatusBadge: React.FC<{ status: VppStatus }> = ({ status }) => <Badge className={VPP_STATUS_TONE[status]}>{VPP_STATUS_LABEL[status]}</Badge>;

const EVENT_LABEL: Record<string, string> = {
  submit: 'Gửi đề xuất', resubmit: 'Gửi lại', approve: 'Duyệt', approve_threshold: 'Duyệt vượt ngưỡng', reject: 'Từ chối', return: 'Trả lại để sửa',
  cancel: 'Hủy phiếu', close: 'Đóng phần còn lại', issue: 'Cấp phát', return_stock: 'Nhận trả lại kho', map_item: 'Gán mã VPP',
};
const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const VppDetailPanel: React.FC<{
  detail: VppDetail; catalog: VppCatalogItem[]; onBack: () => void; onChanged: (d: VppDetail | null) => void; onEdit: () => void;
}> = ({ detail: d, catalog, onBack, onChanged, onEdit }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [issue, setIssue] = useState<Record<string, string>>({});
  const [mapTo, setMapTo] = useState<Record<string, string>>({});
  const [issueDate, setIssueDate] = useState(today());
  const [returning, setReturning] = useState(false);
  const [back, setBack] = useState<Record<string, string>>({});
  const [showLog, setShowLog] = useState(false);

  const approving = d.can.approve && d.status === 'pending';
  const issuing = d.can.issue;
  useEffect(() => {
    setApproved(Object.fromEntries(d.lines.map(l => [l.id, String(l.approvedQty ?? l.requestedQty)])));
    setIssue(Object.fromEntries(d.lines.map(l => {
      const left = Math.max(0, (l.approvedQty ?? 0) - l.issuedQty);
      return [l.id, String(l.itemId ? Math.min(left, Math.max(0, l.stock ?? 0)) : left)];
    })));
    setMapTo({}); setBack({}); setReturning(false);
  }, [d]);

  const run = async (name: string, fn: () => Promise<VppDetail>, ok: string) => {
    setBusy(name);
    try { const next = await fn(); toast.success(ok, next.code); onChanged(next); }
    catch (e) {
      toast.error('Chưa thực hiện được', vppErrorMessage(e));
      if (isVppConflict(e)) officeSupplyService.get(d.id).then(onChanged).catch(() => undefined);
    } finally { setBusy(null); }
  };

  const approveLines = d.lines.map(l => ({ lineId: l.id, approvedQty: num(approved[l.id] ?? '') }));
  const approveInvalid = approveLines.some((x, i) => Number.isNaN(x.approvedQty) || x.approvedQty < 0 || x.approvedQty > d.lines[i].requestedQty)
    || approveLines.every(x => !(x.approvedQty > 0));
  const issueLines = d.lines.map(l => ({ lineId: l.id, qty: num(issue[l.id] ?? '0') || 0, itemId: l.itemId ? undefined : mapTo[l.id] || null }));
  const issueProblem = useMemo(() => {
    if (!issuing) return null;
    const picked = issueLines.filter(x => x.qty > 0);
    if (!picked.length) {
      const waiting = d.lines.filter(l => (l.approvedQty ?? 0) > l.issuedQty);
      return waiting.length && waiting.every(l => l.itemId && (l.stock ?? 0) <= 0)
        ? 'Hết hàng — chờ nhập thêm hoặc Đóng phần còn lại' : 'Nhập số cấp cho ít nhất một món';
    }
    for (const x of picked) {
      const l = d.lines.find(y => y.id === x.lineId)!;
      if (x.qty > (l.approvedQty ?? 0) - l.issuedQty) return `${l.name}: vượt số còn phải cấp`;
      if (!l.itemId && !x.itemId) return `${l.name}: chọn mã VPP trước khi cấp`;
      if (l.itemId && l.stock != null && x.qty > l.stock) return `${l.name}: kho chỉ còn ${qtyText(l.stock)}`;
    }
    return null;
  }, [issuing, issueLines, d.lines]);
  const backLines = d.lines.map(l => ({ lineId: l.id, qty: num(back[l.id] ?? '0') || 0 })).filter(x => x.qty > 0);

  const doApprove = () => {
    const changed = d.lines.filter(l => num(approved[l.id] ?? '') !== l.requestedQty).length;
    return run('approve', () => officeSupplyService.act({ id: d.id, action: 'approve', expectedRowVersion: d.rowVersion, lines: approveLines }),
      d.can.onBehalf ? `Đã duyệt thay ${d.approverName || ''}`.trim() : changed ? `Đã duyệt (sửa ${changed} món)` : 'Đã duyệt');
  };
  const doReason = async (action: 'reject' | 'return' | 'cancel' | 'close', title: string, label: string, intent: 'danger' | 'warning') => {
    const reason = await reasonConfirm({ title, targetName: `${d.code} · ${d.requesterName}`, reasonLabel: label, actionLabel: title, intent });
    if (reason == null) return;
    await run(action, () => officeSupplyService.act({ id: d.id, action, expectedRowVersion: d.rowVersion, reason }), `${title} xong`);
  };
  const doIssue = async () => {
    const picked = issueLines.filter(x => x.qty > 0);
    const left = d.lines.reduce((s, l) => s + Math.max(0, (l.approvedQty ?? 0) - l.issuedQty), 0) - picked.reduce((s, x) => s + x.qty, 0);
    const ok = await confirm({ title: 'Cấp phát VPP', confirmText: 'Cấp cho', targetName: `${d.requesterName} · ${d.code}`, intent: 'success',
      subtitle: picked.map(x => { const l = d.lines.find(y => y.id === x.lineId)!; return `${l.name} ×${qtyText(x.qty)}`; }).join(', '),
      warningText: `Trừ tồn ${d.warehouseName} ngay.${left > 0 ? ' Phần còn thiếu vẫn chờ cấp.' : ''}`,
      actionLabel: 'Cấp phát', cancelLabel: 'Xem lại', countdownSeconds: 0 });
    if (!ok) return;
    await run('issue', () => officeSupplyService.issue({ id: d.id, expectedRowVersion: d.rowVersion, date: issueDate, lines: picked }), 'Đã cấp phát, trừ tồn kho');
  };
  const doReturn = async () => {
    const reason = await reasonConfirm({ title: 'Nhận trả lại kho', targetName: `${d.code} · ${d.requesterName}`, reasonLabel: 'Lý do trả lại',
      reasonPlaceholder: 'Cấp nhầm, dùng không hết…', actionLabel: 'Nhận trả lại', intent: 'warning' });
    if (reason == null) return;
    await run('back', () => officeSupplyService.returnStock({ id: d.id, reason, lines: backLines }), 'Đã nhập lại kho');
  };

  const showStock = d.lines.some(l => l.stock != null);
  // Người duyệt sửa số: giá trị ước tính tính lại ngay (giá bình quân kho; món chưa có mã không tính).
  const estimate = approving && d.estimatedAmount != null
    ? Math.round(d.lines.reduce((s, l) => s + (Number.isNaN(num(approved[l.id] ?? '')) ? 0 : num(approved[l.id] ?? '')) * (l.unitCost ?? 0), 0))
    : d.estimatedAmount;
  const reasonText = d.closedReason || [...d.events].reverse().find(e => ['return', 'reject'].includes(e.action))?.note;

  const foot = <>
    {d.can.edit && <button type="button" onClick={onEdit} className={`${secondaryBtn} flex-1 md:flex-none`}><Pencil size={15} />Sửa</button>}
    {d.can.cancel && <button type="button" disabled={!!busy} onClick={() => doReason('cancel', 'Hủy phiếu', 'Lý do hủy', 'danger')} className={`${secondaryBtn} flex-1 md:flex-none`}><XCircle size={15} />Hủy phiếu</button>}
    {d.can.approve && <>
      <button type="button" disabled={!!busy} onClick={() => doReason('return', 'Trả lại để sửa', 'Cần sửa gì', 'warning')} className={`${secondaryBtn} flex-1 md:flex-none`}><CornerUpLeft size={15} />Trả lại</button>
      <button type="button" disabled={!!busy} onClick={() => doReason('reject', 'Từ chối', 'Lý do từ chối', 'danger')} className={`${secondaryBtn} flex-1 text-rose-700 md:flex-none dark:text-rose-300`}><X size={15} />Từ chối</button>
      <button type="button" disabled={!!busy || (approving && approveInvalid)} onClick={doApprove} title={approving && approveInvalid ? 'Số duyệt phải từ 0 đến số đề xuất, ít nhất một món > 0' : undefined}
        className={`${primaryBtn} flex-1 md:flex-none`}>{busy === 'approve' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{d.can.onBehalf ? 'Duyệt thay' : 'Duyệt'}</button>
    </>}
    {d.can.close && <button type="button" disabled={!!busy} onClick={() => doReason('close', 'Đóng phần còn lại', 'Lý do (hết hàng, không mua…)', 'warning')} className={`${secondaryBtn} flex-1 md:flex-none`}>Đóng phần còn lại</button>}
    {d.can.return && !returning && <button type="button" onClick={() => setReturning(true)} className={`${secondaryBtn} flex-1 md:flex-none`}><Undo2 size={15} />Nhận trả lại</button>}
    {returning && <button type="button" disabled={!!busy || !backLines.length} onClick={doReturn} title={!backLines.length ? 'Nhập số trả lại' : undefined} className={`${primaryBtn} flex-1 md:flex-none`}>
      {busy === 'back' ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />}Nhập lại kho</button>}
    {issuing && !returning && <button type="button" disabled={!!busy || !!issueProblem} onClick={doIssue} title={issueProblem || undefined} className={`${primaryBtn} flex-1 md:flex-none`}>
      {busy === 'issue' ? <Loader2 size={15} className="animate-spin" /> : <ArrowUpFromLine size={15} />}Cấp phát</button>}
  </>;
  const hasFoot = d.can.edit || d.can.cancel || d.can.approve || d.can.close || d.can.return || issuing;

  return <Panel onBack={onBack} foot={hasFoot ? foot : undefined} head={<div>
    <div className="flex flex-wrap items-center gap-2"><span className={`font-mono text-sm ${ENT}`}>{d.code}</span><VppStatusBadge status={d.status} />
      {d.thresholdRequired && <Badge className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Vượt ngưỡng</Badge>}</div>
    <h2 className="mt-1 text-lg font-bold"><span className={ENT}>{d.requesterName}</span>{d.orgUnitName && <span className="font-normal text-muted-foreground"> · {d.orgUnitName}</span>}</h2>
    <p className="text-[13px] text-muted-foreground">Gửi {dateVi(d.submittedAt)} · {d.warehouseName}</p>
  </div>}>
    {reasonText && ['returned', 'rejected', 'closed', 'cancelled'].includes(d.status) &&
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{reasonText}</p>}
    {['pending', 'pending_threshold'].includes(d.status) && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {d.approverName
        ? <span>{d.status === 'pending_threshold' ? 'Chờ duyệt vượt ngưỡng' : 'Chờ duyệt'}: <b className={ENT}>{d.approverName}</b></span>
        : <span className="inline-flex items-center gap-1 font-semibold text-rose-700 dark:text-rose-300"><AlertTriangle size={14} />Chưa có người duyệt</span>}
      {d.can.onBehalf && <Badge className="border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">Bạn duyệt thay</Badge>}
    </div>}
    {d.note && <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm">{d.note}</p>}

    <Section title={`${d.lines.length} món`} right={estimate != null && estimate > 0
      ? <span className="text-sm" title="Theo giá bình quân trong kho; món chưa có mã không tính">≈ <b className={NUM}>{money(estimate)}</b> đ</span> : undefined}>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[12px] text-muted-foreground"><tr>
            <th className="px-3 py-2 text-left font-semibold">Món</th>
            <th className="px-2 py-2 text-right font-semibold">Đề xuất</th>
            <th className="px-2 py-2 text-right font-semibold">Duyệt</th>
            {d.lines.some(l => l.issuedQty > 0) || issuing ? <th className="px-2 py-2 text-right font-semibold">Đã cấp</th> : null}
            {showStock && <th className="px-2 py-2 text-right font-semibold">Tồn</th>}
            {issuing && !returning && <th className="px-2 py-2 text-right font-semibold">Cấp lần này</th>}
            {returning && <th className="px-2 py-2 text-right font-semibold">Trả lại</th>}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {d.lines.map(l => {
              const left = Math.max(0, (l.approvedQty ?? 0) - l.issuedQty);
              return <tr key={l.id} className="align-top">
                <td className="px-3 py-2">
                  <p className={l.itemId ? ENT : 'font-semibold'}>{l.name}</p>
                  <p className="text-[12px] text-muted-foreground">{l.sku || 'Chưa có mã'} · {l.unit}{l.returnedQty > 0 ? ` · đã trả ${qtyText(l.returnedQty)}` : ''}</p>
                  {issuing && !returning && !l.itemId && left > 0 && <select value={mapTo[l.id] || ''} onChange={e => setMapTo(m => ({ ...m, [l.id]: e.target.value }))}
                    aria-label={`Mã VPP cho ${l.name}`} className={`mt-1 w-full max-w-xs ${inputCls} text-[12px]`}>
                    <option value="">Chọn mã VPP để cấp…</option>
                    {catalog.map(c => <option key={c.itemId} value={c.itemId}>{c.sku} · {c.name} ({c.unit})</option>)}
                  </select>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{qtyText(l.requestedQty)}</td>
                <td className="px-2 py-2 text-right">{approving
                  ? <input inputMode="decimal" value={approved[l.id] ?? ''} onChange={e => setApproved(a => ({ ...a, [l.id]: e.target.value }))} aria-label={`Số duyệt ${l.name}`}
                    className={`w-16 ${inputCls} text-right text-[13px] tabular-nums`} />
                  : <span className={`tabular-nums ${l.approvedQty != null && l.approvedQty < l.requestedQty ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`}>{qtyText(l.approvedQty)}</span>}</td>
                {d.lines.some(x => x.issuedQty > 0) || issuing ? <td className={`px-2 py-2 text-right ${NUM}`}>{qtyText(l.issuedQty)}</td> : null}
                {showStock && <td className={`px-2 py-2 text-right tabular-nums ${l.stock != null && l.stock < left ? 'font-semibold text-rose-700 dark:text-rose-300' : ''}`}>{qtyText(l.stock)}</td>}
                {issuing && !returning && <td className="px-2 py-2 text-right">{left > 0
                  ? <input inputMode="decimal" value={issue[l.id] ?? ''} onChange={e => setIssue(a => ({ ...a, [l.id]: e.target.value }))} aria-label={`Cấp ${l.name}`}
                    className={`w-16 ${inputCls} text-right text-[13px] tabular-nums`} />
                  : <span className="text-[12px] text-muted-foreground">Đủ</span>}</td>}
                {returning && <td className="px-2 py-2 text-right">{l.issuedQty > l.returnedQty
                  ? <input inputMode="decimal" value={back[l.id] ?? ''} onChange={e => setBack(a => ({ ...a, [l.id]: e.target.value }))} placeholder="0" aria-label={`Trả lại ${l.name}`}
                    className={`w-16 ${inputCls} text-right text-[13px] tabular-nums`} />
                  : <span className="text-[12px] text-muted-foreground">—</span>}</td>}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {issuing && !returning && <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold">Ngày cấp
          <input type="date" value={issueDate} max={today()} onChange={e => setIssueDate(e.target.value)} className={`${inputCls} text-[13px]`} /></label>
        {issueProblem && <span className="text-[13px] text-amber-700 dark:text-amber-300">{issueProblem}</span>}
      </div>}
      {returning && <button type="button" onClick={() => setReturning(false)} className="mt-2 text-sm font-semibold text-teal-700 dark:text-teal-300">Thôi, không nhận trả</button>}
    </Section>

    {d.moves.length > 0 && <Section title="Phiếu kho">
      <ul className="space-y-1 text-sm">{d.moves.map(m => <li key={m.transactionId} className="flex items-center gap-2">
        <Link to={`/inventory?tx=${m.transactionId}`} className={`font-mono ${ENT} hover:underline`}>{m.code || m.transactionId.slice(-8)}</Link>
        <span className="text-muted-foreground">{m.event === 'office_supply_return' ? 'Trả lại kho' : 'Xuất cấp'} · {dateVi(m.date)}</span></li>)}</ul>
    </Section>}

    <Section title={<button type="button" onClick={() => setShowLog(s => !s)} className="inline-flex items-center gap-1.5"><History size={14} />Lịch sử ({d.events.length})</button>}>
      {showLog && <ol className="space-y-1.5 border-l-2 border-l-teal-200 pl-3 text-sm dark:border-l-teal-800">
        {d.events.map((e, i) => <li key={i}>
          <span className="font-semibold">{EVENT_LABEL[e.action] || e.action}</span>
          <span className="text-muted-foreground"> · {e.actorName || '—'}{e.onBehalfOfName ? ` (thay ${e.onBehalfOfName})` : ''} · {new Date(e.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
          {e.note && <p className="text-[13px]">{e.note}</p>}
        </li>)}
      </ol>}
    </Section>
  </Panel>;
};
