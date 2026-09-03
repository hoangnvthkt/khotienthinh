-- Project permission Room audit registry and two cutover pilots:
--   * daily_log
--   * material_planning (material BOQ only; purchase orders are out of scope)

create schema if not exists app_private;

create table if not exists app_private.project_permission_room_action_bindings (
  room_code text not null references public.project_permission_rooms(code) on update cascade on delete cascade,
  action_code text not null,
  legacy_permission_codes text[] not null default '{}'::text[],
  enforcement_status text not null default 'audit_only',
  relationship_description text not null default '',
  verified_at timestamptz,
  verified_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_code, action_code),
  constraint project_permission_room_action_bindings_status_check check (
    enforcement_status in ('audit_only', 'pilot', 'enforced')
  )
);

revoke all privileges on table app_private.project_permission_room_action_bindings
  from public, anon, authenticated;

insert into app_private.project_permission_room_action_bindings (
  room_code,
  action_code,
  enforcement_status,
  relationship_description,
  verified_source
)
select
  room.code,
  action.action_code,
  'audit_only',
  'Chưa xác minh đầy đủ UI, frontend capability, backend RPC/RLS và database.',
  'project_room_permission_audit_v1'
from public.project_permission_rooms room
cross join lateral unnest(room.allowed_actions) as action(action_code)
where room.is_active
on conflict (room_code, action_code) do update
set updated_at = now();

-- Daily Log pilot. edit/delete are intentionally owner-scoped; broad PBAC
-- edit_all/delete_all/return grants remain visible exceptions and are not mapped.
update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.daily_log.view']::text[]
      when 'edit' then array['project.daily_log.create', 'project.daily_log.edit_own']::text[]
      when 'delete' then array['project.daily_log.delete_own']::text[]
      when 'submit' then array['project.daily_log.submit']::text[]
      when 'verify' then array['project.daily_log.verify', 'project.daily_log.summarize']::text[]
      when 'approve' then array['project.daily_log.approve']::text[]
      else '{}'::text[]
    end,
    enforcement_status = 'pilot',
    relationship_description = case action_code
      when 'edit' then 'Tạo và sửa nhật ký do chính actor lập ở trạng thái draft/rejected.'
      when 'delete' then 'Xóa nhật ký do chính actor lập ở trạng thái cho phép.'
      when 'verify' then 'KTT tổng hợp, kiểm tra hoặc trả lại nhật ký đang được giao.'
      when 'approve' then 'CHT duyệt hoặc trả lại nhật ký đang được giao.'
      else 'Quyền nghiệp vụ Nhật ký công trường theo đúng project/site.'
    end,
    verified_at = now(),
    verified_source = 'daily_log_room_pilot_2026_08_03',
    updated_at = now()
where room_code = 'daily_log';

-- Material BOQ pilot. project.material_boq.edit never implies delete.
update app_private.project_permission_room_action_bindings
set legacy_permission_codes = case action_code
      when 'view' then array['project.material_boq.view']::text[]
      when 'edit' then array['project.material_boq.edit']::text[]
      when 'delete' then array['project.material_boq.delete']::text[]
      else '{}'::text[]
    end,
    enforcement_status = 'pilot',
    relationship_description = case action_code
      when 'view' then 'Xem BOQ vật tư trong project/site.'
      when 'edit' then 'Thêm và cập nhật BOQ vật tư; không bao gồm xóa.'
      when 'delete' then 'Xóa BOQ vật tư; không được suy ra từ edit.'
      else ''
    end,
    verified_at = now(),
    verified_source = 'material_boq_room_pilot_2026_08_03',
    updated_at = now()
where room_code = 'material_planning';

insert into app_private.permission_hardening_settings (key, value)
values ('project_room_pbac_fallback_enabled', 'true'::jsonb)
on conflict (key) do nothing;

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
  select p_user_id is not null
    and exists (
      select 1
      from public.users actor
      where actor.id = p_user_id and coalesce(actor.is_active, true)
    )
    and exists (
      select 1
      from app_private.project_permission_room_action_bindings binding
      where binding.room_code = p_room_code
        and binding.action_code = p_action_code
        and binding.enforcement_status in ('pilot', 'enforced')
    )
    and (
      exists (
        select 1
        from public.users actor
        where actor.id = p_user_id
          and coalesce(actor.is_active, true)
          and actor.role = 'ADMIN'
      )
      or (
        exists (
          select 1
          from public.project_staff staff
          where staff.user_id = p_user_id::text
            and staff.project_id = p_project_id
            and staff.end_date is null
            and (
              nullif(p_construction_site_id, '') is null
              or staff.construction_site_id is null
              or staff.construction_site_id = p_construction_site_id
            )
        )
        and (
          app_private.project_user_has_room_action(
            p_user_id,
            p_project_id,
            nullif(p_construction_site_id, ''),
            p_room_code,
            p_action_code
          )
          or (
            app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
            and exists (
              select 1
              from app_private.project_permission_room_action_bindings binding
              cross join lateral unnest(binding.legacy_permission_codes) as legacy(permission_code)
              where binding.room_code = p_room_code
                and binding.action_code = p_action_code
                and binding.enforcement_status in ('pilot', 'enforced')
                and app_private.project_has_permission_v2(
                  p_project_id,
                  nullif(p_construction_site_id, ''),
                  legacy.permission_code,
                  p_user_id
                )
            )
          )
        )
      )
    );
$$;

revoke all on function app_private.project_actor_has_effective_room_action(uuid, text, text, text, text)
  from public, anon, authenticated;

create or replace function app_private.current_actor_has_effective_room_action(
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
  select app_private.project_actor_has_effective_room_action(
    public.current_app_user_id(),
    p_project_id,
    p_construction_site_id,
    p_room_code,
    p_action_code
  );
$$;

revoke all on function app_private.current_actor_has_effective_room_action(text, text, text, text)
  from public, anon;
grant execute on function app_private.current_actor_has_effective_room_action(text, text, text, text)
  to authenticated;

create or replace function public.get_my_project_room_actions(
  p_project_id text,
  p_construction_site_id text
)
returns table (
  room_code text,
  action_code text,
  authorization_source text,
  enforcement_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select public.current_app_user_id() as user_id
  )
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
      when app_private.project_user_has_room_action(
        actor.user_id,
        p_project_id,
        nullif(p_construction_site_id, ''),
        binding.room_code,
        binding.action_code
      ) then 'room'
      else 'pbac_fallback'
    end as authorization_source,
    binding.enforcement_status
  from app_private.project_permission_room_action_bindings binding
  cross join actor
  where app_private.project_actor_has_effective_room_action(
    actor.user_id,
    p_project_id,
    nullif(p_construction_site_id, ''),
    binding.room_code,
    binding.action_code
  )
  order by binding.room_code, binding.action_code;
$$;

revoke all on function public.get_my_project_room_actions(text, text) from public, anon;
grant execute on function public.get_my_project_room_actions(text, text) to authenticated;

-- Broad PBAC permissions remain explicit compatibility exceptions. Keeping
-- them separate prevents edit_all/delete_all from implying owner-scoped Room
-- edit/delete capabilities such as create.
create or replace function public.get_my_project_room_pbac_exceptions(
  p_project_id text,
  p_construction_site_id text
)
returns table (
  room_code text,
  permission_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select user_row.id as user_id
    from public.users user_row
    where user_row.id = public.current_app_user_id()
      and coalesce(user_row.is_active, true)
      and user_row.role <> 'ADMIN'
  ), exception(room_code, permission_code) as (
    values
      ('daily_log'::text, 'project.daily_log.edit_all'::text),
      ('daily_log'::text, 'project.daily_log.delete_all'::text),
      ('daily_log'::text, 'project.daily_log.return'::text),
      ('daily_log'::text, 'project.daily_log.manage'::text),
      ('daily_log'::text, 'project.daily_log.confirm'::text)
  )
  select exception.room_code, exception.permission_code
  from actor
  cross join exception
  where app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
    and exists (
      select 1
      from public.project_staff staff
      where staff.user_id = actor.user_id::text
        and staff.project_id = p_project_id
        and staff.end_date is null
        and (
          nullif(p_construction_site_id, '') is null
          or staff.construction_site_id is null
          or staff.construction_site_id = p_construction_site_id
        )
    )
    and app_private.project_has_permission_v2(
      p_project_id,
      nullif(p_construction_site_id, ''),
      exception.permission_code,
      actor.user_id
    )
  order by exception.room_code, exception.permission_code;
$$;

revoke all on function public.get_my_project_room_pbac_exceptions(text, text) from public, anon;
grant execute on function public.get_my_project_room_pbac_exceptions(text, text) to authenticated;

-- Admin Room RPCs expose cutover status and scoped PBAC exceptions.
drop function if exists public.list_project_permission_rooms();
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
    case when nullif(p_project_id, '') is null then 0::bigint else coalesce(fallback.count, 0) end
  from public.project_permission_rooms room
  left join lateral (
    select jsonb_object_agg(item.action_code, item.enforcement_status order by item.action_code) as statuses
    from app_private.project_permission_room_action_bindings item
    where item.room_code = room.code
  ) binding on true
  left join lateral (
    select count(distinct staff.user_id)::bigint as count
    from public.project_staff staff
    join public.users user_row on user_row.id::text = staff.user_id and coalesce(user_row.is_active, true)
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
          and app_private.project_actor_has_effective_room_action(
            user_row.id, p_project_id, nullif(p_construction_site_id, ''), item.room_code, item.action_code
          )
          and not app_private.project_user_has_room_action(
            user_row.id, p_project_id, nullif(p_construction_site_id, ''), item.room_code, item.action_code
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
  member_id uuid,
  project_staff_id uuid,
  user_id uuid,
  user_name text,
  user_avatar text,
  position_name text,
  construction_site_id text,
  action_codes text[],
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
    member.id,
    staff.id,
    user_row.id,
    user_row.name,
    user_row.avatar,
    position.name,
    staff.construction_site_id,
    coalesce(actions.action_codes, '{}'::text[]),
    coalesce(legacy.codes, '{}'::text[])
  from public.project_permission_rooms room
  left join lateral (
    select jsonb_object_agg(item.action_code, item.enforcement_status order by item.action_code) as statuses
    from app_private.project_permission_room_action_bindings item
    where item.room_code = room.code
  ) binding on true
  left join public.project_permission_room_members member
    on member.room_code = room.code
    and member.project_id = p_project_id
    and member.construction_site_id is not distinct from nullif(p_construction_site_id, '')
    and member.is_active
  left join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
  left join public.users user_row on user_row.id::text = staff.user_id and coalesce(user_row.is_active, true)
  left join public.hrm_positions position on position.id = staff.position_id
  left join lateral (
    select array_agg(action.action_code order by action.action_code) as action_codes
    from public.project_permission_room_member_actions action
    where action.room_member_id = member.id and action.is_active
  ) actions on true
  left join lateral (
    select array_agg(distinct grant_row.permission_code order by grant_row.permission_code) as codes
    from public.user_permission_grants grant_row
    where grant_row.user_id = user_row.id
      and grant_row.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and (
        grant_row.scope_type = 'global'
        or (grant_row.scope_type = 'project' and grant_row.scope_id in ('*', p_project_id))
        or (
          nullif(p_construction_site_id, '') is not null
          and grant_row.scope_type = 'construction_site'
          and grant_row.scope_id in ('*', p_construction_site_id)
        )
      )
      and (
        grant_row.permission_code = any(coalesce((
          select array_agg(code)
          from app_private.project_permission_room_action_bindings item
          cross join lateral unnest(item.legacy_permission_codes) as mapped(code)
          where item.room_code = room.code
        ), '{}'::text[]))
        or (room.code = 'daily_log' and grant_row.permission_code in (
          'project.daily_log.edit_all',
          'project.daily_log.delete_all',
          'project.daily_log.return'
        ))
      )
  ) legacy on true
  where room.code = p_room_code and room.is_active
  order by user_row.name nulls last, member.id;
$$;

revoke all on function public.get_project_permission_room(text, text, text) from public, anon;
grant execute on function public.get_project_permission_room(text, text, text) to authenticated;

-- Any audit_only action must survive a batch byte-for-byte at the logical
-- (staff, action) level. This blocks new grants and accidental deactivation.
create or replace function app_private.assert_project_room_audit_actions_unchanged(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_members jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    (
      select member.project_staff_id, action.action_code
      from public.project_permission_room_members member
      join public.project_permission_room_member_actions action
        on action.room_member_id = member.id and action.is_active
      join app_private.project_permission_room_action_bindings binding
        on binding.room_code = member.room_code
        and binding.action_code = action.action_code
        and binding.enforcement_status = 'audit_only'
      where member.project_id = p_project_id
        and member.construction_site_id is not distinct from nullif(p_construction_site_id, '')
        and member.room_code = p_room_code
        and member.is_active
      except
      select item.project_staff_id, code.action_code
      from jsonb_to_recordset(coalesce(p_members, '[]'::jsonb))
        as item(project_staff_id uuid, action_codes jsonb)
      cross join lateral jsonb_array_elements_text(item.action_codes) as code(action_code)
      join app_private.project_permission_room_action_bindings binding
        on binding.room_code = p_room_code
        and binding.action_code = code.action_code
        and binding.enforcement_status = 'audit_only'
    )
    union all
    (
      select item.project_staff_id, code.action_code
      from jsonb_to_recordset(coalesce(p_members, '[]'::jsonb))
        as item(project_staff_id uuid, action_codes jsonb)
      cross join lateral jsonb_array_elements_text(item.action_codes) as code(action_code)
      join app_private.project_permission_room_action_bindings binding
        on binding.room_code = p_room_code
        and binding.action_code = code.action_code
        and binding.enforcement_status = 'audit_only'
      except
      select member.project_staff_id, action.action_code
      from public.project_permission_room_members member
      join public.project_permission_room_member_actions action
        on action.room_member_id = member.id and action.is_active
      join app_private.project_permission_room_action_bindings binding
        on binding.room_code = member.room_code
        and binding.action_code = action.action_code
        and binding.enforcement_status = 'audit_only'
      where member.project_id = p_project_id
        and member.construction_site_id is not distinct from nullif(p_construction_site_id, '')
        and member.room_code = p_room_code
        and member.is_active
    )
  ) then
    raise exception 'Action chưa áp dụng đầy đủ; không thể thay đổi cấu hình hiện tại.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_project_room_audit_actions_unchanged(text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function app_private.replace_project_permission_room_members(text, text, text, jsonb)
  from authenticated;

create or replace function public.replace_project_permission_room_members(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_members jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_project_room_audit_actions_unchanged(
    p_project_id, p_construction_site_id, p_room_code, p_members
  );
  perform app_private.replace_project_permission_room_members(
    p_project_id, p_construction_site_id, p_room_code, p_members
  );
end;
$$;

revoke all on function public.replace_project_permission_room_members(text, text, text, jsonb)
  from public, anon;
grant execute on function public.replace_project_permission_room_members(text, text, text, jsonb)
  to authenticated;

-- Safe union backfill: only exact project/site grants with exactly one active
-- staff record are projected. Broad and ambiguous grants remain PBAC-only.
create temporary table project_room_pbac_backfill_candidates on commit drop as
with permission_mapping(permission_code, room_code, action_code) as (
  values
    ('project.daily_log.view', 'daily_log', 'view'),
    ('project.daily_log.create', 'daily_log', 'edit'),
    ('project.daily_log.edit_own', 'daily_log', 'edit'),
    ('project.daily_log.delete_own', 'daily_log', 'delete'),
    ('project.daily_log.submit', 'daily_log', 'submit'),
    ('project.daily_log.verify', 'daily_log', 'verify'),
    ('project.daily_log.summarize', 'daily_log', 'verify'),
    ('project.daily_log.approve', 'daily_log', 'approve'),
    ('project.material_boq.view', 'material_planning', 'view'),
    ('project.material_boq.edit', 'material_planning', 'edit'),
    ('project.material_boq.delete', 'material_planning', 'delete')
), candidates as (
  select
    grant_row.id as grant_id,
    grant_row.user_id,
    grant_row.granted_by,
    staff.id as project_staff_id,
    staff.project_id,
    case when grant_row.scope_type = 'construction_site' then staff.construction_site_id else null end as construction_site_id,
    mapping.room_code,
    mapping.action_code,
    count(*) over (partition by grant_row.id) as matching_staff_count
  from public.user_permission_grants grant_row
  join permission_mapping mapping on mapping.permission_code = grant_row.permission_code
  join public.users user_row on user_row.id = grant_row.user_id and coalesce(user_row.is_active, true)
  join public.project_staff staff
    on staff.user_id = grant_row.user_id::text
    and staff.end_date is null
    and (
      (
        grant_row.scope_type = 'project'
        and grant_row.scope_id = staff.project_id
        and staff.construction_site_id is null
      )
      or (
        grant_row.scope_type = 'construction_site'
        and grant_row.scope_id = staff.construction_site_id
      )
    )
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and grant_row.scope_type in ('project', 'construction_site')
)
select distinct
  user_id,
  granted_by,
  project_staff_id,
  project_id,
  construction_site_id,
  room_code,
  action_code
from candidates
where matching_staff_count = 1;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id, is_active, created_by, updated_at
)
select distinct
  candidate.project_id,
  candidate.construction_site_id,
  candidate.room_code,
  candidate.project_staff_id,
  true,
  candidate.granted_by,
  now()
from project_room_pbac_backfill_candidates candidate
on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
do update set is_active = true, updated_at = now();

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by, granted_at, updated_at
)
select distinct
  member.id,
  candidate.action_code,
  true,
  candidate.granted_by,
  now(),
  now()
from project_room_pbac_backfill_candidates candidate
join public.project_permission_room_members member
  on member.project_id = candidate.project_id
  and member.construction_site_id is not distinct from candidate.construction_site_id
  and member.room_code = candidate.room_code
  and member.project_staff_id = candidate.project_staff_id
on conflict (room_member_id, action_code)
do update set is_active = true, updated_at = now();

insert into public.permission_audit_events (
  actor_user_id, event_type, before_grants, after_grants, metadata
)
select
  null,
  'project_room_pbac_backfill',
  '[]'::jsonb,
  coalesce(jsonb_agg(jsonb_build_object(
    'user_id', candidate.user_id,
    'project_staff_id', candidate.project_staff_id,
    'project_id', candidate.project_id,
    'construction_site_id', candidate.construction_site_id,
    'room_code', candidate.room_code,
    'action_code', candidate.action_code
  )), '[]'::jsonb),
  jsonb_build_object(
    'source', 'project_room_pbac_backfill',
    'row_count', count(*)
  )
from project_room_pbac_backfill_candidates candidate;

-- Daily Log namespace compatibility now resolves through effective Room
-- actions. Broad PBAC actions stay explicit exceptions during the pilot.
create or replace function app_private.daily_log_has_action(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_permission_code
    when 'project.daily_log.view' then app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'daily_log',
      'view'
    )
    when 'project.daily_log.create' then app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'daily_log',
      'edit'
    )
    when 'project.daily_log.edit_own' then app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'daily_log',
      'edit'
    )
    when 'project.daily_log.delete_own' then app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'daily_log',
      'delete'
    )
    when 'project.daily_log.submit' then app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'daily_log',
      'submit'
    )
    when 'project.daily_log.verify' then app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'daily_log',
      'verify'
    )
    when 'project.daily_log.summarize' then app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'daily_log',
      'verify'
    )
    when 'project.daily_log.approve' then app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'daily_log',
      'approve'
    )
    when 'project.daily_log.return' then
      app_private.project_actor_has_effective_room_action(
        p_user_id, p_project_id, p_construction_site_id, 'daily_log', 'verify'
      )
      or app_private.project_actor_has_effective_room_action(
        p_user_id, p_project_id, p_construction_site_id, 'daily_log', 'approve'
      )
      or (
        app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
        and exists (
          select 1
          from public.users actor
          where actor.id = p_user_id
            and coalesce(actor.is_active, true)
            and (
              actor.role = 'ADMIN'
              or exists (
                select 1
                from public.project_staff staff
                where staff.user_id = p_user_id::text
                  and staff.project_id = p_project_id
                  and staff.end_date is null
                  and (
                    nullif(p_construction_site_id, '') is null
                    or staff.construction_site_id is null
                    or staff.construction_site_id = p_construction_site_id
                  )
              )
            )
        )
        and app_private.project_has_permission_v2(
          p_project_id, p_construction_site_id, p_permission_code, p_user_id
        )
      )
    when 'project.daily_log.edit_all' then
      app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
      and exists (
        select 1
        from public.users actor
        where actor.id = p_user_id
          and coalesce(actor.is_active, true)
          and (
            actor.role = 'ADMIN'
            or exists (
              select 1
              from public.project_staff staff
              where staff.user_id = p_user_id::text
                and staff.project_id = p_project_id
                and staff.end_date is null
                and (
                  nullif(p_construction_site_id, '') is null
                  or staff.construction_site_id is null
                  or staff.construction_site_id = p_construction_site_id
                )
            )
          )
      )
      and app_private.project_has_permission_v2(
        p_project_id, p_construction_site_id, p_permission_code, p_user_id
      )
    when 'project.daily_log.delete_all' then
      app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
      and exists (
        select 1
        from public.users actor
        where actor.id = p_user_id
          and coalesce(actor.is_active, true)
          and (
            actor.role = 'ADMIN'
            or exists (
              select 1
              from public.project_staff staff
              where staff.user_id = p_user_id::text
                and staff.project_id = p_project_id
                and staff.end_date is null
                and (
                  nullif(p_construction_site_id, '') is null
                  or staff.construction_site_id is null
                  or staff.construction_site_id = p_construction_site_id
                )
            )
          )
      )
      and app_private.project_has_permission_v2(
        p_project_id, p_construction_site_id, p_permission_code, p_user_id
      )
    else false
  end;
$$;

revoke all on function app_private.daily_log_has_action(text, text, text, uuid)
  from public, anon, authenticated;

create or replace function app_private.daily_log_can_select(
  p_project_id text,
  p_construction_site_id text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.daily_log_has_any_action(
    p_project_id,
    p_construction_site_id,
    array[
      'project.daily_log.view',
      'project.daily_log.create',
      'project.daily_log.edit_own',
      'project.daily_log.edit_all',
      'project.daily_log.delete_own',
      'project.daily_log.delete_all',
      'project.daily_log.submit',
      'project.daily_log.return',
      'project.daily_log.verify',
      'project.daily_log.approve',
      'project.daily_log.summarize'
    ],
    p_user_id
  );
$$;

revoke all on function app_private.daily_log_can_select(text, text, uuid) from public, anon;
grant execute on function app_private.daily_log_can_select(text, text, uuid) to authenticated;

-- BOQ RLS: insert/update = edit; delete = delete. No edit-to-delete path.
drop policy if exists material_budget_items_select on public.material_budget_items;
create policy material_budget_items_select
  on public.material_budget_items for select to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'view'
    )
    or app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'edit'
    )
    or app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'delete'
    )
  );

drop policy if exists material_budget_items_insert on public.material_budget_items;
create policy material_budget_items_insert
  on public.material_budget_items for insert to authenticated
  with check (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'edit'
    )
  );

drop policy if exists material_budget_items_update on public.material_budget_items;
create policy material_budget_items_update
  on public.material_budget_items for update to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'edit'
    )
  )
  with check (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'edit'
    )
  );

drop policy if exists material_budget_items_delete on public.material_budget_items;
create policy material_budget_items_delete
  on public.material_budget_items for delete to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'delete'
    )
  );

drop policy if exists project_work_boq_items_select on public.project_work_boq_items;
create policy project_work_boq_items_select
  on public.project_work_boq_items for select to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'view'
    )
    or app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'edit'
    )
    or app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'delete'
    )
  );

drop policy if exists project_work_boq_items_insert on public.project_work_boq_items;
create policy project_work_boq_items_insert
  on public.project_work_boq_items for insert to authenticated
  with check (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'edit'
    )
  );

drop policy if exists project_work_boq_items_update on public.project_work_boq_items;
create policy project_work_boq_items_update
  on public.project_work_boq_items for update to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'edit'
    )
  )
  with check (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'edit'
    )
  );

drop policy if exists project_work_boq_items_delete on public.project_work_boq_items;
create policy project_work_boq_items_delete
  on public.project_work_boq_items for delete to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id,
      'material_planning',
      'delete'
    )
  );

-- Admin-only health surface used by the Permission Health page and audit SQL.
create or replace function public.get_project_permission_room_health(
  p_project_id text,
  p_construction_site_id text default null
)
returns table (
  issue_group text,
  issue_code text,
  room_code text,
  action_code text,
  user_id uuid,
  detail jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  with scoped_staff as (
    select staff.*, user_row.id as app_user_id, user_row.role as app_user_role
    from public.project_staff staff
    join public.users user_row on user_row.id::text = staff.user_id
    where staff.project_id = p_project_id
      and (
        nullif(p_construction_site_id, '') is null
        or staff.construction_site_id is null
        or staff.construction_site_id = p_construction_site_id
      )
  ), fallback_only as (
    select distinct
      'user_only_pbac_fallback'::text as issue_group,
      'fallback_only_user'::text as issue_code,
      binding.room_code,
      binding.action_code,
      staff.app_user_id as user_id,
      jsonb_build_object('enforcement_status', binding.enforcement_status) as detail
    from scoped_staff staff
    join app_private.project_permission_room_action_bindings binding
      on binding.enforcement_status in ('pilot', 'enforced')
    where staff.end_date is null
      and staff.app_user_role <> 'ADMIN'
      and app_private.project_actor_has_effective_room_action(
        staff.app_user_id, p_project_id, p_construction_site_id,
        binding.room_code, binding.action_code
      )
      and not app_private.project_user_has_room_action(
        staff.app_user_id, p_project_id, p_construction_site_id,
        binding.room_code, binding.action_code
      )
  ), unmapped as (
    select distinct
      'unmapped_grant'::text,
      'legacy_grant_not_mapped'::text,
      null::text,
      null::text,
      grant_row.user_id,
      jsonb_build_object(
        'permission_code', grant_row.permission_code,
        'scope_type', grant_row.scope_type,
        'scope_id', grant_row.scope_id
      )
    from public.user_permission_grants grant_row
    where grant_row.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and grant_row.permission_code like 'project.%'
      and (
        (grant_row.scope_type = 'project' and grant_row.scope_id in ('*', p_project_id))
        or (
          nullif(p_construction_site_id, '') is not null
          and grant_row.scope_type = 'construction_site'
          and grant_row.scope_id in ('*', p_construction_site_id)
        )
      )
      and not exists (
        select 1
        from app_private.project_permission_room_action_bindings binding
        where grant_row.permission_code = any(binding.legacy_permission_codes)
      )
  ), invalid_room as (
    select distinct
      'invalid_scope_or_staff'::text,
      case
        when staff.id is null then 'orphan_room_member'
        when user_row.id is null then 'missing_user'
        when staff.end_date is not null then 'inactive_project_staff'
        when not coalesce(user_row.is_active, false) then 'inactive_user'
        else 'scope_mismatch'
      end,
      member.room_code,
      null::text,
      user_row.id,
      jsonb_build_object(
        'room_member_id', member.id,
        'project_staff_id', member.project_staff_id,
        'member_site_id', member.construction_site_id
      )
    from public.project_permission_room_members member
    left join public.project_staff staff on staff.id = member.project_staff_id
    left join public.users user_row on user_row.id::text = staff.user_id
    where member.project_id = p_project_id
      and member.is_active
      and (
        nullif(p_construction_site_id, '') is null
        or member.construction_site_id is null
        or member.construction_site_id = p_construction_site_id
      )
      and (
        staff.id is null
        or user_row.id is null
        or staff.end_date is not null
        or not coalesce(user_row.is_active, false)
        or staff.project_id is distinct from member.project_id
        or (
          member.construction_site_id is not null
          and staff.construction_site_id is not null
          and member.construction_site_id is distinct from staff.construction_site_id
        )
      )
  )
  select
    'room_action_not_fully_connected'::text,
    'action_not_enforced'::text,
    binding.room_code,
    binding.action_code,
    null::uuid,
    jsonb_build_object(
      'enforcement_status', binding.enforcement_status,
      'verified_source', binding.verified_source,
      'verified_at', binding.verified_at
    )
  from app_private.project_permission_room_action_bindings binding
  where binding.enforcement_status <> 'enforced'
  union all select * from fallback_only
  union all select * from unmapped
  union all select * from invalid_room;
$$;

revoke all on function public.get_project_permission_room_health(text, text) from public, anon;
grant execute on function public.get_project_permission_room_health(text, text) to authenticated;

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
  v_unmapped_grants jsonb := '[]'::jsonb;
  v_invalid_scope_or_staff jsonb := '[]'::jsonb;
begin
  perform app_private.assert_project_permission_room_admin();

  select coalesce(jsonb_agg(jsonb_build_object(
    'roomCode', binding.room_code,
    'actionCode', binding.action_code,
    'enforcementStatus', binding.enforcement_status,
    'verifiedSource', binding.verified_source,
    'verifiedAt', binding.verified_at,
    'severity', case when binding.enforcement_status = 'audit_only' then 'medium' else 'info' end
  ) order by binding.room_code, binding.action_code), '[]'::jsonb)
  into v_actions_not_connected
  from app_private.project_permission_room_action_bindings binding
  where binding.enforcement_status <> 'enforced';

  select coalesce(jsonb_agg(to_jsonb(finding) order by finding.project_id, finding.room_code, finding.action_code, finding.user_id), '[]'::jsonb)
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
      staff.project_id,
      binding.room_code,
      binding.action_code,
      user_row.id as user_id
    from public.project_staff staff
    join public.users user_row
      on user_row.id::text = staff.user_id and coalesce(user_row.is_active, true)
    join app_private.project_permission_room_action_bindings binding
      on binding.enforcement_status in ('pilot', 'enforced')
    where staff.end_date is null
      and user_row.role <> 'ADMIN'
      and app_private.project_actor_has_effective_room_action(
        user_row.id,
        staff.project_id,
        staff.construction_site_id,
        binding.room_code,
        binding.action_code
      )
      and not app_private.project_user_has_room_action(
        user_row.id,
        staff.project_id,
        staff.construction_site_id,
        binding.room_code,
        binding.action_code
      )
  ) finding;

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
        select 1
        from app_private.project_permission_room_action_bindings binding
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
      staff.id is null
      or user_row.id is null
      or staff.end_date is not null
      or not coalesce(user_row.is_active, false)
      or staff.project_id is distinct from member.project_id
      or (
        member.construction_site_id is not null
        and staff.construction_site_id is not null
        and member.construction_site_id is distinct from staff.construction_site_id
      )
    );

  return jsonb_build_object(
    'generatedAt', now(),
    'projectRoomPbacFallbackEnabled',
      app_private.permission_hardening_flag('project_room_pbac_fallback_enabled'),
    'checks', jsonb_build_object(
      'roomActionsNotConnected', v_actions_not_connected,
      'roomFallbackOnlyUsers', v_fallback_only_users,
      'roomUnmappedGrants', v_unmapped_grants,
      'roomInvalidScopeOrStaff', v_invalid_scope_or_staff
    )
  );
end;
$$;

revoke all on function public.get_project_permission_room_health_summary() from public, anon;
grant execute on function public.get_project_permission_room_health_summary() to authenticated;

notify pgrst, 'reload schema';
