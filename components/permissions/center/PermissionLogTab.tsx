import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';
import {
  AUDIT_KIND_LABEL, AUDIT_PAGE, auditText, isUnclearReason, permissionBulkService, type AuditKind, type AuditRow,
} from '../../../lib/permissions/permissionBulkService';
import { StateBox, secondaryBtn } from '../../procurement/hub/hubUi';

type LogFilter = 'all' | AuditKind | 'unclear';

const FILTERS: [LogFilter, string][] = [
  ['all', 'Tất cả'], ['template', 'Gắn mẫu'], ['change', 'Đổi quyền'], ['sod', 'Kiêm nhiệm'], ['room', 'Room dự án'], ['unclear', 'Lý do chưa rõ'],
];
const KIND_STYLE: Record<AuditKind, string> = {
  template: 'bg-teal-50 text-teal-800', change: 'bg-slate-100 text-slate-700', sod: 'bg-amber-50 text-amber-800',
  room: 'bg-sky-50 text-sky-800', role: 'bg-violet-50 text-violet-800', account: 'bg-rose-50 text-rose-800',
};

const when = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Nhật ký phân quyền: ai đổi gì của ai, vì sao; lọc nhanh và đánh dấu lý do chưa rõ. */
const PermissionLogTab: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [more, setMore] = useState<'idle' | 'loading' | 'end'>('idle');
  const [filter, setFilter] = useState<LogFilter>('all');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const next = await permissionBulkService.listAudit();
      setRows(next); setMore(next.length < AUDIT_PAGE ? 'end' : 'idle'); setState('ready');
    } catch (loadError) {
      logApiError('permissionLog.load', loadError);
      setError(getApiErrorMessage(loadError, 'Không tải được nhật ký phân quyền.')); setState('error');
    }
  }, []);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setMore('loading');
    try {
      const next = await permissionBulkService.listAudit(last.at);
      setRows(current => [...current, ...next.filter(row => !current.some(item => item.id === row.id))]);
      setMore(next.length < AUDIT_PAGE ? 'end' : 'idle');
    } catch (loadError) {
      logApiError('permissionLog.more', loadError);
      setMore('idle');
    }
  };

  const match = (row: AuditRow, key: LogFilter) => key === 'all' || (key === 'unclear' ? isUnclearReason(row) : row.kind === key);
  const visible = useMemo(() => rows.filter(row => match(row, filter)), [rows, filter]);

  if (state === 'loading' && !rows.length) return <StateBox kind="loading" title="Đang tải nhật ký…" />;
  if (state === 'error' && !rows.length) return <StateBox kind="error" message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-3">
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl border border-border bg-card p-3 md:flex-wrap">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${filter === key ? 'border-teal-700 bg-teal-700 text-white' : key === 'unclear' ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100' : 'border-border bg-background text-foreground hover:bg-muted'}`}>
            {label}<span className="tabular-nums opacity-75">{rows.filter(row => match(row, key)).length}</span>
          </button>
        ))}
      </div>
      <p className="px-1 text-sm text-muted-foreground">{rows.length} thay đổi gần nhất</p>
      {visible.length === 0 && <StateBox kind="empty" title="Không có thay đổi nào khớp" message="Chọn bộ lọc khác hoặc xem thêm thay đổi cũ hơn." />}
      {visible.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {visible.map(row => {
            const unclear = isUnclearReason(row);
            return (
              <li key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
                <span className="w-24 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{when(row.at)}</span>
                <span className="min-w-0 flex-[1_1_260px] space-y-1">
                  <span className="block text-sm text-foreground"><b className="font-semibold">{row.actor}</b> {auditText(row)}</span>
                  {row.kind === 'room' && !row.reason ? null : unclear
                    ? <span className="inline-flex max-w-full rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Lý do chưa rõ{row.reason ? `: “${row.reason}”` : ''}</span>
                    : <span className="block text-xs text-muted-foreground">Lý do: {row.reason}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[row.kind]}`}>{AUDIT_KIND_LABEL[row.kind]}</span>
              </li>
            );
          })}
        </ul>
      )}
      {more !== 'end' && (
        <button type="button" onClick={() => void loadMore()} disabled={more === 'loading'} className={`${secondaryBtn} min-h-10 w-full`}>
          {more === 'loading' && <Loader2 size={15} className="animate-spin" />} Xem thêm thay đổi cũ hơn
        </button>
      )}
    </div>
  );
};

export default PermissionLogTab;
