-- HRM G2b — carried-over leave and the leave ledger (owner decision 4, 02/10/2026;
-- docs/audits/hrm-attendance-leave-2026-10-02 §11):
--   * On 1 January the unused annual leave moves into the new year as "phép tồn", used first and
--     usable for leave that starts on or before 31/03. What is left after that expires.
--   * Every change to the annual balance writes one ledger line (monthly accrual, approved leave,
--     cancelled leave, carry-in, carry expiry, HR adjustment, opening balance), whatever path made it:
--     a trigger on hrm_leave_balances writes the line; callers only label it.
--   * HR adjusts the remaining days with a reason; employees read their own ledger.
-- Available annual days = accrued + carried − carry expired − used paid.

alter table public.hrm_leave_balances
  add column if not exists "carriedDays" numeric(5,1) not null default 0,
  add column if not exists "carryExpiresOn" date,
  add column if not exists "carryUsedDays" numeric(5,1) not null default 0,
  add column if not exists "carryExpiredDays" numeric(5,1) not null default 0;

create or replace function app_private.hrm_leave_available(p_balance public.hrm_leave_balances)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select coalesce(p_balance."accruedDays", 0) + coalesce(p_balance."carriedDays", 0)
    - coalesce(p_balance."carryExpiredDays", 0) - coalesce(p_balance."usedPaidDays", 0);
$function$;

-- ── Ledger ─────────────────────────────────────────────────────────────────
create table if not exists public.hrm_leave_ledger (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  year integer not null,
  balance_id uuid not null,
  kind text not null check (kind in ('opening','accrual','leave','leave_cancel','carry_in','carry_expire','adjust')),
  days numeric(6,1) not null,
  carry_days numeric(6,1) not null default 0,
  balance_after numeric(6,1) not null,
  leave_request_id uuid,
  note text,
  actor_user_id uuid,
  -- Wall-clock time: several lines can be written in one transaction (1 January: expiry, carry-in, accrual).
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists hrm_leave_ledger_employee_idx on public.hrm_leave_ledger (employee_id, year, created_at);
create index if not exists hrm_leave_ledger_request_idx on public.hrm_leave_ledger (leave_request_id) where leave_request_id is not null;
alter table public.hrm_leave_ledger enable row level security;
revoke all on public.hrm_leave_ledger from anon, authenticated;
-- Read through get_hrm_leave_ledger only.

-- Callers label the next balance change; cleared after the update.
create or replace function app_private.hrm_leave_ledger_label(p_kind text, p_request_id uuid default null, p_on date default null, p_note text default null)
returns void
language sql
volatile
set search_path = ''
as $function$
  select set_config('app.hrm_leave_ledger',
    case when p_kind is null then '' else jsonb_build_object('kind', p_kind, 'requestId', p_request_id, 'on', p_on, 'note', p_note)::text end,
    true);
$function$;
revoke all on function app_private.hrm_leave_ledger_label(text, uuid, date, text) from public, anon, authenticated;

create or replace function app_private.hrm_leave_ledger_context()
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select coalesce(nullif(current_setting('app.hrm_leave_ledger', true), '')::jsonb, '{}'::jsonb);
$function$;
revoke all on function app_private.hrm_leave_ledger_context() from public, anon, authenticated;

-- Carried days are spent first: allocate on approval, give back on cancellation.
create or replace function app_private.hrm_leave_balance_allocate_carry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb := app_private.hrm_leave_ledger_context();
  v_on date := coalesce(nullif(v_context ->> 'on', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_delta numeric := coalesce(new."usedPaidDays", 0) - coalesce(old."usedPaidDays", 0);
  v_part numeric;
begin
  if v_delta > 0 and new."carryExpiresOn" is not null and v_on <= new."carryExpiresOn" then
    v_part := least(v_delta, greatest(0, new."carriedDays" - new."carryUsedDays" - new."carryExpiredDays"));
    new."carryUsedDays" := new."carryUsedDays" + v_part;
  elsif v_delta < 0 and v_context ->> 'requestId' is not null then
    select greatest(0, least(-v_delta, coalesce(-sum(ledger.carry_days), 0))) into v_part
    from public.hrm_leave_ledger ledger
    where ledger.leave_request_id = (v_context ->> 'requestId')::uuid and ledger.balance_id = new.id;
    new."carryUsedDays" := greatest(0, new."carryUsedDays" - coalesce(v_part, 0));
    -- Carried days given back after 31/03 have already expired.
    if new."carryExpiresOn" is not null and v_today > new."carryExpiresOn" then
      new."carryExpiredDays" := new."carryExpiredDays" + coalesce(v_part, 0);
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function app_private.hrm_leave_balance_allocate_carry() from public, anon, authenticated;

drop trigger if exists trg_hrm_leave_balance_allocate_carry on public.hrm_leave_balances;
create trigger trg_hrm_leave_balance_allocate_carry
  before update of "usedPaidDays" on public.hrm_leave_balances
  for each row execute function app_private.hrm_leave_balance_allocate_carry();

create or replace function app_private.hrm_leave_balance_write_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb := app_private.hrm_leave_ledger_context();
  v_after numeric := app_private.hrm_leave_available(new);
  v_days numeric := v_after - case when tg_op = 'INSERT' then 0 else app_private.hrm_leave_available(old) end;
  v_carry numeric := case when tg_op = 'INSERT' then new."carriedDays"
    else (new."carryUsedDays" - old."carryUsedDays") * -1 + (new."carriedDays" - old."carriedDays")
         - (new."carryExpiredDays" - old."carryExpiredDays") end;
  v_kind text := coalesce(v_context ->> 'kind', case when tg_op = 'INSERT' then 'opening' else 'adjust' end);
begin
  if tg_op = 'UPDATE' and v_days = 0 and v_carry = 0 then
    return new; -- unpaid days, settings: not part of the annual balance
  end if;
  insert into public.hrm_leave_ledger (employee_id, year, balance_id, kind, days, carry_days, balance_after, leave_request_id, note, actor_user_id)
  values (new."employeeId", new.year, new.id, v_kind, v_days, v_carry, v_after,
          nullif(v_context ->> 'requestId', '')::uuid, nullif(v_context ->> 'note', ''), public.current_app_user_id());
  return new;
end;
$function$;
revoke all on function app_private.hrm_leave_balance_write_ledger() from public, anon, authenticated;

drop trigger if exists trg_hrm_leave_balance_write_ledger on public.hrm_leave_balances;
create trigger trg_hrm_leave_balance_write_ledger
  after insert or update on public.hrm_leave_balances
  for each row execute function app_private.hrm_leave_balance_write_ledger();

-- Opening line for balances that exist today, so each ledger adds up to the balance.
insert into public.hrm_leave_ledger (employee_id, year, balance_id, kind, days, carry_days, balance_after, note)
select balance."employeeId", balance.year, balance.id, 'opening', app_private.hrm_leave_available(balance), 0,
  app_private.hrm_leave_available(balance), 'Số dư khi bắt đầu ghi sổ phép (02/10/2026)'
from public.hrm_leave_balances balance
where not exists (select 1 from public.hrm_leave_ledger ledger where ledger.balance_id = balance.id);

-- ── Available days for a leave starting on a given date ────────────────────
create or replace function app_private.hrm_leave_annual_available(p_employee_id uuid, p_on date, p_exclude_request uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select app_private.hrm_leave_available(balance)
      -- Unused carried days cannot cover leave that starts after they expire.
      - case when balance."carryExpiresOn" is not null and p_on > balance."carryExpiresOn"
             then greatest(0, balance."carriedDays" - balance."carryUsedDays" - balance."carryExpiredDays") else 0 end
    from public.hrm_leave_balances balance
    where balance."employeeId" = p_employee_id and balance.year = extract(year from p_on)::integer
    limit 1
  ), 0) - coalesce((
    select sum(request."totalDays") from public.hrm_leave_requests request
    where request."employeeId" = p_employee_id and request.type = 'annual' and request.status = 'pending'
      and left(request."startDate", 4)::integer = extract(year from p_on)::integer
      and request.id is distinct from p_exclude_request
  ), 0);
$function$;
revoke all on function app_private.hrm_leave_annual_available(uuid, date, uuid) from public, anon, authenticated;

create or replace function app_private.hrm_leave_annual_remaining(p_employee_id uuid, p_year integer, p_exclude_request uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select app_private.hrm_leave_annual_available(p_employee_id,
    greatest((now() at time zone 'Asia/Ho_Chi_Minh')::date, make_date(p_year, 1, 1)), p_exclude_request);
$function$;

-- ── Daily jobs: carry expiry, year rollover, monthly accrual ───────────────
create or replace function app_private.hrm_leave_year_maintenance()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_year integer := extract(year from v_today)::integer;
  v_count integer := 0;
  v_rows integer;
begin
  perform app_private.hrm_leave_ledger_label('carry_expire', null, null, 'Phép tồn năm trước hết hạn sau 31/03');
  update public.hrm_leave_balances
  set "carryExpiredDays" = "carriedDays" - "carryUsedDays"
  where "carryExpiresOn" < v_today and "carriedDays" - "carryUsedDays" - "carryExpiredDays" > 0;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- New year: everyone with last year's balance gets this year's, carrying the unused days
  -- (usable until 31/03). In January, active staff without any balance get an empty one so the
  -- monthly accrual reaches them.
  perform app_private.hrm_leave_ledger_label('carry_in', null, null, format('Chuyển phép tồn năm %s sang năm %s, dùng đến 31/03/%s', v_year - 1, v_year, v_year));
  insert into public.hrm_leave_balances (
    "employeeId", year, "initialDays", "monthlyAccrual", "accruedDays", "usedPaidDays", "usedUnpaidDays",
    "lastAccrualMonth", "carriedDays", "carryExpiresOn"
  )
  select employee.id, v_year, coalesce(previous."initialDays", 12), coalesce(previous."monthlyAccrual", 1), 0, 0, 0, 0,
    greatest(0, coalesce(app_private.hrm_leave_available(previous), 0)), make_date(v_year, 3, 31)
  from public.employees employee
  left join public.hrm_leave_balances previous on previous."employeeId" = employee.id and previous.year = v_year - 1
  where employee.status = 'Đang làm việc'
    and not exists (select 1 from public.hrm_leave_balances current_row
                    where current_row."employeeId" = employee.id and current_row.year = v_year)
    and (previous.id is not null or extract(month from v_today) = 1)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  perform app_private.hrm_leave_ledger_label(null);
  return v_count;
end;
$function$;
revoke all on function app_private.hrm_leave_year_maintenance() from public, anon, authenticated;

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
  perform app_private.hrm_leave_year_maintenance();
  perform app_private.hrm_leave_ledger_label('accrual', null, null, format('Cộng phép tháng %s/%s', v_month, v_year));
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
  perform app_private.hrm_leave_ledger_label(null);
  return v_count;
end;
$function$;
revoke all on function app_private.accrue_monthly_leave() from public, anon, authenticated;

-- ── Read and adjust ────────────────────────────────────────────────────────
create or replace function app_private.hrm_leave_balance_json(p_balance public.hrm_leave_balances)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when p_balance.id is null then null else jsonb_build_object(
    'year', p_balance.year,
    'accruedDays', p_balance."accruedDays",
    'usedPaidDays', p_balance."usedPaidDays",
    'usedUnpaidDays', p_balance."usedUnpaidDays",
    'carriedDays', p_balance."carriedDays",
    'carryUsedDays', p_balance."carryUsedDays",
    'carryExpiredDays', p_balance."carryExpiredDays",
    'carryExpiresOn', p_balance."carryExpiresOn",
    'carryLeft', case when p_balance."carryExpiresOn" is not null
                        and (now() at time zone 'Asia/Ho_Chi_Minh')::date <= p_balance."carryExpiresOn"
                      then greatest(0, p_balance."carriedDays" - p_balance."carryUsedDays" - p_balance."carryExpiredDays") else 0 end,
    'availableDays', app_private.hrm_leave_available(p_balance),
    'pendingDays', coalesce((select sum(request."totalDays") from public.hrm_leave_requests request
      where request."employeeId" = p_balance."employeeId" and request.type = 'annual' and request.status = 'pending'
        and left(request."startDate", 4)::integer = p_balance.year), 0)
  ) end;
$function$;
revoke all on function app_private.hrm_leave_balance_json(public.hrm_leave_balances) from public, anon, authenticated;

create or replace function public.get_hrm_leave_ledger(p_employee_id uuid, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_balance public.hrm_leave_balances%rowtype;
begin
  if not (app_private.hrm_employee_is_current_user(p_employee_id::text)
          or app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive')) then
    raise exception using errcode = '42501', message = 'Chỉ xem được sổ phép của chính mình.';
  end if;
  select * into v_balance from public.hrm_leave_balances where "employeeId" = p_employee_id and year = p_year;
  return jsonb_build_object(
    'balance', app_private.hrm_leave_balance_json(v_balance),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ledger.id, 'kind', ledger.kind, 'days', ledger.days, 'carryDays', ledger.carry_days,
        'balanceAfter', ledger.balance_after, 'note', ledger.note, 'createdAt', ledger.created_at,
        'leaveRequestId', ledger.leave_request_id,
        'leaveCode', request.code, 'leaveStart', request."startDate", 'leaveEnd', request."endDate",
        'actorName', (select coalesce(nullif(u.name, ''), u.email) from public.users u where u.id = ledger.actor_user_id)
      ) order by ledger.created_at desc, ledger.id)
      from public.hrm_leave_ledger ledger
      left join public.hrm_leave_requests request on request.id = ledger.leave_request_id
      where ledger.employee_id = p_employee_id and ledger.year = p_year
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.get_hrm_leave_ledger(uuid, integer) from public, anon;
grant execute on function public.get_hrm_leave_ledger(uuid, integer) to authenticated;

create or replace function public.list_hrm_leave_balances(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'Chỉ HR xem được số phép toàn công ty.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employeeId', employee.id, 'employeeCode', employee.employee_code, 'fullName', employee.full_name,
      'orgUnitName', org.name, 'officialDate', employee.official_date,
      'balance', app_private.hrm_leave_balance_json(balance)
    ) order by (balance.id is null) desc, org.name nulls first, employee.full_name)
    from public.employees employee
    left join public.org_units org on org.id = employee.org_unit_id
    left join public.hrm_leave_balances balance on balance."employeeId" = employee.id and balance.year = p_year
    where employee.status = 'Đang làm việc'
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_hrm_leave_balances(integer) from public, anon;
grant execute on function public.list_hrm_leave_balances(integer) to authenticated;

-- HR sets the real remaining days (decision 4); the difference goes on the ledger with the reason.
create or replace function public.adjust_hrm_leave_balance(p_employee_id uuid, p_year integer, p_remaining numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_balance public.hrm_leave_balances%rowtype;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'Chỉ HR được điều chỉnh số phép.';
  end if;
  if app_private.hrm_employee_is_current_user(p_employee_id::text) then
    raise exception using errcode = '42501', message = 'Không tự điều chỉnh số phép của chính mình. Nhờ HR khác.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception using errcode = '22023', message = 'Ghi lý do điều chỉnh (ít nhất 5 ký tự).';
  end if;
  if p_remaining is null or p_remaining < -30 or p_remaining > 60 or p_remaining * 2 <> round(p_remaining * 2) then
    raise exception using errcode = '22023', message = 'Số ngày còn lại từ −30 đến 60, bước 0,5 ngày.';
  end if;

  perform app_private.hrm_leave_ledger_label('adjust', null, null, trim(p_reason));
  select * into v_balance from public.hrm_leave_balances where "employeeId" = p_employee_id and year = p_year for update;
  if v_balance.id is null then
    perform app_private.hrm_leave_ledger_label('opening', null, null, trim(p_reason));
    insert into public.hrm_leave_balances ("employeeId", year, "accruedDays", "lastAccrualMonth")
    values (p_employee_id, p_year, p_remaining,
            case when p_year = extract(year from v_today)::integer then extract(month from v_today)::integer
                 when p_year < extract(year from v_today)::integer then 12 else 0 end)
    returning * into v_balance;
  else
    update public.hrm_leave_balances
    set "accruedDays" = "accruedDays" + (p_remaining - app_private.hrm_leave_available(v_balance))
    where id = v_balance.id
    returning * into v_balance;
  end if;
  perform app_private.hrm_leave_ledger_label(null);
  return app_private.hrm_leave_balance_json(v_balance);
end;
$function$;
revoke all on function public.adjust_hrm_leave_balance(uuid, integer, numeric, text) from public, anon;
grant execute on function public.adjust_hrm_leave_balance(uuid, integer, numeric, text) to authenticated;

-- ── Approval, cancellation and preview label their balance changes ─────────

create or replace function public.decide_leave_request(p_request_id uuid, p_decision text, p_comment text default null)
returns public.hrm_leave_requests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_is_hr boolean := app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive');
  v_row public.hrm_leave_requests;
  v_step jsonb;
  v_index integer;
  v_is_assigned boolean;
  v_next jsonb;
  v_type public.hrm_leave_types%rowtype;
  v_employee public.employees%rowtype;
  v_year integer;
  v_day date;
  v_recipients uuid[];
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if p_decision not in ('approve', 'reject') then raise exception using errcode = '22023', message = 'Quyết định không hợp lệ.'; end if;

  select * into v_row from public.hrm_leave_requests where id = p_request_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy đơn.'; end if;
  if v_row.status <> 'pending' then raise exception using errcode = '23514', message = 'Đơn này đã được xử lý.'; end if;
  select * into v_employee from public.employees where id = v_row."employeeId";
  if v_employee.user_id = v_user then raise exception using errcode = '42501', message = 'Không tự duyệt đơn của chính mình.'; end if;

  v_index := coalesce(v_row.current_step, 1) - 1;
  v_step := v_row.approvers -> v_index;
  if v_step is null then raise exception using errcode = '23514', message = 'Đơn không có bước duyệt hợp lệ.'; end if;
  v_is_assigned := (v_step ->> 'userId') = v_user::text or (v_step ->> 'kind' = 'hr' and v_is_hr);
  if not v_is_assigned and not v_is_hr then
    raise exception using errcode = '42501', message = 'Bạn không phải người duyệt bước này.';
  end if;
  -- HR acting for someone else's step must say why; rejecting always needs a reason.
  if (not v_is_assigned or p_decision = 'reject') and length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 3 ký tự).';
  end if;

  v_step := v_step || jsonb_build_object(
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'decidedBy', v_user, 'decidedAt', now(), 'comment', nullif(trim(coalesce(p_comment, '')), ''),
    'onBehalf', not v_is_assigned);
  v_row.approvers := jsonb_set(v_row.approvers, array[v_index::text], v_step);

  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment)
  values (v_row.id, case when p_decision = 'approve' then 'approve' else 'reject' end, v_user,
    concat_ws(' · ', 'Bước ' || (v_index + 1), case when not v_is_assigned then 'HR duyệt thay' end, nullif(trim(coalesce(p_comment, '')), '')));

  if p_decision = 'reject' then
    update public.hrm_leave_requests
    set approvers = v_row.approvers, status = 'rejected', "rejectionReason" = trim(p_comment),
        "approvedBy" = v_user::text, "approvedAt" = now()::text
    where id = v_row.id returning * into v_row;
    perform app_private.notify_hrm_leave(v_row.id, array[v_employee.user_id], 'Đơn bị từ chối', trim(p_comment));
    return v_row;
  end if;

  v_next := v_row.approvers -> (v_index + 1);
  if v_next is not null then
    update public.hrm_leave_requests set approvers = v_row.approvers, current_step = v_index + 2
    where id = v_row.id returning * into v_row;
    v_recipients := case when v_next ->> 'kind' = 'hr' then app_private.hrm_leave_hr_user_ids()
                         else array[(v_next ->> 'userId')::uuid] end;
    perform app_private.notify_hrm_leave(v_row.id, v_recipients, 'Đơn chờ bạn duyệt',
      format('%s · %s ngày từ %s (đã qua bước %s)', v_employee.full_name, v_row."totalDays", v_row."startDate", v_index + 1));
    return v_row;
  end if;

  -- Final approval: balance and timesheet follow.
  update public.hrm_leave_requests
  set approvers = v_row.approvers, status = 'approved', "approvedBy" = v_user::text, "approvedAt" = now()::text
  where id = v_row.id returning * into v_row;

  select * into v_type from public.hrm_leave_types where code = v_row.type;
  v_year := left(v_row."startDate", 4)::integer;
  if v_type.deducts_annual then
    perform app_private.hrm_leave_ledger_label('leave', v_row.id, v_row."startDate"::date, 'Nghỉ phép năm ' || coalesce(v_row.code, ''));
    update public.hrm_leave_balances set "usedPaidDays" = "usedPaidDays" + v_row."totalDays"
    where "employeeId" = v_row."employeeId" and year = v_year;
    perform app_private.hrm_leave_ledger_label(null);
  elsif v_type.paid_by = 'none' and v_type.unit = 'day' then
    update public.hrm_leave_balances set "usedUnpaidDays" = "usedUnpaidDays" + v_row."totalDays"
    where "employeeId" = v_row."employeeId" and year = v_year;
  end if;

  -- Full leave days appear on the timesheet; days with punches or half days keep their punches.
  if v_type.unit = 'day' and v_row.type <> 'business_trip' then
    for v_day in select generate_series(v_row."startDate"::date, v_row."endDate"::date, interval '1 day')::date loop
      continue when app_private.hrm_leave_working_days(v_day, v_day,
        case when v_day = v_row."startDate"::date then v_row.start_session else 'full' end,
        case when v_day = v_row."endDate"::date then v_row.end_session else 'full' end) <> 1;
      insert into public.hrm_attendance (id, "employeeId", date, status, note, "approvalStatus", "createdAt")
      values (gen_random_uuid(), v_row."employeeId", v_day::text, 'leave', 'leave:' || v_row.id, 'approved', now())
      on conflict ("employeeId", date) do update
        set status = 'leave', note = left(concat_ws(E'\n', nullif(public.hrm_attendance.note, ''), 'leave:' || v_row.id), 1000)
        where public.hrm_attendance."checkIn" is null;
    end loop;
  end if;

  perform app_private.notify_hrm_leave(v_row.id, array[v_employee.user_id], 'Đơn đã được duyệt',
    format('%s · %s', (select name from public.hrm_leave_types where code = v_row.type),
      case when v_row.minutes is not null then v_row.minutes || ' phút' else v_row."totalDays" || ' ngày' end));
  return v_row;
end;
$function$;
revoke all on function public.decide_leave_request(uuid, text, text) from public, anon;
grant execute on function public.decide_leave_request(uuid, text, text) to authenticated;

create or replace function public.cancel_leave_request(p_request_id uuid, p_reason text)
returns public.hrm_leave_requests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_is_hr boolean := app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive');
  v_row public.hrm_leave_requests;
  v_owner uuid;
  v_type public.hrm_leave_types%rowtype;
  v_year integer;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception using errcode = '22023', message = 'Nhập lý do hủy (ít nhất 3 ký tự).'; end if;
  select * into v_row from public.hrm_leave_requests where id = p_request_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy đơn.'; end if;
  select user_id into v_owner from public.employees where id = v_row."employeeId";

  -- The requester withdraws a pending request; an approved one is cancelled by HR (it changes balance and timesheet).
  if v_row.status = 'pending' then
    if v_owner <> v_user and not v_is_hr then raise exception using errcode = '42501', message = 'Chỉ người tạo đơn hoặc HR được hủy.'; end if;
  elsif v_row.status = 'approved' then
    if not v_is_hr then raise exception using errcode = '42501', message = 'Đơn đã duyệt chỉ HR được hủy. Liên hệ phòng HCNS.'; end if;
    select * into v_type from public.hrm_leave_types where code = v_row.type;
    v_year := left(v_row."startDate", 4)::integer;
    if v_type.deducts_annual then
      perform app_private.hrm_leave_ledger_label('leave_cancel', v_row.id, null, 'Hủy đơn ' || coalesce(v_row.code, '') || ': ' || trim(p_reason));
      update public.hrm_leave_balances set "usedPaidDays" = greatest(0, "usedPaidDays" - v_row."totalDays")
      where "employeeId" = v_row."employeeId" and year = v_year;
      perform app_private.hrm_leave_ledger_label(null);
    elsif v_type.paid_by = 'none' and v_type.unit = 'day' then
      update public.hrm_leave_balances set "usedUnpaidDays" = greatest(0, "usedUnpaidDays" - v_row."totalDays")
      where "employeeId" = v_row."employeeId" and year = v_year;
    end if;
    delete from public.hrm_attendance
    where "employeeId" = v_row."employeeId" and status = 'leave' and "checkIn" is null and note = 'leave:' || v_row.id;
  else
    raise exception using errcode = '23514', message = 'Đơn này đã kết thúc.';
  end if;

  update public.hrm_leave_requests
  set status = 'cancelled', cancelled_by = v_user, cancelled_at = now(), cancel_reason = trim(p_reason)
  where id = v_row.id returning * into v_row;
  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment)
  values (v_row.id, 'cancel', v_user, trim(p_reason));
  if v_owner <> v_user then
    perform app_private.notify_hrm_leave(v_row.id, array[v_owner], 'Đơn đã bị hủy', trim(p_reason));
  end if;
  return v_row;
end;
$function$;
revoke all on function public.cancel_leave_request(uuid, text) from public, anon;
grant execute on function public.cancel_leave_request(uuid, text) to authenticated;

create or replace function public.preview_my_leave_request(
  p_type text, p_start date, p_end date, p_start_session text default 'full', p_end_session text default 'full', p_minutes integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_type public.hrm_leave_types%rowtype;
  v_settings public.hrm_leave_settings%rowtype;
  v_days numeric := 0;
  v_steps jsonb;
  v_remaining numeric;
  v_problems jsonb := '[]'::jsonb;
  v_unclaimed integer;
  v_month_claimed integer;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  select * into v_employee from public.employees
  where user_id = v_user and status = 'Đang làm việc' order by updated_at desc nulls last limit 1;
  if v_employee.id is null then raise exception using errcode = '42501', message = 'Tài khoản chưa liên kết hồ sơ nhân sự.'; end if;
  select * into v_type from public.hrm_leave_types where code = p_type and is_active;
  if v_type.code is null then raise exception using errcode = '22023', message = 'Loại đơn không hợp lệ.'; end if;
  select * into v_settings from public.hrm_leave_settings where singleton;

  if p_start is null or (v_type.unit = 'day' and (p_end is null or p_end < p_start)) then
    v_problems := v_problems || jsonb_build_array('Chọn ngày bắt đầu và ngày kết thúc hợp lệ.');
  end if;

  if v_type.code = 'overtime' and p_start is not null then
    v_unclaimed := app_private.hrm_overtime_unclaimed_minutes(v_employee.id, p_start);
    v_month_claimed := app_private.hrm_overtime_claimed_minutes(v_employee.id, p_start);
    if p_minutes is null or p_minutes < 1 then
      v_problems := v_problems || jsonb_build_array('Nhập số phút làm thêm cần xác nhận.');
    elsif p_minutes > v_unclaimed then
      v_problems := v_problems || jsonb_build_array(format('Tháng %s chỉ còn %s phút dư chưa xác nhận.', to_char(p_start, 'MM/YYYY'), v_unclaimed));
    elsif v_month_claimed + p_minutes > 2400 then
      v_problems := v_problems || jsonb_build_array('Vượt trần làm thêm 40 giờ/tháng (Bộ luật Lao động, Nghị định 145/2020).');
    end if;
  elsif v_type.unit = 'minute' then
    if p_minutes is null or p_minutes < 1 or p_minutes > v_settings.late_early_max_minutes then
      v_problems := v_problems || jsonb_build_array(format('Số phút từ 1 đến %s.', v_settings.late_early_max_minutes));
    end if;
  else
    v_days := app_private.hrm_leave_working_days(p_start, p_end, coalesce(p_start_session, 'full'), coalesce(p_end_session, 'full'));
    if p_start is not null and p_end is not null and v_days = 0 then
      v_problems := v_problems || jsonb_build_array('Khoảng ngày này không có ngày làm việc nào.');
    end if;
  end if;

  if v_type.requires_official and v_employee.official_date is not null and v_employee.official_date > coalesce(p_start, current_date) then
    v_problems := v_problems || jsonb_build_array('Nhân sự đang thử việc chưa có phép năm. Chọn "Nghỉ không lương" hoặc loại phù hợp.');
  end if;

  if v_type.deducts_annual and p_start is not null then
    -- Carried days only cover leave starting on or before 31/03 (G2b).
    v_remaining := app_private.hrm_leave_annual_available(v_employee.id, p_start);
    if v_days > v_remaining then
      v_problems := v_problems || jsonb_build_array(format('Không đủ phép năm: còn %s ngày, đơn này cần %s ngày.', v_remaining, v_days));
    end if;
  end if;

  v_steps := app_private.hrm_leave_approval_chain(v_employee.id, p_type, v_days);
  select coalesce(jsonb_agg(step || jsonb_build_object('name', coalesce(u.name, 'Phòng Hành chính - Nhân sự')) order by (step ->> 'order')::int), '[]'::jsonb)
  into v_steps
  from jsonb_array_elements(v_steps) step
  left join public.users u on u.id::text = step ->> 'userId';

  return jsonb_build_object(
    'days', v_days,
    'minutes', p_minutes,
    'annualRemaining', v_remaining,
    'steps', v_steps,
    'problems', v_problems,
    'paidBy', v_type.paid_by,
    'unclaimedMinutes', v_unclaimed
  );
end;
$function$;
