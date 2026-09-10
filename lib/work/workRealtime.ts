import type { SupabaseClient } from '@supabase/supabase-js';
import { isViooWorkEnabled } from '../featureFlags';

export interface WorkInvalidation { reason: 'revision' | 'access_revision' | 'refresh'; taskId?: string }
/** Mount within the Work scope and dispose/recreate on account changes. Consumers
 * refetch authorized RPC projections; no event payload is merged into cached tasks. */
export function subscribeWorkInvalidation(
  client: Pick<SupabaseClient, 'channel' | 'removeChannel'>,
  invalidate: (event: WorkInvalidation) => void,
  options: { enabled?: boolean; taskId?: string; actorId?: string; eventTarget?: EventTarget } = {},
): () => void {
  if (!(options.enabled ?? isViooWorkEnabled)) return () => {};
  let disposed = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();
  const refresh = () => { if (!disposed) invalidate({ reason: 'refresh', taskId: options.taskId }); };
  const changed = (payload: { new: Record<string, unknown> }) => {
    if (disposed || typeof payload.new?.task_id !== 'string') return;
    const taskId = payload.new.task_id;
    if (options.taskId && options.taskId !== taskId) return;
    pending.add(taskId);
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = undefined;
      if (!disposed) for (const id of pending) invalidate({ reason: 'revision', taskId: id });
      pending.clear();
    }, 250);
  };
  const accessChanged = (payload: { new: Record<string, unknown> }) => {
    if (disposed || payload.new?.user_id !== options.actorId) return;
    generationRefresh();
  };
  const generationRefresh = () => {
    if (!disposed) invalidate({ reason: 'access_revision' });
  };
  const filter = { schema: 'public', table: 'work_task_revisions', ...(options.taskId ? { filter: `task_id=eq.${options.taskId}` } : {}) };
  let channel = client.channel(`work-revisions:${options.taskId ?? 'list'}:${crypto.randomUUID()}`)
    .on('postgres_changes', { ...filter, event: 'INSERT' }, changed)
    .on('postgres_changes', { ...filter, event: 'UPDATE' }, changed);
  if (options.actorId) channel = channel
    .on('postgres_changes', {
      schema: 'public', table: 'work_workspace_user_revisions', event: 'INSERT',
      filter: `user_id=eq.${options.actorId}`,
    }, accessChanged)
    .on('postgres_changes', {
      schema: 'public', table: 'work_workspace_user_revisions', event: 'UPDATE',
      filter: `user_id=eq.${options.actorId}`,
    }, accessChanged);
  channel.subscribe(state => { if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(state)) refresh(); });
  // Revocations may make the last row invisible to Realtime. Polling/focus always
  // rechecks the server's current permission and clears stale content in the UI.
  const interval = setInterval(refresh, 30_000);
  const eventTarget = options.eventTarget ?? (typeof window === 'undefined' ? undefined : window);
  eventTarget?.addEventListener('focus', refresh);
  return () => {
    disposed = true;
    clearInterval(interval);
    clearTimeout(debounce);
    pending.clear();
    eventTarget?.removeEventListener('focus', refresh);
    void client.removeChannel(channel);
  };
}
