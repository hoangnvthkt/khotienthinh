-- Phân quyền Đợt 2c (23/10/2026): luật kiêm nhiệm.
--
-- 1. Ba luật cặp quyền (cảnh báo, cần Admin ghi nhận ngoại lệ khi cấp mới):
--    Quản trị Mua hàng + Duyệt PO; Quản trị Mua hàng + Thủ kho; Xác nhận chi + Quản trị Tài chính.
-- 2. Người đang kiêm nhiệm sẵn không bị cảnh báo lại mỗi lần Admin sửa quyền khác của họ
--    (trước đây lưu lại toàn bộ quyền riêng bị coi như cấp mới).
-- 3. Người kiểm soát ngoại lệ chỉ cần đang làm việc, khác người cấp và người được cấp
--    (trước đây bắt buộc có quyền Kiểm toán phân quyền — chỉ Admin Hoàng có, nên không ghi nhận được).
-- 4. Màn Người dùng và Gắn mẫu: xem trước cảnh báo, gửi kèm ghi nhận ngoại lệ.
-- 5. Danh sách người đang kiêm nhiệm cho Admin.
-- 6. Chặn cứng: người xác nhận đã chi / xác nhận phiếu quỹ không tự đảo phiếu đó.

-- ---------------------------------------------------------------------------------------------
-- 1. Luật
-- ---------------------------------------------------------------------------------------------
insert into public.authorization_sod_rules (
  rule_code, name, description, rule_type, effect, left_permission_code, right_permission_code,
  operation_code, subject_type, overridable, is_active, metadata
) values
  ('PROCUREMENT_BUY_APPROVE_PO', 'Mua hàng + Duyệt PO',
   'Người mua hàng cũng duyệt đơn mua. Hệ thống vẫn chặn duyệt đơn do chính mình lập.',
   'PERMISSION_PAIR', 'WARN', 'system.procurement.manage', 'system.procurement.approve', null, null, false, true,
   jsonb_build_object('controls', jsonb_build_array(
     'Không duyệt đơn do chính mình lập (hệ thống đã chặn)',
     'Ban lãnh đạo xem lại đơn mua lớn hằng tuần',
     'Kế toán đối chiếu giá mua với báo giá NCC hằng tháng'))),
  ('PROCUREMENT_BUY_WAREHOUSE_KEEPER', 'Mua hàng + Thủ kho',
   'Người mua hàng cũng là thủ kho, tự nhận hàng mình mua.',
   'PERMISSION_PAIR', 'WARN', 'system.procurement.manage', 'wms.transaction.keeper', null, null, false, true,
   jsonb_build_object('controls', jsonb_build_array(
     'Kế toán đối chiếu phiếu nhập kho với đơn mua hằng tháng',
     'Kiểm kê kho định kỳ có người thứ hai',
     'Chỉ huy trưởng xác nhận số lượng nhận tại công trường'))),
  ('FINANCE_CONFIRM_MANAGE', 'Xác nhận chi + Quản trị Tài chính',
   'Người quản trị tài chính cũng xác nhận chi tiền.',
   'PERMISSION_PAIR', 'WARN', 'system.finance.confirm', 'system.finance.manage', null, null, false, true,
   jsonb_build_object('controls', jsonb_build_array(
     'Không tự đảo phiếu chi đã xác nhận (hệ thống đã chặn)',
     'Đối chiếu sao kê ngân hàng hằng tháng',
     'Người thứ hai xem lại khoản chi lớn'))),
  ('FINANCE_CONFIRMER_SELF_REVERSE', 'Người xác nhận không tự đảo phiếu',
   'Người xác nhận đã chi (hoặc xác nhận phiếu quỹ) không được tự đảo chính phiếu đó; người có quyền xác nhận khác đảo.',
   'SUBJECT_RELATION', 'DENY', null, null, 'reverse', 'finance_voucher', false, true, '{}'::jsonb)
on conflict (rule_code) do update set
  name = excluded.name, description = excluded.description, rule_type = excluded.rule_type, effect = excluded.effect,
  left_permission_code = excluded.left_permission_code, right_permission_code = excluded.right_permission_code,
  operation_code = excluded.operation_code, subject_type = excluded.subject_type, overridable = excluded.overridable,
  is_active = excluded.is_active, metadata = excluded.metadata, updated_at = now();

-- ---------------------------------------------------------------------------------------------
-- 2. Đánh giá thay đổi quyền: cặp quyền người đó đang có sẵn (kể cả quyền riêng) không phải kiêm nhiệm mới.
--    Thân hàm như trên Cloud 23/10/2026, chỉ thêm held_codes và dùng nó ở điều kiện "đã có cả hai".
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.evaluate_authorization_change(p_actor_user_id uuid, p_target_user_id uuid, p_proposed_permission_codes text[], p_scope_type text, p_scope_id text, p_change_mode text DEFAULT 'ADD'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_any_permission(
      public.current_app_user_id(),
      array['system.authorization.manage_roles','system.authorization.manage_grants'],
      'global', '*'
    )
  then
    raise exception 'Active authorization actor required' using errcode = '42501';
  end if;

  if p_change_mode not in ('ADD', 'REPLACE_DIRECT') then
    raise exception 'Unknown authorization change mode' using errcode = '22023';
  end if;

  return (
  with proposed as (
    select distinct code as permission_code
    from unnest(coalesce(p_proposed_permission_codes, '{}'::text[])) code
  ),
  current_codes as (
    select distinct source_row.permission_code
    from app_private.resolve_effective_permission_sources(
      p_target_user_id, null, p_scope_type, p_scope_id, now()
    ) source_row
    where p_change_mode <> 'REPLACE_DIRECT'
       or source_row.source_type <> 'DIRECT'
  ),
  -- Đợt 2c: mọi quyền đang có hiệu lực, kể cả quyền riêng sẽ được thay.
  held_codes as (
    select distinct source_row.permission_code
    from app_private.resolve_effective_permission_sources(
      p_target_user_id, null, p_scope_type, p_scope_id, now()
    ) source_row
  ),
  resulting_codes as (
    select permission_code from current_codes
    union
    select permission_code from proposed
  ),
  self_grant_denies as (
    select jsonb_build_object(
      'ruleCode', rule_row.rule_code,
      'effect', rule_row.effect,
      'message', rule_row.description,
      'permissionCodes', jsonb_agg(action_row.permission_code order by action_row.permission_code),
      'scopeType', p_scope_type,
      'scopeId', p_scope_id
    ) finding
    from public.authorization_sod_rules rule_row
    join proposed proposed_row on true
    join public.permission_actions action_row
      on action_row.permission_code = proposed_row.permission_code
     and action_row.risk_level = 'sensitive'
    where rule_row.rule_code = 'AUTHZ_SENSITIVE_SELF_GRANT'
      and rule_row.is_active
      and p_actor_user_id = p_target_user_id
      and p_change_mode = 'ADD'
    group by rule_row.rule_code, rule_row.effect, rule_row.description
  ),
  pair_findings as (
    select
      rule_row.effect,
      jsonb_build_object(
        'ruleCode', rule_row.rule_code,
        'effect', rule_row.effect,
        'message', rule_row.description,
        'permissionCodes', jsonb_build_array(rule_row.left_permission_code, rule_row.right_permission_code),
        'scopeType', p_scope_type,
        'scopeId', p_scope_id
      ) finding
    from public.authorization_sod_rules rule_row
    where rule_row.is_active
      and rule_row.rule_type = 'PERMISSION_PAIR'
      and exists (select 1 from resulting_codes c where c.permission_code = rule_row.left_permission_code)
      and exists (select 1 from resulting_codes c where c.permission_code = rule_row.right_permission_code)
      and (
        exists (select 1 from proposed c where c.permission_code = rule_row.left_permission_code)
        or exists (select 1 from proposed c where c.permission_code = rule_row.right_permission_code)
      )
      and not (
        exists (select 1 from held_codes c where c.permission_code = rule_row.left_permission_code)
        and exists (select 1 from held_codes c where c.permission_code = rule_row.right_permission_code)
      )
  ),
  all_findings as (
    select 'DENY'::text as effect, finding from self_grant_denies
    union all
    select effect, finding from pair_findings
  )
  select jsonb_build_object(
    'hardDenies', coalesce(jsonb_agg(finding order by finding->>'ruleCode') filter (where effect = 'DENY'), '[]'::jsonb),
    'warnings', coalesce(jsonb_agg(finding order by finding->>'ruleCode') filter (where effect = 'WARN'), '[]'::jsonb)
  )
  from all_findings
  );
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. Ghi nhận ngoại lệ: người kiểm soát chỉ cần đang làm việc, khác người cấp và người được cấp.
--    Thân hàm như trên Cloud 23/10/2026, chỉ bỏ điều kiện người kiểm soát có system.authorization.audit.
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.assert_and_record_sod_warnings(p_decision jsonb, p_acceptances jsonb, p_command_type text, p_command_id uuid, p_actor_user_id uuid, p_target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hard_denies jsonb := coalesce(p_decision -> 'hardDenies', '[]'::jsonb);
  v_warnings jsonb := coalesce(p_decision -> 'warnings', '[]'::jsonb);
  v_acceptances jsonb := coalesce(p_acceptances, '[]'::jsonb);
  v_warning jsonb;
  v_acceptance jsonb;
  v_owner_id uuid;
  v_expires_at timestamptz;
begin
  if p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_any_permission(
      public.current_app_user_id(),
      array[
        'system.authorization.manage_roles',
        'system.authorization.manage_grants'
      ],
      'global',
      '*'
    )
  then
    raise exception 'Authorization administration permission required'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_hard_denies) <> 'array'
    or jsonb_typeof(v_warnings) <> 'array'
    or jsonb_typeof(v_acceptances) <> 'array'
  then
    raise exception 'Invalid SoD decision or warning acceptances'
      using errcode = '22023';
  end if;

  if jsonb_array_length(v_hard_denies) > 0 then
    raise exception 'Authorization change violates a hard SoD rule'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_acceptances) supplied
    group by
      supplied.value ->> 'ruleCode',
      supplied.value ->> 'scopeType',
      supplied.value ->> 'scopeId'
    having count(*) > 1
  ) then
    raise exception 'Duplicate SoD warning acknowledgement'
      using errcode = '22023';
  end if;

  for v_warning in
    select value
    from jsonb_array_elements(v_warnings)
  loop
    select value
    into v_acceptance
    from jsonb_array_elements(v_acceptances)
    where value ->> 'ruleCode' = v_warning ->> 'ruleCode'
      and value ->> 'scopeType' = v_warning ->> 'scopeType'
      and value ->> 'scopeId' = v_warning ->> 'scopeId'
    limit 1;

    if v_acceptance is null then
      raise exception 'SoD warning acknowledgement required'
        using errcode = '22023';
    end if;

    begin
      v_owner_id := nullif(v_acceptance ->> 'controlOwnerUserId', '')::uuid;
      v_expires_at := nullif(v_acceptance ->> 'expiresAt', '')::timestamptz;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'Invalid SoD warning control evidence'
          using errcode = '22023';
    end;

    if char_length(btrim(coalesce(v_acceptance ->> 'reason', ''))) < 10
      or char_length(btrim(coalesce(v_acceptance ->> 'compensatingControls', ''))) < 10
      or v_expires_at is null
      or v_expires_at <= now()
      or v_owner_id is null
      or v_owner_id = p_actor_user_id
      or v_owner_id = p_target_user_id
      or not exists (
        select 1
        from public.users owner_row
        where owner_row.id = v_owner_id
          and owner_row.is_active
          and owner_row.account_status = 'ACTIVE'
      )
    then
      raise exception 'Invalid SoD warning control evidence'
        using errcode = '22023';
    end if;

    insert into public.authorization_sod_warning_acceptances (
      rule_code,
      command_type,
      command_id,
      actor_user_id,
      target_user_id,
      scope_type,
      scope_id,
      reason,
      control_owner_user_id,
      compensating_controls,
      expires_at
    )
    values (
      v_warning ->> 'ruleCode',
      p_command_type,
      p_command_id,
      p_actor_user_id,
      p_target_user_id,
      v_warning ->> 'scopeType',
      v_warning ->> 'scopeId',
      btrim(v_acceptance ->> 'reason'),
      v_owner_id,
      btrim(v_acceptance ->> 'compensatingControls'),
      v_expires_at
    );
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(v_acceptances) supplied
    where not exists (
      select 1
      from jsonb_array_elements(v_warnings) expected
      where expected ->> 'ruleCode' = supplied.value ->> 'ruleCode'
        and expected ->> 'scopeType' = supplied.value ->> 'scopeType'
        and expected ->> 'scopeId' = supplied.value ->> 'scopeId'
    )
  ) then
    raise exception 'Unexpected SoD warning acknowledgement'
      using errcode = '22023';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 4. Diễn giải cảnh báo cho màn hình: tên luật, quyền, phạm vi, gợi ý kiểm soát bù, người kiểm soát gợi ý.
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.describe_sod_decision(p_decision jsonb, p_target_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'warnings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'ruleCode', w ->> 'ruleCode', 'name', rule_row.name, 'description', rule_row.description,
          'scopeType', w ->> 'scopeType', 'scopeId', w ->> 'scopeId',
          'scopeLabel', case when w ->> 'scopeType' = 'warehouse'
            then coalesce((select wh.name from public.warehouses wh where wh.id = w ->> 'scopeId'), w ->> 'scopeId') end,
          'permissions', (select coalesce(jsonb_agg(jsonb_build_object('code', a.permission_code, 'label', a.label,
              'moduleLabel', m.name) order by a.permission_code), '[]'::jsonb)
            from public.permission_actions a left join public.permission_modules m on m.code = a.module_code
            where a.permission_code in (rule_row.left_permission_code, rule_row.right_permission_code)),
          'controls', coalesce(rule_row.metadata -> 'controls', '[]'::jsonb))
        order by w ->> 'ruleCode', w ->> 'scopeType', w ->> 'scopeId')
      from jsonb_array_elements(coalesce(p_decision -> 'warnings', '[]'::jsonb)) w
      join public.authorization_sod_rules rule_row on rule_row.rule_code = w ->> 'ruleCode'), '[]'::jsonb),
    'hardDenies', coalesce(p_decision -> 'hardDenies', '[]'::jsonb),
    'defaultControlOwnerId', (
      select manager.id from public.users target
      join public.users manager on manager.id = target.manager_id
      where target.id = p_target_user_id and manager.is_active and manager.account_status = 'ACTIVE'
        and manager.id is distinct from public.current_app_user_id()));
$$;

revoke all on function app_private.describe_sod_decision(jsonb, uuid) from public, anon, authenticated;

-- Màn Người dùng: cảnh báo kiêm nhiệm nếu lưu bộ quyền riêng này (cùng dạng payload với update_user_authorization_v2).
create or replace function public.preview_user_authorization_sod_v1(p_user_id uuid, p_grants jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_authorization_permission('system.authorization.manage_grants');
begin
  return app_private.describe_sod_decision(
    app_private.evaluate_direct_grant_replacement_impl(v_actor, p_user_id, coalesce(p_grants, '[]'::jsonb)),
    p_user_id);
end;
$$;

revoke all on function public.preview_user_authorization_sod_v1(uuid, jsonb) from public, anon;
grant execute on function public.preview_user_authorization_sod_v1(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Lưu quyền từng người kèm ghi nhận ngoại lệ.
--    Thân hàm như 20261029130000 (đang chạy trên Cloud), chỉ thêm tham số p_warning_acceptances.
-- ---------------------------------------------------------------------------------------------
drop function if exists public.update_user_authorization_v2(uuid, jsonb, jsonb, text, timestamp with time zone);
drop function if exists app_private.update_user_authorization_v2_impl(uuid, jsonb, jsonb, text, timestamp with time zone);

create function app_private.update_user_authorization_v2_impl(p_user_id uuid, p_profile jsonb, p_grants jsonb, p_reason text, p_expected_updated_at timestamp with time zone, p_warning_acceptances jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_user_id uuid;
  v_target public.users%rowtype;
  v_profile jsonb := coalesce(p_profile, '{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_unsupported_fields text[];
  v_profile_before jsonb;
  v_profile_after jsonb;
  v_grants_before jsonb := '[]'::jsonb;
  v_grants_after jsonb := '[]'::jsonb;
  v_updated_at timestamp with time zone;
  v_active_grant_count integer;
  v_audit_event_id uuid;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  if p_user_id is null then
    raise exception 'Target user required'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_profile) <> 'object' then
    raise exception 'User profile payload must be an object'
      using errcode = '22023';
  end if;

  select array_agg(profile_key order by profile_key)
  into v_unsupported_fields
  from jsonb_object_keys(v_profile) profile_key
  where profile_key <> all (array[
    'name',
    'phone',
    'avatar',
    'manager_id',
    'assigned_warehouse_id'
  ]::text[]);

  if coalesce(cardinality(v_unsupported_fields), 0) > 0 then
    raise exception 'Unsupported user profile fields: %', array_to_string(v_unsupported_fields, ', ')
      using errcode = '22023';
  end if;

  if v_reason = '' then
    raise exception 'Authorization change reason required'
      using errcode = '22023';
  end if;

  if p_expected_updated_at is null then
    raise exception 'Expected user updated_at required'
      using errcode = '22023';
  end if;

  select *
  into v_target
  from public.users
  where id = p_user_id
  for update;

  if v_target.id is null
    or not v_target.is_active
    or v_target.account_status <> 'ACTIVE'
  then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  if v_target.updated_at is distinct from p_expected_updated_at then
    raise exception 'User authorization changed after it was loaded'
      using errcode = 'PT409';
  end if;

  if v_profile ? 'name' and btrim(coalesce(v_profile ->> 'name', '')) = '' then
    raise exception 'User name cannot be blank'
      using errcode = '22023';
  end if;

  v_profile_before := jsonb_build_object(
    'name', v_target.name,
    'phone', v_target.phone,
    'avatar', v_target.avatar,
    'manager_id', v_target.manager_id,
    'assigned_warehouse_id', v_target.assigned_warehouse_id
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', grant_row.permission_code,
        'scopeType', grant_row.scope_type,
        'scopeId', grant_row.scope_id,
        'expiresAt', grant_row.expires_at
      ) order by grant_row.permission_code, grant_row.scope_type, grant_row.scope_id
    ),
    '[]'::jsonb
  )
  into v_grants_before
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active;

  update public.users
  set name = case when v_profile ? 'name' then v_profile ->> 'name' else name end,
      phone = case when v_profile ? 'phone' then v_profile ->> 'phone' else phone end,
      avatar = case when v_profile ? 'avatar' then v_profile ->> 'avatar' else avatar end,
      manager_id = case
        when v_profile ? 'manager_id' then nullif(v_profile ->> 'manager_id', '')::uuid
        else manager_id
      end,
      assigned_warehouse_id = case
        when v_profile ? 'assigned_warehouse_id' then v_profile ->> 'assigned_warehouse_id'
        else assigned_warehouse_id
      end,
      updated_at = now()
  where id = p_user_id
  returning updated_at into v_updated_at;

  v_grants_after := app_private.replace_user_permission_grants_v2_impl(
    p_user_id,
    p_grants,
    v_reason,
    coalesce(p_warning_acceptances, '[]'::jsonb)
  );

  -- Đợt 2b: người đang theo mẫu quyền — ghi nhận quyền Admin bỏ riêng / thêm lại để mẫu không cấp lại khi đồng bộ.
  perform app_private.adopt_user_template_state(p_user_id);

  select jsonb_build_object(
    'name', target.name,
    'phone', target.phone,
    'avatar', target.avatar,
    'manager_id', target.manager_id,
    'assigned_warehouse_id', target.assigned_warehouse_id
  ), target.updated_at
  into v_profile_after, v_updated_at
  from public.users target
  where target.id = p_user_id;

  select count(*)::integer
  into v_active_grant_count
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  ) values (
    v_actor_user_id,
    p_user_id,
    'user_authorization_v2_updated',
    jsonb_build_object('profile', v_profile_before, 'grants', v_grants_before),
    jsonb_build_object('profile', v_profile_after, 'grants', v_grants_after),
    jsonb_build_object('reason', v_reason)
  )
  returning id into v_audit_event_id;

  return jsonb_build_object(
    'userId', p_user_id,
    'updatedAt', v_updated_at,
    'activeGrantCount', v_active_grant_count,
    'auditEventId', v_audit_event_id
  );
end;
$function$;

create function public.update_user_authorization_v2(p_user_id uuid, p_profile jsonb, p_grants jsonb, p_reason text, p_expected_updated_at timestamp with time zone, p_warning_acceptances jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Authorization change reason must contain at least 10 characters'
      using errcode = '23514',
        detail = jsonb_build_object(
          'code', 'reason_too_short',
          'field', 'reason',
          'message', 'Lý do thay đổi phải có ít nhất 10 ký tự.'
        )::text;
  end if;

  return app_private.update_user_authorization_v2_impl(
    p_user_id,
    p_profile,
    p_grants,
    p_reason,
    p_expected_updated_at,
    p_warning_acceptances
  );
end;
$function$;

revoke all on function app_private.update_user_authorization_v2_impl(uuid, jsonb, jsonb, text, timestamp with time zone, jsonb) from public, anon;
grant execute on function app_private.update_user_authorization_v2_impl(uuid, jsonb, jsonb, text, timestamp with time zone, jsonb) to authenticated;
revoke all on function public.update_user_authorization_v2(uuid, jsonb, jsonb, text, timestamp with time zone, jsonb) from public, anon;
grant execute on function public.update_user_authorization_v2(uuid, jsonb, jsonb, text, timestamp with time zone, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Gắn mẫu kèm ghi nhận ngoại lệ; xem trước gắn mẫu báo luôn cảnh báo kiêm nhiệm.
--    Sửa mẫu (đồng bộ hàng loạt) vẫn không ghi nhận thay: người chạm luật được bỏ qua và báo lại.
-- ---------------------------------------------------------------------------------------------
-- Bộ quyền riêng một người sẽ có sau khi thêm / gỡ quyền mẫu (dùng chung cho xem trước và lưu).
create or replace function app_private.template_next_grants(p_user_id uuid, p_add jsonb, p_remove_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_json), '[]'::jsonb)
  from (
    -- quyền đang có, trừ quyền mẫu gỡ
    select jsonb_build_object('permission_code', g.permission_code, 'scope_type', g.scope_type,
      'scope_id', g.scope_id, 'expires_at', g.expires_at, 'is_active', true) as row_json
    from public.user_permission_grants g
    where g.user_id = p_user_id and g.is_active
      and not (g.scope_id = '*' and g.permission_code || '@' || g.scope_type = any(coalesce(p_remove_keys, '{}')))
      and not exists (
        select 1 from jsonb_to_recordset(coalesce(p_add, '[]'::jsonb)) a("permissionCode" text, "scopeType" text)
        where a."permissionCode" = g.permission_code and a."scopeType" = g.scope_type and g.scope_id = '*'
          and g.expires_at is not null and g.expires_at <= now()
      )
    union all
    -- quyền mẫu thêm (quyền bắt buộc hạn: hạn theo mẫu, mặc định 365 ngày)
    select jsonb_build_object('permission_code', a."permissionCode", 'scope_type', a."scopeType", 'scope_id', '*',
      'expires_at', case
        when action_row.direct_grant_requires_expiry
          and not (a."scopeType" = 'own' and action_row.risk_level <> 'sensitive')
        then now() + make_interval(days => coalesce(a."expiresInDays", 365))
      end,
      'is_active', true)
    from jsonb_to_recordset(coalesce(p_add, '[]'::jsonb)) a("permissionCode" text, "scopeType" text, "expiresInDays" integer)
    join public.permission_actions action_row on action_row.permission_code = a."permissionCode"
    where not exists (
      select 1 from public.user_permission_grants g
      where g.user_id = p_user_id and g.is_active and g.permission_code = a."permissionCode"
        and g.scope_type = a."scopeType" and g.scope_id = '*'
        and (g.expires_at is null or g.expires_at > now())
    )
  ) rows_union;
$$;

drop function if exists app_private.apply_template_grant_changes(uuid, jsonb, text[], text);
create function app_private.apply_template_grant_changes(
  p_user_id uuid, p_add jsonb, p_remove_keys text[], p_reason text, p_warning_acceptances jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added integer;
  v_removed integer;
begin
  select count(*) into v_removed
  from public.user_permission_grants g
  where g.user_id = p_user_id and g.is_active and g.scope_id = '*'
    and g.permission_code || '@' || g.scope_type = any(coalesce(p_remove_keys, '{}'));

  select count(*) into v_added
  from jsonb_to_recordset(coalesce(p_add, '[]'::jsonb)) a("permissionCode" text, "scopeType" text)
  where not exists (
    select 1 from public.user_permission_grants g
    where g.user_id = p_user_id and g.is_active and g.permission_code = a."permissionCode"
      and g.scope_type = a."scopeType" and g.scope_id = '*'
      and (g.expires_at is null or g.expires_at > now())
  );

  if v_added = 0 and v_removed = 0 then
    return jsonb_build_object('added', 0, 'removed', 0);
  end if;

  perform app_private.replace_user_permission_grants_v2_impl(
    p_user_id, app_private.template_next_grants(p_user_id, p_add, p_remove_keys), p_reason,
    coalesce(p_warning_acceptances, '[]'::jsonb));
  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$$;

drop function if exists app_private.sync_user_template_assignment(uuid, text);
create function app_private.sync_user_template_assignment(p_user_id uuid, p_reason text, p_warning_acceptances jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.user_template_assignments%rowtype;
  v_template public.user_permission_templates%rowtype;
  v_desired jsonb;
  v_remove text[];
  v_result jsonb;
begin
  select * into v_assignment from public.user_template_assignments where user_id = p_user_id for update;
  if v_assignment.user_id is null then return null; end if;
  select * into v_template from public.user_permission_templates where code = v_assignment.template_code;

  v_desired := app_private.permission_template_desired_items(
    v_template.items, v_template.options, v_assignment.options, v_assignment.excluded);
  select coalesce(array_agg(k), '{}') into v_remove
  from unnest(app_private.permission_item_keys(v_assignment.applied)) k
  where k <> all(app_private.permission_item_keys(v_desired));

  v_result := app_private.apply_template_grant_changes(p_user_id, v_desired, v_remove, p_reason, p_warning_acceptances);

  update public.user_template_assignments
  set applied = (select coalesce(jsonb_agg(jsonb_build_object('permissionCode', d ->> 'permissionCode', 'scopeType', d ->> 'scopeType')), '[]'::jsonb)
                 from jsonb_array_elements(v_desired) d),
      updated_by = public.current_app_user_id(), updated_at = now()
  where user_id = p_user_id;
  return v_result;
end;
$$;

revoke all on function app_private.template_next_grants(uuid, jsonb, text[]) from public, anon, authenticated;
revoke all on function app_private.apply_template_grant_changes(uuid, jsonb, text[], text, jsonb) from public, anon, authenticated;
revoke all on function app_private.sync_user_template_assignment(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.preview_user_template_assignment_v1(p_user_id uuid, p_template_code text, p_options text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_template public.user_permission_templates%rowtype;
  v_assignment public.user_template_assignments%rowtype;
  v_desired jsonb;
  v_excluded jsonb := '[]'::jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_remove text[];
  v_sod jsonb := jsonb_build_object('warnings', '[]'::jsonb, 'hardDenies', '[]'::jsonb);
begin
  if not app_private.can_manage_permissions() then
    raise exception 'Authorization administration permission required' using errcode = '42501';
  end if;
  select * into v_template from public.user_permission_templates where code = p_template_code and is_active;
  if v_template.code is null then raise exception 'PERMISSION_TEMPLATE_NOT_FOUND' using errcode = '22023'; end if;
  select * into v_assignment from public.user_template_assignments where user_id = p_user_id;
  if v_assignment.user_id is not null then
    v_applied := v_assignment.applied;
    if v_assignment.template_code = p_template_code then v_excluded := v_assignment.excluded; end if;
  end if;
  v_desired := app_private.permission_template_desired_items(v_template.items, v_template.options, p_options, v_excluded);

  -- Đợt 2c: cảnh báo kiêm nhiệm của đúng bộ quyền sẽ lưu.
  select coalesce(array_agg(k), '{}') into v_remove
  from unnest(app_private.permission_item_keys(v_applied)) k
  where k <> all(app_private.permission_item_keys(v_desired));
  v_sod := app_private.describe_sod_decision(
    app_private.evaluate_direct_grant_replacement_impl(public.current_app_user_id(), p_user_id,
      app_private.template_next_grants(p_user_id, v_desired, v_remove)),
    p_user_id);

  return jsonb_build_object(
    'add', coalesce((select jsonb_agg(jsonb_build_object('permissionCode', d ->> 'permissionCode', 'scopeType', d ->> 'scopeType',
        'label', action_row.label, 'moduleCode', action_row.module_code, 'moduleLabel', module_row.name)
        order by action_row.module_code, action_row.sort_order)
      from jsonb_array_elements(v_desired) d
      join public.permission_actions action_row on action_row.permission_code = d ->> 'permissionCode'
      left join public.permission_modules module_row on module_row.code = action_row.module_code
      where not exists (select 1 from public.user_permission_grants g
        where g.user_id = p_user_id and g.is_active and g.permission_code = d ->> 'permissionCode'
          and g.scope_type = d ->> 'scopeType' and g.scope_id = '*' and (g.expires_at is null or g.expires_at > now()))), '[]'::jsonb),
    'remove', coalesce((select jsonb_agg(jsonb_build_object('permissionCode', a ->> 'permissionCode', 'scopeType', a ->> 'scopeType',
        'label', action_row.label, 'moduleCode', action_row.module_code, 'moduleLabel', module_row.name)
        order by action_row.module_code, action_row.sort_order)
      from jsonb_array_elements(v_applied) a
      join public.permission_actions action_row on action_row.permission_code = a ->> 'permissionCode'
      left join public.permission_modules module_row on module_row.code = action_row.module_code
      where (a ->> 'permissionCode') || '@' || coalesce(a ->> 'scopeType', 'global') <> all(app_private.permission_item_keys(v_desired))
        and exists (select 1 from public.user_permission_grants g
          where g.user_id = p_user_id and g.is_active and g.permission_code = a ->> 'permissionCode'
            and g.scope_type = coalesce(a ->> 'scopeType', 'global') and g.scope_id = '*')), '[]'::jsonb),
    'excludedCount', jsonb_array_length(v_excluded),
    'sod', v_sod);
end;
$$;

drop function if exists public.save_user_template_assignment_v1(uuid, text, text[], text);
create function public.save_user_template_assignment_v1(
  p_user_id uuid, p_template_code text, p_options text[], p_reason text, p_warning_acceptances jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_authorization_permission('system.authorization.manage_grants');
  v_template public.user_permission_templates%rowtype;
  v_previous public.user_template_assignments%rowtype;
  v_options text[];
  v_reason text := btrim(coalesce(p_reason, ''));
  v_result jsonb;
begin
  if char_length(v_reason) < 10 then
    raise exception 'Direct permission grant change reason required' using errcode = '22023';
  end if;
  select * into v_template from public.user_permission_templates where code = p_template_code and is_active;
  if v_template.code is null then raise exception 'PERMISSION_TEMPLATE_NOT_FOUND' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct o), '{}') into v_options
  from unnest(coalesce(p_options, '{}')) o where o = any(v_template.options);
  if exists (select 1 from unnest(coalesce(p_options, '{}')) o where o <> all(v_template.options)) then
    raise exception 'PERMISSION_TEMPLATE_OPTION_INVALID' using errcode = '22023';
  end if;

  select * into v_previous from public.user_template_assignments where user_id = p_user_id for update;
  insert into public.user_template_assignments (user_id, template_code, options, excluded, applied, assigned_by, assigned_at, updated_by, updated_at)
  values (p_user_id, p_template_code, v_options, '[]'::jsonb, '[]'::jsonb, v_actor, now(), v_actor, now())
  on conflict (user_id) do update set
    template_code = excluded.template_code,
    options = excluded.options,
    excluded = case when public.user_template_assignments.template_code = excluded.template_code
      then public.user_template_assignments.excluded else '[]'::jsonb end,
    updated_by = excluded.updated_by, updated_at = now();

  v_result := app_private.sync_user_template_assignment(p_user_id, v_reason, coalesce(p_warning_acceptances, '[]'::jsonb));

  insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
  values (v_actor, p_user_id, 'user_template_assignment_saved',
    case when v_previous.user_id is null then '{}'::jsonb
      else jsonb_build_object('templateCode', v_previous.template_code, 'options', to_jsonb(v_previous.options)) end,
    jsonb_build_object('templateCode', p_template_code, 'options', to_jsonb(v_options)),
    jsonb_build_object('reason', v_reason, 'added', v_result -> 'added', 'removed', v_result -> 'removed'));
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('templateCode', p_template_code, 'options', to_jsonb(v_options));
end;
$$;

revoke all on function public.save_user_template_assignment_v1(uuid, text, text[], text, jsonb) from public, anon;
grant execute on function public.save_user_template_assignment_v1(uuid, text, text[], text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. Người đang kiêm nhiệm (theo quyền riêng đang hiệu lực, phạm vi chồng nhau) + ghi nhận còn hạn nếu có.
-- ---------------------------------------------------------------------------------------------
create or replace function public.list_user_sod_conflicts_v1(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.can_manage_permissions() then
    raise exception 'Authorization administration permission required' using errcode = '42501';
  end if;
  return coalesce((
    with live as (
      select g.user_id, g.permission_code, g.scope_type, g.scope_id
      from public.user_permission_grants g
      join public.users u on u.id = g.user_id and u.is_active and u.account_status = 'ACTIVE' and u.role <> 'ADMIN'
      where g.is_active and (g.expires_at is null or g.expires_at > now())
        and (p_user_id is null or g.user_id = p_user_id)
    ),
    pairs as (
      select distinct l.user_id, r.rule_code,
        case when app_private.scope_covers(l.scope_type, l.scope_id, rr.scope_type, rr.scope_id)
          then rr.scope_type else l.scope_type end as scope_type,
        case when app_private.scope_covers(l.scope_type, l.scope_id, rr.scope_type, rr.scope_id)
          then rr.scope_id else l.scope_id end as scope_id
      from public.authorization_sod_rules r
      join live l on l.permission_code = r.left_permission_code
      join live rr on rr.user_id = l.user_id and rr.permission_code = r.right_permission_code
      where r.is_active and r.rule_type = 'PERMISSION_PAIR'
        and (app_private.scope_covers(l.scope_type, l.scope_id, rr.scope_type, rr.scope_id)
          or app_private.scope_covers(rr.scope_type, rr.scope_id, l.scope_type, l.scope_id))
    ),
    per_rule as (
      select p.user_id, p.rule_code, rule_row.name, rule_row.description,
        jsonb_agg(jsonb_build_object('scopeType', p.scope_type, 'scopeId', p.scope_id,
          'scopeLabel', case when p.scope_type = 'warehouse'
            then coalesce((select wh.name from public.warehouses wh where wh.id = p.scope_id), p.scope_id) end)
          order by p.scope_type, p.scope_id) as scopes
      from pairs p join public.authorization_sod_rules rule_row on rule_row.rule_code = p.rule_code
      group by p.user_id, p.rule_code, rule_row.name, rule_row.description
    )
    select jsonb_agg(jsonb_build_object(
        'userId', u.id, 'name', u.name, 'email', u.email,
        'conflicts', (
          select jsonb_agg(jsonb_build_object('ruleCode', pr.rule_code, 'name', pr.name, 'description', pr.description,
              'scopes', pr.scopes,
              'acceptance', (
                select jsonb_build_object('expiresAt', acc.expires_at, 'reason', acc.reason,
                  'compensatingControls', acc.compensating_controls,
                  'controlOwnerName', (select o.name from public.users o where o.id = acc.control_owner_user_id),
                  'acceptedAt', acc.created_at)
                from public.authorization_sod_warning_acceptances acc
                where acc.target_user_id = pr.user_id and acc.rule_code = pr.rule_code and acc.expires_at > now()
                order by acc.created_at desc limit 1))
            order by pr.name)
          from per_rule pr where pr.user_id = u.id))
      order by u.name)
    from public.users u
    where exists (select 1 from per_rule pr where pr.user_id = u.id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_user_sod_conflicts_v1(uuid) from public, anon;
grant execute on function public.list_user_sod_conflicts_v1(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. Người xác nhận không tự đảo phiếu (thân hàm như trên Cloud 23/10/2026, thêm một điều kiện).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_finance_payment_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), ''); b jsonb;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
  if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_req.status <> 'paid' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
  -- Đợt 2c: người xác nhận đã chi không tự đảo phiếu đó.
  if v_req.paid ->> 'by' = v_actor::text then raise exception using errcode = '42501', message = 'FINANCE_SELF_REVERSE'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_req.kind = 'advance' then perform app_private.finance_assert_advance_reversible(v_req.id); end if;
  perform app_private.finance_cash_reverse_source('payment_request', v_req.id::text, v_reason, v_actor);
  update public.finance_project_capital set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = 'Đảo phiếu chi ' || v_req.code || ': ' || v_reason
  where source_type = 'payment_request' and source_id = v_req.id::text and status = 'posted';
  if v_req.kind = 'expense' then
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name, cost_classification_status)
    select 'finance-expense-reversal-' || v_req.id::text, t."projectFinanceId", t."constructionSiteId", t.project_id, t.project_finance_id, t.construction_site_id,
      'expense', t.category, -t.amount, 'Đảo ' || t.description || ' — ' || v_reason, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text, 'workflow',
      t.source_ref || ':reversal', t.source_ref || ':reversal', '[]'::jsonb, v_actor::text, now(), t.counterparty_name, 'manual'
    from public.project_transactions t where t.source_ref = 'finance_expense:' || v_req.id::text;
  end if;
  perform set_config('app.finance_context', 'on', true);
  for b in select value from jsonb_array_elements(v_req.paid->'batches') loop
    perform app_private.reverse_supplier_payment_batch((b->>'batchId')::uuid, v_actor);
    update public.supplier_payment_batches set metadata = metadata || jsonb_build_object('g7ReversalReason', v_reason) where id = (b->>'batchId')::uuid;
  end loop;
  perform set_config('app.finance_context', 'off', true);
  update public.finance_payment_requests set status = 'reversed', updated_at = now(), row_version = row_version + 1,
    paid = paid || jsonb_build_object('reversal', jsonb_build_object('reason', v_reason, 'by', v_actor, 'byName', app_private.finance_user_name(v_actor), 'at', now()))
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, reason)
  values (v_req.id, v_req.submission_no, 'Đảo phiếu chi', 'reverse', v_actor, v_reason);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'payment_request_reverse', v_actor, v_reason, jsonb_build_object('code', v_req.code, 'amount', v_req.amount));
  perform app_private.finance_notify(array[v_req.created_by], 'Phiếu chi đã bị đảo', v_req.code || ': ' || v_reason, v_req.id, v_actor);
  return jsonb_build_object('requestId', v_req.id, 'status', 'reversed');
exception when others then
  perform set_config('app.finance_context', 'off', true);
  raise;
end $function$;

CREATE OR REPLACE FUNCTION public.decide_finance_cash_movement_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), ''); m public.finance_cash_movements%rowtype;
begin
  select * into m from public.finance_cash_movements where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CASH_MOVEMENT_STATE'; end if;
  if m.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_action = 'withdraw' then
    if m.status <> 'submitted' or m.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.finance_cash_movements set status = 'withdrawn', decided_by = v_actor, decided_at = now(), row_version = row_version + 1 where id = m.id;
  elsif v_action in ('confirm', 'reject') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if m.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_CASH_MOVEMENT_STATE'; end if;
    if v_actor = m.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.finance_cash_movements set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = m.id;
    else
      if m.kind = 'transfer' then
        perform app_private.finance_cash_entry(m.from_account_id, m.movement_date, 'out', m.amount, 'cash_transfer', m.id::text, m.code,
          'Chuyển tiền sang ' || (select name from public.cash_funds where id = m.to_account_id) || ' · ' || m.description, null, m.project_id, v_actor);
        perform app_private.finance_cash_entry(m.to_account_id, m.movement_date, 'in', m.amount, 'cash_transfer', m.id::text, m.code,
          'Nhận tiền từ ' || (select name from public.cash_funds where id = m.from_account_id) || ' · ' || m.description, null, m.project_id, v_actor);
      else
        perform app_private.finance_cash_entry(m.to_account_id, m.movement_date, 'in', m.amount, 'cash_movement', m.id::text, m.code, m.description, m.counterparty, m.project_id, v_actor);
      end if;
      update public.finance_cash_movements set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = m.id;
    end if;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if m.status <> 'confirmed' or v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_CASH_MOVEMENT_STATE'; end if;
    -- Đợt 2c: người xác nhận phiếu không tự đảo phiếu đó.
    if m.decided_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_REVERSE'; end if;
    perform app_private.finance_cash_reverse_source(case m.kind when 'transfer' then 'cash_transfer' else 'cash_movement' end, m.id::text, v_reason, v_actor);
    update public.finance_cash_movements set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = v_reason, row_version = row_version + 1 where id = m.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('cash_movement', m.id::text, 'cash_' || m.kind || '_' || v_action, v_actor, v_reason, jsonb_build_object('code', m.code, 'amount', m.amount));
  return jsonb_build_object('id', m.id, 'action', v_action);
end $function$;

-- Danh sách: nút Đảo phiếu không hiện với chính người đã xác nhận (thân hàm như trên Cloud 23/10/2026).
CREATE OR REPLACE FUNCTION public.list_finance_payment_requests_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_stage text := coalesce(nullif(p_filter->>'stage', ''), 'request');
  v_confirm boolean := app_private.finance_can('confirm'); v_record boolean := app_private.finance_can('record');
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
      'request', count(*) filter (where status in ('pending', 'returned')),
      'approved', count(*) filter (where status = 'approved'),
      'approvedAmount', coalesce(sum(amount) filter (where status = 'approved'), 0),
      'paid', count(*) filter (where status in ('paid', 'reversed')),
      'waitingMe', count(*) filter (where status = 'pending' and v_actor is distinct from created_by
        and v_actor::text in (select jsonb_array_elements_text(route->current_step->'eligibleIds'))
        and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
          and s.action = 'approve' and s.actor_id = v_actor)))
      from public.finance_payment_requests r),
    'requests', coalesce((select jsonb_agg(x order by (x->>'createdAt') desc) from (
      select jsonb_build_object('id', r.id, 'code', r.code, 'supplierId', r.supplier_id, 'supplierName', r.supplier_name, 'method', r.method,
        'bank', r.bank_snapshot, 'plannedDate', r.planned_date, 'amount', r.amount, 'note', r.note, 'status', r.status, 'route', r.route,
        'currentStep', r.current_step, 'thresholdAmount', r.threshold_amount, 'priorRequests', r.prior_requests, 'paid', r.paid,
        'createdBy', r.created_by, 'createdByName', app_private.finance_user_name(r.created_by), 'createdAt', r.created_at, 'rowVersion', r.row_version,
        'submissionNo', r.submission_no, 'kind', r.kind,
        'expense', case when r.kind = 'expense' then jsonb_build_object('category', r.expense_category, 'costCategory', r.cost_category, 'projectId', r.project_id,
          'projectCode', (select p.code from public.projects p where p.id = r.project_id)) end,
        'cashEntry', (select jsonb_build_object('accountName', f.name, 'date', e.entry_date) from public.finance_cash_entries e join public.cash_funds f on f.id = e.account_id
          where e.source_type = 'payment_request' and e.source_id = r.id::text and e.reversal_of is null order by e.created_at limit 1),
        'advance', case when r.kind = 'advance' then jsonb_build_object('purchaseOrderId', r.purchase_order_id,
          'poNumber', (select po.po_number from public.purchase_orders po where po.id = r.purchase_order_id),
          'contractId', coalesce(r.supplier_contract_id, r.subcontract_id), 'subcontractId', r.subcontract_id,
          'contractCode', coalesce((select c.code from public.supplier_contracts c where c.id = r.supplier_contract_id),
            (select sc.code from public.subcontractor_contracts sc where sc.id = r.subcontract_id)),
          'projectId', r.project_id, 'projectCode', (select p.code from public.projects p where p.id = r.project_id),
          'base', r.advance_base, 'percent', r.advance_percent, 'repayDueDate', r.repay_due_date,
          'offset', (select coalesce(sum(o.amount - o.released_amount), 0) from public.supplier_advance_offsets o where o.request_id = r.id and o.status = 'active')) end,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('documentId', l.payable_document_id, 'documentNo', l.document_no, 'code', d.code,
            'sourceType', d.source_type, 'projectId', l.project_id, 'projectCode', (select code from public.projects p where p.id = l.project_id),
            'amount', l.amount, 'outstandingSnapshot', l.outstanding_snapshot, 'dueDate', d.due_date) order by d.due_date nulls last), '[]'::jsonb)
          from public.finance_payment_request_lines l join public.supplier_payable_documents d on d.id = l.payable_document_id where l.request_id = r.id),
        'steps', (select coalesce(jsonb_agg(jsonb_build_object('submissionNo', s.submission_no, 'stepNo', s.step_no, 'label', s.label, 'action', s.action,
            'actorName', app_private.finance_user_name(s.actor_id), 'reason', s.reason, 'at', s.created_at) order by s.created_at), '[]'::jsonb)
          from public.finance_payment_request_steps s where s.request_id = r.id),
        'approvedBy', (select coalesce(jsonb_agg(s.actor_id), '[]'::jsonb) from public.finance_payment_request_steps s
          where s.request_id = r.id and s.submission_no = r.submission_no and s.action = 'approve'),
        'canApprove', r.status = 'pending' and v_actor is distinct from r.created_by
          and v_actor::text in (select jsonb_array_elements_text(r.route->r.current_step->'eligibleIds'))
          and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
            and s.action = 'approve' and s.actor_id = v_actor),
        'canWithdraw', r.status in ('pending', 'returned') and r.created_by = v_actor,
        'canResubmit', r.status = 'returned' and r.created_by = v_actor and v_record,
        'canCancel', r.status = 'approved' and (r.created_by = v_actor or v_confirm),
        'canConfirm', r.status = 'approved' and v_confirm and v_actor is distinct from r.created_by
          and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
            and s.action = 'approve' and s.actor_id = v_actor)
          and not (v_actor = any(select unnest(app_private.finance_doc_handlers(l.payable_document_id)) from public.finance_payment_request_lines l where l.request_id = r.id)),
        'canReverse', r.status = 'paid' and v_confirm and (r.paid ->> 'by') is distinct from v_actor::text) x
      from public.finance_payment_requests r
      where (v_stage = 'request' and r.status in ('pending', 'returned'))
         or (v_stage = 'approved' and r.status = 'approved')
         or (v_stage = 'paid' and r.status in ('paid', 'reversed'))
         or (v_stage = 'closed' and r.status in ('rejected', 'withdrawn', 'cancelled'))
         or (v_stage = 'all')
    ) q), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.get_finance_cash_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); v_confirm boolean := app_private.finance_can('confirm');
  v_month date := coalesce(nullif(p_filter->>'month', '')::date, date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')::date)::date);
  v_account uuid := nullif(p_filter->>'accountId', '')::uuid;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor, 'month', v_month,
    'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
    'forecast', app_private.finance_cash_forecast(),
    'flows30', (select jsonb_build_object(
        'in', coalesce(sum(case when e.reversal_of is null then e.amount else -e.amount end) filter (where (e.reversal_of is null) = (e.direction = 'in')), 0),
        'out', coalesce(sum(case when e.reversal_of is null then e.amount else -e.amount end) filter (where (e.reversal_of is null) = (e.direction = 'out')), 0))
      from public.finance_cash_entries e where e.entry_date > v_today - 30 and e.source_type <> 'cash_transfer'),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'bankName', f.bank_name, 'accountNo', f.account_no,
        'projectId', f.project_id, 'projectCode', (select code from public.projects p where p.id = f.project_id), 'holderName', f.holder_name, 'holderUserId', f.holder_user_id, 'note', f.note,
        'active', f.is_active, 'balance', app_private.finance_cash_balance(f.id),
        'opening', (select jsonb_build_object('id', o.id, 'status', o.status, 'balance', o.balance, 'cutoverDate', o.cutover_date, 'note', o.note, 'attachments', o.attachments,
            'createdBy', o.created_by, 'createdByName', app_private.finance_user_name(o.created_by), 'decidedByName', app_private.finance_user_name(o.decided_by),
            'decidedAt', o.decided_at, 'decisionNote', o.decision_note, 'canDecide', o.status = 'submitted' and v_confirm and o.created_by is distinct from v_actor)
          from public.finance_cash_openings o where o.account_id = f.id order by (o.status in ('submitted', 'confirmed')) desc, o.created_at desc limit 1),
        'lastRecon', (select jsonb_build_object('id', r.id, 'month', r.period_month, 'status', r.status, 'bookBalance', r.book_balance, 'statementBalance', r.statement_balance,
            'difference', r.difference, 'explanation', r.explanation, 'attachments', r.attachments, 'createdBy', r.created_by,
            'createdByName', app_private.finance_user_name(r.created_by), 'decidedByName', app_private.finance_user_name(r.decided_by), 'decisionNote', r.decision_note,
            'canDecide', r.status = 'submitted' and v_confirm and r.created_by is distinct from v_actor)
          from public.finance_cash_reconciliations r where r.account_id = f.id order by r.period_month desc, r.created_at desc limit 1),
        'lockedThrough', (select (max(r.period_month) + interval '1 month' - interval '1 day')::date from public.finance_cash_reconciliations r where r.account_id = f.id and r.status = 'confirmed'))
        order by f.is_active desc, f.sort_order, f.kind, f.name)
      from public.cash_funds f), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.entry_date, 'accountId', e.account_id, 'accountName', f.name, 'direction', e.direction,
        'amount', e.amount, 'sourceType', e.source_type, 'sourceId', e.source_id, 'code', e.code, 'description', e.description, 'counterparty', e.counterparty,
        'projectCode', (select code from public.projects p where p.id = e.project_id), 'reversalOf', e.reversal_of,
        'reversed', exists (select 1 from public.finance_cash_entries y where y.reversal_of = e.id), 'createdByName', app_private.finance_user_name(e.created_by))
        order by e.entry_date desc, e.created_at desc)
      from public.finance_cash_entries e join public.cash_funds f on f.id = e.account_id
      where e.entry_date >= v_month and e.entry_date < (v_month + interval '1 month')::date and (v_account is null or e.account_id = v_account)), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'kind', m.kind, 'category', m.category, 'fromAccountId', m.from_account_id,
        'fromName', (select name from public.cash_funds where id = m.from_account_id), 'toAccountId', m.to_account_id, 'toName', (select name from public.cash_funds where id = m.to_account_id),
        'amount', m.amount, 'date', m.movement_date, 'documentRef', m.document_ref, 'counterparty', m.counterparty, 'projectCode', (select code from public.projects p where p.id = m.project_id),
        'description', m.description, 'attachments', m.attachments, 'status', m.status, 'rowVersion', m.row_version, 'createdBy', m.created_by,
        'createdByName', app_private.finance_user_name(m.created_by), 'decidedByName', app_private.finance_user_name(m.decided_by), 'decisionNote', m.decision_note,
        'reverseReason', m.reverse_reason, 'canDecide', m.status = 'submitted' and v_confirm and m.created_by is distinct from v_actor,
        'canWithdraw', m.status = 'submitted' and m.created_by = v_actor, 'canReverse', m.status = 'confirmed' and v_confirm and m.decided_by is distinct from v_actor) order by m.created_at desc)
      from public.finance_cash_movements m where m.status = 'submitted' or m.created_at > now() - interval '45 days'), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name, 'direction', pl.direction, 'category', pl.category, 'amount', pl.amount,
        'dayOfMonth', pl.day_of_month, 'accountId', pl.account_id, 'startMonth', pl.start_month, 'endMonth', pl.end_month, 'active', pl.is_active) order by pl.is_active desc, pl.day_of_month)
      from public.finance_cash_plans pl), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code) order by p.code)
      from public.projects p where coalesce(p.status, '') not in ('cancelled', 'archived', 'completed_archived')), '[]'::jsonb),
    'pending', jsonb_build_object(
      'openings', (select count(*) from public.finance_cash_openings where status = 'submitted'),
      'reconciliations', (select count(*) from public.finance_cash_reconciliations where status = 'submitted'),
      'movements', (select count(*) from public.finance_cash_movements where status = 'submitted'),
      'waitingMe', case when v_confirm then (select count(*) from public.finance_cash_openings where status = 'submitted' and created_by is distinct from v_actor)
        + (select count(*) from public.finance_cash_reconciliations where status = 'submitted' and created_by is distinct from v_actor)
        + (select count(*) from public.finance_cash_movements where status = 'submitted' and created_by is distinct from v_actor) else 0 end,
      'accountsWithoutOpening', (select count(*) from public.cash_funds f where f.is_active and not exists (select 1 from public.finance_cash_openings o
        where o.account_id = f.id and o.status in ('submitted', 'confirmed')))));
end $function$;

notify pgrst, 'reload schema';
