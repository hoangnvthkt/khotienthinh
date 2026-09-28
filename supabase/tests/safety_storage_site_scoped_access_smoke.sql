-- Run inside a transaction after safety_storage_site_scoped_access.
do $$
declare
  v_user_id uuid;
  v_auth_id uuid;
  v_email text;
  v_project text;
  v_site text;
  v_legacy_path text;
  v_new_path text;
begin
  select u.id, u.auth_id, u.email, m.project_id, m.construction_site_id, attachment.value->>'storage_path'
    into v_user_id, v_auth_id, v_email, v_project, v_site, v_legacy_path
  from public.project_permission_room_members m
  join public.project_staff staff on staff.id = m.project_staff_id
  join public.users u on u.id::text = staff.user_id
  join public.safety_inspections inspection
    on inspection.project_id = m.project_id
    and inspection.construction_site_id = m.construction_site_id
  cross join lateral pg_catalog.jsonb_array_elements(inspection.attachments) attachment(value)
  where m.room_code = 'safety' and m.is_active
    and m.construction_site_id is not null
    and u.is_active and u.auth_id is not null
    and exists (select 1 from public.project_permission_room_member_actions a
      where a.room_member_id = m.id and a.action_code = 'view' and a.is_active)
    and exists (select 1 from public.project_permission_room_member_actions a
      where a.room_member_id = m.id and a.action_code = 'submit' and a.is_active)
    and attachment.value ? 'storage_path'
  limit 1;

  if v_user_id is null then
    raise exception 'No scoped Safety actor with an existing attachment';
  end if;

  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'sub', v_auth_id, 'email', v_email, 'role', 'authenticated'
  )::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);

  v_new_path := v_project || '/' || v_site || '/inspections/draft-test/photo.jpg';
  if not app_private.safety_storage_can_access(v_new_path, 'submit')
    or not app_private.safety_storage_can_access(v_new_path, 'view') then
    raise exception 'Scoped Safety actor cannot upload and view at assigned site';
  end if;
  if not app_private.safety_storage_can_access(v_legacy_path, 'view') then
    raise exception 'Scoped Safety actor cannot view a referenced legacy attachment';
  end if;
  if app_private.safety_storage_can_access(v_legacy_path, 'submit')
    or app_private.safety_storage_can_access(v_project || '/inspections/unreferenced/file.jpg', 'view')
    or app_private.safety_storage_can_access(v_project || '/00000000-0000-0000-0000-000000000000/inspections/draft-test/photo.jpg', 'submit')
    or app_private.safety_storage_can_access('wrong-project/' || v_site || '/inspections/draft-test/photo.jpg', 'submit') then
    raise exception 'Safety storage policy allowed an unscoped action';
  end if;
end $$;
