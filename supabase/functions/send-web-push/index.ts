import { createClient } from '@supabase/supabase-js';
import webpush from 'npm:web-push';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const getAdminClient = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const configureWebPush = () => {
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  if (!publicKey || !privateKey) throw new Error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY');
  webpush.setVapidDetails(subject, publicKey, privateKey);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const expectedSecret = Deno.env.get('SEND_WEB_PUSH_SECRET') || '';
    if (!expectedSecret || req.headers.get('x-web-push-secret') !== expectedSecret) {
      return json({ error: 'Unauthorized' }, 401);
    }

    configureWebPush();
    const admin = getAdminClient();
    const body = await req.json();
    const notificationId = String(body.notificationId || '');
    if (!notificationId) return json({ error: 'notificationId is required' }, 400);

    const { data: notification, error: notificationError } = await admin
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .maybeSingle();
    if (notificationError) throw notificationError;
    if (!notification) return json({ error: 'Notification not found' }, 404);
    if (!notification.user_id) return json({ sent: 0, skipped: 'broadcast' });

    const { data: subscriptions, error: subError } = await admin
      .from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', notification.user_id);
    if (subError) throw subError;

    const payload = JSON.stringify({
      title: notification.title || 'Thông báo',
      body: notification.message || '',
      tag: notification.id,
      url: notification.link || '/',
      priority: notification.severity === 'critical' ? 'urgent' : 'normal',
    });

    let sent = 0;
    for (const sub of subscriptions || []) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, payload);
        sent++;
      } catch (err: any) {
        const statusCode = err?.statusCode || err?.status;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('web_push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error('send web push failed:', err);
        }
      }
    }

    return json({ sent });
  } catch (err: any) {
    console.error('send-web-push error:', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
});
