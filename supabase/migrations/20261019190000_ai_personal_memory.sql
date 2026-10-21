-- Trợ lý v2 · T4b "AI đã nhớ gì" + trí nhớ cá nhân (chủ SP duyệt 18/10/2026). Vẫn một nguyên tắc: AI chỉ nhớ điều NGƯỜI XÁC NHẬN.
--   1. ai_user_memory — trí nhớ riêng từng người, chỉ chủ xem / quên:
--      * note: ghi nhớ người dùng tự viết ở bảng Trí nhớ, hoặc bảo Trợ lý "nhớ giúp" rồi tự bấm Lưu trên thẻ (kind lệnh memory_note).
--        Cổng AI đọc ghi nhớ vào lời nhắc của chính người đó (sở thích / thông tin nền, không phải lệnh).
--      * habit: lựa chọn đã gửi thành công trên thẻ (người duyệt / kho nhận) → lần sau chọn sẵn.
--   2. get_ai_memory_overview_v1: cách gọi chung (ai_memory_aliases) theo phạm vi người xem được DẠY; forget_ai_memory_v1: quên
--      (xóa hẳn) một ghi nhớ của mình hoặc một cách gọi chung mình có quyền dạy. Trợ lý không có đường nào tự quên / tự ghi.

create table if not exists public.ai_user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('note', 'habit')),
  key text not null check (char_length(key) between 1 and 120),
  value text not null check (char_length(value) between 1 and 400),
  label text check (label is null or char_length(label) <= 300),
  source text not null default 'user' check (source in ('user', 'assistant', 'action')),
  hits integer not null default 1 check (hits >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, key)
);
create index if not exists ai_user_memory_owner on public.ai_user_memory (user_id, kind, updated_at desc);
alter table public.ai_user_memory enable row level security;
revoke all on public.ai_user_memory from public, anon, authenticated;
comment on table public.ai_user_memory is 'Trí nhớ cá nhân của Trợ lý: ghi nhớ người dùng tự lưu + thói quen đã xác nhận (người duyệt, kho). Chỉ chủ xem, qua RPC.';

alter table public.assistant_commands drop constraint if exists assistant_commands_kind_check;
alter table public.assistant_commands add constraint assistant_commands_kind_check
  check (kind in ('leave_request', 'material_request', 'purchase_order', 'daily_log', 'memory_note'));

-- Mã dự án ở cuối khóa thói quen ("mr.approvers:<projectId>") → nhãn phạm vi.
create or replace function app_private.ai_habit_scope_label(p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(nullif(p.code, ''), p.name) from public.projects p where p.id = split_part(p_key, ':', 2)), case when p_key like 'po.%' then 'Mua hàng' end);
$$;
revoke all on function app_private.ai_habit_scope_label(text) from public, anon, authenticated;

create or replace function public.get_ai_user_memory_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.current_app_user_id();
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'text', m.value, 'source', m.source, 'createdAt', m.created_at) order by m.created_at desc)
      from public.ai_user_memory m where m.user_id = v_me and m.kind = 'note'), '[]'::jsonb),
    'habits', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'key', m.key, 'value', m.value, 'label', m.label, 'hits', m.hits, 'updatedAt', m.updated_at,
        'scopeLabel', app_private.ai_habit_scope_label(m.key)) order by m.updated_at desc)
      from public.ai_user_memory m where m.user_id = v_me and m.kind = 'habit'), '[]'::jsonb));
end $$;

-- Lưu một ghi nhớ (người dùng tự gõ, hoặc bấm Lưu trên thẻ Trợ lý chuẩn bị). Trùng chữ thì giữ bản cũ; tối đa 30 ghi nhớ.
create or replace function public.ai_user_note_save_v1(p_text text, p_source text default 'user')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.current_app_user_id();
  v_text text := left(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g'), 300);
  v_key text; v_row public.ai_user_memory;
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if char_length(v_text) < 3 then raise exception 'AI_NOTE_TOO_SHORT' using errcode = '22023'; end if;
  if coalesce(p_source, 'user') not in ('user', 'assistant') then raise exception 'AI_NOTE_BAD_SOURCE' using errcode = '22023'; end if;
  v_key := 'note:' || md5(app_private.ai_alias_norm(v_text));
  select * into v_row from public.ai_user_memory where user_id = v_me and kind = 'note' and key = v_key;
  if found then return jsonb_build_object('id', v_row.id, 'created', false); end if;
  if (select count(*) from public.ai_user_memory where user_id = v_me and kind = 'note') >= 30 then
    raise exception 'AI_NOTE_LIMIT' using errcode = '22023';
  end if;
  insert into public.ai_user_memory (user_id, kind, key, value, source) values (v_me, 'note', v_key, v_text, coalesce(p_source, 'user')) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'created', true);
end $$;

-- Thói quen đã xác nhận bằng hành động (gửi thành công trên thẻ): chỉ các khóa cho phép; cùng giá trị thì cộng lượt, khác thì thay.
create or replace function public.learn_ai_user_habits_v1(p_pairs jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := public.current_app_user_id();
  v_pair jsonb; v_key text; v_value text; v_label text; v_saved integer := 0;
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if jsonb_typeof(p_pairs) is distinct from 'array' then raise exception 'AI_HABIT_PAIRS_REQUIRED' using errcode = '22023'; end if;
  for v_pair in select value from jsonb_array_elements(p_pairs) limit 10 loop
    v_key := btrim(coalesce(v_pair ->> 'key', ''));
    v_value := left(btrim(coalesce(v_pair ->> 'value', '')), 400);
    v_label := nullif(left(btrim(coalesce(v_pair ->> 'label', '')), 300), '');
    continue when v_value = '' or v_key !~ '^((mr\.approvers|mr\.warehouse|po\.warehouse):[A-Za-z0-9_.-]{1,80}|po\.approver)$';
    insert into public.ai_user_memory (user_id, kind, key, value, label, source) values (v_me, 'habit', v_key, v_value, v_label, 'action')
    on conflict (user_id, kind, key) do update
      set hits = case when public.ai_user_memory.value = excluded.value then public.ai_user_memory.hits + 1 else 1 end,
          value = excluded.value, label = excluded.label, updated_at = now();
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved);
end $$;

-- Người xem được dạy / quên cách gọi chung ở đâu: đề xuất vật tư (theo dự án), nhật ký (theo dự án), Mua hàng (công ty).
create or replace function app_private.ai_alias_forget_can(p_scope_type text, p_scope_id text, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and case
    when p_scope_type = 'company' then p_scope_id = 'procurement' and app_private.procurement_can('manage')
    when p_kind = 'item' then exists (select 1 from public.projects p where p.id = p_scope_id
      and app_private.material_has_action(p.id, p.construction_site_id::text, 'project.material_request.create', public.current_app_user_id()))
    when p_kind in ('task', 'crew', 'area') then exists (select 1 from public.projects p where p.id = p_scope_id
      and app_private.ai_memory_can(p.id, p.construction_site_id::text, array['submit', 'verify', 'approve']))
    else false end;
$$;
revoke all on function app_private.ai_alias_forget_can(text, text, text) from public, anon, authenticated;

create or replace function public.get_ai_memory_overview_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.current_app_user_id();
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', g.key, 'title', g.title, 'kind', g.group_kind, 'items', g.items) order by g.sort, g.title)
    from (
      select s.scope_type || ':' || s.scope_id || ':' || s.group_kind key, s.group_kind,
        case when s.scope_type = 'company' then 'Mua hàng' else coalesce((select coalesce(nullif(p.code, ''), p.name) from public.projects p where p.id = s.scope_id), s.scope_id) end
          || case s.group_kind when 'mr' then ' · Đề xuất vật tư' when 'dl' then ' · Nhật ký' else ' · Báo giá' end title,
        case when s.scope_type = 'company' then 0 else 1 end sort,
        (select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'alias', a.alias_text, 'target', a.target_label, 'hits', a.hits,
            'lastUsedAt', a.last_used_at, 'by', (select u.name from public.users u where u.id = a.updated_by)) order by a.hits desc, a.last_used_at desc)
          from (select * from public.ai_memory_aliases a2 where a2.scope_type = s.scope_type and a2.scope_id = s.scope_id
                  and case s.group_kind when 'dl' then a2.kind in ('task', 'crew', 'area') else a2.kind in ('item', 'vendor') end
                order by a2.hits desc, a2.last_used_at desc limit 300) a) items
      from (
        select distinct a.scope_type, a.scope_id,
          case when a.kind in ('task', 'crew', 'area') then 'dl' when a.scope_type = 'company' then 'po' else 'mr' end group_kind,
          case when a.kind in ('task', 'crew', 'area') then 'task' else 'item' end perm_kind
        from public.ai_memory_aliases a
      ) s
      where app_private.ai_alias_forget_can(s.scope_type, s.scope_id, s.perm_kind)
    ) g), '[]'::jsonb);
end $$;

-- Quên = xóa hẳn. Của mình: chỉ chủ. Cách gọi chung: người có quyền dạy ở đúng phạm vi đó (áp cho mọi người trong phạm vi).
create or replace function public.forget_ai_memory_v1(p_scope text, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := public.current_app_user_id(); v_alias public.ai_memory_aliases;
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_scope = 'personal' then
    delete from public.ai_user_memory where id = p_id and user_id = v_me;
    if not found then raise exception 'AI_MEMORY_NOT_FOUND' using errcode = 'P0002'; end if;
  elsif p_scope = 'shared' then
    select * into v_alias from public.ai_memory_aliases where id = p_id;
    if not found then raise exception 'AI_MEMORY_NOT_FOUND' using errcode = 'P0002'; end if;
    if not app_private.ai_alias_forget_can(v_alias.scope_type, v_alias.scope_id, v_alias.kind) then
      raise exception 'AI_MEMORY_DENIED' using errcode = '42501';
    end if;
    delete from public.ai_memory_aliases where id = p_id;
  else
    raise exception 'AI_MEMORY_BAD_SCOPE' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.get_ai_user_memory_v1(), public.ai_user_note_save_v1(text, text), public.learn_ai_user_habits_v1(jsonb),
  public.get_ai_memory_overview_v1(), public.forget_ai_memory_v1(text, uuid) from public, anon;
grant execute on function public.get_ai_user_memory_v1(), public.ai_user_note_save_v1(text, text), public.learn_ai_user_habits_v1(jsonb),
  public.get_ai_memory_overview_v1(), public.forget_ai_memory_v1(text, uuid) to authenticated;
