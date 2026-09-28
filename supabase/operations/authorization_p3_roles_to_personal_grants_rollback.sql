-- Rollback for authorization_p3_roles_to_personal_grants: restores the role
-- assignments and every touched grant row to its previous state.
begin;
update public.principal_role_assignments
set status = 'ACTIVE', revoked_at = null, revoked_by = null, revoked_reason = null, updated_at = now()
where status = 'REVOKED' and revoked_reason = 'Chuyển sang quyền riêng từng người (P3, 28/09/2026)';

delete from public.user_permission_grants g
using app_private.p3_roles_conversion_backup b
where not b.existed and g.user_id = b.user_id and g.permission_code = b.permission_code
  and g.scope_type = b.scope_type and g.scope_id = b.scope_id;

update public.user_permission_grants g
set is_active = (b.prev_row ->> 'is_active')::boolean,
    expires_at = (b.prev_row ->> 'expires_at')::timestamptz,
    revoked_at = (b.prev_row ->> 'revoked_at')::timestamptz,
    revoked_by = (b.prev_row ->> 'revoked_by')::uuid,
    revoked_reason = b.prev_row ->> 'revoked_reason',
    grant_reason = b.prev_row ->> 'grant_reason',
    updated_at = now()
from app_private.p3_roles_conversion_backup b
where b.existed and g.user_id = b.user_id and g.permission_code = b.permission_code
  and g.scope_type = b.scope_type and g.scope_id = b.scope_id;
commit;
