-- Trợ lý · biến động nhân sự: người có quyền Xem tổ chức thấy số theo tháng; nhân viên không quyền bị chặn 42501;
-- người chưa có ngày vào / đã nghỉ chưa có ngày nghỉ không xếp vào tháng, trả số riêng.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261020130000_hrm_headcount_trend.sql --smoke supabase/tests/hrm_headcount_trend_smoke.sql
begin;
create temp table hc(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on hc to authenticated;
insert into hc select 'staff', gen_random_uuid(), 'hc-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'HC staff', 'hc-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from hc;
insert into hc select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

-- Ba người thử: vào 10/03/2026; vào 05/01/2026 nghỉ 20/04/2026; đã nghỉ chưa có ngày nghỉ.
create temp table ids(name text primary key, id uuid) on commit drop;
grant select on ids to authenticated;
insert into ids values ('hire_mar', gen_random_uuid()), ('left_apr', gen_random_uuid()), ('left_unknown', gen_random_uuid());
insert into public.employees(id, full_name, start_date, status)
  select id, 'HC ' || name, case name when 'hire_mar' then date '2026-03-10' when 'left_apr' then date '2026-01-05' end,
    case name when 'hire_mar' then 'Đang làm việc' else 'Đã nghỉ việc' end from ids;
insert into public.hrm_employee_employment_events(employee_id, record_code, event_type_code, event_date, status)
  select id, 'HC-EXIT', 'NGHI_VIEC', date '2026-04-20', 'ACTIVE' from ids where name = 'left_apr';

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from hc where name = 'staff';
do $$ begin perform public.get_hrm_headcount_trend_v1(date '2026-01-01', date '2026-06-30'); raise exception 'FAIL nhân viên xem biến động'; exception when insufficient_privilege then null; end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from hc where name = 'admin';
do $$
declare
  a jsonb := public.get_hrm_headcount_trend_v1(date '2026-01-15', date '2026-06-30');
  m jsonb;
begin
  if a->>'from' <> '2026-01-01' or a->>'to' <> '2026-06-30' or jsonb_array_length(a->'months') <> 6 then raise exception 'FAIL khoảng tháng %', left(a::text, 300); end if;
  m := a->'months'->2; -- 2026-03
  if m->>'month' <> '2026-03' or (m->>'hired')::int < 1 then raise exception 'FAIL vào tháng 3 %', m; end if;
  m := a->'months'->3; -- 2026-04
  if (m->>'left')::int < 1 then raise exception 'FAIL nghỉ tháng 4 %', m; end if;
  if ((a->'months'->3->>'headcount')::int - (a->'months'->2->>'headcount')::int) <> (m->>'hired')::int - (m->>'left')::int then
    raise exception 'FAIL cuối tháng 4 = cuối tháng 3 + vào − nghỉ %', a->'months';
  end if;
  if (a->>'resignedNoExitDate')::int < 1 then raise exception 'FAIL đã nghỉ chưa có ngày nghỉ %', a; end if;
  begin perform public.get_hrm_headcount_trend_v1(date '2024-01-01', date '2026-06-30'); raise exception 'FAIL quá 24 tháng';
  exception when invalid_parameter_value then null; end;
  begin perform public.get_hrm_headcount_trend_v1(date '2026-06-01', date '2026-01-01'); raise exception 'FAIL từ sau đến';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
