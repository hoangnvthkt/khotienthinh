-- Material PO authoritative Room cutover.
-- Module/submodule permissions only open the Supply shell. The material_po
-- Room is the sole project permission source for PO data and workflow actions.

alter table app_private.project_permission_room_action_bindings
  add column if not exists pbac_fallback_enabled boolean not null default true;

update app_private.project_permission_room_action_bindings
set pbac_fallback_enabled = false,
    updated_at = now()
where room_code = 'material_po'
  and action_code in ('view', 'edit', 'delete', 'submit', 'approve', 'confirm');

alter table public.project_permission_room_member_actions
  add column if not exists grant_source text not null default 'manual_room';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_permission_room_member_actions_grant_source_check'
      and conrelid = 'public.project_permission_room_member_actions'::regclass
  ) then
    alter table public.project_permission_room_member_actions
      add constraint project_permission_room_member_actions_grant_source_check
      check (grant_source in ('manual_room', 'pbac_backfill'));
  end if;
end;
$$;

-- Only rows recorded by the PO backfill batch are labelled as converted.
with backfilled as (
  select distinct
    (entry ->> 'project_staff_id')::uuid as project_staff_id,
    nullif(entry ->> 'construction_site_id', '') as construction_site_id,
    entry ->> 'action_code' as action_code
  from public.permission_audit_events event
  cross join lateral jsonb_array_elements(coalesce(event.after_grants, '[]'::jsonb)) entry
  where event.event_type = 'project_room_pbac_backfill'
    and event.metadata ->> 'room_code' = 'material_po'
    and entry ->> 'room_code' = 'material_po'
)
update public.project_permission_room_member_actions action
set grant_source = 'pbac_backfill', updated_at = now()
from public.project_permission_room_members member
join backfilled item
  on item.project_staff_id = member.project_staff_id
  and item.construction_site_id is not distinct from member.construction_site_id
where action.room_member_id = member.id
  and member.room_code = 'material_po'
  and action.action_code = item.action_code;

create or replace function app_private.project_actor_has_effective_room_action(
  p_user_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_action_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with binding as (
    select item.enforcement_status,
           item.legacy_permission_codes,
           item.pbac_fallback_enabled
    from app_private.project_permission_room_action_bindings item
    where item.room_code = p_room_code
      and item.action_code = p_action_code
  ), actor as (
    select user_row.id, user_row.role
    from public.users user_row
    where user_row.id = p_user_id
      and coalesce(user_row.is_active, true)
  ), scoped_actor as (
    select actor.id, actor.role
    from actor
    where actor.role = 'ADMIN'
      or exists (
        select 1
        from public.project_staff staff
        where staff.user_id = actor.id::text
          and staff.project_id = p_project_id
          and staff.end_date is null
          and (
            nullif(p_construction_site_id, '') is null
            or staff.construction_site_id is null
            or staff.construction_site_id = p_construction_site_id
          )
      )
  )
  select exists (
    select 1
    from binding
    cross join scoped_actor
    where scoped_actor.role = 'ADMIN'
      or (
        binding.enforcement_status in ('pilot', 'enforced')
        and app_private.project_user_has_room_action(
          scoped_actor.id,
          p_project_id,
          nullif(p_construction_site_id, ''),
          p_room_code,
          p_action_code
        )
        and (
          p_room_code <> 'material_po'
          or p_action_code = 'view'
          or app_private.project_user_has_room_action(
            scoped_actor.id,
            p_project_id,
            nullif(p_construction_site_id, ''),
            'material_po',
            'view'
          )
        )
      )
      or (
        binding.pbac_fallback_enabled
        and app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
        and exists (
          select 1
          from unnest(binding.legacy_permission_codes) legacy(permission_code)
          where app_private.project_has_permission_v2(
            p_project_id,
            nullif(p_construction_site_id, ''),
            legacy.permission_code,
            scoped_actor.id
          )
        )
      )
  );
$$;

revoke all on function app_private.project_actor_has_effective_room_action(uuid, text, text, text, text)
  from public, anon, authenticated;

drop function if exists public.get_my_project_room_actions(text, text);
create function public.get_my_project_room_actions(
  p_project_id text,
  p_construction_site_id text
)
returns table (
  room_code text,
  action_code text,
  authorization_source text,
  enforcement_status text,
  pbac_fallback_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select public.current_app_user_id() as user_id)
  select
    binding.room_code,
    binding.action_code,
    case
      when exists (
        select 1 from public.users user_row
        where user_row.id = actor.user_id
          and coalesce(user_row.is_active, true)
          and user_row.role = 'ADMIN'
      ) then 'admin'
      when binding.enforcement_status in ('pilot', 'enforced')
        and app_private.project_user_has_room_action(
          actor.user_id, p_project_id, nullif(p_construction_site_id, ''),
          binding.room_code, binding.action_code
        ) then 'room'
      else 'pbac_fallback'
    end,
    binding.enforcement_status,
    binding.pbac_fallback_enabled
  from app_private.project_permission_room_action_bindings binding
  cross join actor
  where app_private.project_actor_has_effective_room_action(
    actor.user_id, p_project_id, nullif(p_construction_site_id, ''),
    binding.room_code, binding.action_code
  )
  order by binding.room_code, binding.action_code;
$$;

revoke all on function public.get_my_project_room_actions(text, text) from public, anon;
grant execute on function public.get_my_project_room_actions(text, text) to authenticated;

-- Preserve provenance for unchanged actions. Newly granted or re-enabled
-- actions are direct Room grants.
create or replace function app_private.replace_project_permission_room_members(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_members jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_scope_site_id text := nullif(p_construction_site_id, '');
  v_allowed_actions text[];
  v_required_actions text[];
  v_before jsonb;
  v_after jsonb;
begin
  v_actor_user_id := app_private.assert_project_permission_room_admin();

  if jsonb_typeof(coalesce(p_members, 'null'::jsonb)) <> 'array' then
    raise exception 'Room members must be a JSON array' using errcode = '22023';
  end if;

  select room.allowed_actions, room.required_actions
  into v_allowed_actions, v_required_actions
  from public.project_permission_rooms room
  where room.code = p_room_code and room.is_active;

  if v_allowed_actions is null then
    raise exception 'Unknown active permission Room: %', p_room_code using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
    where item.project_staff_id is null
      or jsonb_typeof(coalesce(item.action_codes, 'null'::jsonb)) <> 'array'
  ) then
    raise exception 'Each Room member requires project_staff_id and action_codes[]' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
    cross join lateral jsonb_array_elements_text(item.action_codes) code(action_code)
    where not (code.action_code = any(v_allowed_actions))
  ) then
    raise exception 'Payload contains an action not allowed in this Room' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
    group by item.project_staff_id having count(*) > 1
  ) then
    raise exception 'Each project staff member can appear once in a Room payload' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
    cross join lateral (
      select code.action_code
      from jsonb_array_elements_text(item.action_codes) code(action_code)
      group by code.action_code having count(*) > 1
    ) duplicated
  ) then
    raise exception 'A Room action can only be assigned once per staff member' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
    left join public.project_staff staff on staff.id = item.project_staff_id
    left join public.users user_row on user_row.id::text = staff.user_id
    where staff.id is null
      or staff.project_id is distinct from p_project_id
      or staff.end_date is not null
      or not coalesce(user_row.is_active, true)
      or (v_scope_site_id is not null and staff.construction_site_id is not null
          and staff.construction_site_id <> v_scope_site_id)
  ) then
    raise exception 'Room members must be active staff in the selected project scope' using errcode = '23503';
  end if;

  if p_room_code = 'material_po' and exists (
    select 1
    from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
    where exists (
      select 1 from jsonb_array_elements_text(item.action_codes) code(action_code)
      where code.action_code <> 'view'
    )
    and not (item.action_codes ? 'view')
  ) then
    raise exception 'Quyền nghiệp vụ PO phải đi cùng quyền Xem trong Room.' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_staff_id', member.project_staff_id,
    'action_codes', coalesce(actions.action_codes, '[]'::jsonb)
  ) order by member.project_staff_id), '[]'::jsonb)
  into v_before
  from public.project_permission_room_members member
  left join lateral (
    select jsonb_agg(action.action_code order by action.action_code) action_codes
    from public.project_permission_room_member_actions action
    where action.room_member_id = member.id and action.is_active
  ) actions on true
  where member.project_id = p_project_id
    and member.construction_site_id is not distinct from v_scope_site_id
    and member.room_code = p_room_code
    and member.is_active;

  insert into public.project_permission_room_members (
    project_id, construction_site_id, room_code, project_staff_id,
    is_active, created_by, updated_at
  )
  select p_project_id, v_scope_site_id, p_room_code, item.project_staff_id,
         true, v_actor_user_id, now()
  from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
  on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
  do update set is_active = true, updated_at = now();

  update public.project_permission_room_members member
  set is_active = false, updated_at = now()
  where member.project_id = p_project_id
    and member.construction_site_id is not distinct from v_scope_site_id
    and member.room_code = p_room_code
    and member.is_active
    and not exists (
      select 1 from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
      where item.project_staff_id = member.project_staff_id
    );

  update public.project_permission_room_member_actions action
  set is_active = false, updated_at = now()
  from public.project_permission_room_members member
  where member.id = action.room_member_id
    and member.project_id = p_project_id
    and member.construction_site_id is not distinct from v_scope_site_id
    and member.room_code = p_room_code
    and not exists (
      select 1
      from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
      cross join lateral jsonb_array_elements_text(item.action_codes) code(action_code)
      where item.project_staff_id = member.project_staff_id
        and code.action_code = action.action_code
    );

  insert into public.project_permission_room_member_actions (
    room_member_id, action_code, is_active, granted_by, granted_at, updated_at, grant_source
  )
  select member.id, code.action_code, true, v_actor_user_id, now(), now(), 'manual_room'
  from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
  join public.project_permission_room_members member
    on member.project_id = p_project_id
    and member.construction_site_id is not distinct from v_scope_site_id
    and member.room_code = p_room_code
    and member.project_staff_id = item.project_staff_id
  cross join lateral jsonb_array_elements_text(item.action_codes) code(action_code)
  on conflict (room_member_id, action_code) do update
  set is_active = true,
      granted_by = case when public.project_permission_room_member_actions.is_active
                        then public.project_permission_room_member_actions.granted_by
                        else excluded.granted_by end,
      granted_at = case when public.project_permission_room_member_actions.is_active
                        then public.project_permission_room_member_actions.granted_at
                        else excluded.granted_at end,
      grant_source = case when public.project_permission_room_member_actions.is_active
                          then public.project_permission_room_member_actions.grant_source
                          else 'manual_room' end,
      updated_at = now();

  if exists (
    select 1 from unnest(v_required_actions) required(action_code)
    where not exists (
      select 1
      from public.project_permission_room_members member
      join public.project_permission_room_member_actions action on action.room_member_id = member.id
      where member.project_id = p_project_id
        and member.construction_site_id is not distinct from v_scope_site_id
        and member.room_code = p_room_code
        and member.is_active and action.is_active
        and action.action_code = required.action_code
    )
  ) then
    raise exception 'Required workflow action has no active Room recipient' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_staff_id', item.project_staff_id, 'action_codes', item.action_codes
  ) order by item.project_staff_id), '[]'::jsonb)
  into v_after
  from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb);

  insert into public.permission_audit_events (
    actor_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    v_actor_user_id, 'replace_project_permission_room_members', v_before, v_after,
    jsonb_build_object('project_id', p_project_id,
      'construction_site_id', v_scope_site_id, 'room_code', p_room_code)
  );
end;
$$;

revoke all on function app_private.replace_project_permission_room_members(text, text, text, jsonb)
  from public, anon, authenticated;

-- Drawer metadata: enforcement, per-action fallback and grant provenance.
drop function if exists public.list_project_permission_rooms(text, text);
create function public.list_project_permission_rooms(
  p_project_id text default null,
  p_construction_site_id text default null
)
returns table (
  code text,
  group_code text,
  name text,
  description text,
  allowed_actions text[],
  required_actions text[],
  sort_order integer,
  action_enforcement_statuses jsonb,
  action_pbac_fallback_enabled jsonb,
  fallback_only_user_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  select
    room.code,
    room.group_code,
    room.name,
    room.description,
    room.allowed_actions,
    room.required_actions,
    room.sort_order,
    coalesce(binding.statuses, '{}'::jsonb),
    coalesce(binding.fallbacks, '{}'::jsonb),
    case when nullif(p_project_id, '') is null then 0::bigint
         else coalesce(fallback.count, 0) end
  from public.project_permission_rooms room
  left join lateral (
    select
      jsonb_object_agg(item.action_code, item.enforcement_status order by item.action_code) statuses,
      jsonb_object_agg(item.action_code, item.pbac_fallback_enabled order by item.action_code) fallbacks
    from app_private.project_permission_room_action_bindings item
    where item.room_code = room.code
  ) binding on true
  left join lateral (
    select count(distinct staff.user_id)::bigint count
    from public.project_staff staff
    join public.users user_row on user_row.id::text = staff.user_id
      and coalesce(user_row.is_active, true)
    where staff.project_id = p_project_id
      and user_row.role <> 'ADMIN'
      and staff.end_date is null
      and (
        nullif(p_construction_site_id, '') is null
        or staff.construction_site_id is null
        or staff.construction_site_id = p_construction_site_id
      )
      and exists (
        select 1
        from app_private.project_permission_room_action_bindings item
        where item.room_code = room.code
          and item.enforcement_status in ('pilot', 'enforced')
          and item.pbac_fallback_enabled
          and app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
          and app_private.project_actor_has_effective_room_action(
            user_row.id, p_project_id, nullif(p_construction_site_id, ''),
            item.room_code, item.action_code
          )
          and not app_private.project_user_has_room_action(
            user_row.id, p_project_id, nullif(p_construction_site_id, ''),
            item.room_code, item.action_code
          )
      )
  ) fallback on true
  where room.is_active
  order by room.sort_order, room.code;
$$;

revoke all on function public.list_project_permission_rooms(text, text) from public, anon;
grant execute on function public.list_project_permission_rooms(text, text) to authenticated;

drop function if exists public.get_project_permission_room(text, text, text);
create function public.get_project_permission_room(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text
)
returns table (
  room_code text,
  group_code text,
  name text,
  description text,
  allowed_actions text[],
  required_actions text[],
  sort_order integer,
  action_enforcement_statuses jsonb,
  action_pbac_fallback_enabled jsonb,
  member_id uuid,
  project_staff_id uuid,
  user_id uuid,
  user_name text,
  user_avatar text,
  position_name text,
  construction_site_id text,
  action_codes text[],
  action_grant_sources jsonb,
  legacy_permission_codes text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  select
    room.code,
    room.group_code,
    room.name,
    room.description,
    room.allowed_actions,
    room.required_actions,
    room.sort_order,
    coalesce(binding.statuses, '{}'::jsonb),
    coalesce(binding.fallbacks, '{}'::jsonb),
    member.id,
    staff.id,
    user_row.id,
    user_row.name,
    user_row.avatar,
    position.name,
    staff.construction_site_id,
    coalesce(actions.action_codes, '{}'::text[]),
    coalesce(actions.grant_sources, '{}'::jsonb),
    coalesce(legacy.codes, '{}'::text[])
  from public.project_permission_rooms room
  left join lateral (
    select
      jsonb_object_agg(item.action_code, item.enforcement_status order by item.action_code) statuses,
      jsonb_object_agg(item.action_code, item.pbac_fallback_enabled order by item.action_code) fallbacks
    from app_private.project_permission_room_action_bindings item
    where item.room_code = room.code
  ) binding on true
  left join public.project_permission_room_members member
    on member.room_code = room.code
    and member.project_id = p_project_id
    and member.construction_site_id is not distinct from nullif(p_construction_site_id, '')
    and member.is_active
  left join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
  left join public.users user_row on user_row.id::text = staff.user_id
    and coalesce(user_row.is_active, true)
  left join public.hrm_positions position on position.id = staff.position_id
  left join lateral (
    select
      array_agg(action.action_code order by action.action_code) action_codes,
      jsonb_object_agg(action.action_code, action.grant_source order by action.action_code) grant_sources
    from public.project_permission_room_member_actions action
    where action.room_member_id = member.id and action.is_active
  ) actions on true
  left join lateral (
    select array_agg(distinct grant_row.permission_code order by grant_row.permission_code) codes
    from public.user_permission_grants grant_row
    where grant_row.user_id = user_row.id
      and grant_row.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and (
        grant_row.scope_type = 'global'
        or (grant_row.scope_type = 'project' and grant_row.scope_id in ('*', p_project_id))
        or (nullif(p_construction_site_id, '') is not null
            and grant_row.scope_type = 'construction_site'
            and grant_row.scope_id in ('*', p_construction_site_id))
      )
      and (
        grant_row.permission_code = any(coalesce((
          select array_agg(mapped.code)
          from app_private.project_permission_room_action_bindings item
          cross join lateral unnest(item.legacy_permission_codes) mapped(code)
          where item.room_code = room.code
        ), '{}'::text[]))
        or (room.code = 'material_po' and grant_row.permission_code = 'project.material_po.manage')
        or (room.code = 'daily_log' and grant_row.permission_code in (
          'project.daily_log.edit_all', 'project.daily_log.delete_all',
          'project.daily_log.return', 'project.daily_log.manage', 'project.daily_log.confirm'
        ))
      )
  ) legacy on true
  where room.code = p_room_code and room.is_active
  order by user_row.name nulls last, member.id;
$$;

revoke all on function public.get_project_permission_room(text, text, text) from public, anon;
grant execute on function public.get_project_permission_room(text, text, text) to authenticated;

create or replace function public.list_project_room_staff_candidates(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text
)
returns table (
  project_staff_id uuid,
  user_id uuid,
  user_name text,
  user_avatar text,
  position_name text,
  construction_site_id text,
  legacy_permission_codes text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  select
    staff.id,
    user_row.id,
    user_row.name,
    user_row.avatar,
    position.name,
    staff.construction_site_id,
    coalesce(legacy.codes, '{}'::text[])
  from public.project_staff staff
  join public.users user_row on user_row.id::text = staff.user_id
  left join public.hrm_positions position on position.id = staff.position_id
  left join lateral (
    select array_agg(distinct grant_row.permission_code order by grant_row.permission_code) codes
    from public.user_permission_grants grant_row
    where grant_row.user_id = user_row.id
      and grant_row.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and (
        grant_row.scope_type = 'global'
        or (grant_row.scope_type = 'project' and grant_row.scope_id in ('*', p_project_id))
        or (nullif(p_construction_site_id, '') is not null
            and grant_row.scope_type = 'construction_site'
            and grant_row.scope_id in ('*', p_construction_site_id))
      )
      and (
        (p_room_code = 'material_po' and grant_row.permission_code like 'project.material_po.%')
        or (p_room_code = 'daily_log' and grant_row.permission_code in (
          'project.daily_log.edit_all', 'project.daily_log.delete_all',
          'project.daily_log.return', 'project.daily_log.manage', 'project.daily_log.confirm'
        ))
      )
  ) legacy on true
  where staff.project_id = p_project_id
    and staff.end_date is null
    and coalesce(user_row.is_active, true)
    and (
      nullif(p_construction_site_id, '') is null
      or staff.construction_site_id is null
      or staff.construction_site_id = p_construction_site_id
    )
  order by user_row.name, staff.id;
$$;

revoke all on function public.list_project_room_staff_candidates(text, text, text) from public, anon;
grant execute on function public.list_project_room_staff_candidates(text, text, text) to authenticated;

-- PBAC PO is now audit-only. Updating unrelated PBAC permissions preserves all
-- existing PO grants but the RPC no longer accepts a new PO grant in payload.
revoke all on function app_private.replace_project_staff_permission_grants(uuid, jsonb)
  from authenticated;

create or replace function public.replace_project_staff_permission_grants(
  p_staff_id uuid,
  p_grants jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff record;
  v_scope_type text;
  v_scope_id text;
  v_preserved_po_grants jsonb;
begin
  if jsonb_typeof(coalesce(p_grants, 'null'::jsonb)) <> 'array' then
    raise exception 'Project staff grants must be a JSON array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_grants) grant_row(permission_code text, is_active boolean)
    where grant_row.permission_code like 'project.material_po.%'
      and coalesce(grant_row.is_active, true)
  ) then
    raise exception 'Quyền PBAC Đơn hàng PO đã chuyển sang Room và không thể cấp mới.'
      using errcode = '42501';
  end if;

  select staff.* into v_staff
  from public.project_staff staff
  where staff.id = p_staff_id;

  if v_staff.id is null then
    raise exception 'Project staff row does not exist' using errcode = '23503';
  end if;

  if v_staff.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Project staff user_id is not a UUID: %', v_staff.user_id using errcode = '22P02';
  end if;

  v_scope_type := case when nullif(v_staff.construction_site_id, '') is not null
    then 'construction_site' else 'project' end;
  v_scope_id := coalesce(nullif(v_staff.construction_site_id, ''), nullif(v_staff.project_id, ''));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', grant_row.id,
    'user_id', grant_row.user_id,
    'permission_code', grant_row.permission_code,
    'scope_type', grant_row.scope_type,
    'scope_id', grant_row.scope_id,
    'is_active', grant_row.is_active,
    'granted_by', grant_row.granted_by,
    'granted_at', grant_row.granted_at,
    'expires_at', grant_row.expires_at,
    'created_at', grant_row.created_at,
    'updated_at', grant_row.updated_at,
    'revoked_at', grant_row.revoked_at,
    'revoked_by', grant_row.revoked_by,
    'revoked_reason', grant_row.revoked_reason
  ) order by grant_row.permission_code), '[]'::jsonb)
  into v_preserved_po_grants
  from public.user_permission_grants grant_row
  where grant_row.user_id = v_staff.user_id::uuid
    and grant_row.scope_type = v_scope_type
    and grant_row.scope_id = v_scope_id
    and grant_row.permission_code like 'project.material_po.%';

  perform app_private.replace_project_staff_permission_grants(
    p_staff_id,
    coalesce(p_grants, '[]'::jsonb) || v_preserved_po_grants
  );

  -- Restore the audit rows byte-for-byte after the legacy replacement helper
  -- rebuilt its projection. This includes inactive/revoked PO grants.
  delete from public.user_permission_grants grant_row
  where grant_row.user_id = v_staff.user_id::uuid
    and grant_row.scope_type = v_scope_type
    and grant_row.scope_id = v_scope_id
    and grant_row.permission_code like 'project.material_po.%';

  insert into public.user_permission_grants (
    id, user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, expires_at, created_at, updated_at,
    revoked_at, revoked_by, revoked_reason
  )
  select
    preserved.id, preserved.user_id, preserved.permission_code,
    preserved.scope_type, preserved.scope_id, preserved.is_active,
    preserved.granted_by, preserved.granted_at, preserved.expires_at,
    preserved.created_at, preserved.updated_at,
    preserved.revoked_at, preserved.revoked_by, preserved.revoked_reason
  from jsonb_to_recordset(v_preserved_po_grants) preserved(
    id uuid, user_id uuid, permission_code text, scope_type text, scope_id text,
    is_active boolean, granted_by uuid, granted_at timestamptz,
    expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
    revoked_at timestamptz, revoked_by uuid, revoked_reason text
  );
end;
$$;

revoke all on function public.replace_project_staff_permission_grants(uuid, jsonb) from public, anon;
grant execute on function public.replace_project_staff_permission_grants(uuid, jsonb) to authenticated;

create or replace function app_private.guard_material_po_pbac_grant_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin')
    and new.permission_code like 'project.material_po.%'
    and (
      tg_op = 'INSERT'
      or old.permission_code not like 'project.material_po.%'
      or (not old.is_active and new.is_active)
    )
  then
    raise exception 'Quyền PBAC Đơn hàng PO đã chuyển sang Room và không thể cấp mới.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_material_po_pbac_grant_write()
  from public, anon, authenticated;

drop trigger if exists guard_material_po_pbac_grant_write on public.user_permission_grants;
create trigger guard_material_po_pbac_grant_write
before insert or update on public.user_permission_grants
for each row execute function app_private.guard_material_po_pbac_grant_write();

-- Parent visibility contract used by PO and all dependent records.
create or replace function app_private.company_purchase_order_can_view_from_links(
  p_purchase_order_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_order_request_lines link
    where link.purchase_order_id = p_purchase_order_id
      and app_private.current_actor_has_effective_room_action(
        link.project_id, link.construction_site_id, 'material_po', 'view'
      )
  );
$$;

create or replace function app_private.purchase_order_can_view(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_orders po
    where po.id = p_purchase_order_id
      and po.archived_at is null
      and (
        (
          po.source_mode = 'company_consolidated'
          and (
            app_private.company_procurement_can_manage()
            or app_private.company_purchase_order_can_view_from_links(po.id)
          )
        )
        or (
          po.source_mode is distinct from 'company_consolidated'
          and (
            app_private.current_actor_has_effective_room_action(
              po.project_id, po.construction_site_id, 'material_po', 'view'
            )
            or app_private.current_user_is_global_wms_keeper()
            or app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          )
        )
      )
  );
$$;

revoke all on function app_private.purchase_order_can_view(text) from public, anon;
grant execute on function app_private.purchase_order_can_view(text) to authenticated;
revoke all on function app_private.company_purchase_order_can_view_from_links(text) from public, anon;
grant execute on function app_private.company_purchase_order_can_view_from_links(text) to authenticated;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (app_private.purchase_order_can_view(id));

create or replace function app_private.purchase_order_link_can_access(
  p_purchase_order_id text,
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.purchase_order_can_view(p_purchase_order_id)
    or app_private.current_actor_has_effective_room_action(
      p_project_id, p_construction_site_id, 'material_po', 'view'
    );
$$;

create or replace function app_private.purchase_order_delivery_group_can_access(
  p_purchase_order_id text,
  p_project_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.purchase_order_can_view(p_purchase_order_id);
$$;

create or replace function app_private.purchase_order_delivery_can_view(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.purchase_order_can_view(p_purchase_order_id);
$$;

create or replace function app_private.purchase_order_supplemental_can_view(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.purchase_order_can_view(p_purchase_order_id);
$$;

revoke all on function app_private.purchase_order_link_can_access(text, text, text) from public, anon;
revoke all on function app_private.purchase_order_delivery_group_can_access(text, text) from public, anon;
revoke all on function app_private.purchase_order_delivery_can_view(text) from public, anon;
revoke all on function app_private.purchase_order_supplemental_can_view(text) from public, anon;
grant execute on function app_private.purchase_order_link_can_access(text, text, text) to authenticated;
grant execute on function app_private.purchase_order_delivery_group_can_access(text, text) to authenticated;
grant execute on function app_private.purchase_order_delivery_can_view(text) to authenticated;
grant execute on function app_private.purchase_order_supplemental_can_view(text) to authenticated;

create or replace function app_private.purchase_order_delivery_can_mutate(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or app_private.company_procurement_can_manage()
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.project_actor_has_effective_room_action(
            public.current_app_user_id(), po.project_id, po.construction_site_id,
            'material_po', 'confirm'
          )
          or (
            po.status in ('draft', 'returned')
            and nullif(po.created_by_id, '') = public.current_app_user_id()::text
            and app_private.project_actor_has_effective_room_action(
              public.current_app_user_id(), po.project_id, po.construction_site_id,
              'material_po', 'edit'
            )
          )
        )
    );
$$;

create or replace function app_private.purchase_order_can_receive(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.project_actor_has_effective_room_action(
            public.current_app_user_id(), po.project_id, po.construction_site_id,
            'material_po', 'confirm'
          )
        )
    );
$$;

revoke all on function app_private.purchase_order_delivery_can_mutate(text) from public, anon;
revoke all on function app_private.purchase_order_can_receive(text) from public, anon;
grant execute on function app_private.purchase_order_delivery_can_mutate(text) to authenticated;
grant execute on function app_private.purchase_order_can_receive(text) to authenticated;

drop policy if exists purchase_order_supplier_returns_select on public.purchase_order_supplier_returns;
create policy purchase_order_supplier_returns_select
on public.purchase_order_supplier_returns
for select to authenticated
using (
  app_private.purchase_order_can_view(purchase_order_id)
  or app_private.current_user_is_global_wms_keeper()
  or app_private.current_user_is_wms_keeper_for(source_warehouse_id)
);

drop policy if exists purchase_order_supplier_return_lines_select on public.purchase_order_supplier_return_lines;
create policy purchase_order_supplier_return_lines_select
on public.purchase_order_supplier_return_lines
for select to authenticated
using (
  exists (
    select 1
    from public.purchase_order_supplier_returns return_row
    where return_row.id = supplier_return_id
      and (
        app_private.purchase_order_can_view(return_row.purchase_order_id)
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(return_row.source_warehouse_id)
      )
  )
);

create or replace function public.get_project_permission_room_health_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actions_not_connected jsonb := '[]'::jsonb;
  v_fallback_only_users jsonb := '[]'::jsonb;
  v_inactive_legacy_pbac jsonb := '[]'::jsonb;
  v_unmapped_grants jsonb := '[]'::jsonb;
  v_invalid_scope_or_staff jsonb := '[]'::jsonb;
begin
  perform app_private.assert_project_permission_room_admin();

  select coalesce(jsonb_agg(jsonb_build_object(
    'roomCode', binding.room_code,
    'actionCode', binding.action_code,
    'enforcementStatus', binding.enforcement_status,
    'pbacFallbackEnabled', binding.pbac_fallback_enabled,
    'verifiedSource', binding.verified_source,
    'verifiedAt', binding.verified_at,
    'severity', case when binding.enforcement_status = 'audit_only' then 'medium' else 'info' end
  ) order by binding.room_code, binding.action_code), '[]'::jsonb)
  into v_actions_not_connected
  from app_private.project_permission_room_action_bindings binding
  where binding.enforcement_status <> 'enforced';

  select coalesce(jsonb_agg(to_jsonb(finding)
    order by finding.project_id, finding.room_code, finding.action_code, finding.user_id), '[]'::jsonb)
  into v_fallback_only_users
  from (
    select distinct
      staff.project_id as "projectId",
      staff.construction_site_id as "constructionSiteId",
      binding.room_code as "roomCode",
      binding.action_code as "actionCode",
      user_row.id as "userId",
      user_row.name as "userName",
      'medium'::text as severity,
      staff.project_id, binding.room_code, binding.action_code, user_row.id as user_id
    from public.project_staff staff
    join public.users user_row on user_row.id::text = staff.user_id
      and coalesce(user_row.is_active, true)
    join app_private.project_permission_room_action_bindings binding
      on binding.enforcement_status in ('pilot', 'enforced')
      and binding.pbac_fallback_enabled
    where staff.end_date is null
      and user_row.role <> 'ADMIN'
      and app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
      and app_private.project_actor_has_effective_room_action(
        user_row.id, staff.project_id, staff.construction_site_id,
        binding.room_code, binding.action_code
      )
      and not app_private.project_user_has_room_action(
        user_row.id, staff.project_id, staff.construction_site_id,
        binding.room_code, binding.action_code
      )
  ) finding;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', grant_row.user_id,
    'userName', user_row.name,
    'permissionCode', grant_row.permission_code,
    'scopeType', grant_row.scope_type,
    'scopeId', grant_row.scope_id,
    'roomCode', binding.room_code,
    'actionCode', binding.action_code,
    'issueCode', 'pbac_retained_for_audit',
    'severity', 'info'
  ) order by grant_row.permission_code, grant_row.user_id), '[]'::jsonb)
  into v_inactive_legacy_pbac
  from public.user_permission_grants grant_row
  join public.users user_row on user_row.id = grant_row.user_id
  join app_private.project_permission_room_action_bindings binding
    on grant_row.permission_code = any(binding.legacy_permission_codes)
    and not binding.pbac_fallback_enabled
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now());

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', grant_row.user_id,
    'permissionCode', grant_row.permission_code,
    'scopeType', grant_row.scope_type,
    'scopeId', grant_row.scope_id,
    'severity', 'medium'
  ) order by grant_row.permission_code, grant_row.user_id), '[]'::jsonb)
  into v_unmapped_grants
  from (
    select grant_item.*
    from public.user_permission_grants grant_item
    where grant_item.is_active
      and (grant_item.expires_at is null or grant_item.expires_at > now())
      and grant_item.permission_code like 'project.%'
      and not exists (
        select 1 from app_private.project_permission_room_action_bindings binding
        where grant_item.permission_code = any(binding.legacy_permission_codes)
      )
    order by grant_item.permission_code, grant_item.user_id
    limit 500
  ) grant_row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'roomMemberId', member.id,
    'projectId', member.project_id,
    'constructionSiteId', member.construction_site_id,
    'roomCode', member.room_code,
    'projectStaffId', member.project_staff_id,
    'userId', user_row.id,
    'issueCode', case
      when staff.id is null then 'orphan_room_member'
      when user_row.id is null then 'missing_user'
      when staff.end_date is not null then 'inactive_project_staff'
      when not coalesce(user_row.is_active, false) then 'inactive_user'
      else 'scope_mismatch'
    end,
    'severity', 'high'
  ) order by member.project_id, member.room_code, member.id), '[]'::jsonb)
  into v_invalid_scope_or_staff
  from public.project_permission_room_members member
  left join public.project_staff staff on staff.id = member.project_staff_id
  left join public.users user_row on user_row.id::text = staff.user_id
  where member.is_active
    and (
      staff.id is null or user_row.id is null or staff.end_date is not null
      or not coalesce(user_row.is_active, false)
      or staff.project_id is distinct from member.project_id
      or (member.construction_site_id is not null and staff.construction_site_id is not null
          and member.construction_site_id is distinct from staff.construction_site_id)
    );

  return jsonb_build_object(
    'generatedAt', now(),
    'projectRoomPbacFallbackEnabled',
      app_private.permission_hardening_flag('project_room_pbac_fallback_enabled'),
    'checks', jsonb_build_object(
      'roomActionsNotConnected', v_actions_not_connected,
      'roomFallbackOnlyUsers', v_fallback_only_users,
      'roomInactiveLegacyPbacGrants', v_inactive_legacy_pbac,
      'roomUnmappedGrants', v_unmapped_grants,
      'roomInvalidScopeOrStaff', v_invalid_scope_or_staff
    )
  );
end;
$$;

revoke all on function public.get_project_permission_room_health_summary() from public, anon;
grant execute on function public.get_project_permission_room_health_summary() to authenticated;

notify pgrst, 'reload schema';
