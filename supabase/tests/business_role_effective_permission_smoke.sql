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

  if not exists (
    select 1
    from pg_policy policy_row
    where policy_row.polrelid = v_assignment_table
      and policy_row.polname = 'principal_role_assignments_self_select'
      and policy_row.polcmd = 'r'
  ) then
    raise exception 'Business Role self-select policy contract failed';
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
