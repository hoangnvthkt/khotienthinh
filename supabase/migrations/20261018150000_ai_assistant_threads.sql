-- Trợ lý v2 · T0 "khung chat + hội thoại" (chủ SP duyệt 17/10/2026, doc Vioo AI tab "Trợ lý v2 · 17/10").
--
-- 1. Hội thoại của Trợ lý: assistant_threads + assistant_messages. Mỗi người chỉ thấy hội thoại của mình (Quản trị AI chỉ thấy số lượt ở ai_runs,
--    không thấy nội dung — câu 3 mục 9). Giữ 90 ngày kể từ tin cuối; quá hạn tự xóa khi người đó mở danh sách.
--    Chỉ đọc / ghi qua RPC; edge function ai-gateway ghi lượt hỏi–đáp bằng JWT của chính người hỏi.
-- 2. Skill assistant_chat: hỏi tiếp trong một hội thoại, trả lời chạy dần (stream). Bậc nền, chế độ đọc — AI chưa tra cứu ngoài
--    bản tin (T1 mới thêm công cụ), không chuẩn bị lệnh (T2).
-- 3. Kết nối "Trợ lý · hội thoại" (ai.assistant) ở Cài đặt → Kết nối: câu 1 mục 9 chọn claude-sonnet-5-5 cho Trợ lý — lần đầu lấy
--    kết nối đang đọc ảnh chứng từ (RevidAPI claude-sonnet-5-5); Admin đổi được. Chưa gán thì dùng lớp model suy luận như cũ.

create table if not exists public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  project_id text check (project_id is null or char_length(project_id) <= 80),
  message_count integer not null default 0 check (message_count >= 0),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
comment on table public.assistant_threads is 'Trợ lý: hội thoại của từng người (chỉ chủ xem). Giữ 90 ngày kể từ tin cuối. Chỉ qua RPC.';
create index if not exists assistant_threads_user_last_idx on public.assistant_threads (user_id, last_message_at desc);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.assistant_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  -- Khóa dòng số liệu / chứng từ AI dẫn (màn hình đổi thành nút mở). T1 thêm nguồn từ công cụ tra cứu.
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  run_id uuid references public.ai_runs(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.assistant_messages is 'Trợ lý: từng tin trong hội thoại (người hỏi / Trợ lý trả lời). Chỉ chủ hội thoại xem. Chỉ qua RPC.';
create index if not exists assistant_messages_thread_created_idx on public.assistant_messages (thread_id, created_at);

alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;
revoke all on public.assistant_threads, public.assistant_messages from public, anon, authenticated;

insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('assistant_chat', 'Trợ lý · hội thoại',
   'Tab Trợ lý: hỏi đáp nhiều lượt trong một hội thoại, trả lời chạy dần, dẫn về chứng từ / màn gốc. Đợt T0 chỉ dựa trên số liệu bản tin hôm nay.',
   'base', 'read', true, 80, 'reasoning')
on conflict (code) do nothing;

-- Kết nối riêng cho Trợ lý (Cài đặt → Kết nối).
alter table public.integration_assignments drop constraint if exists integration_assignments_feature_check;
alter table public.integration_assignments add constraint integration_assignments_feature_check
  check (feature in ('ai.fast', 'ai.reasoning', 'wms.doc_reader', 'ai.assistant'));
insert into public.integration_assignments (feature, connection_id)
  select 'ai.assistant', (select a.connection_id from public.integration_assignments a where a.feature = 'wms.doc_reader')
on conflict (feature) do nothing;

-- Danh sách hội thoại của tôi (mới nhất trước). Xóa luôn hội thoại của tôi đã quá 90 ngày kể từ tin cuối.
create or replace function public.list_ai_threads_v1(p_limit integer default 30)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id();
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  delete from public.assistant_threads where user_id = a and last_message_at < now() - interval '90 days';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'projectId', t.project_id, 'messageCount', t.message_count,
        'createdAt', t.created_at, 'lastMessageAt', t.last_message_at) order by t.last_message_at desc)
    from (select * from public.assistant_threads where user_id = a and message_count > 0
          order by last_message_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) t), '[]'::jsonb);
end $$;

-- Một hội thoại của tôi: các tin gần nhất (cũ → mới), kèm chấm đúng / chưa đúng của từng câu trả lời.
create or replace function public.get_ai_thread_v1(p_thread_id uuid, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); t public.assistant_threads;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  select * into t from public.assistant_threads where id = p_thread_id and user_id = a;
  if t.id is null then raise exception 'AI_THREAD_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', t.id, 'title', t.title, 'projectId', t.project_id, 'messageCount', t.message_count,
    'createdAt', t.created_at, 'lastMessageAt', t.last_message_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content, 'sources', m.sources, 'runId', m.run_id,
          'accepted', r.accepted, 'createdAt', m.created_at) order by m.created_at, m.role desc)
      from (select * from public.assistant_messages where thread_id = t.id
            order by created_at desc, role limit least(greatest(coalesce(p_limit, 200), 1), 400)) m
      left join public.ai_runs r on r.id = m.run_id), '[]'::jsonb));
end $$;

-- Ghi một lượt hỏi–đáp (edge function ai-gateway gọi bằng JWT người hỏi, sau khi Trợ lý trả lời xong).
-- p_thread_id null → mở hội thoại mới, tiêu đề = câu hỏi đầu. runId phải là lượt AI của chính người đó.
create or replace function public.ai_thread_save_turn_v1(p_thread_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id();
  v_thread uuid; v_question text; v_answer text; v_sources jsonb; v_run uuid; v_user_msg uuid; v_ai_msg uuid;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  v_question := left(btrim(coalesce(p->>'question', '')), 8000);
  v_answer := left(btrim(coalesce(p->>'answer', '')), 8000);
  if v_question = '' or v_answer = '' then raise exception 'AI_THREAD_BAD_TURN' using errcode = '22023'; end if;
  v_sources := case when jsonb_typeof(p->'sources') = 'array' then p->'sources' else '[]'::jsonb end;
  if jsonb_array_length(v_sources) > 20 or length(v_sources::text) > 4000 then v_sources := '[]'::jsonb; end if;
  v_run := nullif(p->>'runId', '')::uuid;
  if v_run is not null and not exists (select 1 from public.ai_runs where id = v_run and user_id = a) then v_run := null; end if;

  if p_thread_id is null then
    insert into public.assistant_threads (user_id, title, project_id)
      values (a, left(regexp_replace(v_question, '\s+', ' ', 'g'), 80), left(nullif(p->>'projectId', ''), 80))
      returning id into v_thread;
  else
    select id into v_thread from public.assistant_threads where id = p_thread_id and user_id = a for update;
    if v_thread is null then raise exception 'AI_THREAD_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;

  -- clock_timestamp: thứ tự tin đúng cả khi nhiều lượt ghi trong cùng một giao dịch.
  insert into public.assistant_messages (thread_id, role, content, created_at) values (v_thread, 'user', v_question, clock_timestamp()) returning id into v_user_msg;
  insert into public.assistant_messages (thread_id, role, content, sources, run_id, created_at)
    values (v_thread, 'assistant', v_answer, v_sources, v_run, clock_timestamp()) returning id into v_ai_msg;
  update public.assistant_threads set message_count = message_count + 2, last_message_at = now() where id = v_thread;
  return jsonb_build_object('threadId', v_thread, 'userMessageId', v_user_msg, 'messageId', v_ai_msg);
end $$;

revoke all on function public.list_ai_threads_v1(integer), public.get_ai_thread_v1(uuid, integer), public.ai_thread_save_turn_v1(uuid, jsonb) from public, anon;
grant execute on function public.list_ai_threads_v1(integer), public.get_ai_thread_v1(uuid, integer), public.ai_thread_save_turn_v1(uuid, jsonb) to authenticated;
