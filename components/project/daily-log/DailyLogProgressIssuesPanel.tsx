import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { describeDailyLogProgressIssue, type DailyLogProgressIssue } from '../../../lib/dailyLogProgressIssues';

interface Props {
  issues: DailyLogProgressIssue[];
  busy: boolean;
  /** Trả đúng phiếu gây lệch; không truyền khi người xem không có quyền trả. */
  onReturn?: (summarySourceId: string, reason: string) => Promise<void>;
  returnDisabledReason?: string;
}

/** Hạng mục lệch lũy kế làm Duyệt & công bố bị chặn: chỉ đúng hạng mục, khu vực, người lập và cách sửa. */
export const DailyLogProgressIssuesPanel: React.FC<Props> = ({ issues, busy, onReturn, returnDisabledReason }) => {
  const [returning, setReturning] = useState<{ key: string; sourceId: string } | null>(null);
  const [reason, setReason] = useState('');
  if (issues.length === 0) return null;
  const views = issues.map(describeDailyLogProgressIssue);
  return <section role="alert" aria-label="Hạng mục lệch lũy kế" className="space-y-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-950 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
    <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle size={17} className="shrink-0" />Cần xử lý trước khi duyệt · {views.length} hạng mục</h2>
    <ul className="space-y-2">
      {views.map(view => <li key={view.key} className="rounded-lg border border-rose-200 bg-card p-3 text-foreground dark:border-rose-900">
        <p className="font-semibold break-words">{view.task}</p>
        <p className="mt-1 break-words">{view.problem}</p>
        <p className="mt-1 text-xs text-muted-foreground break-words">{view.fix}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {view.sources.map(source => {
            const open = returning?.key === view.key && returning.sourceId === source.summarySourceId;
            const who = source.authorName || 'kỹ sư';
            return <React.Fragment key={source.summarySourceId}>
              <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">{source.areaName || 'Khu vực chưa rõ'} · phiếu của <b>{who}</b>{view.sources.length > 1 && source.percent != null ? ` · ${source.percent}%` : ''}</span>
              {onReturn && !open && <button type="button" disabled={busy || Boolean(returnDisabledReason)} title={returnDisabledReason}
                onClick={() => { setReturning({ key: view.key, sourceId: source.summarySourceId }); setReason(view.returnReason); }}
                className="min-h-9 rounded-lg border border-amber-300 bg-card px-3 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-200">Trả phiếu cho {who}</button>}
              {open && <span className="flex basis-full flex-wrap items-center gap-2">
                <textarea autoFocus rows={2} value={reason} onChange={event => setReason(event.target.value)} aria-label={`Lý do trả phiếu cho ${who}`}
                  className="min-w-0 flex-1 rounded-lg border border-amber-400 bg-background px-2 py-1.5 text-sm" />
                <button type="button" disabled={busy || !reason.trim()} onClick={async () => { await onReturn?.(source.summarySourceId, reason.trim()); setReturning(null); }}
                  className="min-h-9 rounded-lg bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">Gửi trả</button>
                <button type="button" onClick={() => setReturning(null)} className="min-h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted">Hủy</button>
              </span>}
            </React.Fragment>;
          })}
        </div>
      </li>)}
    </ul>
  </section>;
};
