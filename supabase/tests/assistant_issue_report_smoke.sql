-- B2 phiếu sự cố: thẻ issue_report hợp lệ trong assistant_commands; ai_decisions nhận kind issue_class qua ai_decision_log_v1;
-- kind lạ vẫn bị chặn (22023). Chạy trong giao dịch rollback.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261026100000_assistant_issue_report.sql --smoke supabase/tests/assistant_issue_report_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on lp to authenticated;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

do $$
declare c text;
begin
  select pg_get_constraintdef(oid) into c from pg_constraint where conname = 'assistant_commands_kind_check';
  if c not like '%issue_report%' then raise exception 'FAIL 0 assistant_commands chưa nhận issue_report: %', c; end if;
  select pg_get_constraintdef(oid) into c from pg_constraint where conname = 'ai_decisions_kind_check';
  if c not like '%issue_class%' then raise exception 'FAIL 0 ai_decisions chưa nhận issue_class: %', c; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare v_run uuid; v jsonb; v_cmd jsonb;
begin
  v := public.ai_gateway_begin_v1('assistant_chat', '{"screen":"smoke"}'::jsonb);
  if v->>'code' <> 'OK' then raise exception 'FAIL 1 không mở được lượt: %', v; end if;
  v_run := (v->>'runId')::uuid;
  v_cmd := public.assistant_command_create_v1(v_run, 'issue_report', 'Sự cố: smoke', '{"title":"Smoke","description":"Thử thẻ sự cố","type":"bug","priority":"high"}'::jsonb, '{}'::jsonb);
  if v_cmd->>'kind' <> 'issue_report' or v_cmd->>'status' <> 'prepared' then raise exception 'FAIL 2 thẻ issue_report: %', v_cmd; end if;
  v := public.ai_decision_log_v1(v_run, '{"kind":"issue_class","status":"ok","model":"jev-1.14.0","durationMs":150,"predicted":{"type":"bug","typeConfidence":0.9},"actual":{"type":"bug","priority":"high"},"agree":true}'::jsonb);
  if coalesce((v->>'ok')::boolean, false) is not true or v->>'id' is null then raise exception 'FAIL 3 không ghi được issue_class: %', v; end if;
  v := public.ai_decision_log_v1(v_run, '{"kind":"intent_route","status":"ok","model":"jev-1.14.0","predicted":{"intent":"khac"},"actual":{"intent":null}}'::jsonb);
  if coalesce((v->>'ok')::boolean, false) is not true then raise exception 'FAIL 4 intent_route vẫn phải ghi được: %', v; end if;
  begin perform public.ai_decision_log_v1(v_run, '{"kind":"khac"}'::jsonb); raise exception 'FAIL 5 kind lạ vẫn ghi được';
  exception when invalid_parameter_value then null; end;
  begin perform public.assistant_command_create_v1(v_run, 'bao_loi', 'x', '{}'::jsonb, '{}'::jsonb); raise exception 'FAIL 6 kind thẻ lạ vẫn tạo được';
  exception when check_violation then null; end;
  raise notice 'SMOKE OK run=%', v_run;
end $$;
rollback;
