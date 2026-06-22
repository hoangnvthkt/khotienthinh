import { createClient } from '@supabase/supabase-js';
import webpush from 'npm:web-push';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-web-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type NotificationRow = {
  id: string;
  user_id: string | null;
  title?: string | null;
  message?: string | null;
  body?: string | null;
  link?: string | null;
  action_url?: string | null;
  severity?: string | null;
  priority?: string | null;
  push_enabled?: boolean | null;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type DeliveryStatus = 'sent' | 'failed' | 'skipped';

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

const isAdminRequest = async (admin: ReturnType<typeof createClient>, req: Request) => {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user?.id) return false;

  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('id, role, is_active')
    .eq('auth_id', authData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  return profile?.role === 'ADMIN' && profile?.is_active !== false;
};

const getPriority = (notification: NotificationRow) => {
  if (notification.priority) return notification.priority;
  return notification.severity === 'critical' ? 'urgent' : notification.severity === 'warning' ? 'high' : 'normal';
};

const getErrorMessage = (err: unknown) => {
  if (!err) return 'Unknown error';
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err) return String((err as { message?: unknown }).message || 'Unknown error');
  return String(err);
};

const recordDelivery = async (
  admin: ReturnType<typeof createClient>,
  params: {
    notificationId: string;
    userId: string;
    subscriptionId?: string | null;
    status: DeliveryStatus;
    errorMessage?: string;
  },
) => {
  const { error } = await admin.from('notification_deliveries').insert({
    notification_id: params.notificationId,
    user_id: params.userId,
    subscription_id: params.subscriptionId || null,
    channel: 'web_push',
    status: params.status,
    provider: 'web-push',
    error_message: params.errorMessage || null,
    sent_at: params.status === 'sent' ? new Date().toISOString() : null,
  });
  if (error) console.error('notification delivery log failed:', error);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const expectedSecret = Deno.env.get('SEND_WEB_PUSH_SECRET') || '';
    const admin = getAdminClient();
    const isInternalRequest = Boolean(expectedSecret && req.headers.get('x-web-push-secret') === expectedSecret);
    const isAdminJwtRequest = !isInternalRequest && await isAdminRequest(admin, req);
    if (!isInternalRequest && !isAdminJwtRequest) {
      return json({ error: 'Unauthorized' }, 401);
    }

    configureWebPush();
    const body = await req.json();
    const notificationId = String(body.notificationId || body.notification_id || '');
    const subscriptionId = body.subscriptionId || body.subscription_id
      ? String(body.subscriptionId || body.subscription_id)
      : '';
    if (!notificationId) return json({ error: 'notificationId is required' }, 400);

    const { data: notificationData, error: notificationError } = await admin
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .maybeSingle();
    if (notificationError) throw notificationError;
    const notification = notificationData as NotificationRow | null;
    if (!notification) return json({ error: 'Notification not found' }, 404);

    if (!notification.user_id) {
      return json({ total: 0, sent: 0, failed: 0, deactivated: 0, skipped: 1, reason: 'broadcast' });
    }

    if (notification.push_enabled === false) {
      await recordDelivery(admin, {
        notificationId,
        userId: notification.user_id,
        status: 'skipped',
        errorMessage: 'push_disabled',
      });
      return json({ total: 0, sent: 0, failed: 0, deactivated: 0, skipped: 1, reason: 'push_disabled' });
    }

    const { data: subscriptions, error: subError } = await admin
      .from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', notification.user_id)
      .eq('is_active', true);
    if (subError) throw subError;

    if (!subscriptions?.length) {
      await recordDelivery(admin, {
        notificationId,
        userId: notification.user_id,
        status: 'skipped',
        errorMessage: 'no_active_subscriptions',
      });
      return json({ total: 0, sent: 0, failed: 0, deactivated: 0, skipped: 1, reason: 'no_active_subscriptions' });
    }

    const payload = JSON.stringify({
      title: notification.title || 'Thông báo',
      body: notification.message || notification.body || '',
      tag: notification.id,
      url: notification.action_url || notification.link || '/',
      notificationId: notification.id,
      priority: getPriority(notification),
    });

    let sent = 0;
    let failed = 0;
    let deactivated = 0;
    const targetSubscriptions = subscriptionId
      ? (subscriptions as PushSubscriptionRow[]).filter(sub => sub.id === subscriptionId)
      : subscriptions as PushSubscriptionRow[];

    if (subscriptionId && targetSubscriptions.length === 0) {
      await recordDelivery(admin, {
        notificationId,
        userId: notification.user_id,
        subscriptionId,
        status: 'skipped',
        errorMessage: 'subscription_not_active_or_not_found',
      });
      return json({ total: 0, sent: 0, failed: 0, deactivated: 0, skipped: 1, reason: 'subscription_not_active_or_not_found' });
    }

    for (const sub of targetSubscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, payload);
        await admin
          .from('web_push_subscriptions')
          .update({
            last_used_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', sub.id);
        await recordDelivery(admin, {
          notificationId,
          userId: notification.user_id,
          subscriptionId: sub.id,
          status: 'sent',
        });
        sent++;
      } catch (err) {
        failed++;
        const statusCode = (err as { statusCode?: number; status?: number })?.statusCode || (err as { status?: number })?.status;
        const errorMessage = getErrorMessage(err);
        if (statusCode === 404 || statusCode === 410) {
          await admin
            .from('web_push_subscriptions')
            .update({
              is_active: false,
              last_used_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', sub.id);
          deactivated++;
        } else {
          console.error('send web push failed:', err);
        }
        await recordDelivery(admin, {
          notificationId,
          userId: notification.user_id,
          subscriptionId: sub.id,
          status: 'failed',
          errorMessage,
        });
      }
    }

    return json({
      total: targetSubscriptions.length,
      sent,
      failed,
      deactivated,
      skipped: 0,
    });
  } catch (err) {
    console.error('send-web-push error:', err);
    return json({ error: getErrorMessage(err) }, 500);
  }
});
