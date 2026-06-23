-- Chat v2 structured messages and participant-scoped realtime inbox cache.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

alter table public.chat_v2_messages
  drop constraint if exists chat_v2_messages_kind_check;

alter table public.chat_v2_messages
  add constraint chat_v2_messages_kind_check
  check (kind in ('text', 'image', 'file', 'poll', 'checklist', 'quick_confirm', 'system'));

alter table public.chat_v2_participants
  add column if not exists last_message_id uuid references public.chat_v2_messages(id) on delete set null,
  add column if not exists last_message_preview text,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_sender_id uuid references public.users(id) on delete set null,
  add column if not exists unread_count integer not null default 0;

alter table public.chat_v2_participants
  drop constraint if exists chat_v2_participants_unread_nonnegative;

alter table public.chat_v2_participants
  add constraint chat_v2_participants_unread_nonnegative
  check (unread_count >= 0);

create table if not exists public.chat_v2_poll_votes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_v2_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_v2_messages(id) on delete cascade,
  option_id text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (message_id, option_id, user_id)
);

create table if not exists public.chat_v2_checklist_items (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_v2_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_v2_messages(id) on delete cascade,
  content text not null,
  sort_order integer not null default 0,
  is_done boolean not null default false,
  done_by uuid references public.users(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_v2_quick_confirm_responses (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_v2_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_v2_messages(id) on delete cascade,
  option_id text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists idx_chat_v2_participants_user_inbox
  on public.chat_v2_participants(user_id, left_at, last_message_at desc nulls last, updated_at desc);

create index if not exists idx_chat_v2_messages_conversation_created
  on public.chat_v2_messages(conversation_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists idx_chat_v2_poll_votes_message
  on public.chat_v2_poll_votes(message_id, option_id);

create index if not exists idx_chat_v2_poll_votes_conversation
  on public.chat_v2_poll_votes(conversation_id, created_at desc);

create index if not exists idx_chat_v2_checklist_items_message
  on public.chat_v2_checklist_items(message_id, sort_order, created_at);

create index if not exists idx_chat_v2_checklist_items_conversation
  on public.chat_v2_checklist_items(conversation_id, updated_at desc);

create index if not exists idx_chat_v2_quick_confirm_message
  on public.chat_v2_quick_confirm_responses(message_id, option_id);

create index if not exists idx_chat_v2_quick_confirm_conversation
  on public.chat_v2_quick_confirm_responses(conversation_id, updated_at desc);

drop trigger if exists trg_chat_v2_checklist_items_updated_at on public.chat_v2_checklist_items;
create trigger trg_chat_v2_checklist_items_updated_at
  before update on public.chat_v2_checklist_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_chat_v2_quick_confirm_updated_at on public.chat_v2_quick_confirm_responses;
create trigger trg_chat_v2_quick_confirm_updated_at
  before update on public.chat_v2_quick_confirm_responses
  for each row execute function public.set_updated_at();

create or replace function app_private.chat_v2_message_preview(
  p_kind text,
  p_body text,
  p_metadata jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    coalesce(
      nullif(trim(p_body), ''),
      case coalesce(p_kind, 'text')
        when 'image' then 'Hình ảnh'
        when 'file' then 'Tệp đính kèm'
        when 'poll' then 'Bình chọn: ' || coalesce(nullif(trim(p_metadata->>'question'), ''), nullif(trim(p_metadata->>'title'), ''), 'Chưa có tiêu đề')
        when 'checklist' then 'Checklist: ' || coalesce(nullif(trim(p_metadata->>'title'), ''), 'Chưa có tiêu đề')
        when 'quick_confirm' then 'Xác nhận: ' || coalesce(nullif(trim(p_metadata->>'title'), ''), 'Chưa có tiêu đề')
        when 'system' then 'Cập nhật hệ thống'
        else 'Tin nhắn'
      end
    ),
    240
  );
$$;

revoke all on function app_private.chat_v2_message_preview(text, text, jsonb) from public;
grant execute on function app_private.chat_v2_message_preview(text, text, jsonb) to authenticated;

create or replace function app_private.chat_v2_latest_message(p_conversation_id uuid)
returns public.chat_v2_messages
language sql
stable
security definer
set search_path = ''
as $$
  select m
  from public.chat_v2_messages m
  where m.conversation_id = p_conversation_id
    and m.deleted_at is null
  order by m.created_at desc, m.id desc
  limit 1;
$$;

revoke all on function app_private.chat_v2_latest_message(uuid) from public;
grant execute on function app_private.chat_v2_latest_message(uuid) to authenticated;

create or replace function app_private.chat_v2_sync_participant_inbox(
  p_conversation_id uuid,
  p_increment_unread boolean default false,
  p_sender_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.chat_v2_messages%rowtype;
  v_preview text;
begin
  select *
  into v_message
  from app_private.chat_v2_latest_message(p_conversation_id);

  if v_message.id is null then
    update public.chat_v2_conversations
    set last_message_id = null,
        last_message_at = null,
        last_message_preview = null,
        last_message_sender_id = null,
        updated_at = now()
    where id = p_conversation_id;

    update public.chat_v2_participants
    set last_message_id = null,
        last_message_at = null,
        last_message_preview = null,
        last_message_sender_id = null,
        unread_count = 0,
        updated_at = now()
    where conversation_id = p_conversation_id;
    return;
  end if;

  v_preview := app_private.chat_v2_message_preview(v_message.kind, v_message.body, v_message.metadata);

  update public.chat_v2_conversations
  set last_message_id = v_message.id,
      last_message_at = v_message.created_at,
      last_message_preview = v_preview,
      last_message_sender_id = v_message.sender_id,
      updated_at = now()
  where id = p_conversation_id;

  update public.chat_v2_participants p
  set last_message_id = v_message.id,
      last_message_at = v_message.created_at,
      last_message_preview = v_preview,
      last_message_sender_id = v_message.sender_id,
      unread_count = case
        when p_increment_unread
          and p_sender_id is not null
          and p.user_id <> p_sender_id
          and p.left_at is null
          and coalesce(p.is_muted, false) is false
        then p.unread_count + 1
        when p.last_read_at is not null and p.last_read_at >= v_message.created_at then 0
        else p.unread_count
      end,
      updated_at = now()
  where p.conversation_id = p_conversation_id;
end;
$$;

revoke all on function app_private.chat_v2_sync_participant_inbox(uuid, boolean, uuid) from public;
grant execute on function app_private.chat_v2_sync_participant_inbox(uuid, boolean, uuid) to authenticated;

create or replace function app_private.guard_chat_v2_participant_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_conversation_id uuid := coalesce(new.conversation_id, old.conversation_id);
  v_conversation_type text;
  v_is_manager boolean;
  v_is_creator boolean;
  v_active_owner_count integer;
begin
  if tg_op = 'UPDATE'
    and new.conversation_id is not distinct from old.conversation_id
    and new.user_id is not distinct from old.user_id
    and new.role is not distinct from old.role
    and new.is_muted is not distinct from old.is_muted
    and new.is_pinned is not distinct from old.is_pinned
    and new.last_read_message_id is not distinct from old.last_read_message_id
    and new.last_read_at is not distinct from old.last_read_at
    and new.joined_at is not distinct from old.joined_at
    and new.left_at is not distinct from old.left_at
    and new.created_at is not distinct from old.created_at then
    return new;
  end if;

  if v_actor is null then
    raise exception 'Không xác định được người dùng hiện tại.';
  end if;

  select c.type, c.created_by = v_actor
  into v_conversation_type, v_is_creator
  from public.chat_v2_conversations c
  where c.id = v_conversation_id
    and c.deleted_at is null;

  if v_conversation_type is null then
    raise exception 'Hội thoại không tồn tại hoặc đã bị xóa.';
  end if;

  if public.is_admin() then
    return coalesce(new, old);
  end if;

  v_is_manager := app_private.chat_v2_can_manage(v_conversation_id, v_actor);

  if tg_op = 'INSERT' then
    if not (v_is_manager or v_is_creator) then
      raise exception 'Bạn không có quyền thêm thành viên vào nhóm này.';
    end if;
    if v_conversation_type = 'direct' and not v_is_creator then
      raise exception 'Không thể thêm thành viên vào hội thoại cá nhân.';
    end if;
    if new.role = 'owner' and not v_is_creator then
      raise exception 'Không thể tự tạo quyền chủ nhóm.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.conversation_id is distinct from old.conversation_id
      or new.user_id is distinct from old.user_id
      or new.joined_at is distinct from old.joined_at then
      raise exception 'Không thể thay đổi danh tính thành viên.';
    end if;

    if old.user_id = v_actor and not v_is_manager then
      if new.role is distinct from old.role then
        raise exception 'Bạn không thể tự thay đổi quyền nhóm.';
      end if;
      if old.role = 'owner' and old.left_at is null and new.left_at is not null then
        select count(*)
        into v_active_owner_count
        from public.chat_v2_participants p
        where p.conversation_id = old.conversation_id
          and p.role = 'owner'
          and p.left_at is null
          and p.user_id <> old.user_id;
        if coalesce(v_active_owner_count, 0) = 0 then
          raise exception 'Không thể rời nhóm khi bạn là chủ nhóm cuối cùng.';
        end if;
      end if;
      return new;
    end if;

    if not v_is_manager then
      raise exception 'Bạn không có quyền quản trị thành viên nhóm này.';
    end if;

    if v_conversation_type = 'direct' and (
      new.role is distinct from old.role
      or new.left_at is distinct from old.left_at
      or new.user_id is distinct from old.user_id
    ) then
      raise exception 'Không thể quản trị thành viên trong hội thoại cá nhân.';
    end if;

    if new.role = 'owner' and old.role is distinct from 'owner' then
      raise exception 'Chỉ được gán quyền quản trị viên nhóm, không được tạo thêm chủ nhóm.';
    end if;

    if old.role = 'owner' and (
      new.role is distinct from 'owner'
      or (old.left_at is null and new.left_at is not null)
    ) then
      select count(*)
      into v_active_owner_count
      from public.chat_v2_participants p
      where p.conversation_id = old.conversation_id
        and p.role = 'owner'
        and p.left_at is null
        and p.user_id <> old.user_id;
      if coalesce(v_active_owner_count, 0) = 0 then
        raise exception 'Không thể hạ quyền hoặc loại bỏ chủ nhóm cuối cùng.';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Không xóa cứng thành viên chat; hãy dùng left_at để loại khỏi nhóm.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_chat_v2_participant_mutation on public.chat_v2_participants;
create trigger trg_guard_chat_v2_participant_mutation
  before insert or update or delete on public.chat_v2_participants
  for each row execute function app_private.guard_chat_v2_participant_mutation();

create or replace function app_private.chat_v2_touch_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.chat_v2_sync_participant_inbox(new.conversation_id, true, new.sender_id);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    perform app_private.chat_v2_sync_participant_inbox(new.conversation_id, false, new.sender_id);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform app_private.chat_v2_sync_participant_inbox(old.conversation_id, false, old.sender_id);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_chat_v2_touch_conversation_message on public.chat_v2_messages;
create trigger trg_chat_v2_touch_conversation_message
  after insert or update of body, kind, metadata, deleted_at or delete on public.chat_v2_messages
  for each row execute function app_private.chat_v2_touch_conversation_message();

create or replace function app_private.guard_chat_v2_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_is_manager boolean;
begin
  if v_actor is null then
    raise exception 'Không xác định được người dùng hiện tại.';
  end if;

  if public.is_admin() then
    return new;
  end if;

  if new.conversation_id is distinct from old.conversation_id
    or new.sender_id is distinct from old.sender_id
    or new.kind is distinct from old.kind
    or new.reply_to_message_id is distinct from old.reply_to_message_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Không thể thay đổi dữ liệu gốc của tin nhắn.';
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Không thể khôi phục tin nhắn đã xóa.';
  end if;

  v_is_manager := app_private.chat_v2_can_manage(old.conversation_id, v_actor);

  if new.body is distinct from old.body
    or new.metadata is distinct from old.metadata
    or new.edited_at is distinct from old.edited_at then
    if old.sender_id <> v_actor then
      raise exception 'Bạn chỉ có thể sửa tin nhắn của mình.';
    end if;
    if old.deleted_at is not null then
      raise exception 'Không thể sửa tin nhắn đã xóa.';
    end if;
  end if;

  if new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then
    if old.sender_id <> v_actor and not v_is_manager then
      raise exception 'Bạn không có quyền xóa tin nhắn này.';
    end if;
    if new.deleted_at is not null and new.deleted_by is distinct from v_actor then
      raise exception 'Người xóa tin nhắn không hợp lệ.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_chat_v2_message_update on public.chat_v2_messages;
create trigger trg_guard_chat_v2_message_update
  before update on public.chat_v2_messages
  for each row execute function app_private.guard_chat_v2_message_update();

create or replace function app_private.guard_chat_v2_structured_message_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  select m.conversation_id
  into v_conversation_id
  from public.chat_v2_messages m
  where m.id = coalesce(new.message_id, old.message_id);

  if v_conversation_id is null then
    raise exception 'Tin nhắn không tồn tại.';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.conversation_id is distinct from v_conversation_id then
    raise exception 'Dữ liệu tương tác không thuộc hội thoại của tin nhắn.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_chat_v2_poll_vote_link on public.chat_v2_poll_votes;
create trigger trg_guard_chat_v2_poll_vote_link
  before insert or update on public.chat_v2_poll_votes
  for each row execute function app_private.guard_chat_v2_structured_message_link();

drop trigger if exists trg_guard_chat_v2_checklist_item_link on public.chat_v2_checklist_items;
create trigger trg_guard_chat_v2_checklist_item_link
  before insert or update on public.chat_v2_checklist_items
  for each row execute function app_private.guard_chat_v2_structured_message_link();

drop trigger if exists trg_guard_chat_v2_quick_confirm_link on public.chat_v2_quick_confirm_responses;
create trigger trg_guard_chat_v2_quick_confirm_link
  before insert or update on public.chat_v2_quick_confirm_responses
  for each row execute function app_private.guard_chat_v2_structured_message_link();

alter table public.chat_v2_poll_votes enable row level security;
alter table public.chat_v2_checklist_items enable row level security;
alter table public.chat_v2_quick_confirm_responses enable row level security;

drop policy if exists chat_v2_poll_votes_select on public.chat_v2_poll_votes;
create policy chat_v2_poll_votes_select
  on public.chat_v2_poll_votes for select to authenticated
  using (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_poll_votes_insert on public.chat_v2_poll_votes;
create policy chat_v2_poll_votes_insert
  on public.chat_v2_poll_votes for insert to authenticated
  with check (
    public.is_admin()
    or (
      user_id = public.current_app_user_id()
      and app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
    )
  );

drop policy if exists chat_v2_poll_votes_delete on public.chat_v2_poll_votes;
create policy chat_v2_poll_votes_delete
  on public.chat_v2_poll_votes for delete to authenticated
  using (public.is_admin() or user_id = public.current_app_user_id());

drop policy if exists chat_v2_checklist_items_select on public.chat_v2_checklist_items;
create policy chat_v2_checklist_items_select
  on public.chat_v2_checklist_items for select to authenticated
  using (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_checklist_items_insert on public.chat_v2_checklist_items;
create policy chat_v2_checklist_items_insert
  on public.chat_v2_checklist_items for insert to authenticated
  with check (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_checklist_items_update on public.chat_v2_checklist_items;
create policy chat_v2_checklist_items_update
  on public.chat_v2_checklist_items for update to authenticated
  using (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_quick_confirm_select on public.chat_v2_quick_confirm_responses;
create policy chat_v2_quick_confirm_select
  on public.chat_v2_quick_confirm_responses for select to authenticated
  using (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_quick_confirm_insert on public.chat_v2_quick_confirm_responses;
create policy chat_v2_quick_confirm_insert
  on public.chat_v2_quick_confirm_responses for insert to authenticated
  with check (
    public.is_admin()
    or (
      user_id = public.current_app_user_id()
      and app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
    )
  );

drop policy if exists chat_v2_quick_confirm_update on public.chat_v2_quick_confirm_responses;
create policy chat_v2_quick_confirm_update
  on public.chat_v2_quick_confirm_responses for update to authenticated
  using (public.is_admin() or user_id = public.current_app_user_id())
  with check (
    public.is_admin()
    or (
      user_id = public.current_app_user_id()
      and app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
    )
  );

grant select, insert, delete on table public.chat_v2_poll_votes to authenticated;
grant select, insert, update on table public.chat_v2_checklist_items to authenticated;
grant select, insert, update on table public.chat_v2_quick_confirm_responses to authenticated;

alter table public.chat_v2_poll_votes replica identity full;
alter table public.chat_v2_checklist_items replica identity full;
alter table public.chat_v2_quick_confirm_responses replica identity full;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'chat_v2_poll_votes',
    'chat_v2_checklist_items',
    'chat_v2_quick_confirm_responses'
  ]
  loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
         select 1
         from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = v_table
       ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

update public.chat_v2_participants p
set last_message_id = c.last_message_id,
    last_message_at = c.last_message_at,
    last_message_preview = c.last_message_preview,
    last_message_sender_id = c.last_message_sender_id,
    unread_count = coalesce((
      select count(*)::integer
      from public.chat_v2_messages m
      where m.conversation_id = p.conversation_id
        and m.deleted_at is null
        and m.sender_id <> p.user_id
        and (p.last_read_at is null or m.created_at > p.last_read_at)
    ), 0),
    updated_at = now()
from public.chat_v2_conversations c
where c.id = p.conversation_id;

notify pgrst, 'reload schema';
