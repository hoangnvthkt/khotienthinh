-- Task 12.2 final boundary: public API functions remain invokers while the
-- current-actor implementations stay in the non-exposed app_private schema.

create or replace function public.get_my_checkin_context()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_my_checkin_context();
$$;

create or replace function public.list_my_payrolls()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.list_my_payrolls();
$$;

revoke all on function app_private.get_my_checkin_context()
  from public, anon, authenticated;
revoke all on function app_private.list_my_payrolls()
  from public, anon, authenticated;
grant execute on function app_private.get_my_checkin_context()
  to authenticated, service_role;
grant execute on function app_private.list_my_payrolls()
  to authenticated, service_role;

revoke all on function public.get_my_checkin_context()
  from public, anon, authenticated;
revoke all on function public.list_my_payrolls()
  from public, anon, authenticated;
grant execute on function public.get_my_checkin_context()
  to authenticated, service_role;
grant execute on function public.list_my_payrolls()
  to authenticated, service_role;
