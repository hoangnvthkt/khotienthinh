begin;

do $$
declare
  v_active_assignment_count integer := 0;
  v_archived_count integer := 0;
begin
  select count(*)::integer
  into v_active_assignment_count
  from public.hrm_employee_slot_assignments assignment
  join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
  where slot.source = 'employee_backfill'
    and assignment.status in ('ACTIVE', 'PLANNED');

  if v_active_assignment_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'HRM_CUTOVER_ACTIVE_BACKFILL_ASSIGNMENTS',
      detail = format('%s active or planned backfill assignments remain', v_active_assignment_count);
  end if;

  update public.org_units unit
  set manager_slot_id = null
  from public.hrm_org_position_slots slot
  where unit.manager_slot_id = slot.id
    and slot.source = 'employee_backfill';

  update public.hrm_org_position_slots
  set status = 'ARCHIVED',
      effective_to = greatest(effective_from, current_date),
      updated_at = now(),
      description = concat_ws(E'\n', nullif(description, ''),
        'Lưu trữ khi chuyển sang cơ chế định biên chính thức')
  where source = 'employee_backfill'
    and status <> 'ARCHIVED';
  get diagnostics v_archived_count = row_count;

  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, module,
    description, record_label, entity_type, changed_fields, change_count,
    impact_level, context
  )
  select
    'hrm_org_position_slots',
    'workforce-planning-phase-one-cutover',
    'UPDATE',
    jsonb_build_object('source', 'employee_backfill', 'active_assignments', 0),
    jsonb_build_object('status', 'ARCHIVED', 'archived_count', v_archived_count),
    'HRM',
    'Chuyển sang cơ chế định biên nhân sự chính thức',
    'Khởi tạo định biên chính thức',
    'HRM_WORKFORCE_CUTOVER',
    array['manager_slot_id', 'status', 'effective_to'],
    v_archived_count,
    'high',
    jsonb_build_object('archived_count', v_archived_count, 'cutover_at', now())
  where not exists (
    select 1
    from public.audit_trail audit
    where audit.entity_type = 'HRM_WORKFORCE_CUTOVER'
      and audit.record_id = 'workforce-planning-phase-one-cutover'
  );
end;
$$;

commit;
