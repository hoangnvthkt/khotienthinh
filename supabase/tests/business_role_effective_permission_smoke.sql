do $$
declare
  v_missing_columns integer;
begin
  select count(*)
  into v_missing_columns
  from (values
    ('risk_level'),
    ('is_business_action'),
    ('is_business_approval'),
    ('direct_grant_requires_expiry')
  ) required(column_name)
  where not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'permission_actions'
      and column_row.column_name = required.column_name
      and column_row.is_nullable = 'NO'
  );

  if v_missing_columns <> 0 then
    raise exception 'Business Role risk metadata contract failed';
  end if;

  if to_regclass('public.principal_role_assignments') is null then
    raise exception 'Business Role assignment table contract failed';
  end if;
end;
$$;

do $$
declare
  v_seeded_roles integer;
  v_seeded_permissions integer;
begin
  select count(*)
  into v_seeded_roles
  from public.role_permission_templates role_row
  where role_row.code in (
    'SYSTEM_ADMIN',
    'PERMISSION_ADMIN',
    'BUSINESS_SCOPE_ADMIN',
    'BUSINESS_USER',
    'AUDITOR'
  )
    and role_row.is_active
    and role_row.is_system;

  if v_seeded_roles <> 5 then
    raise exception 'Separated Business Role seed contract failed';
  end if;

  select count(*)
  into v_seeded_permissions
  from public.permission_actions action_row
  where action_row.permission_code in (
    'system.authorization.view',
    'system.authorization.manage_roles',
    'system.authorization.manage_grants',
    'system.authorization.manage_scopes',
    'system.authorization.audit',
    'system.authorization.override'
  )
    and action_row.is_active
    and not action_row.is_business_action
    and not action_row.is_business_approval;

  if v_seeded_permissions <> 6 then
    raise exception 'Governance permission seed contract failed';
  end if;
end;
$$;

do $$
declare
  v_active_admins integer;
  v_bootstrap_assignments integer;
  v_bootstrap_audits integer;
begin
  if exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.permission_code = 'system.settings.manage'
      and grant_row.is_active
  ) then
    raise exception 'Direct System Admin identity grant contract failed';
  end if;

  if exists (
    select 1
    from public.role_permission_template_items item_row
    join public.role_permission_templates role_row
      on role_row.id = item_row.template_id
    where item_row.permission_code = 'system.settings.manage'
      and role_row.code <> 'SYSTEM_ADMIN'
  ) then
    raise exception 'Identity-bound System Admin role contract failed';
  end if;

  if exists (
    select 1
    from public.role_permission_template_items item_row
    join public.role_permission_templates role_row
      on role_row.id = item_row.template_id
    join public.permission_actions action_row
      on action_row.permission_code = item_row.permission_code
    where role_row.code in ('SYSTEM_ADMIN', 'PERMISSION_ADMIN')
      and action_row.is_business_approval
  ) then
    raise exception 'Governance roles contain business approval permission';
  end if;

  select count(*)
  into v_active_admins
  from public.users user_row
  where user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE';

  if v_active_admins < 1 then
    raise exception 'Durable active System Admin precondition failed';
  end if;

  select count(*)
  into v_bootstrap_assignments
  from public.principal_role_assignments assignment_row
  join public.role_permission_templates role_row
    on role_row.id = assignment_row.role_template_id
  join public.users user_row
    on user_row.id = assignment_row.principal_id
  where assignment_row.principal_type = 'user'
    and assignment_row.status = 'ACTIVE'
    and assignment_row.expires_at is null
    and role_row.code in ('SYSTEM_ADMIN', 'PERMISSION_ADMIN')
    and user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
    and assignment_row.assigned_reason = 'Phase 2 bootstrap from active legacy System Admin';

  if v_bootstrap_assignments <> v_active_admins * 2 then
    raise exception 'System Admin compatibility bootstrap contract failed';
  end if;

  select count(*)
  into v_bootstrap_audits
  from public.permission_audit_events event_row
  where event_row.event_type = 'business_role_bootstrapped'
    and event_row.metadata ->> 'source' = 'phase02_migration'
    and exists (
      select 1
      from public.principal_role_assignments assignment_row
      where assignment_row.id::text = event_row.metadata ->> 'assignmentId'
        and assignment_row.assigned_reason = 'Phase 2 bootstrap from active legacy System Admin'
    );

  if v_bootstrap_audits <> v_bootstrap_assignments then
    raise exception 'Bootstrap assignment/audit parity contract failed';
  end if;
end;
$$;

do $$
declare
  v_assignment_table oid := 'public.principal_role_assignments'::regclass;
begin
  if not exists (
    select 1
    from pg_class class_row
    where class_row.oid = v_assignment_table
      and class_row.relrowsecurity
  ) then
    raise exception 'Business Role assignment RLS contract failed';
  end if;

  if not has_table_privilege('authenticated', v_assignment_table, 'SELECT')
    or has_table_privilege('authenticated', v_assignment_table, 'INSERT')
    or has_table_privilege('authenticated', v_assignment_table, 'UPDATE')
    or has_table_privilege('authenticated', v_assignment_table, 'DELETE')
  then
    raise exception 'Business Role assignment ACL contract failed';
  end if;

  if has_table_privilege('authenticated', 'public.role_permission_templates', 'INSERT')
    or has_table_privilege('authenticated', 'public.role_permission_templates', 'UPDATE')
    or has_table_privilege('authenticated', 'public.role_permission_templates', 'DELETE')
    or has_table_privilege('authenticated', 'public.role_permission_template_items', 'INSERT')
    or has_table_privilege('authenticated', 'public.role_permission_template_items', 'UPDATE')
    or has_table_privilege('authenticated', 'public.role_permission_template_items', 'DELETE')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'INSERT')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'UPDATE')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'DELETE')
    or has_table_privilege('authenticated', 'public.permission_audit_events', 'INSERT')
  then
    raise exception 'Governance direct-mutation ACL contract failed';
  end if;

  if to_regprocedure('app_private.resolve_effective_permission_sources(uuid,text,text,text,timestamp with time zone)') is null then
    if not exists (
      select 1
      from pg_policy policy_row
      where policy_row.polrelid = v_assignment_table
        and policy_row.polname = 'principal_role_assignments_self_select'
        and policy_row.polcmd = 'r'
    ) then
      raise exception 'Business Role self-select policy contract failed';
    end if;
  elsif not exists (
    select 1
    from pg_policy policy_row
    where policy_row.polrelid = v_assignment_table
      and policy_row.polname = 'principal_role_assignments_authorized_select'
      and policy_row.polcmd = 'r'
  ) then
    raise exception 'Business Role authorized-select policy contract failed';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = v_assignment_table
      and constraint_row.contype = 'f'
      and pg_get_constraintdef(constraint_row.oid) ilike '%role_template_id%role_permission_templates%'
  ) then
    raise exception 'Business Role assignment role FK contract failed';
  end if;

  if not exists (
    select 1
    from pg_indexes index_row
    where index_row.schemaname = 'public'
      and index_row.tablename = 'principal_role_assignments'
      and index_row.indexname = 'principal_role_assignments_principal_effective_idx'
  ) then
    raise exception 'Business Role principal lookup index contract failed';
  end if;

  if not exists (
    select 1
    from pg_indexes index_row
    where index_row.schemaname = 'public'
      and index_row.tablename = 'principal_role_assignments'
      and index_row.indexname = 'principal_role_assignments_assigned_by_idx'
  ) then
    raise exception 'Business Role assigned-by FK index contract failed';
  end if;

  if not exists (
    select 1
    from pg_indexes index_row
    where index_row.schemaname = 'public'
      and index_row.tablename = 'principal_role_assignments'
      and index_row.indexname = 'principal_role_assignments_revoked_by_idx'
  ) then
    raise exception 'Business Role revoked-by FK index contract failed';
  end if;

  if not exists (
    select 1
    from pg_indexes index_row
    where index_row.schemaname = 'public'
      and index_row.tablename = 'permission_audit_events'
      and index_row.indexname = 'permission_audit_events_actor_idx'
  ) then
    raise exception 'Permission audit actor RLS index contract failed';
  end if;
end;
$$;

do $$
declare
  v_role_template_id uuid;
  v_active_user_id uuid;
  v_rejected boolean := false;
begin
  select role_row.id
  into v_role_template_id
  from public.role_permission_templates role_row
  where role_row.code = 'BUSINESS_USER';

  begin
    insert into public.principal_role_assignments (
      principal_type,
      principal_id,
      role_template_id,
      assigned_reason
    ) values (
      'user',
      gen_random_uuid(),
      v_role_template_id,
      'Reject an unknown application principal'
    );
  exception
    when check_violation then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'Inactive principal rejection contract failed';
  end if;

  select user_row.id
  into v_active_user_id
  from public.users user_row
  where user_row.is_active
    and user_row.account_status = 'ACTIVE'
  order by user_row.id
  limit 1;

  v_rejected := false;
  begin
    insert into public.principal_role_assignments (
      principal_type,
      principal_id,
      role_template_id,
      starts_at,
      assigned_reason
    ) values (
      'user',
      v_active_user_id,
      v_role_template_id,
      now() + interval '1 day',
      'Reject a future Business Role start'
    );
  exception
    when check_violation then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'Future Business Role start rejection contract failed';
  end if;
end;
$$;

select 'business_role_foundation_smoke_passed' as checkpoint;

do $$
begin
  if to_regprocedure('app_private.resolve_effective_permission_sources(uuid,text,text,text,timestamp with time zone)') is null
    or to_regprocedure('public.get_effective_permission_sources(uuid)') is null
  then
    raise exception 'Effective permission resolver function contract failed';
  end if;

  if has_function_privilege(
    'anon',
    'public.get_effective_permission_sources(uuid)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous role can execute effective source RPC';
  end if;

  if has_function_privilege(
    'authenticated',
    'app_private.resolve_effective_permission_sources(uuid,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role can execute raw effective source resolver';
  end if;
end;
$$;

create temporary table phase2_role_smoke_ids (
  target_id uuid not null,
  legacy_target_id uuid not null,
  admin_id uuid not null,
  mirror_admin_id uuid not null,
  permission_admin_id uuid not null,
  auditor_id uuid not null,
  unrelated_id uuid not null,
  inactive_id uuid not null,
  project_item_role_id uuid not null,
  item_wildcard_role_id uuid not null,
  target_email text not null,
  legacy_target_email text not null,
  admin_email text not null,
  mirror_admin_email text not null,
  permission_admin_email text not null,
  auditor_email text not null,
  unrelated_email text not null,
  inactive_email text not null
) on commit drop;

grant select on phase2_role_smoke_ids to authenticated, service_role;

insert into phase2_role_smoke_ids (
  target_id,
  legacy_target_id,
  admin_id,
  mirror_admin_id,
  permission_admin_id,
  auditor_id,
  unrelated_id,
  inactive_id,
  project_item_role_id,
  item_wildcard_role_id,
  target_email,
  legacy_target_email,
  admin_email,
  mirror_admin_email,
  permission_admin_email,
  auditor_email,
  unrelated_email,
  inactive_email
)
select
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase2-role-target-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-role-legacy-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-role-admin-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-role-mirror-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-role-permission-admin-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-role-auditor-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-role-unrelated-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-role-inactive-' || gen_random_uuid()::text || '@vioo.local';

insert into public.users (
  id,
  name,
  email,
  username,
  role,
  is_active,
  account_status,
  allowed_modules,
  admin_modules,
  allowed_sub_modules,
  admin_sub_modules
)
select target_id, 'Phase 2 Role Target', target_email, 'phase2-role-target',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_role_smoke_ids
union all
select legacy_target_id, 'Phase 2 Legacy Target', legacy_target_email, 'phase2-role-legacy',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', array['DA']::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_role_smoke_ids
union all
select admin_id, 'Phase 2 Compatibility Admin', admin_email, 'phase2-role-admin',
       'ADMIN'::public.user_role, true, 'ACTIVE', array['DA']::text[], array['DA','SETTINGS']::text[], '{}'::jsonb, '{}'::jsonb
from phase2_role_smoke_ids
union all
select mirror_admin_id, 'Phase 2 Mirror Admin', mirror_admin_email, 'phase2-role-mirror',
       'ADMIN'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_role_smoke_ids
union all
select permission_admin_id, 'Phase 2 Permission Admin', permission_admin_email, 'phase2-role-permission-admin',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_role_smoke_ids
union all
select auditor_id, 'Phase 2 Auditor', auditor_email, 'phase2-role-auditor',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_role_smoke_ids
union all
select unrelated_id, 'Phase 2 Unrelated', unrelated_email, 'phase2-role-unrelated',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_role_smoke_ids
union all
select inactive_id, 'Phase 2 Inactive', inactive_email, 'phase2-role-inactive',
       'EMPLOYEE'::public.user_role, false, 'DISABLED', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_role_smoke_ids;

insert into public.role_permission_templates (
  id,
  code,
  name,
  description,
  is_active,
  is_system
)
select project_item_role_id,
       'PHASE2_SMOKE_PROJECT_ITEM_' || replace(left(project_item_role_id::text, 8), '-', ''),
       'Phase 2 project item smoke role',
       'Assignment wildcard intersected by a concrete role item',
       true,
       false
from phase2_role_smoke_ids
union all
select item_wildcard_role_id,
       'PHASE2_SMOKE_ITEM_WILDCARD_' || replace(left(item_wildcard_role_id::text, 8), '-', ''),
       'Phase 2 item wildcard smoke role',
       'Role item wildcard intersected by a concrete assignment',
       true,
       false
from phase2_role_smoke_ids;

insert into public.role_permission_template_items (
  template_id,
  permission_code,
  scope_type,
  scope_id,
  sort_order
)
select project_item_role_id, 'project.daily_log.approve', 'project', 'project-1', 10
from phase2_role_smoke_ids
union all
select item_wildcard_role_id, 'project.daily_log.approve', 'project', '*', 10
from phase2_role_smoke_ids;

insert into public.principal_role_assignments (
  principal_type,
  principal_id,
  role_template_id,
  scope_type,
  scope_id,
  starts_at,
  status,
  assigned_reason
)
select 'user', target_id, project_item_role_id, 'project', '*', now(), 'ACTIVE',
       'Test concrete item under wildcard assignment'
from phase2_role_smoke_ids
union all
select 'user', target_id, item_wildcard_role_id, 'project', 'project-1', now(), 'ACTIVE',
       'Test wildcard item under concrete assignment'
from phase2_role_smoke_ids
union all
select 'user', target_id, item_wildcard_role_id, 'project', 'project-expired',
       now() - interval '2 days', 'ACTIVE', 'Test expired Business Role assignment'
from phase2_role_smoke_ids
union all
select 'user', target_id, item_wildcard_role_id, 'project', 'project-revoked',
       now() - interval '2 days', 'ACTIVE', 'Test revoked Business Role assignment'
from phase2_role_smoke_ids
union all
select 'user', mirror_admin_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Test System Admin profile mirror behavior'
from phase2_role_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'SYSTEM_ADMIN'
union all
select 'user', permission_admin_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Test explicit Permission Admin behavior'
from phase2_role_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'PERMISSION_ADMIN'
union all
select 'user', auditor_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Test explicit Auditor read behavior'
from phase2_role_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'AUDITOR';

update public.principal_role_assignments
set expires_at = now() - interval '1 day'
where principal_id = (select target_id from phase2_role_smoke_ids)
  and scope_type = 'project'
  and scope_id = 'project-expired';

update public.principal_role_assignments
set status = 'REVOKED',
    revoked_at = now(),
    revoked_reason = 'Revoked Business Role smoke fixture'
where principal_id = (select target_id from phase2_role_smoke_ids)
  and scope_type = 'project'
  and scope_id = 'project-revoked';

do $$
begin
  if not app_private.has_permission(
    (select admin_id from phase2_role_smoke_ids),
    'project.daily_log.approve',
    'project',
    'project-1'
  ) then
    raise exception 'Compatibility flags disabled changed System Admin business behavior';
  end if;

  if not app_private.has_permission(
    (select admin_id from phase2_role_smoke_ids),
    'system.authorization.manage_roles',
    'global',
    '*'
  ) then
    raise exception 'Compatibility flags disabled changed legacy governance behavior';
  end if;

  if app_private.has_permission(
    (select target_id from phase2_role_smoke_ids),
    'project.daily_log.approve',
    'project',
    'project-1'
  ) then
    raise exception 'Business Role source activated before resolver flag';
  end if;
end;
$$;

update app_private.permission_hardening_settings
set value = 'true'::jsonb,
    updated_at = now()
where key in (
  'business_role_resolver_enabled',
  'legacy_governance_fallback_disabled',
  'system_admin_business_approval_bypass_disabled'
);

do $$
declare
  v_target_id uuid := (select target_id from phase2_role_smoke_ids);
begin
  if (
    select count(*)
    from app_private.resolve_effective_permission_sources(
      v_target_id,
      'project.daily_log.approve',
      'project',
      'project-1',
      now()
    ) source_row
    where source_row.source_type = 'ROLE'
      and source_row.scope_type = 'project'
      and source_row.scope_id = 'project-1'
  ) <> 2 then
    raise exception 'Role scope intersection did not preserve both narrow operands';
  end if;

  if exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      v_target_id,
      'project.daily_log.approve',
      'project',
      'project-1',
      now()
    ) source_row
    where source_row.source_type <> 'ROLE'
  ) then
    raise exception 'Role-only permission resolved from another source';
  end if;

  if app_private.has_permission(
    v_target_id,
    'project.daily_log.approve',
    'project',
    'project-2'
  ) then
    raise exception 'Role scope intersection widened to another project';
  end if;

  if app_private.has_permission(
    v_target_id,
    'project.daily_log.approve',
    'project',
    'project-expired'
  ) then
    raise exception 'Expired Business Role assignment remained effective';
  end if;

  if app_private.has_permission(
    v_target_id,
    'project.daily_log.approve',
    'project',
    'project-revoked'
  ) then
    raise exception 'Revoked Business Role assignment remained effective';
  end if;

  if app_private.has_permission(
    v_target_id,
    'project.daily_log.create',
    'project',
    'project-1'
  ) then
    raise exception 'Adjacent permission existed before direct grant';
  end if;
end;
$$;

insert into public.user_permission_grants (
  user_id,
  permission_code,
  scope_type,
  scope_id,
  is_active,
  granted_at,
  grant_reason
)
select target_id, 'project.daily_log.create', 'project', 'project-1', true, now(),
       'Test adjacent direct grant source'
from phase2_role_smoke_ids
union all
select target_id, 'project.daily_log.create', 'project', 'project-expired', true,
       now() - interval '2 days', 'Test expired direct grant source'
from phase2_role_smoke_ids;

update public.user_permission_grants
set expires_at = now() - interval '1 day'
where user_id = (select target_id from phase2_role_smoke_ids)
  and permission_code = 'project.daily_log.create'
  and scope_type = 'project'
  and scope_id = 'project-expired';

do $$
declare
  v_target_id uuid := (select target_id from phase2_role_smoke_ids);
begin
  if not app_private.has_permission(
    v_target_id,
    'project.daily_log.create',
    'project',
    'project-1'
  ) then
    raise exception 'Matching direct permission did not resolve';
  end if;

  if app_private.has_permission(
    v_target_id,
    'project.daily_log.create',
    'project',
    'project-2'
  ) then
    raise exception 'Direct permission widened to another project';
  end if;

  if app_private.has_permission(
    v_target_id,
    'project.daily_log.create',
    'project',
    'project-expired'
  ) then
    raise exception 'Expired direct permission remained effective';
  end if;

  if not exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      v_target_id,
      'project.daily_log.create',
      'project',
      'project-1',
      now()
    ) source_row
    where source_row.source_type = 'DIRECT'
  ) then
    raise exception 'Direct permission source explanation missing';
  end if;
end;
$$;

do $$
begin
  if app_private.has_permission(
    (select admin_id from phase2_role_smoke_ids),
    'project.daily_log.approve', 'project', 'project-1'
  ) then
    raise exception 'System Admin retained automatic business approval';
  end if;

  if not app_private.has_permission(
    (select admin_id from phase2_role_smoke_ids),
    'system.settings.manage', 'global', '*'
  ) then
    raise exception 'System Admin lost technical settings access';
  end if;

  if app_private.has_permission(
    (select admin_id from phase2_role_smoke_ids),
    'system.authorization.manage_roles', 'global', '*'
  ) or app_private.has_permission(
    (select admin_id from phase2_role_smoke_ids),
    'system.authorization.manage_grants', 'global', '*'
  ) then
    raise exception 'Legacy governance cutoff did not remove implicit admin authority';
  end if;

  if not app_private.has_permission(
    (select permission_admin_id from phase2_role_smoke_ids),
    'system.authorization.manage_roles', 'global', '*'
  ) or not app_private.has_permission(
    (select permission_admin_id from phase2_role_smoke_ids),
    'system.authorization.manage_grants', 'global', '*'
  ) then
    raise exception 'Explicit Permission Admin source did not resolve';
  end if;
end;
$$;

do $$
begin
  if not app_private.has_permission(
    (select legacy_target_id from phase2_role_smoke_ids),
    'project.daily_log.view', 'project', 'project-legacy'
  ) or not app_private.has_permission(
    (select legacy_target_id from phase2_role_smoke_ids),
    'project.daily_log.view', 'warehouse', 'warehouse-legacy'
  ) then
    raise exception 'Global legacy source stopped covering scoped compatibility callers';
  end if;

  if exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      (select inactive_id from phase2_role_smoke_ids),
      null,
      null,
      null,
      now()
    )
  ) then
    raise exception 'Inactive target resolved permission sources';
  end if;
end;
$$;

insert into public.user_permission_grants (
  user_id,
  permission_code,
  scope_type,
  scope_id,
  is_active,
  granted_at,
  grant_reason
)
select mirror_admin_id, 'system.settings.manage', 'global', '*', true, now(),
       'Test identity direct source rejection'
from phase2_role_smoke_ids;

do $$
declare
  v_mirror_admin_id uuid := (select mirror_admin_id from phase2_role_smoke_ids);
begin
  if not exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      v_mirror_admin_id,
      'system.settings.manage',
      'global',
      '*',
      now()
    ) source_row
    where source_row.source_type = 'ROLE'
      and source_row.source_code = 'SYSTEM_ADMIN'
  ) then
    raise exception 'System Admin profile mirror did not resolve identity permission';
  end if;

  if exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      v_mirror_admin_id,
      'system.settings.manage',
      'global',
      '*',
      now()
    ) source_row
    where source_row.source_type = 'DIRECT'
  ) then
    raise exception 'Direct System Admin identity permission was accepted';
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set role service_role;
select set_config('app.account_lifecycle_command', 'on', true);

update public.users
set role = 'EMPLOYEE'::public.user_role
where id = (select mirror_admin_id from phase2_role_smoke_ids);

reset role;
select set_config('app.account_lifecycle_command', '', true);
select set_config('request.jwt.claims', '{}'::jsonb::text, true);

do $$
begin
  if exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      (select mirror_admin_id from phase2_role_smoke_ids),
      'system.settings.manage',
      'global',
      '*',
      now()
    ) source_row
    where source_row.source_type in ('ROLE', 'DIRECT')
  ) then
    raise exception 'Stale System Admin mirror or direct grant survived profile demotion';
  end if;
end;
$$;

set role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select target_email from phase2_role_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  perform public.get_effective_permission_sources(
    (select target_id from phase2_role_smoke_ids)
  );

  if (
    select count(*)
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_id = (select target_id from phase2_role_smoke_ids)
  ) < 1 then
    raise exception 'Principal could not read own Business Role assignments';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select permission_admin_email from phase2_role_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  perform public.get_effective_permission_sources(
    (select target_id from phase2_role_smoke_ids)
  );

  if (
    select count(*)
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_id = (select target_id from phase2_role_smoke_ids)
  ) < 1 then
    raise exception 'Permission Admin RLS read did not resolve without recursion';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select auditor_email from phase2_role_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  perform public.get_effective_permission_sources(
    (select target_id from phase2_role_smoke_ids)
  );

  if (
    select count(*)
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_id = (select target_id from phase2_role_smoke_ids)
  ) < 1 then
    raise exception 'Auditor RLS read did not resolve without recursion';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select unrelated_email from phase2_role_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.get_effective_permission_sources(
      (select target_id from phase2_role_smoke_ids)
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'Unrelated caller read another principal authorization sources';
  end if;

  if exists (
    select 1
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_id = (select target_id from phase2_role_smoke_ids)
  ) then
    raise exception 'Unrelated caller read another principal role assignment through RLS';
  end if;
end;
$$;

reset role;

delete from public.user_permission_grants
where user_id in (
  select target_id from phase2_role_smoke_ids
  union all
  select mirror_admin_id from phase2_role_smoke_ids
);

delete from public.principal_role_assignments
where principal_id in (
  select target_id from phase2_role_smoke_ids
  union all
  select mirror_admin_id from phase2_role_smoke_ids
  union all
  select permission_admin_id from phase2_role_smoke_ids
  union all
  select auditor_id from phase2_role_smoke_ids
);

delete from public.role_permission_template_items
where template_id in (
  select project_item_role_id from phase2_role_smoke_ids
  union all
  select item_wildcard_role_id from phase2_role_smoke_ids
);

delete from public.role_permission_templates
where id in (
  select project_item_role_id from phase2_role_smoke_ids
  union all
  select item_wildcard_role_id from phase2_role_smoke_ids
);

delete from public.users
where id in (
  select target_id from phase2_role_smoke_ids
  union all
  select legacy_target_id from phase2_role_smoke_ids
  union all
  select admin_id from phase2_role_smoke_ids
  union all
  select mirror_admin_id from phase2_role_smoke_ids
  union all
  select permission_admin_id from phase2_role_smoke_ids
  union all
  select auditor_id from phase2_role_smoke_ids
  union all
  select unrelated_id from phase2_role_smoke_ids
  union all
  select inactive_id from phase2_role_smoke_ids
);

select 'business_role_effective_permission_smoke_passed' as checkpoint;
