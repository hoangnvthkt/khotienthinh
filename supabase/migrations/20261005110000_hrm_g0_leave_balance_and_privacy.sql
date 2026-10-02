-- HRM G0 — leave fixes and privacy (owner decisions 02/10/2026, docs/audits/hrm-attendance-leave-2026-10-02 §11).

-- ── Leave balance: the write trigger referenced snake_case columns that do not exist
-- (record "new" has no field "last_accrual_month"), so every save of a 2026 balance failed.
-- Decision 4: +1 day on the 1st of each month, none during probation, HR edits the remainder.
drop trigger if exists trg_accrue_leave_on_load on public.hrm_leave_balances;
drop function if exists public.accrue_leave_balances();

alter table public.hrm_leave_balances alter column "monthlyAccrual" set default 1;

create or replace function app_private.accrue_monthly_leave()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_month integer := extract(month from v_today)::integer;
  v_year integer := extract(year from v_today)::integer;
  v_count integer;
begin
  -- Idempotent: each balance row moves at most to the current month, once.
  update public.hrm_leave_balances balance
  set "accruedDays" = coalesce(balance."accruedDays", 0)
        + coalesce(balance."monthlyAccrual", 1) * (v_month - coalesce(balance."lastAccrualMonth", 0)),
      "lastAccrualMonth" = v_month
  from public.employees employee
  where employee.id = balance."employeeId"
    and employee.status = 'Đang làm việc'
    -- Probation has no leave: accrue only once the official date has been reached (or is unknown).
    and (employee.official_date is null or employee.official_date <= date_trunc('month', v_today)::date)
    and balance.year = v_year
    and coalesce(balance."lastAccrualMonth", 0) < v_month;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function app_private.accrue_monthly_leave() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'hrm-monthly-leave-accrual';
-- Daily at 00:05 Vietnam time; the function only acts once per month per balance.
select cron.schedule('hrm-monthly-leave-accrual', '5 17 * * *', 'select app_private.accrue_monthly_leave()');

-- Every change to a balance (HR direct edit, approval deduction, monthly accrual) is kept.
create table if not exists public.hrm_leave_balance_changes (
  id uuid primary key default gen_random_uuid(),
  balance_id uuid not null,
  employee_id uuid not null,
  year integer not null,
  actor_user_id uuid,
  operation text not null,
  before_row jsonb,
  after_row jsonb,
  created_at timestamptz not null default now()
);
alter table public.hrm_leave_balance_changes enable row level security;
revoke all on public.hrm_leave_balance_changes from anon;
drop policy if exists hrm_leave_balance_changes_select on public.hrm_leave_balance_changes;
create policy hrm_leave_balance_changes_select on public.hrm_leave_balance_changes
  for select to authenticated
  using (app_private.hrm_can_access_employee_subject(employee_id, 'hrm.leave.view'::text));
create index if not exists hrm_leave_balance_changes_employee_idx
  on public.hrm_leave_balance_changes (employee_id, created_at desc);

create or replace function app_private.log_hrm_leave_balance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.hrm_leave_balance_changes (balance_id, employee_id, year, actor_user_id, operation, before_row, after_row)
  values (
    coalesce(new.id, old.id),
    coalesce(new."employeeId", old."employeeId"),
    coalesce(new.year, old.year),
    public.current_app_user_id(),
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$function$;
revoke all on function app_private.log_hrm_leave_balance_change() from public, anon, authenticated;

drop trigger if exists trg_log_hrm_leave_balance_change on public.hrm_leave_balances;
create trigger trg_log_hrm_leave_balance_change
  after insert or update or delete on public.hrm_leave_balances
  for each row execute function app_private.log_hrm_leave_balance_change();

-- ── Leave requests: half days and paid flag ────────────────────────────────
alter table public.hrm_leave_requests
  alter column "totalDays" type numeric(5,1) using "totalDays"::numeric,
  alter column "totalDays" set default 1;
alter table public.hrm_leave_requests drop constraint if exists hrm_leave_requests_total_days_half_step;
alter table public.hrm_leave_requests add constraint hrm_leave_requests_total_days_half_step
  check ("totalDays" > 0 and "totalDays" * 2 = floor("totalDays" * 2));

create or replace function app_private.set_hrm_leave_request_paid()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new."isPaid" := coalesce(new.type, 'annual') <> 'unpaid';
  return new;
end;
$function$;
drop trigger if exists trg_set_hrm_leave_request_paid on public.hrm_leave_requests;
create trigger trg_set_hrm_leave_request_paid
  before insert or update of type, "isPaid" on public.hrm_leave_requests
  for each row execute function app_private.set_hrm_leave_request_paid();

update public.hrm_leave_requests
set "isPaid" = (type <> 'unpaid')
where "isPaid" is distinct from (type <> 'unpaid');

-- Approval history is append-only.
drop policy if exists hrm_leave_logs_approve_update on public.hrm_leave_logs;
drop policy if exists hrm_leave_logs_approve_delete on public.hrm_leave_logs;

-- ── Privacy (decision 7): only HR sees other people's leave and profiles ──
-- The 28/09 P3 conversion turned legacy HR module-view roles into direct company-wide
-- grants of hrm.leave.view / hrm.employee.view_profile for ~44 non-HR accounts.
-- Kept: HR / HR Manage role holders, and the accounts that still approve leave company-wide
-- (their approvals need the view until rule-based routing replaces them in G2).
create table if not exists app_private.hrm_g0_privacy_revocation_backup (
  grant_id uuid primary key,
  user_id uuid not null,
  prev_row jsonb not null,
  revoked_at timestamptz not null default now()
);
revoke all on app_private.hrm_g0_privacy_revocation_backup from public, anon, authenticated;

insert into app_private.hrm_g0_privacy_revocation_backup (grant_id, user_id, prev_row)
select grant_row.id, grant_row.user_id, to_jsonb(grant_row)
from public.user_permission_grants grant_row
where grant_row.is_active
  and grant_row.revoked_at is null
  and grant_row.scope_type = 'global'
  and (
    (grant_row.permission_code = 'hrm.employee.view_profile'
      and not app_private.has_hrm_template_permission(grant_row.user_id, 'hrm.employee.view_sensitive'))
    or (grant_row.permission_code = 'hrm.leave.view'
      and not app_private.has_hrm_template_permission(grant_row.user_id, 'hrm.employee.view_sensitive')
      and not app_private.has_governed_hrm_permission(grant_row.user_id, 'hrm.leave.approve', 'global', '*'))
  )
on conflict (grant_id) do nothing;

insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
select null, backup.user_id, 'direct_permission_grants_changed',
  jsonb_agg(jsonb_build_object('permissionCode', backup.prev_row ->> 'permission_code',
    'scopeType', 'global', 'scopeId', backup.prev_row ->> 'scope_id', 'expiresAt', backup.prev_row ->> 'expires_at')),
  '[]'::jsonb,
  jsonb_build_object('reason', 'Quyết định 7 (02/10): chỉ HR xem đơn phép và hồ sơ của người khác', 'migration', '20261005110000')
from app_private.hrm_g0_privacy_revocation_backup backup
join public.user_permission_grants grant_row on grant_row.id = backup.grant_id and grant_row.is_active
group by backup.user_id;

update public.user_permission_grants grant_row
set is_active = false,
    revoked_at = now(),
    revoked_reason = 'Quyết định 7 (02/10/2026): chỉ HR / HR Manage xem đơn phép và hồ sơ của người khác',
    updated_at = now()
from app_private.hrm_g0_privacy_revocation_backup backup
where grant_row.id = backup.grant_id and grant_row.is_active;
