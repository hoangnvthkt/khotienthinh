do $$
declare
  v_super_id uuid;
  v_has_transition_data boolean;
begin
  if (
    select count(*) from public.permission_actions
    where permission_code in (
      'request.instance.approve_assigned','request.instance.reject_assigned',
      'request.instance.return_assigned','request.instance.resubmit_own',
      'request.instance.cancel','request.instance.reassign',
      'request.instance.edit_own_content'
    ) and is_active and grant_readiness='enforced' and direct_grant_allowed
  )<>7 then raise exception 'E26 Request lifecycle catalog mismatch'; end if;

  select id into v_super_id from public.role_permission_templates
  where code='SUPER_ADMIN' and is_system and is_active;
  if v_super_id is null then raise exception 'E26 SUPER_ADMIN template missing'; end if;
  if exists(select 1 from public.role_permission_template_items where template_id=v_super_id) then
    raise exception 'E26 SUPER_ADMIN was expanded into static items';
  end if;
  if exists(select 1 from public.principal_role_assignments where role_template_id=v_super_id) then
    raise exception 'E26 migration assigned SUPER_ADMIN to a real principal';
  end if;

  if not exists (
    select 1 from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid=function_row.pronamespace
    where function_schema.nspname='app_private'
      and function_row.proname='request_actor_has_lifecycle_action'
  ) or not exists (
    select 1 from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid=function_row.pronamespace
    where function_schema.nspname='app_private'
      and function_row.proname='guard_super_admin_assignment'
  ) then raise exception 'E26 private guards missing'; end if;

  if exists (
    select 1 from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid=function_row.pronamespace
    where function_schema.nspname='app_private'
      and function_row.proname in (
        'request_actor_has_lifecycle_action','guard_request_instance_lifecycle_v2',
        'guard_request_assignment_lifecycle_v2','actor_has_permission_admin_role',
        'guard_super_admin_assignment','guard_super_admin_template',
        'guard_super_admin_template_item'
      ) and (
        has_function_privilege('anon',function_row.oid,'EXECUTE')
        or has_function_privilege('authenticated',function_row.oid,'EXECUTE')
        or has_function_privilege('service_role',function_row.oid,'EXECUTE')
      )
  ) then raise exception 'E26 private guard leaked EXECUTE'; end if;

  if pg_get_functiondef('app_private.resolve_effective_permission_sources(uuid,text,text,text,timestamptz)'::regprocedure)
       not like '%super_admin_sources as%'
  then raise exception 'E26 dynamic resolver branch missing'; end if;

  if not exists(select 1 from supabase_migrations.schema_migrations where version='20260916110000')
     or not exists(select 1 from supabase_migrations.schema_migrations where version='20260916110100')
     or not exists(select 1 from supabase_migrations.schema_migrations where version='20260916110200') then
    raise exception 'E26 migrations missing from Cloud ledger';
  end if;

  -- Older rollout branches may not have transition tables at all. E26 must
  -- neither require them nor create records when they do exist.
  if to_regclass('public.permission_transition_batches') is not null then
    execute 'select exists(select 1 from public.permission_transition_batches)'
      into strict v_has_transition_data;
    if v_has_transition_data then
      raise exception 'E26 unexpectedly created transition batch data';
    end if;
  end if;
  if to_regclass('public.permission_transition_batch_items') is not null then
    execute 'select exists(select 1 from public.permission_transition_batch_items)'
      into strict v_has_transition_data;
    if v_has_transition_data then
      raise exception 'E26 unexpectedly created transition item data';
    end if;
  end if;
end;
$$;

select
  (select count(*) from public.permission_actions where is_active) active_actions,
  (select count(*) from public.role_permission_templates where code='SUPER_ADMIN') super_admin_templates,
  (select count(*) from public.principal_role_assignments assignment
    join public.role_permission_templates template_row on template_row.id=assignment.role_template_id
    where template_row.code='SUPER_ADMIN') super_admin_assignments;
