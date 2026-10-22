-- Báo cáo A2: 7 RPC — Admin thấy số (tiến độ SMB, tài chính kèm công nợ, chấm công, phép, yêu cầu, đặt xe, văn bản); nhân viên mới
-- thấy 0 / rỗng (RLS) và bị chặn tài chính (42501); tham số sai → 22023; không đăng nhập → 42501.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261027090000_assistant_reports_a2.sql --smoke supabase/tests/assistant_reports_a2_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on lp to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

do $$ begin
  begin perform public.assistant_report_requests_v1(current_date - 90, current_date, 'month'); raise exception 'FAIL 0 không đăng nhập vẫn gọi được'; exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare v jsonb; v_smb text;
begin
  select id into v_smb from public.projects where code = 'SMB-2026' limit 1;
  v := public.assistant_report_progress_v1(current_date - 60, current_date, 'week', v_smb);
  if v is null or jsonb_array_length(v->'buckets') < 6 or (v->'now'->>'tasks')::int <= 0 then raise exception 'FAIL 1 tiến độ SMB: %', left(v::text, 400); end if;
  if (v->'now'->>'progress') is null then raise exception 'FAIL 1b tiến độ hiện tại null: %', v->'now'; end if;
  begin perform public.assistant_report_progress_v1(current_date - 60, current_date, 'week', null); raise exception 'FAIL 1c thiếu dự án vẫn chạy'; exception when invalid_parameter_value then null; end;
  if public.assistant_report_progress_v1(current_date - 60, current_date, 'week', 'khong-ton-tai') is not null then raise exception 'FAIL 1d dự án lạ phải null'; end if;
  v := public.assistant_report_finance_v1(current_date - 120, current_date, 'month', null);
  if (v->>'canManage')::boolean is not true or jsonb_array_length(v->'buckets') < 3 or (v->>'totalOut')::numeric <= 0 then raise exception 'FAIL 2 tài chính: %', left(v::text, 400); end if;
  if v->'payable' is null or (v->'payable'->>'outstanding') is null then raise exception 'FAIL 2b công nợ: %', v->'payable'; end if;
  v := public.assistant_report_attendance_v1(current_date - 30, current_date, 'week');
  if (v->>'records')::int <= 0 or (v->>'people')::int <= 0 or jsonb_array_length(v->'bySite') = 0 then raise exception 'FAIL 3 chấm công: %', left(v::text, 400); end if;
  v := public.assistant_report_leave_v1(current_date - 120, current_date, 'month');
  if (v->>'total')::int <= 0 or jsonb_array_length(v->'byType') = 0 then raise exception 'FAIL 4 phép: %', left(v::text, 400); end if;
  v := public.assistant_report_requests_v1(current_date - 120, current_date, 'month');
  if (v->>'total')::int <= 0 or jsonb_array_length(v->'byProject') = 0 then raise exception 'FAIL 5 yêu cầu: %', left(v::text, 400); end if;
  v := public.assistant_report_vehicle_v1(current_date - 400, current_date, 'month');
  if v->'buckets' is null or v->'byTrip' is null then raise exception 'FAIL 6 đặt xe: %', left(v::text, 400); end if;
  v := public.assistant_report_office_v1(current_date - 400, current_date, 'month');
  if (v->>'total')::int <= 0 or jsonb_array_length(v->'byType') = 0 then raise exception 'FAIL 7 văn bản: %', left(v::text, 400); end if;
  begin perform public.assistant_report_office_v1(current_date, current_date - 1, 'month'); raise exception 'FAIL 8 khoảng ngược vẫn chạy'; exception when invalid_parameter_value then null; end;
  raise notice 'ADMIN OK';
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare v jsonb; v_smb text;
begin
  select id into v_smb from public.projects where code = 'SMB-2026' limit 1;
  begin perform public.assistant_report_finance_v1(current_date - 60, current_date, 'month', null); raise exception 'FAIL 9 nhân viên mới xem được tài chính'; exception when insufficient_privilege then null; end;
  v := public.assistant_report_attendance_v1(current_date - 30, current_date, 'week');
  if (v->>'records')::int <> 0 then raise exception 'FAIL 10 nhân viên mới thấy chấm công người khác: %', v->>'records'; end if;
  v := public.assistant_report_leave_v1(current_date - 120, current_date, 'month');
  if (v->>'total')::int <> 0 then raise exception 'FAIL 11 nhân viên mới thấy phép người khác: %', v->>'total'; end if;
  v := public.assistant_report_requests_v1(current_date - 120, current_date, 'month');
  if (v->>'total')::int <> 0 then raise exception 'FAIL 12 nhân viên mới thấy yêu cầu: %', v->>'total'; end if;
  v := public.assistant_report_vehicle_v1(current_date - 400, current_date, 'month');
  if (v->>'total')::int <> 0 then raise exception 'FAIL 13 nhân viên mới thấy đặt xe: %', v->>'total'; end if;
  raise notice 'STAFF OK';
end $$;
rollback;
