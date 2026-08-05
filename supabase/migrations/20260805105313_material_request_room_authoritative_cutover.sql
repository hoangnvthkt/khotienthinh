-- Reusable authoritative Room cutover and Material Request pilot.
-- Module/submodule grants only open the Material shell. Project/site business
-- access is decided by the Room registry below.

alter table app_private.project_permission_room_action_bindings
  add column if not exists prerequisite_action_codes text[] not null default '{}'::text[];

update app_private.project_permission_room_action_bindings
set prerequisite_action_codes = case when action_code = 'view' then '{}'::text[] else array['view']::text[] end,
    updated_at = now()
where room_code in ('material_po', 'material_request')
  and action_code in ('view', 'edit', 'delete', 'submit', 'approve', 'confirm', 'view_available_stock');

update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.material_request.view']::text[]
      when 'edit' then array['project.material_request.create', 'project.material_request.edit_own']::text[]
      when 'delete' then array['project.material_request.delete_own']::text[]
      when 'submit' then array['project.material_request.submit']::text[]
      when 'approve' then array['project.material_request.approve']::text[]
      when 'confirm' then array['project.material_request.confirm_fulfillment']::text[]
      when 'view_available_stock' then array['project.material_request.view_available_stock']::text[]
      else legacy_permission_codes
    end,
    enforcement_status = case when action_code = 'verify' then 'audit_only' else 'pilot' end,
    pbac_fallback_enabled = case when action_code = 'verify' then true else false end,
    relationship_description = case action_code
      when 'view' then 'Full Material Request read access in this project/site.'
      when 'edit' then 'Create and edit own draft, rejected or returned request.'
      when 'delete' then 'Delete own request while deletion is allowed.'
      when 'submit' then 'Owner starts or resubmits the request workflow.'
      when 'approve' then 'Current assignee approves, returns or rejects the workflow step.'
      when 'confirm' then 'Current fulfillment assignee plans and manages fulfillment batches.'
      when 'view_available_stock' then 'Read aggregate available stock in an allowed project/WMS warehouse.'
      else 'Reserved for a future, separately verified workflow step.'
    end,
    verified_at = now(),
    verified_source = 'material_request_room_authoritative_cutover_2026_08_05',
    updated_at = now()
where room_code = 'material_request';

update public.project_permission_rooms
set required_actions = '{}'::text[], updated_at = now()
where code = 'material_request';

-- Safe union backfill. Only exact project/site scopes that resolve to one
-- active non-admin project_staff row are converted. Existing manual grants
-- and their provenance are never overwritten.
create temporary table material_request_room_backfill_candidates on commit drop as
with permission_mapping(permission_code, action_code) as (
  values
    ('project.material_request.view', 'view'),
    ('project.material_request.create', 'edit'),
    ('project.material_request.edit_own', 'edit'),
    ('project.material_request.delete_own', 'delete'),
    ('project.material_request.submit', 'submit'),
    ('project.material_request.approve', 'approve'),
    ('project.material_request.confirm_fulfillment', 'confirm'),
    ('project.material_request.view_available_stock', 'view_available_stock')
), candidates as (
  select
    grant_row.id as grant_id,
    grant_row.user_id,
    grant_row.granted_by,
    staff.id as project_staff_id,
    staff.project_id,
    case when grant_row.scope_type = 'construction_site' then staff.construction_site_id else null end as construction_site_id,
    mapping.action_code,
    count(*) over (partition by grant_row.id, mapping.action_code) as matching_staff_count
  from public.user_permission_grants grant_row
  join permission_mapping mapping on mapping.permission_code = grant_row.permission_code
  join public.users user_row on user_row.id = grant_row.user_id
    and coalesce(user_row.is_active, true) and user_row.role <> 'ADMIN'
  join public.project_staff staff
    on staff.user_id = grant_row.user_id::text
    and staff.end_date is null
    and (
      (grant_row.scope_type = 'project' and grant_row.scope_id = staff.project_id and staff.construction_site_id is null)
      or (grant_row.scope_type = 'construction_site' and grant_row.scope_id = staff.construction_site_id)
    )
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and grant_row.scope_type in ('project', 'construction_site')
), exact_candidates as (
  select distinct user_id, granted_by, project_staff_id, project_id,
    construction_site_id, action_code
  from candidates
  where matching_staff_count = 1
)
select * from exact_candidates
union
select user_id, granted_by, project_staff_id, project_id, construction_site_id, 'view'
from exact_candidates
where action_code <> 'view';

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id,
  is_active, created_by, updated_at
)
select distinct project_id, construction_site_id, 'material_request', project_staff_id,
  true, granted_by, now()
from material_request_room_backfill_candidates
on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
do update set is_active = true, updated_at = now();

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by, granted_at, updated_at, grant_source
)
select distinct member.id, candidate.action_code, true, candidate.granted_by, now(), now(), 'pbac_backfill'
from material_request_room_backfill_candidates candidate
join public.project_permission_room_members member
  on member.project_id = candidate.project_id
  and member.construction_site_id is not distinct from candidate.construction_site_id
  and member.room_code = 'material_request'
  and member.project_staff_id = candidate.project_staff_id
on conflict (room_member_id, action_code) do update
set is_active = true,
    grant_source = case
      when public.project_permission_room_member_actions.is_active
        then public.project_permission_room_member_actions.grant_source
      else 'pbac_backfill'
    end,
    updated_at = now();

insert into public.permission_audit_events (
  actor_user_id, event_type, before_grants, after_grants, metadata
)
select null, 'project_room_pbac_backfill', '[]'::jsonb,
  coalesce(jsonb_agg(jsonb_build_object(
    'user_id', candidate.user_id,
    'project_staff_id', candidate.project_staff_id,
    'project_id', candidate.project_id,
    'construction_site_id', candidate.construction_site_id,
    'room_code', 'material_request',
    'action_code', candidate.action_code
  )), '[]'::jsonb),
  jsonb_build_object(
    'source', 'project_room_pbac_backfill',
    'room_code', 'material_request',
    'row_count', count(*)
  )
from material_request_room_backfill_candidates candidate;

-- Wrap the existing battle-tested replacement routine. The wrapper is the
-- reusable contract: audit-only actions are immutable/preserved and every
-- action must include all registry prerequisites.
do $$
begin
  if to_regprocedure('app_private.replace_project_permission_room_members(text,text,text,jsonb)') is not null
     and to_regprocedure('app_private.replace_project_permission_room_members_room_cutover_legacy(text,text,text,jsonb)') is null then
    alter function app_private.replace_project_permission_room_members(text, text, text, jsonb)
      rename to replace_project_permission_room_members_room_cutover_legacy;
  end if;
end $$;

create function app_private.replace_project_permission_room_members(
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
  v_scope_site_id text := nullif(p_construction_site_id, '');
  v_effective_members jsonb;
begin
  if jsonb_typeof(coalesce(p_members, 'null'::jsonb)) <> 'array' then
    raise exception 'Room members must be a JSON array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
    cross join lateral jsonb_array_elements_text(coalesce(item.action_codes, '[]'::jsonb)) code(action_code)
    join app_private.project_permission_room_action_bindings binding
      on binding.room_code = p_room_code and binding.action_code = code.action_code
    where binding.enforcement_status = 'audit_only'
      and not exists (
        select 1
        from public.project_permission_room_members member
        join public.project_permission_room_member_actions action on action.room_member_id = member.id
        where member.project_id = p_project_id
          and member.construction_site_id is not distinct from v_scope_site_id
          and member.room_code = p_room_code
          and member.project_staff_id = item.project_staff_id
          and member.is_active and action.is_active
          and action.action_code = code.action_code
      )
  ) then
    raise exception 'Action chưa áp dụng đầy đủ không thể được cấp mới.' using errcode = '23514';
  end if;

  with payload as (
    select item.project_staff_id,
      coalesce(array_agg(distinct code.action_code) filter (
        where coalesce(binding.enforcement_status, 'audit_only') <> 'audit_only'
      ), '{}'::text[]) action_codes
    from jsonb_to_recordset(p_members) item(project_staff_id uuid, action_codes jsonb)
    left join lateral jsonb_array_elements_text(coalesce(item.action_codes, '[]'::jsonb)) code(action_code) on true
    left join app_private.project_permission_room_action_bindings binding
      on binding.room_code = p_room_code and binding.action_code = code.action_code
    group by item.project_staff_id
  ), locked as (
    select member.project_staff_id, array_agg(action.action_code order by action.action_code) action_codes
    from public.project_permission_room_members member
    join public.project_permission_room_member_actions action
      on action.room_member_id = member.id and action.is_active
    join app_private.project_permission_room_action_bindings binding
      on binding.room_code = member.room_code
      and binding.action_code = action.action_code
      and binding.enforcement_status = 'audit_only'
    where member.project_id = p_project_id
      and member.construction_site_id is not distinct from v_scope_site_id
      and member.room_code = p_room_code
      and member.is_active
    group by member.project_staff_id
  ), combined as (
    select coalesce(payload.project_staff_id, locked.project_staff_id) project_staff_id,
      array(select distinct code from unnest(
        coalesce(payload.action_codes, '{}'::text[]) || coalesce(locked.action_codes, '{}'::text[])
      ) code order by code) action_codes
    from payload full join locked using (project_staff_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_staff_id', project_staff_id,
    'action_codes', to_jsonb(action_codes)
  ) order by project_staff_id), '[]'::jsonb)
  into v_effective_members
  from combined
  where cardinality(action_codes) > 0;

  if exists (
    select 1
    from jsonb_to_recordset(v_effective_members) item(project_staff_id uuid, action_codes jsonb)
    cross join lateral jsonb_array_elements_text(item.action_codes) code(action_code)
    join app_private.project_permission_room_action_bindings binding
      on binding.room_code = p_room_code and binding.action_code = code.action_code
    cross join lateral unnest(binding.prerequisite_action_codes) required(action_code)
    where not (item.action_codes ? required.action_code)
  ) then
    raise exception 'Quyền nghiệp vụ phải đi cùng quyền tiên quyết trong Room.' using errcode = '23514';
  end if;

  perform app_private.replace_project_permission_room_members_room_cutover_legacy(
    p_project_id, v_scope_site_id, p_room_code, v_effective_members
  );
end;
$$;

revoke all on function app_private.replace_project_permission_room_members(text, text, text, jsonb)
  from public, anon, authenticated;

-- Effective actor authorization is registry-driven. System Admin remains an
-- operational override, while the pure recipient helper is intentionally not
-- changed and never treats Admin as a Room recipient.
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
    select item.enforcement_status, item.legacy_permission_codes,
      item.pbac_fallback_enabled, item.prerequisite_action_codes
    from app_private.project_permission_room_action_bindings item
    where item.room_code = p_room_code and item.action_code = p_action_code
  ), actor as (
    select user_row.id, user_row.role
    from public.users user_row
    where user_row.id = p_user_id and coalesce(user_row.is_active, true)
  ), scoped_actor as (
    select actor.id, actor.role
    from actor
    where actor.role = 'ADMIN'
      or exists (
        select 1 from public.project_staff staff
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
    from binding cross join scoped_actor
    where scoped_actor.role = 'ADMIN'
      or (
        binding.enforcement_status in ('pilot', 'enforced')
        and app_private.project_user_has_room_action(
          scoped_actor.id, p_project_id, nullif(p_construction_site_id, ''),
          p_room_code, p_action_code
        )
        and not exists (
          select 1 from unnest(binding.prerequisite_action_codes) required(action_code)
          where not app_private.project_user_has_room_action(
            scoped_actor.id, p_project_id, nullif(p_construction_site_id, ''),
            p_room_code, required.action_code
          )
        )
      )
      or (
        binding.pbac_fallback_enabled
        and app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
        and exists (
          select 1 from unnest(binding.legacy_permission_codes) legacy(permission_code)
          where app_private.project_has_permission_v2(
            p_project_id, nullif(p_construction_site_id, ''),
            legacy.permission_code, scoped_actor.id
          )
        )
      )
  );
$$;

revoke all on function app_private.project_actor_has_effective_room_action(uuid, text, text, text, text)
  from public, anon, authenticated;

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
  action_prerequisite_actions jsonb,
  fallback_only_user_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  select room.code, room.group_code, room.name, room.description,
    room.allowed_actions, room.required_actions, room.sort_order,
    coalesce(binding.statuses, '{}'::jsonb),
    coalesce(binding.fallbacks, '{}'::jsonb),
    coalesce(binding.prerequisites, '{}'::jsonb),
    case when nullif(p_project_id, '') is null then 0::bigint
      else coalesce(fallback.count, 0) end
  from public.project_permission_rooms room
  left join lateral (
    select
      jsonb_object_agg(item.action_code, item.enforcement_status order by item.action_code) statuses,
      jsonb_object_agg(item.action_code, item.pbac_fallback_enabled order by item.action_code) fallbacks,
      jsonb_object_agg(item.action_code, to_jsonb(item.prerequisite_action_codes) order by item.action_code) prerequisites
    from app_private.project_permission_room_action_bindings item
    where item.room_code = room.code
  ) binding on true
  left join lateral (
    select count(distinct staff.user_id)::bigint count
    from public.project_staff staff
    join public.users user_row on user_row.id::text = staff.user_id
      and coalesce(user_row.is_active, true)
    where staff.project_id = p_project_id
      and staff.end_date is null and user_row.role <> 'ADMIN'
      and (
        nullif(p_construction_site_id, '') is null
        or staff.construction_site_id is null
        or staff.construction_site_id = p_construction_site_id
      )
      and exists (
        select 1 from app_private.project_permission_room_action_bindings item
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
  select staff.id, user_row.id, user_row.name, user_row.avatar, position.name,
    staff.construction_site_id, coalesce(legacy.codes, '{}'::text[])
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
        or (p_room_code = 'material_request' and grant_row.permission_code like 'project.material_request.%')
        or (p_room_code = 'daily_log' and grant_row.permission_code in (
          'project.daily_log.edit_all', 'project.daily_log.delete_all',
          'project.daily_log.return', 'project.daily_log.manage', 'project.daily_log.confirm'
        ))
      )
  ) legacy on true
  where staff.project_id = p_project_id
    and staff.end_date is null and coalesce(user_row.is_active, true)
    and (
      nullif(p_construction_site_id, '') is null
      or staff.construction_site_id is null
      or staff.construction_site_id = p_construction_site_id
    )
  order by user_row.name, staff.id;
$$;

revoke all on function public.list_project_room_staff_candidates(text, text, text) from public, anon;
grant execute on function public.list_project_room_staff_candidates(text, text, text) to authenticated;

-- Material Request PBAC is retained byte-for-byte for audit, but can no longer
-- be granted/reactivated through the public replacement RPC or direct writes.
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
  v_preserved_cutover_grants jsonb;
begin
  if jsonb_typeof(coalesce(p_grants, 'null'::jsonb)) <> 'array' then
    raise exception 'Project staff grants must be a JSON array' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_grants) grant_row(permission_code text, is_active boolean)
    where (grant_row.permission_code like 'project.material_po.%'
      or grant_row.permission_code like 'project.material_request.%')
      and coalesce(grant_row.is_active, true)
  ) then
    raise exception 'Quyền PBAC PO/Yêu cầu đã chuyển sang Room và không thể cấp mới.'
      using errcode = '42501';
  end if;

  select staff.* into v_staff from public.project_staff staff where staff.id = p_staff_id;
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
    'id', grant_row.id, 'user_id', grant_row.user_id,
    'permission_code', grant_row.permission_code,
    'scope_type', grant_row.scope_type, 'scope_id', grant_row.scope_id,
    'is_active', grant_row.is_active, 'granted_by', grant_row.granted_by,
    'granted_at', grant_row.granted_at, 'expires_at', grant_row.expires_at,
    'created_at', grant_row.created_at, 'updated_at', grant_row.updated_at,
    'revoked_at', grant_row.revoked_at, 'revoked_by', grant_row.revoked_by,
    'revoked_reason', grant_row.revoked_reason
  ) order by grant_row.permission_code), '[]'::jsonb)
  into v_preserved_cutover_grants
  from public.user_permission_grants grant_row
  where grant_row.user_id = v_staff.user_id::uuid
    and grant_row.scope_type = v_scope_type and grant_row.scope_id = v_scope_id
    and (grant_row.permission_code like 'project.material_po.%'
      or grant_row.permission_code like 'project.material_request.%');

  perform app_private.replace_project_staff_permission_grants(
    p_staff_id, coalesce(p_grants, '[]'::jsonb) || v_preserved_cutover_grants
  );

  delete from public.user_permission_grants grant_row
  where grant_row.user_id = v_staff.user_id::uuid
    and grant_row.scope_type = v_scope_type and grant_row.scope_id = v_scope_id
    and (grant_row.permission_code like 'project.material_po.%'
      or grant_row.permission_code like 'project.material_request.%');

  insert into public.user_permission_grants (
    id, user_id, permission_code, scope_type, scope_id, is_active,
    granted_by, granted_at, expires_at, created_at, updated_at,
    revoked_at, revoked_by, revoked_reason
  )
  select preserved.id, preserved.user_id, preserved.permission_code,
    preserved.scope_type, preserved.scope_id, preserved.is_active,
    preserved.granted_by, preserved.granted_at, preserved.expires_at,
    preserved.created_at, preserved.updated_at, preserved.revoked_at,
    preserved.revoked_by, preserved.revoked_reason
  from jsonb_to_recordset(v_preserved_cutover_grants) preserved(
    id uuid, user_id uuid, permission_code text, scope_type text, scope_id text,
    is_active boolean, granted_by uuid, granted_at timestamptz,
    expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
    revoked_at timestamptz, revoked_by uuid, revoked_reason text
  );
end;
$$;

revoke all on function public.replace_project_staff_permission_grants(uuid, jsonb) from public, anon;
grant execute on function public.replace_project_staff_permission_grants(uuid, jsonb) to authenticated;

create or replace function app_private.guard_material_request_pbac_grant_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin')
    and new.permission_code like 'project.material_request.%'
    and (
      tg_op = 'INSERT'
      or old.permission_code not like 'project.material_request.%'
      or (not old.is_active and new.is_active)
    )
  then
    raise exception 'Quyền PBAC Yêu cầu vật tư đã chuyển sang Room và không thể cấp mới.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_material_request_pbac_grant_write()
  from public, anon, authenticated;
drop trigger if exists guard_material_request_pbac_grant_write on public.user_permission_grants;
create trigger guard_material_request_pbac_grant_write
before insert or update on public.user_permission_grants
for each row execute function app_private.guard_material_request_pbac_grant_write();

delete from public.role_permission_template_items
where permission_code like 'project.material_request.%';

-- Strict parent Request authorization. Project requests never inherit read or
-- mutation rights from Module admin, workflow manager, ownership, participant
-- status or PBAC. WMS-origin requests keep their existing WMS contract.
create or replace function app_private.material_request_actor_is_current_assignee(
  p_request_id text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests request_row
    where request_row.id = p_request_id
      and (
        request_row.submitted_to_user_id = p_user_id::text
        or exists (
          select 1
          from public.workflow_subjects subject
          join public.workflow_step_assignments assignment
            on assignment.workflow_subject_id = subject.id
            and assignment.status = 'PENDING'
          where subject.subject_type = 'material_request'
            and subject.subject_id = request_row.id
            and subject.status in ('RUNNING', 'RETURNED')
            and assignment.assignee_user_id = p_user_id
        )
      )
  );
$$;

revoke all on function app_private.material_request_actor_is_current_assignee(text, uuid)
  from public, anon, authenticated;

create or replace function app_private.material_request_can_select_v2(
  p_request_origin text,
  p_project_id text,
  p_construction_site_id text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_request_origin, 'wms') = 'project' then
    p_project_id is not null
    and app_private.current_actor_has_effective_room_action(
      p_project_id, p_construction_site_id, 'material_request', 'view'
    )
  else app_private.wms_request_can_access(
    p_requester_id, p_submitted_to_user_id, p_source_warehouse_id, p_site_warehouse_id
  ) end;
$$;

create or replace function app_private.material_request_can_write_v2(
  p_request_origin text,
  p_project_id text,
  p_construction_site_id text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_request_origin, 'wms') = 'project' then
    p_requester_id = public.current_app_user_id()
    and app_private.current_actor_has_effective_room_action(
      p_project_id, p_construction_site_id, 'material_request', 'edit'
    )
  else app_private.wms_request_can_access(
    p_requester_id, p_submitted_to_user_id, p_source_warehouse_id, p_site_warehouse_id
  ) end;
$$;

create or replace function app_private.material_request_can_update_v2(
  p_request_origin text,
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_request_origin, 'wms') = 'project' then
    (
      p_requester_id = public.current_app_user_id()
      and coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
      and app_private.current_actor_has_effective_room_action(
        p_project_id, p_construction_site_id, 'material_request', 'edit'
      )
    )
    or (
      p_submitted_to_user_id = public.current_app_user_id()::text
      and (
        app_private.current_actor_has_effective_room_action(
          p_project_id, p_construction_site_id, 'material_request', 'approve'
        )
        or app_private.current_actor_has_effective_room_action(
          p_project_id, p_construction_site_id, 'material_request', 'confirm'
        )
      )
    )
  else app_private.wms_request_can_access(
    p_requester_id, p_submitted_to_user_id, p_source_warehouse_id, p_site_warehouse_id
  ) end;
$$;

create or replace function app_private.material_request_can_delete_v3(
  p_request_origin text,
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_ever_submitted boolean,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text,
  p_workflow_step text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_request_origin, 'wms') = 'project' then
    p_requester_id = public.current_app_user_id()
    and (
      coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
      or coalesce(p_workflow_step, '') = 'returned_to_creator'
    )
    and app_private.current_actor_has_effective_room_action(
      p_project_id, p_construction_site_id, 'material_request', 'delete'
    )
  else app_private.material_request_can_delete_v2(
    p_request_origin, p_project_id, p_status, p_ever_submitted, p_requester_id,
    p_submitted_to_user_id, p_source_warehouse_id, p_site_warehouse_id, p_workflow_step
  ) end;
$$;

revoke all on function app_private.material_request_can_select_v2(text, text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_write_v2(text, text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_update_v2(text, text, text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_delete_v3(text, text, text, text, boolean, uuid, text, text, text, text) from public, anon;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated using (
  app_private.material_request_can_select_v2(
    request_origin, project_id, construction_site_id, requester_id,
    submitted_to_user_id, source_warehouse_id, site_warehouse_id
  )
);

drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert to authenticated with check (
  app_private.material_request_can_write_v2(
    request_origin, project_id, construction_site_id, requester_id,
    submitted_to_user_id, source_warehouse_id, site_warehouse_id
  )
);

drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests for update to authenticated
using (app_private.material_request_can_update_v2(
  request_origin, project_id, construction_site_id, status::text, requester_id,
  submitted_to_user_id, source_warehouse_id, site_warehouse_id
))
with check (app_private.material_request_can_update_v2(
  request_origin, project_id, construction_site_id, status::text, requester_id,
  submitted_to_user_id, source_warehouse_id, site_warehouse_id
));

drop policy if exists requests_delete on public.requests;
create policy requests_delete on public.requests for delete to authenticated using (
  app_private.material_request_can_delete_v3(
    request_origin, project_id, construction_site_id, status::text, ever_submitted,
    requester_id, submitted_to_user_id, source_warehouse_id, site_warehouse_id, workflow_step
  )
);

create or replace function app_private.guard_project_material_request_workflow_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(old.request_origin, 'wms') = 'project'
    and current_user not in ('postgres', 'supabase_admin', 'service_role')
    and current_setting('app.material_request_workflow_context', true) <> 'on'
    and (
      new.status is distinct from old.status
      or new.submitted_to_user_id is distinct from old.submitted_to_user_id
      or new.submitted_to_name is distinct from old.submitted_to_name
      or new.submitted_to_permission is distinct from old.submitted_to_permission
      or new.workflow_step is distinct from old.workflow_step
      or new.workflow_instance_id is distinct from old.workflow_instance_id
      or new.workflow_subject_id is distinct from old.workflow_subject_id
      or new.workflow_template_id is distinct from old.workflow_template_id
    )
  then
    raise exception 'Workflow Yêu cầu chỉ được thay đổi qua RPC nghiệp vụ.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_project_material_request_workflow_fields()
  from public, anon, authenticated;
drop trigger if exists guard_project_material_request_workflow_fields on public.requests;
create trigger guard_project_material_request_workflow_fields
before update on public.requests
for each row execute function app_private.guard_project_material_request_workflow_fields();

-- Pure recipient validation: an admin can operate a workflow but is never
-- silently added to its recipient pool.
create or replace function app_private.assert_material_request_room_recipients(
  p_request_id text,
  p_user_ids uuid[],
  p_action_code text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request public.requests%rowtype;
  v_user_id uuid;
begin
  select * into v_request from public.requests where id = p_request_id;
  if not found then raise exception 'material request not found: %', p_request_id; end if;
  if coalesce(array_length(p_user_ids, 1), 0) = 0 then
    raise exception 'Required workflow action has no active Room recipient' using errcode = '23514';
  end if;
  foreach v_user_id in array p_user_ids loop
    if not app_private.project_user_has_room_action(
      v_user_id, v_request.project_id, v_request.construction_site_id,
      'material_request', p_action_code
    ) or not app_private.project_user_has_room_action(
      v_user_id, v_request.project_id, v_request.construction_site_id,
      'material_request', 'view'
    ) then
      raise exception 'Người nhận không có đủ quyền view + % thuần trong Room Yêu cầu.', p_action_code
        using errcode = '42501';
    end if;
  end loop;
end;
$$;

revoke all on function app_private.assert_material_request_room_recipients(text, uuid[], text)
  from public, anon, authenticated;

create or replace function app_private.project_material_request_handoff_assignee_is_eligible(
  p_subject_id text,
  p_assignee_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.requests request_row
    where request_row.id = p_subject_id
      and app_private.project_user_has_room_action(
        p_assignee_user_id, request_row.project_id, request_row.construction_site_id,
        'material_request', 'confirm'
      )
      and app_private.project_user_has_room_action(
        p_assignee_user_id, request_row.project_id, request_row.construction_site_id,
        'material_request', 'view'
      )
  ), false);
$$;

do $$
begin
  if to_regprocedure('public.start_project_workflow_v2(text,text,uuid,uuid[],text)') is not null
    and to_regprocedure('public.start_project_workflow_v2_room_authoritative_legacy(text,text,uuid,uuid[],text)') is null then
    alter function public.start_project_workflow_v2(text, text, uuid, uuid[], text)
      rename to start_project_workflow_v2_room_authoritative_legacy;
  end if;
  if to_regprocedure('public.advance_project_workflow_v2(text,text,uuid[],text)') is not null
    and to_regprocedure('public.advance_project_workflow_v2_room_authoritative_legacy(text,text,uuid[],text)') is null then
    alter function public.advance_project_workflow_v2(text, text, uuid[], text)
      rename to advance_project_workflow_v2_room_authoritative_legacy;
  end if;
  if to_regprocedure('public.return_project_workflow_v2(text,text,text)') is not null
    and to_regprocedure('public.return_project_workflow_v2_room_authoritative_legacy(text,text,text)') is null then
    alter function public.return_project_workflow_v2(text, text, text)
      rename to return_project_workflow_v2_room_authoritative_legacy;
  end if;
  if to_regprocedure('public.resubmit_project_workflow_v2(text,text,uuid[],text)') is not null
    and to_regprocedure('public.resubmit_project_workflow_v2_room_authoritative_legacy(text,text,uuid[],text)') is null then
    alter function public.resubmit_project_workflow_v2(text, text, uuid[], text)
      rename to resubmit_project_workflow_v2_room_authoritative_legacy;
  end if;
  if to_regprocedure('public.reassign_project_workflow_v2(text,text,uuid[],text)') is not null
    and to_regprocedure('public.reassign_project_workflow_v2_room_authoritative_legacy(text,text,uuid[],text)') is null then
    alter function public.reassign_project_workflow_v2(text, text, uuid[], text)
      rename to reassign_project_workflow_v2_room_authoritative_legacy;
  end if;
  if to_regprocedure('public.reject_project_workflow(text,text,text)') is not null
    and to_regprocedure('public.reject_project_workflow_room_authoritative_legacy(text,text,text)') is null then
    alter function public.reject_project_workflow(text, text, text)
      rename to reject_project_workflow_room_authoritative_legacy;
  end if;
end $$;

create function public.start_project_workflow_v2(
  p_subject_type text,
  p_subject_id text,
  p_template_id uuid default null,
  p_first_assignee_user_ids uuid[] default '{}'::uuid[],
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_result public.workflow_subjects%rowtype;
  v_previous_context text := current_setting('app.material_request_workflow_context', true);
begin
  select * into v_request from public.requests where id = p_subject_id;
  if p_subject_type <> 'material_request' or not found then raise exception 'material request not found'; end if;
  if not public.is_admin() and v_request.requester_id <> v_actor then
    raise exception 'only requester can start this workflow' using errcode = '42501';
  end if;
  if not app_private.project_actor_has_effective_room_action(
    v_actor, v_request.project_id, v_request.construction_site_id, 'material_request', 'submit'
  ) then raise exception 'Room submit permission required' using errcode = '42501'; end if;
  perform app_private.assert_material_request_room_recipients(
    p_subject_id, p_first_assignee_user_ids, 'approve'
  );
  perform set_config('app.material_request_workflow_context', 'on', true);
  v_result := public.start_project_workflow_v2_room_authoritative_legacy(
    p_subject_type, p_subject_id, p_template_id, p_first_assignee_user_ids, p_comment
  );
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  return v_result;
exception when others then
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  raise;
end;
$$;

create function public.advance_project_workflow_v2(
  p_subject_type text,
  p_subject_id text,
  p_next_assignee_user_ids uuid[] default '{}'::uuid[],
  p_comment text default ''
)
returns public.workflow_subjects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_next_node public.workflow_instance_nodes%rowtype;
  v_result public.workflow_subjects%rowtype;
  v_recipient_action text;
  v_previous_context text := current_setting('app.material_request_workflow_context', true);
begin
  select * into v_request from public.requests where id = p_subject_id;
  select * into v_subject from public.workflow_subjects
    where subject_type = p_subject_type and subject_id = p_subject_id;
  if v_request.id is null or v_subject.id is null then raise exception 'workflow subject not found'; end if;
  if not public.is_admin() and not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step' using errcode = '42501';
  end if;
  if not app_private.project_actor_has_effective_room_action(
    v_actor, v_request.project_id, v_request.construction_site_id, 'material_request', 'approve'
  ) then raise exception 'Room approve permission required' using errcode = '42501'; end if;
  select target.* into v_next_node
  from public.workflow_instance_edges edge
  join public.workflow_instance_nodes target on target.id = edge.target_instance_node_id
  where edge.workflow_instance_id = v_subject.workflow_instance_id
    and edge.source_instance_node_id = v_subject.current_instance_node_id
  order by edge.sort_order, target.position_y, target.position_x limit 1;
  v_recipient_action := case when v_next_node.type = 'END'::public.workflow_node_type
    then 'confirm' else 'approve' end;
  perform app_private.assert_material_request_room_recipients(
    p_subject_id, p_next_assignee_user_ids, v_recipient_action
  );
  perform set_config('app.material_request_workflow_context', 'on', true);
  v_result := public.advance_project_workflow_v2_room_authoritative_legacy(
    p_subject_type, p_subject_id, p_next_assignee_user_ids, p_comment
  );
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  return v_result;
exception when others then
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  raise;
end;
$$;

create function public.return_project_workflow_v2(
  p_subject_type text, p_subject_id text, p_comment text default ''
)
returns public.workflow_subjects
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_result public.workflow_subjects%rowtype;
  v_previous_context text := current_setting('app.material_request_workflow_context', true);
begin
  select * into v_request from public.requests where id = p_subject_id;
  select * into v_subject from public.workflow_subjects where subject_type = p_subject_type and subject_id = p_subject_id;
  if not public.is_admin() and not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step' using errcode = '42501';
  end if;
  if not app_private.project_actor_has_effective_room_action(v_actor, v_request.project_id,
    v_request.construction_site_id, 'material_request', 'approve') then
    raise exception 'Room approve permission required' using errcode = '42501';
  end if;
  perform set_config('app.material_request_workflow_context', 'on', true);
  v_result := public.return_project_workflow_v2_room_authoritative_legacy(p_subject_type, p_subject_id, p_comment);
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  return v_result;
exception when others then
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true); raise;
end;
$$;

create function public.reject_project_workflow(
  p_subject_type text, p_subject_id text, p_comment text default ''
)
returns public.workflow_subjects
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_result public.workflow_subjects%rowtype;
  v_previous_context text := current_setting('app.material_request_workflow_context', true);
begin
  select * into v_request from public.requests where id = p_subject_id;
  select * into v_subject from public.workflow_subjects where subject_type = p_subject_type and subject_id = p_subject_id;
  if not public.is_admin() and not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'user is not assigned to current workflow step' using errcode = '42501';
  end if;
  if not app_private.project_actor_has_effective_room_action(v_actor, v_request.project_id,
    v_request.construction_site_id, 'material_request', 'approve') then
    raise exception 'Room approve permission required' using errcode = '42501';
  end if;
  perform set_config('app.material_request_workflow_context', 'on', true);
  v_result := public.reject_project_workflow_room_authoritative_legacy(p_subject_type, p_subject_id, p_comment);
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  return v_result;
exception when others then
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true); raise;
end;
$$;

create function public.resubmit_project_workflow_v2(
  p_subject_type text, p_subject_id text,
  p_assignee_user_ids uuid[] default null, p_comment text default ''
)
returns public.workflow_subjects
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_result public.workflow_subjects%rowtype;
  v_targets uuid[];
  v_subject public.workflow_subjects%rowtype;
  v_previous_context text := current_setting('app.material_request_workflow_context', true);
begin
  select * into v_request from public.requests where id = p_subject_id;
  select * into v_subject from public.workflow_subjects where subject_type = p_subject_type and subject_id = p_subject_id;
  if not public.is_admin() and v_request.requester_id <> v_actor then
    raise exception 'only requester can resubmit this workflow' using errcode = '42501';
  end if;
  if not app_private.project_actor_has_effective_room_action(v_actor, v_request.project_id,
    v_request.construction_site_id, 'material_request', 'submit') then
    raise exception 'Room submit permission required' using errcode = '42501';
  end if;
  v_targets := coalesce(p_assignee_user_ids, v_subject.return_to_assignee_user_ids);
  perform app_private.assert_material_request_room_recipients(p_subject_id, v_targets, 'approve');
  perform set_config('app.material_request_workflow_context', 'on', true);
  v_result := public.resubmit_project_workflow_v2_room_authoritative_legacy(
    p_subject_type, p_subject_id, p_assignee_user_ids, p_comment
  );
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  return v_result;
exception when others then
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true); raise;
end;
$$;

create function public.reassign_project_workflow_v2(
  p_subject_type text, p_subject_id text,
  p_new_assignee_user_ids uuid[], p_comment text default ''
)
returns public.workflow_subjects
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.requests%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_result public.workflow_subjects%rowtype;
  v_previous_context text := current_setting('app.material_request_workflow_context', true);
begin
  select * into v_request from public.requests where id = p_subject_id;
  select * into v_subject from public.workflow_subjects where subject_type = p_subject_type and subject_id = p_subject_id;
  if not public.is_admin() and not app_private.project_workflow_actor_can_act(v_subject.id, v_actor) then
    raise exception 'only current assignee can reassign this workflow' using errcode = '42501';
  end if;
  if not app_private.project_actor_has_effective_room_action(v_actor, v_request.project_id,
    v_request.construction_site_id, 'material_request', 'approve') then
    raise exception 'Room approve permission required' using errcode = '42501';
  end if;
  perform app_private.assert_material_request_room_recipients(p_subject_id, p_new_assignee_user_ids, 'approve');
  perform set_config('app.material_request_workflow_context', 'on', true);
  v_result := public.reassign_project_workflow_v2_room_authoritative_legacy(
    p_subject_type, p_subject_id, p_new_assignee_user_ids, p_comment
  );
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true);
  return v_result;
exception when others then
  perform set_config('app.material_request_workflow_context', coalesce(v_previous_context, ''), true); raise;
end;
$$;

revoke all on function public.start_project_workflow_v2(text, text, uuid, uuid[], text) from public, anon;
revoke all on function public.advance_project_workflow_v2(text, text, uuid[], text) from public, anon;
revoke all on function public.return_project_workflow_v2(text, text, text) from public, anon;
revoke all on function public.resubmit_project_workflow_v2(text, text, uuid[], text) from public, anon;
revoke all on function public.reassign_project_workflow_v2(text, text, uuid[], text) from public, anon;
revoke all on function public.reject_project_workflow(text, text, text) from public, anon;
grant execute on function public.start_project_workflow_v2(text, text, uuid, uuid[], text) to authenticated;
grant execute on function public.advance_project_workflow_v2(text, text, uuid[], text) to authenticated;
grant execute on function public.return_project_workflow_v2(text, text, text) to authenticated;
grant execute on function public.resubmit_project_workflow_v2(text, text, uuid[], text) to authenticated;
grant execute on function public.reassign_project_workflow_v2(text, text, uuid[], text) to authenticated;
grant execute on function public.reject_project_workflow(text, text, text) to authenticated;

-- Dependent data follows the parent request. Workflow participation alone is
-- not a read grant for project-origin Material Requests.
create or replace function app_private.material_request_parent_can_view(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(exists (
    select 1 from public.requests request_row
    where request_row.id = p_request_id
      and app_private.material_request_can_select_v2(
        request_row.request_origin, request_row.project_id,
        request_row.construction_site_id, request_row.requester_id,
        request_row.submitted_to_user_id, request_row.source_warehouse_id,
        request_row.site_warehouse_id
      )
  ), false);
$$;

create or replace function app_private.material_request_parent_can_edit(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(exists (
    select 1 from public.requests request_row
    where request_row.id = p_request_id
      and app_private.material_request_can_update_v2(
        request_row.request_origin, request_row.project_id,
        request_row.construction_site_id, request_row.status::text,
        request_row.requester_id, request_row.submitted_to_user_id,
        request_row.source_warehouse_id, request_row.site_warehouse_id
      )
  ), false);
$$;

create or replace function app_private.material_request_parent_can_confirm(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(exists (
    select 1 from public.requests request_row
    where request_row.id = p_request_id
      and case when coalesce(request_row.request_origin, 'wms') = 'project' then
        app_private.material_request_actor_is_current_assignee(
          request_row.id, public.current_app_user_id()
        )
        and app_private.current_actor_has_effective_room_action(
          request_row.project_id, request_row.construction_site_id,
          'material_request', 'confirm'
        )
      else app_private.wms_request_can_access(
        request_row.requester_id, request_row.submitted_to_user_id,
        request_row.source_warehouse_id, request_row.site_warehouse_id
      ) end
  ), false);
$$;

create or replace function app_private.material_request_event_can_select(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_view(p_request_id);
$$;
create or replace function app_private.material_request_boq_snapshot_can_select(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_view(p_request_id);
$$;
create or replace function app_private.material_request_group_snapshot_can_select(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_view(p_request_id);
$$;
create or replace function app_private.material_request_boq_snapshot_can_mutate(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_edit(p_request_id);
$$;
create or replace function app_private.material_request_group_snapshot_can_mutate(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_edit(p_request_id);
$$;
create or replace function app_private.material_request_fulfillment_can_view(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_view(p_request_id);
$$;
create or replace function app_private.material_request_fulfillment_can_mutate(p_request_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_confirm(p_request_id);
$$;
create or replace function app_private.material_request_fulfillment_line_can_view(
  p_request_id text, p_batch_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_view(p_request_id)
    and exists (select 1 from public.material_request_fulfillment_batches batch
      where batch.id = p_batch_id and batch.material_request_id = p_request_id);
$$;
create or replace function app_private.material_request_fulfillment_line_can_mutate(
  p_request_id text, p_batch_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.material_request_parent_can_confirm(p_request_id)
    and exists (select 1 from public.material_request_fulfillment_batches batch
      where batch.id = p_batch_id and batch.material_request_id = p_request_id);
$$;

create or replace function app_private.project_workflow_actor_can_select(p_workflow_subject_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(case when subject.subject_type = 'material_request' then
    app_private.material_request_parent_can_view(subject.subject_id)
  else
    app_private.workflow_subject_can_select(p_workflow_subject_id)
    or exists (
      select 1 from public.workflow_participants participant
      where participant.workflow_subject_id = p_workflow_subject_id
        and participant.user_id = public.current_app_user_id()
        and coalesce(participant.is_active, true)
    )
  end, false)
  from public.workflow_subjects subject
  where subject.id = p_workflow_subject_id;
$$;

drop policy if exists material_request_line_need_closures_project_access
  on public.material_request_line_need_closures;
create policy material_request_line_need_closures_select
on public.material_request_line_need_closures for select to authenticated
using (app_private.material_request_parent_can_view(material_request_id));
create policy material_request_line_need_closures_insert
on public.material_request_line_need_closures for insert to authenticated
with check (
  app_private.material_request_parent_can_confirm(material_request_id)
  and length(trim(coalesce(reason, ''))) > 0
);
create policy material_request_line_need_closures_update
on public.material_request_line_need_closures for update to authenticated
using (app_private.material_request_parent_can_confirm(material_request_id))
with check (
  app_private.material_request_parent_can_confirm(material_request_id)
  and length(trim(coalesce(reason, ''))) > 0
);
create policy material_request_line_need_closures_delete
on public.material_request_line_need_closures for delete to authenticated
using (app_private.material_request_parent_can_confirm(material_request_id));

-- Least-privilege cross-Room projections.
create or replace function public.list_project_material_request_procurement_demand(
  p_project_id text,
  p_construction_site_id text default null
)
returns table (
  material_request_id text,
  request_code text,
  construction_site_id text,
  site_warehouse_id text,
  fulfillment_mode text,
  request_status text,
  created_date timestamptz,
  expected_date timestamptz,
  request_line_id text,
  item_id text,
  material_budget_item_id text,
  work_boq_item_id text,
  requested_qty numeric,
  approved_qty numeric,
  received_qty numeric,
  closed_qty numeric,
  open_qty numeric,
  needed_date timestamptz,
  item_name text,
  sku text,
  unit text,
  is_manual_item boolean
)
language sql stable security definer set search_path = '' as $$
  with authorized as (
    select app_private.current_actor_has_effective_room_action(
      p_project_id, nullif(p_construction_site_id, ''), 'material_po', 'view'
    ) allowed
  ), request_lines as (
    select request_row.*,
      line.value,
      coalesce(line.value ->> 'lineId', request_row.id || '-' || line.ordinality::text) line_id,
      coalesce(nullif(line.value ->> 'requestQty', '')::numeric, 0) request_qty
    from public.requests request_row
    cross join authorized
    cross join lateral jsonb_array_elements(coalesce(request_row.items, '[]'::jsonb))
      with ordinality line(value, ordinality)
    where authorized.allowed
      and request_row.request_origin = 'project'
      and request_row.project_id = p_project_id
      and (nullif(p_construction_site_id, '') is null
        or request_row.construction_site_id = p_construction_site_id)
      and request_row.status::text in ('APPROVED', 'IN_TRANSIT')
  ), fulfillment as (
    select fulfillment_line.material_request_id, fulfillment_line.request_line_id,
      sum(coalesce(fulfillment_line.received_qty, 0)) received_qty
    from public.material_request_fulfillment_lines fulfillment_line
    join public.material_request_fulfillment_batches batch
      on batch.id = fulfillment_line.batch_id
      and batch.status not in ('cancelled', 'returned')
    group by fulfillment_line.material_request_id, fulfillment_line.request_line_id
  ), closures as (
    select closure.material_request_id, closure.request_line_id,
      sum(coalesce(closure.closed_qty, 0)) closed_qty
    from public.material_request_line_need_closures closure
    where closure.status = 'active'
    group by closure.material_request_id, closure.request_line_id
  )
  select lines.id, lines.code, lines.construction_site_id, lines.site_warehouse_id,
    lines.fulfillment_mode, lines.status::text, lines.created_date, lines.expected_date,
    lines.line_id, lines.value ->> 'itemId', lines.value ->> 'materialBudgetItemId',
    lines.value ->> 'workBoqItemId', lines.request_qty, lines.request_qty,
    coalesce(fulfillment.received_qty, 0), coalesce(closures.closed_qty, 0),
    greatest(0, lines.request_qty - coalesce(fulfillment.received_qty, 0)
      - coalesce(closures.closed_qty, 0)),
    nullif(lines.value ->> 'neededDate', '')::timestamptz,
    lines.value ->> 'itemNameSnapshot', lines.value ->> 'skuSnapshot',
    lines.value ->> 'unitSnapshot', coalesce((lines.value ->> 'isManualItem')::boolean, false)
  from request_lines lines
  left join fulfillment on fulfillment.material_request_id = lines.id
    and fulfillment.request_line_id = lines.line_id
  left join closures on closures.material_request_id = lines.id
    and closures.request_line_id = lines.line_id
  where greatest(0, lines.request_qty - coalesce(fulfillment.received_qty, 0)
    - coalesce(closures.closed_qty, 0)) > 0
  order by lines.created_date desc, lines.id, lines.line_id;
$$;

revoke all on function public.list_project_material_request_procurement_demand(text, text) from public, anon;
grant execute on function public.list_project_material_request_procurement_demand(text, text) to authenticated;

create or replace function public.get_project_material_request_aggregate(
  p_project_id text,
  p_construction_site_id text default null
)
returns table (
  item_id text,
  material_budget_item_id text,
  requested_qty numeric,
  approved_qty numeric,
  received_qty numeric,
  remaining_qty numeric
)
language sql stable security definer set search_path = '' as $$
  with demand as (
    select request_row.id,
      coalesce(line.value ->> 'lineId', request_row.id || '-' || line.ordinality::text) line_id,
      line.value ->> 'itemId' item_id,
      line.value ->> 'materialBudgetItemId' material_budget_item_id,
      coalesce(nullif(line.value ->> 'requestQty', '')::numeric, 0) request_qty,
      request_row.status::text status
    from public.requests request_row
    cross join lateral jsonb_array_elements(coalesce(request_row.items, '[]'::jsonb))
      with ordinality line(value, ordinality)
    where app_private.current_actor_has_effective_room_action(
        p_project_id, nullif(p_construction_site_id, ''), 'material_planning', 'view'
      )
      and request_row.request_origin = 'project' and request_row.project_id = p_project_id
      and (nullif(p_construction_site_id, '') is null
        or request_row.construction_site_id = p_construction_site_id)
      and request_row.status::text not in ('DRAFT', 'REJECTED')
  ), received as (
    select line.material_request_id, line.request_line_id,
      sum(coalesce(line.received_qty, 0)) qty
    from public.material_request_fulfillment_lines line
    join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
      and batch.status not in ('cancelled', 'returned')
    group by line.material_request_id, line.request_line_id
  )
  select demand.item_id, demand.material_budget_item_id,
    sum(demand.request_qty),
    sum(case when demand.status in ('APPROVED', 'IN_TRANSIT', 'COMPLETED') then demand.request_qty else 0 end),
    sum(coalesce(received.qty, 0)),
    sum(greatest(0, demand.request_qty - coalesce(received.qty, 0)))
  from demand left join received on received.material_request_id = demand.id
    and received.request_line_id = demand.line_id
  group by demand.item_id, demand.material_budget_item_id;
$$;

revoke all on function public.get_project_material_request_aggregate(text, text) from public, anon;
grant execute on function public.get_project_material_request_aggregate(text, text) to authenticated;

create or replace function public.get_project_material_request_available_stock(
  p_project_id text,
  p_construction_site_id text,
  p_warehouse_id text,
  p_item_ids text[] default null
)
returns table (item_id text, on_hand_qty numeric, reserved_qty numeric, available_qty numeric)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select app_private.current_actor_has_effective_room_action(
      p_project_id, nullif(p_construction_site_id, ''),
      'material_request', 'view_available_stock'
    ) and (
      app_private.current_user_is_global_wms_keeper()
      or app_private.current_user_is_wms_keeper_for(p_warehouse_id)
      or exists (
        select 1 from public.requests request_row
        where request_row.request_origin = 'project'
          and request_row.project_id = p_project_id
          and request_row.construction_site_id is not distinct from nullif(p_construction_site_id, '')
          and request_row.site_warehouse_id = p_warehouse_id
      )
    ) value
  ), stock as (
    select item.id,
      coalesce(nullif(item.stock_by_warehouse ->> p_warehouse_id, '')::numeric, 0) on_hand
    from public.items item cross join allowed
    where allowed.value and (p_item_ids is null or item.id = any(p_item_ids))
  ), tx_reserved as (
    select line.value ->> 'itemId' item_id,
      sum(coalesce(nullif(line.value ->> 'quantity', '')::numeric, 0)) qty
    from public.transactions transaction_row
    cross join lateral jsonb_array_elements(coalesce(transaction_row.items, '[]'::jsonb)) line(value)
    where transaction_row.source_warehouse_id = p_warehouse_id
      and transaction_row.status::text in ('PENDING', 'APPROVED')
      and transaction_row.type::text in ('EXPORT', 'LIQUIDATION', 'TRANSFER')
    group by line.value ->> 'itemId'
  ), request_reserved as (
    select line.value ->> 'itemId' item_id,
      sum(case when request_row.status::text = 'PENDING'
        then coalesce(nullif(line.value ->> 'requestQty', '')::numeric, 0)
        else coalesce(nullif(line.value ->> 'approvedQty', '')::numeric, 0) end) qty
    from public.requests request_row
    cross join lateral jsonb_array_elements(coalesce(request_row.items, '[]'::jsonb)) line(value)
    where request_row.source_warehouse_id = p_warehouse_id
      and request_row.status::text in ('PENDING', 'APPROVED', 'IN_TRANSIT')
    group by line.value ->> 'itemId'
  )
  select stock.id, stock.on_hand,
    coalesce(tx_reserved.qty, 0) + coalesce(request_reserved.qty, 0),
    greatest(0, stock.on_hand - coalesce(tx_reserved.qty, 0) - coalesce(request_reserved.qty, 0))
  from stock left join tx_reserved on tx_reserved.item_id = stock.id
  left join request_reserved on request_reserved.item_id = stock.id;
$$;

revoke all on function public.get_project_material_request_available_stock(text, text, text, text[]) from public, anon;
grant execute on function public.get_project_material_request_available_stock(text, text, text, text[]) to authenticated;

create or replace function public.get_my_project_room_pbac_exceptions(
  p_project_id text,
  p_construction_site_id text
)
returns table (room_code text, permission_code text)
language sql stable security definer set search_path = '' as $$
  with actor as (
    select user_row.id user_id
    from public.users user_row
    where user_row.id = public.current_app_user_id()
      and coalesce(user_row.is_active, true) and user_row.role <> 'ADMIN'
  ), exception(room_code, permission_code) as (
    values
      ('daily_log'::text, 'project.daily_log.edit_all'::text),
      ('daily_log', 'project.daily_log.delete_all'),
      ('daily_log', 'project.daily_log.return'),
      ('daily_log', 'project.daily_log.manage'),
      ('daily_log', 'project.daily_log.confirm'),
      ('material_po', 'project.material_po.manage'),
      ('material_request', 'project.material_request.edit_all'),
      ('material_request', 'project.material_request.delete_all'),
      ('material_request', 'project.material_request.return'),
      ('material_request', 'project.material_request.manage'),
      ('material_request', 'project.material_request.confirm')
  )
  select exception.room_code, exception.permission_code
  from actor cross join exception
  where exists (
    select 1 from public.project_staff staff
    where staff.user_id = actor.user_id::text
      and staff.project_id = p_project_id and staff.end_date is null
      and (nullif(p_construction_site_id, '') is null
        or staff.construction_site_id is null
        or staff.construction_site_id = p_construction_site_id)
  )
  and app_private.project_has_permission_v2(
    p_project_id, nullif(p_construction_site_id, ''),
    exception.permission_code, actor.user_id
  )
  order by exception.room_code, exception.permission_code;
$$;

revoke all on function public.get_my_project_room_pbac_exceptions(text, text) from public, anon;
grant execute on function public.get_my_project_room_pbac_exceptions(text, text) to authenticated;

notify pgrst, 'reload schema';
