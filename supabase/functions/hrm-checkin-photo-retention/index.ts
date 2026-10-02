// Owner decision 8 (02/10/2026): check-in photos are kept 60 days.
// Storage blocks direct SQL deletes, so a daily cron tick (app_private.checkin_photo_retention_tick)
// calls this worker, which removes the expired objects through the Storage API.
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'checkin-photos';
const BATCH_SIZE = 200;
const MAX_BATCHES = 20;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('SEND_WEB_PUSH_SECRET');
  if (!secret || request.headers.get('x-web-push-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const claimed = await admin.rpc('claim_expired_checkin_photos', { p_limit: BATCH_SIZE });
    if (claimed.error) {
      console.error('Check-in photo retention claim failed');
      return json({ error: 'CHECKIN_RETENTION_CLAIM_FAILED', removed }, 500);
    }
    const names = (claimed.data as string[] | null) ?? [];
    if (names.length === 0) break;
    const result = await admin.storage.from(BUCKET).remove(names);
    if (result.error) {
      console.error('Check-in photo retention remove failed');
      return json({ error: 'CHECKIN_RETENTION_REMOVE_FAILED', removed }, 500);
    }
    removed += names.length;
    if (names.length < BATCH_SIZE) break;
  }
  return json({ removed });
});
