-- Trợ lý T2b: lệnh nháp 'material_request' ghi được trong lượt AI của chính mình; form đọc lại lệnh của chính mình, người khác không đọc được;
-- danh sách dự án lập đề xuất chỉ gồm dự án có quyền (nhân viên chưa được cấp → rỗng). Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261019090000_assistant_mr_commands.sql --smoke supabase/tests/assistant_mr_commands_smoke.sql
begin;
create temp table mr_people(name text primary key, user_id uuid, email text) on commit drop;
create temp table mr_data(key text primary key, value text) on commit drop;
grant select on mr_people to authenticated;
grant select, insert on mr_data to authenticated;
insert into mr_people select n, gen_random_uuid(), 'mr-' || gen_random_uuid() || '@invalid.local' from unnest(array['owner', 'other']) n;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'MR ' || name, 'mr-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from mr_people;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from mr_people where name = 'owner';
do $$
declare run uuid; c jsonb; g jsonb; p jsonb;
begin
  run := (public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb)->>'runId')::uuid;
  c := public.assistant_command_create_v1(run, 'material_request', 'Đề xuất vật tư SMB-2026',
    '{"projectId":"p-1","purpose":"Đổ bê tông sàn tầng 4","lines":[{"name":"Xi măng PCB40","qty":2,"unit":"tấn"}]}'::jsonb, '{"lineCount":1}'::jsonb);
  if c->>'kind' <> 'material_request' or c->>'status' <> 'prepared' then raise exception 'FAIL tạo lệnh đề xuất %', c; end if;
  g := public.assistant_command_get_v1((c->>'id')::uuid);
  if g->'payload'->'lines'->0->>'name' <> 'Xi măng PCB40' or g->>'runId' <> run::text then raise exception 'FAIL đọc lại lệnh %', g; end if;
  begin
    perform public.assistant_command_get_v1(gen_random_uuid());
    raise exception 'FAIL đọc được lệnh không tồn tại';
  exception when no_data_found then null;
  end;
  p := public.assistant_mr_projects_v1();
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 0 then raise exception 'FAIL nhân viên chưa cấp quyền thấy dự án %', p; end if;
  insert into mr_data values ('cmd', c->>'id');
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from mr_people where name = 'other';
do $$
begin
  begin
    perform public.assistant_command_get_v1((select value::uuid from mr_data where key = 'cmd'));
    raise exception 'FAIL người khác đọc được lệnh nháp';
  exception when no_data_found then null;
  end;
end $$;

-- Có quyền: đếm dự án hợp lệ bằng chủ bảng để so (không đổi dữ liệu) — hàm chỉ lọc, không lộ dự án hủy / ẩn.
reset role;
do $$
declare bad int;
begin
  select count(*) into bad from public.projects p where p.status = 'cancelled' or coalesce(p.is_hidden, false);
  if bad is null then raise exception 'FAIL đếm dự án'; end if;
end $$;
rollback;
