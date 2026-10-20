-- Hiệu năng RLS module Kho (audit 20/10/2026, mục H1): hàm quyền gọi theo TỪNG DÒNG.
--
-- Policy SELECT của warehouses, warehouse_types, transactions, requests, inventory_ledger_entries, assets gọi
-- app_private.wms_has_action(...) / asset_has_action(...) cho mỗi dòng quét (≈100 ms/lần vì mỗi lần gọi
-- has_permission 5–7 lượt, mỗi lượt ≈5 ms). Đo với nhân viên có quyền kho: 50 phiếu kho mới nhất 2,2 s,
-- 50 dòng sổ kho 5,7 s; nhân viên không có quyền kho còn tệ hơn (11 s / 31 s) vì phải loại từng dòng.
--
-- Cách sửa: tính TẬP PHẠM VI người dùng được phép MỘT LẦN mỗi câu lệnh (InitPlan) rồi so với cột của dòng.
--   * Tập phạm vi là mảng "token" dạng '<scope_type>:<scope_id>' lấy từ MỘT lần gọi
--     resolve_effective_permission_sources(user, null, null, null) (≈10 ms, mọi mã quyền của người đó).
--     'global:*' = có quyền toàn cục; 'warehouse:*' = mọi kho; 'warehouse:<id>' = kho cụ thể;
--     'own:*' / 'assigned:*' = quyền phạm vi "của tôi" / "được giao cho tôi"; 'department:<id>' = theo phòng.
--   * Policy: (select tokens(...)) && array['global:*', 'warehouse:' || source_warehouse_id, ...]
--     — một InitPlan, không gọi hàm theo dòng.
--
-- Giữ đúng nghĩa cũ (chứng minh + kiểm hồi quy ở docs/performance/rls-initplan-wms-2026-10.md):
--   * has_permission(u, mã, loại, id) ⇔ tồn tại nguồn của (u, mã) mà scope_covers(nguồn, loại, id); tập nguồn
--     lấy một lần với scope null rồi lọc bằng scope_covers cho kết quả y hệt (role_sources, direct, super admin).
--   * wms_has_action = quyền canonical (global / kho nguồn / kho đích / own / assigned) ∨ module admin WMS
--     (trừ wms.transaction.reverse) ∨ thủ kho (mọi kho hoặc kho nguồn/đích; trừ các việc quản trị / ghi sổ).
--   * Phiếu đề xuất nguồn dự án: kiểm quyền phòng material_request theo từng cặp (dự án, công trường) có trong
--     bảng (mẫu rls_scope_key như migration 20261012094700); cặp chưa có (INSERT … RETURNING) rơi về biểu thức cũ.
--   * warehouses_settings_select / warehouse_types_settings_select (settings_has_action('warehouses', false)) được
--     gộp vào policy phase4 cùng bảng (hai policy PERMISSIVE vốn OR với nhau) để chỉ còn một InitPlan.
--   * Policy INSERT/UPDATE/DELETE, chốt RESTRICTIVE active_actor_gate và các bảng danh mục (suppliers, categories,
--     units: SELECT true) không đổi.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Token phạm vi từ một nguồn quyền. IMMUTABLE, SQL thuần để Postgres inline.
--    own / assigned chỉ có nghĩa với chính người dùng nên chuẩn hoá về 'own:*' / 'assigned:*'.
create or replace function app_private.permission_source_token(p_scope_type text, p_scope_id text, p_user_id uuid)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_scope_type = 'global' then 'global:*'
    when p_scope_type in ('own', 'assigned') then
      case when coalesce(nullif(p_scope_id, ''), '*') in ('*', p_user_id::text) then p_scope_type || ':*' end
    else p_scope_type || ':' || coalesce(nullif(p_scope_id, ''), '*')
  end;
$$;

-- 2. Token theo nghĩa has_permission thuần cho một người và một nhóm mã (hợp của các mã).
--    Không dùng cho mã work.task.* (has_permission có luật riêng theo workspace).
create or replace function app_private.permission_scope_tokens_for(p_user_id uuid, p_codes text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct token), '{}'::text[])
  from (
    select app_private.permission_source_token(source.scope_type, source.scope_id, p_user_id) as token
    from app_private.resolve_effective_permission_sources(p_user_id, null, null, null, now()) source
    where p_user_id is not null
      and source.permission_code = any (p_codes)
      and (source.permission_code not like 'work.%' or upper(source.source_type) <> 'LEGACY')
  ) tokens
  where token is not null;
$$;

create or replace function app_private.permission_scope_tokens(p_codes text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.permission_scope_tokens_for(public.current_app_user_id(), p_codes);
$$;

-- 3. Token theo nghĩa app_private.wms_has_action cho người đang đăng nhập, hợp của các mã p_codes.
--    p_global_codes: mã kiểm thêm chỉ ở phạm vi toàn cục (như settings_has_action), góp 'global:*'.
create or replace function app_private.wms_action_scope_tokens(p_codes text[], p_global_codes text[] default '{}'::text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (
    select u.id, u.role, u.auth_id = (select auth.uid()) as auth_matches
    from public.users u
    where u.id = public.current_app_user_id()
  ),
  codes as materialized (
    -- wms_has_action chỉ xét mã wms.* đang bật trong permission_actions
    select action_row.permission_code as code
    from public.permission_actions action_row
    where action_row.permission_code = any (p_codes)
      and action_row.permission_code like 'wms.%'
      and action_row.is_active
  ),
  sources as materialized (
    select source.permission_code, source.scope_type, source.scope_id
    from me
    cross join app_private.resolve_effective_permission_sources(me.id, null, null, null, now()) source
  ),
  tokens as (
    -- (a) quyền canonical của chính mã: global / kho / own / assigned
    select app_private.permission_source_token(source.scope_type, source.scope_id, me.id) as token
    from me, sources source
    join codes on codes.code = source.permission_code
    union all
    -- (b) module admin WMS (is_module_admin('WMS')): mọi mã trừ wms.transaction.reverse
    select 'global:*'
    from me
    where me.auth_matches
      and exists (select 1 from codes where codes.code <> 'wms.transaction.reverse')
      and (
        me.role = 'ADMIN'
        or exists (
          select 1 from sources source
          where source.permission_code = 'system.wms.manage' and source.scope_type = 'global'
        )
      )
    union all
    -- (c) thủ kho (wms.transaction.keeper) mọi kho / theo kho: mã không bị wms_keeper_excluded_action
    select app_private.permission_source_token(source.scope_type, source.scope_id, me.id)
    from me, sources source
    where source.permission_code = 'wms.transaction.keeper'
      and source.scope_type in ('global', 'warehouse')
      and exists (
        select 1 from codes
        where codes.code <> 'wms.transaction.reverse'
          and not app_private.wms_keeper_excluded_action(codes.code)
      )
    union all
    -- (d) mã kiểm riêng ở phạm vi toàn cục
    select 'global:*'
    from sources source
    where source.permission_code = any (p_global_codes) and source.scope_type = 'global'
  )
  select coalesce(array_agg(distinct token), '{}'::text[]) from tokens where token is not null;
$$;

-- 4. Phiếu đề xuất nguồn dự án: khóa (dự án, công trường) được xem phòng material_request.
create or replace function app_private.material_request_view_scope_keys(p_allowed_only boolean)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with scopes as materialized (
    select distinct request.project_id, request.construction_site_id
    from public.requests request
    where coalesce(request.request_origin, 'wms') = 'project' and request.project_id is not null
  )
  select coalesce(array_agg(app_private.rls_scope_key(scopes.project_id, scopes.construction_site_id)), '{}'::text[])
  from scopes
  where not p_allowed_only
     or app_private.current_actor_has_effective_room_action(scopes.project_id, scopes.construction_site_id, 'material_request', 'view');
$$;

revoke all on function app_private.permission_source_token(text, text, uuid) from public, anon;
revoke all on function app_private.permission_scope_tokens_for(uuid, text[]) from public, anon;
revoke all on function app_private.permission_scope_tokens(text[]) from public, anon;
revoke all on function app_private.wms_action_scope_tokens(text[], text[]) from public, anon;
revoke all on function app_private.material_request_view_scope_keys(boolean) from public, anon;
grant execute on function app_private.permission_source_token(text, text, uuid) to authenticated;
grant execute on function app_private.permission_scope_tokens(text[]) to authenticated;
grant execute on function app_private.wms_action_scope_tokens(text[], text[]) to authenticated;
grant execute on function app_private.material_request_view_scope_keys(boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- warehouses: cũ = can_manage_warehouse_site_bindings() ∨ wms_has_action(view|edit|manage, id)
--                 ∨ [warehouses_settings_select] settings_has_action('warehouses', false).
--   can_manage_warehouse_site_bindings = is_admin ∨ is_module_admin(WMS|SETTINGS) ∨ wms_has_action(manage)
--     ∨ settings_has_action('warehouses', true): is_module_admin(WMS) và wms_has_action(manage) nằm trong token
--     của mã manage; is_module_admin(SETTINGS) = ADMIN (⊂ is_admin) ∨ system.settings.manage toàn cục.
drop policy if exists warehouses_settings_select on public.warehouses;
alter policy warehouses_phase4_select on public.warehouses
using (
  (select public.is_admin())
  or (
    select app_private.wms_action_scope_tokens(
      array['wms.inventory.view', 'wms.inventory.edit', 'wms.master_data.manage'],
      array['system.settings.manage', 'settings.warehouses.manage', 'settings.warehouses.view']
    )
  ) && array['global:*', 'warehouse:*', 'warehouse:' || id]
);

-- warehouse_types: cũ = wms_has_action(view) ∨ wms_has_action(manage) (không tham số kho → chỉ xét toàn cục)
--                      ∨ [warehouse_types_settings_select] settings_has_action('warehouses', false).
drop policy if exists warehouse_types_settings_select on public.warehouse_types;
alter policy warehouse_types_phase4_select on public.warehouse_types
using (
  'global:*' = any ((
    select app_private.wms_action_scope_tokens(
      array['wms.inventory.view', 'wms.master_data.manage'],
      array['system.settings.manage', 'settings.warehouses.manage', 'settings.warehouses.view']
    )
  )::text[])
);

-- transactions: cũ = wms_has_action('wms.transaction.view', kho nguồn, kho đích, người đề nghị, người duyệt).
alter policy transactions_phase4_select on public.transactions
using (
  (select app_private.wms_action_scope_tokens(array['wms.transaction.view'])) && array[
    'global:*',
    case when source_warehouse_id is not null or target_warehouse_id is not null then 'warehouse:*' end,
    'warehouse:' || source_warehouse_id,
    'warehouse:' || target_warehouse_id,
    case when requester_id = (select public.current_app_user_id()) then 'own:*' end,
    case when approver_id = (select public.current_app_user_id()) then 'assigned:*' end
  ]
);

-- requests: cũ = material_request_can_select_v2(...)
--   nguồn 'project': project_id not null ∧ quyền phòng material_request.view theo (dự án, công trường);
--   nguồn kho: wms_request_can_access = wms_has_action('wms.request.view', kho nguồn, kho công trường, người đề
--   nghị, người nhận) ∨ người đề nghị là tôi ∨ người nhận là tôi.
alter policy requests_select on public.requests
using (
  case when coalesce(request_origin, 'wms') = 'project' then
    project_id is not null
    and (
      app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.material_request_view_scope_keys(true))::text[])
      or (
        not (app_private.rls_scope_key(project_id, construction_site_id) = any ((select app_private.material_request_view_scope_keys(false))::text[]))
        and app_private.current_actor_has_effective_room_action(project_id, construction_site_id, 'material_request', 'view')
      )
    )
  else
    (select app_private.wms_action_scope_tokens(array['wms.request.view'])) && array[
      'global:*',
      case when source_warehouse_id is not null or site_warehouse_id is not null then 'warehouse:*' end,
      'warehouse:' || source_warehouse_id,
      'warehouse:' || site_warehouse_id,
      case when requester_id = (select public.current_app_user_id()) then 'own:*' end,
      case when nullif(submitted_to_user_id, '')::uuid = (select public.current_app_user_id()) then 'assigned:*' end
    ]
    or requester_id = (select public.current_app_user_id())
    or (submitted_to_user_id is not null and submitted_to_user_id = (select public.current_app_user_id())::text)
  end
);

-- inventory_ledger_entries: cũ = can_read_inventory_scope(kho, người lập, người duyệt)
--   = wms_has_action('wms.inventory.view', kho, null, người lập, người duyệt) ∨ người lập là tôi ∨ người duyệt là tôi
--   ∨ (kho null: thủ kho toàn cục; kho có: wms_user_is_keeper(tôi, kho)) — nhánh thủ kho kiểm has_permission thuần.
alter policy inventory_ledger_entries_select on public.inventory_ledger_entries
using (
  (select app_private.wms_action_scope_tokens(array['wms.inventory.view'])) && array[
    'global:*',
    case when warehouse_id is not null then 'warehouse:*' end,
    'warehouse:' || warehouse_id,
    case when created_by = (select public.current_app_user_id()) then 'own:*' end,
    case when approved_by = (select public.current_app_user_id()) then 'assigned:*' end
  ]
  or created_by = (select public.current_app_user_id())
  or approved_by = (select public.current_app_user_id())
  or (select app_private.permission_scope_tokens(array['wms.transaction.keeper'])) && array[
    'global:*',
    case when warehouse_id is not null then 'warehouse:*' end,
    'warehouse:' || warehouse_id
  ]
);

-- assets: cũ = asset_has_action(mã, kho, phòng quản lý, người được giao) cho 4 mã *.view
--   = toàn cục ∨ (kho có ∧ quyền theo kho) ∨ (phòng có ∧ quyền theo phòng) ∨ (được giao cho tôi ∧ quyền assigned).
alter policy assets_select_action on public.assets
using (
  (
    select app_private.permission_scope_tokens(
      array['asset.catalog.view', 'asset.assignment.view', 'asset.maintenance.view', 'asset.audit.view']
    )
  ) && array[
    'global:*',
    case when warehouse_id is not null then 'warehouse:*' end,
    'warehouse:' || warehouse_id,
    case when managing_dept_id is not null then 'department:*' end,
    'department:' || managing_dept_id,
    case when app_private.uuid_or_null(assigned_to_user_id) = (select public.current_app_user_id()) then 'assigned:*' end
  ]
);
