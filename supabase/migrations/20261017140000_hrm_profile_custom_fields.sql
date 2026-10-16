-- Hồ sơ nhân sự → "Thông tin thêm" (16/10/2026): the extra columns HR adds in Cấu hình of Bảng nhân sự,
-- shown on each person's profile page and on "Hồ sơ của tôi".
--   * HR sees every column in use; pay columns (group Lương or "chỉ HR Manage") only HR Manage.
--   * An employee sees the non-secret columns of their own profile. Direct managers and the directory do not.
--   * Read only: a value changes through an approved request in Bảng nhân sự, never from the profile.

create or replace function public.get_hrm_employee_custom_fields(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['SELF', 'HR', 'HR_MANAGE']);
  v_hr boolean := v_level in ('HR', 'HR_MANAGE');
  v_pay boolean := v_level = 'HR_MANAGE';
begin
  return jsonb_build_object(
    'employeeId', p_employee_id,
    'accessLevel', v_level,
    'can', jsonb_build_object(
      'edit', v_hr and app_private.has_hrm_template_permission(v_user, 'hrm.employee.edit_profile'),
      'configure', v_hr and app_private.hrm_roster_can_configure(v_user),
      'viewPay', v_pay),
    -- HR without pay rights learns that some columns exist but are not shown; employees are not told.
    'hiddenPayCount', case when v_hr and not v_pay then (select count(*) from public.hrm_roster_custom_fields field
      where field.is_active and (field.pay_only or field.group_key = 'pay')) else 0 end,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', field.id, 'key', field.key, 'label', field.label, 'group', field.group_key, 'type', field.field_type,
        'options', field.options, 'required', field.required, 'payOnly', field.pay_only or field.group_key = 'pay',
        'hint', field.hint, 'value', value.value,
        'updatedAt', case when v_hr then value.updated_at end,
        'pending', case when v_hr then pending.item end
      ) order by field.sort_order, field.label)
      from public.hrm_roster_custom_fields field
      left join public.hrm_employee_custom_values value on value.field_id = field.id and value.employee_id = p_employee_id
      left join lateral (
        select jsonb_build_object('batchId', batch.id, 'batchCode', batch.code, 'value', item.new_value) as item
        from public.hrm_roster_batch_items item join public.hrm_roster_batches batch on batch.id = item.batch_id
        where item.employee_id = p_employee_id and item.field = field.key and batch.status = 'pending'
        order by batch.created_at desc limit 1
      ) pending on true
      where field.is_active and (v_pay or not (field.pay_only or field.group_key = 'pay'))
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.get_hrm_employee_custom_fields(uuid) from public, anon;
grant execute on function public.get_hrm_employee_custom_fields(uuid) to authenticated;
