import React, { useCallback, useEffect, useState } from 'react';
import { BookCheck, Undo2 } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinancePendingStatement } from '../../lib/financeService';
import { StateBox, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, viDate } from './financeUi';

// Bảng đối soát HĐ đã được Mua hàng chốt, chờ kế toán ghi công nợ (người ghi phải khác người chốt).

export const PendingStatementsView: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [rows, setRows] = useState<FinancePendingStatement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); financeService.pendingStatements().then(setRows).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  const act = async (s: FinancePendingStatement, action: 'post' | 'return', reason?: string) => {
    setBusy(s.id);
    try {
      await financeService.postStatement({ statementId: s.id, action, reason });
      toast.success(action === 'post' ? `Đã ghi công nợ ${s.code}` : `Đã trả lại ${s.code}`,
        action === 'post' ? `${s.supplierName}: ${money(s.totalAmount)} đ vào công nợ ${s.projectCode}. Hạn tính theo HĐ/NCC.` : 'Mua hàng sẽ sửa và chốt lại.');
      load(); onChanged();
    } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(null); }
  };
  if (error) return <StateBox kind="error" message={error} onRetry={load} />;
  if (!rows) return <StateBox kind="loading" title="Đang tải bảng đối soát chờ ghi nợ…" />;
  if (!rows.length) return <StateBox kind="empty" title="Không có bảng đối soát chờ ghi công nợ" message="Khi Mua hàng chốt đối soát HĐ tháng, bảng sẽ hiện ở đây để kế toán ghi công nợ." />;
  return <ul className="space-y-2">{rows.map(s => <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
    <span className="min-w-0 flex-1">
      <span className={ENT}>{s.code}</span> <span className="text-sm text-muted-foreground">· {s.supplierName}</span>
      <span className="block text-xs text-muted-foreground">HĐ <span className={ENT}>{s.contractCode || '—'}</span> · {s.projectCode} · kỳ {viDate(s.periodMonth).slice(3)} · chốt bởi <span className={ENT}>{s.confirmedByName || '—'}</span> {viDate(s.confirmedAt)}</span>
    </span>
    <span className={`text-right ${NUM}`}>{money(s.totalAmount)} đ<span className="block text-xs font-normal text-muted-foreground">gồm VAT {money(s.vatAmount)} đ</span></span>
    <span className="flex gap-2">
      <button type="button" disabled={busy === s.id || !s.canPost} className={secondaryBtn} onClick={async () => {
        const reason = await askReason({ title: 'Trả lại bảng đối soát', targetName: s.code, reasonLabel: 'Lý do', reasonPlaceholder: 'VD: Thiếu phiếu giao ngày 12/09', actionLabel: 'Trả lại', intent: 'warning' });
        if (reason) void act(s, 'return', reason);
      }}><Undo2 size={15} />Trả lại</button>
      <button type="button" disabled={busy === s.id || !s.canPost} title={s.canPost ? undefined : 'Bạn là người chốt bảng này hoặc chưa có quyền ghi công nợ'} className={primaryBtn} onClick={async () => {
        if (await confirm({ title: 'Ghi công nợ?', targetName: `${s.code} · ${money(s.totalAmount)} đ`, confirmText: 'Ghi công nợ', actionLabel: 'Ghi công nợ', intent: 'success', countdownSeconds: 0,
          warningText: 'Sinh chứng từ công nợ NCC và chi phí vật tư của dự án. Sai thì đảo bằng chứng từ điều chỉnh, không sửa đè.' })) void act(s, 'post');
      }}><BookCheck size={15} />Ghi công nợ</button>
    </span>
  </li>)}</ul>;
};
