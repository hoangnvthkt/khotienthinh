-- Trợ lý v2 · T2a "lệnh nháp + Xác nhận" (chủ SP duyệt 18/10/2026). Khung chung cho mọi lệnh Trợ lý chuẩn bị:
--   * Trợ lý (cổng AI, JWT người hỏi) chỉ CHUẨN BỊ: kiểm tra bằng lệnh xem trước của module rồi ghi một dòng assistant_commands
--     (trạng thái 'prepared') và hiện thẻ cho người dùng. AI không có công cụ gửi / ghi nghiệp vụ.
--   * Người dùng bấm Xác nhận trên thẻ → màn hình gọi ĐÚNG lệnh gửi của module (như form thường) → ghi biên nhận ('done', mã chứng từ)
--     hoặc 'failed' / 'cancelled'. Dòng lệnh là nhật ký: ai, lệnh gì, AI chuẩn bị gì, ai xác nhận, lúc nào, ra chứng từ nào.
--   * Lệnh đầu tiên: leave_request (nghỉ phép của tôi — preview_my_leave_request / submit_my_leave_request). Đề xuất vật tư, đơn mua,
--     nhật ký làm ở các đợt sau (mở form thật điền sẵn).
--   * Chỉ chủ lệnh xem; mở lại hội thoại thấy trạng thái thẻ (get_ai_thread_v1 trả kèm lệnh của từng câu trả lời theo runId).

create table if not exists public.assistant_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  run_id uuid references public.ai_runs(id) on delete set null,
  kind text not null check (kind in ('leave_request')),
  status text not null default 'prepared' check (status in ('prepared', 'done', 'cancelled', 'failed')),
  title text not null check (char_length(title) between 1 and 160),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  preview jsonb not null default '{}'::jsonb check (jsonb_typeof(preview) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);
comment on table public.assistant_commands is 'Trợ lý: lệnh nháp AI chuẩn bị (chờ người dùng Xác nhận) và biên nhận. Chỉ chủ lệnh xem. Chỉ qua RPC.';
create index if not exists assistant_commands_run_idx on public.assistant_commands (run_id);
create index if not exists assistant_commands_user_created_idx on public.assistant_commands (user_id, created_at desc);
alter table public.assistant_commands enable row level security;
revoke all on public.assistant_commands from public, anon, authenticated;

create or replace function app_private.assistant_command_row(c public.assistant_commands)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'runId', c.run_id, 'kind', c.kind, 'status', c.status, 'title', c.title, 'payload', c.payload,
    'preview', c.preview, 'result', c.result, 'error', c.error, 'createdAt', c.created_at, 'confirmedAt', c.confirmed_at);
$$;
revoke all on function app_private.assistant_command_row(public.assistant_commands) from public, anon, authenticated;

-- Cổng AI ghi lệnh nháp trong lúc trả lời (JWT người hỏi): lượt AI phải của chính người đó và đang chạy (Trợ lý · hội thoại).
create or replace function public.assistant_command_create_v1(p_run_id uuid, p_kind text, p_title text, p_payload jsonb, p_preview jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); c public.assistant_commands;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  if not exists (select 1 from public.ai_runs r where r.id = p_run_id and r.user_id = a and r.skill_code = 'assistant_chat' and r.status = 'started') then
    raise exception 'ASSISTANT_COMMAND_RUN_INVALID' using errcode = '42501';
  end if;
  if (select count(*) from public.assistant_commands where run_id = p_run_id) >= 3 then
    raise exception 'ASSISTANT_COMMAND_TOO_MANY' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_preview) <> 'object' or length(p_payload::text) > 8000 or length(p_preview::text) > 8000 then
    raise exception 'ASSISTANT_COMMAND_BAD_INPUT' using errcode = '22023';
  end if;
  insert into public.assistant_commands (user_id, run_id, kind, title, payload, preview, created_at)
    values (a, p_run_id, p_kind, left(btrim(coalesce(p_title, '')), 160), p_payload, p_preview, clock_timestamp()) returning * into c;
  return app_private.assistant_command_row(c);
end $$;

-- Màn hình ghi kết quả sau khi người dùng bấm Xác nhận (đã gọi lệnh gửi của module) hoặc Bỏ. Chỉ chủ lệnh; lệnh đã xong / đã bỏ không đổi nữa.
create or replace function public.assistant_command_finish_v1(p_id uuid, p_status text, p_result jsonb default '{}'::jsonb, p_error text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); c public.assistant_commands;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  if p_status not in ('done', 'cancelled', 'failed') then raise exception 'ASSISTANT_COMMAND_BAD_STATUS' using errcode = '22023'; end if;
  select * into c from public.assistant_commands where id = p_id and user_id = a for update;
  if c.id is null then raise exception 'ASSISTANT_COMMAND_NOT_FOUND' using errcode = 'P0002'; end if;
  if c.status not in ('prepared', 'failed') then raise exception 'ASSISTANT_COMMAND_CLOSED' using errcode = '22023'; end if;
  update public.assistant_commands set
    status = p_status,
    result = case when jsonb_typeof(p_result) = 'object' and length(p_result::text) <= 2000 then p_result else '{}'::jsonb end,
    error = left(nullif(btrim(coalesce(p_error, '')), ''), 500),
    confirmed_at = case when p_status = 'done' then now() else confirmed_at end,
    updated_at = now()
  where id = c.id returning * into c;
  return app_private.assistant_command_row(c);
end $$;

-- Loại nghỉ phép đang dùng (cho Trợ lý khớp "phép năm", "nghỉ ốm"…): theo RLS của hrm_leave_types như form nghỉ phép.
create or replace function public.assistant_leave_types_v1()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'unit', t.unit, 'deductsAnnual', t.deducts_annual,
      'requiresAttachment', coalesce(t.requires_attachment, false), 'subtypes', t.subtypes) order by t.sort_order), '[]'::jsonb)
  from public.hrm_leave_types t where t.is_active;
$$;

-- Hội thoại: kèm lệnh nháp của từng câu trả lời (theo runId) để mở lại thấy đúng trạng thái thẻ.
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
          'accepted', r.accepted, 'createdAt', m.created_at,
          'commands', coalesce((select jsonb_agg(app_private.assistant_command_row(c) order by c.created_at)
            from public.assistant_commands c where m.run_id is not null and c.run_id = m.run_id and c.user_id = a), '[]'::jsonb))
        order by m.created_at, m.role desc)
      from (select * from public.assistant_messages where thread_id = t.id
            order by created_at desc, role limit least(greatest(coalesce(p_limit, 200), 1), 400)) m
      left join public.ai_runs r on r.id = m.run_id), '[]'::jsonb));
end $$;

revoke all on function public.assistant_command_create_v1(uuid, text, text, jsonb, jsonb), public.assistant_command_finish_v1(uuid, text, jsonb, text),
  public.assistant_leave_types_v1() from public, anon;
grant execute on function public.assistant_command_create_v1(uuid, text, text, jsonb, jsonb), public.assistant_command_finish_v1(uuid, text, jsonb, text),
  public.assistant_leave_types_v1() to authenticated;
