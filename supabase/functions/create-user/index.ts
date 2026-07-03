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

const normalizeRole = (value: unknown) => {
  const role = String(value || 'EMPLOYEE').trim().toUpperCase();
  return ['ADMIN', 'WAREHOUSE_KEEPER', 'EMPLOYEE'].includes(role) ? role : 'EMPLOYEE';
};

const normalizeStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const rows = value.map(item => String(item || '').trim()).filter(Boolean);
  return rows.length > 0 ? rows : [];
};

const normalizeObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

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
    const profile = (body.profile && typeof body.profile === 'object' ? body.profile : {}) as Record<string, any>;
    const username = String(profile.username || email.split('@')[0] || '').trim();
    const role = normalizeRole(profile.role);

    if (!email) return json({ error: 'Email is required' }, 400);
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
    if (!username) return json({ error: 'Username is required' }, 400);

    const { data: duplicatedEmail, error: duplicatedEmailError } = await admin
      .from('users')
      .select('id, email, username, auth_id')
      .eq('email', email)
      .maybeSingle();
    if (duplicatedEmailError) throw duplicatedEmailError;
    if (duplicatedEmail) {
      return json({ error: 'Email này đã tồn tại trong danh sách người dùng.' }, 409);
    }

    const { data: duplicatedUsername, error: duplicatedUsernameError } = await admin
      .from('users')
      .select('id, email, username, auth_id')
      .ilike('username', username)
      .limit(1)
      .maybeSingle();
    if (duplicatedUsernameError) throw duplicatedUsernameError;
    if (duplicatedUsername) {
      return json({ error: 'Tên đăng nhập này đã tồn tại trong danh sách người dùng.' }, 409);
    }

    const authMetadata = {
      name: profile.name || email,
      username,
      phone: profile.phone || '',
      role,
      avatar: profile.avatar || '',
      assignedWarehouseId: profile.assignedWarehouseId || '',
      allowedModules: normalizeStringArray(profile.allowedModules) || [],
      adminModules: normalizeStringArray(profile.adminModules) || [],
      allowedSubModules: normalizeObject(profile.allowedSubModules) || {},
      adminSubModules: normalizeObject(profile.adminSubModules) || {},
    };

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: authMetadata,
    });
    if (error) {
      const message = error.message || 'Cannot create Supabase Auth user';
      if (/already|exists|registered|duplicate/i.test(message)) {
        return json({ error: 'Email này đã tồn tại trong Supabase Auth.' }, 409);
      }
      return json({ error: message }, 400);
    }
    if (!data.user) throw new Error('Supabase Auth did not return a user');

    if (body.profile) {
      const payload = {
        id: data.user.id,
        auth_id: data.user.id,
        name: profile.name || email,
        email,
        username,
        phone: profile.phone || null,
        role,
        avatar: profile.avatar || null,
        assigned_warehouse_id: profile.assignedWarehouseId || null,
        allowed_modules: normalizeStringArray(profile.allowedModules),
        admin_modules: normalizeStringArray(profile.adminModules),
        allowed_sub_modules: normalizeObject(profile.allowedSubModules),
        admin_sub_modules: normalizeObject(profile.adminSubModules),
        is_active: profile.isActive ?? true,
      };

      const { data: savedProfile, error: profileError } = await admin
        .from('users')
        .upsert(payload, { onConflict: 'id' })
        .select('id, auth_id, email, username')
        .single();
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw profileError;
      }

      return json({
        userId: data.user.id,
        user: { id: data.user.id, email: data.user.email },
        profile: savedProfile,
      });
    }

    return json({ userId: data.user.id, user: { id: data.user.id, email: data.user.email } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('permission') || message.includes('authorization') ? 403 : 400;
    return json({ error: message }, status);
  }
});
