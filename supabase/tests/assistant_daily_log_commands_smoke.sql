-- Trợ lý T2d: lệnh nháp 'daily_log' ghi được (báo cáo dài tới 20.000 ký tự, quá thì chặn); danh sách dự án ghi nhật ký chỉ gồm
-- dự án có quyền Room daily_log · edit (nhân viên chưa cấp → rỗng). Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261019130000_assistant_daily_log_commands.sql --smoke supabase/tests/assistant_daily_log_commands_smoke.sql
begin;
create temp table dl_people(name text primary key, user_id uuid, email text) on commit drop;
grant select on dl_people to authenticated;
insert into dl_people select n, gen_random_uuid(), 'dl-' || gen_random_uuid() || '@invalid.local' from unnest(array['writer']) n;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'DL ' || name, 'dl-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from dl_people;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from dl_people where name = 'writer';
do $$
declare run uuid; c jsonb;
begin
  run := (public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb)->>'runId')::uuid;
  c := public.assistant_command_create_v1(run, 'daily_log', 'Nhật ký từ báo cáo Zalo · DA29',
    jsonb_build_object('projectId', 'p-1', 'reportDate', '2026-10-18', 'text', repeat('Tổ Mr Ích 20 người cofa cổ cột. ', 450)), '{}'::jsonb);
  if c->>'kind' <> 'daily_log' or length(c->'payload'->>'text') < 12000 then raise exception 'FAIL lệnh nhật ký dài %', length(c->'payload'->>'text'); end if;
  begin
    perform public.assistant_command_create_v1(run, 'daily_log', 'Quá dài', jsonb_build_object('text', repeat('x', 21000)), '{}'::jsonb);
    raise exception 'FAIL nhận nháp quá 20.000 ký tự';
  exception when invalid_parameter_value then null;
  end;
  if jsonb_array_length(public.assistant_daily_log_projects_v1()) <> 0 then raise exception 'FAIL nhân viên chưa cấp quyền thấy dự án ghi nhật ký'; end if;
end $$;
rollback;
