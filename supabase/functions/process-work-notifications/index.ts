import { createClient } from '@supabase/supabase-js';
import webpush from 'npm:web-push@3.6.7';
import { runWorkNotificationWorker } from './worker.ts';

Deno.serve(async request => {
  const secret = Deno.env.get('SEND_WEB_PUSH_SECRET');
  if (!secret || request.headers.get('x-web-push-secret') !== secret) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const body = await request.json().catch(() => ({}));
  if (typeof body !== 'object' || body === null || (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 20))) {
    return Response.json({ error: 'Invalid batch limit' }, { status: 400 });
  }
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await runWorkNotificationWorker(client, async job => {
      const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
      const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
      if (!publicKey || !privateKey) throw new Error('WORK_VAPID_NOT_CONFIGURED');
      webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com', publicKey, privateKey);
      await webpush.sendNotification(job.subscription, JSON.stringify(job.payload), { TTL: 300, timeout: 5000 });
    }, body.limit);
    return Response.json(result);
  } catch (error) {
    // Never log endpoint credentials, raw provider bodies or task content.
    console.error('Work notification batch failed', error instanceof Error ? error.message : 'WORK_WORKER_FAILED');
    return Response.json({ error: 'Work notification batch failed' }, { status: 500 });
  }
});
