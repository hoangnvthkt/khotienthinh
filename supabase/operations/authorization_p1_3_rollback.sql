-- Emergency rollback for authorization_p1_3_retire_room_managed_grants.
begin;
update public.user_permission_grants grant_row
set is_active = backup.is_active,
    revoked_at = backup.revoked_at,
    revoked_by = backup.revoked_by,
    revoked_reason = backup.revoked_reason,
    updated_at = now()
from app_private.p1_3_room_managed_grant_backup_20260927 backup
where backup.id = grant_row.id;

update public.permission_actions
set direct_grant_allowed = true, updated_at = now()
where permission_code like 'project.%'
  and split_part(permission_code, '.', 2) in ('daily_log','gantt','weekly_progress','quality','safety','payment','quantity_acceptance','material_po');
commit;
