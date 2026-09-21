import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Loader2, UserRound, X } from 'lucide-react';
import type { User } from '../../types';
import type { ProcurementDemandDetail, ProcurementDocumentRef } from '../../types/procurementWorkbench';
import { formatProcurementQuantity } from '../../lib/procurement/presentation';
import { DemandBalanceBreakdown } from './DemandBalanceBreakdown';

export const DemandPanel: React.FC<{
  detail: ProcurementDemandDetail | null;
  loading: boolean;
  error: string | null;
  users: User[];
  onClose: () => void;
  onOpenDocument: (ref: ProcurementDocumentRef) => void;
  onPlanSupply: () => void;
  onAssign: (userId: string, reason: string) => Promise<void>;
}> = ({ detail, loading, error, users, onClose, onOpenDocument, onPlanSupply, onAssign }) => {
  const [assignee, setAssignee] = useState('');
  const [assigning, setAssigning] = useState(false);
  const eligibleUsers = useMemo(
    () => users.filter(user => user.isActive !== false && user.accountStatus !== 'DISABLED'),
    [users],
  );

  return (
    <aside aria-label="Chi tiết nhu cầu" className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between border-b border-slate-100 px-4 py-4 dark:border-slate-800">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Chi tiết nhu cầu</p>
          <h2 className="mt-1 text-lg font-black">{detail?.title || 'Đang tải hồ sơ'}</h2>
          {detail && <p className="mt-1 font-mono text-xs font-bold text-slate-500">{detail.sourceCode}</p>}
        </div>
        <button type="button" aria-label="Đóng chi tiết" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:hover:bg-slate-800"><X size={19} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? <div className="grid min-h-64 place-items-center text-sm font-bold text-slate-500"><Loader2 className="mb-2 animate-spin text-emerald-600" />Đang tải số liệu mới nhất…</div>
          : error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>
            : detail ? <div className="space-y-5">
              {detail.issues.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <div className="flex items-center gap-2 text-sm font-black text-amber-900 dark:text-amber-200"><AlertTriangle size={16} />Cần đối chiếu trước khi lập phương án</div>
                <ul className="mt-2 space-y-1 text-xs font-semibold text-amber-800 dark:text-amber-300">{detail.issues.map(issue => <li key={issue.id}>• {issue.message}</li>)}</ul>
              </div>}

              {detail.lines.map(line => <section key={line.id} className="space-y-3">
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white">{line.title}</h3>
                  <p className="text-xs font-semibold text-slate-500">Nhu cầu {formatProcurementQuantity(line.requestedQty)} {line.unit}</p>
                </div>
                <DemandBalanceBreakdown line={line} />
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wide text-slate-400">Phương án & chứng từ</h4>
                  {line.allocations.length === 0 ? <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-500 dark:bg-slate-950/60">Chưa có phương án được ghi nhận.</p>
                    : <div className="mt-2 space-y-2">{line.allocations.map(allocation => <div key={allocation.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-3"><span className="font-black">{allocation.method.toUpperCase()}</span><span className="text-xs font-black text-blue-700 dark:text-blue-300">{allocation.state}</span></div>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{formatProcurementQuantity(allocation.needQty)} {line.unit}</p>
                      {allocation.documentRefs.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{allocation.documentRefs.map(ref => <button
                        key={`${ref.type}:${ref.id}`}
                        type="button"
                        onClick={() => onOpenDocument(ref)}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 hover:border-emerald-300 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:text-slate-200"
                      ><ArrowUpRight size={14} />{ref.label || 'Mở chứng từ'}</button>)}</div>}
                    </div>)}</div>}
                </div>
              </section>)}

              {detail.allowedActions.includes('assign') && <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <label className="text-xs font-black uppercase tracking-wide text-slate-500" htmlFor="procurement-assignee">Người phụ trách</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <select id="procurement-assignee" value={assignee} onChange={event => setAssignee(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-950">
                    <option value="">Chọn người phụ trách</option>
                    {eligibleUsers.map(user => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                  </select>
                  <button type="button" disabled={!assignee || assigning} onClick={async () => { setAssigning(true); try { await onAssign(assignee, 'Phân công từ Procurement Workbench'); } finally { setAssigning(false); } }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-50 dark:bg-white dark:text-slate-900">
                    {assigning ? <Loader2 size={16} className="animate-spin" /> : <UserRound size={16} />} Giao việc
                  </button>
                </div>
              </div>}
            </div> : null}
      </div>

      {detail && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
        {detail.sourceRef && <button type="button" onClick={() => onOpenDocument(detail.sourceRef!)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700 hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-200"><ArrowUpRight size={16} />Mở đề xuất gốc</button>}
        {detail.allowedActions.includes('plan_supply') && <button type="button" onClick={onPlanSupply} className="inline-flex min-h-11 items-center rounded-xl bg-emerald-600 px-4 text-sm font-black text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700">Lập phương án mua</button>}
      </div>}
    </aside>
  );
};
