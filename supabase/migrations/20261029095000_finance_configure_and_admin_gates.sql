-- Đợt 2a-1 audit mẫu quyền (chủ SP duyệt 23/10/2026): tách "Cấu hình Tài chính" khỏi "Quản trị Tài chính" và
-- thay 3 chỗ chỉ ADMIN bằng quyền riêng. Tài khoản Admin Hoàng vẫn là Super ADMIN, qua mọi bước.
-- 1) Cấu hình Tài chính (system.finance.configure): điều khoản NCC / khách hàng / thầu phụ / HĐ, hạn thanh toán, số ngày
--    thanh toán mặc định, số dư quỹ tối thiểu, tham số dự báo; xem Tổng quan + dự báo dòng tiền toàn công ty.
--    Giữ ở Quản trị: ma trận duyệt chi, ủy quyền thay người khác, người duyệt tạm ứng / vượt ngân sách / cấp vốn,
--    mốc chi phí MISA, quyết định ngân sách / phân bổ / mở quỹ. Cấp Cấu hình cho chị Hương (KTT) và anh Chuẩn (GĐTC):
--    23/10 hai người đã thôi Quản trị nên mất Tổng quan và dự báo toàn công ty.
-- 2) Công tắc xem tài chính / hợp đồng dự án: Admin hoặc Quản trị Tài chính (anh Thịnh, chị Mơ).
-- 3) Phân quyền kho (thủ kho, kế toán kho, khóa sổ…): Admin hoặc Quản trị Kho vật tư (system.wms.manage, Admin cấp).
-- Xuất MISA (màn /misa-export) chỉ đổi ở giao diện: Admin hoặc Kế toán kho.

insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes, legacy_module_key,
  legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code, direct_grant_allowed)
values ('system.finance', 'configure', 'system.finance.configure', 'Cấu hình Tài chính',
  'Sửa điều khoản thanh toán NCC / khách hàng / thầu phụ / HĐ, hạn thanh toán, số ngày mặc định, số dư quỹ tối thiểu, tham số dự báo; xem Tổng quan và dự báo toàn công ty. Ma trận duyệt chi và ủy quyền vẫn cần Quản trị Tài chính.',
  array['global'], 'FINANCE', '/finance', false, 35, true, 'important', true, false, false, 'enforced', 'finance', true)
on conflict (permission_code) do nothing;

create or replace function app_private.can_manage_project_sensitive_view()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or app_private.has_permission(public.current_app_user_id(), 'system.finance.manage', 'global', '*');
$$;
revoke all on function app_private.can_manage_project_sensitive_view() from public, anon;
grant execute on function app_private.can_manage_project_sensitive_view() to authenticated;

create or replace function app_private.wms_can_edit_access(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor is not null and (public.is_admin()
    or app_private.has_permission(p_actor, 'system.wms.manage', 'global', '*'));
$$;
revoke all on function app_private.wms_can_edit_access(uuid) from public, anon;
grant execute on function app_private.wms_can_edit_access(uuid) to authenticated;

-- Cấu hình Tài chính: Quản trị bao gồm Cấu hình; ai có Cấu hình thì xem được Tài chính.
create or replace function app_private.finance_can(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.current_app_user_id() is not null and (public.is_admin()
    or app_private.has_permission(public.current_app_user_id(), 'system.finance.' || p_action)
    or (p_action = 'configure' and app_private.has_permission(public.current_app_user_id(), 'system.finance.manage'))
    or (p_action = 'view' and (app_private.has_permission(public.current_app_user_id(), 'system.finance.record')
      or app_private.has_permission(public.current_app_user_id(), 'system.finance.confirm')
      or app_private.has_permission(public.current_app_user_id(), 'system.finance.manage')
      or app_private.has_permission(public.current_app_user_id(), 'system.finance.configure'))));
$function$;

-- Cờ quyền trả về giao diện có thêm configure.
create or replace function app_private.finance_can_flags()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('view', app_private.finance_can('view'), 'record', app_private.finance_can('record'),
    'confirm', app_private.finance_can('confirm'), 'configure', app_private.finance_can('configure'),
    'manage', app_private.finance_can('manage'));
$function$;

-- Việc cấu hình thường ngày: Cấu hình Tài chính (Quản trị vẫn làm được).
create or replace function public.save_finance_settings_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype;
  v_days integer := nullif(p_input->>'defaultPaymentDays', '')::integer; v_reason text := nullif(btrim(p_input->>'reason'), ''); v_n integer := 0;
begin
  if not app_private.finance_can('configure') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_days is null or v_days < 0 or v_days > 365 then raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select * into v_set from public.finance_settings where id = 1 for update;
  if v_set.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  update public.finance_settings set default_payment_days = v_days, row_version = row_version + 1, updated_by = v_actor, updated_at = now() where id = 1;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after)
  values ('settings', '1', 'settings_save', v_actor, v_reason, jsonb_build_object('defaultPaymentDays', v_set.default_payment_days),
    jsonb_build_object('defaultPaymentDays', v_days));
  if coalesce((p_input->>'applyToOpen')::boolean, false) then
    v_n := app_private.finance_recompute_due(null, null, array['default'], v_actor, v_reason);
  end if;
  perform app_private.finance_notify_admins('Đổi hạn thanh toán mặc định', v_set.default_payment_days || ' → ' || v_days || ' ngày: ' || v_reason, v_actor);
  return jsonb_build_object('defaultPaymentDays', v_days, 'recomputed', v_n);
end $function$;

-- Việc cấu hình thường ngày: Cấu hình Tài chính (Quản trị vẫn làm được).
create or replace function public.save_finance_cash_settings_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_min numeric := round(nullif(p_input->>'minBalance', '')::numeric, 2); v_set public.finance_settings%rowtype;
begin
  if not app_private.finance_can('configure') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_min is null or v_min < 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if nullif(btrim(p_input->>'reason'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into v_set from public.finance_settings where id = 1 for update;
  if v_set.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  update public.finance_settings set cash_min_balance = v_min, row_version = row_version + 1, updated_by = v_actor, updated_at = now() where id = 1;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after)
  values ('settings', '1', 'cash_settings_save', v_actor, btrim(p_input->>'reason'), jsonb_build_object('minBalance', v_set.cash_min_balance), jsonb_build_object('minBalance', v_min));
  return jsonb_build_object('minBalance', v_min);
end $function$;

-- Việc cấu hình thường ngày: Cấu hình Tài chính (Quản trị vẫn làm được).
create or replace function public.save_finance_forecast_settings_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_before jsonb;
begin
  if not app_private.finance_can('configure') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if nullif(btrim(p_input->>'reason'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select to_jsonb(s) into v_before from public.finance_settings s where id = 1;
  begin
    update public.finance_settings set
      forecast_approval_days = coalesce((p_input->>'approvalDays')::integer, forecast_approval_days),
      forecast_pay_days = coalesce((p_input->>'payDays')::integer, forecast_pay_days),
      forecast_labor_percent = coalesce((p_input->>'laborPercent')::numeric, forecast_labor_percent),
      forecast_material_vat_percent = coalesce((p_input->>'materialVatPercent')::numeric, forecast_material_vat_percent),
      forecast_safe_delay_days = coalesce((p_input->>'safeDelayDays')::integer, forecast_safe_delay_days),
      forecast_safe_slip_percent = coalesce((p_input->>'safeSlipPercent')::numeric, forecast_safe_slip_percent),
      forecast_good_early_days = coalesce((p_input->>'goodEarlyDays')::integer, forecast_good_early_days),
      updated_by = v_actor, updated_at = now()
    where id = 1;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'FINANCE_FORECAST_SETTINGS_INVALID';
  end;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, payload)
  values ('settings', '1', 'forecast_settings', v_actor, btrim(p_input->>'reason'), v_before, p_input - 'reason');
  return jsonb_build_object('ok', true);
end $function$;

-- Việc cấu hình thường ngày: Cấu hình Tài chính (Quản trị vẫn làm được).
create or replace function public.save_finance_contract_terms_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_c public.supplier_contracts%rowtype;
  v_days integer := nullif(p_input->>'paymentDays', '')::integer; v_reason text := nullif(btrim(p_input->>'reason'), ''); v_n integer := 0;
begin
  if not app_private.finance_can('configure') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_days is not null and (v_days < 0 or v_days > 365) then raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select * into v_c from public.supplier_contracts where id = p_input->>'contractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  update public.supplier_contracts set payment_term_days = v_days,
    require_invoice_before_payment = coalesce((p_input->>'requireInvoice')::boolean, require_invoice_before_payment)
  where id = v_c.id;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after)
  values ('contract_terms', v_c.id, v_c.supplier_id, 'contract_terms_save', v_actor, v_reason,
    jsonb_build_object('paymentDays', v_c.payment_term_days, 'requireInvoice', v_c.require_invoice_before_payment, 'contractCode', v_c.code),
    jsonb_build_object('paymentDays', v_days, 'requireInvoice', coalesce((p_input->>'requireInvoice')::boolean, v_c.require_invoice_before_payment), 'contractCode', v_c.code));
  if coalesce((p_input->>'applyToOpen')::boolean, false) then
    v_n := app_private.finance_recompute_due(null, v_c.id, array['default', 'supplier', 'contract'], v_actor, v_reason);
  end if;
  return jsonb_build_object('contractId', v_c.id, 'recomputed', v_n);
end $function$;

-- Việc cấu hình thường ngày: Cấu hình Tài chính (Quản trị vẫn làm được).
create or replace function public.save_finance_customer_terms_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); c public.customer_contracts%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_rec numeric := nullif(p_input->>'advanceRecoveryPercent', '')::numeric; v_ret numeric := nullif(p_input->>'retentionPercent', '')::numeric;
  v_days integer := nullif(p_input->>'paymentTermDays', '')::integer; v_war integer := nullif(p_input->>'warrantyMonths', '')::integer;
begin
  if not app_private.finance_can('configure') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if (v_rec is not null and (v_rec < 0 or v_rec > 100)) or (v_ret is not null and (v_ret < 0 or v_ret > 100))
    or (v_days is not null and (v_days < 0 or v_days > 365)) or (v_war is not null and (v_war < 0 or v_war > 120)) then
    raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select * into c from public.customer_contracts where id = p_input->>'contractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  update public.customer_contracts set advance_recovery_percent = v_rec, retention_percent = v_ret, payment_term_days = v_days,
    warranty_months = coalesce(v_war, 0), updated_at = now() where id = c.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after, payload)
  values ('customer_terms', c.id, 'customer_terms_save', v_actor, v_reason,
    jsonb_build_object('advanceRecoveryPercent', c.advance_recovery_percent, 'retentionPercent', c.retention_percent, 'paymentTermDays', c.payment_term_days, 'warrantyMonths', c.warranty_months),
    jsonb_build_object('advanceRecoveryPercent', v_rec, 'retentionPercent', v_ret, 'paymentTermDays', v_days, 'warrantyMonths', v_war),
    jsonb_build_object('contractId', c.id, 'code', c.code));
  return jsonb_build_object('contractId', c.id);
end $function$;

-- Việc cấu hình thường ngày: Cấu hình Tài chính (Quản trị vẫn làm được).
create or replace function public.save_finance_subcontract_terms_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); c public.subcontractor_contracts%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_vat numeric := nullif(p_input->>'vatPercent', '')::numeric; v_rec numeric := nullif(p_input->>'advanceRecoveryPercent', '')::numeric;
  v_ret numeric := coalesce(nullif(p_input->>'retentionPercent', '')::numeric, 0); v_days integer := nullif(p_input->>'paymentTermDays', '')::integer;
  v_war integer := nullif(p_input->>'warrantyMonths', '')::integer; v_pit boolean := coalesce((p_input->>'withholdPit')::boolean, false);
  v_pitp numeric := coalesce(nullif(p_input->>'pitPercent', '')::numeric, 10); v_partner text := nullif(p_input->>'partnerId', '');
begin
  if not app_private.finance_can('configure') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if (v_vat is not null and (v_vat < 0 or v_vat > 100)) or (v_rec is not null and (v_rec < 0 or v_rec > 100)) or v_ret < 0 or v_ret > 100
    or (v_days is not null and (v_days < 0 or v_days > 365)) or (v_war is not null and (v_war < 0 or v_war > 120)) or v_pitp < 0 or v_pitp > 100 then
    raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select * into c from public.subcontractor_contracts where id = p_input->>'subcontractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  if v_partner is not null and not exists (select 1 from public.business_partners where id = v_partner) then
    raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  -- Đổi đối tác khi đã có đợt / tạm ứng làm lệch công nợ → chặn.
  if c.partner_id is not null and v_partner is distinct from c.partner_id and (exists (select 1 from public.finance_subcontract_rounds r where r.subcontract_id = c.id and r.status <> 'cancelled')
    or exists (select 1 from public.finance_payment_requests r where r.subcontract_id = c.id and r.status not in ('rejected', 'withdrawn', 'cancelled'))) then
    raise exception using errcode = '22023', message = 'FINANCE_SUB_PARTNER_LOCKED'; end if;
  update public.subcontractor_contracts set vat_percent = v_vat, advance_recovery_percent = v_rec, retention_percent = v_ret, payment_term_days = v_days,
    warranty_months = v_war, withhold_pit = v_pit, pit_percent = v_pitp, partner_id = coalesce(v_partner, c.partner_id), updated_at = now() where id = c.id;
  -- Hạn giữ lại của các đợt đã ghi nhận đi theo HĐ (ngày hoàn thành + tháng bảo hành).
  update public.supplier_payable_documents set due_date = app_private.finance_sub_retention_due(c.id), updated_at = now()
  where subcontract_id = c.id and source_type = 'subcontract_retention' and due_date_source = 'contract' and status in ('open', 'partial');
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after, payload)
  values ('subcontract_terms', c.id, coalesce(v_partner, c.partner_id), 'subcontract_terms_save', v_actor, v_reason,
    jsonb_build_object('vatPercent', c.vat_percent, 'advanceRecoveryPercent', c.advance_recovery_percent, 'retentionPercent', c.retention_percent,
      'paymentTermDays', c.payment_term_days, 'warrantyMonths', c.warranty_months, 'withholdPit', c.withhold_pit, 'pitPercent', c.pit_percent, 'partnerId', c.partner_id),
    jsonb_build_object('vatPercent', v_vat, 'advanceRecoveryPercent', v_rec, 'retentionPercent', v_ret, 'paymentTermDays', v_days, 'warrantyMonths', v_war,
      'withholdPit', v_pit, 'pitPercent', v_pitp, 'partnerId', coalesce(v_partner, c.partner_id)),
    jsonb_build_object('subcontractId', c.id, 'code', c.code));
  return jsonb_build_object('subcontractId', c.id);
end $function$;

-- Việc cấu hình thường ngày: Cấu hình Tài chính (Quản trị vẫn làm được).
create or replace function public.save_finance_supplier_terms_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId';
  v_days integer := nullif(p_input->>'paymentDays', '')::integer; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_before jsonb; v_n integer := 0;
begin
  if not app_private.finance_can('configure') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if not exists (select 1 from public.business_partners where id = v_supplier) then
    raise exception using errcode = 'PT404', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  if v_days is not null and (v_days < 0 or v_days > 365) then raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select to_jsonb(t) into v_before from public.supplier_payment_terms t where supplier_id = v_supplier;
  if v_days is null then
    delete from public.supplier_payment_terms where supplier_id = v_supplier;
  else
    insert into public.supplier_payment_terms (supplier_id, payment_days, note, updated_by, updated_at)
    values (v_supplier, v_days, nullif(btrim(p_input->>'note'), ''), v_actor, now())
    on conflict (supplier_id) do update set payment_days = excluded.payment_days, note = excluded.note, updated_by = v_actor, updated_at = now();
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after)
  values ('supplier_terms', v_supplier, v_supplier, 'terms_save', v_actor, v_reason, v_before,
    case when v_days is null then null else jsonb_build_object('paymentDays', v_days, 'note', nullif(btrim(p_input->>'note'), '')) end);
  if coalesce((p_input->>'applyToOpen')::boolean, false) then
    v_n := app_private.finance_recompute_due(v_supplier, null, array['default', 'supplier'], v_actor, v_reason);
  end if;
  return jsonb_build_object('supplierId', v_supplier, 'recomputed', v_n);
end $function$;

-- Việc cấu hình thường ngày: Cấu hình Tài chính (Quản trị vẫn làm được).
create or replace function public.set_finance_payable_due_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_d public.supplier_payable_documents%rowtype;
  v_due date := nullif(p_input->>'dueDate', '')::date; v_reason text := nullif(btrim(p_input->>'reason'), ''); f record;
begin
  if not app_private.finance_can('configure') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into v_d from public.supplier_payable_documents where id = (p_input->>'documentId')::uuid for update;
  if not found or v_d.status not in ('open', 'partial') then raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_STATE'; end if;
  if v_due is null then
    select * into f from app_private.finance_due_for(v_d.supplier_id, v_d.supplier_contract_id, v_d.document_date);
    update public.supplier_payable_documents set due_date = f.due_date, due_date_source = f.source where id = v_d.id;
  else
    if v_due < v_d.document_date then raise exception using errcode = '22023', message = 'FINANCE_DUE_BEFORE_DOCUMENT'; end if;
    update public.supplier_payable_documents set due_date = v_due, due_date_source = 'manual' where id = v_d.id;
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after)
  values ('payable', v_d.id::text, v_d.supplier_id, 'due_set', v_actor, v_reason,
    jsonb_build_object('dueDate', v_d.due_date, 'source', v_d.due_date_source),
    (select jsonb_build_object('dueDate', due_date, 'source', due_date_source) from public.supplier_payable_documents where id = v_d.id));
  return jsonb_build_object('documentId', v_d.id);
end $function$;

-- Tổng quan Tài chính: người có Cấu hình (GĐ tài chính, kế toán trưởng) cũng xem được.
create or replace function public.get_finance_overview_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.finance_can('view') then
    raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  if not app_private.finance_can('configure') then
    return jsonb_build_object('canOverview', false, 'today', v_today, 'projects', '[]'::jsonb);
  end if;
  return (
    with scope as (
      select p.id, p.code, p.name, p.status, p.construction_site_id::text site_id
      from public.projects p
      where coalesce(p.status, '') not in ('cancelled', 'archived', 'completed_archived')
        and (exists (select 1 from public.customer_contracts c where c.project_id = p.id)
          or exists (select 1 from public.project_transactions t where t.project_id = p.id))
    ),
    tx as (
      select t.project_id, left(t.date, 7) m, t.type, coalesce(nullif(t.category, ''), 'other') category, sum(t.amount) amount
      from public.project_transactions t join scope s on s.id = t.project_id
      where t.type in ('expense', 'revenue_received') and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
      group by 1, 2, 3, 4
    ),
    ap as (
      select r.project_id, sum(r.outstanding) outstanding,
        sum(r.outstanding) filter (where r.due_date < v_today) overdue,
        sum(r.outstanding) filter (where r.due_date >= v_today and r.due_date <= v_today + 7) soon,
        count(*) filter (where r.outstanding > 0.5) docs
      from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal group by 1
    ),
    recv as (
      select coalesce(ps.project_id, s.id) project_id, jsonb_agg(jsonb_build_object('description', ps.description, 'amount', ps.amount,
        'paidAmount', ps.paid_amount, 'dueDate', ps.due_date, 'paidDate', ps.paid_date, 'status', ps.status,
        'advance', coalesce(ps.milestone_type, '') = 'advance' or ps.description ilike '%tạm ứng%') order by ps.due_date) rows,
        sum(ps.paid_amount) filter (where ps.status = 'paid' and (coalesce(ps.milestone_type, '') = 'advance' or ps.description ilike '%tạm ứng%')) advance
      from public.payment_schedules ps
      join scope s on s.id = ps.project_id or (ps.project_id is null and s.site_id is not null and ps.construction_site_id = s.site_id)
      where ps.type = 'receivable'
      group by 1
    )
    select jsonb_build_object('canOverview', true, 'today', v_today,
      'projects', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'code', s.code, 'name', s.name, 'status', s.status,
        'contractValue', (select nullif(sum(c.value), 0) from public.customer_contracts c where c.project_id = s.id),
        'progress', app_private.finance_project_gantt_progress(s.id),
        'received', coalesce((select sum(x.amount) from tx x where x.project_id = s.id and x.type = 'revenue_received'), 0),
        'advanceReceived', r.advance,
        'cost', coalesce((select sum(x.amount) from tx x where x.project_id = s.id and x.type = 'expense'), 0),
        'costByCategory', coalesce((select jsonb_object_agg(z.category, z.amount) from (select x.category, sum(x.amount) amount from tx x
          where x.project_id = s.id and x.type = 'expense' group by 1) z), '{}'::jsonb),
        'months', coalesce((select jsonb_agg(jsonb_build_object('month', z.m, 'in', z.inn, 'out', z.out) order by z.m) from (
          select x.m, sum(x.amount) filter (where x.type = 'revenue_received') inn, sum(x.amount) filter (where x.type = 'expense') out
          from tx x where x.project_id = s.id group by 1) z), '[]'::jsonb),
        'materialBudget', (select nullif(sum(m.budget_total), 0) from public.material_budget_items m where m.project_id = s.id),
        'payable', jsonb_build_object('outstanding', coalesce(a.outstanding, 0), 'overdue', coalesce(a.overdue, 0), 'soon', coalesce(a.soon, 0), 'docs', coalesce(a.docs, 0)),
        'receivables', coalesce(r.rows, '[]'::jsonb),
        'supplierAdvance', (select nullif(sum(x.remaining), 0) from app_private.finance_advance_rows() x where x.project_id = s.id),
        'ar', (select jsonb_build_object('outstanding', coalesce(sum((z.m->>'outstanding')::numeric), 0), 'overdue', coalesce(sum((z.m->>'overdue')::numeric), 0),
            'unbilled', sum((z.m->>'unbilled')::numeric), 'advanceRemaining', coalesce(sum((z.m->>'advanceRemaining')::numeric), 0))
          from (select app_private.finance_customer_contract_metrics(c.id) m from public.customer_contracts c where c.project_id = s.id) z))
        order by coalesce((select sum(x.amount) from tx x where x.project_id = s.id), 0) desc, s.code)
        from scope s left join ap a on a.project_id = s.id left join recv r on r.project_id = s.id), '[]'::jsonb),
      'companyPayable', (select jsonb_build_object('outstanding', coalesce(sum(r.outstanding), 0), 'docs', count(*))
        from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal and r.project_id is null),
      'receivables', (select jsonb_build_object('outstanding', coalesce(sum((z.m->>'outstanding')::numeric), 0), 'overdue', coalesce(sum((z.m->>'overdue')::numeric), 0),
          'unbilled', sum((z.m->>'unbilled')::numeric))
        from (select app_private.finance_customer_contract_metrics(c.id) m from public.customer_contracts c where coalesce(c.status, '') not in ('cancelled', 'draft')) z),
      'cash', (select jsonb_build_object('balance', fc->'start', 'known', fc->'known', 'accounts', fc->'accounts', 'lowest', fc->'lowest', 'lowestWeek', fc->'lowestWeek',
          'belowMinWeek', fc->'belowMinWeek', 'minBalance', fc->'minBalance') from (select app_private.finance_cash_forecast() fc) z),
      'advances', (select jsonb_build_object('remaining', coalesce(sum(x.remaining), 0),
          'overdue', coalesce(sum(x.remaining) filter (where not x.target_closed and x.repay_due_date < v_today), 0),
          'overdueCount', count(*) filter (where x.remaining > 0.004 and not x.target_closed and x.repay_due_date < v_today),
          'refundDue', coalesce(sum(x.remaining) filter (where x.target_closed), 0), 'refundDueCount', count(*) filter (where x.remaining > 0.004 and x.target_closed))
        from app_private.finance_advance_rows() x where x.remaining > 0.004)
    )
  );
end;
$function$;

-- Khai điều khoản thầu phụ cần danh sách đối tác: theo Cấu hình.
create or replace function public.get_finance_subcontract_v1(p_subcontract_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); c public.subcontractor_contracts%rowtype;
  v_record boolean := app_private.finance_can('record'); v_confirm boolean := app_private.finance_can('confirm'); v_item uuid := app_private.finance_sub_cost_item();
  v_budget jsonb;
begin
  select * into c from public.subcontractor_contracts where id = p_subcontract_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  if not (app_private.finance_can('view') or app_private.finance_project_visible(c.project_id)) then
    raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'; end if;
  if c.project_id is not null then
    select jsonb_build_object('item', b.item_name, 'budget', b.budget, 'projected', b.projected) into v_budget from app_private.finance_budget_check(c.project_id, v_item, 0, null) b;
  end if;
  return jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
    'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
    'contract', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'subcontractorName', c.subcontractor_name, 'taxCode', c.subcontractor_tax_code,
      'scopeOfWork', c.scope_of_work, 'projectId', c.project_id, 'projectCode', (select code from public.projects where id = c.project_id),
      'partnerId', c.partner_id, 'partner', (select jsonb_build_object('id', p.id, 'name', p.name, 'taxCode', p.tax_code, 'bankName', p.bank_name, 'bankAccount', p.bank_account)
        from public.business_partners p where p.id = c.partner_id),
      'value', c.value, 'status', c.status, 'signedDate', c.signed_date, 'completionDate', c.completion_date, 'retentionPercent', c.retention_percent,
      'vatPercent', c.vat_percent, 'advanceRecoveryPercent', c.advance_recovery_percent, 'paymentTermDays', c.payment_term_days, 'warrantyMonths', c.warranty_months,
      'withholdPit', c.withhold_pit, 'pitPercent', c.pit_percent),
    'metrics', app_private.finance_subcontract_metrics(c.id),
    'budget', v_budget,
    'manDays', (select jsonb_build_object('lines', count(*), 'people', coalesce(sum(coalesce(l.people_count, l.count)), 0), 'lastDate', max(dl.date))
      from public.daily_log_labor l join public.daily_logs dl on dl.id = l.daily_log_id where l.subcontract_id = c.id),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sequenceNo', r.sequence_no, 'kind', r.kind, 'periodStart', r.period_start, 'periodEnd', r.period_end,
        'description', r.description, 'cumulativeNet', r.cumulative_net, 'previousNet', r.previous_net, 'netAmount', r.net_amount, 'vatPercent', r.vat_percent,
        'vatAmount', r.vat_amount, 'gross', r.gross_amount, 'advanceRecovery', r.advance_recovery, 'retention', r.retention, 'pit', r.pit_amount,
        'otherDeduction', r.other_deduction, 'deductions', r.deductions, 'payable', r.payable, 'suggestedRecovery', r.suggested_recovery,
        'suggestedRetention', r.suggested_retention, 'suggestedPit', r.suggested_pit, 'adjustReason', r.adjust_reason, 'overContractReason', r.over_contract_reason,
        'status', r.status, 'submittedAt', r.submitted_at, 'returnReason', r.return_reason, 'returnedByName', app_private.finance_user_name(r.returned_by),
        'recognizedDate', r.recognized_date, 'recognizedByName', app_private.finance_user_name(r.recognized_by), 'dueDate', r.due_date,
        'retentionDueDate', r.retention_due_date, 'attachments', r.attachments, 'note', r.note, 'cancelReason', r.cancel_reason,
        'createdBy', r.created_by, 'createdByName', app_private.finance_user_name(r.created_by), 'createdAt', r.created_at, 'rowVersion', r.row_version,
        'paid', (select coalesce(sum(x.paid), 0) from app_private.finance_payable_rows() x where x.id in (r.payable_document_id, r.retention_document_id)),
        'outstanding', (select coalesce(sum(x.outstanding), 0) from app_private.finance_payable_rows() x where x.id = r.payable_document_id),
        'canEdit', v_record and r.status = 'draft' and r.kind = 'progress',
        'canSubmit', v_record and r.status = 'draft' and r.kind = 'progress',
        'canWithdraw', r.status = 'submitted' and r.created_by = v_actor,
        'canDecide', v_confirm and r.status = 'submitted' and r.created_by is distinct from v_actor,
        'canCancel', v_record and r.status in ('draft', 'submitted') and r.kind = 'progress',
        'canReverse', v_confirm and r.status = 'recognized' and r.kind = 'progress'
          and not exists (select 1 from public.finance_subcontract_rounds y where y.subcontract_id = r.subcontract_id and y.sequence_no > r.sequence_no and y.status = 'recognized'))
        order by r.sequence_no)
      from public.finance_subcontract_rounds r where r.subcontract_id = c.id), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'cutoverDate', o.cutover_date, 'cumulativeNet', o.cumulative_net, 'paidTotal', o.paid_total,
        'outstanding', o.outstanding, 'outstandingDueDate', o.outstanding_due_date, 'retentionHeld', o.retention_held, 'retentionDueDate', o.retention_due_date,
        'advanceRemaining', o.advance_remaining, 'note', o.note, 'attachments', o.attachments, 'status', o.status, 'createdBy', o.created_by,
        'createdByName', app_private.finance_user_name(o.created_by), 'createdAt', o.created_at, 'decidedByName', app_private.finance_user_name(o.decided_by),
        'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
        'canDecide', o.status = 'submitted' and v_confirm and o.created_by is distinct from v_actor,
        'canCancel', o.status = 'confirmed' and v_confirm) order by o.created_at desc)
      from public.finance_subcontract_openings o where o.subcontract_id = c.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'documentNo', x.document_no, 'sourceType', x.source_type,
        'documentDate', x.document_date, 'dueDate', x.due_date, 'recognized', x.recognized, 'paid', x.paid, 'outstanding', x.outstanding,
        'pendingExternal', x.pending_external, 'status', x.status) order by x.document_date, x.code)
      from app_private.finance_payable_rows() x join public.supplier_payable_documents d on d.id = x.id where d.subcontract_id = c.id), '[]'::jsonb),
    'advances', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'status', a.status, 'amount', a.amount, 'offset', a.offset_amount,
        'refunded', a.refunded, 'remaining', a.remaining, 'repayDueDate', a.repay_due_date, 'paidDate', a.paid_date) order by a.created_at)
      from app_private.finance_advance_rows() a join public.finance_payment_requests r on r.id = a.id where r.subcontract_id = c.id
        and r.status not in ('rejected', 'withdrawn', 'cancelled')), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', app_private.finance_user_name(e.actor_id), 'reason', e.reason,
        'payload', e.payload, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.finance_events where entity_type in ('subcontract_round', 'subcontract_opening', 'subcontract_terms')
        and payload->>'subcontractId' = c.id order by created_at desc limit 100) e), '[]'::jsonb),
    'partners', case when app_private.finance_can('configure') then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'taxCode', p.tax_code) order by p.name)
      from public.business_partners p where coalesce(p.is_active, true) and p.classifications && array['contractor', 'crew', 'supplier']::text[]), '[]'::jsonb) else '[]'::jsonb end);
end $function$;

-- Báo cáo Tài chính trong Trợ lý: số toàn công ty cho người có Cấu hình.
create or replace function public.assistant_report_finance_v1(p_from date, p_to date, p_group text DEFAULT 'month'::text, p_project_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_step interval; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_manage boolean;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_manage := app_private.finance_can('configure');
  v_step := ('1 ' || p_group)::interval;
  return (
    with tx as (
      select t.project_id, t.date, t.type, coalesce(nullif(t.category, ''), 'other') category, t.amount
      from public.project_transactions t
      where t.type in ('expense', 'revenue_received') and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
        and t.date >= to_char(p_from, 'YYYY-MM-DD') and t.date <= to_char(p_to, 'YYYY-MM-DD')
        and (p_project_id is null or t.project_id = p_project_id)
    ),
    buckets as (select b::date as b_start, (b + v_step)::date as b_end from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group, 'canManage', v_manage,
      'project', (select jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) from public.projects p where p.id = p_project_id),
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'in', (select coalesce(sum(amount), 0) from tx where type = 'revenue_received' and tx.date >= to_char(b.b_start, 'YYYY-MM-DD') and tx.date < to_char(b.b_end, 'YYYY-MM-DD')),
          'out', (select coalesce(sum(amount), 0) from tx where type = 'expense' and tx.date >= to_char(b.b_start, 'YYYY-MM-DD') and tx.date < to_char(b.b_end, 'YYYY-MM-DD'))
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'totalIn', (select coalesce(sum(amount), 0) from tx where type = 'revenue_received'),
      'totalOut', (select coalesce(sum(amount), 0) from tx where type = 'expense'),
      'byCategory', (select coalesce(jsonb_agg(jsonb_build_object('name', c.category, 'amount', c.amount) order by c.amount desc), '[]'::jsonb)
        from (select category, sum(amount) amount from tx where type = 'expense' group by 1 order by 2 desc limit 8) c),
      'byProject', (select coalesce(jsonb_agg(jsonb_build_object('code', coalesce(p.code, 'Khác'), 'in', c.inn, 'out', c.outt) order by c.outt desc), '[]'::jsonb)
        from (select project_id, sum(amount) filter (where type = 'revenue_received') inn, sum(amount) filter (where type = 'expense') outt from tx group by 1 order by 3 desc nulls last limit 8) c
        left join public.projects p on p.id = c.project_id),
      'payable', case when v_manage then (select jsonb_build_object('outstanding', coalesce(sum(r.outstanding), 0), 'overdue', coalesce(sum(r.outstanding) filter (where r.due_date < v_today), 0),
          'soon', coalesce(sum(r.outstanding) filter (where r.due_date >= v_today and r.due_date <= v_today + 7), 0), 'docs', count(*),
          'top', (select coalesce(jsonb_agg(jsonb_build_object('name', s.supplier_name, 'outstanding', s.o) order by s.o desc), '[]'::jsonb) from (
              select x.supplier_name, sum(x.outstanding) o from app_private.finance_payable_rows() x where x.outstanding > 0.5 and not x.internal and (p_project_id is null or x.project_id = p_project_id)
              group by 1 order by 2 desc limit 6) s))
        from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal and (p_project_id is null or r.project_id = p_project_id)) else null end
    ));
end $function$;

-- Dự báo dòng tiền toàn công ty và sửa tham số dự báo: theo Cấu hình.
create or replace function public.get_finance_forecast_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; s public.finance_settings%rowtype; v_project text := nullif(p_input->>'projectId', '');
  v_company boolean := app_private.finance_can('configure'); v_sc text := coalesce(nullif(p_input->>'scenario', ''), 'base'); v_delay integer; v_slip numeric;
  v_m0 date := date_trunc('month', v_today)::date; v_w0 date := date_trunc('week', v_today)::date; v_ev jsonb; v_rows jsonb; v_missing jsonb := '[]'::jsonb;
  v_start numeric; v_known boolean; v_accounts integer; v_pay record;
begin
  if v_sc not in ('base', 'safe', 'good') then raise exception using errcode = '22023', message = 'FINANCE_FORECAST_SCENARIO'; end if;
  if v_project is not null then
    if not exists (select 1 from public.projects where id = v_project) then raise exception using errcode = 'PT404', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
    if not (v_company or app_private.finance_project_visible(v_project)) then raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'; end if;
  elsif not v_company then raise exception using errcode = '42501', message = 'FINANCE_FORECAST_DENIED'; end if;
  select * into s from public.finance_settings where id = 1;
  v_delay := case v_sc when 'safe' then s.forecast_safe_delay_days when 'good' then -s.forecast_good_early_days else 0 end
    + coalesce(nullif(p_input->>'extraDelayDays', '')::integer, 0);
  v_slip := case when v_sc = 'safe' then s.forecast_safe_slip_percent else 0 end;
  v_ev := app_private.finance_forecast_events(v_delay, v_slip);
  with e as (select x.* from jsonb_to_recordset(v_ev) x(key text, dir text, conf text, project text, d date, amount numeric)
      where v_project is null or x.project = v_project),
    e2 as (select e.*, (extract(year from e.d)::integer * 12 + extract(month from e.d)::integer)
        - (extract(year from v_m0)::integer * 12 + extract(month from v_m0)::integer) mi, (e.d - v_w0) / 7 wi from e),
    k as (select distinct key, dir, conf, project from e2),
    g as (select k.key, k.dir, k.conf, k.project,
        (select array_agg(coalesce(b.v, 0) order by i) from generate_series(0, 5) i left join (select x.mi, sum(x.amount) v from e2 x
          where x.key = k.key and x.dir = k.dir and x.conf = k.conf and x.project is not distinct from k.project group by x.mi) b on b.mi = i) mo,
        (select array_agg(coalesce(b.v, 0) order by i) from generate_series(0, 12) i left join (select x.wi, sum(x.amount) v from e2 x
          where x.key = k.key and x.dir = k.dir and x.conf = k.conf and x.project is not distinct from k.project group by x.wi) b on b.wi = i) wk,
        (select sum(x.amount) from e2 x where x.key = k.key and x.dir = k.dir and x.conf = k.conf and x.project is not distinct from k.project and x.mi >= 6) beyond,
        (select count(*) from e2 x where x.key = k.key and x.dir = k.dir and x.conf = k.conf and x.project is not distinct from k.project) n
      from k)
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key || ':' || coalesce(g.project, 'company'), 'source', g.key, 'dir', g.dir, 'conf', g.conf,
      'projectId', g.project, 'projectCode', pr.code, 'months', to_jsonb(g.mo), 'weeks', to_jsonb(g.wk), 'beyond', coalesce(g.beyond, 0), 'count', g.n)
      order by g.dir, pr.code nulls last, g.key), '[]'::jsonb)
    into v_rows from g left join public.projects pr on pr.id = g.project;
  -- Số dư tiền hiện có (chỉ cho xem toàn công ty).
  select coalesce(sum(app_private.finance_cash_balance(f.id)), 0), count(*),
    bool_and(exists (select 1 from public.finance_cash_openings o where o.account_id = f.id and o.status = 'confirmed'))
    into v_start, v_accounts, v_known from public.cash_funds f where f.is_active;
  -- Việc cần khai để dự báo đủ.
  if v_project is null then
    if v_accounts = 0 then v_missing := v_missing || jsonb_build_object('code', 'cash_accounts', 'target', 'cash', 'text', 'Chưa khai tài khoản ngân hàng, tiền mặt — chưa biết tiền đang có.');
    elsif not v_known then v_missing := v_missing || jsonb_build_object('code', 'cash_openings', 'target', 'cash', 'text', 'Còn tài khoản tiền chưa chốt số dư đầu kỳ 30/09.'); end if;
    if not exists (select 1 from public.finance_cash_plans where is_active and direction = 'out') then
      v_missing := v_missing || jsonb_build_object('code', 'recurring', 'target', 'cash', 'text', 'Chưa khai chi phí định kỳ (thuê văn phòng, điện nước, bảo hiểm…).'); end if;
    if not exists (select 1 from public.finance_loans where is_active) then
      v_missing := v_missing || jsonb_build_object('code', 'loans', 'target', 'loans', 'text', 'Chưa khai khoản vay (nếu công ty không vay thì bỏ qua).'); end if;
    if not exists (select 1 from public.finance_cash_plans where is_active and direction = 'out' and category = 'tax')
      and not exists (select 1 from public.finance_forecast_items where is_active and direction = 'out' and category = 'tax') then
      v_missing := v_missing || jsonb_build_object('code', 'tax', 'target', 'items', 'text', 'Chưa khai thuế phải nộp (VAT, TNDN, TNCN) — thêm khoản dự kiến hoặc khoản định kỳ.'); end if;
    select h.year, h.month, count(*) n, bool_or(h.status = 'draft') draft into v_pay from public.hrm_payrolls h group by h.year, h.month order by h.year desc, h.month desc limit 1;
    if v_pay.n is null then v_missing := v_missing || jsonb_build_object('code', 'payroll', 'target', 'payroll', 'text', 'Chưa có bảng lương — chưa tính được tiền lương.');
    elsif v_pay.draft then v_missing := v_missing || jsonb_build_object('code', 'payroll_draft', 'target', 'payroll',
      'text', 'Lương lấy theo bảng lương tháng ' || v_pay.month || '/' || v_pay.year || ' còn nháp — duyệt bảng lương mới nhất để số chắc hơn.'); end if;
  end if;
  v_missing := v_missing || coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('code', 'no_gantt', 'projectId', p.id, 'target', 'project', 'text', p.code || ': chưa có tiến độ Gantt — chưa dự báo được thu, chi theo tiến độ.') x
      from public.projects p where exists (select 1 from public.customer_contracts cc where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft') and coalesce(cc.value, 0) > 0)
        and not exists (select 1 from public.project_tasks t where t.project_id = p.id) and (v_project is null or p.id = v_project)
    union all
    select jsonb_build_object('code', 'receivable_opening', 'projectId', cc.project_id, 'target', 'receivables', 'text', p.code || ' · ' || cc.code || ': chưa đối chiếu đầu kỳ phải thu — phần đã làm chưa thu đang là ước tính.')
      from public.customer_contracts cc join public.projects p on p.id = cc.project_id
      where coalesce(cc.status, '') not in ('cancelled', 'draft') and app_private.finance_customer_contract_metrics(cc.id)->>'opening' = 'todo' and (v_project is null or cc.project_id = v_project)
    union all
    select jsonb_build_object('code', 'material_budget', 'projectId', p.id, 'target', 'cost', 'text', p.code || ': chưa có dự toán vật tư — chưa dự báo được tiền mua vật tư còn lại.')
      from public.projects p where exists (select 1 from public.customer_contracts cc where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft') and coalesce(cc.value, 0) > 0)
        and exists (select 1 from public.project_tasks t where t.project_id = p.id)
        and app_private.finance_project_cost_summary(p.id)->>'materialBudget' is null and (v_project is null or p.id = v_project)
    union all
    select jsonb_build_object('code', 'no_subcontract', 'projectId', p.id, 'target', 'subcontracts', 'text', p.code || ': chưa có HĐ thầu phụ — nhân công đang ước theo ' || replace(to_char(s.forecast_labor_percent, 'FM990.0'), '.', ',') || '% giá trị HĐ.')
      from public.projects p where exists (select 1 from public.customer_contracts cc where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft') and coalesce(cc.value, 0) > 0)
        and not exists (select 1 from public.subcontractor_contracts sc where sc.project_id = p.id and coalesce(sc.status, '') not in ('cancelled', 'draft') and coalesce(sc.value, 0) > 0)
        and (v_project is null or p.id = v_project)
    union all
    select jsonb_build_object('code', 'subcontract_opening', 'projectId', p.id, 'target', 'subcontracts', 'text', p.code || ': ' || count(*) || ' HĐ thầu phụ chưa chốt đầu kỳ — phần còn phải trả đang tính cả khối lượng đã làm trước 01/10.')
      from public.subcontractor_contracts sc join public.projects p on p.id = sc.project_id
      where coalesce(sc.status, '') not in ('cancelled', 'draft') and coalesce(sc.value, 0) > 0 and app_private.finance_subcontract_metrics(sc.id)->>'opening' = 'todo'
        and (v_project is null or p.id = v_project) group by p.id, p.code
    union all
    select jsonb_build_object('code', 'stale_po', 'projectId', null, 'target', 'procurement', 'text', count(*) || ' đơn mua quá hẹn giao > 30 ngày (' || replace(to_char(round(sum(x.open_net) / 1e9, 2), 'FM999990.00'), '.', ',') || ' tỷ trước VAT) — Mua hàng "Kết thúc thiếu" đơn NCC không giao để bỏ khỏi dự báo.')
      from app_private.finance_po_commitments(v_project) x where x.stale and x.open_net > 0.5 having count(*) > 0
  ) q), '[]'::jsonb);
  return jsonb_build_object('today', v_today, 'scenario', v_sc, 'projectId', v_project, 'companyView', v_project is null,
    'months', (select jsonb_agg((v_m0 + make_interval(months => k))::date order by k) from generate_series(0, 5) k),
    'weeks', (select jsonb_agg(v_w0 + 7 * k order by k) from generate_series(0, 12) k),
    'params', jsonb_build_object('approvalDays', s.forecast_approval_days, 'payDays', s.forecast_pay_days, 'laborPercent', s.forecast_labor_percent,
      'materialVatPercent', s.forecast_material_vat_percent, 'safeDelayDays', s.forecast_safe_delay_days, 'safeSlipPercent', s.forecast_safe_slip_percent,
      'goodEarlyDays', s.forecast_good_early_days, 'delayDays', v_delay, 'slipPercent', v_slip, 'minBalance', s.cash_min_balance),
    'cash', case when v_project is null then jsonb_build_object('start', v_start, 'known', coalesce(v_known, false) and v_accounts > 0, 'accounts', v_accounts) end,
    'rows', v_rows, 'missing', v_missing,
    'can', jsonb_build_object('manage', app_private.finance_can('manage'), 'configure', v_company, 'record', app_private.finance_can('record')),
    'loans', case when v_project is null then coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lender', l.lender, 'contractNo', l.contract_no, 'projectId', l.project_id,
        'outstanding', l.outstanding, 'interestRate', l.interest_rate, 'repayKind', l.repay_kind, 'maturityDate', l.maturity_date, 'payDay', l.pay_day, 'note', l.note, 'active', l.is_active)
        order by l.is_active desc, l.maturity_date) from public.finance_loans l), '[]'::jsonb) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'direction', f.direction, 'name', f.name, 'category', f.category, 'projectId', f.project_id,
        'projectCode', pr.code, 'amount', f.amount, 'expectedDate', f.expected_date, 'confidence', f.confidence, 'note', f.note)
        order by f.expected_date) from public.finance_forecast_items f left join public.projects pr on pr.id = f.project_id
      where f.is_active and (v_project is null or f.project_id = v_project)), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code) from public.projects p
      where (v_project is null or p.id = v_project) and (exists (select 1 from public.customer_contracts cc where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft'))
        or exists (select 1 from public.finance_forecast_items f where f.project_id = p.id and f.is_active))), '[]'::jsonb));
end $function$;

-- Công tắc xem tài chính / hợp đồng dự án: Admin hoặc Quản trị Tài chính.
create or replace function public.set_project_sensitive_view_grant(p_user_id uuid, p_project_id text, p_domain text, p_enabled boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_grant_id uuid;
  v_changed boolean := false;
begin
  if not app_private.can_manage_project_sensitive_view() then
    raise exception 'SENSITIVE_VIEW_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_domain not in ('finance', 'contract') then
    raise exception 'SENSITIVE_VIEW_DOMAIN_INVALID' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'SENSITIVE_VIEW_REASON_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and is_active and account_status = 'ACTIVE') then
    raise exception 'SENSITIVE_VIEW_USER_INACTIVE' using errcode = '22023';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'SENSITIVE_VIEW_PROJECT_NOT_FOUND' using errcode = '22023';
  end if;

  if p_enabled then
    insert into public.project_sensitive_view_grants (project_id, user_id, domain, reason, granted_by)
    values (p_project_id, p_user_id, p_domain, btrim(p_reason), v_actor)
    on conflict ((coalesce(project_id, '*')), user_id, domain) where is_active do nothing
    returning id into v_grant_id;
    v_changed := v_grant_id is not null;
  else
    update public.project_sensitive_view_grants
    set is_active = false, revoked_by = v_actor, revoked_at = now(), revoke_reason = btrim(p_reason)
    where user_id = p_user_id and domain = p_domain and is_active
      and project_id is not distinct from p_project_id
    returning id into v_grant_id;
    v_changed := v_grant_id is not null;
  end if;

  if v_changed then
    insert into public.audit_trail (table_name, record_id, action, new_data, module, description)
    values (
      'project_sensitive_view_grants', v_grant_id::text,
      case when p_enabled then 'INSERT' else 'UPDATE' end,
      jsonb_build_object('userId', p_user_id, 'projectId', p_project_id, 'domain', p_domain, 'enabled', p_enabled),
      'DA',
      case when p_enabled then 'Mở quyền xem ' else 'Tắt quyền xem ' end
        || case when p_domain = 'finance' then 'tài chính' else 'hợp đồng' end
        || case when p_project_id is null then ' (tất cả dự án)' else ' dự án' end
        || ': ' || btrim(p_reason)
    );
  end if;

  return jsonb_build_object('changed', v_changed, 'grantId', v_grant_id);
end;
$function$;

-- Công tắc xem tài chính / hợp đồng dự án: Admin hoặc Quản trị Tài chính.
create or replace function public.list_project_sensitive_view_access(p_project_id text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, user_name text, user_email text, user_avatar text, is_system_admin boolean, in_project boolean, finance_project boolean, contract_project boolean, finance_all boolean, contract_all boolean, finance_room boolean, contract_manager boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not app_private.can_manage_project_sensitive_view() then
    raise exception 'SENSITIVE_VIEW_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  with people as (
    select staff.user_id::uuid as person_id, true as in_project
    from public.project_staff staff
    where p_project_id is not null and staff.project_id = p_project_id and staff.end_date is null
      and staff.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select grant_row.user_id, false
    from public.project_sensitive_view_grants grant_row
    where grant_row.is_active
      and (grant_row.project_id is null or grant_row.project_id = p_project_id)
  ), person as (
    select person_id, bool_or(in_project) as in_project from people group by person_id
  ), room as (
    select staff.user_id::uuid as person_id
    from public.project_permission_room_members member
    join public.project_permission_room_member_actions action
      on action.room_member_id = member.id and action.is_active
      and action.action_code in ('edit', 'submit', 'verify', 'approve', 'confirm')
    join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
    where p_project_id is not null and member.project_id = p_project_id and member.is_active
      and member.room_code in ('payment', 'quantity_acceptance')
      and staff.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select
    user_row.id,
    user_row.name,
    user_row.email,
    user_row.avatar,
    user_row.role = 'ADMIN',
    person.in_project,
    exists (select 1 from public.project_sensitive_view_grants g where g.user_id = user_row.id and g.is_active and g.domain = 'finance' and g.project_id = p_project_id),
    exists (select 1 from public.project_sensitive_view_grants g where g.user_id = user_row.id and g.is_active and g.domain = 'contract' and g.project_id = p_project_id),
    exists (select 1 from public.project_sensitive_view_grants g where g.user_id = user_row.id and g.is_active and g.domain = 'finance' and g.project_id is null),
    exists (select 1 from public.project_sensitive_view_grants g where g.user_id = user_row.id and g.is_active and g.domain = 'contract' and g.project_id is null),
    exists (select 1 from room where room.person_id = user_row.id),
    user_row.role = 'ADMIN'
      or app_private.has_permission(user_row.id, 'system.hd.manage', 'global', '*')
      or exists (
        select 1 from unnest(array[
          'contract.customer.manage', 'contract.supplier.manage', 'contract.partner.manage',
          'contract.cost_library.manage', 'system.tender_ai.manage'
        ]) as code(permission_code)
        where app_private.has_permission(user_row.id, code.permission_code, 'global', '*')
      )
  from person
  join public.users user_row on user_row.id = person.person_id
  where user_row.is_active and user_row.account_status = 'ACTIVE'
  order by person.in_project desc, user_row.name;
end;
$function$;

-- Công tắc xem tài chính / hợp đồng dự án: Admin hoặc Quản trị Tài chính.
create or replace function public.get_user_sensitive_view_summary(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user public.users%rowtype;
begin
  if not app_private.can_manage_project_sensitive_view() then
    raise exception 'SENSITIVE_VIEW_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select * into v_user from public.users where id = p_user_id;
  if v_user.id is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'isSystemAdmin', v_user.role = 'ADMIN',
    'financeAll', exists (select 1 from public.project_sensitive_view_grants g
      where g.user_id = p_user_id and g.is_active and g.domain = 'finance' and g.project_id is null),
    'contractAll', exists (select 1 from public.project_sensitive_view_grants g
      where g.user_id = p_user_id and g.is_active and g.domain = 'contract' and g.project_id is null),
    'financeProjectIds', coalesce((select jsonb_agg(distinct g.project_id order by g.project_id)
      from public.project_sensitive_view_grants g
      where g.user_id = p_user_id and g.is_active and g.domain = 'finance' and g.project_id is not null), '[]'::jsonb),
    'contractProjectIds', coalesce((select jsonb_agg(distinct g.project_id order by g.project_id)
      from public.project_sensitive_view_grants g
      where g.user_id = p_user_id and g.is_active and g.domain = 'contract' and g.project_id is not null), '[]'::jsonb),
    'roomProjectIds', coalesce((
      select jsonb_agg(distinct member.project_id order by member.project_id)
      from public.project_permission_room_members member
      join public.project_permission_room_member_actions action
        on action.room_member_id = member.id and action.is_active
       and action.action_code in ('edit', 'submit', 'verify', 'approve', 'confirm')
      join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
      where member.is_active
        and member.room_code in ('payment', 'quantity_acceptance')
        and staff.user_id = p_user_id::text), '[]'::jsonb),
    'contractManager', v_user.role = 'ADMIN'
      or app_private.has_permission(p_user_id, 'system.hd.manage', 'global', '*')
      or exists (
        select 1 from unnest(array[
          'contract.customer.manage', 'contract.supplier.manage', 'contract.partner.manage',
          'contract.cost_library.manage', 'system.tender_ai.manage'
        ]) as code(permission_code)
        where app_private.has_permission(p_user_id, code.permission_code, 'global', '*'))
  );
end;
$function$;

-- Phân quyền kho: Admin hoặc người có Quản trị Kho vật tư.
create or replace function public.save_wms_access_v1(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := 'Phân quyền kho (Kho vật tư → Phân quyền kho)';
  v_lines jsonb := '[]'::jsonb;
  v_added int := 0; v_removed int := 0;
  v_view_codes text[] := array['wms.inventory.view', 'wms.transaction.view', 'wms.request.view'];
  v_job_codes text[] := array['wms.transaction.keeper', 'wms.master_data.issue_code', 'wms.transaction.exception_approve', 'wms.accounting.manage',
    'wms.accounting.close_period', 'settings.warehouses.manage', 'wms.master_data.manage', 'wms.request.create'];
  v_legacy_codes text[] := array['wms.transaction.create', 'wms.transaction.approve', 'wms.transaction.complete', 'wms.inventory.edit',
    'wms.request.create', 'wms.request.approve', 'wms.request.export', 'wms.request.receive', 'wms.request.delete',
    'wms.material_issue.settle', 'wms.material_issue.reverse_settlement', 'wms.purchase_order.return_supplier', 'wms.transaction.reverse'];
  r record;
begin
  if v_actor is null or not app_private.wms_can_edit_access(v_actor) then raise exception using errcode = '42501', message = 'WMS_OWNERS_EDIT_DENIED'; end if;
  create temp table if not exists wms_access_want(code text, scope_type text, scope_id text, user_id uuid) on commit drop;
  create temp table if not exists wms_access_view(scope_type text, scope_id text, user_id uuid) on commit drop;
  create temp table if not exists wms_access_dropped(user_id uuid) on commit drop;
  delete from pg_temp.wms_access_want; delete from pg_temp.wms_access_view; delete from pg_temp.wms_access_dropped;

  -- Việc (đối chiếu đủ): Thủ kho theo kho, Cấp mã, Duyệt ngoại lệ, Kế toán kho, Khóa kỳ, Đề xuất mã, Quản lý danh sách kho.
  insert into pg_temp.wms_access_want
    select 'wms.transaction.keeper', 'warehouse', k.key, (u.value #>> '{}')::uuid
    from jsonb_each(coalesce(p->'keepers', '{}'::jsonb)) k cross join lateral jsonb_array_elements(k.value) u;
  insert into pg_temp.wms_access_want select 'wms.master_data.issue_code', 'global', '*', (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'code', '[]'::jsonb)) x;
  insert into pg_temp.wms_access_want select 'wms.transaction.exception_approve', 'global', '*', (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'exception', '[]'::jsonb)) x;
  insert into pg_temp.wms_access_want select 'wms.accounting.manage', 'global', '*', (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'accounting', '[]'::jsonb)) x;
  insert into pg_temp.wms_access_want select 'wms.request.create', 'global', '*', (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'propose', '[]'::jsonb)) x;
  insert into pg_temp.wms_access_want select c, 'global', '*', (x #>> '{}')::uuid
    from jsonb_array_elements(coalesce(p->'whAdmin', '[]'::jsonb)) x cross join unnest(array['settings.warehouses.manage', 'wms.master_data.manage']) c;
  if nullif(p->>'closer', '') is not null then
    if not exists (select 1 from pg_temp.wms_access_want where code = 'wms.accounting.manage' and user_id = (p->>'closer')::uuid) then
      raise exception using errcode = '22023', message = 'WMS_OWNERS_CLOSER_NOT_ACCOUNTANT'; end if;
    insert into pg_temp.wms_access_want values ('wms.accounting.close_period', 'global', '*', (p->>'closer')::uuid);
  end if;

  -- Xem kho: mọi kho / từng kho. Cấp mã, Duyệt ngoại lệ, Kế toán kho tự kèm Xem mọi kho.
  insert into pg_temp.wms_access_view select 'global', '*', (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'viewAll', '[]'::jsonb)) x;
  insert into pg_temp.wms_access_view select 'global', '*', w.user_id from pg_temp.wms_access_want w
    where w.code in ('wms.master_data.issue_code', 'wms.transaction.exception_approve', 'wms.accounting.manage');
  insert into pg_temp.wms_access_view
    select 'warehouse', k.key, (u.value #>> '{}')::uuid
    from jsonb_each(coalesce(p->'viewWh', '{}'::jsonb)) k cross join lateral jsonb_array_elements(k.value) u
    where not exists (select 1 from pg_temp.wms_access_view v where v.scope_type = 'global' and v.user_id = (u.value #>> '{}')::uuid);

  if exists (select 1 from (select scope_type, scope_id from pg_temp.wms_access_want union all select scope_type, scope_id from pg_temp.wms_access_view) w
      where w.scope_type = 'warehouse' and not exists (select 1 from public.warehouses x where x.id = w.scope_id and not coalesce(x.is_archived, false))) then
    raise exception using errcode = '22023', message = 'WMS_OWNERS_WAREHOUSE_INVALID'; end if;
  if exists (select 1 from (select user_id from pg_temp.wms_access_want union all select user_id from pg_temp.wms_access_view) w
      where not exists (select 1 from public.users u where u.id = w.user_id and coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE')) then
    raise exception using errcode = '22023', message = 'WMS_OWNERS_USER_INVALID'; end if;

  -- Bộ Xem kho: thêm cho người được xem; ai đang xem (theo ô wms.inventory.view) mà không còn trong danh sách thì gỡ bộ Xem ở phạm vi đó.
  insert into pg_temp.wms_access_want select c, v.scope_type, v.scope_id, v.user_id from pg_temp.wms_access_view v cross join unnest(v_view_codes) c;
  -- Ô vào phân hệ Kho (system.wms.view, chỉ phạm vi toàn công ty): mọi người có việc hoặc được xem.
  insert into pg_temp.wms_access_want select distinct 'system.wms.view', 'global', '*', w.user_id from pg_temp.wms_access_want w;

  -- 1) Gỡ.
  for r in select g.id, g.user_id, g.permission_code, g.scope_type, g.scope_id from public.user_permission_grants g
    where g.is_active and g.revoked_at is null and (
      -- việc: đối chiếu đủ (ô Đề xuất mã chỉ phạm vi toàn công ty; ô theo kho cũ xử lý ở danh sách gỡ lẻ)
      (g.permission_code = any(v_job_codes) and not (g.permission_code in ('wms.request.create', 'wms.master_data.manage') and g.scope_type <> 'global')
        and not exists (select 1 from pg_temp.wms_access_want w where w.code = g.permission_code and w.scope_type = g.scope_type and w.scope_id = g.scope_id and w.user_id = g.user_id))
      -- xem: chỉ gỡ ở phạm vi người đó đang có ô Xem tồn mà nay bị bỏ
      or (g.permission_code = any(v_view_codes) and g.scope_type in ('global', 'warehouse')
        and exists (select 1 from public.user_permission_grants a where a.is_active and a.revoked_at is null and a.permission_code = 'wms.inventory.view'
          and a.user_id = g.user_id and a.scope_type = g.scope_type and a.scope_id = g.scope_id)
        and not exists (select 1 from pg_temp.wms_access_view v where v.user_id = g.user_id and v.scope_type = g.scope_type and v.scope_id = g.scope_id))
      -- ô lẻ kiểu cũ Admin chọn gỡ
      or (g.permission_code = any(v_legacy_codes) and exists (select 1 from jsonb_array_elements(coalesce(p->'revoke', '[]'::jsonb)) x
        where (x->>'userId')::uuid = g.user_id and x->>'code' = g.permission_code and x->>'scopeType' = g.scope_type and x->>'scopeId' = g.scope_id)))
  loop
    update public.user_permission_grants set is_active = false, revoked_at = now(), revoked_by = v_actor, revoked_reason = v_reason, updated_at = now() where id = r.id;
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, r.user_id, 'direct_permission_grants_changed',
      jsonb_build_array(jsonb_build_object('permission_code', r.permission_code, 'scope_type', r.scope_type, 'scope_id', r.scope_id)), '[]'::jsonb,
      jsonb_build_object('reason', v_reason, 'source', 'wms_owners_item'));
    v_removed := v_removed + 1;
    v_lines := v_lines || to_jsonb('− ' || (select name from public.users where id = r.user_id) || ' — ' || r.permission_code
      || case when r.scope_type = 'warehouse' then ' @ ' || coalesce((select name from public.warehouses where id = r.scope_id), r.scope_id) else '' end);
    if r.permission_code = 'wms.inventory.view' then insert into pg_temp.wms_access_dropped values (r.user_id); end if;
  end loop;
  -- Người vừa bị bỏ Xem kho mà không còn việc / quyền kho nào: gỡ luôn ô vào phân hệ Kho.
  for r in select g.id, g.user_id, g.permission_code, g.scope_type, g.scope_id from public.user_permission_grants g
    where g.is_active and g.revoked_at is null and g.permission_code = 'system.wms.view'
      and g.user_id in (select user_id from pg_temp.wms_access_dropped)
      and not exists (select 1 from pg_temp.wms_access_want w where w.user_id = g.user_id)
      and not exists (select 1 from public.user_permission_grants o where o.user_id = g.user_id and o.is_active and o.revoked_at is null and o.permission_code like 'wms.%')
  loop
    update public.user_permission_grants set is_active = false, revoked_at = now(), revoked_by = v_actor, revoked_reason = v_reason, updated_at = now() where id = r.id;
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, r.user_id, 'direct_permission_grants_changed',
      jsonb_build_array(jsonb_build_object('permission_code', r.permission_code, 'scope_type', r.scope_type, 'scope_id', r.scope_id)), '[]'::jsonb,
      jsonb_build_object('reason', v_reason, 'source', 'wms_owners_item'));
    v_removed := v_removed + 1;
    v_lines := v_lines || to_jsonb('− ' || (select name from public.users where id = r.user_id) || ' — system.wms.view');
  end loop;
  -- 2) Cấp.
  for r in select distinct w.* from pg_temp.wms_access_want w
    where not exists (select 1 from public.user_permission_grants g where g.is_active and g.revoked_at is null and g.permission_code = w.code
      and g.scope_type = w.scope_type and g.scope_id = w.scope_id and g.user_id = w.user_id)
  loop
    -- Dòng đã thu hồi trước đây (cùng người / ô / phạm vi) thì kích hoạt lại, không thêm dòng mới.
    insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_by, grant_reason)
    values (r.user_id, r.code, r.scope_type, r.scope_id, true, v_actor, v_reason)
    on conflict (user_id, permission_code, scope_type, scope_id) do update set is_active = true, revoked_at = null, revoked_by = null, revoked_reason = null,
      expires_at = null, granted_by = excluded.granted_by, granted_at = now(), grant_reason = excluded.grant_reason, updated_at = now();
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, r.user_id, 'direct_permission_grants_changed', '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('permission_code', r.code, 'scope_type', r.scope_type, 'scope_id', r.scope_id)),
      jsonb_build_object('reason', v_reason, 'source', 'wms_owners_item'));
    v_added := v_added + 1;
    v_lines := v_lines || to_jsonb('+ ' || (select name from public.users where id = r.user_id) || ' — ' || r.code
      || case when r.scope_type = 'warehouse' then ' @ ' || coalesce((select name from public.warehouses where id = r.scope_id), r.scope_id) else '' end);
  end loop;
  if v_added + v_removed > 0 then
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, v_actor, 'direct_permission_grants_changed', '[]'::jsonb, '[]'::jsonb, jsonb_build_object('reason', v_reason, 'source', 'wms_owners', 'lines', v_lines));
  end if;
  return jsonb_build_object('added', v_added, 'removed', v_removed, 'lines', v_lines);
end $function$;

-- Phân quyền kho: Admin hoặc người có Quản trị Kho vật tư.
create or replace function public.save_wms_owners_v1(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := 'Người phụ trách kho (Kho vật tư → Thiết lập)';
  v_lines jsonb := '[]'::jsonb;
  v_added int := 0; v_removed int := 0;
  r record;
begin
  if v_actor is null or not app_private.wms_can_edit_access(v_actor) then raise exception using errcode = '42501', message = 'WMS_OWNERS_EDIT_DENIED'; end if;
  create temp table if not exists wms_owner_want(code text, scope_type text, scope_id text, user_id uuid) on commit drop;
  delete from pg_temp.wms_owner_want;
  insert into pg_temp.wms_owner_want
    select 'wms.transaction.keeper', 'warehouse', k.key, (u.value #>> '{}')::uuid
    from jsonb_each(coalesce(p->'keepers', '{}'::jsonb)) k cross join lateral jsonb_array_elements(k.value) u;
  insert into pg_temp.wms_owner_want select 'wms.master_data.issue_code', 'global', '*', (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'code', '[]'::jsonb)) x;
  insert into pg_temp.wms_owner_want select 'wms.transaction.exception_approve', 'global', '*', (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'exception', '[]'::jsonb)) x;
  insert into pg_temp.wms_owner_want select 'wms.accounting.manage', 'global', '*', (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'accounting', '[]'::jsonb)) x;
  if nullif(p->>'closer', '') is not null then
    if not exists (select 1 from pg_temp.wms_owner_want where code = 'wms.accounting.manage' and user_id = (p->>'closer')::uuid) then
      raise exception using errcode = '22023', message = 'WMS_OWNERS_CLOSER_NOT_ACCOUNTANT'; end if;
    insert into pg_temp.wms_owner_want values ('wms.accounting.close_period', 'global', '*', (p->>'closer')::uuid);
  end if;
  if exists (select 1 from pg_temp.wms_owner_want w where w.scope_type = 'warehouse' and not exists (select 1 from public.warehouses x where x.id = w.scope_id and not coalesce(x.is_archived, false))) then
    raise exception using errcode = '22023', message = 'WMS_OWNERS_WAREHOUSE_INVALID'; end if;
  if exists (select 1 from pg_temp.wms_owner_want w where not exists (select 1 from public.users u where u.id = w.user_id and coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE')) then
    raise exception using errcode = '22023', message = 'WMS_OWNERS_USER_INVALID'; end if;

  -- Gỡ quyền không còn trong danh sách (chỉ 5 ô do màn này quản; ô Thủ kho "mọi kho" cũ cũng gỡ).
  for r in select g.id, g.user_id, g.permission_code, g.scope_type, g.scope_id from public.user_permission_grants g
    where g.is_active and g.revoked_at is null
      and g.permission_code in ('wms.transaction.keeper', 'wms.master_data.issue_code', 'wms.transaction.exception_approve', 'wms.accounting.manage', 'wms.accounting.close_period')
      and not exists (select 1 from pg_temp.wms_owner_want w where w.code = g.permission_code and w.scope_type = g.scope_type and w.scope_id = g.scope_id and w.user_id = g.user_id)
  loop
    update public.user_permission_grants set is_active = false, revoked_at = now(), revoked_by = v_actor, revoked_reason = v_reason, updated_at = now() where id = r.id;
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, r.user_id, 'direct_permission_grants_changed',
      jsonb_build_array(jsonb_build_object('permission_code', r.permission_code, 'scope_type', r.scope_type, 'scope_id', r.scope_id)), '[]'::jsonb,
      jsonb_build_object('reason', v_reason, 'source', 'wms_owners_item'));
    v_removed := v_removed + 1;
    v_lines := v_lines || to_jsonb('− ' || (select name from public.users where id = r.user_id) || ' — ' || r.permission_code
      || case when r.scope_type = 'warehouse' then ' @ ' || coalesce((select name from public.warehouses where id = r.scope_id), r.scope_id) else '' end);
  end loop;
  -- Cấp quyền mới.
  for r in select distinct w.* from pg_temp.wms_owner_want w
    where not exists (select 1 from public.user_permission_grants g where g.is_active and g.revoked_at is null and g.permission_code = w.code
      and g.scope_type = w.scope_type and g.scope_id = w.scope_id and g.user_id = w.user_id)
  loop
    insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_by, grant_reason)
    values (r.user_id, r.code, r.scope_type, r.scope_id, true, v_actor, v_reason);
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, r.user_id, 'direct_permission_grants_changed', '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('permission_code', r.code, 'scope_type', r.scope_type, 'scope_id', r.scope_id)),
      jsonb_build_object('reason', v_reason, 'source', 'wms_owners_item'));
    v_added := v_added + 1;
    v_lines := v_lines || to_jsonb('+ ' || (select name from public.users where id = r.user_id) || ' — ' || r.code
      || case when r.scope_type = 'warehouse' then ' @ ' || coalesce((select name from public.warehouses where id = r.scope_id), r.scope_id) else '' end);
  end loop;
  -- Một dòng nhật ký tổng cho màn Người phụ trách.
  if v_added + v_removed > 0 then
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, v_actor, 'direct_permission_grants_changed', '[]'::jsonb, '[]'::jsonb, jsonb_build_object('reason', v_reason, 'source', 'wms_owners', 'lines', v_lines));
  end if;
  return jsonb_build_object('added', v_added, 'removed', v_removed, 'lines', v_lines);
end $function$;

-- Màn Phân quyền kho mở chế độ sửa theo cùng quy tắc.
create or replace function public.get_wms_access_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not (public.is_admin() or app_private.wms_has_action('wms.inventory.view') or exists (
      select 1 from public.user_permission_grants g where g.user_id = v_actor and g.is_active and g.revoked_at is null and g.permission_code like 'wms.%')) then
    raise exception using errcode = '42501', message = 'WMS_OWNERS_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'can', jsonb_build_object('edit', app_private.wms_can_edit_access(v_actor)),
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'type', w.type,
        'project', (select p.code from public.projects p where p.id::text = w.project_id)) order by w.name)
      from public.warehouses w where not coalesce(w.is_archived, false) and w.type <> 'G3_TEST'), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role,
        'position', (select p.name from public.employees em join public.hrm_positions p on p.id::text = em.position_id::text where em.user_id = u.id limit 1)) order by u.name)
      from public.users u where coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('userId', g.user_id, 'code', g.permission_code, 'scopeType', g.scope_type, 'scopeId', g.scope_id))
      from public.user_permission_grants g join public.users u on u.id = g.user_id
      where g.is_active and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()) and coalesce(u.is_active, true)
        and (g.permission_code like 'wms.%' or g.permission_code = 'settings.warehouses.manage')), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('userId', x.requester_id, 'warehouseId', x.wh, 'n', x.n)) from (
        select t.requester_id, coalesce(t.target_warehouse_id, t.source_warehouse_id) wh, count(*) n from public.transactions t
        where t.date >= now() - interval '60 days' and t.requester_id is not null group by 1, 2) x), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'by', (select name from public.users where id = e.actor_user_id),
        'lines', e.metadata->'lines') order by e.created_at desc)
      from (select * from public.permission_audit_events where metadata->>'source' = 'wms_owners' and target_user_id = actor_user_id
        order by created_at desc limit 20) e), '[]'::jsonb));
end $function$;

-- Màn Phân quyền kho mở chế độ sửa theo cùng quy tắc.
create or replace function public.get_wms_owners_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not (public.is_admin() or app_private.wms_has_action('wms.inventory.view') or exists (
      select 1 from public.user_permission_grants g where g.user_id = v_actor and g.is_active and g.revoked_at is null and g.permission_code like 'wms.%')) then
    raise exception using errcode = '42501', message = 'WMS_OWNERS_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'can', jsonb_build_object('edit', app_private.wms_can_edit_access(v_actor)),
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'type', w.type,
        'project', (select p.code from public.projects p where p.id::text = w.project_id)) order by w.name)
      from public.warehouses w where not coalesce(w.is_archived, false) and w.type <> 'G3_TEST'), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'assignedWarehouseId', u.assigned_warehouse_id) order by u.name)
      from public.users u where coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('userId', g.user_id, 'code', g.permission_code, 'scopeType', g.scope_type, 'scopeId', g.scope_id))
      from public.user_permission_grants g join public.users u on u.id = g.user_id
      where g.is_active and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()) and coalesce(u.is_active, true)
        and g.permission_code in ('wms.transaction.keeper', 'wms.master_data.issue_code', 'wms.transaction.exception_approve', 'wms.accounting.manage',
          'wms.accounting.close_period', 'wms.transaction.create', 'wms.transaction.approve', 'wms.transaction.complete', 'wms.inventory.edit')), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('userId', x.requester_id, 'warehouseId', x.wh, 'n', x.n)) from (
        select t.requester_id, coalesce(t.target_warehouse_id, t.source_warehouse_id) wh, count(*) n from public.transactions t
        where t.date >= now() - interval '60 days' and t.requester_id is not null group by 1, 2) x), '[]'::jsonb),
    'viewers', (select count(distinct g.user_id) from public.user_permission_grants g where g.is_active and g.revoked_at is null and g.permission_code = 'wms.inventory.view'),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'by', (select name from public.users where id = e.actor_user_id),
        'lines', e.metadata->'lines') order by e.created_at desc)
      from (select * from public.permission_audit_events where metadata->>'source' = 'wms_owners' and target_user_id = actor_user_id
        order by created_at desc limit 20) e), '[]'::jsonb));
end $function$;

-- Màn Trách nhiệm liệt kê thêm người có Cấu hình.
create or replace function public.get_finance_settings_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_set public.finance_settings%rowtype; v_version public.finance_approval_matrix_versions%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  select * into v_version from public.finance_approval_matrix_versions where is_current;
  return jsonb_build_object('can', app_private.finance_can_flags(),
    'settings', jsonb_build_object('defaultPaymentDays', v_set.default_payment_days, 'cutoverDate', v_set.ap_cutover_date,
      'rowVersion', v_set.row_version, 'updatedAt', v_set.updated_at, 'updatedByName', app_private.finance_user_name(v_set.updated_by),
      'advanceWarnPercent', v_set.advance_warn_percent, 'advanceExtraPercent', v_set.advance_extra_percent,
      'advanceExtraApproverIds', to_jsonb(v_set.advance_extra_approver_ids), 'advanceGraceDays', v_set.advance_repay_grace_days, 'cashMinBalance', v_set.cash_min_balance,
      'budgetWarnPercent', v_set.budget_warn_percent, 'budgetApproverIds', to_jsonb(v_set.budget_extra_approver_ids), 'capitalProviderIds', to_jsonb(v_set.capital_provider_ids)),
    'matrix', jsonb_build_object('id', v_version.id, 'versionNo', v_version.version_no, 'note', v_version.note,
      'createdAt', v_version.created_at, 'createdByName', app_private.finance_user_name(v_version.created_by),
      'rules', coalesce((select jsonb_agg(jsonb_build_object('tierNo', r.tier_no, 'minAmount', r.min_amount, 'maxAmount', r.max_amount,
          'steps', (select jsonb_agg(jsonb_build_object('label', s.value->>'label',
              'approvers', (select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'active', coalesce(u.is_active, true)))
                from jsonb_array_elements_text(s.value->'approverIds') a join public.users u on u.id = a::uuid)) order by s.ordinality)
            from jsonb_array_elements(r.steps) with ordinality s)) order by r.tier_no)
        from public.finance_approval_rules r where r.version_id = v_version.id), '[]'::jsonb)),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('versionNo', v.version_no, 'note', v.note, 'createdAt', v.created_at,
        'createdByName', app_private.finance_user_name(v.created_by), 'current', v.is_current) order by v.version_no desc)
      from public.finance_approval_matrix_versions v), '[]'::jsonb),
    'delegations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'fromUserId', d.from_user_id, 'fromName', app_private.finance_user_name(d.from_user_id),
        'toUserId', d.to_user_id, 'toName', app_private.finance_user_name(d.to_user_id), 'validFrom', d.valid_from, 'validTo', d.valid_to,
        'reason', d.reason, 'createdByName', app_private.finance_user_name(d.created_by), 'revokedAt', d.revoked_at, 'revokeReason', d.revoke_reason)
        order by d.valid_from desc) from public.finance_approval_delegations d), '[]'::jsonb),
    'responsibilities', (select jsonb_object_agg(a.x, (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'admin', u.role = 'ADMIN') order by u.name), '[]'::jsonb)
        from public.users u where coalesce(u.is_active, true) and u.account_status = 'ACTIVE'
          and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.finance.' || a.x))))
      from unnest(array['view', 'record', 'confirm', 'configure', 'manage']) a(x)),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where coalesce(u.is_active, true) and u.account_status = 'ACTIVE'), '[]'::jsonb));
end;
$function$;

-- Cấu hình Tài chính cho chị Hương (kế toán trưởng) và anh Chuẩn (GĐ tài chính).
insert into public.user_permission_grants as g (user_id, permission_code, scope_type, scope_id, is_active, granted_at, grant_reason, created_at, updated_at)
select u.id, 'system.finance.configure', 'global', '*', true, now(), 'Đợt 2a-1 audit mẫu quyền 23/10/2026: Cấu hình Tài chính', now(), now()
from public.users u
where u.is_active and u.account_status = 'ACTIVE'
  and u.email in ('huongnt@tienthinhjsc.vn', 'chuanhd@tienthinhjsc.vn') -- Nguyễn Thị Hương, Hà Đức Chuẩn
on conflict (user_id, permission_code, scope_type, scope_id) do update
set is_active = true, revoked_at = null, revoked_by = null, revoked_reason = null,
    granted_at = now(), expires_at = null, grant_reason = excluded.grant_reason, updated_at = now();

notify pgrst, 'reload schema';
