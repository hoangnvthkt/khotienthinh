import {
  EdgeAuthorizationError,
  assertAccountManager,
  getAdminClient,
  requireAccountManager,
} from '../_shared/adminAuthorization.ts';
import { resolveCreatedAccountRole } from '../_shared/accountManagerPolicy.ts';

// Creates a login account. Admin, or a holder of settings.users.manage ("Quản lý tài khoản").
// Someone who is not an Admin always creates an ordinary EMPLOYEE account; the server decides the role.

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
    const caller = await requireAccountManager(req, admin);

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email) return json({ error: 'Email is required' }, 400);
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const profile = body.profile || {};

    // The Auth trigger links an existing profile with this email to the new login: check it before creating.
    if (!caller.isAdmin) await assertAccountManager(admin, caller, { email });

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

    // The service role cannot write users directly (privilege guard); the trusted RPC writes the profile.
    const { data: completed, error: profileError } = await admin.rpc('complete_user_account_creation_v1', {
      p_actor_user_id: caller.appUser.id,
      p_auth_id: data.user.id,
      p_profile: {
        name: profile.name || email,
        username: profile.username || email,
        phone: profile.phone || null,
        avatar: profile.avatar || null,
        role: resolveCreatedAccountRole(profile.role, caller.isAdmin),
        assignedWarehouseId: caller.isAdmin ? profile.assignedWarehouseId || null : null,
      },
    });
    if (profileError) {
      await admin.from('users').delete().eq('id', data.user.id).eq('auth_id', data.user.id);
      await admin.auth.admin.deleteUser(data.user.id);
      throw profileError;
    }

    const profileId = String(completed?.profileId || data.user.id);
    return json({ userId: data.user.id, profileId, user: { id: data.user.id, email: data.user.email } });
  } catch (error) {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (errorCode === 'email_exists' || errorCode === 'email_conflict_identity_not_deletable') {
      return json({ error: 'Email này đã có tài khoản. Vui lòng dùng email khác hoặc đặt lại mật khẩu.' }, 409);
    }
    const status = error instanceof EdgeAuthorizationError ? error.status : 400;
    const publicMessage = error instanceof EdgeAuthorizationError
      ? error.message
      : 'Không thể xử lý yêu cầu tài khoản.';
    if (!(error instanceof EdgeAuthorizationError)) {
      console.error('create-user failed', {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: errorCode || undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return json({ error: publicMessage }, status);
  }
});
