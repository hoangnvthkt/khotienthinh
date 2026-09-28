-- P1.5 follow-up: Request (RQ) module admin. Its only server effect was the
-- override in process_request_step (approve as / instead of another user on
-- the legacy request flow). The UI never calls it and nobody used it in 90
-- days; viewing, creating and approving requests do not depend on it.
-- Owner decision 27/09/2026: revoke for all 15 non-Admin holders. Template
-- management (request.template.manage) is untouched.

insert into app_private.p1_5_backup_20260927 (kind, ref_id, payload)
select 'grant', grant_row.id, to_jsonb(grant_row)
from public.user_permission_grants grant_row
join public.users user_row on user_row.id = grant_row.user_id and user_row.role <> 'ADMIN'
where grant_row.is_active and grant_row.revoked_at is null
  and grant_row.permission_code = 'system.rq.manage'
on conflict (kind, ref_id) do nothing;

update public.user_permission_grants grant_row
set is_active = false,
    revoked_at = now(),
    revoked_reason = 'P1.5: chủ sản phẩm thu hồi quyền quản trị Phiếu yêu cầu (27/09/2026)',
    updated_at = now()
from public.users user_row
where user_row.id = grant_row.user_id and user_row.role <> 'ADMIN'
  and grant_row.is_active and grant_row.permission_code = 'system.rq.manage';

insert into app_private.p1_5_backup_20260927 (kind, ref_id, payload)
select 'legacy_flags_rq', user_row.id, jsonb_build_object('admin_modules', user_row.admin_modules, 'admin_sub_modules', user_row.admin_sub_modules)
from public.users user_row
where user_row.role <> 'ADMIN'
  and ('RQ' = any(coalesce(user_row.admin_modules, '{}'::text[])) or coalesce(user_row.admin_sub_modules, '{}'::jsonb) ? 'RQ')
on conflict (kind, ref_id) do nothing;

select set_config('app.authorization_legacy_migration', 'on', true);
alter table public.users disable trigger trg_users_prevent_privilege_self_update;
update public.users user_row
set admin_modules = array_remove(user_row.admin_modules, 'RQ'),
    admin_sub_modules = case when user_row.admin_sub_modules is null then null else user_row.admin_sub_modules - 'RQ' end
where user_row.id in (select ref_id from app_private.p1_5_backup_20260927 where kind = 'legacy_flags_rq');
alter table public.users enable trigger trg_users_prevent_privilege_self_update;
select set_config('app.authorization_legacy_migration', '', true);

insert into app_private.authorization_legacy_write_audit (actor_user_id, target_user_id, changed_columns, reason)
select null, backup.ref_id, array['admin_modules', 'admin_sub_modules'], 'P1.5: xóa cờ quản trị Phiếu yêu cầu legacy'
from app_private.p1_5_backup_20260927 backup
where backup.kind = 'legacy_flags_rq';
