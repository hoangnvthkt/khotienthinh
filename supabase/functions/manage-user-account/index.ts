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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

class RequestError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'RequestError';
  }
}

type Action = 'DISABLE' | 'REACTIVATE';

type Operation = {
  operationId: string;
  targetUserId: string;
  action: Action;
  status: 'PREPARED' | 'DB_APPLIED' | 'AUTH_RETRY' | 'COMPLETED';
  authId?: string | null;
  lastError?: string | null;
};

const isUuid = (value: string) => (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
);

const buildRevocationPassword = () => (
  `${crypto.randomUUID()}-${crypto.randomUUID()}-Aa1!`
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let admin: ReturnType<typeof getAdminClient> | null = null;
  let operation: Operation | null = null;
  let actorUserId: string | null = null;

  try {
    admin = getAdminClient();
    const caller = await requireActiveAdmin(req, admin);
    actorUserId = caller.appUser.id;

    const body = await req.json();
    const action = String(body.action || '').trim().toUpperCase() as Action;
    const targetUserId = String(body.targetUserId || '').trim();
    const reason = String(body.reason || '').trim();
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    const newPassword = body.newPassword ? String(body.newPassword) : '';

    if (!['DISABLE', 'REACTIVATE'].includes(action)) {
      throw new RequestError('Unsupported account lifecycle action');
    }
    if (!isUuid(targetUserId) || !isUuid(idempotencyKey)) {
      throw new RequestError('Invalid target user or idempotency key');
    }
    if (reason.length < 5) {
      throw new RequestError('Reason must contain at least 5 characters');
    }
    if (action === 'REACTIVATE' && newPassword.length < 8) {
      throw new RequestError('A new password with at least 8 characters is required');
    }

    const { data: prepared, error: prepareError } = await admin.rpc('prepare_user_account_lifecycle', {
      p_actor_user_id: caller.appUser.id,
      p_target_user_id: targetUserId,
      p_action: action,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    });
    if (prepareError) throw prepareError;
    operation = prepared as Operation;
    if (!operation?.operationId) {
      throw new Error('Lifecycle prepare RPC returned no operation');
    }
    if (operation.status === 'COMPLETED') return json(operation);

    if (!operation.authId) {
      if (action === 'REACTIVATE') {
        throw new RequestError('Target profile has no linked Supabase Auth identity', 409);
      }
    } else {
      const attributes = action === 'DISABLE'
        ? {
          ban_duration: '876000h',
          password: buildRevocationPassword(),
        }
        : {
          ban_duration: 'none',
          password: newPassword,
        };

      const { error: authError } = await admin.auth.admin.updateUserById(
        operation.authId,
        attributes,
      );
      if (authError) throw authError;
    }

    const { data: completed, error: completeError } = await admin.rpc('complete_user_account_lifecycle', {
      p_actor_user_id: caller.appUser.id,
      p_operation_id: operation.operationId,
      p_auth_result: operation.authId
        ? { auth: action === 'DISABLE' ? 'banned_password_rotated' : 'unbanned_password_reset' }
        : { auth: 'skipped_no_identity' },
    });
    if (completeError) throw completeError;

    return json(completed);
  } catch (error) {
    const internalMessage = error instanceof Error
      ? error.message
      : 'Unknown account lifecycle error';
    let retryOperation: Operation | null = null;

    if (admin && operation?.operationId && actorUserId) {
      const { data: failedOperation } = await admin.rpc('fail_user_account_lifecycle', {
        p_actor_user_id: actorUserId,
        p_operation_id: operation.operationId,
        p_error: internalMessage,
      });
      retryOperation = failedOperation as Operation | null;
    }

    const status = error instanceof EdgeAuthorizationError
      ? error.status
      : error instanceof RequestError
        ? error.status
        : operation
          ? 502
          : 400;
    const publicMessage = error instanceof EdgeAuthorizationError || error instanceof RequestError
      ? internalMessage
      : 'Không thể đồng bộ trạng thái đăng nhập. Vui lòng thử lại thao tác này.';
    return json({
      error: publicMessage,
      operationId: operation?.operationId || null,
      action: operation?.action || null,
      status: retryOperation?.status === 'AUTH_RETRY' ? 'AUTH_RETRY' : null,
    }, status);
  }
});
