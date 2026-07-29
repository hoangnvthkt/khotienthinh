import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

type ClaimedOutboxItem = { id: string };

export default {
  fetch: withSupabase({ auth: 'secret' }, async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
    const { limit } = await request.json().catch(() => ({}));
    const { data, error } = await context.supabaseAdmin.rpc('claim_request_notification_outbox', { p_limit: limit ?? 50 });
    if (error) throw error;
    const claimed = Array.isArray(data) ? data as ClaimedOutboxItem[] : [];
    let delivered = 0;
    let failed = 0;
    for (const item of claimed) {
      try {
        const result = await context.supabaseAdmin.rpc('deliver_request_notification', { p_outbox_id: item.id });
        if (result.error) throw result.error;
        delivered += 1;
      } catch (cause) {
        failed += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        const failedResult = await context.supabaseAdmin.rpc('fail_request_notification_outbox', { p_outbox_id: item.id, p_error_message: message });
        if (failedResult.error) console.error('Unable to record request notification failure', failedResult.error);
      }
    }
    return Response.json({ claimed: claimed.length, delivered, failed });
  }),
};
