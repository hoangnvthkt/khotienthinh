-- Feedback Hub V1: internal feedback forum + lightweight issue tracker.

create schema if not exists app_private;

create or replace function app_private.feedback_can_manage()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.is_module_admin('FEEDBACK');
$$;

revoke all on function app_private.feedback_can_manage() from public;
grant execute on function app_private.feedback_can_manage() to authenticated;

create table if not exists public.feedback_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 3 and 200),
  description text not null check (length(trim(description)) between 3 and 8000),
  type text not null default 'other'
    check (type in ('bug', 'ui', 'feature', 'workflow', 'performance', 'permission', 'data', 'other')),
  module text not null default 'other'
    check (module in ('material', 'boq', 'warehouse', 'project', 'dashboard', 'acceptance', 'cost_library', 'auth', 'mobile', 'other')),
  impact_level text not null default 'medium'
    check (impact_level in ('low', 'medium', 'high', 'urgent')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'new'
    check (status in ('new', 'received', 'need_clarification', 'planned', 'in_progress', 'testing', 'done', 'rejected')),
  visibility text not null default 'public'
    check (visibility in ('public', 'private', 'internal')),
  created_by uuid not null references public.users(id) on delete cascade,
  assigned_to uuid references public.users(id) on delete set null,
  related_route text,
  device_info jsonb not null default '{}'::jsonb,
  app_version text,
  rejected_reason text,
  metadata jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.feedback_comments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_items(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  is_internal boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_items(id) on delete cascade,
  comment_id uuid references public.feedback_comments(id) on delete cascade,
  uploaded_by uuid not null references public.users(id) on delete cascade,
  storage_bucket text not null default 'feedback-attachments',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (file_size is null or file_size >= 0)
);

create table if not exists public.feedback_votes (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_items(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(feedback_id, user_id)
);

create table if not exists public.feedback_checklist (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_items(id) on delete cascade,
  title text not null check (length(trim(title)) > 0 and length(title) <= 300),
  is_done boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  done_by uuid references public.users(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback_status_logs (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_items(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references public.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (old_status is null or old_status in ('new', 'received', 'need_clarification', 'planned', 'in_progress', 'testing', 'done', 'rejected')),
  check (new_status in ('new', 'received', 'need_clarification', 'planned', 'in_progress', 'testing', 'done', 'rejected'))
);

create index if not exists idx_feedback_items_created_by_created
  on public.feedback_items(created_by, created_at desc);

create index if not exists idx_feedback_items_status_created
  on public.feedback_items(status, created_at desc);

create index if not exists idx_feedback_items_module_status_created
  on public.feedback_items(module, status, created_at desc);

create index if not exists idx_feedback_items_open_activity
  on public.feedback_items(last_activity_at desc)
  where status not in ('done', 'rejected');

create index if not exists idx_feedback_comments_feedback_created
  on public.feedback_comments(feedback_id, created_at asc);

create index if not exists idx_feedback_comments_author_created
  on public.feedback_comments(author_user_id, created_at desc);

create index if not exists idx_feedback_attachments_feedback
  on public.feedback_attachments(feedback_id, created_at desc);

create index if not exists idx_feedback_attachments_comment
  on public.feedback_attachments(comment_id)
  where comment_id is not null;

create index if not exists idx_feedback_votes_user
  on public.feedback_votes(user_id, created_at desc);

create index if not exists idx_feedback_checklist_feedback_order
  on public.feedback_checklist(feedback_id, sort_order, created_at);

create index if not exists idx_feedback_status_logs_feedback_created
  on public.feedback_status_logs(feedback_id, created_at desc);

create or replace function app_private.feedback_item_can_select(p_feedback_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.feedback_items fi
    where fi.id = p_feedback_id
      and (
        app_private.feedback_can_manage()
        or fi.created_by = public.current_app_user_id()
        or fi.visibility = 'public'
      )
  );
$$;

revoke all on function app_private.feedback_item_can_select(uuid) from public;
grant execute on function app_private.feedback_item_can_select(uuid) to authenticated;

create or replace function app_private.prepare_feedback_item_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.last_activity_at := now();

  if old.completed_at is not null then
    new.completed_at := old.completed_at;
  elsif old.status is distinct from 'done' and new.status = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  if new.status is distinct from 'rejected' then
    new.rejected_reason := null;
  end if;

  return new;
end;
$$;

create or replace function app_private.log_feedback_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.feedback_status_logs(
      feedback_id,
      old_status,
      new_status,
      changed_by,
      reason,
      metadata
    )
    values (
      new.id,
      old.status,
      new.status,
      public.current_app_user_id(),
      case when new.status = 'rejected' then new.rejected_reason else null end,
      jsonb_build_object(
        'priority', new.priority,
        'assignedTo', new.assigned_to
      )
    );
  end if;

  return new;
end;
$$;

create or replace function app_private.touch_feedback_item_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feedback_id uuid;
begin
  v_feedback_id := case when tg_op = 'DELETE' then old.feedback_id else new.feedback_id end;

  update public.feedback_items
  set last_activity_at = now(),
      updated_at = now()
  where id = v_feedback_id;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_feedback_items_prepare_update on public.feedback_items;
create trigger trg_feedback_items_prepare_update
before update on public.feedback_items
for each row execute function app_private.prepare_feedback_item_update();

drop trigger if exists trg_feedback_items_status_log on public.feedback_items;
create trigger trg_feedback_items_status_log
after update on public.feedback_items
for each row execute function app_private.log_feedback_status_change();

drop trigger if exists trg_feedback_comments_updated_at on public.feedback_comments;
create trigger trg_feedback_comments_updated_at
before update on public.feedback_comments
for each row execute function public.set_updated_at();

drop trigger if exists trg_feedback_comments_touch_item on public.feedback_comments;
create trigger trg_feedback_comments_touch_item
after insert or update or delete on public.feedback_comments
for each row execute function app_private.touch_feedback_item_activity();

drop trigger if exists trg_feedback_votes_touch_item on public.feedback_votes;
create trigger trg_feedback_votes_touch_item
after insert or delete on public.feedback_votes
for each row execute function app_private.touch_feedback_item_activity();

drop trigger if exists trg_feedback_checklist_updated_at on public.feedback_checklist;
create trigger trg_feedback_checklist_updated_at
before update on public.feedback_checklist
for each row execute function public.set_updated_at();

drop trigger if exists trg_feedback_checklist_touch_item on public.feedback_checklist;
create trigger trg_feedback_checklist_touch_item
after insert or update or delete on public.feedback_checklist
for each row execute function app_private.touch_feedback_item_activity();

revoke all on function app_private.prepare_feedback_item_update() from public;
revoke all on function app_private.log_feedback_status_change() from public;
revoke all on function app_private.touch_feedback_item_activity() from public;

alter table public.feedback_items enable row level security;
alter table public.feedback_comments enable row level security;
alter table public.feedback_attachments enable row level security;
alter table public.feedback_votes enable row level security;
alter table public.feedback_checklist enable row level security;
alter table public.feedback_status_logs enable row level security;

drop policy if exists feedback_items_select on public.feedback_items;
create policy feedback_items_select
on public.feedback_items
for select
to authenticated
using (
  (select app_private.feedback_can_manage())
  or created_by = (select public.current_app_user_id())
  or visibility = 'public'
);

drop policy if exists feedback_items_insert on public.feedback_items;
create policy feedback_items_insert
on public.feedback_items
for insert
to authenticated
with check (
  created_by = (select public.current_app_user_id())
  and status = 'new'
  and priority = 'medium'
  and assigned_to is null
  and rejected_reason is null
  and completed_at is null
  and visibility in ('public', 'private')
);

drop policy if exists feedback_items_update on public.feedback_items;
create policy feedback_items_update
on public.feedback_items
for update
to authenticated
using ((select app_private.feedback_can_manage()))
with check ((select app_private.feedback_can_manage()));

drop policy if exists feedback_comments_select on public.feedback_comments;
create policy feedback_comments_select
on public.feedback_comments
for select
to authenticated
using (
  app_private.feedback_item_can_select(feedback_id)
  and (
    is_internal = false
    or (select app_private.feedback_can_manage())
  )
);

drop policy if exists feedback_comments_insert on public.feedback_comments;
create policy feedback_comments_insert
on public.feedback_comments
for insert
to authenticated
with check (
  author_user_id = (select public.current_app_user_id())
  and app_private.feedback_item_can_select(feedback_id)
  and (
    is_internal = false
    or (select app_private.feedback_can_manage())
  )
);

drop policy if exists feedback_attachments_select on public.feedback_attachments;
create policy feedback_attachments_select
on public.feedback_attachments
for select
to authenticated
using (app_private.feedback_item_can_select(feedback_id));

drop policy if exists feedback_attachments_insert on public.feedback_attachments;
create policy feedback_attachments_insert
on public.feedback_attachments
for insert
to authenticated
with check (
  uploaded_by = (select public.current_app_user_id())
  and app_private.feedback_item_can_select(feedback_id)
);

drop policy if exists feedback_attachments_delete on public.feedback_attachments;
create policy feedback_attachments_delete
on public.feedback_attachments
for delete
to authenticated
using (
  uploaded_by = (select public.current_app_user_id())
  or (select app_private.feedback_can_manage())
);

drop policy if exists feedback_votes_select on public.feedback_votes;
create policy feedback_votes_select
on public.feedback_votes
for select
to authenticated
using (app_private.feedback_item_can_select(feedback_id));

drop policy if exists feedback_votes_insert on public.feedback_votes;
create policy feedback_votes_insert
on public.feedback_votes
for insert
to authenticated
with check (
  user_id = (select public.current_app_user_id())
  and app_private.feedback_item_can_select(feedback_id)
);

drop policy if exists feedback_votes_delete on public.feedback_votes;
create policy feedback_votes_delete
on public.feedback_votes
for delete
to authenticated
using (user_id = (select public.current_app_user_id()));

drop policy if exists feedback_checklist_select on public.feedback_checklist;
create policy feedback_checklist_select
on public.feedback_checklist
for select
to authenticated
using (app_private.feedback_item_can_select(feedback_id));

drop policy if exists feedback_checklist_insert on public.feedback_checklist;
create policy feedback_checklist_insert
on public.feedback_checklist
for insert
to authenticated
with check (
  (select app_private.feedback_can_manage())
  and app_private.feedback_item_can_select(feedback_id)
);

drop policy if exists feedback_checklist_update on public.feedback_checklist;
create policy feedback_checklist_update
on public.feedback_checklist
for update
to authenticated
using ((select app_private.feedback_can_manage()))
with check ((select app_private.feedback_can_manage()));

drop policy if exists feedback_checklist_delete on public.feedback_checklist;
create policy feedback_checklist_delete
on public.feedback_checklist
for delete
to authenticated
using ((select app_private.feedback_can_manage()));

drop policy if exists feedback_status_logs_select on public.feedback_status_logs;
create policy feedback_status_logs_select
on public.feedback_status_logs
for select
to authenticated
using (app_private.feedback_item_can_select(feedback_id));

revoke all on table public.feedback_items from anon;
revoke all on table public.feedback_items from public;
revoke all on table public.feedback_items from authenticated;
grant select, insert, update on table public.feedback_items to authenticated;

revoke all on table public.feedback_comments from anon;
revoke all on table public.feedback_comments from public;
revoke all on table public.feedback_comments from authenticated;
grant select, insert on table public.feedback_comments to authenticated;

revoke all on table public.feedback_attachments from anon;
revoke all on table public.feedback_attachments from public;
revoke all on table public.feedback_attachments from authenticated;
grant select, insert, delete on table public.feedback_attachments to authenticated;

revoke all on table public.feedback_votes from anon;
revoke all on table public.feedback_votes from public;
revoke all on table public.feedback_votes from authenticated;
grant select, insert, delete on table public.feedback_votes to authenticated;

revoke all on table public.feedback_checklist from anon;
revoke all on table public.feedback_checklist from public;
revoke all on table public.feedback_checklist from authenticated;
grant select, insert, update, delete on table public.feedback_checklist to authenticated;

revoke all on table public.feedback_status_logs from anon;
revoke all on table public.feedback_status_logs from public;
revoke all on table public.feedback_status_logs from authenticated;
grant select on table public.feedback_status_logs to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'feedback_items'
    ) then
      alter publication supabase_realtime add table public.feedback_items;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'feedback_comments'
    ) then
      alter publication supabase_realtime add table public.feedback_comments;
    end if;
  end if;
exception
  when undefined_object then
    null;
end $$;

notify pgrst, 'reload schema';
