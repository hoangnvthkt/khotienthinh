import React, { useCallback, useEffect, useState } from 'react';
import { projectV2ReadService, type ProjectV2CollaborationCursor,
  type ProjectV2Comment } from '../../lib/projectV2/readService';
import { projectV2CommandService } from '../../lib/projectV2/commandService';
import { canSubmitProjectV2Comment } from '../../lib/projectV2/collaboration';

export function ProjectV2PlanDiscussion({ planId, version, names, formDirty, readOnly,
  onDraftChange, onChanged, onError }: { planId: string; version: number;
  names: Record<string, string>; formDirty: boolean; readOnly: boolean;
  onDraftChange: (dirty: boolean) => void;
  onChanged: () => void; onError: (cause: unknown) => void }) {
  const [comments, setComments] = useState<ProjectV2Comment[]>([]);
  const [cursor, setCursor] = useState<ProjectV2CollaborationCursor | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { onDraftChange(Boolean(body.trim())); }, [body, onDraftChange]);
  useEffect(() => () => onDraftChange(false), [onDraftChange]);
  const load = useCallback(async (before: ProjectV2CollaborationCursor | null) => {
    setLoading(true); setError('');
    try {
      const page = await projectV2ReadService.getCollaborationPage(planId, 'comments', 30, before);
      const rows = page.items.filter((item): item is ProjectV2Comment => item.kind === 'comments');
      setComments(current => before ? [...current, ...rows.filter(row => !current.some(old => old.id === row.id))] : rows);
      setCursor(page.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được trao đổi.'); }
    finally { setLoading(false); }
  }, [planId]);
  useEffect(() => { void load(null); }, [load, version]);
  const send = async () => {
    if (!canSubmitProjectV2Comment(body, formDirty || readOnly) || busy) return;
    setBusy(true); setError('');
    try {
      await projectV2CommandService.addComment({ planId, expectedVersion: version,
        idempotencyKey: crypto.randomUUID(), body: body.trim() });
      setBody(''); await load(null); onChanged();
    } catch (cause) { onError(cause); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-label="Trao đổi">
    <h2 className="text-lg font-bold">Trao đổi về kế hoạch</h2>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {comments.length ? comments.map(item => <article key={item.id} className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
      <p className="font-semibold">{names[item.authorUserId] ?? 'Người dùng'} <span className="font-normal text-slate-500">· {new Date(item.createdAt).toLocaleString('vi-VN')} · bản {item.revision}</span></p>
      <p className="mt-2 whitespace-pre-wrap break-words">{item.body}</p>
    </article>) : !loading && <p className="text-sm text-slate-500">Chưa có trao đổi.</p>}
    {loading && <p role="status" className="text-sm text-slate-500">Đang tải trao đổi…</p>}
    {cursor && <button type="button" disabled={loading} onClick={() => void load(cursor)}
      className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Xem trao đổi cũ hơn</button>}
    <label className="block text-sm font-medium">Thêm trao đổi<textarea value={body} disabled={readOnly}
      onChange={event => setBody(event.target.value)}
      className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800" /></label>
    {formDirty && <p className="text-sm text-amber-700">Lưu hoặc bỏ thay đổi trước khi trao đổi.</p>}
    {readOnly && <p className="text-sm text-slate-500">Bản đã duyệt này chỉ để xem. Mở bản mới nhất để trao đổi.</p>}
    <button type="button" disabled={!canSubmitProjectV2Comment(body, formDirty || readOnly) || busy}
      onClick={() => void send()} className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Gửi trao đổi</button>
  </section>;
}
