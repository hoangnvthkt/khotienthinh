revoke execute on function public.current_app_user_id() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.get_next_employee_code() from public;
revoke execute on function public.set_employee_code() from public;

grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_next_employee_code() to authenticated;

notify pgrst, 'reload schema';
