import {
  EdgeAuthorizationError,
  getAdminClient,
  requireActiveCaller,
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
    const caller = await requireActiveCaller(req, admin);
    const body = await req.json();

    const email = body.email ? String(body.email).trim().toLowerCase() : '';
    const newEmail = body.newEmail ? String(body.newEmail).trim().toLowerCase() : undefined;
    const newPassword = body.newPassword ? String(body.newPassword) : undefined;
    if (!newPassword && !newEmail) return json({ error: 'No auth changes were provided' }, 400);
    if (newPassword && newPassword.length < 6) {
      return json({ error: 'Password must be at least 6 characters' }, 400);
    }

    let targetAuthId = body.authId ? String(body.authId) : undefined;
    if (!targetAuthId && body.userId) {
      const { data: targetProfile, error: targetError } = await admin
        .from('users')
        .select('auth_id, email')
        .eq('id', String(body.userId))
        .maybeSingle();
      if (targetError) throw targetError;
      targetAuthId = targetProfile?.auth_id || undefined;
    }

    if (!targetAuthId && email && caller.authUser.email?.toLowerCase() === email) {
      targetAuthId = caller.authUser.id;
    }

    if (!targetAuthId) {
      return json({ error: 'Cannot resolve target Supabase Auth user' }, 404);
    }

    const isSelf = targetAuthId === caller.authUser.id;
    if (!caller.isAdmin && !isSelf) {
      return json({ error: 'Admin permission required' }, 403);
    }

    const updatePayload: { email?: string; password?: string } = {};
    if (newEmail) updatePayload.email = newEmail;
    if (newPassword) updatePayload.password = newPassword;

    const { error } = await admin.auth.admin.updateUserById(targetAuthId, updatePayload);
    if (error) throw error;

    return json({ success: true, authId: targetAuthId });
  } catch (error) {
    const status = error instanceof EdgeAuthorizationError ? error.status : 400;
    const publicMessage = error instanceof EdgeAuthorizationError
      ? error.message
      : 'Không thể xử lý yêu cầu tài khoản.';
    return json({ error: publicMessage }, status);
  }
});
