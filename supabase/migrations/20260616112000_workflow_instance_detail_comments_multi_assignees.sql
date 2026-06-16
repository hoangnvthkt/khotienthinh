-- Generic workflow detail comments and multi-assignee transition support.
-- This migration only adds client-facing infrastructure. It does not update
-- workflow template/node/edge/binding rows, including the material request workflow.

insert into storage.buckets (id, name, public, file_size_limit)
values ('workflow-instance-comment-attachments', 'workflow-instance-comment-attachments', false, 26214400)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create table if not exists public.workflow_instance_comments (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_instance_comments_content_check check (
    case
      when jsonb_typeof(attachments) = 'array' then
        jsonb_array_length(attachments) <= 5
        and length(body) <= 4000
        and (
          length(trim(body)) > 0
          or jsonb_array_length(attachments) > 0
        )
      else false
    end
    )
);

create index if not exists idx_workflow_instance_comments_instance_created
  on public.workflow_instance_comments(instance_id, created_at);

create index if not exists idx_workflow_instance_comments_author_created
  on public.workflow_instance_comments(author_user_id, created_at desc);

drop trigger if exists trg_workflow_instance_comments_updated_at on public.workflow_instance_comments;
create trigger trg_workflow_instance_comments_updated_at
  before update on public.workflow_instance_comments
  for each row execute function public.set_updated_at();

alter table public.workflow_instance_comments enable row level security;

create or replace function app_private.workflow_instance_actor_can_select(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_instances wi
    where wi.id = p_instance_id
      and app_private.project_workflow_instance_can_select(wi.id)
  );
$$;

drop policy if exists workflow_instance_comments_select on public.workflow_instance_comments;
create policy workflow_instance_comments_select
  on public.workflow_instance_comments
  for select
  to authenticated
  using (app_private.workflow_instance_actor_can_select(instance_id));

drop policy if exists workflow_instance_comments_insert on public.workflow_instance_comments;
create policy workflow_instance_comments_insert
  on public.workflow_instance_comments
  for insert
  to authenticated
  with check (
    author_user_id = public.current_app_user_id()
    and app_private.workflow_instance_actor_can_select(instance_id)
  );

drop policy if exists workflow_instance_comments_update on public.workflow_instance_comments;
create policy workflow_instance_comments_update
  on public.workflow_instance_comments
  for update
  to authenticated
  using (
    author_user_id = public.current_app_user_id()
    and app_private.workflow_instance_actor_can_select(instance_id)
  )
  with check (
    author_user_id = public.current_app_user_id()
    and app_private.workflow_instance_actor_can_select(instance_id)
  );

revoke all on table public.workflow_instance_comments from anon;
revoke all on table public.workflow_instance_comments from public;
revoke all on table public.workflow_instance_comments from authenticated;
grant select, insert, update on table public.workflow_instance_comments to authenticated;

drop policy if exists "workflow_instance_comment_attachments_select" on storage.objects;
create policy "workflow_instance_comment_attachments_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'workflow-instance-comment-attachments'
  and split_part(name, '/', 1) = 'workflow-instances'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and app_private.workflow_instance_actor_can_select(split_part(name, '/', 2)::uuid)
);

drop policy if exists "workflow_instance_comment_attachments_insert" on storage.objects;
create policy "workflow_instance_comment_attachments_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'workflow-instance-comment-attachments'
  and split_part(name, '/', 1) = 'workflow-instances'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and app_private.workflow_instance_actor_can_select(split_part(name, '/', 2)::uuid)
);

drop policy if exists "workflow_instance_comment_attachments_delete" on storage.objects;
create policy "workflow_instance_comment_attachments_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'workflow-instance-comment-attachments'
  and split_part(name, '/', 1) = 'workflow-instances'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and app_private.workflow_instance_actor_can_select(split_part(name, '/', 2)::uuid)
);

create or replace function app_private.workflow_assignee_json(
  p_node_id uuid,
  p_assignee_user_ids uuid[]
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_node_id is null
      or p_assignee_user_ids is null
      or cardinality(p_assignee_user_ids) = 0
    then '{}'::jsonb
    else jsonb_build_object(
      p_node_id::text,
      to_jsonb(array(
        select distinct assignee.assignee_id::text
        from unnest(p_assignee_user_ids) as assignee(assignee_id)
        where assignee.assignee_id is not null
      ))
    )
  end;
$$;

create or replace function public.process_workflow_instance_fast(
  p_instance_id uuid,
  p_action public.workflow_instance_action,
  p_user_id uuid,
  p_comment text,
  p_next_assignee_user_ids uuid[]
)
returns table (
  id uuid,
  template_id uuid,
  code text,
  title text,
  created_by uuid,
  current_node_id uuid,
  status public.workflow_instance_status,
  watchers text[],
  step_assignees jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst public.workflow_instances%rowtype;
  v_current_user uuid := public.current_app_user_id();
  v_actor public.users%rowtype;
  v_template public.workflow_templates%rowtype;
  v_current_node public.workflow_nodes%rowtype;
  v_next_node_id uuid;
  v_next_node_type public.workflow_node_type;
  v_prev_node_id uuid;
  v_prev_node_type public.workflow_node_type;
  v_start_node_id uuid;
  v_first_task_node_id uuid;
  v_can_act boolean := false;
  v_next_assignee_ids uuid[] := coalesce(
    array(
      select distinct assignee.assignee_id
      from unnest(coalesce(p_next_assignee_user_ids, '{}'::uuid[])) as assignee(assignee_id)
      where assignee.assignee_id is not null
    ),
    '{}'::uuid[]
  );
begin
  if v_current_user is null then
    raise exception 'authentication required';
  end if;

  if p_user_id is distinct from v_current_user and not public.is_module_admin('WF') then
    raise exception 'cannot act as another user';
  end if;

  select u.* into v_actor
  from public.users u
  where u.id = p_user_id;

  select wi.* into v_inst
  from public.workflow_instances wi
  where wi.id = p_instance_id
  for update;

  if not found then
    raise exception 'workflow instance not found: %', p_instance_id;
  end if;

  if v_inst.status <> 'RUNNING'::public.workflow_instance_status then
    raise exception 'workflow instance is not running';
  end if;

  if v_inst.current_node_id is null then
    raise exception 'workflow instance has no current node';
  end if;

  select wn.* into v_current_node
  from public.workflow_nodes wn
  where wn.id = v_inst.current_node_id;

  if not found then
    raise exception 'workflow current node not found: %', v_inst.current_node_id;
  end if;

  select wt.* into v_template
  from public.workflow_templates wt
  where wt.id = v_inst.template_id;

  if not found then
    raise exception 'workflow template not found: %', v_inst.template_id;
  end if;

  select n.id into v_start_node_id
  from public.workflow_nodes n
  where n.template_id = v_inst.template_id
    and n.type = 'START'::public.workflow_node_type
  limit 1;

  select e.target_node_id into v_first_task_node_id
  from public.workflow_edges e
  where e.source_node_id = v_start_node_id
  limit 1;

  v_can_act :=
    public.is_module_admin('WF')
    or coalesce(v_inst.step_assignees ->> v_inst.current_node_id::text, '') = p_user_id::text
    or (
      jsonb_typeof(v_inst.step_assignees -> v_inst.current_node_id::text) = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(v_inst.step_assignees -> v_inst.current_node_id::text) assignee(user_id)
        where assignee.user_id = p_user_id::text
      )
    )
    or coalesce(v_current_node.config ->> 'assigneeUserId', '') = p_user_id::text
    or (
      v_actor.id is not null
      and coalesce(v_current_node.config ->> 'assigneeRole', '') = v_actor.role::text
    )
    or p_user_id::text = any(coalesce(v_template.managers, '{}'::text[]))
    or (
      v_inst.created_by = p_user_id
      and v_inst.current_node_id = v_first_task_node_id
      and exists (
        select 1
        from public.workflow_instance_logs wil
        where wil.instance_id = p_instance_id
          and wil.action = 'REVISION_REQUESTED'::public.workflow_instance_action
      )
    );

  if not v_can_act then
    raise exception 'user is not allowed to process current workflow step';
  end if;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (p_instance_id, v_inst.current_node_id, p_action, p_user_id, coalesce(p_comment, ''));

  if p_action = 'APPROVED'::public.workflow_instance_action then
    select e.target_node_id, n.type
      into v_next_node_id, v_next_node_type
    from public.workflow_edges e
    join public.workflow_nodes n on n.id = e.target_node_id
    where e.source_node_id = v_inst.current_node_id
    limit 1;

    if v_next_node_id is null then
      raise exception 'no next workflow node found';
    end if;

    update public.workflow_instances wi
    set current_node_id = v_next_node_id,
        status = case
          when v_next_node_type = 'END'::public.workflow_node_type
          then 'COMPLETED'::public.workflow_instance_status
          else wi.status
        end,
        step_assignees = case
          when v_next_node_type <> 'END'::public.workflow_node_type and cardinality(v_next_assignee_ids) > 0
          then coalesce(wi.step_assignees, '{}'::jsonb) || app_private.workflow_assignee_json(v_next_node_id, v_next_assignee_ids)
          else coalesce(wi.step_assignees, '{}'::jsonb)
        end,
        updated_at = now()
    where wi.id = p_instance_id
    returning wi.* into v_inst;
  elsif p_action = 'REJECTED'::public.workflow_instance_action then
    update public.workflow_instances wi
    set status = 'REJECTED'::public.workflow_instance_status,
        updated_at = now()
    where wi.id = p_instance_id
    returning wi.* into v_inst;
  elsif p_action = 'REVISION_REQUESTED'::public.workflow_instance_action then
    select e.source_node_id, n.type
      into v_prev_node_id, v_prev_node_type
    from public.workflow_edges e
    join public.workflow_nodes n on n.id = e.source_node_id
    where e.target_node_id = v_inst.current_node_id
    limit 1;

    if v_prev_node_id is not null and v_prev_node_type = 'START'::public.workflow_node_type then
      select e.target_node_id
        into v_prev_node_id
      from public.workflow_edges e
      where e.source_node_id = v_prev_node_id
      limit 1;
    end if;

    if v_prev_node_id is not null then
      update public.workflow_instances wi
      set current_node_id = v_prev_node_id,
          step_assignees = case
            when cardinality(v_next_assignee_ids) > 0
            then coalesce(wi.step_assignees, '{}'::jsonb) || app_private.workflow_assignee_json(v_prev_node_id, v_next_assignee_ids)
            else coalesce(wi.step_assignees, '{}'::jsonb)
          end,
          updated_at = now()
      where wi.id = p_instance_id
      returning wi.* into v_inst;
    end if;
  end if;

  return query select
    v_inst.id,
    v_inst.template_id,
    v_inst.code,
    v_inst.title,
    v_inst.created_by,
    v_inst.current_node_id,
    v_inst.status,
    coalesce(v_inst.watchers, '{}'::text[]),
    coalesce(v_inst.step_assignees, '{}'::jsonb),
    v_inst.created_at,
    v_inst.updated_at;
end;
$$;

create or replace function public.process_workflow_instance_fast(
  p_instance_id uuid,
  p_action public.workflow_instance_action,
  p_user_id uuid,
  p_comment text default '',
  p_next_assignee_user_id uuid default null
)
returns table (
  id uuid,
  template_id uuid,
  code text,
  title text,
  created_by uuid,
  current_node_id uuid,
  status public.workflow_instance_status,
  watchers text[],
  step_assignees jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select *
  from public.process_workflow_instance_fast(
    p_instance_id,
    p_action,
    p_user_id,
    p_comment,
    case when p_next_assignee_user_id is null then '{}'::uuid[] else array[p_next_assignee_user_id] end
  );
$$;

revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid[]) from anon;
revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid[]) from public;
grant execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid[]) to authenticated;

revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid) from anon;
revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid) from public;
grant execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'workflow_instance_comments'
     ) then
    alter publication supabase_realtime add table public.workflow_instance_comments;
  end if;
exception
  when undefined_object then
    null;
end $$;

notify pgrst, 'reload schema';
