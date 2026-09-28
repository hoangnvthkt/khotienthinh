-- Run after authorization_p1_5_retire_request_module_admin. Rolls back.
begin;
do $$ begin
  if exists (select 1 from public.user_permission_grants g join public.users u on u.id = g.user_id
             where g.is_active and u.role <> 'ADMIN' and g.permission_code = 'system.rq.manage') then
    raise exception 'request module admin remains';
  end if;
  if exists (select 1 from public.users where role <> 'ADMIN'
             and ('RQ' = any(coalesce(admin_modules, '{}'::text[])) or coalesce(admin_sub_modules, '{}'::jsonb) ? 'RQ')) then
    raise exception 'legacy RQ flag remains';
  end if;
  if (select count(distinct g.user_id) from public.user_permission_grants g where g.is_active and g.permission_code = 'request.template.manage') = 0 then
    raise exception 'template managers were touched';
  end if;
end $$;
rollback;
