-- P3: project Room templates by role. Setting up a person in a project meant
-- opening each of the ten Rooms and ticking actions; only 6 of 86 projects
-- have Room permissions. A template bundles the Room actions of a site role
-- (site commander, field engineer, QS, site storekeeper, project accountant,
-- read-only) so an Admin assigns a person in one step, with a preview.
-- Templates are data that Admins edit in Settings; applying one goes through
-- public.replace_project_permission_room_members per Room, so every Room rule
-- (enforced actions only, prerequisites) still applies. Nothing is assigned by
-- this migration.

create table if not exists public.project_room_templates (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  description text,
  -- { "<room_code>": ["view", "edit", ...], ... }
  room_actions jsonb not null default '{}'::jsonb check (jsonb_typeof(room_actions) = 'object'),
  -- hrm_positions ids for which this template is suggested
  suggested_position_ids uuid[] not null default '{}',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.project_room_templates enable row level security;
revoke all on public.project_room_templates from anon, authenticated;
grant select on public.project_room_templates to authenticated;
drop policy if exists project_room_templates_select on public.project_room_templates;
create policy project_room_templates_select on public.project_room_templates
  for select to authenticated using (true);

-- Keep only actions a Room allows, and add each action's prerequisites.
create or replace function app_private.normalize_room_template_actions(p_room_actions jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_room record;
  v_actions text[];
begin
  if jsonb_typeof(coalesce(p_room_actions, '{}'::jsonb)) <> 'object' then
    raise exception 'ROOM_TEMPLATE_INVALID' using errcode = '22023';
  end if;
  for v_room in select key room_code, value actions from jsonb_each(coalesce(p_room_actions, '{}'::jsonb)) loop
    if not exists (select 1 from public.project_permission_rooms r where r.code = v_room.room_code and r.is_active) then
      raise exception 'ROOM_TEMPLATE_UNKNOWN_ROOM: %', v_room.room_code using errcode = '22023';
    end if;
    select array_agg(distinct a order by a) into v_actions
    from (
      select action.value a from jsonb_array_elements_text(v_room.actions) action
      union
      select prerequisite from jsonb_array_elements_text(v_room.actions) action
      join app_private.project_permission_room_action_bindings b
        on b.room_code = v_room.room_code and b.action_code = action.value
      cross join lateral unnest(b.prerequisite_action_codes) prerequisite
    ) wanted;
    if exists (
      select 1 from unnest(coalesce(v_actions, '{}'::text[])) a
      where not exists (
        select 1 from app_private.project_permission_room_action_bindings b
        where b.room_code = v_room.room_code and b.action_code = a and b.enforcement_status <> 'audit_only')
    ) then
      raise exception 'ROOM_TEMPLATE_ACTION_NOT_ALLOWED in %', v_room.room_code using errcode = '22023';
    end if;
    if cardinality(coalesce(v_actions, '{}'::text[])) > 0 then
      v_result := v_result || jsonb_build_object(v_room.room_code, to_jsonb(v_actions));
    end if;
  end loop;
  return v_result;
end;
$$;
revoke all on function app_private.normalize_room_template_actions(jsonb) from public, anon, authenticated;

create or replace function public.save_project_room_template(
  p_code text, p_name text, p_description text, p_room_actions jsonb,
  p_suggested_position_ids uuid[], p_is_active boolean
)
returns public.project_room_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.project_room_templates;
  v_before jsonb;
begin
  if not public.is_admin() then
    raise exception 'ROOM_TEMPLATE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select to_jsonb(t) into v_before from public.project_room_templates t where t.code = p_code;
  insert into public.project_room_templates (code, name, description, room_actions, suggested_position_ids, is_active, updated_by, updated_at)
  values (p_code, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
          app_private.normalize_room_template_actions(p_room_actions),
          coalesce(p_suggested_position_ids, '{}'), coalesce(p_is_active, true), public.current_app_user_id(), now())
  on conflict (code) do update set
    name = excluded.name, description = excluded.description, room_actions = excluded.room_actions,
    suggested_position_ids = excluded.suggested_position_ids, is_active = excluded.is_active,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  insert into public.audit_trail (table_name, record_id, action, old_data, new_data, module, description)
  values ('project_room_templates', v_row.code, case when v_before is null then 'INSERT' else 'UPDATE' end,
          v_before, to_jsonb(v_row), 'SETTINGS', 'Cập nhật mẫu quyền dự án: ' || v_row.name);
  return v_row;
end;
$$;
revoke all on function public.save_project_room_template(text, text, text, jsonb, uuid[], boolean) from public, anon;
grant execute on function public.save_project_room_template(text, text, text, jsonb, uuid[], boolean) to authenticated;

-- A project staff member's current Room actions: { "<room>": [actions] }.
create or replace function public.get_project_staff_room_actions(
  p_project_id text, p_construction_site_id text, p_project_staff_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'ROOM_TEMPLATE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(room_code, actions) from (
      select m.room_code, jsonb_agg(a.action_code order by a.action_code) actions
      from public.project_permission_room_members m
      join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active
      where m.project_id = p_project_id and m.construction_site_id is not distinct from nullif(p_construction_site_id, '')
        and m.project_staff_id = p_project_staff_id and m.is_active
      group by m.room_code) x), '{}'::jsonb);
end;
$$;
revoke all on function public.get_project_staff_room_actions(text, text, uuid) from public, anon;
grant execute on function public.get_project_staff_room_actions(text, text, uuid) to authenticated;

-- Preview (p_dry_run) or apply Room actions to one project staff member.
--   merge   → add the template's actions to what the person already has
--   replace → the person ends up with exactly the template (other Rooms emptied)
--   exact   → the person ends up with exactly p_room_actions: a template the
--             Admin adjusted for this person (added or removed actions), or a
--             hand-made set without a template
create or replace function public.apply_project_room_template(
  p_project_id text,
  p_construction_site_id text,
  p_project_staff_id uuid,
  p_template_code text,
  p_mode text default 'merge',
  p_dry_run boolean default true,
  p_room_actions jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text := nullif(p_construction_site_id, '');
  v_template public.project_room_templates;
  v_room record;
  v_before text[];
  v_target text[];
  v_after text[];
  v_members jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_source jsonb;
  v_customized boolean := false;
begin
  if not public.is_admin() then
    raise exception 'ROOM_TEMPLATE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_mode not in ('merge', 'replace', 'exact') then
    raise exception 'ROOM_TEMPLATE_MODE_INVALID' using errcode = '22023';
  end if;
  if p_template_code is not null then
    select * into v_template from public.project_room_templates t where t.code = p_template_code and t.is_active;
    if not found then
      raise exception 'ROOM_TEMPLATE_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif p_mode <> 'exact' then
    raise exception 'ROOM_TEMPLATE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_mode = 'exact' then
    if p_room_actions is null then
      raise exception 'ROOM_TEMPLATE_ACTIONS_REQUIRED' using errcode = '22023';
    end if;
    v_source := app_private.normalize_room_template_actions(p_room_actions);
    v_customized := v_template.code is null or v_source is distinct from v_template.room_actions;
  else
    v_source := v_template.room_actions;
  end if;
  if not exists (select 1 from public.project_staff s where s.id = p_project_staff_id and s.project_id = p_project_id and s.end_date is null) then
    raise exception 'ROOM_TEMPLATE_STAFF_NOT_IN_PROJECT' using errcode = '22023';
  end if;

  for v_room in select r.code from public.project_permission_rooms r where r.is_active order by r.sort_order loop
    select coalesce(array_agg(a.action_code order by a.action_code), '{}') into v_before
    from public.project_permission_room_members m
    join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active
    where m.project_id = p_project_id and m.construction_site_id is not distinct from v_site
      and m.room_code = v_room.code and m.project_staff_id = p_project_staff_id and m.is_active;
    v_target := array(select jsonb_array_elements_text(coalesce(v_source -> v_room.code, '[]'::jsonb)));
    v_after := case when p_mode = 'merge'
      then array(select distinct x from unnest(v_before || v_target) x order by x)
      else array(select distinct x from unnest(v_target) x order by x) end;
    if v_after = v_before then continue; end if;

    v_changes := v_changes || jsonb_build_object('roomCode', v_room.code, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after));

    if not p_dry_run then
      select coalesce(jsonb_agg(jsonb_build_object('project_staff_id', staff_id, 'action_codes', to_jsonb(actions))), '[]'::jsonb)
      into v_members
      from (
        select m.project_staff_id staff_id, array_agg(a.action_code order by a.action_code) actions
        from public.project_permission_room_members m
        join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active
        where m.project_id = p_project_id and m.construction_site_id is not distinct from v_site
          and m.room_code = v_room.code and m.is_active and m.project_staff_id <> p_project_staff_id
        group by m.project_staff_id
        union all
        select p_project_staff_id, v_after where cardinality(v_after) > 0
      ) members;
      perform public.replace_project_permission_room_members(p_project_id, v_site, v_room.code, v_members);
    end if;
  end loop;

  if not p_dry_run and jsonb_array_length(v_changes) > 0 then
    insert into public.audit_trail (table_name, record_id, action, new_data, module, description)
    values ('project_permission_room_members', p_project_staff_id::text, 'UPDATE',
      jsonb_build_object('projectId', p_project_id, 'constructionSiteId', v_site, 'template', v_template.code,
        'mode', p_mode, 'customized', v_customized, 'changes', v_changes),
      'DA', case when v_template.code is null then 'Phân quyền Room tùy chỉnh cho một nhân sự'
             else 'Áp mẫu quyền "' || v_template.name || '"'
               || case when v_customized then ' (có tùy chỉnh)' when p_mode = 'merge' then ' (thêm vào quyền hiện có)' else ' (thay theo mẫu)' end
             end);
  end if;

  return jsonb_build_object('template', v_template.code, 'mode', p_mode, 'customized', v_customized,
    'applied', not p_dry_run, 'changes', v_changes);
end;
$$;
revoke all on function public.apply_project_room_template(text, text, uuid, text, text, boolean, jsonb) from public, anon;
grant execute on function public.apply_project_room_template(text, text, uuid, text, text, boolean, jsonb) to authenticated;

-- Default templates (editable in Settings → Mẫu quyền). Prerequisites (view)
-- are added by the normaliser.
insert into public.project_room_templates (code, name, description, room_actions, suggested_position_ids, sort_order)
select t.code, t.name, t.description, app_private.normalize_room_template_actions(t.room_actions),
  coalesce((select array_agg(p.id) from public.hrm_positions p where p.name ~* t.position_pattern), '{}'), t.sort_order
from (values
  ('site_commander', 'Chỉ huy trưởng / Chỉ huy phó',
   'Điều hành công trường: duyệt nhật ký, chốt tiến độ, duyệt chất lượng, an toàn và cấp vật tư công trường.',
   '{"daily_log":["edit","submit","verify","approve"],"gantt":["edit"],"weekly_progress":["edit","confirm"],
     "material_planning":["view"],"material_request":["submit","approve","confirm","view_available_stock"],"material_po":["confirm"],
     "quality":["verify","approve"],"safety":["verify","confirm","approve"],"quantity_acceptance":["submit","verify"],"payment":["view"]}'::jsonb,
   '^Chỉ huy (trưởng|phó)', 10),
  ('field_engineer', 'Kỹ thuật hiện trường',
   'Lập nhật ký, cập nhật tiến độ, đề xuất vật tư, lập hồ sơ chất lượng và an toàn.',
   '{"daily_log":["edit","submit"],"gantt":["view"],"weekly_progress":["edit"],"material_planning":["view"],
     "material_request":["edit","submit"],"quality":["edit","submit"],"safety":["edit","submit"],"quantity_acceptance":["view"]}'::jsonb,
   '(^K[iĩỹ] thuật trưởng$|^Nhân viên k[iĩỹ] thuật$|^Cán bộ giám sát$|^Cán bộ ME$|^Cán bộ Trắc đạc$|^Cán bộ KCS$|^Cán bộ HSE$)', 20),
  ('quantity_surveyor', 'QS (khối lượng)',
   'Lập và kiểm tra nghiệm thu khối lượng, hồ sơ thanh toán, kế hoạch vật tư.',
   '{"daily_log":["view"],"gantt":["view"],"material_planning":["edit"],"quantity_acceptance":["edit","submit","verify"],
     "payment":["edit","submit"],"material_request":["view"]}'::jsonb,
   '(QS|Dự toán)', 30),
  ('site_storekeeper', 'Thủ kho công trường',
   'Xử lý đề xuất vật tư, xác nhận cấp phát và nhận hàng PO tại công trường.',
   '{"daily_log":["view"],"material_request":["edit","submit","confirm","view_available_stock"],"material_po":["confirm"],"material_planning":["view"]}'::jsonb,
   '(Thủ kho|Vật tư)', 40),
  ('project_accountant', 'Kế toán dự án',
   'Lập và kiểm tra hồ sơ thanh toán; xem nghiệm thu và đơn hàng.',
   '{"payment":["edit","submit","verify"],"quantity_acceptance":["view"],"material_po":["view"],"material_request":["view"]}'::jsonb,
   'Kế toán dự án', 50),
  ('viewer', 'Chỉ xem',
   'Xem mọi Room của dự án, không thao tác.',
   '{"daily_log":["view"],"material_planning":["view"],"material_request":["view"],"material_po":["view"],"gantt":["view"],
     "weekly_progress":["view"],"quantity_acceptance":["view"],"payment":["view"],"quality":["view"],"safety":["view"]}'::jsonb,
   '^$', 90)
) t(code, name, description, room_actions, position_pattern, sort_order)
on conflict (code) do nothing;
