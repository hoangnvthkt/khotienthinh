-- Owner decision 3 (27/09, confirmed 02/10): no legacy "Project module admin" (system.da.manage).
-- 39 active grants remain (37 non-admin, mostly from the 10/09 legacy data migration). The server
-- never checks this code; the app's approval matrix used it as the approver for projects without
-- a project team, where only Admin approves from now on. History: no approval was made through it.

create table if not exists app_private.da_admin_revocation_backup (
  grant_id uuid primary key,
  user_id uuid not null,
  prev_row jsonb not null,
  revoked_at timestamptz not null default now()
);
revoke all on app_private.da_admin_revocation_backup from public, anon, authenticated;

insert into app_private.da_admin_revocation_backup (grant_id, user_id, prev_row)
select g.id, g.user_id, to_jsonb(g)
from public.user_permission_grants g
where g.permission_code = 'system.da.manage' and g.is_active
on conflict (grant_id) do nothing;

insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
select null, b.user_id, 'direct_permission_grants_changed',
  jsonb_build_array(jsonb_build_object('permissionCode', 'system.da.manage', 'scopeType', b.prev_row ->> 'scope_type',
    'scopeId', b.prev_row ->> 'scope_id', 'expiresAt', b.prev_row ->> 'expires_at')),
  '[]'::jsonb,
  jsonb_build_object('reason', 'Quyết định 3: bỏ quản trị Dự án legacy (system.da.manage)', 'migration', '20261004170000')
from app_private.da_admin_revocation_backup b
where b.grant_id in (select id from public.user_permission_grants where permission_code = 'system.da.manage' and is_active);

update public.user_permission_grants
set is_active = false,
    revoked_at = now(),
    revoked_reason = 'Quyết định 3: bỏ quản trị Dự án legacy (02/10/2026)',
    updated_at = now()
where permission_code = 'system.da.manage' and is_active;

-- Cannot be given again by mistake.
update public.permission_actions
set direct_grant_allowed = false, updated_at = now()
where permission_code = 'system.da.manage';
