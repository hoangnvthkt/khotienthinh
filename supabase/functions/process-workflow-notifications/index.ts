import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';
import { runWorkflowNotificationWorker } from './worker.ts';

export default {
  fetch: withSupabase({ auth: 'secret' }, async (request, context) => {
    if (request.method === 'GET' && new URL(request.url).searchParams.has('health')) {
      return Response.json({ ok: true });
    }
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
    const input = await request.json().catch(() => ({}));
    try {
      const result = await runWorkflowNotificationWorker(context.supabaseAdmin, input?.limit);
      return Response.json(result);
    } catch (cause) {
      console.error('Workflow notification worker failed', cause instanceof Error ? cause.message : 'unknown error');
      return Response.json({ error: 'Workflow notification worker failed' }, { status: 500 });
    }
  }),
};
