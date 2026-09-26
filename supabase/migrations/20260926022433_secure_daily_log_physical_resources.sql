-- Keep privileged owner reads outside the Data API's exposed public schema.
-- Preserve the tested function body and replace only its schema/entry point.
alter function public.get_daily_log_physical_resources_v1(text[]) set schema app_private;
alter function app_private.get_daily_log_physical_resources_v1(text[])
  rename to get_daily_log_physical_resources_impl_v1;

revoke all on function app_private.get_daily_log_physical_resources_impl_v1(text[])
  from public, anon, authenticated;
grant execute on function app_private.get_daily_log_physical_resources_impl_v1(text[])
  to authenticated;

create or replace function public.get_daily_log_physical_resources_v1(p_log_ids text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.get_daily_log_physical_resources_impl_v1(p_log_ids);
$$;
revoke all on function public.get_daily_log_physical_resources_v1(text[])
  from public, anon, authenticated;
grant execute on function public.get_daily_log_physical_resources_v1(text[])
  to authenticated;

notify pgrst, 'reload schema';
