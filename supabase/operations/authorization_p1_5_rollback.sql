-- Emergency rollback for P1.5 step 2 (owner module-admin decisions) and the
-- Request module-admin follow-up. 'legacy_flags' was taken first and still
-- holds RQ, so it wins for users present in both flag backups.
-- Step 1 (is_module_admin from capability) is equivalent to the old rule and
-- stays; restoring the grants below restores the old access.
begin;
update public.user_permission_grants grant_row
set is_active = true, revoked_at = null, revoked_by = null, revoked_reason = null, updated_at = now()
from app_private.p1_5_backup_20260927 backup
where backup.kind = 'grant' and backup.ref_id = grant_row.id;

update public.principal_role_assignments assignment
set status = 'REVOKED', revoked_at = now(), revoked_reason = 'P1.5 rollback', updated_at = now()
from app_private.p1_5_backup_20260927 backup
where backup.kind = 'assignment' and backup.ref_id = assignment.id;

select set_config('app.authorization_legacy_migration', 'on', true);
alter table public.users disable trigger trg_users_prevent_privilege_self_update;
update public.users user_row
set admin_modules = array(select jsonb_array_elements_text(coalesce(backup.payload -> 'admin_modules', '[]'::jsonb))),
    admin_sub_modules = backup.payload -> 'admin_sub_modules'
from app_private.p1_5_backup_20260927 backup
where backup.kind = 'legacy_flags_rq' and backup.ref_id = user_row.id
  and not exists (select 1 from app_private.p1_5_backup_20260927 first_backup where first_backup.kind = 'legacy_flags' and first_backup.ref_id = user_row.id);
update public.users user_row
set admin_modules = array(select jsonb_array_elements_text(coalesce(backup.payload -> 'admin_modules', '[]'::jsonb))),
    admin_sub_modules = backup.payload -> 'admin_sub_modules'
from app_private.p1_5_backup_20260927 backup
where backup.kind = 'legacy_flags' and backup.ref_id = user_row.id;
alter table public.users enable trigger trg_users_prevent_privilege_self_update;
select set_config('app.authorization_legacy_migration', '', true);
commit;
