-- V1-2 Module Vật tư: Người phụ trách kho — 4 việc theo ô quyền, không còn theo vai trò tài khoản.
-- Luật nghiệp vụ (chủ sản phẩm chốt 03/10/2026, docs/designs/project-closed-loop-2026-09-30/13-module-vat-tu-ra-soat.md mục 14):
--  1. Thủ kho = ô quyền "Giao dịch kho → Thủ kho" (wms.transaction.keeper) theo từng kho. Một kho nhiều thủ kho, một người nhiều kho.
--     Mọi chỗ trước đây dựa vai trò WAREHOUSE_KEEPER + kho được gán nay dựa ô quyền này (vai trò cũ không còn tác dụng với kho).
--  2. Duyệt ngoại lệ (wms.transaction.exception_approve): duyệt xuất hủy, phiếu điều chỉnh, chênh lệch kiểm kê. Admin luôn có.
--     Tách nhiệm: người duyệt phiếu xuất hủy / điều chỉnh phải khác người lập (áp dụng cả Admin).
--  3. Kế toán kho (wms.accounting.manage) và Khóa kỳ (wms.accounting.close_period, một người) — dùng ở V3.
--  4. Màn Người phụ trách: ai xem được kho đều xem; chỉ Admin sửa. Lưu một lần, ghi nhật ký phân quyền (source = wms_owners).

-- ---------------------------------------------------------------------------------------------
-- 1. Ô quyền mới
-- ---------------------------------------------------------------------------------------------
insert into public.permission_modules (application_code, code, name, description, routes, legacy_module_key, sort_order, is_active)
values ('wms', 'wms.accounting', 'Kế toán kho', 'Giá kho, đảo phiếu, khóa kỳ, kết xuất MISA', array[]::text[], 'WMS', 45, true)
on conflict (code) do nothing;

insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes, legacy_module_key,
  legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code, direct_grant_allowed)
values
  ('wms.transaction', 'keeper', 'wms.transaction.keeper', 'Thủ kho', 'Nhập, xuất, gửi/nhận chuyển kho, đếm kiểm kê ở kho được giao',
    array['global', 'warehouse'], 'WMS', '/operations', false, 60, true, 'important', true, false, false, 'enforced', 'wms', true),
  ('wms.transaction', 'exception_approve', 'wms.transaction.exception_approve', 'Duyệt ngoại lệ', 'Duyệt xuất hủy, phiếu điều chỉnh, chênh lệch kiểm kê, tồn đầu kỳ',
    array['global', 'warehouse'], 'WMS', '/operations', false, 70, true, 'sensitive', false, true, false, 'enforced', 'wms', true),
  ('wms.accounting', 'manage', 'wms.accounting.manage', 'Kế toán kho', 'Bổ sung giá, đảo phiếu, kết xuất MISA',
    array['global'], 'WMS', '/reports', false, 10, true, 'sensitive', true, false, false, 'enforced', 'wms', true),
  ('wms.accounting', 'close_period', 'wms.accounting.close_period', 'Khóa kỳ', 'Khóa kỳ kho theo tháng',
    array['global'], 'WMS', '/reports', false, 20, true, 'sensitive', false, true, false, 'enforced', 'wms', true)
on conflict (permission_code) do nothing;

-- Người dùng có ô Thủ kho ở kho p_warehouse_id (ô "mọi kho" cũng tính).
create function app_private.wms_user_is_keeper(p_user_id uuid, p_warehouse_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and p_warehouse_id is not null
    and app_private.has_permission(p_user_id, 'wms.transaction.keeper', 'warehouse', p_warehouse_id);
$$;

create function app_private.wms_user_can_approve_exception(p_user_id uuid, p_warehouse_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    exists (select 1 from public.users u where u.id = p_user_id and u.role = 'ADMIN' and coalesce(u.is_active, true))
    or app_private.has_permission(p_user_id, 'wms.transaction.exception_approve', 'global', '*')
    or (p_warehouse_id is not null and app_private.has_permission(p_user_id, 'wms.transaction.exception_approve', 'warehouse', p_warehouse_id)));
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Vá các hàm đang dựa vai trò WAREHOUSE_KEEPER (định nghĩa lấy từ production, vá từng đoạn)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.current_user_is_wms_keeper_for(p_warehouse_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- V1-2: thủ kho theo ô quyền wms.transaction.keeper, không theo vai trò.
  select app_private.wms_user_is_keeper(public.current_app_user_id(), p_warehouse_id);
$function$;

CREATE OR REPLACE FUNCTION app_private.current_user_is_global_wms_keeper()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- V1-2: thủ kho "mọi kho" = ô Thủ kho phạm vi toàn công ty.
  select app_private.has_permission(public.current_app_user_id(), 'wms.transaction.keeper', 'global', '*');
$function$;

CREATE OR REPLACE FUNCTION app_private.wms_warehouse_keepers(p_warehouse_id text)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id from public.users u
  where coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
    and app_private.wms_user_is_keeper(u.id, p_warehouse_id); -- V1-2: theo ô quyền Thủ kho
$function$;

CREATE OR REPLACE FUNCTION app_private.wms_user_has_action(p_user_id uuid, p_permission_code text, p_source_warehouse_id text DEFAULT NULL::text, p_target_warehouse_id text DEFAULT NULL::text, p_include_legacy_admin boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    app_private.wms_has_canonical_action(p_permission_code, p_source_warehouse_id, p_target_warehouse_id, null, null, p_user_id)
    or (
      p_permission_code <> 'wms.transaction.reverse'
      and exists (
        select 1 from public.permission_actions action_row
        where action_row.permission_code = p_permission_code and action_row.permission_code like 'wms.%' and action_row.is_active
      )
      and exists (
        select 1 from public.users user_row
        where user_row.id = p_user_id and coalesce(user_row.is_active, true)
          and (
            user_row.role = 'ADMIN'
            or (p_include_legacy_admin and app_private.has_permission(user_row.id, 'system.wms.manage', 'global', '*'))
            -- V1-2: thủ kho theo ô quyền (mọi kho hoặc kho nguồn / đích)
            or app_private.has_permission(user_row.id, 'wms.transaction.keeper', 'global', '*')
            or app_private.wms_user_is_keeper(user_row.id, p_source_warehouse_id)
            or app_private.wms_user_is_keeper(user_row.id, p_target_warehouse_id)
          )
      )
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.can_read_inventory_scope(p_warehouse_id text, p_created_by uuid, p_approved_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    app_private.wms_has_action(
      'wms.inventory.view', p_warehouse_id, null, p_created_by, p_approved_by
    )
    or p_created_by = public.current_app_user_id()
    or p_approved_by = public.current_app_user_id()
    -- V1-2: thủ kho theo ô quyền
    or case when p_warehouse_id is null
      then app_private.has_permission(public.current_app_user_id(), 'wms.transaction.keeper', 'global', '*')
      else app_private.wms_user_is_keeper(public.current_app_user_id(), p_warehouse_id) end;
$function$;

CREATE OR REPLACE FUNCTION app_private.current_user_can_receive_purchase_batch_v2(p_actor_user_id uuid, p_target_warehouse_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_target_warehouse_id)
    or app_private.wms_has_action(
      'wms.transaction.approve', null, p_target_warehouse_id,
      null, null, p_actor_user_id
    )
    or app_private.wms_has_action(
      'wms.transaction.complete', null, p_target_warehouse_id,
      null, null, p_actor_user_id
    )
    or exists (
      select 1
      from public.users u
      where u.id = p_actor_user_id
        and u.is_active is not false
        and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
        and u.role::text = 'ADMIN'
    )
    or app_private.wms_user_is_keeper(p_actor_user_id, p_target_warehouse_id), -- V1-2: thủ kho theo ô quyền
    false
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.stock_count_can_approve()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.current_app_user_id() is not null and (public.is_admin() or public.is_module_admin('WMS')
    or app_private.wms_user_can_approve_exception(public.current_app_user_id(), null)) -- V1-2: Duyệt ngoại lệ;
$function$;

CREATE OR REPLACE FUNCTION public.process_transaction_status(p_transaction_id text, p_status transaction_status, p_approver_id uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_item_id text;
  v_qty integer;
  v_can_approve boolean := false;
  v_can_complete boolean := false;
begin
  if p_status is null or p_status not in (
    'APPROVED'::public.transaction_status,
    'COMPLETED'::public.transaction_status,
    'CANCELLED'::public.transaction_status
  ) then
    raise exception 'unsupported transaction status target: %', p_status
      using errcode = '22023';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  if p_approver_id is not null and p_approver_id is distinct from v_user.id then
    raise exception 'approver id must match the authenticated user'
      using errcode = '42501';
  end if;

  v_can_approve := app_private.wms_transaction_has_action(
    'wms.transaction.approve', v_tx.type,
    v_tx.source_warehouse_id, v_tx.target_warehouse_id, v_tx.items,
    v_tx.requester_id, v_tx.approver_id, v_user.id
  );

  v_can_complete := app_private.wms_transaction_has_action(
    'wms.transaction.complete', v_tx.type,
    v_tx.source_warehouse_id, v_tx.target_warehouse_id, v_tx.items,
    v_tx.requester_id, v_tx.approver_id, v_user.id
  );

  -- V1-2: người Duyệt ngoại lệ duyệt / hoàn tất được phiếu xuất hủy, điều chỉnh (tách nhiệm kiểm ở trg_guard_wms_exception_approval).
  if v_tx.type::text in ('LIQUIDATION', 'ADJUSTMENT')
     and app_private.wms_user_can_approve_exception(v_user.id, coalesce(v_tx.source_warehouse_id, v_tx.target_warehouse_id)) then
    v_can_approve := true;
    v_can_complete := true;
  end if;

  if p_status = 'APPROVED'::public.transaction_status and not v_can_approve then
    raise exception 'insufficient privilege to approve transaction'
      using errcode = '42501';
  end if;

  if p_status = 'CANCELLED'::public.transaction_status
     and not v_can_approve
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to cancel transaction'
      using errcode = '42501';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status and not v_can_complete then
    raise exception 'insufficient privilege to complete transaction'
      using errcode = '42501';
  end if;

  if v_tx.status = p_status then
    return v_tx;
  end if;
  if v_tx.status = 'CANCELLED'::public.transaction_status then
    raise exception 'cancelled transaction cannot be changed';
  end if;
  if v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'completed transaction cannot be changed';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_pending in
      select value from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb))
    loop
      insert into public.items (
        id, sku, name, category, unit, purchase_unit,
        price_in, price_out, min_stock, supplier_id, image_url,
        stock_by_warehouse, location
      )
      values (
        v_pending->>'id',
        v_pending->>'sku',
        v_pending->>'name',
        coalesce(nullif(v_pending->>'category', ''), 'Khác'),
        coalesce(nullif(v_pending->>'unit', ''), 'Cái'),
        nullif(v_pending->>'purchaseUnit', ''),
        coalesce(nullif(v_pending->>'priceIn', '')::numeric, 0),
        coalesce(nullif(v_pending->>'priceOut', '')::numeric, 0),
        coalesce(nullif(v_pending->>'minStock', '')::integer, 0),
        nullif(v_pending->>'supplierId', ''),
        nullif(v_pending->>'imageUrl', ''),
        coalesce(v_pending->'stockByWarehouse', '{}'::jsonb),
        nullif(v_pending->>'location', '')
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status then
    for v_line in
      select value from jsonb_array_elements(v_tx.items)
    loop
      v_item_id := v_line->>'itemId';
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0)::integer;
      if v_item_id is null or v_qty <= 0 then
        raise exception 'invalid transaction item payload';
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  end if;

  update public.transactions
  set status = p_status,
      approver_id = v_user.id
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_wms_action_recipients(p_permission_code text, p_warehouse_ids text[] DEFAULT '{}'::text[])
 RETURNS TABLE(user_id uuid, user_name text, warehouse_specific boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_app_user_id() is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;
  if p_permission_code is null or p_permission_code not like 'wms.%' then
    raise exception 'WMS_PERMISSION_CODE_REQUIRED' using errcode = '22023';
  end if;

  return query
  with warehouses as (
    select distinct nullif(btrim(value), '') as warehouse_id
    from unnest(coalesce(p_warehouse_ids, '{}'::text[])) as value
  ), candidates as (
    select user_row.id, user_row.name, user_row.role::text as role, user_row.assigned_warehouse_id
    from public.users user_row
    where coalesce(user_row.is_active, true) and user_row.account_status = 'ACTIVE'
  )
  select candidate.id, candidate.name,
    exists (
      select 1 from warehouses w
      where w.warehouse_id is not null and (
        candidate.assigned_warehouse_id = w.warehouse_id
        or app_private.has_permission(candidate.id, p_permission_code, 'warehouse', w.warehouse_id)
        or app_private.wms_user_is_keeper(candidate.id, w.warehouse_id) -- V1-2: thủ kho theo ô quyền
      )
    )
  from candidates candidate
  where case
    when not exists (select 1 from warehouses where warehouse_id is not null)
      then app_private.wms_user_has_action(candidate.id, p_permission_code, null, null, false)
    else exists (
      select 1 from warehouses w
      where w.warehouse_id is not null
        and app_private.wms_user_has_action(candidate.id, p_permission_code, w.warehouse_id, null, false)
    )
  end
  order by 3 desc, (candidate.role = 'ADMIN'), candidate.name;
end;
$function$;


-- Giữ nguyên quyền của thủ kho đang gán theo vai trò + một kho: chuyển thành ô Thủ kho đúng kho đó (không đổi hành vi).
-- Thủ kho "toàn công ty" theo vai trò (không gán kho) KHÔNG được chuyển — chủ SP chọn lại ở màn Người phụ trách.
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, grant_reason)
select u.id, 'wms.transaction.keeper', 'warehouse', u.assigned_warehouse_id, true, 'V1-2: chuyển thủ kho theo vai trò sang ô quyền Thủ kho'
from public.users u
where coalesce(u.is_active, true) and u.role::text = 'WAREHOUSE_KEEPER' and u.assigned_warehouse_id is not null
  and exists (select 1 from public.warehouses w where w.id = u.assigned_warehouse_id)
  and not exists (select 1 from public.user_permission_grants g where g.user_id = u.id and g.permission_code = 'wms.transaction.keeper'
    and g.scope_type = 'warehouse' and g.scope_id = u.assigned_warehouse_id and g.is_active and g.revoked_at is null);

-- ---------------------------------------------------------------------------------------------
-- 3. Duyệt ngoại lệ: xuất hủy / điều chỉnh
-- ---------------------------------------------------------------------------------------------
create function app_private.guard_wms_exception_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_wh text;
begin
  if new.type::text not in ('LIQUIDATION', 'ADJUSTMENT') or v_actor is null then return new; end if;
  if old.status::text = 'PENDING' and new.status::text in ('APPROVED', 'COMPLETED') then
    v_wh := coalesce(new.source_warehouse_id, new.target_warehouse_id);
    if not app_private.wms_user_can_approve_exception(v_actor, v_wh) then
      raise exception using errcode = '42501', message = 'WMS_EXCEPTION_APPROVE_DENIED: Chỉ người Duyệt ngoại lệ (hoặc Admin) duyệt được phiếu xuất hủy / điều chỉnh.';
    end if;
    if new.requester_id = v_actor then
      raise exception using errcode = '42501', message = 'WMS_EXCEPTION_SELF_APPROVE: Người lập phiếu không tự duyệt phiếu xuất hủy / điều chỉnh.';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_wms_exception_approval before update of status on public.transactions
  for each row execute function app_private.guard_wms_exception_approval();

-- ---------------------------------------------------------------------------------------------
-- 4. Màn Người phụ trách: đọc / lưu
-- ---------------------------------------------------------------------------------------------
create function public.get_wms_owners_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not (public.is_admin() or app_private.wms_has_action('wms.inventory.view') or exists (
      select 1 from public.user_permission_grants g where g.user_id = v_actor and g.is_active and g.revoked_at is null and g.permission_code like 'wms.%')) then
    raise exception using errcode = '42501', message = 'WMS_OWNERS_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'can', jsonb_build_object('edit', public.is_admin()),
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
end $$;

-- p = { keepers: { warehouseId: [userId] }, code: [userId], exception: [userId], accounting: [userId], closer: userId | null }
create function public.save_wms_owners_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := 'Người phụ trách kho (Kho vật tư → Thiết lập)';
  v_lines jsonb := '[]'::jsonb;
  v_added int := 0; v_removed int := 0;
  r record;
begin
  if v_actor is null or not public.is_admin() then raise exception using errcode = '42501', message = 'WMS_OWNERS_EDIT_DENIED'; end if;
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
end $$;

revoke all on function app_private.wms_user_is_keeper(uuid, text), app_private.wms_user_can_approve_exception(uuid, text),
  app_private.guard_wms_exception_approval() from public, anon;
grant execute on function app_private.wms_user_is_keeper(uuid, text), app_private.wms_user_can_approve_exception(uuid, text) to authenticated;
revoke all on function public.get_wms_owners_v1(), public.save_wms_owners_v1(jsonb) from public, anon;
grant execute on function public.get_wms_owners_v1(), public.save_wms_owners_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
