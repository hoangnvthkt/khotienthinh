-- Trợ lý v2 T0: hội thoại chỉ chủ xem; ghi lượt hỏi–đáp đúng thứ tự; người khác không đọc / ghi được; quá 90 ngày tự xóa;
-- skill assistant_chat + kết nối ai.assistant. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261018150000_ai_assistant_threads.sql --smoke supabase/tests/ai_assistant_threads_smoke.sql
begin;
create temp table t0_people(name text primary key, user_id uuid, email text) on commit drop;
create temp table t0_data(key text primary key, value text) on commit drop;
grant select on t0_people to authenticated;
grant select, insert, update on t0_data to authenticated;
insert into t0_people select n, gen_random_uuid(), 't0-' || gen_random_uuid() || '@invalid.local' from unnest(array['owner', 'other']) n;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'T0 ' || name, 't0-' || user_id, email, 'EMPLOYEE', true, 'ACTIVE' from t0_people;

do $$
begin
  if not exists (select 1 from public.ai_skills where code = 'assistant_chat' and tier = 'base' and mode = 'read' and enabled and model_class = 'reasoning') then
    raise exception 'FAIL thiếu skill assistant_chat';
  end if;
  if not exists (select 1 from public.integration_assignments where feature = 'ai.assistant') then raise exception 'FAIL thiếu kết nối ai.assistant'; end if;
  if (select a.connection_id is distinct from d.connection_id from public.integration_assignments a, public.integration_assignments d
      where a.feature = 'ai.assistant' and d.feature = 'wms.doc_reader') then
    raise exception 'FAIL ai.assistant phải lấy kết nối đọc ảnh lần đầu';
  end if;
end $$;

-- Chủ hội thoại: mở lượt AI thật (để runId hợp lệ), ghi 2 lượt hỏi–đáp.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from t0_people where name = 'owner';
do $$
declare r jsonb; s jsonb; th uuid; run uuid; g jsonb;
begin
  r := public.ai_gateway_begin_v1('assistant_chat', '{"tab":"assistant"}'::jsonb);
  if r->>'code' <> 'OK' then raise exception 'FAIL begin %', r; end if;
  run := (r->>'runId')::uuid;
  s := public.ai_thread_save_turn_v1(null, jsonb_build_object('question', 'Hôm nay   việc gì gấp?', 'answer', 'PO-116 quá hạn 2 ngày [[item.po.po-116]].',
    'sources', jsonb_build_array('item.po.po-116'), 'runId', run, 'projectId', 'smb'));
  th := (s->>'threadId')::uuid;
  perform public.ai_thread_save_turn_v1(th, jsonb_build_object('question', 'Còn gì nữa?', 'answer', 'MR-2688 cần duyệt trước 13h.'));
  g := public.get_ai_thread_v1(th);
  if g->>'title' <> 'Hôm nay việc gì gấp?' then raise exception 'FAIL tiêu đề %', g->>'title'; end if;
  if jsonb_array_length(g->'messages') <> 4 or (g->>'messageCount')::int <> 4 then raise exception 'FAIL số tin %', g; end if;
  if g->'messages'->0->>'role' <> 'user' or g->'messages'->1->>'role' <> 'assistant' or g->'messages'->3->>'content' <> 'MR-2688 cần duyệt trước 13h.' then
    raise exception 'FAIL thứ tự tin %', g->'messages';
  end if;
  if g->'messages'->1->>'runId' <> run::text or g->'messages'->1->'sources'->>0 <> 'item.po.po-116' then raise exception 'FAIL nguồn / runId'; end if;
  if jsonb_array_length(public.list_ai_threads_v1()) <> 1 then raise exception 'FAIL danh sách hội thoại'; end if;
  insert into t0_data values ('thread', th::text), ('run', run::text);
  -- Bảng không đọc thẳng được (chỉ qua RPC).
  begin
    perform 1 from public.assistant_messages limit 1;
    raise exception 'FAIL đọc thẳng assistant_messages';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Người khác: không đọc, không ghi tiếp vào hội thoại, không gắn runId của người khác.
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from t0_people where name = 'other';
do $$
declare th uuid := (select value::uuid from t0_data where key = 'thread'); run uuid := (select value::uuid from t0_data where key = 'run'); s jsonb;
begin
  begin
    perform public.get_ai_thread_v1(th);
    raise exception 'FAIL người khác đọc được hội thoại';
  exception when no_data_found then null;
  end;
  begin
    perform public.ai_thread_save_turn_v1(th, '{"question":"x","answer":"y"}'::jsonb);
    raise exception 'FAIL người khác ghi được hội thoại';
  exception when no_data_found then null;
  end;
  if jsonb_array_length(public.list_ai_threads_v1()) <> 0 then raise exception 'FAIL người khác thấy danh sách'; end if;
  s := public.ai_thread_save_turn_v1(null, jsonb_build_object('question', 'Hỏi', 'answer', 'Đáp', 'runId', run));
  if (public.get_ai_thread_v1((s->>'threadId')::uuid)->'messages'->1->>'runId') is not null then raise exception 'FAIL gắn runId của người khác'; end if;
end $$;

-- Quá 90 ngày kể từ tin cuối: mở danh sách là xóa.
reset role;
update public.assistant_threads set last_message_at = now() - interval '91 days' where id = (select value::uuid from t0_data where key = 'thread');
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from t0_people where name = 'owner';
do $$
begin
  if jsonb_array_length(public.list_ai_threads_v1()) <> 0 then raise exception 'FAIL chưa xóa hội thoại quá 90 ngày'; end if;
  raise notice 'ai_assistant_threads_smoke OK';
end $$;
rollback;
