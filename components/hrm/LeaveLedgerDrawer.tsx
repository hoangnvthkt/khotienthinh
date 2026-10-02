import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { leaveService, type LeaveLedgerBalance, type LeaveLedgerEntry, type LeaveLedgerKind } from '../../lib/leaveService';

const KIND_LABEL: Record<LeaveLedgerKind, string> = {
  opening: 'Số dư ban đầu',
  accrual: 'Cộng phép hằng tháng',
  leave: 'Nghỉ phép năm',
  leave_cancel: 'Hoàn phép do hủy đơn',
  carry_in: 'Phép tồn năm trước chuyển sang',
  carry_expire: 'Phép tồn hết hạn',
  adjust: 'HR điều chỉnh',
};

const formatDays = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN');
const formatDateTime = (value: string) => new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** One person's annual leave: what is left, carried days and every add / deduct line. */
const LeaveLedgerDrawer: React.FC<{
  employeeId: string;
  employeeName: string;
  year: number;
  canAdjust: boolean;
  onClose: () => void;
  onChanged?: () => void;
}> = ({ employeeId, employeeName, year, canAdjust, onClose, onChanged }) => {
  const [balance, setBalance] = useState<LeaveLedgerBalance | null>(null);
  const [entries, setEntries] = useState<LeaveLedgerEntry[] | null>(null);
  const [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [remaining, setRemaining] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await leaveService.ledger(employeeId, year);
      setBalance(result.balance);
      setEntries(result.entries);
      setRemaining(result.balance ? String(result.balance.availableDays) : '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được sổ phép.');
      setEntries([]);
    }
  }, [employeeId, year]);

  useEffect(() => { void load(); }, [load]);

  const remainingValue = Number(remaining.replace(',', '.'));
  const validRemaining = remaining.trim() !== '' && Number.isFinite(remainingValue) && Math.round(remainingValue * 2) === remainingValue * 2;
  const unchanged = balance !== null && remainingValue === balance.availableDays;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await leaveService.adjustBalance(employeeId, year, remainingValue, reason.trim());
      setAdjusting(false);
      setReason('');
      await load();
      onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không điều chỉnh được số phép.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={`Sổ phép ${employeeName}`}>
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="flex w-full max-w-lg flex-col bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <p className="text-[11px] font-bold text-muted-foreground">Sổ phép năm {year}</p>
            <h2 className="text-lg font-black text-foreground">{employeeName}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-muted-foreground hover:bg-muted" aria-label="Đóng"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {entries === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Đang tải…</p>
          ) : (
            <>
              {balance ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-mint-50 p-3 dark:bg-mint-900/20">
                    <p className="text-[11px] font-black uppercase text-mint-700 dark:text-mint-300">Còn lại</p>
                    <p className="text-2xl font-black text-mint-700 dark:text-mint-300">{formatDays(balance.availableDays)} ngày</p>
                    {balance.pendingDays > 0 && <p className="text-[11px] text-muted-foreground">{formatDays(balance.pendingDays)} ngày đang chờ duyệt</p>}
                  </div>
                  <div className="rounded-2xl bg-muted p-3">
                    <p className="text-[11px] font-black uppercase text-muted-foreground">Phép tồn năm trước</p>
                    <p className="text-2xl font-black text-foreground">{formatDays(balance.carryLeft)} ngày</p>
                    <p className="text-[11px] text-muted-foreground">
                      {balance.carriedDays === 0 ? 'Không có phép tồn'
                        : balance.carryLeft > 0 && balance.carryExpiresOn ? `Dùng trước, hết hạn ${formatDate(balance.carryExpiresOn)}`
                        : balance.carryExpiredDays > 0 ? `${formatDays(balance.carryExpiredDays)} ngày đã hết hạn` : 'Đã dùng hết'}
                    </p>
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    Năm nay đã cộng {formatDays(balance.accruedDays)} ngày · đã nghỉ có lương {formatDays(balance.usedPaidDays)} ngày
                    {balance.usedUnpaidDays > 0 ? ` · không lương ${formatDays(balance.usedUnpaidDays)} ngày` : ''}
                  </p>
                </div>
              ) : (
                <p className="rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  Chưa có số phép năm {year}. {canAdjust ? 'Nhập số ngày còn lại thực tế để bắt đầu.' : 'Liên hệ HR để được thiết lập.'}
                </p>
              )}

              {canAdjust && (adjusting || !balance ? (
                <div className="space-y-3 rounded-2xl border border-border p-4">
                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-foreground">Số ngày phép còn lại thực tế</span>
                    <input value={remaining} onChange={event => setRemaining(event.target.value)} inputMode="decimal" placeholder="Ví dụ: 7,5"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                    <span className="block text-[11px] text-muted-foreground">Bước 0,5 ngày. Phần chênh lệch được ghi thành một dòng "HR điều chỉnh".</span>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-foreground">Lý do</span>
                    <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Ví dụ: đối chiếu sổ phép giấy năm 2026"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" />
                  </label>
                  <div className="flex justify-end gap-2">
                    {balance && <button type="button" onClick={() => setAdjusting(false)} className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-muted-foreground">Hủy</button>}
                    <button type="button" onClick={() => void save()} disabled={saving || !validRemaining || unchanged || reason.trim().length < 5}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-leaf-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setAdjusting(true)} className="text-xs font-bold text-mint-700 hover:underline dark:text-mint-300">
                  Điều chỉnh số còn lại
                </button>
              ))}

              {error && <p className="text-sm font-bold text-rose-600">{error}</p>}

              <div>
                <p className="mb-2 text-xs font-black uppercase text-muted-foreground">Lịch sử cộng / trừ</p>
                {entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có dòng nào.</p>
                ) : (
                  <div className="divide-y divide-border rounded-2xl border border-border">
                    {entries.map(entry => (
                      <div key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-foreground">
                            {KIND_LABEL[entry.kind]}{entry.leaveCode ? <span className="ml-1 font-mono text-[11px] text-muted-foreground">{entry.leaveCode}</span> : null}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDateTime(entry.createdAt)}
                            {entry.leaveStart ? ` · nghỉ ${formatDate(entry.leaveStart)}${entry.leaveEnd && entry.leaveEnd !== entry.leaveStart ? ` → ${formatDate(entry.leaveEnd)}` : ''}` : ''}
                            {entry.kind !== 'carry_in' && entry.kind !== 'carry_expire' && entry.carryDays !== 0 ? ` · ${formatDays(Math.abs(entry.carryDays))} ngày phép tồn` : ''}
                            {entry.actorName && (entry.kind === 'adjust' || entry.kind === 'opening') ? ` · ${entry.actorName}` : ''}
                          </p>
                          {entry.note && entry.kind !== 'accrual' && entry.kind !== 'leave' && <p className="text-[11px] text-muted-foreground">{entry.note}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-sm font-black ${entry.days > 0 ? 'text-leaf-700 dark:text-leaf-300' : entry.days < 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
                            {entry.days > 0 ? '+' : ''}{formatDays(entry.days)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">còn {formatDays(entry.balanceAfter)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeaveLedgerDrawer;
