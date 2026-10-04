-- Module Vật tư — Phân quyền kho: giao 8 việc thay cho ~25 ô quyền kỹ thuật (mở rộng màn Người phụ trách V1-2).
-- Chủ sản phẩm chốt 04/10/2026 (docs/designs/project-closed-loop-2026-09-30/13-module-vat-tu-ra-soat.md mục 17, câu 33–37):
--  1. Việc: Xem kho (mọi kho / từng kho) · Đề xuất mã mới · Thủ kho (từng kho) · Cấp mã · Duyệt ngoại lệ · Kế toán kho · Khóa kỳ · Quản lý danh sách kho.
--  2. Cấp mã, Duyệt ngoại lệ, Kế toán kho tự kèm Xem mọi kho (lưu là cấp đủ bộ Xem).
--  3. Quản lý danh sách kho = settings.warehouses.manage (Cài đặt) + wms.master_data.manage (máy chủ: tạo / sửa / xóa kho). Câu 35: chỉ Admin.
--  4. Thủ kho KHÔNG còn ngầm có việc quản trị ở kho mình giữ: quản lý kho, cấp mã, duyệt ngoại lệ, kế toán kho, khóa kỳ, hủy duyệt.
--  5. Mẫu quyền ở Cài đặt → Người dùng: phần kho chỉ còn Xem kho (câu 37).
--  6. Lưu một lần, chỉ Admin, nhật ký như V1-2 (source = wms_owners). Ô quyền lẻ kiểu cũ gỡ được ngay trên màn (câu 36).

-- Ô quyền thuộc việc quản trị / ghi sổ: thủ kho không ngầm có.
create function app_private.wms_keeper_excluded_action(p_permission_code text)
returns boolean language sql immutable set search_path = '' as $$
  select p_permission_code in ('wms.transaction.reverse', 'wms.master_data.manage', 'wms.master_data.issue_code',
    'wms.transaction.exception_approve', 'wms.accounting.manage', 'wms.accounting.close_period');
$$;

CREATE OR REPLACE FUNCTION app_private.wms_has_action(p_permission_code text, p_source_warehouse_id text DEFAULT NULL::text, p_target_warehouse_id text DEFAULT NULL::text, p_requester_id uuid DEFAULT NULL::uuid, p_assigned_user_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT current_app_user_id())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when p_user_id is not null and exists (
    select 1
    from public.permission_actions action_row
    where action_row.permission_code = p_permission_code
      and action_row.permission_code like 'wms.%'
      and action_row.is_active
  ) then coalesce((
    app_private.wms_has_canonical_action(
      p_permission_code,
      p_source_warehouse_id,
      p_target_warehouse_id,
      p_requester_id,
      p_assigned_user_id,
      p_user_id
    )
    or (
      p_permission_code <> 'wms.transaction.reverse'
      and (
        public.is_module_admin('WMS')
        -- Phân quyền kho: thủ kho không ngầm có việc quản trị / ghi sổ ở kho mình giữ.
        or (not app_private.wms_keeper_excluded_action(p_permission_code) and (
          app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(p_target_warehouse_id)))
      )
    )
  ), false) else false end;
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
            -- Phân quyền kho: thủ kho không ngầm có việc quản trị / ghi sổ ở kho mình giữ.
            or (not app_private.wms_keeper_excluded_action(p_permission_code) and (
              app_private.has_permission(user_row.id, 'wms.transaction.keeper', 'global', '*')
              or app_private.wms_user_is_keeper(user_row.id, p_source_warehouse_id)
              or app_private.wms_user_is_keeper(user_row.id, p_target_warehouse_id)))
          )
      )
    ),
    false
  );
$function$;


-- ---------------------------------------------------------------------------------------------
-- Màn Phân quyền kho: đọc / lưu
-- ---------------------------------------------------------------------------------------------
create function public.get_wms_access_v1()
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
end $$;

-- p = { viewAll: [userId], viewWh: { warehouseId: [userId] }, propose: [userId], keepers: { warehouseId: [userId] },
--       code: [userId], exception: [userId], accounting: [userId], closer: userId | null, whAdmin: [userId],
--       revoke: [{ userId, code, scopeType, scopeId }] }   -- ô quyền lẻ kiểu cũ cần gỡ
create function public.save_wms_access_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  if v_actor is null or not public.is_admin() then raise exception using errcode = '42501', message = 'WMS_OWNERS_EDIT_DENIED'; end if;
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
end $$;

-- ---------------------------------------------------------------------------------------------
-- Mẫu quyền ở Cài đặt → Người dùng: phần kho chỉ còn Xem kho (câu 37). Việc kho khác giao ở màn Phân quyền kho.
-- ---------------------------------------------------------------------------------------------
update public.user_permission_templates t
set items = (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(t.items) with ordinality e(x, o)
    where not ((x->>'permissionCode') like 'wms.%' and (x->>'permissionCode') not in ('wms.inventory.view', 'wms.transaction.view', 'wms.request.view'))),
  updated_at = now()
where exists (select 1 from jsonb_array_elements(t.items) x
  where (x->>'permissionCode') like 'wms.%' and (x->>'permissionCode') not in ('wms.inventory.view', 'wms.transaction.view', 'wms.request.view'));

revoke all on function app_private.wms_keeper_excluded_action(text) from public, anon;
grant execute on function app_private.wms_keeper_excluded_action(text) to authenticated;
revoke all on function public.get_wms_access_v1(), public.save_wms_access_v1(jsonb) from public, anon;
grant execute on function public.get_wms_access_v1(), public.save_wms_access_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
