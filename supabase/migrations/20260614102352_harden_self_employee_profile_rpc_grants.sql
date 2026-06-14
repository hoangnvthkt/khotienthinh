-- Tighten self employee profile RPC grants.
-- The function still guards by current_app_user_id(), but anon should not see execute.

revoke all on function public.update_my_employee_profile(jsonb) from anon;
revoke all on function public.update_my_employee_profile(jsonb) from public;
grant execute on function public.update_my_employee_profile(jsonb) to authenticated;

revoke all on function app_private.update_my_employee_profile_impl(jsonb) from anon;
revoke all on function app_private.update_my_employee_profile_impl(jsonb) from public;
grant execute on function app_private.update_my_employee_profile_impl(jsonb) to authenticated;

notify pgrst, 'reload schema';
