-- Feedback Hub V3: internal operations hub, watchers, roadmap/SLA fields, realtime.

alter table public.feedback_items
  add column if not exists due_at timestamptz,
  add column if not exists target_release text,
  add column if not exists roadmap_stage text,
  add column if not exists closed_by uuid references public.users(id) on delete set null,
  add column if not exists tags text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.feedback_items'::regclass
      and conname = 'feedback_items_roadmap_stage_check'
  ) then
    alter table public.feedback_items
      add constraint feedback_items_roadmap_stage_check
      check (roadmap_stage is null or roadmap_stage in ('planned', 'in_progress', 'testing', 'done'));
  end if;
end $$;

create table if not exists public.feedback_watchers (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_items(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(feedback_id, user_id)
);

create index if not exists idx_feedback_items_due_status
  on public.feedback_items(due_at, status)
  where due_at is not null and status not in ('done', 'rejected');

create index if not exists idx_feedback_items_roadmap_stage
  on public.feedback_items(roadmap_stage, priority, last_activity_at desc)
  where roadmap_stage is not null;

create index if not exists idx_feedback_items_tags
  on public.feedback_items using gin(tags);

create index if not exists idx_feedback_watchers_feedback
  on public.feedback_watchers(feedback_id, created_at desc);

create index if not exists idx_feedback_watchers_user
  on public.feedback_watchers(user_id, created_at desc);

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
        or fi.assigned_to = public.current_app_user_id()
        or fi.visibility = 'public'
        or exists (
          select 1
          from public.feedback_watchers fw
          where fw.feedback_id = fi.id
            and fw.user_id = public.current_app_user_id()
        )
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

  if new.status in ('done', 'rejected') then
    new.closed_by := coalesce(new.closed_by, public.current_app_user_id());
    if new.roadmap_stage is null and new.status = 'done' then
      new.roadmap_stage := 'done';
    end if;
  else
    new.closed_by := null;
  end if;

  return new;
end;
$$;

create or replace function app_private.ensure_feedback_watchers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.feedback_watchers(feedback_id, user_id, created_by)
  values (new.id, new.created_by, new.created_by)
  on conflict (feedback_id, user_id) do nothing;

  if new.assigned_to is not null then
    insert into public.feedback_watchers(feedback_id, user_id, created_by)
    values (new.id, new.assigned_to, public.current_app_user_id())
    on conflict (feedback_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function app_private.ensure_feedback_watchers() from public;

drop trigger if exists trg_feedback_items_ensure_watchers on public.feedback_items;
create trigger trg_feedback_items_ensure_watchers
after insert or update of assigned_to on public.feedback_items
for each row execute function app_private.ensure_feedback_watchers();

alter table public.feedback_watchers enable row level security;

drop policy if exists feedback_items_select on public.feedback_items;
create policy feedback_items_select
on public.feedback_items
for select
to authenticated
using (app_private.feedback_item_can_select(id));

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
  and closed_by is null
  and due_at is null
  and target_release is null
  and roadmap_stage is null
  and coalesce(array_length(tags, 1), 0) = 0
  and visibility in ('public', 'private')
);

drop policy if exists feedback_watchers_select on public.feedback_watchers;
create policy feedback_watchers_select
on public.feedback_watchers
for select
to authenticated
using (app_private.feedback_item_can_select(feedback_id));

drop policy if exists feedback_watchers_insert on public.feedback_watchers;
create policy feedback_watchers_insert
on public.feedback_watchers
for insert
to authenticated
with check (
  (
    user_id = (select public.current_app_user_id())
    and created_by = (select public.current_app_user_id())
    and app_private.feedback_item_can_select(feedback_id)
  )
  or (select app_private.feedback_can_manage())
);

drop policy if exists feedback_watchers_delete on public.feedback_watchers;
create policy feedback_watchers_delete
on public.feedback_watchers
for delete
to authenticated
using (
  user_id = (select public.current_app_user_id())
  or (select app_private.feedback_can_manage())
);

revoke all on table public.feedback_watchers from anon;
revoke all on table public.feedback_watchers from public;
revoke all on table public.feedback_watchers from authenticated;
grant select, insert, delete on table public.feedback_watchers to authenticated;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array[
      'feedback_votes',
      'feedback_checklist',
      'feedback_attachments',
      'feedback_status_logs',
      'feedback_watchers'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
exception
  when undefined_object then
    null;
end $$;

notify pgrst, 'reload schema';
