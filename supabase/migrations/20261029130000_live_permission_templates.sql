-- Đợt 2b audit mẫu quyền (chủ SP duyệt 23/10/2026): mẫu quyền thành "gói sống".
-- 1) Gắn người với một mẫu (user_template_assignments). Sửa mẫu → mọi người đang theo mẫu được cập nhật.
-- 2) Ô tùy chọn theo từng người trong mẫu (permission_template_option_defs): "Duyệt PO" = system.procurement.approve;
--    mẫu bật ô nào thì Admin tích ô đó cho người cần.
-- 3) Chỉnh riêng vẫn giữ: quyền Admin bỏ khỏi một người không bị mẫu cấp lại (excluded); quyền thêm riêng không
--    thuộc mẫu thì mẫu không đụng tới (mẫu chỉ gỡ những gì chính nó đã cấp — cột applied).
-- 4) Mọi thay đổi quyền đi qua replace_user_permission_grants_v2_impl (kiểm quyền người làm, hạn dùng, luật kiêm
--    nhiệm, nhật ký). Người chạm luật kiêm nhiệm cần xác nhận thì không bị ép: bỏ qua và báo lại.
-- Chưa gắn ai: gắn hàng loạt ở Đợt 3. Chưa làm: gói kèm vai trò HR, AI, Room, kho.

-- ---------------------------------------------------------------------------------------------
-- 1. Ô tùy chọn theo từng người
-- ---------------------------------------------------------------------------------------------
create table public.permission_template_option_defs (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (length(btrim(label)) between 2 and 80),
  description text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  sort_order integer not null default 100,
  is_active boolean not null default true
);
alter table public.permission_template_option_defs enable row level security;
create policy permission_template_option_defs_select on public.permission_template_option_defs
  for select to authenticated using (true);
revoke insert, update, delete on public.permission_template_option_defs from anon, authenticated;

insert into public.permission_template_option_defs (key, label, description, items, sort_order)
values ('po_approver', 'Duyệt PO',
  'Người được chọn duyệt PO, đơn gọi hàng vượt hạn mức HĐ nguyên tắc, mua nóng khi công trường không có Chỉ huy trưởng.',
  '[{"permissionCode": "system.procurement.approve", "scopeType": "global"}]'::jsonb, 10)
on conflict (key) do nothing;

alter table public.user_permission_templates add column if not exists options text[] not null default '{}';

-- Bật ô Duyệt PO cho các mẫu có người duyệt PO: mua hàng / vật tư, quản lý kho (phó phòng VTTB), Ban giám đốc.
update public.user_permission_templates
set options = array(select distinct unnest(options || array['po_approver']))
where code in ('material_staff', 'warehouse_manager', 'executive');

-- ---------------------------------------------------------------------------------------------
-- 2. Gắn người với mẫu
-- ---------------------------------------------------------------------------------------------
create table public.user_template_assignments (
  user_id uuid primary key references public.users(id) on delete cascade,
  template_code text not null references public.user_permission_templates(code) on update cascade on delete restrict,
  options text[] not null default '{}',
  -- Quyền của mẫu mà Admin đã bỏ riêng cho người này: [{permissionCode, scopeType}].
  excluded jsonb not null default '[]'::jsonb check (jsonb_typeof(excluded) = 'array'),
  -- Quyền đang do mẫu quản lý cho người này (lần đồng bộ gần nhất): [{permissionCode, scopeType}].
  applied jsonb not null default '[]'::jsonb check (jsonb_typeof(applied) = 'array'),
  assigned_by uuid references public.users(id),
  assigned_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
create index user_template_assignments_template_idx on public.user_template_assignments (template_code);
alter table public.user_template_assignments enable row level security;
create policy user_template_assignments_select on public.user_template_assignments
  for select to authenticated
  using (user_id = (select public.current_app_user_id()) or (select app_private.can_manage_permissions()));
revoke insert, update, delete on public.user_template_assignments from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Tính quyền mong muốn và đồng bộ
-- ---------------------------------------------------------------------------------------------
-- Quyền mẫu cần cấp: quyền trong mẫu + quyền của các ô người này được tích (ô phải đang bật trong mẫu),
-- trừ quyền Admin đã bỏ riêng; chỉ giữ quyền còn cấp trực tiếp được (bỏ quyền nhân sự chỉ cấp qua vai trò HR).
create or replace function app_private.permission_template_desired_items(
  p_items jsonb, p_template_options text[], p_assignment_options text[], p_excluded jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with raw as (
    select x."permissionCode" as pc, coalesce(nullif(x."scopeType", ''), 'global') as st, x."expiresInDays" as days
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) x("permissionCode" text, "scopeType" text, "expiresInDays" integer)
    union all
    select x."permissionCode", coalesce(nullif(x."scopeType", ''), 'global'), null::integer
    from public.permission_template_option_defs option_def
    cross join jsonb_to_recordset(option_def.items) x("permissionCode" text, "scopeType" text)
    where option_def.is_active
      and option_def.key = any(coalesce(p_template_options, '{}'))
      and option_def.key = any(coalesce(p_assignment_options, '{}'))
  ), wanted as (
    select pc, st, max(days) as days from raw where pc is not null group by pc, st
  )
  select coalesce(jsonb_agg(jsonb_build_object('permissionCode', w.pc, 'scopeType', w.st, 'expiresInDays', w.days)
    order by w.pc, w.st), '[]'::jsonb)
  from wanted w
  join public.permission_actions action_row
    on action_row.permission_code = w.pc and action_row.is_active and action_row.direct_grant_allowed
   and w.st = any(action_row.scope_modes)
  where not app_private.is_hrm_template_only_permission(w.pc)
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_excluded, '[]'::jsonb)) e
      where e ->> 'permissionCode' = w.pc and coalesce(nullif(e ->> 'scopeType', ''), 'global') = w.st
    );
$$;

-- Khóa so sánh "mã@phạm vi" của một danh sách quyền.
create or replace function app_private.permission_item_keys(p_items jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct (e ->> 'permissionCode') || '@' || coalesce(nullif(e ->> 'scopeType', ''), 'global')), '{}')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e;
$$;

-- Thêm / gỡ quyền của một người qua đúng đường lưu quyền chuẩn (kiểm người làm, hạn, kiêm nhiệm, nhật ký).
-- Chỉ gỡ quyền phạm vi '*' do mẫu cấp; giữ nguyên mọi quyền khác của người đó.
create or replace function app_private.apply_template_grant_changes(
  p_user_id uuid, p_add jsonb, p_remove_keys text[], p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next jsonb;
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

  select coalesce(jsonb_agg(row_json), '[]'::jsonb) into v_next
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

  perform app_private.replace_user_permission_grants_v2_impl(p_user_id, v_next, p_reason, '[]'::jsonb);
  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$$;

-- Đồng bộ một người theo mẫu đang gắn: thêm quyền mẫu còn thiếu, gỡ quyền mẫu đã cấp nhưng mẫu không còn.
create or replace function app_private.sync_user_template_assignment(p_user_id uuid, p_reason text)
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

  v_result := app_private.apply_template_grant_changes(p_user_id, v_desired, v_remove, p_reason);

  update public.user_template_assignments
  set applied = (select coalesce(jsonb_agg(jsonb_build_object('permissionCode', d ->> 'permissionCode', 'scopeType', d ->> 'scopeType')), '[]'::jsonb)
                 from jsonb_array_elements(v_desired) d),
      updated_by = public.current_app_user_id(), updated_at = now()
  where user_id = p_user_id;
  return v_result;
end;
$$;

-- Sau khi Admin lưu quyền một người đang theo mẫu: quyền mẫu người đó không còn = Admin bỏ riêng (excluded);
-- quyền đã bỏ riêng mà nay có lại = Admin thêm lại. Không đổi quyền nào.
create or replace function app_private.adopt_user_template_state(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.user_template_assignments%rowtype;
  v_template public.user_permission_templates%rowtype;
  v_full jsonb;
  v_active text[];
begin
  select * into v_assignment from public.user_template_assignments where user_id = p_user_id for update;
  if v_assignment.user_id is null then return; end if;
  select * into v_template from public.user_permission_templates where code = v_assignment.template_code;
  v_full := app_private.permission_template_desired_items(v_template.items, v_template.options, v_assignment.options, '[]'::jsonb);
  select coalesce(array_agg(g.permission_code || '@' || g.scope_type), '{}') into v_active
  from public.user_permission_grants g
  where g.user_id = p_user_id and g.is_active and g.scope_id = '*' and (g.expires_at is null or g.expires_at > now());

  update public.user_template_assignments
  set excluded = (select coalesce(jsonb_agg(jsonb_build_object('permissionCode', f ->> 'permissionCode', 'scopeType', f ->> 'scopeType')), '[]'::jsonb)
                  from jsonb_array_elements(v_full) f
                  where (f ->> 'permissionCode') || '@' || (f ->> 'scopeType') <> all(v_active)),
      applied = (select coalesce(jsonb_agg(jsonb_build_object('permissionCode', f ->> 'permissionCode', 'scopeType', f ->> 'scopeType')), '[]'::jsonb)
                 from jsonb_array_elements(v_full) f
                 where (f ->> 'permissionCode') || '@' || (f ->> 'scopeType') = any(v_active)),
      updated_by = public.current_app_user_id(), updated_at = now()
  where user_id = p_user_id;
end;
$$;

revoke all on function app_private.permission_template_desired_items(jsonb, text[], text[], jsonb) from public, anon, authenticated;
revoke all on function app_private.permission_item_keys(jsonb) from public, anon, authenticated;
revoke all on function app_private.apply_template_grant_changes(uuid, jsonb, text[], text) from public, anon, authenticated;
revoke all on function app_private.sync_user_template_assignment(uuid, text) from public, anon, authenticated;
revoke all on function app_private.adopt_user_template_state(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Lệnh cho màn hình
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_user_template_assignment_v1(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_user_id = public.current_app_user_id() or app_private.can_manage_permissions() then (
    select jsonb_build_object('userId', a.user_id, 'templateCode', a.template_code, 'templateName', t.name,
      'options', to_jsonb(a.options), 'excluded', a.excluded, 'applied', a.applied,
      'assignedAt', a.assigned_at, 'updatedAt', a.updated_at,
      'assignedByName', (select u.name from public.users u where u.id = a.assigned_by))
    from public.user_template_assignments a
    join public.user_permission_templates t on t.code = a.template_code
    where a.user_id = p_user_id
  ) end;
$$;

-- Xem trước khi gắn / đổi mẫu cho một người: quyền sẽ thêm, quyền mẫu cũ sẽ gỡ.
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
    'excludedCount', jsonb_array_length(v_excluded));
end;
$$;

-- Gắn / đổi mẫu cho một người và cấp ngay theo mẫu. Đổi sang mẫu khác thì bỏ các lựa chọn bỏ riêng của mẫu cũ.
create or replace function public.save_user_template_assignment_v1(p_user_id uuid, p_template_code text, p_options text[], p_reason text)
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

  v_result := app_private.sync_user_template_assignment(p_user_id, v_reason);

  insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
  values (v_actor, p_user_id, 'user_template_assignment_saved',
    case when v_previous.user_id is null then '{}'::jsonb
      else jsonb_build_object('templateCode', v_previous.template_code, 'options', to_jsonb(v_previous.options)) end,
    jsonb_build_object('templateCode', p_template_code, 'options', to_jsonb(v_options)),
    jsonb_build_object('reason', v_reason, 'added', v_result -> 'added', 'removed', v_result -> 'removed'));
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('templateCode', p_template_code, 'options', to_jsonb(v_options));
end;
$$;

-- Bỏ liên kết: giữ nguyên quyền hiện có, người đó thôi tự cập nhật theo mẫu.
create or replace function public.remove_user_template_assignment_v1(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_authorization_permission('system.authorization.manage_grants');
  v_previous public.user_template_assignments%rowtype;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Direct permission grant change reason required' using errcode = '22023';
  end if;
  delete from public.user_template_assignments where user_id = p_user_id returning * into v_previous;
  if v_previous.user_id is null then return; end if;
  insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
  values (v_actor, p_user_id, 'user_template_assignment_removed',
    jsonb_build_object('templateCode', v_previous.template_code, 'options', to_jsonb(v_previous.options)), '{}'::jsonb,
    jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- Xem trước khi lưu mẫu: những người đang theo mẫu sẽ được thêm / gỡ quyền gì.
create or replace function public.preview_permission_template_change_v1(p_code text, p_items jsonb, p_options text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_TEMPLATE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  v_items := app_private.normalize_user_permission_template_items(p_items);
  select coalesce(jsonb_agg(row_json order by row_json ->> 'name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object('userId', a.user_id, 'name', u.name,
      'add', to_jsonb(array(select k from unnest(app_private.permission_item_keys(desired.items)) k
                            where k <> all(app_private.permission_item_keys(a.applied)) order by k)),
      'remove', to_jsonb(array(select k from unnest(app_private.permission_item_keys(a.applied)) k
                               where k <> all(app_private.permission_item_keys(desired.items)) order by k))) as row_json
    from public.user_template_assignments a
    join public.users u on u.id = a.user_id
    cross join lateral (select app_private.permission_template_desired_items(v_items, coalesce(p_options, '{}'), a.options, a.excluded) as items) desired
    where a.template_code = p_code
  ) per_user;
  return jsonb_build_object('assignees', jsonb_array_length(v_rows),
    'changed', (select count(*) from jsonb_array_elements(v_rows) r
                where jsonb_array_length(r -> 'add') > 0 or jsonb_array_length(r -> 'remove') > 0),
    'users', v_rows);
end;
$$;

-- Lưu mẫu (có ô tùy chọn) rồi cập nhật mọi người đang theo mẫu. Người lỗi (ví dụ chạm luật kiêm nhiệm cần xác nhận)
-- được bỏ qua và báo lại; người khác vẫn cập nhật.
create or replace function public.save_user_permission_template_v2(
  p_code text, p_name text, p_description text, p_items jsonb, p_suggested_position_ids uuid[], p_is_active boolean, p_options text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.user_permission_templates;
  v_before jsonb;
  v_user record;
  v_result jsonb;
  v_synced jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_TEMPLATE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_options, '{}')) o
             where not exists (select 1 from public.permission_template_option_defs d where d.key = o and d.is_active)) then
    raise exception 'PERMISSION_TEMPLATE_OPTION_INVALID' using errcode = '22023';
  end if;
  select to_jsonb(t) into v_before from public.user_permission_templates t where t.code = p_code;
  insert into public.user_permission_templates (code, name, description, items, suggested_position_ids, is_active, options, updated_by, updated_at)
  values (p_code, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
          app_private.normalize_user_permission_template_items(p_items),
          coalesce(p_suggested_position_ids, '{}'), coalesce(p_is_active, true),
          array(select distinct o from unnest(coalesce(p_options, '{}')) o order by o),
          public.current_app_user_id(), now())
  on conflict (code) do update set
    name = excluded.name, description = excluded.description, items = excluded.items,
    suggested_position_ids = excluded.suggested_position_ids, is_active = excluded.is_active,
    options = excluded.options, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  insert into public.audit_trail (table_name, record_id, action, old_data, new_data, module, description)
  values ('user_permission_templates', v_row.code, case when v_before is null then 'INSERT' else 'UPDATE' end,
          v_before, to_jsonb(v_row), 'SETTINGS', 'Cập nhật mẫu quyền theo vị trí: ' || v_row.name);

  for v_user in
    select a.user_id, u.name from public.user_template_assignments a join public.users u on u.id = a.user_id
    where a.template_code = v_row.code and u.is_active and u.account_status = 'ACTIVE'
    order by u.name
  loop
    begin
      v_result := app_private.sync_user_template_assignment(v_user.user_id, 'Cập nhật theo mẫu quyền "' || v_row.name || '"');
      if coalesce((v_result ->> 'added')::integer, 0) + coalesce((v_result ->> 'removed')::integer, 0) > 0 then
        v_synced := v_synced || jsonb_build_object('userId', v_user.user_id, 'name', v_user.name,
          'added', v_result -> 'added', 'removed', v_result -> 'removed');
      end if;
    exception when others then
      v_failed := v_failed || jsonb_build_object('userId', v_user.user_id, 'name', v_user.name, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('template', to_jsonb(v_row), 'synced', v_synced, 'failed', v_failed);
end;
$$;

-- Lệnh lưu mẫu cũ đi qua lệnh mới (giữ ô tùy chọn hiện có) để mọi đường lưu đều cập nhật người theo mẫu.
create or replace function public.save_user_permission_template(
  p_code text, p_name text, p_description text, p_items jsonb, p_suggested_position_ids uuid[], p_is_active boolean
)
returns public.user_permission_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.user_permission_templates;
begin
  perform public.save_user_permission_template_v2(p_code, p_name, p_description, p_items, p_suggested_position_ids, p_is_active,
    coalesce((select t.options from public.user_permission_templates t where t.code = p_code), '{}'));
  select * into v_row from public.user_permission_templates where code = p_code;
  return v_row;
end;
$$;

revoke all on function public.get_user_template_assignment_v1(uuid) from public, anon;
revoke all on function public.preview_user_template_assignment_v1(uuid, text, text[]) from public, anon;
revoke all on function public.save_user_template_assignment_v1(uuid, text, text[], text) from public, anon;
revoke all on function public.remove_user_template_assignment_v1(uuid, text) from public, anon;
revoke all on function public.preview_permission_template_change_v1(text, jsonb, text[]) from public, anon;
revoke all on function public.save_user_permission_template_v2(text, text, text, jsonb, uuid[], boolean, text[]) from public, anon;
grant execute on function public.get_user_template_assignment_v1(uuid) to authenticated;
grant execute on function public.preview_user_template_assignment_v1(uuid, text, text[]) to authenticated;
grant execute on function public.save_user_template_assignment_v1(uuid, text, text[], text) to authenticated;
grant execute on function public.remove_user_template_assignment_v1(uuid, text) to authenticated;
grant execute on function public.preview_permission_template_change_v1(text, jsonb, text[]) to authenticated;
grant execute on function public.save_user_permission_template_v2(text, text, text, jsonb, uuid[], boolean, text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Lưu quyền từng người (màn Người dùng) ghi nhận chỉnh riêng cho người đang theo mẫu.
--    Giữ nguyên thân hàm đang chạy trên Cloud (pg_get_functiondef 23/10/2026), chỉ thêm một dòng perform.
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.update_user_authorization_v2_impl(p_user_id uuid, p_profile jsonb, p_grants jsonb, p_reason text, p_expected_updated_at timestamp with time zone)
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
    '[]'::jsonb
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

notify pgrst, 'reload schema';
