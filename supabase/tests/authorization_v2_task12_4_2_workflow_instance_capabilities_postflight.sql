do $$
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code in (
      'workflow.instance.edit_own_draft',
      'workflow.instance.delete_own_draft',
      'workflow.instance.cancel',
      'workflow.instance.reopen',
      'workflow.instance.administer'
    )
      and is_active
  ) <> 5 then
    raise exception 'Workflow capability postflight catalog mismatch';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'cancel_workflow_instance'
      and position(
        '''workflow.instance.cancel'''
        in pg_get_functiondef(p.oid)
      ) > 0
      and position('workflow_has_action' in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'Cancel command does not enforce workflow.instance.cancel';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'reopen_workflow_instance'
      and position(
        '''workflow.instance.reopen'''
        in pg_get_functiondef(p.oid)
      ) > 0
      and position('workflow_has_action' in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'Reopen command does not enforce workflow.instance.reopen';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_workflow_instance_watchers'
      and position(
        '''workflow.instance.administer'''
        in pg_get_functiondef(p.oid)
      ) > 0
      and position('workflow_instance_actor_can_select' in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'Watcher command does not enforce visibility/administer boundary';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'cancel_workflow_instance',
        'reopen_workflow_instance',
        'update_workflow_instance_watchers',
        'update_workflow_instance_content'
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) then
    raise exception 'Workflow command ACL postflight mismatch';
  end if;

  if exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      null, 'workflow.instance.cancel', 'global', '*', now()
    )
  ) then
    raise exception 'Null principal unexpectedly resolves workflow capability';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260916021848'
  ) then
    raise exception 'Workflow capability migration missing from Cloud ledger';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_workflow_instance_content'
      and position(
        '''workflow.instance.administer'''
        in pg_get_functiondef(p.oid)
      ) > 0
      and position(
        'workflow_instance_actor_is_current_assignee'
        in pg_get_functiondef(p.oid)
      ) > 0
  ) then
    raise exception 'Workflow content command does not enforce assigned/admin boundary';
  end if;

  if has_table_privilege('authenticated', 'public.workflow_instances', 'UPDATE')
     or has_table_privilege('authenticated', 'public.workflow_instances', 'DELETE')
     or has_table_privilege('authenticated', 'public.workflow_instance_logs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.workflow_instance_logs', 'DELETE') then
    raise exception 'Authenticated retains direct workflow mutation privileges';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260916095000'
  ) then
    raise exception 'Workflow running mutation guard migration missing from Cloud ledger';
  end if;
end;
$$;

select
  count(*) filter (where grant_readiness = 'enforced') as enforced_actions,
  count(*) filter (where grant_readiness = 'declared') as declared_draft_actions,
  count(*) as workflow_lifecycle_actions
from public.permission_actions
where permission_code in (
  'workflow.instance.edit_own_draft',
  'workflow.instance.delete_own_draft',
  'workflow.instance.cancel',
  'workflow.instance.reopen',
  'workflow.instance.administer'
);
