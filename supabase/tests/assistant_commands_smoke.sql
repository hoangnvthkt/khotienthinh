-- Trợ lý T2a: lệnh nháp chỉ ghi trong lượt AI của chính người đó (đang chạy), tối đa 3 lệnh / lượt; chỉ chủ lệnh kết thúc; xong / bỏ thì khóa;
-- hội thoại mở lại kèm lệnh của câu trả lời; loại nghỉ phép đọc được. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261018230000_assistant_commands.sql --smoke supabase/tests/assistant_commands_smoke.sql
begin;
create temp table cm_people(name text primary key, user_id uuid, email text) on commit drop;
create temp table cm_data(key text primary key, value text) on commit drop;
grant select on cm_people to authenticated;
grant select, insert on cm_data to authenticated;
insert into cm_people select n, gen_random_uuid(), 'cm-' || gen_random_uuid() || '@invalid.local' from unnest(array['owner', 'other']) n;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'CM ' || name, 'cm-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from cm_people;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from cm_people where name = 'owner';
do $$
declare run uuid; c jsonb; s jsonb; g jsonb; i int;
begin
  run := (public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb)->>'runId')::uuid;
  c := public.assistant_command_create_v1(run, 'leave_request', 'Đơn nghỉ phép năm 21/10',
    '{"type":"annual","start":"2026-10-21","end":"2026-10-21","reason":"Việc gia đình"}'::jsonb, '{"days":1,"problems":[]}'::jsonb);
  if c->>'status' <> 'prepared' or c->>'kind' <> 'leave_request' then raise exception 'FAIL tạo lệnh %', c; end if;
  perform public.assistant_command_create_v1(run, 'leave_request', 'Lệnh 2', '{}'::jsonb, '{}'::jsonb);
  perform public.assistant_command_create_v1(run, 'leave_request', 'Lệnh 3', '{}'::jsonb, '{}'::jsonb);
  begin
    perform public.assistant_command_create_v1(run, 'leave_request', 'Lệnh 4', '{}'::jsonb, '{}'::jsonb);
    raise exception 'FAIL quá 3 lệnh một lượt';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.assistant_command_create_v1(run, 'xoa_du_lieu', 'Bịa', '{}'::jsonb, '{}'::jsonb);
    raise exception 'FAIL nhận loại lệnh lạ';
  exception when check_violation or invalid_parameter_value then null;
  end;
  -- Ghi lượt hỏi–đáp (lượt AI xong) rồi mở lại hội thoại: câu trả lời kèm lệnh.
  s := public.ai_thread_save_turn_v1(null, jsonb_build_object('question', 'Xin nghỉ thứ 4', 'answer', 'Em đã chuẩn bị đơn, anh bấm Gửi đơn.', 'runId', run));
  perform public.ai_gateway_finish_v1(run, '{"status":"ok"}'::jsonb);
  begin
    perform public.assistant_command_create_v1(run, 'leave_request', 'Sau khi xong', '{}'::jsonb, '{}'::jsonb);
    raise exception 'FAIL ghi lệnh khi lượt AI đã xong';
  exception when insufficient_privilege then null;
  end;
  c := public.assistant_command_finish_v1((c->>'id')::uuid, 'done', '{"code":"NP-2026-0099","id":"lr-1"}'::jsonb);
  if c->>'status' <> 'done' or c->'result'->>'code' <> 'NP-2026-0099' or c->>'confirmedAt' is null then raise exception 'FAIL biên nhận %', c; end if;
  begin
    perform public.assistant_command_finish_v1((c->>'id')::uuid, 'cancelled');
    raise exception 'FAIL đổi lệnh đã xong';
  exception when invalid_parameter_value then null;
  end;
  g := public.get_ai_thread_v1((s->>'threadId')::uuid);
  if jsonb_array_length(g->'messages'->1->'commands') <> 3 or g->'messages'->1->'commands'->0->>'status' <> 'done' then raise exception 'FAIL hội thoại thiếu lệnh %', g->'messages'->1; end if;
  if jsonb_typeof(public.assistant_leave_types_v1()) <> 'array' then raise exception 'FAIL loại nghỉ phép'; end if;
  insert into cm_data values ('cmd2', g->'messages'->1->'commands'->1->>'id'), ('run', run::text);
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from cm_people where name = 'other';
do $$
begin
  begin
    perform public.assistant_command_finish_v1((select value::uuid from cm_data where key = 'cmd2'), 'cancelled');
    raise exception 'FAIL người khác kết thúc được lệnh';
  exception when no_data_found then null;
  end;
  begin
    perform public.assistant_command_create_v1((select value::uuid from cm_data where key = 'run'), 'leave_request', 'x', '{}'::jsonb, '{}'::jsonb);
    raise exception 'FAIL người khác ghi lệnh vào lượt AI của chủ';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.assistant_commands limit 1;
    raise exception 'FAIL đọc thẳng bảng lệnh';
  exception when insufficient_privilege then null;
  end;
  raise notice 'assistant_commands_smoke OK';
end $$;
rollback;
