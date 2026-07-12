-- Phase 3 Project Org assignment RPCs.
-- Moves project staff assignment mutations behind explicit project.org.assign_staff checks.

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.can_manage_project_staff_assignment(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_has_permission_v2(
      p_project_id,
      p_construction_site_id,
      'project.org.assign_staff',
      public.current_app_user_id()
    )
    or app_private.project_has_permission_v2(
      p_project_id,
      p_construction_site_id,
      'project.org.manage',
      public.current_app_user_id()
    );
$$;

revoke all on function app_private.can_manage_project_staff_assignment(text, text) from public;
revoke all on function app_private.can_manage_project_staff_assignment(text, text) from anon;
grant execute on function app_private.can_manage_project_staff_assignment(text, text) to authenticated;

create or replace function app_private.project_staff_scope_type(
  p_construction_site_id text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case when nullif(p_construction_site_id, '') is not null then 'construction_site' else 'project' end;
$$;

revoke all on function app_private.project_staff_scope_type(text) from public;
revoke all on function app_private.project_staff_scope_type(text) from anon;
grant execute on function app_private.project_staff_scope_type(text) to authenticated;

create or replace function app_private.project_staff_scope_id(
  p_project_id text,
  p_construction_site_id text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(nullif(p_construction_site_id, ''), nullif(p_project_id, ''));
$$;

revoke all on function app_private.project_staff_scope_id(text, text) from public;
revoke all on function app_private.project_staff_scope_id(text, text) from anon;
grant execute on function app_private.project_staff_scope_id(text, text) to authenticated;

create or replace function app_private.deactivate_project_staff_scoped_grants(
  p_staff public.project_staff
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_user_id uuid;
  v_scope_type text := app_private.project_staff_scope_type(p_staff.construction_site_id);
  v_scope_id text := app_private.project_staff_scope_id(p_staff.project_id, p_staff.construction_site_id);
begin
  update public.project_staff_permissions
  set is_active = false
  where staff_id = p_staff.id
    and coalesce(is_active, true);

  if p_staff.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;

  v_target_user_id := p_staff.user_id::uuid;

  update public.user_permission_grants
  set is_active = false,
      updated_at = now()
  where user_id = v_target_user_id
    and permission_code like 'project.%'
    and scope_type = v_scope_type
    and scope_id = v_scope_id
    and coalesce(is_active, false);
end;
$$;

revoke all on function app_private.deactivate_project_staff_scoped_grants(public.project_staff) from public;
revoke all on function app_private.deactivate_project_staff_scoped_grants(public.project_staff) from anon;
grant execute on function app_private.deactivate_project_staff_scoped_grants(public.project_staff) to authenticated;

create or replace function app_private.upsert_project_staff_assignment(
  p_staff jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.project_staff%rowtype;
  v_result public.project_staff%rowtype;
  v_staff_id uuid := nullif(p_staff->>'id', '')::uuid;
  v_project_id text;
  v_construction_site_id text;
  v_user_id text;
  v_position_id uuid;
  v_start_date date;
  v_note text;
  v_sort_order int;
begin
  if v_staff_id is not null then
    select *
    into v_staff
    from public.project_staff
    where id = v_staff_id;

    if v_staff.id is null then
      raise exception 'Project staff row does not exist: %', v_staff_id
        using errcode = 'P0002';
    end if;
  end if;

  v_project_id := case when p_staff ? 'project_id' then nullif(p_staff->>'project_id', '') else v_staff.project_id end;
  v_construction_site_id := case when p_staff ? 'construction_site_id' then nullif(p_staff->>'construction_site_id', '') else v_staff.construction_site_id end;
  v_user_id := case when p_staff ? 'user_id' then nullif(p_staff->>'user_id', '') else v_staff.user_id end;
  v_position_id := case when p_staff ? 'position_id' then nullif(p_staff->>'position_id', '')::uuid else v_staff.position_id end;
  v_start_date := case when p_staff ? 'start_date' then nullif(p_staff->>'start_date', '')::date else coalesce(v_staff.start_date, current_date) end;
  v_note := case when p_staff ? 'note' then nullif(p_staff->>'note', '') else v_staff.note end;
  v_sort_order := case when p_staff ? 'sort_order' then coalesce(nullif(p_staff->>'sort_order', '')::int, 0) else coalesce(v_staff.sort_order, 0) end;

  if v_project_id is null and v_construction_site_id is null then
    raise exception 'Project staff assignment requires project_id or construction_site_id'
      using errcode = '23502';
  end if;

  if v_user_id is null then
    raise exception 'Project staff assignment requires user_id'
      using errcode = '23502';
  end if;

  if v_position_id is null then
    raise exception 'Project staff assignment requires position_id'
      using errcode = '23502';
  end if;

  if v_staff_id is not null and not app_private.can_manage_project_staff_assignment(v_staff.project_id, v_staff.construction_site_id) then
    raise exception 'Not allowed to update this project staff assignment'
      using errcode = '42501';
  end if;

  if not app_private.can_manage_project_staff_assignment(v_project_id, v_construction_site_id) then
    raise exception 'Not allowed to manage project staff assignments'
      using errcode = '42501';
  end if;

  if v_staff_id is null then
    insert into public.project_staff (
      project_id,
      construction_site_id,
      user_id,
      position_id,
      start_date,
      note,
      sort_order
    )
    values (
      v_project_id,
      v_construction_site_id,
      v_user_id,
      v_position_id,
      v_start_date,
      v_note,
      v_sort_order
    )
    returning *
    into v_result;
  else
    update public.project_staff
    set project_id = v_project_id,
        construction_site_id = v_construction_site_id,
        user_id = v_user_id,
        position_id = v_position_id,
        start_date = v_start_date,
        note = v_note,
        sort_order = v_sort_order,
        updated_at = now()
    where id = v_staff_id
    returning *
    into v_result;
  end if;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    metadata
  )
  values (
    public.current_app_user_id(),
    case when v_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_user_id::uuid else null end,
    'upsert_project_staff_assignment',
    jsonb_build_object(
      'staff_id', v_result.id,
      'project_id', v_project_id,
      'construction_site_id', v_construction_site_id
    )
  );

  return v_result.id;
end;
$$;

revoke all on function app_private.upsert_project_staff_assignment(jsonb) from public;
revoke all on function app_private.upsert_project_staff_assignment(jsonb) from anon;
grant execute on function app_private.upsert_project_staff_assignment(jsonb) to authenticated;

create or replace function public.upsert_project_staff_assignment(
  p_staff jsonb
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.upsert_project_staff_assignment(p_staff);
$$;

revoke all on function public.upsert_project_staff_assignment(jsonb) from public;
revoke all on function public.upsert_project_staff_assignment(jsonb) from anon;
grant execute on function public.upsert_project_staff_assignment(jsonb) to authenticated;

create or replace function app_private.end_project_staff_assignment(
  p_staff_id uuid,
  p_end_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.project_staff%rowtype;
  v_result public.project_staff%rowtype;
begin
  select *
  into v_staff
  from public.project_staff
  where id = p_staff_id;

  if v_staff.id is null then
    raise exception 'Project staff row does not exist: %', p_staff_id
      using errcode = 'P0002';
  end if;

  if not app_private.can_manage_project_staff_assignment(v_staff.project_id, v_staff.construction_site_id) then
    raise exception 'Not allowed to end this project staff assignment'
      using errcode = '42501';
  end if;

  update public.project_staff
  set end_date = coalesce(p_end_date, current_date),
      updated_at = now()
  where id = p_staff_id
  returning *
  into v_result;

  perform app_private.deactivate_project_staff_scoped_grants(v_result);

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    metadata
  )
  values (
    public.current_app_user_id(),
    case when v_result.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_result.user_id::uuid else null end,
    'end_project_staff_assignment',
    jsonb_build_object(
      'staff_id', p_staff_id,
      'project_id', v_result.project_id,
      'construction_site_id', v_result.construction_site_id,
      'end_date', v_result.end_date
    )
  );

  return to_jsonb(v_result);
end;
$$;

revoke all on function app_private.end_project_staff_assignment(uuid, date) from public;
revoke all on function app_private.end_project_staff_assignment(uuid, date) from anon;
grant execute on function app_private.end_project_staff_assignment(uuid, date) to authenticated;

create or replace function public.end_project_staff_assignment(
  p_staff_id uuid,
  p_end_date date default current_date
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.end_project_staff_assignment(p_staff_id, p_end_date);
$$;

revoke all on function public.end_project_staff_assignment(uuid, date) from public;
revoke all on function public.end_project_staff_assignment(uuid, date) from anon;
grant execute on function public.end_project_staff_assignment(uuid, date) to authenticated;

create or replace function app_private.remove_project_staff_assignment(
  p_staff_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.project_staff%rowtype;
begin
  select *
  into v_staff
  from public.project_staff
  where id = p_staff_id;

  if v_staff.id is null then
    raise exception 'Project staff row does not exist: %', p_staff_id
      using errcode = 'P0002';
  end if;

  if not app_private.can_manage_project_staff_assignment(v_staff.project_id, v_staff.construction_site_id) then
    raise exception 'Not allowed to remove this project staff assignment'
      using errcode = '42501';
  end if;

  perform app_private.deactivate_project_staff_scoped_grants(v_staff);

  if v_staff.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    delete from public.user_permission_grants
    where user_id = v_staff.user_id::uuid
      and permission_code like 'project.%'
      and scope_type = app_private.project_staff_scope_type(v_staff.construction_site_id)
      and scope_id = app_private.project_staff_scope_id(v_staff.project_id, v_staff.construction_site_id);
  end if;

  delete from public.project_staff
  where id = p_staff_id;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    metadata
  )
  values (
    public.current_app_user_id(),
    case when v_staff.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_staff.user_id::uuid else null end,
    'remove_project_staff_assignment',
    jsonb_build_object(
      'staff_id', p_staff_id,
      'project_id', v_staff.project_id,
      'construction_site_id', v_staff.construction_site_id
    )
  );

  return to_jsonb(v_staff);
end;
$$;

revoke all on function app_private.remove_project_staff_assignment(uuid) from public;
revoke all on function app_private.remove_project_staff_assignment(uuid) from anon;
grant execute on function app_private.remove_project_staff_assignment(uuid) to authenticated;

create or replace function public.remove_project_staff_assignment(
  p_staff_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.remove_project_staff_assignment(p_staff_id);
$$;

revoke all on function public.remove_project_staff_assignment(uuid) from public;
revoke all on function public.remove_project_staff_assignment(uuid) from anon;
grant execute on function public.remove_project_staff_assignment(uuid) to authenticated;

do $$
declare
  tbl text;
  policy_name text;
begin
  foreach tbl in array array['project_staff', 'project_staff_permissions']
  loop
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all privileges on table public.%I from public', tbl);
    execute format('revoke all privileges on table public.%I from anon', tbl);
    execute format('revoke all privileges on table public.%I from authenticated', tbl);
    execute format('grant select on table public.%I to authenticated', tbl);

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, tbl);
    end loop;

    if tbl = 'project_staff' then
      execute format(
        'create policy %I on public.%I for select to authenticated using (
          public.is_admin()
          or public.is_module_admin(''DA'')
          or app_private.project_has_any_permission_v2(
            project_id,
            construction_site_id,
            array[''project.org.view'', ''project.org.assign_staff'', ''project.org.grant_permissions'']::text[],
            public.current_app_user_id()
          )
        )',
        tbl || '_phase3_org_select',
        tbl
      );
    else
      execute format(
        'create policy %I on public.%I for select to authenticated using (
          public.is_admin()
          or public.is_module_admin(''DA'')
          or exists (
            select 1
            from public.project_staff ps
            where ps.id = staff_id
              and app_private.project_has_any_permission_v2(
                ps.project_id,
                ps.construction_site_id,
                array[''project.org.view'', ''project.org.assign_staff'', ''project.org.grant_permissions'']::text[],
                public.current_app_user_id()
              )
          )
        )',
        tbl || '_phase3_org_select',
        tbl
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
