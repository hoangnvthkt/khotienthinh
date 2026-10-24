-- Phân quyền kho đi qua luật kiêm nhiệm (Trung tâm phân quyền, giai đoạn A — chủ SP duyệt 24/10/2026).
-- Trước đây save_wms_access_v1 ghi thẳng user_permission_grants: không xét kiêm nhiệm (vd. Mua hàng + Thủ kho), lý do cố định,
-- không báo mẫu theo vị trí (gỡ quyền mẫu ở đây thì lần đồng bộ mẫu sau cấp lại). Nay: xem trước → cảnh báo kiêm nhiệm
-- từng người → ghi nhận (một lần cho cả lượt lưu) → lưu; lý do bấm sẵn; mỗi người một dòng nhật ký.

-- ---------------------------------------------------------------------------------------------
-- 1. Kế hoạch thay đổi, không ghi: pg_temp.wms_access_add / pg_temp.wms_access_remove.
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.wms_access_plan(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view_codes text[] := array['wms.inventory.view', 'wms.transaction.view', 'wms.request.view'];
  v_job_codes text[] := array['wms.transaction.keeper', 'wms.master_data.issue_code', 'wms.transaction.exception_approve', 'wms.accounting.manage',
    'wms.accounting.close_period', 'settings.warehouses.manage', 'wms.master_data.manage', 'wms.request.create'];
  v_legacy_codes text[] := array['wms.transaction.create', 'wms.transaction.approve', 'wms.transaction.complete', 'wms.inventory.edit',
    'wms.request.create', 'wms.request.approve', 'wms.request.export', 'wms.request.receive', 'wms.request.delete',
    'wms.material_issue.settle', 'wms.material_issue.reverse_settlement', 'wms.purchase_order.return_supplier', 'wms.transaction.reverse'];
begin
  create temp table if not exists wms_access_want(code text, scope_type text, scope_id text, user_id uuid) on commit drop;
  create temp table if not exists wms_access_view(scope_type text, scope_id text, user_id uuid) on commit drop;
  create temp table if not exists wms_access_add(user_id uuid, code text, scope_type text, scope_id text) on commit drop;
  create temp table if not exists wms_access_remove(id uuid, user_id uuid, code text, scope_type text, scope_id text) on commit drop;
  delete from pg_temp.wms_access_want; delete from pg_temp.wms_access_view; delete from pg_temp.wms_access_add; delete from pg_temp.wms_access_remove;

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

  -- Bộ Xem kho cho người được xem; ô vào phân hệ Kho (system.wms.view) cho mọi người có việc hoặc được xem.
  insert into pg_temp.wms_access_want select c, v.scope_type, v.scope_id, v.user_id from pg_temp.wms_access_view v cross join unnest(v_view_codes) c;
  insert into pg_temp.wms_access_want select distinct 'system.wms.view', 'global', '*', w.user_id from pg_temp.wms_access_want w;

  -- Gỡ: việc đối chiếu đủ; Xem chỉ gỡ ở phạm vi người đó đang có ô Xem tồn mà nay bị bỏ; ô lẻ kiểu cũ Admin chọn gỡ.
  insert into pg_temp.wms_access_remove
  select g.id, g.user_id, g.permission_code, g.scope_type, g.scope_id from public.user_permission_grants g
  where g.is_active and g.revoked_at is null and (
    (g.permission_code = any(v_job_codes) and not (g.permission_code in ('wms.request.create', 'wms.master_data.manage') and g.scope_type <> 'global')
      and not exists (select 1 from pg_temp.wms_access_want w where w.code = g.permission_code and w.scope_type = g.scope_type and w.scope_id = g.scope_id and w.user_id = g.user_id))
    or (g.permission_code = any(v_view_codes) and g.scope_type in ('global', 'warehouse')
      and exists (select 1 from public.user_permission_grants a where a.is_active and a.revoked_at is null and a.permission_code = 'wms.inventory.view'
        and a.user_id = g.user_id and a.scope_type = g.scope_type and a.scope_id = g.scope_id)
      and not exists (select 1 from pg_temp.wms_access_view v where v.user_id = g.user_id and v.scope_type = g.scope_type and v.scope_id = g.scope_id))
    or (g.permission_code = any(v_legacy_codes) and exists (select 1 from jsonb_array_elements(coalesce(p->'revoke', '[]'::jsonb)) x
      where (x->>'userId')::uuid = g.user_id and x->>'code' = g.permission_code and x->>'scopeType' = g.scope_type and x->>'scopeId' = g.scope_id)));
  -- Người vừa bị bỏ Xem kho mà không còn việc / quyền kho nào: gỡ luôn ô vào phân hệ Kho.
  insert into pg_temp.wms_access_remove
  select g.id, g.user_id, g.permission_code, g.scope_type, g.scope_id from public.user_permission_grants g
  where g.is_active and g.revoked_at is null and g.permission_code = 'system.wms.view'
    and g.user_id in (select r.user_id from pg_temp.wms_access_remove r where r.code = 'wms.inventory.view')
    and not exists (select 1 from pg_temp.wms_access_want w where w.user_id = g.user_id)
    and not exists (select 1 from public.user_permission_grants o where o.user_id = g.user_id and o.is_active and o.revoked_at is null
      and o.permission_code like 'wms.%' and o.id not in (select r.id from pg_temp.wms_access_remove r));

  -- Cấp: việc / xem chưa có.
  insert into pg_temp.wms_access_add
  select distinct w.user_id, w.code, w.scope_type, w.scope_id from pg_temp.wms_access_want w
  where not exists (select 1 from public.user_permission_grants g where g.is_active and g.revoked_at is null and g.permission_code = w.code
    and g.scope_type = w.scope_type and g.scope_id = w.scope_id and g.user_id = w.user_id);
end;
$$;

-- Bộ quyền riêng của một người sau lượt lưu này (để xét kiêm nhiệm như lưu tay).
create or replace function app_private.wms_access_next_grants(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce((select jsonb_agg(g) from jsonb_array_elements(app_private.center_current_grants(p_user_id)) g
    where not exists (select 1 from pg_temp.wms_access_remove r where r.user_id = p_user_id and r.code = g ->> 'permission_code'
      and r.scope_type = g ->> 'scope_type' and r.scope_id = g ->> 'scope_id')), '[]'::jsonb)
  || coalesce((select jsonb_agg(jsonb_build_object('permission_code', a.code, 'scope_type', a.scope_type, 'scope_id', a.scope_id,
      'expires_at', null, 'is_active', true)) from pg_temp.wms_access_add a where a.user_id = p_user_id), '[]'::jsonb);
end;
$$;

-- Kiêm nhiệm từng người trong lượt lưu. Người không quản lý phân quyền thì không ghi nhận được: báo needsAdmin
-- khi lượt lưu cấp quyền nằm trong một luật kiêm nhiệm.
create or replace function app_private.wms_access_sod(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_people jsonb := '[]'::jsonb;
  v_user record;
  v_decision jsonb;
begin
  if not app_private.has_permission(p_actor, 'system.authorization.manage_grants', 'global', '*') then
    return jsonb_build_object('people', v_people, 'needsAdmin', exists (
      select 1 from pg_temp.wms_access_add a join public.authorization_sod_rules r
        on r.is_active and r.rule_type = 'PERMISSION_PAIR' and a.code in (r.left_permission_code, r.right_permission_code)));
  end if;
  for v_user in
    select u.id, u.name from public.users u
    where u.id in (select user_id from pg_temp.wms_access_add union select user_id from pg_temp.wms_access_remove)
    order by u.name
  loop
    v_decision := app_private.describe_sod_decision(
      app_private.evaluate_direct_grant_replacement_impl(p_actor, v_user.id, app_private.wms_access_next_grants(v_user.id)), v_user.id);
    if jsonb_array_length(v_decision -> 'warnings') > 0 or jsonb_array_length(v_decision -> 'hardDenies') > 0 then
      v_people := v_people || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'warnings', v_decision -> 'warnings',
        'hardDenies', v_decision -> 'hardDenies');
    end if;
  end loop;
  return jsonb_build_object('people', v_people, 'needsAdmin', false);
end;
$$;

-- Một dòng thay đổi bằng lời ("+ Bùi Quang Chung — Giao dịch kho: Thủ kho @ Kho Sơn Miền Bắc").
create or replace function app_private.wms_access_line(p_sign text, p_user_name text, p_code text, p_scope_type text, p_scope_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p_sign || ' ' || coalesce(p_user_name || ' — ', '')
    || coalesce((select coalesce(m.name || ': ', '') || a.label from public.permission_actions a
      left join public.permission_modules m on m.code = a.module_code where a.permission_code = p_code), p_code)
    || case when p_scope_type = 'warehouse' then ' @ ' || coalesce((select w.name from public.warehouses w where w.id = p_scope_id), p_scope_id) else '' end;
$$;

revoke all on function app_private.wms_access_line(text, text, text, text, text) from public, anon, authenticated;
revoke all on function app_private.wms_access_plan(jsonb) from public, anon, authenticated;
revoke all on function app_private.wms_access_next_grants(uuid) from public, anon, authenticated;
revoke all on function app_private.wms_access_sod(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Xem trước và lưu.
-- ---------------------------------------------------------------------------------------------
create or replace function public.preview_wms_access_v1(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_sod jsonb;
begin
  if v_actor is null or not app_private.wms_can_edit_access(v_actor) then raise exception using errcode = '42501', message = 'WMS_OWNERS_EDIT_DENIED'; end if;
  perform app_private.wms_access_plan(p);
  v_sod := app_private.wms_access_sod(v_actor);
  -- Dòng thay đổi do máy chủ tính (kể cả phần tự chuẩn hóa: kèm bộ Xem, bỏ Xem kho trùng với Xem mọi kho).
  return jsonb_build_object('added', (select count(*) from pg_temp.wms_access_add), 'removed', (select count(*) from pg_temp.wms_access_remove),
    'lines', coalesce((select jsonb_agg(x.line order by x.name, x.sign desc, x.code) from (
      select u.name, '+' sign, a.code, app_private.wms_access_line('+', u.name, a.code, a.scope_type, a.scope_id) line
      from pg_temp.wms_access_add a join public.users u on u.id = a.user_id
      union all
      select u.name, '−', r.code, app_private.wms_access_line('−', u.name, r.code, r.scope_type, r.scope_id)
      from pg_temp.wms_access_remove r join public.users u on u.id = r.user_id) x), '[]'::jsonb),
    'sod', v_sod -> 'people', 'needsAdmin', v_sod -> 'needsAdmin');
end;
$$;

drop function if exists public.save_wms_access_v1(jsonb);

create function public.save_wms_access_v1(p jsonb, p_reason text default null, p_ack jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := 'Phân quyền kho: ' || coalesce(nullif(btrim(p_reason), ''), 'cập nhật việc kho');
  v_command uuid := gen_random_uuid();
  v_sod jsonb;
  v_person jsonb;
  v_user record;
  v_lines jsonb := '[]'::jsonb;
  v_user_lines jsonb;
  r record;
begin
  if v_actor is null or not app_private.wms_can_edit_access(v_actor) then raise exception using errcode = '42501', message = 'WMS_OWNERS_EDIT_DENIED'; end if;
  perform app_private.wms_access_plan(p);

  -- Kiêm nhiệm: cặp mới cần ghi nhận (ghi vào authorization_sod_warning_acceptances); cặp cấm thì chặn.
  v_sod := app_private.wms_access_sod(v_actor);
  if (v_sod ->> 'needsAdmin')::boolean then
    raise exception using errcode = '42501', message = 'WMS_ACCESS_SOD_ADMIN_REQUIRED';
  end if;
  for v_person in select value from jsonb_array_elements(v_sod -> 'people') loop
    perform app_private.assert_and_record_sod_warnings(
      jsonb_build_object('warnings', v_person -> 'warnings', 'hardDenies', v_person -> 'hardDenies'),
      app_private.center_acceptances(v_person -> 'warnings', p_ack), 'WMS_ACCESS', v_command, v_actor, (v_person ->> 'userId')::uuid);
  end loop;

  for v_user in
    select u.id, u.name from public.users u
    where u.id in (select user_id from pg_temp.wms_access_add union select user_id from pg_temp.wms_access_remove)
    order by u.name
  loop
    v_user_lines := '[]'::jsonb;
    for r in select * from pg_temp.wms_access_remove where user_id = v_user.id order by code, scope_id loop
      update public.user_permission_grants set is_active = false, revoked_at = now(), revoked_by = v_actor, revoked_reason = v_reason, updated_at = now()
      where id = r.id;
      v_user_lines := v_user_lines || to_jsonb(app_private.wms_access_line('−', null, r.code, r.scope_type, r.scope_id));
    end loop;
    for r in select * from pg_temp.wms_access_add where user_id = v_user.id order by code, scope_id loop
      -- Dòng đã thu hồi trước đây (cùng người / ô / phạm vi) thì kích hoạt lại, không thêm dòng mới.
      insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_by, grant_reason)
      values (r.user_id, r.code, r.scope_type, r.scope_id, true, v_actor, v_reason)
      on conflict (user_id, permission_code, scope_type, scope_id) do update set is_active = true, revoked_at = null, revoked_by = null, revoked_reason = null,
        expires_at = null, granted_by = excluded.granted_by, granted_at = now(), grant_reason = excluded.grant_reason, updated_at = now();
      v_user_lines := v_user_lines || to_jsonb(app_private.wms_access_line('+', null, r.code, r.scope_type, r.scope_id));
    end loop;
    -- Gỡ quyền mẫu ở đây thì ghi "Admin bỏ riêng" để lần đồng bộ mẫu sau không cấp lại.
    perform app_private.adopt_user_template_state(v_user.id);
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, v_user.id, 'wms_access_changed',
      coalesce((select jsonb_agg(jsonb_build_object('permission_code', code, 'scope_type', scope_type, 'scope_id', scope_id)) from pg_temp.wms_access_remove where user_id = v_user.id), '[]'::jsonb),
      coalesce((select jsonb_agg(jsonb_build_object('permission_code', code, 'scope_type', scope_type, 'scope_id', scope_id)) from pg_temp.wms_access_add where user_id = v_user.id), '[]'::jsonb),
      jsonb_build_object('reason', v_reason, 'source', 'wms_owners_user', 'commandId', v_command, 'lines', v_user_lines));
    select v_lines || coalesce(jsonb_agg(to_jsonb(left(l #>> '{}', 1) || ' ' || v_user.name || ' — ' || substr(l #>> '{}', 3))), '[]'::jsonb)
    into v_lines from jsonb_array_elements(v_user_lines) l;
  end loop;

  -- Dòng tổng cho mục Lịch sử của màn Phân quyền kho (đọc theo source = 'wms_owners').
  if jsonb_array_length(v_lines) > 0 then
    insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
    values (v_actor, v_actor, 'wms_access_saved', '[]'::jsonb, '[]'::jsonb,
      jsonb_build_object('reason', v_reason, 'source', 'wms_owners', 'commandId', v_command, 'lines', v_lines));
  end if;
  return jsonb_build_object('added', (select count(*) from pg_temp.wms_access_add), 'removed', (select count(*) from pg_temp.wms_access_remove), 'lines', v_lines);
end;
$$;

revoke all on function public.preview_wms_access_v1(jsonb) from public, anon;
revoke all on function public.save_wms_access_v1(jsonb, text, jsonb) from public, anon;
grant execute on function public.preview_wms_access_v1(jsonb) to authenticated;
grant execute on function public.save_wms_access_v1(jsonb, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Nhật ký phân quyền đọc dòng "đổi quyền kho" mới (một dòng mỗi người, kèm các dòng + / −).
-- ---------------------------------------------------------------------------------------------
create or replace function public.list_permission_audit_v1(p_limit integer default 100, p_before timestamptz default null,
  p_kind text default 'all', p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app_private.can_manage_permissions() then
    raise exception 'Authorization administration permission required' using errcode = '42501';
  end if;
  with typed as (
    select e.*, case
      when e.event_type in ('user_template_assignment_saved', 'user_template_assignment_removed', 'basic_template_reapplied_20261023') then 'template'
      when e.event_type = 'sod_existing_conflict_acknowledged' then 'sod'
      when e.event_type in ('replace_project_permission_room_members', 'upsert_project_staff_assignment', 'remove_project_staff_assignment',
        'end_project_staff_assignment', 'project_room_member_departed') then 'room'
      when e.event_type in ('business_role_assigned', 'business_role_revoked') then 'role'
      when e.event_type in ('account_disabled_db_applied', 'account_reactivated', 'account_reactivated_zero_rights') then 'account'
      when e.event_type in ('user_authorization_v2_updated', 'direct_permission_grants_changed', 'replace_user_permission_grants',
        'account_role_transitioned', 'key_roles_access_20261020', 'dead_system_grants_revoked',
        'work_pilot_access_granted', 'work_pilot_access_revoked', 'wms_access_changed') then 'change'
      end as kind
    from public.permission_audit_events e
    where (p_before is null or e.created_at < p_before)
      and (p_user_id is null or e.target_user_id = p_user_id or e.actor_user_id = p_user_id)
  )
  select coalesce(jsonb_agg(r order by (r ->> 'at') desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object('id', e.id, 'at', e.created_at, 'eventType', e.event_type, 'kind', e.kind,
      'actor', coalesce(au.name, 'Hệ thống'), 'target', tu.name, 'targetId', e.target_user_id,
      'reason', coalesce(nullif(btrim(e.metadata ->> 'reason'), ''), ''),
      'before', case when jsonb_typeof(e.before_grants) = 'array' then jsonb_array_length(e.before_grants)
        when jsonb_typeof(e.before_grants -> 'grants') = 'array' then jsonb_array_length(e.before_grants -> 'grants') end,
      'after', case when jsonb_typeof(e.after_grants) = 'array' then jsonb_array_length(e.after_grants)
        when jsonb_typeof(e.after_grants -> 'grants') = 'array' then jsonb_array_length(e.after_grants -> 'grants') end,
      'added', e.metadata -> 'added', 'removed', e.metadata -> 'removed',
      'template', (select t.name from public.user_permission_templates t where t.code = coalesce(e.after_grants ->> 'templateCode', e.metadata ->> 'templateCode')),
      'rule', (select r.name from public.authorization_sod_rules r where r.rule_code = e.metadata ->> 'ruleCode'),
      'controlOwner', (select cu.name from public.users cu where cu.id::text = e.metadata ->> 'controlOwnerUserId'),
      'until', e.metadata ->> 'expiresAt',
      'room', (select pr.name from public.project_permission_rooms pr where pr.code = e.metadata ->> 'room_code'),
      'project', (select p.name from public.projects p where p.id::text = e.metadata ->> 'project_id'),
      'tier', e.metadata ->> 'tier', 'lines', e.metadata -> 'lines') as r
    from typed e
    left join public.users au on au.id = e.actor_user_id
    left join public.users tu on tu.id = e.target_user_id
    where e.kind is not null and (coalesce(p_kind, 'all') = 'all' or e.kind = p_kind)
      -- Bỏ dòng trùng: lưu quyền ở màn Người dùng / gắn mẫu ghi thêm một dòng "đổi quyền riêng" cùng lúc, cùng lý do.
      and not (e.event_type = 'direct_permission_grants_changed' and exists (
        select 1 from public.permission_audit_events o
        where o.target_user_id = e.target_user_id and o.actor_user_id is not distinct from e.actor_user_id
          and o.event_type in ('user_authorization_v2_updated', 'user_template_assignment_saved')
          and o.metadata ->> 'reason' is not distinct from e.metadata ->> 'reason'
          and o.created_at between e.created_at - interval '5 seconds' and e.created_at + interval '5 seconds'))
    order by e.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 300))
  ) q;
  return jsonb_build_object('rows', v_rows);
end;
$$;

