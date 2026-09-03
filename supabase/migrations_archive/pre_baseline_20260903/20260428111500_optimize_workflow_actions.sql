-- Keep workflow list/action payloads small and move binary attachments to Storage.

insert into storage.buckets (id, name, public, file_size_limit)
values ('workflow-attachments', 'workflow-attachments', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "workflow_attachments_select" on storage.objects;
create policy "workflow_attachments_select"
on storage.objects for select
to authenticated
using (bucket_id = 'workflow-attachments');

drop policy if exists "workflow_attachments_insert" on storage.objects;
create policy "workflow_attachments_insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'workflow-attachments');

drop policy if exists "workflow_attachments_update" on storage.objects;
create policy "workflow_attachments_update"
on storage.objects for update
to authenticated
using (bucket_id = 'workflow-attachments')
with check (bucket_id = 'workflow-attachments');

drop policy if exists "workflow_attachments_delete" on storage.objects;
create policy "workflow_attachments_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'workflow-attachments');

create index if not exists idx_workflow_instances_created_at
  on public.workflow_instances (created_at desc);

create index if not exists idx_workflow_nodes_template_id
  on public.workflow_nodes (template_id);

create index if not exists idx_workflow_edges_template_id
  on public.workflow_edges (template_id);

create index if not exists idx_workflow_edges_source_node_id
  on public.workflow_edges (source_node_id);

create index if not exists idx_workflow_edges_target_node_id
  on public.workflow_edges (target_node_id);

create index if not exists idx_workflow_instance_logs_node_id
  on public.workflow_instance_logs (node_id);

create index if not exists idx_workflow_instance_logs_created_at
  on public.workflow_instance_logs (created_at);

create index if not exists idx_workflow_print_templates_template_id
  on public.workflow_print_templates (template_id);

alter table public.notifications
  alter column user_id drop not null;

create or replace function public.process_workflow_instance_fast(
  p_instance_id uuid,
  p_action public.workflow_instance_action,
  p_user_id uuid,
  p_comment text default ''
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
  v_next_node_id uuid;
  v_next_node_type public.workflow_node_type;
  v_prev_node_id uuid;
  v_prev_node_type public.workflow_node_type;
begin
  if v_current_user is null then
    raise exception 'authentication required';
  end if;
  if p_user_id is distinct from v_current_user and not public.is_module_admin('WF') then
    raise exception 'cannot act as another user';
  end if;

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
    v_inst.created_at,
    v_inst.updated_at;
end;
$$;

revoke all on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text) from public;
grant execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text) to authenticated;

notify pgrst, 'reload schema';
