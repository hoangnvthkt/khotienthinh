import {
  EdgeAuthorizationError,
  getAdminClient,
  requireActiveCaller,
} from '../_shared/adminAuthorization.ts';

// Sets a new password (or login email) for an account.
// - Anyone may change their own.
// - An Admin may change another person's, on an active account only (a
//   disabled account is reopened through manage-user-account REACTIVATE), with
//   a reason. Every change for someone else is recorded in audit_trail
//   without the password.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_PASSWORD_LENGTH = 8;
const MIN_REASON_LENGTH = 10;

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
    const reason = body.reason ? String(body.reason).trim() : '';
    if (!newPassword && !newEmail) return json({ error: 'Chưa có thay đổi nào.' }, 400);
    if (newPassword && newPassword.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.` }, 400);
    }

    let target: { id: string; auth_id: string | null; name: string | null; is_active: boolean; account_status: string } | null = null;
    if (body.userId) {
      const { data, error } = await admin
        .from('users')
        .select('id, auth_id, name, is_active, account_status')
        .eq('id', String(body.userId))
        .maybeSingle();
      if (error) throw error;
      target = data;
    } else if (body.authId) {
      const { data, error } = await admin
        .from('users')
        .select('id, auth_id, name, is_active, account_status')
        .eq('auth_id', String(body.authId))
        .maybeSingle();
      if (error) throw error;
      target = data;
    }

    let targetAuthId = target?.auth_id || undefined;
    if (!targetAuthId && !body.userId && !body.authId && email && caller.authUser.email?.toLowerCase() === email) {
      targetAuthId = caller.authUser.id;
    }
    if (!targetAuthId) return json({ error: 'Không tìm thấy tài khoản đăng nhập của người này.' }, 404);

    const isSelf = targetAuthId === caller.authUser.id;
    if (!isSelf) {
      if (!caller.isAdmin) return json({ error: 'Chỉ Admin được đặt mật khẩu cho người khác.' }, 403);
      if (!target || target.is_active !== true || target.account_status === 'DISABLED') {
        return json({ error: 'Tài khoản đang bị vô hiệu hoá. Dùng "Khôi phục tài khoản" để mở lại kèm mật khẩu mới.' }, 409);
      }
      if (reason.length < MIN_REASON_LENGTH) {
        return json({ error: `Lý do phải có ít nhất ${MIN_REASON_LENGTH} ký tự.` }, 400);
      }
    }

    const updatePayload: { email?: string; password?: string } = {};
    if (newEmail) updatePayload.email = newEmail;
    if (newPassword) updatePayload.password = newPassword;

    const { error } = await admin.auth.admin.updateUserById(targetAuthId, updatePayload);
    if (error) throw error;

    if (!isSelf && target) {
      const changed = [newPassword ? 'mật khẩu' : null, newEmail ? 'email đăng nhập' : null].filter(Boolean).join(' và ');
      const { error: auditError } = await admin.from('audit_trail').insert({
        table_name: 'users',
        record_id: target.id,
        record_label: target.name,
        action: 'UPDATE',
        module: 'SETTINGS',
        user_id: caller.appUser.id,
        new_data: { passwordReset: Boolean(newPassword), ...(newEmail ? { email: newEmail } : {}) },
        description: `Admin đặt lại ${changed} cho ${target.name || target.id}: ${reason}`,
      });
      if (auditError) console.error('reset-password audit failed', auditError.message);
    }

    return json({ success: true, authId: targetAuthId });
  } catch (error) {
    const status = error instanceof EdgeAuthorizationError ? error.status : 400;
    const publicMessage = error instanceof EdgeAuthorizationError
      ? error.message
      : 'Không thể xử lý yêu cầu tài khoản.';
    return json({ error: publicMessage }, status);
  }
});
