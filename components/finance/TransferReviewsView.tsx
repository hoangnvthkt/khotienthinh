import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookCheck, Ban } from 'lucide-react';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceTransferReason, type FinanceTransferReview } from '../../lib/financeService';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, moneyInput, parseMoney, viDate } from './financeUi';

// Chuyển kho giữa dự án mà giá vốn kho gửi chưa tin được (tồn kho Vioo chưa làm sạch theo MISA):
// hệ thống không tự ghi chi phí dự án, kế toán xác nhận số tiền ở đây.

const REASON: Record<FinanceTransferReason, string> = {
  no_value: 'Giá vốn bằng 0',
  dirty_stock: 'Tồn kho gửi chưa sạch',
  no_average: 'Kho gửi chưa có giá trị tồn',
  price_outlier: 'Lệch > 3 lần giá mua',
};

const ReviewCard: React.FC<{ r: FinanceTransferReview; onDone: () => void }> = ({ r, onDone }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [amount, setAmount] = useState(moneyInput(r.suggested));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const value = parseMoney(amount);
  const differs = r.suggested == null || !Number.isFinite(value) || Math.abs(value - r.suggested) > 1;
  const valid = Number.isFinite(value) && value >= 0 && (!differs || reason.trim().length > 0);
  const route = `${r.sourceProject || r.sourceWarehouse || '?'} → ${r.targetProject || r.targetWarehouse || '?'}`;

  const submit = async (amt: number) => {
    const ok = await confirm({
      title: amt > 0 ? 'Ghi chi phí chuyển kho?' : 'Không tính chi phí cho phiếu này?',
      targetName: `${r.transactionId} · ${money(amt)} đ`, confirmText: amt > 0 ? 'Ghi chi phí' : 'Không tính', actionLabel: amt > 0 ? 'Ghi chi phí' : 'Không tính',
      intent: 'success', countdownSeconds: 0,
      warningText: amt > 0
        ? `${r.targetProject ? `${r.targetProject} ghi tăng` : 'Kho công ty nhận'} ${money(amt)} đ${r.sourceProject ? `, ${r.sourceProject} ghi giảm tương ứng` : ''}. Phiếu chuyển bị hủy sau này thì chi phí tự về 0.`
        : 'Không dự án nào ghi chi phí cho phiếu chuyển này. Lý do được lưu vào nhật ký.',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await financeService.confirmTransferCost({ transactionId: r.transactionId, amount: amt, reason: reason.trim() || undefined });
      toast.success('Đã xác nhận chi phí chuyển kho', `${r.transactionId}: ${money(amt)} đ`);
      onDone();
    } catch (e) { toast.error('Chưa xác nhận được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  return <li className="overflow-hidden rounded-2xl border border-amber-200 bg-card shadow-sm dark:border-amber-900/60">
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <span className={ENT}>{r.transactionId}</span> <span className="text-sm text-muted-foreground">· {viDate(r.date)}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-sm"><span className="font-medium">{r.sourceWarehouse || '—'}</span>
          <ArrowRight size={14} className="text-muted-foreground" /><span className="font-medium">{r.targetWarehouse || '—'}</span>
          <span className="text-xs text-muted-foreground">({route})</span></span>
        {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
      </div>
      <span className="text-xs text-muted-foreground sm:text-right">Theo giá kho gửi<span className="block text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">{money(r.ledgerValue)} đ</span></span>
    </div>
    <ul className="divide-y divide-border md:hidden">{r.lines.map(l => <li key={l.itemId} className="px-4 py-2.5 text-sm">
      <span className="font-medium">{l.itemName}</span>{l.reason && <Badge className="ml-1.5 border-amber-300 bg-amber-50 text-amber-800">{REASON[l.reason]}</Badge>}
      <span className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>SL nhận <b className="tabular-nums text-foreground">{money(l.qty)} {l.unit || ''}</b></span>
        <span>Giá kho gửi <b className={`tabular-nums ${l.reason ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>{money(l.unitPrice)}</b></span>
        <span>Giá mua gần nhất <b className="tabular-nums text-foreground">{l.refPrice == null ? 'Chưa có' : money(l.refPrice)}</b></span>
        <span>Gợi ý {l.suggested == null ? <b className="text-foreground">Cần nhập</b> : <b className={NUM}>{money(l.suggested)}</b>}</span>
      </span></li>)}</ul>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>
          <th className="px-4 py-2 font-medium">Vật tư</th><th className="px-2 py-2 text-right font-medium">SL nhận</th>
          <th className="px-2 py-2 text-right font-medium">Giá kho gửi</th><th className="px-2 py-2 text-right font-medium">Giá mua gần nhất</th>
          <th className="px-4 py-2 text-right font-medium">Gợi ý</th></tr></thead>
        <tbody>{r.lines.map(l => <tr key={l.itemId} className="border-t border-border">
          <td className="px-4 py-2"><span className="font-medium">{l.itemName}</span>
            {l.reason && <Badge className="ml-1.5 border-amber-300 bg-amber-50 text-amber-800">{REASON[l.reason]}</Badge>}</td>
          <td className="px-2 py-2 text-right tabular-nums">{money(l.qty)} {l.unit || ''}</td>
          <td className={`px-2 py-2 text-right tabular-nums ${l.reason ? 'text-amber-700 dark:text-amber-300' : ''}`}>{money(l.unitPrice)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{l.refPrice == null ? <span className="text-muted-foreground">Chưa có</span> : money(l.refPrice)}</td>
          <td className={`px-4 py-2 text-right ${NUM}`}>{l.suggested == null ? <span className="font-normal text-muted-foreground">Cần nhập</span> : money(l.suggested)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="flex flex-wrap items-end gap-2 border-t border-border bg-muted/20 px-4 py-3">
      <label className="flex min-w-[10rem] flex-col gap-1 text-xs font-medium text-muted-foreground">Chi phí ghi cho dự án (đ)
        <input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => Number.isFinite(parseMoney(amount)) && setAmount(moneyInput(parseMoney(amount)))}
          className={`${inputCls} text-right tabular-nums`} disabled={!r.canConfirm || busy} /></label>
      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
        <span>Lý do {differs ? <span className="text-amber-700 dark:text-amber-300">— bắt buộc vì {r.suggested == null ? 'chưa có giá gợi ý' : 'khác gợi ý'}</span> : '(không bắt buộc)'}</span>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: Theo giá MISA tháng 9" className={inputCls} disabled={!r.canConfirm || busy} /></label>
      <span className="flex gap-2">
        <button type="button" className={secondaryBtn} disabled={!r.canConfirm || busy || !reason.trim()} title={reason.trim() ? undefined : 'Nhập lý do để không tính chi phí'}
          onClick={() => void submit(0)}><Ban size={15} />Không tính</button>
        <button type="button" className={primaryBtn} disabled={!r.canConfirm || busy || !valid || value <= 0}
          title={r.canConfirm ? undefined : 'Cần quyền Tài chính — Ghi nhận'} onClick={() => void submit(value)}><BookCheck size={15} />Ghi chi phí</button>
      </span>
    </div>
  </li>;
};

export const TransferReviewsView: React.FC<{ onBack: () => void; onChanged: () => void }> = ({ onBack, onChanged }) => {
  const [rows, setRows] = useState<FinanceTransferReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); financeService.transferReviews().then(setRows).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  return <section className="space-y-3">
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
      <button type="button" onClick={onBack} className={`${secondaryBtn} shrink-0 bg-card`}><ArrowLeft size={15} />Về công nợ</button>
      <div className="min-w-0 flex-1"><h2 className="font-bold">Chuyển kho chờ xác nhận giá vốn</h2>
        <p className="text-sm text-muted-foreground">Giá vốn kho gửi chưa tin được nên hệ thống chưa ghi chi phí dự án. Kiểm tra với sổ MISA rồi xác nhận số tiền.</p></div>
    </div>
    {error ? <StateBox kind="error" message={error} onRetry={load} />
      : !rows ? <StateBox kind="loading" title="Đang tải phiếu chuyển kho…" />
        : !rows.length ? <StateBox kind="empty" title="Không có phiếu chuyển kho nào chờ xác nhận" message="Phiếu có giá vốn bất thường sẽ hiện ở đây; phiếu bình thường tự ghi chi phí khi hoàn tất." />
          : <ul className="space-y-3">{rows.map(r => <ReviewCard key={r.transactionId} r={r} onDone={() => { load(); onChanged(); }} />)}</ul>}
  </section>;
};
