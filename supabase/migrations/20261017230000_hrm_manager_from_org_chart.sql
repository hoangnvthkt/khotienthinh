-- Quản lý trực tiếp một nguồn + sơ đồ hiện đủ ghế (17/10/2026). Chủ SP chốt:
--   * Ghế #213 tạo (nguồn roster_sync) bị ẩn vì Danh mục dùng chung chỉ coi ghế định biên (workforce_plan) là ghế chính thức:
--     đổi sang workforce_plan; từ nay ghế tự tạo cũng là ghế định biên. Ghế "Cố vấn" trống đang làm ghế trưởng
--     (VTTB, TKTL, CGCV, VPNM) bỏ khỏi ghế trưởng và lưu trữ — HR chọn trưởng mới.
--   * Danh mục theo Data 15/10: Cán bộ QS/QC và Trợ lý Phó TGĐ/Giám đốc chức năng → Level chuẩn E5; Level E4 thuộc nhóm Chuyên viên.
--   * Quản lý trực tiếp chỉ lấy từ sơ đồ tổ chức. Cài đặt → Người dùng chỉ xem. Ô quản lý cũ trên tài khoản (users.manager_id)
--     không đặt mới được nữa, chỉ còn làm dự phòng cho người ở đơn vị chưa có trưởng; khi đủ trưởng đơn vị thì tắt hẳn.

-- ── 1. Ghế chính thức ───────────────────────────────────────────────────────
update public.hrm_org_position_slots slot set source = 'workforce_plan', updated_at = now()
where slot.status = 'ACTIVE' and (slot.source in ('roster_sync', 'manual')
  or (slot.source = 'employee_backfill' and exists (select 1 from public.hrm_employee_slot_assignments occupant
    where occupant.slot_id = slot.id and occupant.status in ('ACTIVE', 'PLANNED'))));

-- Empty leftover seats still used as a unit's head seat: the unit has no head until HR picks one.
create temp table hrm_head_seat_drop on commit drop as
select unit.id as unit_id, slot.id as slot_id from public.org_units unit
join public.hrm_org_position_slots slot on slot.id = unit.manager_slot_id
where slot.source = 'employee_backfill'
  and not exists (select 1 from public.hrm_employee_slot_assignments occupant where occupant.slot_id = slot.id and occupant.status in ('ACTIVE', 'PLANNED'));
update public.org_units set manager_slot_id = null where id in (select unit_id from hrm_head_seat_drop);
update public.hrm_org_position_slots set reports_to_slot_id = null, updated_at = now()
where reports_to_slot_id in (select slot_id from hrm_head_seat_drop);
update public.hrm_org_position_slots set status = 'ARCHIVED', effective_to = greatest(effective_from, date '2026-09-30'),
  description = concat_ws(' · ', nullif(description, ''), 'Lưu trữ 17/10/2026: ghế trưởng tạm, không có người'), updated_at = now()
where id in (select slot_id from hrm_head_seat_drop);

-- ── 2. Xếp ghế: chỉ ghế định biên ───────────────────────────────────────────
create or replace function app_private.hrm_roster_sync_seat(p_employee_id uuid, p_effective date, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_emp public.employees%rowtype;
  v_unit public.org_units%rowtype;
  v_position public.hrm_positions%rowtype;
  v_current record;
  v_slot_id uuid;
  v_assignment_id uuid;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if p_effective is null or v_emp.id is null or v_emp.status <> 'Đang làm việc' or v_emp.org_unit_id is null or v_emp.position_id is null then
    return null;
  end if;
  select * into v_unit from public.org_units where id = v_emp.org_unit_id;
  select * into v_position from public.hrm_positions where id = v_emp.position_id and is_active;
  if v_unit.id is null or v_position.id is null then
    return null;
  end if;

  select assignment.id, assignment.effective_from, slot.id as slot_id, slot.org_unit_id, slot.position_id into v_current
  from public.hrm_employee_slot_assignments assignment
  join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
  where assignment.employee_id = p_employee_id and assignment.status = 'ACTIVE' and assignment.assignment_type = 'PRIMARY'
  limit 1;
  if v_current.id is not null and v_current.org_unit_id = v_emp.org_unit_id and v_current.position_id = v_emp.position_id then
    return v_current.slot_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_emp.org_unit_id::text || '|' || v_emp.position_id::text, 0));

  -- An empty official seat of the same unit and position.
  select slot.id into v_slot_id
  from public.hrm_org_position_slots slot
  where slot.org_unit_id = v_emp.org_unit_id and slot.position_id = v_emp.position_id and slot.status = 'ACTIVE'
    and slot.source = 'workforce_plan'
    and slot.effective_from <= p_effective and (slot.effective_to is null or slot.effective_to >= p_effective)
    and not exists (select 1 from public.hrm_employee_slot_assignments occupant
      where occupant.slot_id = slot.id and occupant.status in ('ACTIVE', 'PLANNED') and occupant.assignment_type in ('PRIMARY', 'ACTING'))
  order by slot.sort_order, slot.code
  limit 1;

  if v_slot_id is null then
    insert into public.hrm_org_position_slots (code, org_unit_id, position_id, level_code, slot_type, status, description,
      effective_from, source, created_by, updated_by)
    values ('RS-' || regexp_replace(coalesce(v_unit.code, 'DV'), '[^A-Za-z0-9]', '_', 'g') || '-'
        || regexp_replace(coalesce(v_position.code, 'VT'), '[^A-Za-z0-9]', '_', 'g') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      v_emp.org_unit_id, v_emp.position_id, v_position.level_code, 'STANDARD', 'ACTIVE', 'Ghế theo người thực tế (Bảng nhân sự)',
      p_effective, 'workforce_plan', public.current_app_user_id(), public.current_app_user_id())
    returning id into v_slot_id;
  end if;

  update public.hrm_employee_slot_assignments set status = 'ENDED',
    effective_to = greatest(effective_from, p_effective - 1),
    note = concat_ws(E'\n', nullif(note, ''), nullif(btrim(coalesce(p_reason, '')), '')),
    updated_by = public.current_app_user_id(), updated_at = now()
  where employee_id = p_employee_id and status = 'ACTIVE' and assignment_type = 'PRIMARY';

  insert into public.hrm_employee_slot_assignments (employee_id, slot_id, assignment_type, status, effective_from, note, source, created_by, updated_by)
  values (p_employee_id, v_slot_id, 'PRIMARY', 'ACTIVE', p_effective, nullif(btrim(coalesce(p_reason, '')), ''), 'roster_sync',
    public.current_app_user_id(), public.current_app_user_id())
  returning id into v_assignment_id;

  perform app_private.audit_hrm_profile_command(p_employee_id, 'HRM_WORKFORCE_ASSIGNMENT', v_assignment_id::text, 'INSERT',
    coalesce(p_reason, 'Xếp ghế theo Bảng nhân sự'), array['slot_id', 'org_unit_id', 'position_id']);
  return v_slot_id;
end;
$function$;
revoke all on function app_private.hrm_roster_sync_seat(uuid, date, text) from public, anon, authenticated;

-- ── 3. Danh mục theo Data 15/10 ─────────────────────────────────────────────
update public.hrm_org_position_slots slot set level_code = 'E5', updated_at = now()
from public.hrm_positions position
where position.id = slot.position_id and slot.status = 'ACTIVE' and slot.level_code is not distinct from position.level_code
  and position.name in ('Cán bộ QS/QC', 'Trợ lý Phó TGĐ/Giám đốc chức năng') and position.level_code <> 'E5';
update public.hrm_positions set level_code = 'E5', level = 5
where name in ('Cán bộ QS/QC', 'Trợ lý Phó TGĐ/Giám đốc chức năng') and source <> 'legacy' and level_code is distinct from 'E5';
update public.hrm_position_levels set group_code = 'CV' where code = 'E4' and group_code is distinct from 'CV';

-- ── 4. Quản lý trực tiếp: chỉ sơ đồ tổ chức ─────────────────────────────────
-- The old per-account manager can still be cleared, never set or changed.
create or replace function app_private.guard_user_manager_from_org_chart()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.manager_id is not null and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id) then
    raise exception using errcode = '42501', message = 'USER_MANAGER_FROM_ORG_CHART';
  end if;
  return new;
end;
$function$;
revoke all on function app_private.guard_user_manager_from_org_chart() from public, anon, authenticated;
drop trigger if exists trg_guard_user_manager_from_org_chart on public.users;
create trigger trg_guard_user_manager_from_org_chart before insert or update of manager_id on public.users
for each row execute function app_private.guard_user_manager_from_org_chart();

-- Who manages each account, for Cài đặt → Người dùng (names are visible to every signed-in user already).
create or replace function public.list_user_direct_managers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if public.current_app_user_id() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', row_data.id, 'managerUserId', coalesce(row_data.chart, row_data.legacy),
      'source', case when row_data.chart is not null then 'org_chart' when row_data.legacy is not null then 'legacy' else 'none' end))
    from (
      select account.id, app_private.resolve_slot_direct_manager(account.id) as chart,
        (select manager.id from public.users manager where manager.id = account.manager_id and manager.id <> account.id
           and coalesce(manager.is_active, true) and coalesce(manager.account_status, 'ACTIVE') = 'ACTIVE') as legacy
      from public.users account
      where coalesce(account.is_active, true)
    ) row_data
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_user_direct_managers() from public, anon;
grant execute on function public.list_user_direct_managers() to authenticated;

-- HR: units with people and no head yet.
create or replace function public.list_hrm_units_without_head()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'HRM_DIRECT_MANAGER_HR_ONLY';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('orgUnitId', unit.id, 'code', unit.code, 'name', unit.name, 'blockCode', unit.block_code,
      'people', unit.people, 'headSeatPosition', unit.head_position, 'headName', unit.head_name, 'hasHead', unit.head_name is not null,
      'legacyManaged', unit.legacy_managed)
      order by (unit.head_name is not null), unit.block_code nulls last, unit.order_index nulls last, unit.name)
    from (
      select org.id, org.code, org.name, org.block_code, org.order_index,
        (select count(*) from public.employees employee where employee.org_unit_id = org.id and employee.status = 'Đang làm việc') as people,
        (select position.name from public.hrm_org_position_slots slot join public.hrm_positions position on position.id = slot.position_id
          where slot.id = org.manager_slot_id) as head_position,
        (select employee.full_name from public.hrm_employee_slot_assignments assignment
          join public.employees employee on employee.id = assignment.employee_id
          where assignment.slot_id = org.manager_slot_id and assignment.status = 'ACTIVE'
            and assignment.assignment_type in ('PRIMARY', 'ACTING') and assignment.effective_from <= current_date
            and (assignment.effective_to is null or assignment.effective_to >= current_date) limit 1) as head_name,
        (select count(*) from public.employees employee join public.users account on account.id = employee.user_id
          where employee.org_unit_id = org.id and employee.status = 'Đang làm việc' and account.manager_id is not null
            and app_private.resolve_slot_direct_manager(account.id) is null) as legacy_managed
      from public.org_units org
      where coalesce(org.is_active, true) and org.type in ('department', 'factory', 'construction_site')
    ) unit
    where unit.people > 0
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_hrm_units_without_head() from public, anon;
grant execute on function public.list_hrm_units_without_head() to authenticated;
