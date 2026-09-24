import React, { useCallback, useEffect, useState } from 'react';
import { projectV2ReadService, type ProjectV2CollaborationCursor,
  type ProjectV2Event } from '../../lib/projectV2/readService';
import { projectV2ActivityLabel } from '../../lib/projectV2/collaboration';

export function ProjectV2PlanActivity({ planId, names }: {
  planId: string; names: Record<string, string> }) {
  const [events, setEvents] = useState<ProjectV2Event[]>([]);
  const [cursor, setCursor] = useState<ProjectV2CollaborationCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (before: ProjectV2CollaborationCursor | null) => {
    setLoading(true); setError('');
    try {
      const page = await projectV2ReadService.getCollaborationPage(planId, 'events', 30, before);
      const rows = page.items.filter((item): item is ProjectV2Event => item.kind === 'events');
      setEvents(current => before ? [...current, ...rows.filter(row => !current.some(old => old.id === row.id))] : rows);
      setCursor(page.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được hoạt động.'); }
    finally { setLoading(false); }
  }, [planId]);
  useEffect(() => { void load(null); }, [load]);
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-label="Hoạt động">
    <h2 className="text-lg font-bold">Hoạt động kế hoạch</h2>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {events.length ? events.map(event => <article key={event.id} className="border-l-2 border-teal-600 py-1 pl-4 text-sm">
      <p className="font-semibold">{projectV2ActivityLabel(event.eventType)}</p>
      <p className="text-slate-500">{names[event.actorUserId] ?? 'Người dùng'} · {new Date(event.occurredAt).toLocaleString('vi-VN')} · bản {event.revision}</p>
      {event.reason && <p className="mt-1 whitespace-pre-wrap break-words">{event.reason}</p>}
    </article>) : !loading && <p className="text-sm text-slate-500">Chưa có hoạt động.</p>}
    {loading && <p role="status" className="text-sm text-slate-500">Đang tải hoạt động…</p>}
    {cursor && <button type="button" disabled={loading} onClick={() => void load(cursor)}
      className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Xem hoạt động cũ hơn</button>}
  </section>;
}
