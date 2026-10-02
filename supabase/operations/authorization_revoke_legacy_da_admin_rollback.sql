-- Rollback for 20261004170000_authorization_revoke_legacy_da_admin: restores each revoked grant exactly.
update public.permission_actions set direct_grant_allowed = true, updated_at = now() where permission_code = 'system.da.manage';
update public.user_permission_grants g
set is_active = true,
    revoked_at = (b.prev_row ->> 'revoked_at')::timestamptz,
    revoked_by = (b.prev_row ->> 'revoked_by')::uuid,
    revoked_reason = b.prev_row ->> 'revoked_reason',
    updated_at = now()
from app_private.da_admin_revocation_backup b
where g.id = b.grant_id;
delete from supabase_migrations.schema_migrations where version = '20261004170000';
