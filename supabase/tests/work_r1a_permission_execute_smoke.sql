begin;
set local role authenticated;
-- Exercise the privilege needed by existing RLS expressions, not an owner call.
do $$
begin
  if app_private.has_permission(null, 'work.module.access', 'global', '*') then
    raise exception 'WORK_NULL_PRINCIPAL_ALLOWED';
  end if;
end;
$$;
reset role;
select 'authenticated helper execution ok' as permission_execute_smoke;
rollback;
