-- Chat v2 revival: lean realtime messaging next to the legacy chat module.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create table if not exists public.chat_v2_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type in ('direct', 'group')),
  name text,
  avatar_url text,
  created_by uuid references public.users(id) on delete set null,
  last_message_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid references public.users(id) on delete set null,
  legacy_conversation_id uuid unique,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  deleted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_v2_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_v2_conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  is_muted boolean not null default false,
  is_pinned boolean not null default false,
  last_read_message_id uuid,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create table if not exists public.chat_v2_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_v2_conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null default '',
  kind text not null default 'text' check (kind in ('text', 'system')),
  reply_to_message_id uuid references public.chat_v2_messages(id) on delete set null,
  legacy_message_id uuid unique,
  metadata jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_v2_conversations_last_message_fkey'
      and conrelid = 'public.chat_v2_conversations'::regclass
  ) then
    alter table public.chat_v2_conversations
      add constraint chat_v2_conversations_last_message_fkey
      foreign key (last_message_id) references public.chat_v2_messages(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_v2_participants_last_read_fkey'
      and conrelid = 'public.chat_v2_participants'::regclass
  ) then
    alter table public.chat_v2_participants
      add constraint chat_v2_participants_last_read_fkey
      foreign key (last_read_message_id) references public.chat_v2_messages(id) on delete set null;
  end if;
end $$;

create table if not exists public.chat_v2_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_v2_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_v2_messages(id) on delete cascade,
  uploaded_by uuid not null references public.users(id) on delete cascade,
  storage_bucket text not null default 'chat-attachments',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  thumbnail_path text,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table if not exists public.chat_v2_reactions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_v2_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_v2_messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create table if not exists public.chat_v2_direct_pairs (
  user_low_id uuid not null references public.users(id) on delete cascade,
  user_high_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid not null unique references public.chat_v2_conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low_id, user_high_id),
  check (user_low_id < user_high_id)
);

create index if not exists idx_chat_v2_participants_user_active
  on public.chat_v2_participants(user_id, left_at, is_pinned, updated_at desc);
create index if not exists idx_chat_v2_participants_conversation_active
  on public.chat_v2_participants(conversation_id, left_at);
create index if not exists idx_chat_v2_conversations_last_message
  on public.chat_v2_conversations(last_message_at desc nulls last, updated_at desc)
  where deleted_at is null;
create index if not exists idx_chat_v2_messages_conversation_created
  on public.chat_v2_messages(conversation_id, created_at desc, id desc)
  where deleted_at is null;
create index if not exists idx_chat_v2_attachments_message
  on public.chat_v2_attachments(message_id, created_at);
create index if not exists idx_chat_v2_attachments_conversation
  on public.chat_v2_attachments(conversation_id, created_at desc);
create index if not exists idx_chat_v2_reactions_message
  on public.chat_v2_reactions(message_id, emoji);
create index if not exists idx_chat_v2_reactions_conversation
  on public.chat_v2_reactions(conversation_id, created_at desc);

drop trigger if exists trg_chat_v2_conversations_updated_at on public.chat_v2_conversations;
create trigger trg_chat_v2_conversations_updated_at
  before update on public.chat_v2_conversations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_chat_v2_participants_updated_at on public.chat_v2_participants;
create trigger trg_chat_v2_participants_updated_at
  before update on public.chat_v2_participants
  for each row execute function public.set_updated_at();

drop trigger if exists trg_chat_v2_messages_updated_at on public.chat_v2_messages;
create trigger trg_chat_v2_messages_updated_at
  before update on public.chat_v2_messages
  for each row execute function public.set_updated_at();

create or replace function app_private.chat_v2_is_participant(
  p_conversation_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.chat_v2_participants p
    where p.conversation_id = p_conversation_id
      and p.user_id = p_user_id
      and p.left_at is null
  );
$$;

revoke all on function app_private.chat_v2_is_participant(uuid, uuid) from public;
grant execute on function app_private.chat_v2_is_participant(uuid, uuid) to authenticated;

create or replace function app_private.chat_v2_can_manage(
  p_conversation_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    public.is_admin()
    or exists (
      select 1
      from public.chat_v2_conversations c
      where c.id = p_conversation_id
        and c.created_by = p_user_id
        and c.deleted_at is null
    )
    or exists (
      select 1
      from public.chat_v2_participants p
      where p.conversation_id = p_conversation_id
        and p.user_id = p_user_id
        and p.role in ('owner', 'admin')
        and p.left_at is null
    )
  );
$$;

revoke all on function app_private.chat_v2_can_manage(uuid, uuid) from public;
grant execute on function app_private.chat_v2_can_manage(uuid, uuid) to authenticated;

create or replace function app_private.chat_v2_storage_conversation_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(coalesce(p_name, ''), '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

revoke all on function app_private.chat_v2_storage_conversation_id(text) from public;
grant execute on function app_private.chat_v2_storage_conversation_id(text) to authenticated;

create or replace function app_private.chat_v2_touch_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.chat_v2_messages%rowtype;
begin
  if tg_op = 'INSERT' then
    update public.chat_v2_conversations
    set last_message_id = new.id,
        last_message_at = new.created_at,
        last_message_preview = left(coalesce(nullif(new.body, ''), case when new.kind = 'system' then 'Cập nhật hệ thống' else 'Tệp đính kèm' end), 240),
        last_message_sender_id = new.sender_id,
        updated_at = now()
    where id = new.conversation_id;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.deleted_at is not null and old.deleted_at is null then
      select *
      into v_message
      from public.chat_v2_messages m
      where m.conversation_id = new.conversation_id
        and m.deleted_at is null
      order by m.created_at desc, m.id desc
      limit 1;

      update public.chat_v2_conversations
      set last_message_id = v_message.id,
          last_message_at = v_message.created_at,
          last_message_preview = case
            when v_message.id is null then null
            else left(coalesce(nullif(v_message.body, ''), case when v_message.kind = 'system' then 'Cập nhật hệ thống' else 'Tệp đính kèm' end), 240)
          end,
          last_message_sender_id = v_message.sender_id,
          updated_at = now()
      where id = new.conversation_id
        and last_message_id = new.id;
    elsif new.body is distinct from old.body then
      update public.chat_v2_conversations
      set last_message_preview = left(coalesce(nullif(new.body, ''), 'Tệp đính kèm'), 240),
          updated_at = now()
      where id = new.conversation_id
        and last_message_id = new.id;
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_chat_v2_touch_conversation_message on public.chat_v2_messages;
create trigger trg_chat_v2_touch_conversation_message
  after insert or update of body, deleted_at on public.chat_v2_messages
  for each row execute function app_private.chat_v2_touch_conversation_message();

create or replace function app_private.chat_v2_notify_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_name text;
  v_conversation_name text;
  v_title text;
  v_message text;
begin
  if new.kind = 'system' or new.deleted_at is not null or new.legacy_message_id is not null then
    return new;
  end if;

  select coalesce(u.name, u.email, 'Người dùng')
  into v_sender_name
  from public.users u
  where u.id = new.sender_id;

  select c.name
  into v_conversation_name
  from public.chat_v2_conversations c
  where c.id = new.conversation_id;

  v_title := coalesce(v_conversation_name, v_sender_name);
  v_message := case
    when nullif(trim(new.body), '') is not null then v_sender_name || ': ' || left(trim(new.body), 140)
    else v_sender_name || ' đã gửi tệp đính kèm'
  end;

  insert into public.notifications (
    user_id,
    type,
    category,
    title,
    message,
    icon,
    link,
    severity,
    source_type,
    source_id,
    priority,
    push_enabled,
    action_url,
    entity_type,
    entity_id,
    metadata
  )
  select
    p.user_id,
    'info',
    'chat',
    v_title,
    v_message,
    '💬',
    '/chat?conversation=' || new.conversation_id::text,
    'info',
    'chat_v2_message',
    new.id::text,
    'normal',
    true,
    '/chat?conversation=' || new.conversation_id::text,
    'chat_v2_message',
    new.id,
    jsonb_build_object(
      'conversationId', new.conversation_id,
      'messageId', new.id,
      'senderId', new.sender_id
    )
  from public.chat_v2_participants p
  where p.conversation_id = new.conversation_id
    and p.left_at is null
    and p.is_muted is false
    and p.user_id <> new.sender_id;

  return new;
end;
$$;

drop trigger if exists trg_chat_v2_notify_message on public.chat_v2_messages;
create trigger trg_chat_v2_notify_message
  after insert on public.chat_v2_messages
  for each row execute function app_private.chat_v2_notify_message();

create or replace function public.chat_v2_get_or_create_direct_conversation(p_target_user_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_low uuid;
  v_high uuid;
  v_conversation_id uuid;
begin
  if v_actor is null then
    raise exception 'Không xác định được người dùng hiện tại.';
  end if;
  if p_target_user_id is null or p_target_user_id = v_actor then
    raise exception 'Người nhận không hợp lệ.';
  end if;
  if not exists (select 1 from public.users u where u.id = p_target_user_id and coalesce(u.is_active, true)) then
    raise exception 'Người nhận không tồn tại hoặc đã bị khóa.';
  end if;

  v_low := least(v_actor, p_target_user_id);
  v_high := greatest(v_actor, p_target_user_id);

  perform pg_advisory_xact_lock(hashtext(v_low::text || ':' || v_high::text));

  select dp.conversation_id
  into v_conversation_id
  from public.chat_v2_direct_pairs dp
  where dp.user_low_id = v_low
    and dp.user_high_id = v_high;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  insert into public.chat_v2_conversations(type, created_by, metadata)
  values (
    'direct',
    v_actor,
    jsonb_build_object('directUserIds', jsonb_build_array(v_low, v_high))
  )
  returning id into v_conversation_id;

  insert into public.chat_v2_participants(conversation_id, user_id, role, last_read_at)
  values
    (v_conversation_id, v_actor, 'owner', now()),
    (v_conversation_id, p_target_user_id, 'member', null)
  on conflict (conversation_id, user_id) do nothing;

  insert into public.chat_v2_direct_pairs(user_low_id, user_high_id, conversation_id)
  values (v_low, v_high, v_conversation_id);

  return v_conversation_id;
end;
$$;

revoke all on function public.chat_v2_get_or_create_direct_conversation(uuid) from public;
grant execute on function public.chat_v2_get_or_create_direct_conversation(uuid) to authenticated;

alter table public.chat_v2_conversations enable row level security;
alter table public.chat_v2_participants enable row level security;
alter table public.chat_v2_messages enable row level security;
alter table public.chat_v2_attachments enable row level security;
alter table public.chat_v2_reactions enable row level security;
alter table public.chat_v2_direct_pairs enable row level security;

drop policy if exists chat_v2_conversations_select on public.chat_v2_conversations;
create policy chat_v2_conversations_select
  on public.chat_v2_conversations for select to authenticated
  using (
    public.is_admin()
    or created_by = public.current_app_user_id()
    or app_private.chat_v2_is_participant(id, public.current_app_user_id())
  );

drop policy if exists chat_v2_conversations_insert on public.chat_v2_conversations;
create policy chat_v2_conversations_insert
  on public.chat_v2_conversations for insert to authenticated
  with check (public.is_admin() or created_by = public.current_app_user_id());

drop policy if exists chat_v2_conversations_update on public.chat_v2_conversations;
create policy chat_v2_conversations_update
  on public.chat_v2_conversations for update to authenticated
  using (app_private.chat_v2_can_manage(id, public.current_app_user_id()))
  with check (app_private.chat_v2_can_manage(id, public.current_app_user_id()));

drop policy if exists chat_v2_conversations_delete on public.chat_v2_conversations;
create policy chat_v2_conversations_delete
  on public.chat_v2_conversations for delete to authenticated
  using (public.is_admin() or created_by = public.current_app_user_id());

drop policy if exists chat_v2_participants_select on public.chat_v2_participants;
create policy chat_v2_participants_select
  on public.chat_v2_participants for select to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_participants_insert on public.chat_v2_participants;
create policy chat_v2_participants_insert
  on public.chat_v2_participants for insert to authenticated
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or exists (
      select 1
      from public.chat_v2_conversations c
      where c.id = chat_v2_participants.conversation_id
        and c.created_by = public.current_app_user_id()
        and c.deleted_at is null
    )
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_participants_update on public.chat_v2_participants;
create policy chat_v2_participants_update
  on public.chat_v2_participants for update to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_participants_delete on public.chat_v2_participants;
create policy chat_v2_participants_delete
  on public.chat_v2_participants for delete to authenticated
  using (public.is_admin() or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id()));

drop policy if exists chat_v2_messages_select on public.chat_v2_messages;
create policy chat_v2_messages_select
  on public.chat_v2_messages for select to authenticated
  using (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_messages_insert on public.chat_v2_messages;
create policy chat_v2_messages_insert
  on public.chat_v2_messages for insert to authenticated
  with check (
    public.is_admin()
    or (
      sender_id = public.current_app_user_id()
      and app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
    )
  );

drop policy if exists chat_v2_messages_update on public.chat_v2_messages;
create policy chat_v2_messages_update
  on public.chat_v2_messages for update to authenticated
  using (
    public.is_admin()
    or sender_id = public.current_app_user_id()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or sender_id = public.current_app_user_id()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_messages_delete on public.chat_v2_messages;
create policy chat_v2_messages_delete
  on public.chat_v2_messages for delete to authenticated
  using (
    public.is_admin()
    or sender_id = public.current_app_user_id()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_attachments_select on public.chat_v2_attachments;
create policy chat_v2_attachments_select
  on public.chat_v2_attachments for select to authenticated
  using (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_attachments_insert on public.chat_v2_attachments;
create policy chat_v2_attachments_insert
  on public.chat_v2_attachments for insert to authenticated
  with check (
    public.is_admin()
    or (
      uploaded_by = public.current_app_user_id()
      and app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
    )
  );

drop policy if exists chat_v2_attachments_delete on public.chat_v2_attachments;
create policy chat_v2_attachments_delete
  on public.chat_v2_attachments for delete to authenticated
  using (
    public.is_admin()
    or uploaded_by = public.current_app_user_id()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_reactions_select on public.chat_v2_reactions;
create policy chat_v2_reactions_select
  on public.chat_v2_reactions for select to authenticated
  using (
    public.is_admin()
    or app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_reactions_insert on public.chat_v2_reactions;
create policy chat_v2_reactions_insert
  on public.chat_v2_reactions for insert to authenticated
  with check (
    public.is_admin()
    or (
      user_id = public.current_app_user_id()
      and app_private.chat_v2_is_participant(conversation_id, public.current_app_user_id())
    )
  );

drop policy if exists chat_v2_reactions_delete on public.chat_v2_reactions;
create policy chat_v2_reactions_delete
  on public.chat_v2_reactions for delete to authenticated
  using (public.is_admin() or user_id = public.current_app_user_id());

drop policy if exists chat_v2_direct_pairs_select on public.chat_v2_direct_pairs;
create policy chat_v2_direct_pairs_select
  on public.chat_v2_direct_pairs for select to authenticated
  using (
    public.is_admin()
    or user_low_id = public.current_app_user_id()
    or user_high_id = public.current_app_user_id()
  );

drop policy if exists chat_v2_direct_pairs_insert on public.chat_v2_direct_pairs;
create policy chat_v2_direct_pairs_insert
  on public.chat_v2_direct_pairs for insert to authenticated
  with check (
    public.is_admin()
    or user_low_id = public.current_app_user_id()
    or user_high_id = public.current_app_user_id()
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists chat_v2_attachments_storage_select on storage.objects;
create policy chat_v2_attachments_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (
    public.is_admin()
    or app_private.chat_v2_is_participant(
      app_private.chat_v2_storage_conversation_id(name),
      public.current_app_user_id()
    )
  )
);

drop policy if exists chat_v2_attachments_storage_insert on storage.objects;
create policy chat_v2_attachments_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and app_private.chat_v2_is_participant(
    app_private.chat_v2_storage_conversation_id(name),
    public.current_app_user_id()
  )
);

drop policy if exists chat_v2_attachments_storage_update on storage.objects;
create policy chat_v2_attachments_storage_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'chat-attachments'
  and app_private.chat_v2_is_participant(
    app_private.chat_v2_storage_conversation_id(name),
    public.current_app_user_id()
  )
)
with check (
  bucket_id = 'chat-attachments'
  and app_private.chat_v2_is_participant(
    app_private.chat_v2_storage_conversation_id(name),
    public.current_app_user_id()
  )
);

drop policy if exists chat_v2_attachments_storage_delete on storage.objects;
create policy chat_v2_attachments_storage_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (
    public.is_admin()
    or owner_id = (select auth.uid()::text)
    or app_private.chat_v2_can_manage(
      app_private.chat_v2_storage_conversation_id(name),
      public.current_app_user_id()
    )
  )
);

grant select, insert, update, delete on table public.chat_v2_conversations to authenticated;
grant select, insert, update, delete on table public.chat_v2_participants to authenticated;
grant select, insert, update, delete on table public.chat_v2_messages to authenticated;
grant select, insert, delete on table public.chat_v2_attachments to authenticated;
grant select, insert, delete on table public.chat_v2_reactions to authenticated;
grant select, insert on table public.chat_v2_direct_pairs to authenticated;

alter table public.chat_v2_conversations replica identity full;
alter table public.chat_v2_participants replica identity full;
alter table public.chat_v2_messages replica identity full;
alter table public.chat_v2_attachments replica identity full;
alter table public.chat_v2_reactions replica identity full;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'chat_v2_conversations',
    'chat_v2_participants',
    'chat_v2_messages',
    'chat_v2_attachments',
    'chat_v2_reactions'
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

-- Migrate the small legacy chat footprint when old tables are present.
do $$
begin
  if to_regclass('public.chat_conversations') is not null then
    insert into public.chat_v2_conversations (
      type,
      name,
      avatar_url,
      created_by,
      legacy_conversation_id,
      metadata,
      deleted_at,
      created_at,
      updated_at
    )
    select
      case when c.type = 'group' then 'group' else 'direct' end,
      c.name,
      c.avatar_url,
      case
        when c.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and exists (select 1 from public.users u where u.id = c.created_by::uuid)
          then c.created_by::uuid
        else null
      end,
      c.id,
      jsonb_build_object('legacyType', c.type),
      c.deleted_at,
      coalesce(c.created_at, now()),
      coalesce(c.updated_at, c.created_at, now())
    from public.chat_conversations c
    where not exists (
      select 1
      from public.chat_v2_conversations v2
      where v2.legacy_conversation_id = c.id
    )
      and c.type in ('direct', 'group')
      and c.deleted_at is null;
  end if;

  if to_regclass('public.chat_members') is not null then
    insert into public.chat_v2_participants (
      conversation_id,
      user_id,
      role,
      last_read_at,
      joined_at,
      left_at
    )
    select
      v2.id,
      cm.user_id::uuid,
      case when cm.role = 'admin' then 'admin' else 'member' end,
      cm.last_read_at,
      coalesce(cm.joined_at, now()),
      cm.left_at
    from public.chat_members cm
    join public.chat_v2_conversations v2 on v2.legacy_conversation_id = cm.conversation_id
    where cm.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (select 1 from public.users u where u.id = cm.user_id::uuid)
    on conflict (conversation_id, user_id) do nothing;
  end if;

  if to_regclass('public.chat_messages') is not null then
    insert into public.chat_v2_messages (
      conversation_id,
      sender_id,
      body,
      kind,
      legacy_message_id,
      metadata,
      edited_at,
      deleted_at,
      created_at,
      updated_at
    )
    select
      v2.id,
      m.sender_id::uuid,
      coalesce(m.content, ''),
      case when m.type = 'system' then 'system' else 'text' end,
      m.id,
      jsonb_build_object(
        'legacyType', m.type,
        'legacyAttachments', coalesce(m.attachments, '[]'::jsonb),
        'legacyFileUrls', coalesce(m.file_urls, '[]'::jsonb)
      ),
      m.edited_at,
      coalesce(m.recalled_at, m.deleted_at),
      coalesce(m.created_at, now()),
      coalesce(m.updated_at, m.created_at, now())
    from public.chat_messages m
    join public.chat_v2_conversations v2 on v2.legacy_conversation_id = m.conversation_id
    where m.sender_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (select 1 from public.users u where u.id = m.sender_id::uuid)
      and not exists (
        select 1
        from public.chat_v2_messages existing
        where existing.legacy_message_id = m.id
      );
  end if;

  insert into public.chat_v2_direct_pairs(user_low_id, user_high_id, conversation_id)
  select pair.user_ids[1], pair.user_ids[2], pair.conversation_id
  from (
    select
      c.id as conversation_id,
      array_agg(p.user_id order by p.user_id) as user_ids
    from public.chat_v2_conversations c
    join public.chat_v2_participants p on p.conversation_id = c.id and p.left_at is null
    where c.type = 'direct'
    group by c.id
    having count(distinct p.user_id) = 2
  ) pair
  on conflict do nothing;
end $$;

notify pgrst, 'reload schema';
