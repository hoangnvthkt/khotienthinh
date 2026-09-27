-- P1.3: Rooms are the only source for Room-managed project work.
-- These modules' server checks read Room actions only (bindings enforced,
-- PBAC fallback off), so direct grants on them have no effect and only made
-- buttons appear that the server then refused. Revoke them (soft, backed up)
-- and stop new direct grants. Material request / plan / BOQ still honor
-- grants on the server and are left untouched.

create table if not exists app_private.p1_3_room_managed_grant_backup_20260927 (
  like public.user_permission_grants including defaults,
  backed_up_at timestamptz not null default now(),
  primary key (id)
);
revoke all on table app_private.p1_3_room_managed_grant_backup_20260927 from public, anon, authenticated;

create temporary table p1_3_modules (module text primary key) on commit drop;
insert into p1_3_modules values
  ('daily_log'), ('gantt'), ('weekly_progress'), ('quality'),
  ('safety'), ('payment'), ('quantity_acceptance'), ('material_po');

insert into app_private.p1_3_room_managed_grant_backup_20260927
select grant_row.*, now()
from public.user_permission_grants grant_row
where grant_row.is_active and grant_row.revoked_at is null
  and grant_row.permission_code like 'project.%'
  and split_part(grant_row.permission_code, '.', 2) in (select module from p1_3_modules)
on conflict (id) do nothing;

update public.user_permission_grants grant_row
set is_active = false,
    revoked_at = now(),
    revoked_reason = 'P1.3: quyền này do Room trong dự án quyết định; grant trực tiếp không còn tác dụng',
    updated_at = now()
where grant_row.id in (select id from app_private.p1_3_room_managed_grant_backup_20260927)
  and grant_row.is_active;

update public.permission_actions
set direct_grant_allowed = false, updated_at = now()
where permission_code like 'project.%'
  and split_part(permission_code, '.', 2) in (select module from p1_3_modules)
  and direct_grant_allowed;
