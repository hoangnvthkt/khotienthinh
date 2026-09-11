-- Task 12.2 hardening: expose only the current-actor public wrappers.

create or replace function public.get_my_checkin_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.get_my_checkin_context();
$$;

create or replace function public.list_my_payrolls()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.list_my_payrolls();
$$;

revoke all on function app_private.get_my_checkin_context()
  from public, anon, authenticated;
revoke all on function app_private.list_my_payrolls()
  from public, anon, authenticated;

grant execute on function app_private.get_my_checkin_context()
  to service_role;
grant execute on function app_private.list_my_payrolls()
  to service_role;

revoke all on function public.get_my_checkin_context()
  from public, anon, authenticated;
revoke all on function public.list_my_payrolls()
  from public, anon, authenticated;

grant execute on function public.get_my_checkin_context()
  to authenticated, service_role;
grant execute on function public.list_my_payrolls()
  to authenticated, service_role;
