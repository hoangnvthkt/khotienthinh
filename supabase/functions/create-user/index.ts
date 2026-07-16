import {
  EdgeAuthorizationError,
  getAdminClient,
  requireActiveAdmin,
} from '../_shared/adminAuthorization.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = getAdminClient();
    await requireActiveAdmin(req, admin);

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email) return json({ error: 'Email is required' }, 400);
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const profile = body.profile || {};

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: profile.name,
        username: profile.username,
        phone: profile.phone,
        avatar: profile.avatar,
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error('Supabase Auth did not return a user');

    const { data: linkedProfile, error: linkedProfileError } = await admin.from('users').select('id').eq('auth_id', data.user.id).maybeSingle();
    if (linkedProfileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw linkedProfileError;
    }

    const profileId = linkedProfile?.id || profile.id || data.user.id;
    if (body.profile) {
      const payload = {
        id: profileId,
        auth_id: data.user.id,
        name: profile.name || email,
        email,
        username: profile.username || email,
        phone: profile.phone || null,
        role: profile.role || 'EMPLOYEE',
        avatar: profile.avatar || null,
        assigned_warehouse_id: profile.assignedWarehouseId || null,
        allowed_modules: profile.allowedModules || null,
        admin_modules: profile.adminModules || null,
        allowed_sub_modules: profile.allowedSubModules || null,
        admin_sub_modules: profile.adminSubModules || null,
      };

      const { error: profileError } = await admin.from('users').upsert(payload).select('id').single();
      if (profileError) {
        await admin.from('users').delete().eq('id', data.user.id).eq('auth_id', data.user.id);
        await admin.auth.admin.deleteUser(data.user.id);
        throw profileError;
      }
    }

    return json({ userId: data.user.id, profileId, user: { id: data.user.id, email: data.user.email } });
  } catch (error) {
    const status = error instanceof EdgeAuthorizationError ? error.status : 400;
    const publicMessage = error instanceof EdgeAuthorizationError
      ? error.message
      : 'Không thể xử lý yêu cầu tài khoản.';
    return json({ error: publicMessage }, status);
  }
});
