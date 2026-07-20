-- AI Learning Layer v1: durable chat IDs, reviewed feedback, approved context, and telemetry.

create extension if not exists pgcrypto with schema extensions;

-- Shared authorization helper for Settings > AI Learning.
create or replace function public.can_manage_ai_learning()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, true)
      and (
        u.role = 'ADMIN'
        or 'SETTINGS' = any(coalesce(u.admin_modules, '{}'::text[]))
        or (
          coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'SETTINGS'
          and coalesce(u.admin_sub_modules -> 'SETTINGS', '[]'::jsonb) ? '/settings/ai-learning'
        )
      )
  );
$$;

revoke all on function public.can_manage_ai_learning() from public;
grant execute on function public.can_manage_ai_learning() to authenticated;

-- Existing AI conversation/message tables.
alter table public.ai_conversations
  add column if not exists classified_domain text,
  add column if not exists model_used text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ai_messages
  add column if not exists tool_name text,
  add column if not exists response_time_ms integer,
  add column if not exists token_count integer,
  add column if not exists classified_domain text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists feedback_rating integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_messages_feedback_rating_check'
      and conrelid = 'public.ai_messages'::regclass
  ) then
    alter table public.ai_messages
      add constraint ai_messages_feedback_rating_check
      check (feedback_rating is null or feedback_rating in (-1, 1));
  end if;
end $$;

-- Feedback becomes the canonical reviewed learning source.
alter table public.ai_feedback
  add column if not exists ai_message_id uuid,
  add column if not exists feedback_type text not null default 'rating',
  add column if not exists correction_text text,
  add column if not exists approved_answer text,
  add column if not exists reason text,
  add column if not exists status text not null default 'pending',
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.ai_feedback f
set ai_message_id = m.id
from public.ai_messages m
where f.ai_message_id is null
  and f.message_id = m.id::text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_feedback_ai_message_id_fkey'
      and conrelid = 'public.ai_feedback'::regclass
  ) then
    alter table public.ai_feedback
      add constraint ai_feedback_ai_message_id_fkey
      foreign key (ai_message_id) references public.ai_messages(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_feedback_status_check'
      and conrelid = 'public.ai_feedback'::regclass
  ) then
    alter table public.ai_feedback
      add constraint ai_feedback_status_check
      check (status in ('pending', 'approved', 'rejected', 'archived'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_feedback_type_check'
      and conrelid = 'public.ai_feedback'::regclass
  ) then
    alter table public.ai_feedback
      add constraint ai_feedback_type_check
      check (feedback_type in ('rating', 'correction', 'approved_answer'));
  end if;
end $$;

-- Memory now supports reviewed user/domain/enterprise learning.
alter table public.ai_memory
  alter column user_id drop not null,
  add column if not exists scope text not null default 'user',
  add column if not exists status text not null default 'approved',
  add column if not exists domain text,
  add column if not exists source text not null default 'manual',
  add column if not exists source_message_id uuid,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_memory_scope_check'
      and conrelid = 'public.ai_memory'::regclass
  ) then
    alter table public.ai_memory
      add constraint ai_memory_scope_check
      check (scope in ('user', 'enterprise', 'domain'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_memory_status_check'
      and conrelid = 'public.ai_memory'::regclass
  ) then
    alter table public.ai_memory
      add constraint ai_memory_status_check
      check (status in ('pending', 'approved', 'rejected', 'archived'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_memory_user_scope_check'
      and conrelid = 'public.ai_memory'::regclass
  ) then
    alter table public.ai_memory
      add constraint ai_memory_user_scope_check
      check (scope <> 'user' or user_id is not null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_memory_source_message_id_fkey'
      and conrelid = 'public.ai_memory'::regclass
  ) then
    alter table public.ai_memory
      add constraint ai_memory_source_message_id_fkey
      foreign key (source_message_id) references public.ai_messages(id) on delete set null;
  end if;
end $$;

create table if not exists public.ai_business_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  domain text,
  priority integer not null default 50,
  status text not null default 'pending',
  source text not null default 'manual',
  created_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint ai_business_rules_status_check check (status in ('pending', 'approved', 'rejected', 'archived')),
  constraint ai_business_rules_priority_check check (priority between 0 and 100)
);

create table if not exists public.ai_business_glossary (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  definition text not null,
  aliases text[] not null default '{}'::text[],
  domain text,
  status text not null default 'pending',
  source text not null default 'manual',
  created_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint ai_business_glossary_status_check check (status in ('pending', 'approved', 'rejected', 'archived'))
);

create table if not exists public.ai_query_patterns (
  id uuid primary key default gen_random_uuid(),
  normalized_question text not null,
  question_sample text,
  mode text,
  classified_domain text,
  route_action text,
  tool_name text,
  sql_query text,
  answer_summary text,
  success_count integer not null default 1,
  failure_count integer not null default 0,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint ai_query_patterns_counts_check check (success_count >= 0 and failure_count >= 0)
);

create unique index if not exists ai_query_patterns_identity_idx
  on public.ai_query_patterns (normalized_question, coalesce(tool_name, ''), coalesce(mode, ''));

create table if not exists public.ai_user_preferences (
  user_id text primary key,
  tone text not null default 'balanced',
  response_length text not null default 'normal',
  show_data_sources boolean not null default true,
  prefer_tables boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint ai_user_preferences_tone_check check (tone in ('concise', 'balanced', 'friendly', 'executive')),
  constraint ai_user_preferences_response_length_check check (response_length in ('short', 'normal', 'detailed'))
);

create table if not exists public.ai_chat_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  user_id text,
  mode text,
  question text,
  classified_domain text,
  route_action text,
  tool_name text,
  model_used text,
  response_time_ms integer,
  token_count integer,
  status text not null default 'success',
  error_message text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint ai_chat_runs_status_check check (status in ('success', 'rejected', 'clarification', 'error'))
);

create index if not exists ai_conversations_user_updated_idx
  on public.ai_conversations (user_id, updated_at desc);
create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at);
create index if not exists ai_feedback_ai_message_id_idx
  on public.ai_feedback (ai_message_id);
create unique index if not exists ai_feedback_message_user_uidx
  on public.ai_feedback (message_id, user_id);
create index if not exists ai_feedback_status_created_idx
  on public.ai_feedback (status, created_at desc);
create index if not exists ai_memory_scope_status_idx
  on public.ai_memory (scope, status, domain);
create index if not exists ai_business_rules_status_domain_idx
  on public.ai_business_rules (status, domain, priority desc);
create index if not exists ai_business_glossary_status_domain_idx
  on public.ai_business_glossary (status, domain, term);
create index if not exists ai_chat_runs_user_created_idx
  on public.ai_chat_runs (user_id, created_at desc);
create index if not exists ai_chat_runs_conversation_idx
  on public.ai_chat_runs (conversation_id, created_at desc);

-- Data API grants. RLS below still controls rows.
grant select, insert, update, delete on table
  public.ai_conversations,
  public.ai_messages,
  public.ai_feedback,
  public.ai_memory,
  public.ai_business_rules,
  public.ai_business_glossary,
  public.ai_query_patterns,
  public.ai_user_preferences,
  public.ai_chat_runs
to authenticated;

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_feedback enable row level security;
alter table public.ai_memory enable row level security;
alter table public.ai_business_rules enable row level security;
alter table public.ai_business_glossary enable row level security;
alter table public.ai_query_patterns enable row level security;
alter table public.ai_user_preferences enable row level security;
alter table public.ai_chat_runs enable row level security;

-- Replace legacy broad AI policies with owner/admin policies.
drop policy if exists "Allow all for ai_conversations" on public.ai_conversations;
drop policy if exists "Allow all for ai_messages" on public.ai_messages;
drop policy if exists ai_feedback_all on public.ai_feedback;
drop policy if exists ai_memory_select on public.ai_memory;
drop policy if exists ai_memory_insert on public.ai_memory;
drop policy if exists ai_memory_update on public.ai_memory;
drop policy if exists ai_memory_delete on public.ai_memory;
drop policy if exists ai_conversations_select on public.ai_conversations;
drop policy if exists ai_conversations_insert on public.ai_conversations;
drop policy if exists ai_conversations_update on public.ai_conversations;
drop policy if exists ai_conversations_delete on public.ai_conversations;
drop policy if exists ai_messages_select on public.ai_messages;
drop policy if exists ai_messages_insert on public.ai_messages;
drop policy if exists ai_messages_update on public.ai_messages;
drop policy if exists ai_feedback_select on public.ai_feedback;
drop policy if exists ai_feedback_insert on public.ai_feedback;
drop policy if exists ai_feedback_update on public.ai_feedback;
drop policy if exists ai_feedback_delete on public.ai_feedback;
drop policy if exists ai_business_rules_select on public.ai_business_rules;
drop policy if exists ai_business_rules_manage on public.ai_business_rules;
drop policy if exists ai_business_glossary_select on public.ai_business_glossary;
drop policy if exists ai_business_glossary_manage on public.ai_business_glossary;
drop policy if exists ai_query_patterns_select on public.ai_query_patterns;
drop policy if exists ai_query_patterns_manage on public.ai_query_patterns;
drop policy if exists ai_user_preferences_select on public.ai_user_preferences;
drop policy if exists ai_user_preferences_insert on public.ai_user_preferences;
drop policy if exists ai_user_preferences_update on public.ai_user_preferences;
drop policy if exists ai_chat_runs_select on public.ai_chat_runs;
drop policy if exists ai_chat_runs_insert on public.ai_chat_runs;

create policy ai_conversations_select on public.ai_conversations
  for select to authenticated
  using (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_conversations_insert on public.ai_conversations
  for insert to authenticated
  with check (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_conversations_update on public.ai_conversations
  for update to authenticated
  using (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text)
  with check (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_conversations_delete on public.ai_conversations
  for delete to authenticated
  using (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_messages_select on public.ai_messages
  for select to authenticated
  using (
    public.can_manage_ai_learning()
    or exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = public.current_app_user_id()::text
    )
  );

create policy ai_messages_insert on public.ai_messages
  for insert to authenticated
  with check (
    public.can_manage_ai_learning()
    or exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = public.current_app_user_id()::text
    )
  );

create policy ai_messages_update on public.ai_messages
  for update to authenticated
  using (
    public.can_manage_ai_learning()
    or exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = public.current_app_user_id()::text
    )
  )
  with check (
    public.can_manage_ai_learning()
    or exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = public.current_app_user_id()::text
    )
  );

create policy ai_feedback_select on public.ai_feedback
  for select to authenticated
  using (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_feedback_insert on public.ai_feedback
  for insert to authenticated
  with check (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_feedback_update on public.ai_feedback
  for update to authenticated
  using (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text)
  with check (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_feedback_delete on public.ai_feedback
  for delete to authenticated
  using (public.can_manage_ai_learning());

create policy ai_memory_select on public.ai_memory
  for select to authenticated
  using (
    public.can_manage_ai_learning()
    or user_id = public.current_app_user_id()::text
    or (status = 'approved' and scope in ('enterprise', 'domain'))
  );

create policy ai_memory_insert on public.ai_memory
  for insert to authenticated
  with check (
    public.can_manage_ai_learning()
    or (scope = 'user' and user_id = public.current_app_user_id()::text)
  );

create policy ai_memory_update on public.ai_memory
  for update to authenticated
  using (public.can_manage_ai_learning() or (scope = 'user' and user_id = public.current_app_user_id()::text and status = 'pending'))
  with check (public.can_manage_ai_learning() or (scope = 'user' and user_id = public.current_app_user_id()::text and status = 'pending'));

create policy ai_memory_delete on public.ai_memory
  for delete to authenticated
  using (public.can_manage_ai_learning() or (scope = 'user' and user_id = public.current_app_user_id()::text and status = 'pending'));

create policy ai_business_rules_select on public.ai_business_rules
  for select to authenticated
  using (public.can_manage_ai_learning() or status = 'approved');

create policy ai_business_rules_manage on public.ai_business_rules
  for all to authenticated
  using (public.can_manage_ai_learning())
  with check (public.can_manage_ai_learning());

create policy ai_business_glossary_select on public.ai_business_glossary
  for select to authenticated
  using (public.can_manage_ai_learning() or status = 'approved');

create policy ai_business_glossary_manage on public.ai_business_glossary
  for all to authenticated
  using (public.can_manage_ai_learning())
  with check (public.can_manage_ai_learning());

create policy ai_query_patterns_select on public.ai_query_patterns
  for select to authenticated
  using (public.can_manage_ai_learning());

create policy ai_query_patterns_manage on public.ai_query_patterns
  for all to authenticated
  using (public.can_manage_ai_learning())
  with check (public.can_manage_ai_learning());

create policy ai_user_preferences_select on public.ai_user_preferences
  for select to authenticated
  using (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_user_preferences_insert on public.ai_user_preferences
  for insert to authenticated
  with check (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_user_preferences_update on public.ai_user_preferences
  for update to authenticated
  using (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text)
  with check (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_chat_runs_select on public.ai_chat_runs
  for select to authenticated
  using (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

create policy ai_chat_runs_insert on public.ai_chat_runs
  for insert to authenticated
  with check (public.can_manage_ai_learning() or user_id = public.current_app_user_id()::text);

-- Realtime publication for admin review surfaces.
do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'ai_feedback',
      'ai_memory',
      'ai_business_rules',
      'ai_business_glossary',
      'ai_chat_runs'
    ]
    loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      exception
        when duplicate_object then null;
        when undefined_object then null;
      end;
    end loop;
  end if;
end $$;
