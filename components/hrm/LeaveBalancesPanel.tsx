import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { leaveService, type LeaveBalanceRow } from '../../lib/leaveService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import LeaveLedgerDrawer from './LeaveLedgerDrawer';

const formatDays = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

/** HR: everyone's annual leave this year, people without a balance first. */
const LeaveBalancesPanel: React.FC<{ ownEmployeeId: string | undefined }> = ({ ownEmployeeId }) => {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<LeaveBalanceRow[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [open, setOpen] = useState<LeaveBalanceRow | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await leaveService.listBalances(year));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được số phép.');
    }
  }, [year]);

  useEffect(() => { setRows(null); void load(); }, [load]);

  const missing = rows?.filter(row => !row.balance).length ?? 0;
  const visible = useMemo(() => (rows || [])
    .filter(row => !onlyMissing || !row.balance)
    .filter(row => !search || matchesSearchQueryMultiple([row.fullName, row.employeeCode, row.orgUnitName], search)), [onlyMissing, rows, search]);

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm nhân viên, đơn vị…"
          className="min-w-[180px] flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm" />
        <select value={year} onChange={event => setYear(Number(event.target.value))} className="rounded-xl border border-border bg-card px-3 py-2 text-sm" aria-label="Năm">
          {[thisYear + 1, thisYear, thisYear - 1].map(value => <option key={value} value={value}>Năm {value}</option>)}
        </select>
        <button type="button" onClick={() => setOnlyMissing(value => !value)}
          className={`rounded-xl px-3 py-2 text-xs font-black ${onlyMissing ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'}`}>
          Chưa có số phép · {rows ? missing : '…'}
        </button>
        <button type="button" onClick={() => void load()} className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-muted" aria-label="Tải lại">
          <RefreshCw size={14} />
        </button>
      </div>
      <p className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
        Cộng 1 ngày vào mùng 1 hằng tháng sau thử việc. Ngày 01/01 phần còn lại chuyển thành phép tồn, được dùng trước và hết hạn sau 31/03.
      </p>
      {error && <p className="p-4 text-sm font-bold text-rose-600">{error}</p>}
      {rows === null ? (
        <p className="py-14 text-center text-sm text-muted-foreground">Đang tải…</p>
      ) : visible.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">{onlyMissing ? 'Mọi nhân sự đã có số phép.' : 'Không có nhân sự phù hợp.'}</p>
      ) : (
        <div className="divide-y divide-border">
          {visible.map(row => (
            <button key={row.employeeId} type="button" onClick={() => setOpen(row)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-foreground">
                  {row.fullName} <span className="font-mono text-[11px] font-normal text-muted-foreground">{row.employeeCode}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.orgUnitName || 'Chưa có đơn vị'}
                  {row.balance ? ` · đã cộng ${formatDays(row.balance.accruedDays)} · đã nghỉ ${formatDays(row.balance.usedPaidDays)}` : ''}
                  {row.balance && row.balance.carryLeft > 0 ? ` · tồn ${formatDays(row.balance.carryLeft)}` : ''}
                </p>
              </div>
              {row.balance ? (
                <span className="shrink-0 text-right">
                  <span className="block text-base font-black text-mint-700 dark:text-mint-300">{formatDays(row.balance.availableDays)}</span>
                  <span className="block text-[10px] text-muted-foreground">ngày còn lại</span>
                </span>
              ) : (
                <span className="shrink-0 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Chưa có</span>
              )}
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <LeaveLedgerDrawer
          employeeId={open.employeeId}
          employeeName={open.fullName}
          year={year}
          canAdjust={open.employeeId !== ownEmployeeId}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
};

export default LeaveBalancesPanel;
