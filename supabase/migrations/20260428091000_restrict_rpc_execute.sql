drop policy if exists app_code_counters_no_select on public.app_code_counters;
drop policy if exists app_code_counters_no_insert on public.app_code_counters;
drop policy if exists app_code_counters_no_update on public.app_code_counters;
drop policy if exists app_code_counters_no_delete on public.app_code_counters;

create policy app_code_counters_no_select
on public.app_code_counters for select
to authenticated
using (false);

create policy app_code_counters_no_insert
on public.app_code_counters for insert
to authenticated
with check (false);

create policy app_code_counters_no_update
on public.app_code_counters for update
to authenticated
using (false)
with check (false);

create policy app_code_counters_no_delete
on public.app_code_counters for delete
to authenticated
using (false);

revoke execute on function public.apply_stock_change(text, text, integer) from anon, authenticated;
revoke execute on function public.create_asset_with_initial_stock(jsonb) from anon;
revoke execute on function public.transfer_asset_stock(text, text, integer, text, text, text, text) from anon;
revoke execute on function public.process_transaction_status(text, public.transaction_status, uuid) from anon;
revoke execute on function public.process_request_step(uuid, uuid, text, text) from anon;
revoke execute on function public.process_workflow_instance(uuid, public.workflow_instance_action, uuid, text) from anon;
revoke execute on function public.next_workflow_code() from anon;
revoke execute on function public.next_request_code() from anon;
revoke execute on function public.next_asset_transfer_code() from anon;
revoke execute on function public.next_asset_code() from anon;
revoke execute on function public.is_module_admin(text) from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.current_app_user_id() from anon;
revoke execute on function public.get_next_employee_code() from anon;
revoke execute on function public.set_employee_code() from anon, authenticated;
revoke execute on function public.execute_readonly_query(text) from anon;
revoke execute on function public.execute_ai_query(text) from anon;

grant execute on function public.create_asset_with_initial_stock(jsonb) to authenticated;
grant execute on function public.transfer_asset_stock(text, text, integer, text, text, text, text) to authenticated;
grant execute on function public.process_transaction_status(text, public.transaction_status, uuid) to authenticated;
grant execute on function public.process_request_step(uuid, uuid, text, text) to authenticated;
grant execute on function public.process_workflow_instance(uuid, public.workflow_instance_action, uuid, text) to authenticated;
grant execute on function public.next_workflow_code() to authenticated;
grant execute on function public.next_request_code() to authenticated;
grant execute on function public.next_asset_transfer_code() to authenticated;
grant execute on function public.next_asset_code() to authenticated;
grant execute on function public.is_module_admin(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.get_next_employee_code() to authenticated;
grant execute on function public.execute_readonly_query(text) to authenticated;
grant execute on function public.execute_ai_query(text) to authenticated;

notify pgrst, 'reload schema';
