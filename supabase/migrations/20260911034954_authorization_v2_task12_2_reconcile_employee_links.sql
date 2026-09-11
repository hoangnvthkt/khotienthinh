with active_accounts as (
  select account.id, lower(trim(account.email)) as email_key
  from public.users account
  where account.is_active
    and account.account_status = 'ACTIVE'
    and account.auth_id is not null
    and nullif(trim(account.email), '') is not null
), active_employees as (
  select employee.id, employee.user_id, lower(trim(employee.email)) as email_key
  from public.employees employee
  where employee.status = 'Đang làm việc'
    and nullif(trim(employee.email), '') is not null
), unambiguous_links as (
  select account.id as user_id, employee.id as employee_id
  from active_accounts account
  join active_employees employee on employee.email_key = account.email_key
  where employee.user_id is null
    and not exists (
      select 1 from active_employees linked where linked.user_id = account.id
    )
    and (select count(*) from active_accounts same_account
      where same_account.email_key = account.email_key) = 1
    and (select count(*) from active_employees same_employee
      where same_employee.email_key = employee.email_key) = 1
)
update public.employees employee
set user_id = link.user_id,
    updated_at = now()
from unambiguous_links link
where employee.id = link.employee_id
  and employee.user_id is null;

comment on function public.get_my_checkin_context() is
  'Task 12.2: current JWT actor Check-in context; exact employees.user_id ownership only, after unambiguous legacy email-link reconciliation.';
