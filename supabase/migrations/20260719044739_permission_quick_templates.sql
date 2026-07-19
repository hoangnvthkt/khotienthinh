create table public.permission_quick_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permission_quick_templates_code_format
    check (code ~ '^[a-z0-9][a-z0-9_]{1,62}[a-z0-9]$'),
  constraint permission_quick_templates_name_not_blank
    check (char_length(btrim(name)) >= 2)
);

create table public.permission_quick_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.permission_quick_templates(id) on delete cascade,
  permission_code text not null references public.permission_actions(permission_code) on update cascade on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (template_id, permission_code)
);

alter table public.permission_quick_templates enable row level security;
alter table public.permission_quick_template_items enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'permission_quick_templates'
      and policyname = 'permission_quick_templates_select'
  ) then
    create policy permission_quick_templates_select on public.permission_quick_templates
      for select to authenticated
      using (app_private.has_permission(public.current_app_user_id(), 'system.authorization.view', 'global', '*'));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'permission_quick_template_items'
      and policyname = 'permission_quick_template_items_select'
  ) then
    create policy permission_quick_template_items_select on public.permission_quick_template_items
      for select to authenticated
      using (
        exists (
          select 1
          from public.permission_quick_templates template
          where template.id = permission_quick_template_items.template_id
            and app_private.has_permission(public.current_app_user_id(), 'system.authorization.view', 'global', '*')
        )
      );
  end if;
end;
$$;

revoke all on public.permission_quick_templates from public, anon, authenticated;
revoke all on public.permission_quick_template_items from public, anon, authenticated;
grant select on public.permission_quick_templates to authenticated;
grant select on public.permission_quick_template_items to authenticated;

create or replace function app_private.normalize_permission_quick_template_codes(
  p_permission_codes jsonb
)
returns table(permission_code text, sort_order integer)
language sql
stable
security definer
set search_path = ''
as $$
  with raw_items as (
    select
      btrim(value #>> '{}') as permission_code,
      row_number() over ()::integer as sort_order
    from jsonb_array_elements(coalesce(p_permission_codes, '[]'::jsonb))
  )
  select raw_items.permission_code, min(raw_items.sort_order)::integer
  from raw_items
  where raw_items.permission_code <> ''
  group by raw_items.permission_code
  order by min(raw_items.sort_order), raw_items.permission_code
$$;

create or replace function app_private.list_permission_quick_templates_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
begin
  v_actor_user_id := app_private.assert_authorization_permission('system.authorization.view');

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', template.id,
        'code', template.code,
        'name', template.name,
        'description', template.description,
        'isActive', template.is_active,
        'permissionCodes', coalesce(items.permission_codes, '[]'::jsonb),
        'updatedAt', template.updated_at
      )
      order by template.name, template.code
    )
    from public.permission_quick_templates template
    left join lateral (
      select jsonb_agg(item.permission_code order by item.sort_order, item.permission_code) as permission_codes
      from public.permission_quick_template_items item
      join public.permission_actions action
        on action.permission_code = item.permission_code
      where item.template_id = template.id
        and action.is_active
        and action.grant_readiness in ('enforced', 'verified')
    ) items on true
    where template.is_active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_permission_quick_templates()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.list_permission_quick_templates_impl();
$$;

create or replace function app_private.save_permission_quick_template_impl(
  p_template_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_permission_codes jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_template_id uuid;
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb;
  v_after jsonb;
  v_permission_count integer;
begin
  v_actor_user_id := app_private.assert_authorization_permission('system.authorization.manage_grants');

  if v_code = ''
    or v_code !~ '^[a-z0-9][a-z0-9_]{1,62}[a-z0-9]$'
  then
    raise exception 'Valid quick template code required'
      using errcode = '22023';
  end if;

  if char_length(v_name) < 2 then
    raise exception 'Quick template name required'
      using errcode = '22023';
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'Quick template change reason required'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_permission_codes, 'null'::jsonb)) <> 'array' then
    raise exception 'Quick template permissions must be an array'
      using errcode = '22023';
  end if;

  create temporary table pg_temp.quick_template_permission_codes (
    permission_code text primary key,
    sort_order integer not null
  ) on commit drop;

  insert into pg_temp.quick_template_permission_codes (permission_code, sort_order)
  select normalized.permission_code, normalized.sort_order
  from app_private.normalize_permission_quick_template_codes(p_permission_codes) normalized;

  select count(*)
  into v_permission_count
  from pg_temp.quick_template_permission_codes;

  if v_permission_count = 0 then
    raise exception 'Quick template must include at least one permission'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_temp.quick_template_permission_codes supplied
    left join public.permission_actions action
      on action.permission_code = supplied.permission_code
    where action.permission_code is null
      or not action.is_active
      or action.grant_readiness not in ('enforced', 'verified')
  ) then
    raise exception 'Quick template includes a permission that is not grantable'
      using errcode = '23514';
  end if;

  if p_template_id is not null then
    select jsonb_build_object(
      'id', template.id,
      'code', template.code,
      'name', template.name,
      'description', template.description,
      'isActive', template.is_active,
      'permissionCodes', coalesce(items.permission_codes, '[]'::jsonb)
    )
    into v_before
    from public.permission_quick_templates template
    left join lateral (
      select jsonb_agg(item.permission_code order by item.sort_order, item.permission_code) as permission_codes
      from public.permission_quick_template_items item
      where item.template_id = template.id
    ) items on true
    where template.id = p_template_id;

    if v_before is null then
      raise exception 'Quick template does not exist'
        using errcode = '23503';
    end if;
  else
    select jsonb_build_object(
      'id', template.id,
      'code', template.code,
      'name', template.name,
      'description', template.description,
      'isActive', template.is_active,
      'permissionCodes', coalesce(items.permission_codes, '[]'::jsonb)
    )
    into v_before
    from public.permission_quick_templates template
    left join lateral (
      select jsonb_agg(item.permission_code order by item.sort_order, item.permission_code) as permission_codes
      from public.permission_quick_template_items item
      where item.template_id = template.id
    ) items on true
    where template.code = v_code;
  end if;

  insert into public.permission_quick_templates (
    id,
    code,
    name,
    description,
    is_active,
    created_by,
    updated_by
  )
  values (
    coalesce(p_template_id, gen_random_uuid()),
    v_code,
    v_name,
    v_description,
    true,
    v_actor_user_id,
    v_actor_user_id
  )
  on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      is_active = true,
      updated_by = excluded.updated_by,
      updated_at = now()
  returning id into v_template_id;

  if p_template_id is not null and v_template_id is distinct from p_template_id then
    raise exception 'Quick template code belongs to another template'
      using errcode = '23505';
  end if;

  delete from public.permission_quick_template_items
  where template_id = v_template_id;

  insert into public.permission_quick_template_items (
    template_id,
    permission_code,
    sort_order
  )
  select v_template_id, supplied.permission_code, supplied.sort_order
  from pg_temp.quick_template_permission_codes supplied
  order by supplied.sort_order, supplied.permission_code;

  select jsonb_build_object(
    'id', template.id,
    'code', template.code,
    'name', template.name,
    'description', template.description,
    'isActive', template.is_active,
    'permissionCodes', coalesce(items.permission_codes, '[]'::jsonb)
  )
  into v_after
  from public.permission_quick_templates template
  left join lateral (
    select jsonb_agg(item.permission_code order by item.sort_order, item.permission_code) as permission_codes
    from public.permission_quick_template_items item
    where item.template_id = template.id
  ) items on true
  where template.id = v_template_id;

  insert into public.permission_audit_events (
    actor_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  ) values (
    v_actor_user_id,
    'permission_quick_template_saved',
    coalesce(v_before, '{}'::jsonb),
    v_after,
    jsonb_build_object(
      'reason', v_reason,
      'templateId', v_template_id
    )
  );

  return v_template_id;
end;
$$;

create or replace function public.save_permission_quick_template(
  p_template_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_permission_codes jsonb,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.save_permission_quick_template_impl(
    p_template_id,
    p_code,
    p_name,
    p_description,
    p_permission_codes,
    p_reason
  );
$$;

create or replace function app_private.deactivate_permission_quick_template_impl(
  p_template_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb;
  v_after jsonb;
begin
  v_actor_user_id := app_private.assert_authorization_permission('system.authorization.manage_grants');

  if p_template_id is null then
    raise exception 'Quick template id required'
      using errcode = '22023';
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'Quick template deactivation reason required'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'id', template.id,
    'code', template.code,
    'name', template.name,
    'description', template.description,
    'isActive', template.is_active,
    'permissionCodes', coalesce(items.permission_codes, '[]'::jsonb)
  )
  into v_before
  from public.permission_quick_templates template
  left join lateral (
    select jsonb_agg(item.permission_code order by item.sort_order, item.permission_code) as permission_codes
    from public.permission_quick_template_items item
    where item.template_id = template.id
  ) items on true
  where template.id = p_template_id;

  if v_before is null then
    raise exception 'Quick template does not exist'
      using errcode = '23503';
  end if;

  update public.permission_quick_templates
  set is_active = false,
      updated_by = v_actor_user_id,
      updated_at = now()
  where id = p_template_id;

  v_after := jsonb_set(v_before, '{isActive}', 'false'::jsonb, true);

  insert into public.permission_audit_events (
    actor_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  ) values (
    v_actor_user_id,
    'permission_quick_template_deactivated',
    v_before,
    v_after,
    jsonb_build_object(
      'reason', v_reason,
      'templateId', p_template_id
    )
  );
end;
$$;

create or replace function public.deactivate_permission_quick_template(
  p_template_id uuid,
  p_reason text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.deactivate_permission_quick_template_impl(
    p_template_id,
    p_reason
  );
$$;

revoke all on function app_private.normalize_permission_quick_template_codes(jsonb)
  from public, anon, authenticated;
revoke all on function app_private.list_permission_quick_templates_impl()
  from public, anon, authenticated;
revoke all on function app_private.save_permission_quick_template_impl(uuid,text,text,text,jsonb,text)
  from public, anon, authenticated;
revoke all on function app_private.deactivate_permission_quick_template_impl(uuid,text)
  from public, anon, authenticated;

revoke all on function public.list_permission_quick_templates()
  from public, anon, authenticated;
revoke all on function public.save_permission_quick_template(uuid,text,text,text,jsonb,text)
  from public, anon, authenticated;
revoke all on function public.deactivate_permission_quick_template(uuid,text)
  from public, anon, authenticated;

grant execute on function public.list_permission_quick_templates()
  to authenticated;
grant execute on function public.save_permission_quick_template(uuid,text,text,text,jsonb,text)
  to authenticated;
grant execute on function public.deactivate_permission_quick_template(uuid,text)
  to authenticated;
