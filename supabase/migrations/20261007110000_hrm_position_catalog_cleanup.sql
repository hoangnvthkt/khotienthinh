-- HRM position catalog cleanup (owner approval 02/10/2026, docs/audits/hrm-attendance-leave-2026-10-02 §6.2):
--   1. Remove the legacy numeric positions nobody uses and the leaked smoke-test "G3 BOQ position".
--      Six numeric positions ("1", "5", "6", "10", "15" QLN, "18") still carry active compensation
--      assignments and project staff rows; they are already inactive and stay until HR re-maps those
--      people (their employee position is still the "Cố vấn" placeholder).
--   2. Merge same-name duplicates (office copy + site copy) into the lower code. People, slots,
--      project staff, room / permission template suggestions follow; the kept position's own salary
--      mapping and site-command flag win.
--   3. Site command titles without the project name: "Chỉ huy trưởng", "Chỉ huy phó" (the site
--      comes from the BCH unit / project).

do $cleanup$
declare
  v_pair record;
  v_drop uuid;
  v_keep uuid;
begin
  for v_pair in
    select * from (values
      ('VT080', 'VT068'), -- Cán bộ QS/QC
      ('VT078', 'VT067'), -- Cán bộ Shopdrawing
      ('VT086', 'VT043'), -- Nhân viên bảo vệ
      ('VT087', 'VT045'), -- Nhân viên cấp dưỡng
      ('VT085', 'VT059'), -- Nhân viên Thủ kho
      ('VT084', 'VT058'), -- Nhân viên Vật tư
      ('VT016', 'VT015'), -- Chỉ huy trưởng BCH SMB → Chỉ huy trưởng
      ('VT025', 'VT024')  -- Chỉ huy phó BCH SMB → Chỉ huy phó
    ) as pair(drop_code, keep_code)
  loop
    select id into v_drop from public.hrm_positions where code = v_pair.drop_code;
    select id into v_keep from public.hrm_positions where code = v_pair.keep_code;
    continue when v_drop is null or v_keep is null;

    update public.employees set position_id = v_keep where position_id = v_drop;
    update public.hrm_employee_compensation_assignments set position_id = v_keep where position_id = v_drop;
    update public.hrm_employee_employment_events set position_id = v_keep where position_id = v_drop;
    update public.hrm_org_position_slots set position_id = v_keep where position_id = v_drop;
    update public.project_staff set position_id = v_keep where position_id = v_drop;

    update public.hrm_position_salary_mappings mapping set position_id = v_keep
    where mapping.position_id = v_drop
      and not exists (select 1 from public.hrm_position_salary_mappings kept
                      where kept.plan_id = mapping.plan_id and kept.position_id = v_keep);
    insert into public.notification_site_command_positions (position_id)
    select v_keep where exists (select 1 from public.notification_site_command_positions where position_id = v_drop)
    on conflict do nothing;

    update public.project_room_templates set suggested_position_ids = array(
      select position_id from unnest(array_replace(suggested_position_ids, v_drop, v_keep)) with ordinality item(position_id, ord)
      group by position_id order by min(ord))
    where v_drop = any(suggested_position_ids);
    update public.user_permission_templates set suggested_position_ids = array(
      select position_id from unnest(array_replace(suggested_position_ids, v_drop, v_keep)) with ordinality item(position_id, ord)
      group by position_id order by min(ord))
    where v_drop = any(suggested_position_ids);

    -- Leftover salary mapping / site-command rows of the merged copy cascade away.
    delete from public.hrm_positions where id = v_drop;
  end loop;
end;
$cleanup$;

update public.hrm_positions set name = 'Chỉ huy trưởng' where code = 'VT015';
update public.hrm_positions set name = 'Chỉ huy phó' where code = 'VT024';
update public.hrm_position_salary_mappings mapping
set metadata = jsonb_set(coalesce(mapping.metadata, '{}'::jsonb), '{position_name}', to_jsonb(position.name))
from public.hrm_positions position
where position.id = mapping.position_id and position.code in ('VT015', 'VT024');

-- Leaked smoke-test data: the fake "G3 Viewer" staff row is the only use of the test position.
delete from public.project_staff
where position_id in (select id from public.hrm_positions where code = 'G3-BOQ' and source = 'smoke');
delete from public.hrm_positions where code = 'G3-BOQ' and source = 'smoke';

delete from public.hrm_positions position
where position.source = 'legacy' and position.name ~ '^[0-9]+$'
  and not exists (select 1 from public.employees where position_id = position.id)
  and not exists (select 1 from public.hrm_employee_compensation_assignments where position_id = position.id)
  and not exists (select 1 from public.hrm_employee_employment_events where position_id = position.id)
  and not exists (select 1 from public.hrm_org_position_slots where position_id = position.id)
  and not exists (select 1 from public.project_staff where position_id = position.id)
  and not exists (select 1 from public.project_room_templates where position.id = any(suggested_position_ids))
  and not exists (select 1 from public.user_permission_templates where position.id = any(suggested_position_ids));
