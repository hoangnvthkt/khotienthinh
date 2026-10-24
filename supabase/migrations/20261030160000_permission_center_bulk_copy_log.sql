-- Trung tâm phân quyền — bước 3 (chủ SP duyệt mockup 23/10/2026): Hàng loạt, Sao chép, Kiểm soát, Nhật ký.
-- Mọi thay đổi đi qua đường lưu quyền chuẩn (kiểm kiêm nhiệm, hạn, nhật ký từng người). Người lỗi được bỏ qua và báo lại.
-- Màn hình gửi theo lô nhỏ (≈150 ms/người gắn mẫu, ≈400 ms/người chép kèm Room) để không vượt statement_timeout 8 s.

-- ---------------------------------------------------------------------------------------------
-- 1. Dùng chung
-- ---------------------------------------------------------------------------------------------
-- Một lần ghi nhận kiêm nhiệm dùng cho mọi cảnh báo của một người.
create or replace function app_private.center_acceptances(p_warnings jsonb, p_ack jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_ack) is distinct from 'object' then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('ruleCode', w ->> 'ruleCode', 'scopeType', w ->> 'scopeType', 'scopeId', w ->> 'scopeId',
      'reason', p_ack ->> 'reason', 'controlOwnerUserId', p_ack ->> 'controlOwnerUserId',
      'compensatingControls', p_ack ->> 'compensatingControls', 'expiresAt', p_ack ->> 'expiresAt'))
    from jsonb_array_elements(coalesce(p_warnings, '[]'::jsonb)) w), '[]'::jsonb) end;
$$;

-- Quyền riêng đang hiệu lực của một người (dạng payload lưu quyền).
create or replace function app_private.center_current_grants(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('permission_code', g.permission_code, 'scope_type', g.scope_type, 'scope_id', g.scope_id,
    'expires_at', g.expires_at, 'is_active', true)), '[]'::jsonb)
  from public.user_permission_grants g
  where g.user_id = p_user_id and g.is_active and (g.expires_at is null or g.expires_at > now());
$$;

-- Hạn cho quyền cấp mới theo danh mục (giống gắn mẫu: quyền bắt buộc hạn → 365 ngày).
create or replace function app_private.center_new_grant_expiry(p_permission_code text, p_scope_type text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when a.direct_grant_requires_expiry and not (p_scope_type = 'own' and a.risk_level <> 'sensitive')
    then now() + interval '365 days' end
  from public.permission_actions a where a.permission_code = p_permission_code;
$$;

-- Câu lỗi dễ hiểu cho danh sách "chưa làm được".
create or replace function app_private.center_error_text(p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message ~* 'SoD warning acknowledgement required' then 'Chạm luật kiêm nhiệm — cần ghi nhận'
    when p_message ~* 'Invalid SoD warning control evidence' then 'Ghi nhận kiêm nhiệm chưa đủ (người kiểm soát phải khác người được cấp)'
    when p_message ~* 'hard SoD rule|Sensitive self-grant' then 'Không tự cấp quyền nhạy cảm cho chính mình'
    when p_message ~* 'Active target user required' then 'Tài khoản đã khóa'
    when p_message ~* 'expiry' then 'Quyền cần ngày hết hạn hợp lệ'
    when p_message ~* 'Direct permission grant is not allowed' then 'Quyền này không cấp riêng được'
    else p_message end;
$$;

revoke all on function app_private.center_acceptances(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.center_current_grants(uuid) from public, anon, authenticated;
revoke all on function app_private.center_new_grant_expiry(text, text) from public, anon, authenticated;
revoke all on function app_private.center_error_text(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Hàng loạt: gắn mẫu, tích / bỏ ô, gia hạn quyền sắp hết hạn, thêm một quyền
-- ---------------------------------------------------------------------------------------------
-- Kế hoạch cho một người: {skip, note, add, remove, warnings, templateCode, options, grants}.
create or replace function app_private.center_bulk_plan(p_user_id uuid, p_action jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := p_action ->> 'kind';
  v_assignment public.user_template_assignments%rowtype;
  v_template public.user_permission_templates%rowtype;
  v_code text;
  v_options text[];
  v_preview jsonb;
  v_next jsonb;
  v_count integer;
  v_permission text;
  v_scope text;
  v_action public.permission_actions%rowtype;
begin
  select * into v_assignment from public.user_template_assignments where user_id = p_user_id;

  if v_kind in ('template', 'option') then
    if v_kind = 'template' then
      v_code := p_action ->> 'templateCode';
      v_options := array(select jsonb_array_elements_text(coalesce(p_action -> 'options', '[]'::jsonb)));
      select * into v_template from public.user_permission_templates where code = v_code and is_active;
      if v_template.code is null then raise exception 'PERMISSION_TEMPLATE_NOT_FOUND' using errcode = '22023'; end if;
      v_options := array(select o from unnest(v_options) o where o = any(v_template.options));
      if v_assignment.template_code = v_code and v_assignment.options @> v_options and v_assignment.options <@ v_options then
        return jsonb_build_object('skip', true, 'note', 'Đã theo mẫu này');
      end if;
    else
      if v_assignment.user_id is null then return jsonb_build_object('skip', true, 'note', 'Chưa theo mẫu nào'); end if;
      v_code := v_assignment.template_code;
      select * into v_template from public.user_permission_templates where code = v_code;
      if not (p_action ->> 'optionKey') = any(v_template.options) then
        return jsonb_build_object('skip', true, 'note', 'Mẫu ' || v_template.name || ' không có ô này');
      end if;
      if coalesce((p_action ->> 'on')::boolean, true) then
        if (p_action ->> 'optionKey') = any(v_assignment.options) then return jsonb_build_object('skip', true, 'note', 'Đã tích sẵn'); end if;
        v_options := v_assignment.options || array[p_action ->> 'optionKey'];
      else
        if not (p_action ->> 'optionKey') = any(v_assignment.options) then return jsonb_build_object('skip', true, 'note', 'Chưa tích'); end if;
        v_options := array_remove(v_assignment.options, p_action ->> 'optionKey');
      end if;
    end if;
    v_preview := public.preview_user_template_assignment_v1(p_user_id, v_code, v_options);
    return jsonb_build_object('skip', false, 'templateCode', v_code, 'options', to_jsonb(v_options),
      'add', jsonb_array_length(v_preview -> 'add'), 'remove', jsonb_array_length(v_preview -> 'remove'),
      'warnings', coalesce(v_preview -> 'sod' -> 'warnings', '[]'::jsonb));
  end if;

  if v_kind = 'extend' then
    select count(*) into v_count from public.user_permission_grants g
    where g.user_id = p_user_id and g.is_active and g.expires_at > now()
      and g.expires_at < now() + make_interval(days => coalesce((p_action ->> 'withinDays')::int, 30));
    if v_count = 0 then return jsonb_build_object('skip', true, 'note', 'Không có quyền sắp hết hạn'); end if;
    select coalesce(jsonb_agg(jsonb_build_object('permission_code', g.permission_code, 'scope_type', g.scope_type, 'scope_id', g.scope_id,
      'expires_at', case when g.expires_at < now() + make_interval(days => coalesce((p_action ->> 'withinDays')::int, 30))
        then now() + interval '365 days' else g.expires_at end, 'is_active', true)), '[]'::jsonb)
    into v_next
    from public.user_permission_grants g
    where g.user_id = p_user_id and g.is_active and (g.expires_at is null or g.expires_at > now());
    return jsonb_build_object('skip', false, 'add', 0, 'remove', 0, 'extended', v_count, 'grants', v_next, 'warnings', '[]'::jsonb);
  end if;

  if v_kind = 'add' then
    v_permission := p_action ->> 'permissionCode';
    v_scope := coalesce(nullif(p_action ->> 'scopeType', ''), 'global');
    select * into v_action from public.permission_actions where permission_code = v_permission and is_active;
    if v_action.id is null or not v_action.direct_grant_allowed then
      return jsonb_build_object('skip', true, 'note', 'Quyền này không cấp riêng được');
    end if;
    if exists (select 1 from public.user_permission_grants g where g.user_id = p_user_id and g.is_active and g.permission_code = v_permission
               and g.scope_type = v_scope and g.scope_id = '*' and (g.expires_at is null or g.expires_at > now())) then
      return jsonb_build_object('skip', true, 'note', 'Đã có quyền này');
    end if;
    v_next := app_private.center_current_grants(p_user_id) || jsonb_build_array(jsonb_build_object('permission_code', v_permission,
      'scope_type', v_scope, 'scope_id', '*', 'expires_at', app_private.center_new_grant_expiry(v_permission, v_scope), 'is_active', true));
    return jsonb_build_object('skip', false, 'add', 1, 'remove', 0, 'grants', v_next,
      'warnings', coalesce(app_private.describe_sod_decision(
        app_private.evaluate_direct_grant_replacement_impl(public.current_app_user_id(), p_user_id, v_next), p_user_id) -> 'warnings', '[]'::jsonb));
  end if;

  raise exception 'BULK_ACTION_INVALID' using errcode = '22023';
end;
$$;

revoke all on function app_private.center_bulk_plan(uuid, jsonb) from public, anon, authenticated;

create or replace function public.preview_bulk_permission_change_v1(p_user_ids uuid[], p_action jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_user record;
  v_plan jsonb;
begin
  perform app_private.assert_authorization_permission('system.authorization.manage_grants');
  for v_user in
    select u.id, u.name, t.name as template_name
    from public.users u
    left join public.user_template_assignments a on a.user_id = u.id
    left join public.user_permission_templates t on t.code = a.template_code
    where u.id = any(coalesce(p_user_ids, '{}')) and u.is_active and u.account_status = 'ACTIVE' and u.role <> 'ADMIN'
    order by u.name
  loop
    begin
      v_plan := app_private.center_bulk_plan(v_user.id, p_action);
    exception when others then
      v_plan := jsonb_build_object('skip', true, 'note', app_private.center_error_text(sqlerrm));
    end;
    v_rows := v_rows || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'fromTemplate', v_user.template_name,
      'toTemplate', (select t.name from public.user_permission_templates t where t.code = v_plan ->> 'templateCode'),
      'skip', coalesce((v_plan ->> 'skip')::boolean, false), 'note', v_plan ->> 'note',
      'add', coalesce((v_plan ->> 'add')::int, 0), 'remove', coalesce((v_plan ->> 'remove')::int, 0),
      'extended', coalesce((v_plan ->> 'extended')::int, 0), 'warnings', coalesce(v_plan -> 'warnings', '[]'::jsonb));
  end loop;
  return jsonb_build_object('rows', v_rows);
end;
$$;

create or replace function public.apply_bulk_permission_change_v1(p_user_ids uuid[], p_action jsonb, p_reason text, p_ack jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_authorization_permission('system.authorization.manage_grants');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_user record;
  v_plan jsonb;
  v_result jsonb;
  v_done jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if char_length(v_reason) < 10 then raise exception 'Direct permission grant change reason required' using errcode = '22023'; end if;
  for v_user in
    select u.id, u.name from public.users u
    where u.id = any(coalesce(p_user_ids, '{}')) and u.is_active and u.account_status = 'ACTIVE' and u.role <> 'ADMIN' order by u.name
  loop
    begin
      v_plan := app_private.center_bulk_plan(v_user.id, p_action);
      if coalesce((v_plan ->> 'skip')::boolean, false) then
        v_skipped := v_skipped || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'note', v_plan ->> 'note');
        continue;
      end if;
      if v_plan ? 'templateCode' then
        v_result := public.save_user_template_assignment_v1(v_user.id, v_plan ->> 'templateCode',
          array(select jsonb_array_elements_text(v_plan -> 'options')), v_reason, app_private.center_acceptances(v_plan -> 'warnings', p_ack));
        v_done := v_done || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'added', v_result -> 'added', 'removed', v_result -> 'removed');
      else
        perform app_private.replace_user_permission_grants_v2_impl(v_user.id, v_plan -> 'grants', v_reason,
          app_private.center_acceptances(v_plan -> 'warnings', p_ack));
        perform app_private.adopt_user_template_state(v_user.id);
        v_done := v_done || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'added', v_plan -> 'add', 'removed', 0,
          'extended', coalesce(v_plan -> 'extended', '0'::jsonb));
      end if;
    exception when others then
      v_failed := v_failed || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'error', app_private.center_error_text(sqlerrm));
    end;
  end loop;

  return jsonb_build_object('done', v_done, 'failed', v_failed, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Sao chép quyền từ một người sang một hoặc nhiều người
-- ---------------------------------------------------------------------------------------------
-- Quyền riêng của người nguồn sẽ chép: ngoài mẫu (phạm vi toàn công ty) và / hoặc thủ kho theo kho.
create or replace function app_private.center_copy_source_grants(p_from uuid, p_extra boolean, p_warehouses boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with src as (
    select a.template_code, a.options, t.items, t.options as t_options from public.user_template_assignments a
    join public.user_permission_templates t on t.code = a.template_code where a.user_id = p_from
  ), keys as (
    select coalesce((select app_private.permission_item_keys(app_private.permission_template_desired_items(items, t_options, options, '[]'::jsonb)) from src), '{}') as k
  )
  select coalesce(jsonb_agg(jsonb_build_object('permission_code', g.permission_code, 'scope_type', g.scope_type, 'scope_id', g.scope_id,
    'risk_level', act.risk_level)), '[]'::jsonb)
  from public.user_permission_grants g
  join public.permission_actions act on act.permission_code = g.permission_code and act.direct_grant_allowed
  cross join keys
  where g.user_id = p_from and g.is_active and (g.expires_at is null or g.expires_at > now())
    and ((p_extra and g.scope_id = '*' and g.permission_code <> 'wms.transaction.keeper' and (g.permission_code || '@' || g.scope_type) <> all(keys.k))
      or (p_warehouses and g.permission_code = 'wms.transaction.keeper' and g.scope_type = 'warehouse'));
$$;

-- Bộ quyền của người nhận sau khi thêm quyền chép (giữ nguyên quyền đang có).
create or replace function app_private.center_copy_next_grants(p_to uuid, p_source jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.center_current_grants(p_to) || coalesce((
    select jsonb_agg(jsonb_build_object('permission_code', s ->> 'permission_code', 'scope_type', s ->> 'scope_type', 'scope_id', s ->> 'scope_id',
      'expires_at', app_private.center_new_grant_expiry(s ->> 'permission_code', s ->> 'scope_type'), 'is_active', true))
    from jsonb_array_elements(p_source) s
    where not exists (select 1 from public.user_permission_grants g where g.user_id = p_to and g.is_active
      and g.permission_code = s ->> 'permission_code' and g.scope_type = s ->> 'scope_type' and g.scope_id = s ->> 'scope_id'
      and (g.expires_at is null or g.expires_at > now()))), '[]'::jsonb);
$$;

-- Bộ quyền cuối cùng khi chép cả mẫu lẫn quyền riêng: xét kiêm nhiệm trên tổ hợp (mẫu kế toán + thủ kho mới chạm luật).
create or replace function app_private.center_copy_final_grants(p_to uuid, p_template_code text, p_options text[], p_source jsonb)
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
  v_remove text[];
  v_base jsonb;
begin
  if p_template_code is null then
    v_base := app_private.center_current_grants(p_to);
  else
    select * into v_template from public.user_permission_templates where code = p_template_code;
    select * into v_assignment from public.user_template_assignments where user_id = p_to;
    v_desired := app_private.permission_template_desired_items(v_template.items, v_template.options, p_options,
      case when v_assignment.template_code = p_template_code then v_assignment.excluded else '[]'::jsonb end);
    select coalesce(array_agg(k), '{}') into v_remove
    from unnest(app_private.permission_item_keys(coalesce(v_assignment.applied, '[]'::jsonb))) k
    where k <> all(app_private.permission_item_keys(v_desired));
    v_base := app_private.template_next_grants(p_to, v_desired, v_remove);
  end if;
  return v_base || coalesce((
    select jsonb_agg(jsonb_build_object('permission_code', s ->> 'permission_code', 'scope_type', s ->> 'scope_type', 'scope_id', s ->> 'scope_id',
      'expires_at', app_private.center_new_grant_expiry(s ->> 'permission_code', s ->> 'scope_type'), 'is_active', true))
    from jsonb_array_elements(coalesce(p_source, '[]'::jsonb)) s
    where not exists (select 1 from jsonb_array_elements(v_base) b where b ->> 'permission_code' = s ->> 'permission_code'
      and b ->> 'scope_type' = s ->> 'scope_type' and b ->> 'scope_id' = s ->> 'scope_id')), '[]'::jsonb);
end;
$$;

revoke all on function app_private.center_copy_source_grants(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function app_private.center_copy_next_grants(uuid, jsonb) from public, anon, authenticated;
revoke all on function app_private.center_copy_final_grants(uuid, text, text[], jsonb) from public, anon, authenticated;

create or replace function public.preview_copy_permissions_v1(p_from uuid, p_to uuid[], p_what jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_authorization_permission('system.authorization.manage_grants');
  v_src public.user_template_assignments%rowtype;
  v_src_name text;
  v_source jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_user record;
  v_lines jsonb;
  v_warnings jsonb;
  v_preview jsonb;
  v_next jsonb;
  v_new integer;
  v_sensitive integer;
  v_rooms integer;
  v_template_changes boolean;
begin
  select * into v_src from public.user_template_assignments where user_id = p_from;
  select name into v_src_name from public.users where id = p_from;
  v_source := app_private.center_copy_source_grants(p_from, coalesce((p_what ->> 'extra')::boolean, false), coalesce((p_what ->> 'warehouses')::boolean, false));

  for v_user in
    select u.id, u.name, a.template_code, a.options from public.users u left join public.user_template_assignments a on a.user_id = u.id
    where u.id = any(coalesce(p_to, '{}')) and u.id <> p_from and u.is_active and u.account_status = 'ACTIVE' and u.role <> 'ADMIN' order by u.name
  loop
    v_lines := '[]'::jsonb; v_warnings := '[]'::jsonb; v_new := 0; v_template_changes := false;
    if coalesce((p_what ->> 'template')::boolean, false) and v_src.user_id is not null then
      if v_user.template_code = v_src.template_code and v_user.options @> v_src.options and v_user.options <@ v_src.options then
        v_lines := v_lines || jsonb_build_object('text', 'Mẫu: giữ ' || (select name from public.user_permission_templates where code = v_src.template_code), 'tone', 'muted');
      else
        v_preview := public.preview_user_template_assignment_v1(v_user.id, v_src.template_code, v_src.options);
        v_lines := v_lines || jsonb_build_object('text', 'Mẫu: ' || coalesce((select name from public.user_permission_templates where code = v_user.template_code), 'chưa có')
          || ' → ' || (select name from public.user_permission_templates where code = v_src.template_code)
          || ' (thêm ' || jsonb_array_length(v_preview -> 'add') || ', gỡ ' || jsonb_array_length(v_preview -> 'remove') || ')', 'tone', 'ok');
        v_template_changes := true;
      end if;
    end if;
    if jsonb_array_length(v_source) > 0 then
      v_next := app_private.center_copy_next_grants(v_user.id, v_source);
      v_new := jsonb_array_length(v_next) - jsonb_array_length(app_private.center_current_grants(v_user.id));
      select count(*) into v_sensitive from jsonb_array_elements(v_source) s
      where s ->> 'risk_level' = 'sensitive' and not exists (select 1 from public.user_permission_grants g where g.user_id = v_user.id and g.is_active
        and g.permission_code = s ->> 'permission_code' and g.scope_type = s ->> 'scope_type' and g.scope_id = s ->> 'scope_id');
      v_lines := v_lines || jsonb_build_object('text', case when v_new > 0 then '+ ' || v_new || ' quyền riêng' || case when v_sensitive > 0 then ', có ' || v_sensitive || ' quyền nhạy cảm' else '' end
        else 'Quyền riêng: đã có đủ' end, 'tone', case when v_sensitive > 0 then 'warn' when v_new > 0 then 'ok' else 'muted' end);
    end if;
    if v_template_changes or v_new > 0 then
      v_warnings := coalesce(app_private.describe_sod_decision(app_private.evaluate_direct_grant_replacement_impl(v_actor, v_user.id,
        app_private.center_copy_final_grants(v_user.id, case when v_template_changes then v_src.template_code end, v_src.options, v_source)),
        v_user.id) -> 'warnings', '[]'::jsonb);
    end if;
    if coalesce((p_what ->> 'room')::boolean, false) then
      select count(distinct (s.project_id, s.construction_site_id)) into v_rooms
      from public.project_staff s
      where s.user_id = p_from::text and s.end_date is null
        and not exists (select 1 from public.project_staff t where t.user_id = v_user.id::text and t.end_date is null
          and t.project_id is not distinct from s.project_id and t.construction_site_id is not distinct from s.construction_site_id);
      v_lines := v_lines || jsonb_build_object('text', case when v_rooms > 0 then 'Room: thêm vào ' || v_rooms || ' dự án, cùng vị trí và vai trò' else 'Room: đã ở cùng các dự án (chép vai trò)' end,
        'tone', case when v_rooms > 0 then 'ok' else 'muted' end);
    end if;
    if jsonb_array_length(v_lines) = 0 then v_lines := jsonb_build_array(jsonb_build_object('text', 'Không có gì để chép với lựa chọn hiện tại', 'tone', 'muted')); end if;
    v_rows := v_rows || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'lines', v_lines, 'warnings', v_warnings);
  end loop;
  return jsonb_build_object('from', v_src_name, 'sourceGrants', jsonb_array_length(v_source), 'rows', v_rows);
end;
$$;

-- Chép vai trò Room: người nhận vào cùng dự án / công trường, cùng vị trí, cùng các phòng và hành động (giữ thành viên khác).
create or replace function app_private.center_copy_rooms(p_from uuid, p_to uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src record;
  v_target_staff uuid;
  v_room record;
  v_members jsonb;
  v_count integer := 0;
begin
  for v_src in
    select s.* from public.project_staff s where s.user_id = p_from::text and s.end_date is null
  loop
    select t.id into v_target_staff from public.project_staff t
    where t.user_id = p_to::text and t.end_date is null
      and t.project_id is not distinct from v_src.project_id and t.construction_site_id is not distinct from v_src.construction_site_id
    limit 1;
    if v_target_staff is null then
      v_target_staff := public.upsert_project_staff_assignment(jsonb_build_object('project_id', v_src.project_id,
        'construction_site_id', v_src.construction_site_id, 'user_id', p_to::text, 'position_id', v_src.position_id));
      v_count := v_count + 1;
    end if;
    -- Hành động "chỉ ghi nhận" (audit_only) không cấp mới được nên không chép.
    for v_room in
      select m.project_id, m.construction_site_id, m.room_code,
        coalesce(array_agg(a.action_code) filter (where a.is_active and not exists (
          select 1 from app_private.project_permission_room_action_bindings b
          where b.room_code = m.room_code and b.action_code = a.action_code and b.enforcement_status = 'audit_only')), '{}') as actions
      from public.project_permission_room_members m
      left join public.project_permission_room_member_actions a on a.room_member_id = m.id
      where m.project_staff_id = v_src.id and m.is_active
      group by m.project_id, m.construction_site_id, m.room_code
      having count(a.action_code) filter (where a.is_active) > 0
    loop
      select coalesce(jsonb_agg(jsonb_build_object('project_staff_id', x.staff_id, 'action_codes', to_jsonb(x.actions))), '[]'::jsonb)
      into v_members
      from (
        select m.project_staff_id as staff_id,
          array(select distinct c from unnest(coalesce(array_agg(a.action_code) filter (where a.is_active), '{}')
            || case when m.project_staff_id = v_target_staff then v_room.actions else '{}'::text[] end) c order by c) as actions
        from public.project_permission_room_members m
        left join public.project_permission_room_member_actions a on a.room_member_id = m.id
        where m.project_id = v_room.project_id and m.construction_site_id is not distinct from v_room.construction_site_id
          and m.room_code = v_room.room_code and m.is_active
        group by m.project_staff_id
        union all
        select v_target_staff, v_room.actions
        where not exists (select 1 from public.project_permission_room_members m where m.project_id = v_room.project_id
          and m.construction_site_id is not distinct from v_room.construction_site_id and m.room_code = v_room.room_code
          and m.project_staff_id = v_target_staff and m.is_active)
      ) x;
      perform public.replace_project_permission_room_members(v_room.project_id, v_room.construction_site_id, v_room.room_code, v_members);
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function app_private.center_copy_rooms(uuid, uuid) from public, anon, authenticated;

create or replace function public.apply_copy_permissions_v1(p_from uuid, p_to uuid[], p_what jsonb, p_reason text, p_ack jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_authorization_permission('system.authorization.manage_grants');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_src public.user_template_assignments%rowtype;
  v_source jsonb;
  v_user record;
  v_preview jsonb;
  v_next jsonb;
  v_warnings jsonb;
  v_added integer;
  v_rooms integer;
  v_done jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
begin
  if char_length(v_reason) < 10 then raise exception 'Direct permission grant change reason required' using errcode = '22023'; end if;
  select * into v_src from public.user_template_assignments where user_id = p_from;
  v_source := app_private.center_copy_source_grants(p_from, coalesce((p_what ->> 'extra')::boolean, false), coalesce((p_what ->> 'warehouses')::boolean, false));

  for v_user in
    select u.id, u.name from public.users u
    where u.id = any(coalesce(p_to, '{}')) and u.id <> p_from and u.is_active and u.account_status = 'ACTIVE' and u.role <> 'ADMIN' order by u.name
  loop
    begin
      v_added := 0; v_rooms := 0;
      if coalesce((p_what ->> 'template')::boolean, false) and v_src.user_id is not null then
        v_preview := public.preview_user_template_assignment_v1(v_user.id, v_src.template_code, v_src.options);
        v_added := v_added + coalesce((public.save_user_template_assignment_v1(v_user.id, v_src.template_code, v_src.options, v_reason,
          app_private.center_acceptances(v_preview -> 'sod' -> 'warnings', p_ack)) ->> 'added')::int, 0);
      end if;
      if jsonb_array_length(v_source) > 0 then
        v_next := app_private.center_copy_next_grants(v_user.id, v_source);
        if jsonb_array_length(v_next) > jsonb_array_length(app_private.center_current_grants(v_user.id)) then
          v_warnings := coalesce(app_private.describe_sod_decision(
            app_private.evaluate_direct_grant_replacement_impl(v_actor, v_user.id, v_next), v_user.id) -> 'warnings', '[]'::jsonb);
          v_added := v_added + jsonb_array_length(v_next) - jsonb_array_length(app_private.center_current_grants(v_user.id));
          perform app_private.replace_user_permission_grants_v2_impl(v_user.id, v_next, v_reason, app_private.center_acceptances(v_warnings, p_ack));
          perform app_private.adopt_user_template_state(v_user.id);
        end if;
      end if;
      if coalesce((p_what ->> 'room')::boolean, false) then
        v_rooms := app_private.center_copy_rooms(p_from, v_user.id);
      end if;
      v_done := v_done || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'added', v_added, 'rooms', v_rooms);
    exception when others then
      v_failed := v_failed || jsonb_build_object('userId', v_user.id, 'name', v_user.name, 'error', app_private.center_error_text(sqlerrm));
    end;
  end loop;

  return jsonb_build_object('done', v_done, 'failed', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Nhật ký phân quyền (người quản lý phân quyền): ai đổi gì của ai, vì sao.
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
        'work_pilot_access_granted', 'work_pilot_access_revoked') then 'change'
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
      'tier', e.metadata ->> 'tier') as r
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

revoke all on function public.preview_bulk_permission_change_v1(uuid[], jsonb) from public, anon;
revoke all on function public.apply_bulk_permission_change_v1(uuid[], jsonb, text, jsonb) from public, anon;
revoke all on function public.preview_copy_permissions_v1(uuid, uuid[], jsonb) from public, anon;
revoke all on function public.apply_copy_permissions_v1(uuid, uuid[], jsonb, text, jsonb) from public, anon;
revoke all on function public.list_permission_audit_v1(integer, timestamptz, text, uuid) from public, anon;
grant execute on function public.preview_bulk_permission_change_v1(uuid[], jsonb) to authenticated;
grant execute on function public.apply_bulk_permission_change_v1(uuid[], jsonb, text, jsonb) to authenticated;
grant execute on function public.preview_copy_permissions_v1(uuid, uuid[], jsonb) to authenticated;
grant execute on function public.apply_copy_permissions_v1(uuid, uuid[], jsonb, text, jsonb) to authenticated;
grant execute on function public.list_permission_audit_v1(integer, timestamptz, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Hạn quyền cho tab Kiểm soát: hạn gần nhất và số quyền hết hạn trong 30 / 90 ngày.
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_permission_expiry_overview_v1()
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
  return (
    select jsonb_build_object('nextExpiry', min(g.expires_at),
      'within30', count(*) filter (where g.expires_at < now() + interval '30 days'),
      'within90', count(*) filter (where g.expires_at < now() + interval '90 days'))
    from public.user_permission_grants g
    join public.users u on u.id = g.user_id and u.is_active and u.account_status = 'ACTIVE'
    where g.is_active and g.expires_at > now());
end;
$$;

revoke all on function public.get_permission_expiry_overview_v1() from public, anon;
grant execute on function public.get_permission_expiry_overview_v1() to authenticated;
