-- Workflow template catalog groups + clone command.
-- Groups ("Phòng HCNS", "Phòng Vật tư", ...) only organise the admin catalog;
-- they carry no authority. All writes go through SECURITY DEFINER commands.

create table if not exists public.workflow_template_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_template_categories_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists workflow_template_categories_name_key
  on public.workflow_template_categories (lower(btrim(name)));

alter table public.workflow_template_categories enable row level security;

drop policy if exists workflow_template_categories_select on public.workflow_template_categories;
create policy workflow_template_categories_select
  on public.workflow_template_categories for select to authenticated
  using ((select public.current_app_user_id()) is not null);

revoke all on public.workflow_template_categories from anon;
revoke insert, update, delete on public.workflow_template_categories from authenticated;
grant select on public.workflow_template_categories to authenticated;

alter table public.workflow_templates
  add column if not exists category_id uuid
    references public.workflow_template_categories(id) on delete set null;

create index if not exists workflow_templates_category_id_idx
  on public.workflow_templates (category_id);

create or replace function app_private.workflow_category_actor_can_manage(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select p_actor_id is not null and (
    public.is_admin()
    or app_private.workflow_has_action('workflow.template.create', null, null, p_actor_id)
    or app_private.workflow_has_action('workflow.template.edit', null, null, p_actor_id)
  );
$$;

create or replace function public.save_workflow_template_category(
  p_category_id uuid,
  p_name text,
  p_sort_order integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_row public.workflow_template_categories%rowtype;
begin
  if not app_private.workflow_category_actor_can_manage(v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'WORKFLOW_CATEGORY_NAME_REQUIRED' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.workflow_template_categories c
    where lower(btrim(c.name)) = lower(btrim(p_name))
      and c.id is distinct from p_category_id
  ) then
    raise exception 'WORKFLOW_CATEGORY_NAME_TAKEN' using errcode = '23505';
  end if;

  if p_category_id is null then
    insert into public.workflow_template_categories(name, sort_order, created_by)
    values (
      btrim(p_name),
      coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 10 from public.workflow_template_categories)),
      v_actor
    )
    returning * into v_row;
  else
    update public.workflow_template_categories
    set name = btrim(p_name),
        sort_order = coalesce(p_sort_order, sort_order),
        updated_at = now()
    where id = p_category_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'WORKFLOW_CATEGORY_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('category', to_jsonb(v_row));
end;
$$;

create or replace function public.reorder_workflow_template_categories(p_category_ids uuid[])
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
begin
  if not app_private.workflow_category_actor_can_manage(v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  update public.workflow_template_categories c
  set sort_order = ordered.position * 10, updated_at = now()
  from unnest(coalesce(p_category_ids, '{}'::uuid[])) with ordinality as ordered(id, position)
  where c.id = ordered.id;
end;
$$;

create or replace function public.delete_workflow_template_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
begin
  if not app_private.workflow_category_actor_can_manage(v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  -- Templates in the group fall back to "Chưa phân nhóm" (FK on delete set null).
  delete from public.workflow_template_categories where id = p_category_id;
end;
$$;

create or replace function public.set_workflow_template_category(p_template_id uuid, p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_template public.workflow_templates%rowtype;
begin
  if not app_private.workflow_template_actor_can_edit(p_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if p_category_id is not null
     and not exists (select 1 from public.workflow_template_categories where id = p_category_id) then
    raise exception 'WORKFLOW_CATEGORY_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.workflow_templates
  set category_id = p_category_id, updated_at = now()
  where id = p_template_id
  returning * into v_template;
  if v_template.id is null then
    raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object('template', to_jsonb(v_template));
end;
$$;

-- Copies a template with every setting (fields, managers, watchers, steps and
-- their assignee/watcher/SLA config). The copy starts switched off so admins
-- can adjust it before anyone can raise tickets on it. Print-template files
-- live in Storage and are copied by the client from the returned list.
create or replace function public.clone_workflow_template(
  p_source_template_id uuid,
  p_name text default null,
  p_category_id uuid default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_source public.workflow_templates%rowtype;
  v_template public.workflow_templates%rowtype;
  v_name text;
  v_node_count integer;
  v_print_templates jsonb;
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'clone_workflow_template',
    jsonb_build_object('sourceTemplateId', p_source_template_id, 'name', p_name, 'categoryId', p_category_id)
  );
  if v_cached is not null then return v_cached; end if;

  if not (
    public.is_admin()
    or app_private.workflow_has_action('workflow.template.create', null, null, v_actor)
  ) or not app_private.workflow_template_actor_can_view(p_source_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_source from public.workflow_templates where id = p_source_template_id;
  if v_source.id is null then
    raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_category_id is not null
     and not exists (select 1 from public.workflow_template_categories where id = p_category_id) then
    raise exception 'WORKFLOW_CATEGORY_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_source.name || ' (copy)');

  insert into public.workflow_templates(
    name, description, created_by, is_active, custom_fields, managers, default_watchers,
    category_id, cloned_from_template_id
  )
  values (
    v_name,
    coalesce(v_source.description, ''),
    v_actor,
    false,
    coalesce(v_source.custom_fields, '[]'::jsonb),
    coalesce(v_source.managers, '{}'::text[]),
    coalesce(v_source.default_watchers, '{}'::text[]),
    p_category_id,
    v_source.id
  )
  returning * into v_template;

  -- Live steps only; ids derive from (copy, source node) so edges can be remapped.
  insert into public.workflow_nodes(id, template_id, type, label, config, position_x, position_y)
  select md5(v_template.id::text || ':' || wn.id::text)::uuid, v_template.id, wn.type, wn.label,
    coalesce(wn.config, '{}'::jsonb) - '__templateRemoved',
    wn.position_x, wn.position_y
  from public.workflow_nodes wn
  where wn.template_id = v_source.id
    and coalesce((wn.config ->> '__templateRemoved')::boolean, false) = false;
  get diagnostics v_node_count = row_count;

  insert into public.workflow_edges(template_id, source_node_id, target_node_id, label)
  select v_template.id,
    md5(v_template.id::text || ':' || we.source_node_id::text)::uuid,
    md5(v_template.id::text || ':' || we.target_node_id::text)::uuid,
    coalesce(we.label, '')
  from public.workflow_edges we
  join public.workflow_nodes source_node on source_node.id = we.source_node_id
  join public.workflow_nodes target_node on target_node.id = we.target_node_id
  where we.template_id = v_source.id
    and coalesce((source_node.config ->> '__templateRemoved')::boolean, false) = false
    and coalesce((target_node.config ->> '__templateRemoved')::boolean, false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pt.id, 'name', pt.name, 'file_name', pt.file_name, 'storage_path', pt.storage_path
    ) order by pt.created_at), '[]'::jsonb)
  into v_print_templates
  from public.workflow_print_templates pt
  where pt.template_id = v_source.id;

  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key, jsonb_build_object(
      'template', to_jsonb(v_template),
      'nodeCount', v_node_count,
      'printTemplates', v_print_templates
    )
  );
end;
$$;

revoke all on function app_private.workflow_category_actor_can_manage(uuid) from public;
revoke all on function public.save_workflow_template_category(uuid, text, integer) from public, anon;
revoke all on function public.reorder_workflow_template_categories(uuid[]) from public, anon;
revoke all on function public.delete_workflow_template_category(uuid) from public, anon;
revoke all on function public.set_workflow_template_category(uuid, uuid) from public, anon;
revoke all on function public.clone_workflow_template(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.save_workflow_template_category(uuid, text, integer) to authenticated;
grant execute on function public.reorder_workflow_template_categories(uuid[]) to authenticated;
grant execute on function public.delete_workflow_template_category(uuid) to authenticated;
grant execute on function public.set_workflow_template_category(uuid, uuid) to authenticated;
grant execute on function public.clone_workflow_template(uuid, text, uuid, uuid) to authenticated;

insert into public.workflow_template_categories(name, sort_order)
values ('Phòng Hành chính nhân sự', 10), ('Phòng Vật tư', 20)
on conflict do nothing;
