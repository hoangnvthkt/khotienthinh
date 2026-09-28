-- P3: ordinary permission-bundle roles become each person's own grants.
-- Owner decision 28/09/2026: permissions inherited from a role cannot be
-- removed for one person, which is why many boxes in Settings → Users were
-- locked. Convert the ordinary roles (Business User, Người dùng quy trình,
-- Quản trị quy trình, legacy HR profiles) into personal grants and revoke the
-- assignments. Kept as roles on purpose: HR and HR_MANAGE (the only source the
-- HR sensitive-data guards accept) and the system governance roles
-- (SUPER_ADMIN, SYSTEM_ADMIN, PERMISSION_ADMIN, BUSINESS_SCOPE_ADMIN, AUDITOR),
-- which the server checks by role code.
-- HR template-only permissions granted by the ordinary roles (e.g. payroll
-- view in the legacy HR profiles) never took effect; they are not copied, so
-- nobody gains access. The migration aborts unless every person keeps exactly
-- the effective permissions they had.

create temporary table p3_convert_roles on commit drop as
select t.id, t.code from public.role_permission_templates t
where t.code in ('BUSINESS_USER', 'WORKFLOW_USER', 'WORKFLOW_ADMIN') or t.code like 'LEGACY_HR_%';

create temporary table p3_assignments on commit drop as
select a.* from public.principal_role_assignments a
where a.status = 'ACTIVE' and a.principal_type = 'user'
  and a.role_template_id in (select id from p3_convert_roles);

-- Effective permissions before, as (user, code, scope) that actually work:
-- HR template-only codes count only when they come from HR / HR_MANAGE.
create temporary table p3_before on commit drop as
select distinct a.principal_id user_id, s.permission_code, s.scope_type, s.scope_id
from (select distinct principal_id from p3_assignments) a
cross join lateral app_private.resolve_effective_permission_sources(a.principal_id, null, null, null, now()) s
where not (s.permission_code like 'hrm.%' and s.source_type = 'LEGACY')
  and (not app_private.is_hrm_template_only_permission(s.permission_code)
       or (s.source_type = 'ROLE' and s.source_code in ('HR', 'HR_MANAGE')));

-- What the converted roles give each person.
create temporary table p3_role_grants on commit drop as
select a.principal_id user_id, s.permission_code, s.scope_type, s.scope_id,
  case when bool_or(s.expires_at is null) then null else max(s.expires_at) end expires_at,
  string_agg(distinct s.source_code, ', ') source_codes
from p3_assignments a
cross join lateral app_private.resolve_effective_permission_sources(a.principal_id, null, null, null, now()) s
where s.source_type = 'ROLE' and s.source_id = a.id::text
  and not app_private.is_hrm_template_only_permission(s.permission_code)
group by a.principal_id, s.permission_code, s.scope_type, s.scope_id;

-- Previous state of every grant row this touches, for an exact rollback.
create table if not exists app_private.p3_roles_conversion_backup (
  user_id uuid not null,
  permission_code text not null,
  scope_type text not null,
  scope_id text not null,
  existed boolean not null,
  prev_row jsonb,
  primary key (user_id, permission_code, scope_type, scope_id)
);
revoke all on app_private.p3_roles_conversion_backup from public, anon, authenticated;
insert into app_private.p3_roles_conversion_backup
select g.user_id, g.permission_code, g.scope_type, g.scope_id, e.id is not null, to_jsonb(e)
from p3_role_grants g
left join public.user_permission_grants e
  on e.user_id = g.user_id and e.permission_code = g.permission_code and e.scope_type = g.scope_type and e.scope_id = g.scope_id
on conflict do nothing;

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at, expires_at, grant_reason)
select g.user_id, g.permission_code, g.scope_type, g.scope_id, true, now(), g.expires_at,
  'Chuyển từ vai trò ' || g.source_codes || ' sang quyền riêng (P3, 28/09/2026)'
from p3_role_grants g
on conflict (user_id, permission_code, scope_type, scope_id) do update set
  expires_at = case
    when public.user_permission_grants.is_active and (public.user_permission_grants.expires_at is null or excluded.expires_at is null) then null
    when public.user_permission_grants.is_active then greatest(public.user_permission_grants.expires_at, excluded.expires_at)
    else excluded.expires_at end,
  is_active = true, revoked_at = null, revoked_by = null, revoked_reason = null,
  grant_reason = coalesce(public.user_permission_grants.grant_reason, excluded.grant_reason),
  updated_at = now();

update public.principal_role_assignments a
set status = 'REVOKED', revoked_at = now(),
    revoked_reason = 'Chuyển sang quyền riêng từng người (P3, 28/09/2026)', updated_at = now()
where a.id in (select id from p3_assignments);

insert into public.audit_trail (table_name, record_id, action, new_data, module, description)
select 'principal_role_assignments', 'p3_roles_to_personal_grants', 'UPDATE',
  jsonb_build_object('assignments', (select count(*) from p3_assignments),
                     'people', (select count(distinct principal_id) from p3_assignments),
                     'grants', (select count(*) from p3_role_grants),
                     'roles', (select jsonb_agg(code order by code) from p3_convert_roles)),
  'SETTINGS', 'Chuyển vai trò gói quyền thường sang quyền riêng từng người';

-- Same effective permissions after, person by person.
do $$
declare v_diff integer;
begin
  select count(*) into v_diff from (
    (select * from p3_before
     except
     select distinct b.user_id, s.permission_code, s.scope_type, s.scope_id
     from (select distinct user_id from p3_before) b
     cross join lateral app_private.resolve_effective_permission_sources(b.user_id, null, null, null, now()) s
     where not (s.permission_code like 'hrm.%' and s.source_type = 'LEGACY')
       and (not app_private.is_hrm_template_only_permission(s.permission_code)
            or (s.source_type = 'ROLE' and s.source_code in ('HR', 'HR_MANAGE'))))
    union all
    (select distinct b.user_id, s.permission_code, s.scope_type, s.scope_id
     from (select distinct user_id from p3_before) b
     cross join lateral app_private.resolve_effective_permission_sources(b.user_id, null, null, null, now()) s
     where not (s.permission_code like 'hrm.%' and s.source_type = 'LEGACY')
       and (not app_private.is_hrm_template_only_permission(s.permission_code)
            or (s.source_type = 'ROLE' and s.source_code in ('HR', 'HR_MANAGE')))
     except
     select * from p3_before)
  ) diff;
  if v_diff <> 0 then
    raise exception 'P3_ROLE_CONVERSION_CHANGED_EFFECTIVE_PERMISSIONS: % differences', v_diff;
  end if;
end $$;
