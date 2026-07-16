import { createClient, type SupabaseClient, type User as AuthUser } from '@supabase/supabase-js';

export class EdgeAuthorizationError extends Error {
  constructor(message: string, public readonly status = 403) {
    super(message);
    this.name = 'EdgeAuthorizationError';
  }
}

export type ActiveAppCaller = {
  authUser: AuthUser;
  appUser: {
    id: string;
    role: string;
    email: string | null;
    auth_id: string | null;
    is_active: boolean;
    account_status: 'ACTIVE' | 'DISABLED';
  };
  isAdmin: boolean;
};

export const getAdminClient = (): SupabaseClient => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

export const requireActiveCaller = async (
  req: Request,
  admin: SupabaseClient,
): Promise<ActiveAppCaller> => {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new EdgeAuthorizationError('Missing authorization token', 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    throw new EdgeAuthorizationError('Invalid authorization token', 401);
  }

  const { data: linkedProfile, error: linkedProfileError } = await admin
    .from('users')
    .select('id, role, email, auth_id, is_active, account_status')
    .eq('auth_id', authData.user.id)
    .maybeSingle();
  if (linkedProfileError) throw linkedProfileError;

  let appUser = linkedProfile;
  if (!appUser && authData.user.email) {
    const { data: unlinkedProfiles, error: unlinkedProfileError } = await admin
      .from('users')
      .select('id, role, email, auth_id, is_active, account_status')
      .is('auth_id', null)
      .eq('email', authData.user.email.toLowerCase())
      .limit(2);
    if (unlinkedProfileError) throw unlinkedProfileError;
    if ((unlinkedProfiles || []).length > 1) {
      throw new EdgeAuthorizationError('Ambiguous application profile');
    }
    appUser = unlinkedProfiles?.[0] || null;
  }

  if (!appUser) throw new EdgeAuthorizationError('Active application profile required');
  if (appUser?.is_active !== true || appUser?.account_status === 'DISABLED') {
    throw new EdgeAuthorizationError('Application account is disabled');
  }

  return {
    authUser: authData.user,
    appUser,
    isAdmin: appUser.role === 'ADMIN',
  };
};

export const requireActiveAdmin = async (
  req: Request,
  admin: SupabaseClient,
): Promise<ActiveAppCaller> => {
  const caller = await requireActiveCaller(req, admin);
  if (!caller.isAdmin) throw new EdgeAuthorizationError('Admin permission required');
  return caller;
};
