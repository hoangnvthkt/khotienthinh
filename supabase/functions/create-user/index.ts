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

const requireAdmin = async (req: Request, admin: ReturnType<typeof getAdminClient>) => {
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
  if (appUser?.role !== 'ADMIN') throw new Error('Admin permission required');

  return { authUser: authData.user, appUser };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = getAdminClient();
    await requireAdmin(req, admin);

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email) return json({ error: 'Email is required' }, 400);
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: body.profile?.name,
        username: body.profile?.username,
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error('Supabase Auth did not return a user');

    if (body.profile) {
      const profile = body.profile;
      const payload = {
        id: profile.id || data.user.id,
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
        is_active: profile.isActive ?? true,
      };

      const { error: profileError } = await admin.from('users').upsert(payload).select('id').single();
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw profileError;
      }
    }

    return json({ userId: data.user.id, user: { id: data.user.id, email: data.user.email } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('permission') || message.includes('authorization') ? 403 : 400;
    return json({ error: message }, status);
  }
});
