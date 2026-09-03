-- Fixed, project-scoped permission Rooms. A Room scopes reusable actions to
-- one business workflow so a generic action such as `approve` never mixes
-- recipients from different workflows.

create schema if not exists app_private;

create table if not exists public.project_permission_rooms (
  code text primary key,
  group_code text not null,
  name text not null,
  description text not null default '',
  allowed_actions text[] not null,
  required_actions text[] not null default '{}'::text[],
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_permission_rooms_allowed_actions_check check (
    allowed_actions <@ array['view','edit','delete','submit','verify','confirm','approve','view_available_stock']::text[]
  ),
  constraint project_permission_rooms_required_actions_check check (
    required_actions <@ allowed_actions
  )
);

create table if not exists public.project_permission_room_members (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  construction_site_id text,
  room_code text not null references public.project_permission_rooms(code) on update cascade,
  project_staff_id uuid not null references public.project_staff(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_permission_room_member_scope_uidx
  on public.project_permission_room_members (
    project_id, coalesce(construction_site_id, ''), room_code, project_staff_id
  );

create index if not exists project_permission_room_members_project_idx
  on public.project_permission_room_members (project_id, room_code)
  where is_active;

create table if not exists public.project_permission_room_member_actions (
  room_member_id uuid not null references public.project_permission_room_members(id) on delete cascade,
  action_code text not null,
  is_active boolean not null default true,
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_member_id, action_code),
  constraint project_permission_room_member_actions_code_check check (
    action_code = any(array['view','edit','delete','submit','verify','confirm','approve','view_available_stock']::text[])
  )
);

create index if not exists project_permission_room_member_actions_active_idx
  on public.project_permission_room_member_actions (room_member_id, action_code)
  where is_active;

insert into public.project_permission_rooms (
  code, group_code, name, description, allowed_actions, required_actions, sort_order
)
values
  ('daily_log', 'daily_log', 'Nhật ký công trường', 'Lập, kiểm tra và duyệt nhật ký.', array['view','edit','delete','submit','verify','approve'], array['verify','approve'], 10),
  ('material_planning', 'material', 'Kế hoạch & BOQ vật tư', 'Quản lý kế hoạch và BOQ vật tư.', array['view','edit','delete'], array[]::text[], 20),
  ('material_request', 'material', 'Đề xuất vật tư', 'Gửi, kiểm tra, duyệt và xác nhận cấp vật tư.', array['view','edit','delete','submit','verify','confirm','approve','view_available_stock'], array['approve','confirm'], 30),
  ('material_po', 'material', 'Đơn hàng PO', 'Tạo, gửi duyệt, duyệt và xác nhận nhận hàng.', array['view','edit','delete','submit','approve','confirm'], array['approve'], 40),
  ('material_waste', 'material', 'Hao hụt vật tư', 'Ghi nhận và duyệt hao hụt.', array['view','edit','approve'], array['approve'], 50),
  ('custom_material', 'material', 'Vật tư phi tiêu chuẩn', 'Tạo, sửa và duyệt vật tư phi tiêu chuẩn.', array['view','edit','approve'], array['approve'], 60),
  ('gantt', 'progress', 'Tiến độ Gantt', 'Quản lý công việc và xác nhận hoàn thành.', array['view','edit','delete','submit','verify','approve'], array['verify','approve'], 70),
  ('weekly_progress', 'progress', 'Chốt tiến độ ngày/tuần', 'Cập nhật, duyệt và khóa kỳ tiến độ.', array['view','edit','submit','verify','approve','confirm'], array['approve'], 80),
  ('quantity_acceptance', 'finance', 'Nghiệm thu khối lượng', 'Lập và duyệt nghiệm thu khối lượng.', array['view','edit','delete','submit','verify','approve'], array['approve'], 90),
  ('payment', 'finance', 'Thanh toán', 'Lập, duyệt và xác nhận thanh toán.', array['view','edit','delete','submit','verify','approve','confirm'], array['approve','confirm'], 100),
  ('boq_reconciliation', 'finance', 'Đối soát BOQ', 'Kiểm tra, duyệt và khóa đối soát.', array['view','edit','submit','verify','approve'], array['verify'], 110),
  ('quality', 'quality', 'Hồ sơ & checklist chất lượng', 'Lập, kiểm tra và duyệt chất lượng.', array['view','edit','delete','submit','verify','approve'], array['approve'], 120),
  ('safety', 'safety', 'Hồ sơ & sự cố an toàn', 'Quản lý hồ sơ và đóng sự cố.', array['view','edit','delete','submit','verify','confirm','approve'], array['approve'], 130),
  ('subcontract', 'subcontract', 'Nghiệm thu & thanh toán nhà thầu', 'Quản lý nghiệm thu và thanh toán nhà thầu.', array['view','edit','delete','submit','approve','confirm'], array['approve'], 140)
on conflict (code) do update
set group_code = excluded.group_code,
    name = excluded.name,
    description = excluded.description,
    allowed_actions = excluded.allowed_actions,
    required_actions = excluded.required_actions,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

create or replace function app_private.validate_project_permission_room_member_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed_actions text[];
begin
  select room.allowed_actions
  into v_allowed_actions
  from public.project_permission_room_members member
  join public.project_permission_rooms room on room.code = member.room_code
  where member.id = new.room_member_id;

  if v_allowed_actions is null or not (new.action_code = any(v_allowed_actions)) then
    raise exception 'Action % is not allowed in this permission Room', new.action_code
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function app_private.validate_project_permission_room_member_action() from public, anon, authenticated;

drop trigger if exists trg_validate_project_permission_room_member_action
  on public.project_permission_room_member_actions;
create trigger trg_validate_project_permission_room_member_action
  before insert or update of room_member_id, action_code
  on public.project_permission_room_member_actions
  for each row execute function app_private.validate_project_permission_room_member_action();

alter table public.project_permission_rooms enable row level security;
alter table public.project_permission_room_members enable row level security;
alter table public.project_permission_room_member_actions enable row level security;

drop policy if exists project_permission_rooms_select_authenticated on public.project_permission_rooms;
create policy project_permission_rooms_select_authenticated
  on public.project_permission_rooms for select to authenticated using (true);

drop policy if exists project_permission_room_members_select_authenticated on public.project_permission_room_members;
create policy project_permission_room_members_select_authenticated
  on public.project_permission_room_members for select to authenticated
  using (public.current_app_user_id() is not null);

drop policy if exists project_permission_room_member_actions_select_authenticated on public.project_permission_room_member_actions;
create policy project_permission_room_member_actions_select_authenticated
  on public.project_permission_room_member_actions for select to authenticated
  using (public.current_app_user_id() is not null);

revoke insert, update, delete on public.project_permission_rooms from public, anon, authenticated;
revoke insert, update, delete on public.project_permission_room_members from public, anon, authenticated;
revoke insert, update, delete on public.project_permission_room_member_actions from public, anon, authenticated;
revoke select on public.project_permission_room_members,
  public.project_permission_room_member_actions from public, anon, authenticated;
grant select on public.project_permission_rooms to authenticated;

create or replace function app_private.project_user_has_room_action(
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
  select exists (
    select 1
    from public.users u
    join public.project_staff staff on staff.user_id = u.id::text
    join public.project_permission_room_members member on member.project_staff_id = staff.id
    join public.project_permission_room_member_actions action on action.room_member_id = member.id
    join public.project_permission_rooms room on room.code = member.room_code
    where u.id = p_user_id
      and coalesce(u.is_active, true)
      and staff.end_date is null
      and staff.project_id = p_project_id
      and member.project_id = p_project_id
      and member.room_code = p_room_code
      and coalesce(member.is_active, false)
      and coalesce(action.is_active, false)
      and coalesce(room.is_active, false)
      and action.action_code = p_action_code
      and p_action_code = any(room.allowed_actions)
      and (member.construction_site_id is null or member.construction_site_id = p_construction_site_id)
  );
$$;

revoke all on function app_private.project_user_has_room_action(uuid, text, text, text, text) from public, anon;
grant execute on function app_private.project_user_has_room_action(uuid, text, text, text, text) to authenticated;

create or replace function public.project_user_has_room_action(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_action_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.project_user_has_room_action(
    p_user_id, p_project_id, p_construction_site_id, p_room_code, p_action_code
  );
$$;

revoke all on function public.project_user_has_room_action(text, text, text, text, uuid) from public, anon;
grant execute on function public.project_user_has_room_action(text, text, text, text, uuid) to authenticated;

create or replace function app_private.assert_project_permission_room_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if not exists (
    select 1
    from public.users u
    where u.id = v_actor_user_id
      and coalesce(u.is_active, true)
      and u.role = 'ADMIN'
  ) then
    raise exception 'Chỉ admin hệ thống được sửa Room phân quyền.'
      using errcode = '42501';
  end if;
  return v_actor_user_id;
end;
$$;

revoke all on function app_private.assert_project_permission_room_admin() from public, anon, authenticated;

create or replace function public.list_project_permission_rooms()
returns table (
  code text,
  group_code text,
  name text,
  description text,
  allowed_actions text[],
  required_actions text[],
  sort_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  select room.code, room.group_code, room.name, room.description,
    room.allowed_actions, room.required_actions, room.sort_order
  from public.project_permission_rooms room
  where room.is_active
  order by room.sort_order, room.code;
$$;

revoke all on function public.list_project_permission_rooms() from public, anon;
grant execute on function public.list_project_permission_rooms() to authenticated;

create or replace function public.get_project_permission_room(
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
  member_id uuid,
  project_staff_id uuid,
  user_id uuid,
  user_name text,
  user_avatar text,
  action_codes text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  select room.code, room.group_code, room.name, room.description,
    room.allowed_actions, room.required_actions, room.sort_order,
    member.id, staff.id, user_row.id, user_row.name, user_row.avatar,
    coalesce(array_agg(action.action_code order by action.action_code)
      filter (where action.is_active), '{}'::text[])
  from public.project_permission_rooms room
  left join public.project_permission_room_members member
    on member.room_code = room.code
    and member.project_id = p_project_id
    and member.construction_site_id is not distinct from nullif(p_construction_site_id, '')
    and member.is_active
  left join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
  left join public.users user_row on user_row.id::text = staff.user_id and coalesce(user_row.is_active, true)
  left join public.project_permission_room_member_actions action on action.room_member_id = member.id
  where room.code = p_room_code and room.is_active
  group by room.code, room.group_code, room.name, room.description, room.allowed_actions,
    room.required_actions, room.sort_order, member.id, staff.id, user_row.id, user_row.name, user_row.avatar
  order by user_row.name nulls last, member.id;
$$;

revoke all on function public.get_project_permission_room(text, text, text) from public, anon;
grant execute on function public.get_project_permission_room(text, text, text) to authenticated;

create or replace function public.list_project_room_staff_candidates(
  p_project_id text,
  p_construction_site_id text
)
returns table (
  project_staff_id uuid,
  user_id uuid,
  user_name text,
  user_avatar text,
  position_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.assert_project_permission_room_admin();
  select staff.id, user_row.id, user_row.name, user_row.avatar, position.name
  from public.project_staff staff
  join public.users user_row on user_row.id::text = staff.user_id
  left join public.hrm_positions position on position.id = staff.position_id
  where staff.project_id = p_project_id
    and staff.end_date is null
    and coalesce(user_row.is_active, true)
    and (nullif(p_construction_site_id, '') is null or staff.construction_site_id is null or staff.construction_site_id = p_construction_site_id)
  order by user_row.name, staff.id;
$$;

revoke all on function public.list_project_room_staff_candidates(text, text) from public, anon;
grant execute on function public.list_project_room_staff_candidates(text, text) to authenticated;

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
    from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb)
    where item.project_staff_id is null
      or jsonb_typeof(coalesce(item.action_codes, 'null'::jsonb)) <> 'array'
  ) then
    raise exception 'Each Room member requires project_staff_id and action_codes[]' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb)
    cross join lateral jsonb_array_elements_text(item.action_codes) as code(action_code)
    where not (code.action_code = any(v_allowed_actions))
  ) then
    raise exception 'Payload contains an action not allowed in this Room' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb)
    group by item.project_staff_id
    having count(*) > 1
  ) then
    raise exception 'Each project staff member can appear once in a Room payload' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb)
    cross join lateral (
      select code.action_code, count(*) as code_count
      from jsonb_array_elements_text(item.action_codes) as code(action_code)
      group by code.action_code
    ) duplicated
    where duplicated.code_count > 1
  ) then
    raise exception 'A Room action can only be assigned once per staff member' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb)
    left join public.project_staff staff on staff.id = item.project_staff_id
    left join public.users user_row on user_row.id::text = staff.user_id
    where staff.id is null
      or staff.project_id is distinct from p_project_id
      or staff.end_date is not null
      or not coalesce(user_row.is_active, true)
      or (v_scope_site_id is not null and staff.construction_site_id is not null and staff.construction_site_id <> v_scope_site_id)
  ) then
    raise exception 'Room members must be active staff in the selected project scope' using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_staff_id', member.project_staff_id,
    'action_codes', coalesce(actions.action_codes, '[]'::jsonb)
  ) order by member.project_staff_id), '[]'::jsonb)
  into v_before
  from public.project_permission_room_members member
  left join lateral (
    select jsonb_agg(action.action_code order by action.action_code) as action_codes
    from public.project_permission_room_member_actions action
    where action.room_member_id = member.id and action.is_active
  ) actions on true
  where member.project_id = p_project_id
    and member.construction_site_id is not distinct from v_scope_site_id
    and member.room_code = p_room_code
    and member.is_active;

  insert into public.project_permission_room_members (
    project_id, construction_site_id, room_code, project_staff_id, is_active, created_by, updated_at
  )
  select p_project_id, v_scope_site_id, p_room_code, item.project_staff_id, true, v_actor_user_id, now()
  from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb)
  on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id) do update
  set is_active = true, updated_at = now();

  update public.project_permission_room_members member
  set is_active = false, updated_at = now()
  where member.project_id = p_project_id
    and member.construction_site_id is not distinct from v_scope_site_id
    and member.room_code = p_room_code
    and member.is_active
    and not exists (
      select 1 from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb)
      where item.project_staff_id = member.project_staff_id
    );

  update public.project_permission_room_member_actions action
  set is_active = false, updated_at = now()
  from public.project_permission_room_members member
  where member.id = action.room_member_id
    and member.project_id = p_project_id
    and member.construction_site_id is not distinct from v_scope_site_id
    and member.room_code = p_room_code;

  insert into public.project_permission_room_member_actions (
    room_member_id, action_code, is_active, granted_by, granted_at, updated_at
  )
  select member.id, code.action_code, true, v_actor_user_id, now(), now()
  from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb)
  join public.project_permission_room_members member
    on member.project_id = p_project_id
    and member.construction_site_id is not distinct from v_scope_site_id
    and member.room_code = p_room_code
    and member.project_staff_id = item.project_staff_id
  cross join lateral jsonb_array_elements_text(item.action_codes) as code(action_code)
  on conflict (room_member_id, action_code) do update
  set is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      updated_at = now();

  if exists (
    select 1
    from unnest(v_required_actions) as required(action_code)
    where not exists (
      select 1
      from public.project_permission_room_members member
      join public.project_permission_room_member_actions action on action.room_member_id = member.id
      where member.project_id = p_project_id
        and member.construction_site_id is not distinct from v_scope_site_id
        and member.room_code = p_room_code
        and member.is_active
        and action.is_active
        and action.action_code = required.action_code
    )
  ) then
    raise exception 'Required workflow action has no active Room recipient' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_staff_id', item.project_staff_id,
    'action_codes', item.action_codes
  ) order by item.project_staff_id), '[]'::jsonb)
  into v_after
  from jsonb_to_recordset(p_members) as item(project_staff_id uuid, action_codes jsonb);

  insert into public.permission_audit_events (
    actor_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    v_actor_user_id,
    'replace_project_permission_room_members',
    coalesce(v_before, '[]'::jsonb),
    coalesce(v_after, '[]'::jsonb),
    jsonb_build_object(
      'project_id', p_project_id,
      'construction_site_id', v_scope_site_id,
      'room_code', p_room_code
    )
  );
end;
$$;

revoke all on function app_private.replace_project_permission_room_members(text, text, text, jsonb) from public, anon;
grant execute on function app_private.replace_project_permission_room_members(text, text, text, jsonb) to authenticated;

create or replace function public.replace_project_permission_room_members(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_members jsonb
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.replace_project_permission_room_members(
    p_project_id, p_construction_site_id, p_room_code, p_members
  );
$$;

revoke all on function public.replace_project_permission_room_members(text, text, text, jsonb) from public, anon;
grant execute on function public.replace_project_permission_room_members(text, text, text, jsonb) to authenticated;

create or replace function public.list_project_room_action_recipients(
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_action_code text
)
returns table (
  project_staff_id uuid,
  user_id uuid,
  user_name text,
  user_avatar text
)
language sql
stable
security definer
set search_path = ''
as $$
  select staff.id, user_row.id, user_row.name, user_row.avatar
  from public.project_permission_room_members member
  join public.project_permission_room_member_actions action on action.room_member_id = member.id
  join public.project_permission_rooms room on room.code = member.room_code
  join public.project_staff staff on staff.id = member.project_staff_id
  join public.users user_row on user_row.id::text = staff.user_id
  where member.project_id = p_project_id
    and member.construction_site_id is not distinct from nullif(p_construction_site_id, '')
    and member.room_code = p_room_code
    and action.action_code = p_action_code
    and member.is_active and action.is_active and room.is_active
    and staff.end_date is null and coalesce(user_row.is_active, true)
    and p_action_code = any(room.allowed_actions)
    and (
      public.is_admin()
      or exists (
        select 1
        from public.project_staff caller_staff
        join public.users caller on caller.id::text = caller_staff.user_id
        where caller.id = public.current_app_user_id()
          and coalesce(caller.is_active, true)
          and caller_staff.project_id = p_project_id
          and caller_staff.end_date is null
      )
    )
  order by user_row.name, staff.id;
$$;

revoke all on function public.list_project_room_action_recipients(text, text, text, text) from public, anon;
grant execute on function public.list_project_room_action_recipients(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
