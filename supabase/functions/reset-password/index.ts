import { createClient } from '@supabase/supabase-js';

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
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const getCaller = async (req: Request, admin: ReturnType<typeof getAdminClient>) => {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Missing authorization token');

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Error('Invalid authorization token');

  const filters = [`auth_id.eq.${authData.user.id}`];
  if (authData.user.email) filters.push(`email.eq.${authData.user.email}`);

  const { data: appUser, error: appUserError } = await admin
    .from('users')
    .select('id, role, email, auth_id')
    .or(filters.join(','))
    .limit(1)
    .maybeSingle();
  if (appUserError) throw appUserError;

  return {
    authUser: authData.user,
    appUser,
    isAdmin: appUser?.role === 'ADMIN',
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = getAdminClient();
    const caller = await getCaller(req, admin);
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('permission') || message.includes('authorization') ? 403 : 400;
    return json({ error: message }, status);
  }
});
