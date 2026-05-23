-- Chat core V1
-- Purpose: make the existing chat UI backed by durable lifecycle/settings/call tables.
-- Safe to run on a cloud database where the four base chat tables already exist.

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type in ('direct', 'group')),
  name text,
  avatar_url text,
  created_by text,
  created_at timestamptz default now()
);

create table if not exists public.chat_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  last_read_at timestamptz default now(),
  joined_at timestamptz default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id text not null,
  content text,
  type text not null default 'text' check (type in ('text', 'image', 'file', 'system')),
  attachments jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  reactions jsonb default '{}'::jsonb,
  reply_to_id uuid references public.chat_messages(id) on delete set null,
  reply_to_preview jsonb,
  file_urls jsonb default '[]'::jsonb
);

create table if not exists public.chat_pins (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  pinned_by uuid not null references public.users(id),
  pinned_at timestamptz default now()
);

alter table public.chat_conversations
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id);

alter table public.chat_members
  add column if not exists left_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.users(id);

alter table public.chat_messages
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id);

create table if not exists public.chat_user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  theme text not null default 'discord' check (theme in ('discord', 'light', 'rose', 'cyberpunk')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  started_by uuid not null references public.users(id),
  mode text not null check (mode in ('audio', 'video')),
  status text not null default 'active' check (status in ('ringing', 'active', 'ended', 'missed', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.users(id),
  duration_seconds integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_call_participants (
  id uuid primary key default gen_random_uuid(),
  call_session_id uuid not null references public.chat_call_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'joined' check (status in ('invited', 'joined', 'left', 'declined', 'missed')),
  joined_at timestamptz,
  left_at timestamptz,
  is_muted boolean not null default false,
  is_deafened boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (call_session_id, user_id)
);

create index if not exists idx_chat_members_user_id on public.chat_members(user_id);
create index if not exists idx_chat_members_conversation_id on public.chat_members(conversation_id);
create index if not exists idx_chat_messages_conversation_created on public.chat_messages(conversation_id, created_at desc);
create index if not exists idx_chat_pins_conversation_id on public.chat_pins(conversation_id);
create index if not exists idx_chat_call_sessions_conversation_status on public.chat_call_sessions(conversation_id, status, started_at desc);
create index if not exists idx_chat_call_participants_user on public.chat_call_participants(user_id);

drop trigger if exists trg_chat_conversations_updated_at on public.chat_conversations;
create trigger trg_chat_conversations_updated_at
  before update on public.chat_conversations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_chat_messages_updated_at on public.chat_messages;
create trigger trg_chat_messages_updated_at
  before update on public.chat_messages
  for each row execute function public.set_updated_at();

drop trigger if exists trg_chat_user_settings_updated_at on public.chat_user_settings;
create trigger trg_chat_user_settings_updated_at
  before update on public.chat_user_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_chat_call_sessions_updated_at on public.chat_call_sessions;
create trigger trg_chat_call_sessions_updated_at
  before update on public.chat_call_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_chat_call_participants_updated_at on public.chat_call_participants;
create trigger trg_chat_call_participants_updated_at
  before update on public.chat_call_participants
  for each row execute function public.set_updated_at();

alter table public.chat_user_settings enable row level security;
alter table public.chat_call_sessions enable row level security;
alter table public.chat_call_participants enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_user_settings' and policyname = 'chat_user_settings_owner_access'
  ) then
    create policy chat_user_settings_owner_access
      on public.chat_user_settings
      for all
      to authenticated
      using (user_id = public.current_app_user_id() or public.is_admin())
      with check (user_id = public.current_app_user_id() or public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_call_sessions' and policyname = 'chat_call_sessions_member_access'
  ) then
    create policy chat_call_sessions_member_access
      on public.chat_call_sessions
      for all
      to authenticated
      using (
        public.is_admin()
        or exists (
          select 1
          from public.chat_members cm
          where cm.conversation_id = chat_call_sessions.conversation_id
            and cm.user_id = public.current_app_user_id()::text
            and cm.left_at is null
        )
      )
      with check (
        public.is_admin()
        or exists (
          select 1
          from public.chat_members cm
          where cm.conversation_id = chat_call_sessions.conversation_id
            and cm.user_id = public.current_app_user_id()::text
            and cm.left_at is null
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_call_participants' and policyname = 'chat_call_participants_member_access'
  ) then
    create policy chat_call_participants_member_access
      on public.chat_call_participants
      for all
      to authenticated
      using (
        public.is_admin()
        or user_id = public.current_app_user_id()
        or exists (
          select 1
          from public.chat_call_sessions ccs
          join public.chat_members cm on cm.conversation_id = ccs.conversation_id
          where ccs.id = chat_call_participants.call_session_id
            and cm.user_id = public.current_app_user_id()::text
            and cm.left_at is null
        )
      )
      with check (
        public.is_admin()
        or user_id = public.current_app_user_id()
        or exists (
          select 1
          from public.chat_call_sessions ccs
          join public.chat_members cm on cm.conversation_id = ccs.conversation_id
          where ccs.id = chat_call_participants.call_session_id
            and cm.user_id = public.current_app_user_id()::text
            and cm.left_at is null
        )
      );
  end if;
end $$;

grant select, insert, update, delete on public.chat_user_settings to authenticated;
grant select, insert, update, delete on public.chat_call_sessions to authenticated;
grant select, insert, update, delete on public.chat_call_participants to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_conversations'
    ) then
      alter publication supabase_realtime add table public.chat_conversations;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_members'
    ) then
      alter publication supabase_realtime add table public.chat_members;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
    ) then
      alter publication supabase_realtime add table public.chat_messages;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_pins'
    ) then
      alter publication supabase_realtime add table public.chat_pins;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_call_sessions'
    ) then
      alter publication supabase_realtime add table public.chat_call_sessions;
    end if;
  end if;
end $$;
