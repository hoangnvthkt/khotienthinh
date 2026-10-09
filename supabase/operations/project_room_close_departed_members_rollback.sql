-- ROLLBACK for 20261009180000_project_room_close_departed_members. Not a migration.
-- Backfilled memberships are not reopened (the people left the project); find them with
--   select * from public.permission_audit_events where event_type = 'project_room_member_departed';
drop trigger trg_project_staff_close_room_memberships on public.project_staff;
drop function app_private.close_project_room_memberships_on_staff_end();
drop function app_private.close_project_room_memberships_for_staff(uuid, text);
CREATE OR REPLACE FUNCTION public.apply_project_room_template(p_project_id text, p_construction_site_id text, p_project_staff_id uuid, p_template_code text, p_mode text DEFAULT 'merge'::text, p_dry_run boolean DEFAULT true, p_room_actions jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION app_private.replace_project_permission_room_members_room_cutover_legacy(p_project_id text, p_construction_site_id text, p_room_code text, p_members jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
