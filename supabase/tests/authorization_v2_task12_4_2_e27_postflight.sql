do $$
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20260916110300') then
    raise exception 'E27 migration missing from Cloud ledger';
  end if;
  if to_regprocedure('public.get_business_role_admin_snapshot()') is null
     or to_regprocedure('public.preview_business_role_assignment_v2(uuid,uuid,text,text)') is null
     or to_regprocedure('public.save_business_role_v2(uuid,integer,text,text,text,jsonb,text)') is null
     or to_regprocedure('public.assign_business_role_v2(uuid,uuid,integer,text,text,timestamptz,timestamptz,text,jsonb,text)') is null then
    raise exception 'E27 public command contract is incomplete';
  end if;
  if has_function_privilege('anon','public.get_business_role_admin_snapshot()','EXECUTE')
     or has_function_privilege('anon','public.preview_business_role_assignment_v2(uuid,uuid,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_business_role_admin_snapshot()','EXECUTE')
     or not has_function_privilege('authenticated','public.save_business_role_v2(uuid,integer,text,text,text,jsonb,text)','EXECUTE') then
    raise exception 'E27 RPC ACL mismatch';
  end if;
  if has_function_privilege('authenticated','public.save_business_role(uuid,text,text,text,jsonb,text)','EXECUTE')
     or has_function_privilege('authenticated','public.assign_business_role(uuid,uuid,text,text,timestamptz,timestamptz,text,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.save_business_role(uuid,text,text,text,jsonb,text)','EXECUTE')
     or has_function_privilege('anon','public.assign_business_role(uuid,uuid,text,text,timestamptz,timestamptz,text,jsonb)','EXECUTE') then
    raise exception 'E27 legacy mutation RPC is still exposed';
  end if;
  if exists(select 1 from public.role_permission_templates where code like 'E27_%')
     or exists(select 1 from public.users where email like 'e27-%@vioo.local') then
    raise exception 'E27 rollback fixture leaked';
  end if;
end;
$$;

select
  (select count(*) from public.role_permission_templates) template_count,
  (select count(*) from public.role_permission_template_items) template_item_count,
  (select count(*) from public.principal_role_assignments where status='ACTIVE') active_assignment_count,
  (select count(*) from public.principal_role_assignments assignment
    join public.role_permission_templates template_row on template_row.id=assignment.role_template_id
    where template_row.code='SUPER_ADMIN') super_admin_assignments;
