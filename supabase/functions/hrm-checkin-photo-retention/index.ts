// Daily HRM storage retention worker (cron app_private.checkin_photo_retention_tick, 20:20 UTC).
// Storage blocks direct SQL deletes, so this worker removes expired objects through the Storage API:
//   * checkin-photos: owner decision 8 (02/10/2026) — check-in photos are kept 60 days.
//   * hrm-private-imports: personnel import workbooks of expired batches (30 days) and orphan files older than 31 days
//     (audit 20/10/2026 follow-up). Batch rows are deleted afterwards by cleanup_expired_hrm_import_batches (02:17 UTC).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BATCH_SIZE = 200;
const MAX_BATCHES = 20;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

type SweepResult = { removed: number; error?: string };

const sweep = async (admin: SupabaseClient, bucket: string, claimRpc: string): Promise<SweepResult> => {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const claimed = await admin.rpc(claimRpc, { p_limit: BATCH_SIZE });
    if (claimed.error) {
      console.error(`Retention claim failed: ${bucket}`);
      return { removed, error: 'CLAIM_FAILED' };
    }
    const names = (claimed.data as string[] | null) ?? [];
    if (names.length === 0) break;
    const result = await admin.storage.from(bucket).remove(names);
    if (result.error) {
      console.error(`Retention remove failed: ${bucket}`);
      return { removed, error: 'REMOVE_FAILED' };
    }
    removed += names.length;
    if (names.length < BATCH_SIZE) break;
  }
  return { removed };
};

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('SEND_WEB_PUSH_SECRET');
  if (!secret || request.headers.get('x-web-push-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Each bucket is swept independently: one failing must not block the other.
  const photos = await sweep(admin, 'checkin-photos', 'claim_expired_checkin_photos');
  const imports = await sweep(admin, 'hrm-private-imports', 'claim_expired_hrm_import_files');
  const failed = Boolean(photos.error || imports.error);
  return json({ removed: photos.removed, photos, imports }, failed ? 500 : 200);
});
