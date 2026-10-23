-- Phân quyền Đợt 3a (23/10/2026, chủ SP duyệt): 15 mẫu quyền còn 8, sửa lỗi gắn mẫu với quyền đã hết hạn,
-- chặn tự duyệt chấm công của chính mình, ghi nhận kiêm nhiệm đang có.

-- ---------------------------------------------------------------------------------------------
-- 1. Ô tích riêng của mẫu Kế toán (Kế toán trưởng là phần thêm — chủ SP chốt 23/10).
-- ---------------------------------------------------------------------------------------------
insert into public.permission_template_option_defs (key, label, description, items, sort_order, is_active) values
  ('chief_accountant', 'Kế toán trưởng', 'Xác nhận đã chi, sửa ngân sách, danh mục chi phí, khóa kỳ kho.',
   '[{"permissionCode": "system.finance.confirm", "scopeType": "global"},
     {"permissionCode": "expense.budget.edit_all", "scopeType": "global"},
     {"permissionCode": "expense.master_data.manage", "scopeType": "global"},
     {"permissionCode": "wms.accounting.close_period", "scopeType": "global"}]'::jsonb, 20, true),
  ('warehouse_accounting', 'Kế toán kho', 'Đối chiếu, giá vốn, báo cáo kho.',
   '[{"permissionCode": "wms.accounting.manage", "scopeType": "global"}]'::jsonb, 30, true)
on conflict (key) do update set label = excluded.label, description = excluded.description, items = excluded.items,
  sort_order = excluded.sort_order, is_active = excluded.is_active;

-- ---------------------------------------------------------------------------------------------
-- 2. 8 mẫu theo bộ phận. Chưa ai gắn mẫu nên chỉ sửa nội dung mẫu (không đồng bộ người).
-- ---------------------------------------------------------------------------------------------
update public.user_permission_templates set name = 'Kế toán',
  description = 'Cơ bản + công nợ, đề nghị chi, thu chi, chi phí, xem kho, mua hàng, hợp đồng. Ô tích: Kế toán trưởng, Kế toán kho.',
  options = '{chief_accountant,warehouse_accounting}', updated_at = now()
where code = 'accountant';

update public.user_permission_templates set name = 'Mua hàng',
  description = 'Cơ bản + lập và quản lý đơn mua, xem kho, hợp đồng NCC. Ô tích: Duyệt PO.',
  options = '{po_approver}', updated_at = now()
where code = 'material_staff';

-- Cán bộ kho tách hẳn khỏi người mua: bỏ Quản trị Mua hàng và các quyền quản trị kho bãi / dữ liệu gốc / định mức
-- (Admin cấp riêng). Kho làm thủ kho gán ở Kho vật tư → Phân quyền kho.
update public.user_permission_templates set name = 'Cán bộ kho',
  description = 'Cơ bản + xem kho, tồn, phiếu kho, đề xuất, đơn mua. Thủ kho theo kho gán ở Phân quyền kho.',
  options = '{}',
  items = (select coalesce(jsonb_agg(i), '[]'::jsonb) from jsonb_array_elements(items) i
           where i ->> 'permissionCode' not in ('system.procurement.manage', 'settings.loss_norms.manage',
             'settings.master_data.manage', 'settings.warehouses.manage'))
    || case when items @> '[{"permissionCode": "system.procurement.view"}]'::jsonb then '[]'::jsonb
            else '[{"permissionCode": "system.procurement.view", "scopeType": "global"}]'::jsonb end,
  updated_at = now()
where code = 'warehouse_manager';

-- HCNS gồm cả Hành chính – Tài sản – Đội xe – VPP (chủ SP chốt 23/10). Trưởng phòng: Admin cấp thêm HR Manage.
update public.user_permission_templates t set name = 'Hành chính – Nhân sự',
  description = 'Cơ bản + hồ sơ, chấm công, phép, tổ chức, định biên; tài sản, đội xe.',
  items = (select coalesce(jsonb_agg(distinct x.i), '[]'::jsonb) from (
            select jsonb_array_elements(t.items) i
            union select jsonb_array_elements(a.items) from public.user_permission_templates a where a.code = 'admin_assets_fleet') x),
  updated_at = now()
where code = 'hr_staff';

update public.user_permission_templates set name = 'Cán bộ công trường', updated_at = now() where code = 'site_staff';

update public.user_permission_templates set name = 'Ban lãnh đạo',
  description = 'Xem toàn công ty: dự án, tài chính, kho, mua hàng, nhân sự tổng hợp, báo cáo AI. Quản trị Tài chính Admin cấp riêng. Ô tích: Duyệt PO.',
  options = '{po_approver}',
  items = items || case when items @> '[{"permissionCode": "system.finance.view"}]'::jsonb then '[]'::jsonb
                        else '[{"permissionCode": "system.finance.view", "scopeType": "global"}]'::jsonb end,
  updated_at = now()
where code = 'executive';

-- Quản trị Tài chính chỉ anh Thịnh, chị Mơ (chủ SP chốt 20/10); Phó TGĐ thấp hơn một bậc: Cấu hình Tài chính.
update public.user_permission_templates set name = 'Phó TGĐ – GĐ Tài chính',
  description = 'Tài chính: xem, ghi nhận, xác nhận chi, cấu hình; ngân sách, chi phí; xem dự án, kho, mua hàng.',
  items = (select coalesce(jsonb_agg(i), '[]'::jsonb) from jsonb_array_elements(items) i
           where i ->> 'permissionCode' <> 'system.finance.manage')
    || '[{"permissionCode": "system.finance.configure", "scopeType": "global"}]'::jsonb,
  updated_at = now()
where code = 'finance_director';

update public.user_permission_templates set is_active = false, updated_at = now()
where code in ('chief_accountant', 'hr_head', 'admin_assets_fleet', 'workflow_admin', 'request_admin', 'asset_admin', 'work_admin');

-- ---------------------------------------------------------------------------------------------
-- 3. Gắn mẫu: quyền đã hết hạn (chưa tắt) không đưa vào bộ quyền sẽ lưu — trước đây lưu bị chặn
--    "Ngày hết hạn phải ở tương lai". Quyền hết hạn sẽ được tắt khi lưu (vốn đã không còn hiệu lực).
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.template_next_grants(p_user_id uuid, p_add jsonb, p_remove_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_json), '[]'::jsonb)
  from (
    -- quyền đang có hiệu lực, trừ quyền mẫu gỡ
    select jsonb_build_object('permission_code', g.permission_code, 'scope_type', g.scope_type,
      'scope_id', g.scope_id, 'expires_at', g.expires_at, 'is_active', true) as row_json
    from public.user_permission_grants g
    where g.user_id = p_user_id and g.is_active and (g.expires_at is null or g.expires_at > now())
      and not (g.scope_id = '*' and g.permission_code || '@' || g.scope_type = any(coalesce(p_remove_keys, '{}')))
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

-- ---------------------------------------------------------------------------------------------
-- 4. Không tự duyệt chấm công của chính mình (60 ngày tới 23/10: 22 bản tự duyệt).
--    Chấm công vào / ra không ghi người duyệt nên không bị ảnh hưởng.
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.guard_attendance_self_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_employee_id text := coalesce(v_new ->> 'targetEmployeeId', v_new ->> 'employeeId');
  v_approver text := v_new ->> 'approvedBy';
begin
  if v_approver is not null
    and (tg_op = 'INSERT' or v_approver is distinct from to_jsonb(old) ->> 'approvedBy')
    and exists (select 1 from public.employees e where e.id::text = v_employee_id and e.user_id::text = v_approver)
  then
    raise exception 'Không tự duyệt chấm công của chính mình. Nhờ quản lý trực tiếp hoặc HCNS duyệt.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_hrm_attendance_self_approval on public.hrm_attendance;
create trigger trg_guard_hrm_attendance_self_approval
  before insert or update of "approvedBy" on public.hrm_attendance
  for each row execute function app_private.guard_attendance_self_approval();

drop trigger if exists trg_guard_hrm_proposal_self_approval on public.hrm_attendance_proposals;
create trigger trg_guard_hrm_proposal_self_approval
  before insert or update of "approvedBy" on public.hrm_attendance_proposals
  for each row execute function app_private.guard_attendance_self_approval();

revoke all on function app_private.guard_attendance_self_approval() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Ghi nhận kiêm nhiệm đang có (người đã giữ sẵn cặp quyền, ví dụ kế toán kiêm thủ kho và mua hàng).
-- ---------------------------------------------------------------------------------------------
-- Cặp quyền kiêm nhiệm của một người (hoặc mọi người): theo quyền riêng đang hiệu lực, phạm vi chồng nhau.
create or replace function app_private.user_sod_conflict_pairs(p_user_id uuid default null)
returns table (user_id uuid, rule_code text, scope_type text, scope_id text)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select g.user_id, g.permission_code, g.scope_type, g.scope_id
    from public.user_permission_grants g
    join public.users u on u.id = g.user_id and u.is_active and u.account_status = 'ACTIVE' and u.role <> 'ADMIN'
    where g.is_active and (g.expires_at is null or g.expires_at > now())
      and (p_user_id is null or g.user_id = p_user_id)
  )
  select distinct l.user_id, r.rule_code,
    case when app_private.scope_covers(l.scope_type, l.scope_id, rr.scope_type, rr.scope_id)
      then rr.scope_type else l.scope_type end,
    case when app_private.scope_covers(l.scope_type, l.scope_id, rr.scope_type, rr.scope_id)
      then rr.scope_id else l.scope_id end
  from public.authorization_sod_rules r
  join live l on l.permission_code = r.left_permission_code
  join live rr on rr.user_id = l.user_id and rr.permission_code = r.right_permission_code
  where r.is_active and r.rule_type = 'PERMISSION_PAIR'
    and (app_private.scope_covers(l.scope_type, l.scope_id, rr.scope_type, rr.scope_id)
      or app_private.scope_covers(rr.scope_type, rr.scope_id, l.scope_type, l.scope_id));
$$;

revoke all on function app_private.user_sod_conflict_pairs(uuid) from public, anon, authenticated;

-- Danh sách kiêm nhiệm: thêm quyền của cặp + gợi ý kiểm soát bù để màn hình mở hộp ghi nhận.
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
    with per_rule as (
      select p.user_id, p.rule_code, rule_row.name, rule_row.description,
        coalesce(rule_row.metadata -> 'controls', '[]'::jsonb) as controls,
        (select coalesce(jsonb_agg(jsonb_build_object('code', a.permission_code, 'label', a.label, 'moduleLabel', m.name)
            order by a.permission_code), '[]'::jsonb)
         from public.permission_actions a left join public.permission_modules m on m.code = a.module_code
         where a.permission_code in (rule_row.left_permission_code, rule_row.right_permission_code)) as permissions,
        jsonb_agg(jsonb_build_object('scopeType', p.scope_type, 'scopeId', p.scope_id,
          'scopeLabel', case when p.scope_type = 'warehouse'
            then coalesce((select wh.name from public.warehouses wh where wh.id = p.scope_id), p.scope_id) end)
          order by p.scope_type, p.scope_id) as scopes
      from app_private.user_sod_conflict_pairs(p_user_id) p
      join public.authorization_sod_rules rule_row on rule_row.rule_code = p.rule_code
      group by p.user_id, p.rule_code, rule_row.name, rule_row.description, rule_row.metadata,
        rule_row.left_permission_code, rule_row.right_permission_code
    )
    select jsonb_agg(jsonb_build_object(
        'userId', u.id, 'name', u.name, 'email', u.email,
        'conflicts', (
          select jsonb_agg(jsonb_build_object('ruleCode', pr.rule_code, 'name', pr.name, 'description', pr.description,
              'scopes', pr.scopes, 'permissions', pr.permissions, 'controls', pr.controls,
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

-- Ghi nhận một cặp kiêm nhiệm người đó đang giữ (mọi phạm vi của cặp đó): lý do, người kiểm soát, cách kiểm soát bù, hạn.
create or replace function public.record_existing_sod_acceptance_v1(
  p_user_id uuid, p_rule_code text, p_reason text, p_control_owner_user_id uuid,
  p_compensating_controls text, p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_authorization_permission('system.authorization.manage_grants');
  v_command_id uuid := gen_random_uuid();
  v_count integer;
begin
  if not exists (select 1 from app_private.user_sod_conflict_pairs(p_user_id) p where p.rule_code = p_rule_code) then
    raise exception 'SOD_CONFLICT_NOT_FOUND' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10
    or char_length(btrim(coalesce(p_compensating_controls, ''))) < 10
    or p_expires_at is null or p_expires_at <= now()
    or p_control_owner_user_id is null or p_control_owner_user_id in (v_actor, p_user_id)
    or not exists (select 1 from public.users o where o.id = p_control_owner_user_id and o.is_active and o.account_status = 'ACTIVE')
  then
    raise exception 'Invalid SoD warning control evidence' using errcode = '22023';
  end if;

  insert into public.authorization_sod_warning_acceptances (rule_code, command_type, command_id, actor_user_id, target_user_id,
    scope_type, scope_id, reason, control_owner_user_id, compensating_controls, expires_at)
  select p.rule_code, 'EXISTING_CONFLICT_REVIEW', v_command_id, v_actor, p_user_id, p.scope_type, p.scope_id,
    btrim(p_reason), p_control_owner_user_id, btrim(p_compensating_controls), p_expires_at
  from app_private.user_sod_conflict_pairs(p_user_id) p where p.rule_code = p_rule_code;
  get diagnostics v_count = row_count;

  insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
  values (v_actor, p_user_id, 'sod_existing_conflict_acknowledged', '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object('commandId', v_command_id, 'ruleCode', p_rule_code, 'reason', btrim(p_reason),
      'controlOwnerUserId', p_control_owner_user_id, 'expiresAt', p_expires_at, 'scopes', v_count));
  return jsonb_build_object('ruleCode', p_rule_code, 'scopes', v_count, 'expiresAt', p_expires_at);
end;
$$;

revoke all on function public.record_existing_sod_acceptance_v1(uuid, text, text, uuid, text, timestamptz) from public, anon;
grant execute on function public.record_existing_sod_acceptance_v1(uuid, text, text, uuid, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
