-- Trợ lý · Đợt 1 hỗ trợ người dùng (chủ SP 23/10/2026): công cụ quyen_cua_toi — người hỏi xem quyền của CHÍNH MÌNH bằng tên tiếng Việt,
-- để trả lời "sao em không thấy / không làm được…": quyền theo phân hệ + phạm vi (toàn công ty, dự án, kho…), nguồn (cấp riêng / mẫu),
-- quyền trong phòng dự án, quyền ở màn vừa mở (p_route khớp permission_modules.routes), quyền cần cho một việc (p_viec, khớp không dấu với
-- danh mục permission_actions) và ai cấp được (Admin đang hoạt động). Chỉ đọc; không có tham số người dùng nên không xem được quyền người khác.
create or replace function public.assistant_my_access_v1(p_route text default null, p_viec text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text;
  v_snap jsonb;
  v_route text := nullif(btrim(split_part(split_part(coalesce(p_route, ''), '?', 1), '#', 1)), '');
  v_words text[];
  v_groups jsonb; v_sources jsonb; v_rooms jsonb; v_screen jsonb := null; v_match jsonb := null; v_granters jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if length(coalesce(p_route, '')) > 300 or length(coalesce(p_viec, '')) > 200 then raise exception using errcode = '22023', message = 'AI_BAD_INPUT'; end if;
  select u.role::text into v_role from public.users u where u.id = v_actor;
  v_snap := public.get_my_authorization_snapshot();

  create temp table if not exists pg_temp.my_access_src (code text, stype text, slabel text, scope_type text, scope_id text) on commit drop;
  truncate pg_temp.my_access_src;
  insert into pg_temp.my_access_src
    select s->>'permissionCode', upper(coalesce(s->>'sourceType', '')), nullif(btrim(coalesce(s->>'sourceLabel', s->>'sourceCode', '')), ''),
      coalesce(s->>'scopeType', 'global'), coalesce(s->>'scopeId', '*')
    from jsonb_array_elements(coalesce(v_snap->'sources', '[]'::jsonb)) s
    where (s->>'expiresAt') is null or (s->>'expiresAt')::timestamptz > now();

  -- Quyền theo phân hệ: "Mua hàng: Xem (toàn công ty); Tạo đơn (dự án SMB-2026)…" — tối đa 40 phân hệ.
  with lab as (
    select m.name module_name, m.sort_order msort, a.label, a.sort_order asort,
      case s.scope_type
        when 'global' then 'toàn công ty'
        when 'own' then 'của mình'
        when 'assigned' then 'được giao'
        when 'project' then case when s.scope_id = '*' then 'mọi dự án được phân'
          else 'dự án ' || coalesce((select coalesce(nullif(p.code, ''), p.name) from public.projects p where p.id::text = s.scope_id), '?') end
        when 'construction_site' then case when s.scope_id = '*' then 'mọi công trường được phân'
          else 'công trường ' || coalesce((select c.name from public.hrm_construction_sites c where c.id::text = s.scope_id), '?') end
        when 'warehouse' then case when s.scope_id = '*' then 'mọi kho được phân'
          else 'kho ' || coalesce((select w.name from public.warehouses w where w.id::text = s.scope_id), '?') end
        when 'department' then 'phòng ban của mình'
        when 'direct_reports' then 'nhân viên mình quản lý'
        when 'org_unit' then 'đơn vị ' || coalesce((select o.name from public.org_units o where o.id::text = s.scope_id), '?')
        when 'work_workspace' then 'không gian việc được phân'
        else s.scope_type end scope_label
    from pg_temp.my_access_src s
    join public.permission_actions a on a.permission_code = s.code and a.is_active
    join public.permission_modules m on m.code = a.module_code and m.is_active
  ), per_action as (
    select module_name, msort, label, min(asort) asort, string_agg(distinct scope_label, ', ') scopes from lab group by module_name, msort, label
  ), per_module as (
    select module_name, msort, string_agg(label || ' (' || scopes || ')', '; ' order by asort) viec from per_action group by module_name, msort
  )
  select coalesce(jsonb_agg(jsonb_build_object('phan_he', module_name, 'viec', viec) order by msort, module_name), '[]'::jsonb) into v_groups
  from (select * from per_module order by msort, module_name limit 40) x;

  select coalesce(jsonb_agg(distinct case stype when 'DIRECT' then 'Cấp riêng' when 'ROLE' then 'Mẫu quyền: ' || coalesce(slabel, '?')
    else initcap(lower(stype)) || coalesce(': ' || slabel, '') end), '[]'::jsonb) into v_sources
  from pg_temp.my_access_src where stype <> '';

  -- Phòng quyền trong dự án: "SMB-2026 · Đề xuất vật tư: Xem, Gửi" — tối đa 30 dòng.
  select coalesce(jsonb_agg(jsonb_build_object('du_an', du_an, 'phong', phong, 'viec', viec) order by du_an, phong), '[]'::jsonb) into v_rooms from (
    select coalesce((select coalesce(nullif(p.code, ''), p.name) from public.projects p where p.id::text = r->>'projectId'), '?') du_an,
      coalesce(pr.name, r->>'roomCode') phong,
      string_agg(distinct case r->>'actionCode' when 'view' then 'Xem' when 'edit' then 'Sửa' when 'delete' then 'Xóa' when 'submit' then 'Gửi'
        when 'verify' then 'Kiểm tra' when 'confirm' then 'Xác nhận' when 'approve' then 'Duyệt' when 'publish_progress' then 'Công bố tiến độ ngày'
        when 'view_available_stock' then 'Xem tồn khả dụng' when 'view_resource_evidence' then 'Xem bằng chứng nguồn lực' when 'manage' then 'Quản trị'
        else r->>'actionCode' end, ', ') viec
    from jsonb_array_elements(case when v_role = 'ADMIN' then '[]'::jsonb else coalesce(v_snap->'roomActions', '[]'::jsonb) end) r
    left join public.project_permission_rooms pr on pr.code = r->>'roomCode'
    group by 1, 2 order by 1, 2 limit 30) x;

  -- Màn vừa mở: phân hệ có đường dẫn khớp (":id" = một đoạn bất kỳ) → việc đã có / chưa có ở phân hệ đó.
  if v_route is not null then
    with mods as (
      select distinct m.code, m.name, m.sort_order from public.permission_modules m, unnest(coalesce(m.routes, '{}'::text[])) pat
      where m.is_active and (v_route ~ ('^' || regexp_replace(regexp_replace(pat, '([.+*?^$()\[\]{}|\\])', '\\\1', 'g'), ':[^/]+', '[^/]+', 'g') || '/?$'))
    ), acts as (
      select m.name module_name, m.sort_order, a.label, a.sort_order asort, exists (select 1 from pg_temp.my_access_src s where s.code = a.permission_code) has
      from mods m join public.permission_actions a on a.module_code = m.code and a.is_active
    )
    select jsonb_build_object('duong_dan', v_route, 'phan_he', coalesce(jsonb_agg(jsonb_build_object('ten', module_name,
      'da_co', (select coalesce(jsonb_agg(x.label order by x.asort), '[]'::jsonb) from acts x where x.module_name = g.module_name and (x.has or v_role = 'ADMIN')),
      'chua_co', (select coalesce(jsonb_agg(x.label order by x.asort), '[]'::jsonb) from acts x where x.module_name = g.module_name and not x.has and v_role <> 'ADMIN'))
      order by g.sort_order), '[]'::jsonb))
    into v_screen from (select distinct module_name, sort_order from acts) g;
  end if;

  -- Quyền cần cho một việc: khớp không dấu từng từ (≥ 2 ký tự) với tên việc + tên phân hệ + mô tả; xếp theo số từ khớp.
  if nullif(btrim(coalesce(p_viec, '')), '') is not null then
    v_words := array(select w from regexp_split_to_table(lower(public.unaccent('public.unaccent'::regdictionary, p_viec)), '[^a-z0-9]+') w where length(w) >= 2
      and w not in ('lam', 'sao', 'de', 'em', 'anh', 'chi', 'toi', 'duoc', 'khong', 'ko', 'can', 'quyen', 'gi', 'the', 'nao', 'cho', 'cua', 'va', 'muon') limit 8);
    if cardinality(v_words) > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('phan_he', module_name, 'viec', label, 'mo_ta', description, 'da_co', has) order by hits desc, msort, asort), '[]'::jsonb)
      into v_match from (
        select m.name module_name, m.sort_order msort, a.label, a.sort_order asort, nullif(left(coalesce(a.description, ''), 160), '') description,
          (v_role = 'ADMIN' or exists (select 1 from pg_temp.my_access_src s where s.code = a.permission_code)) has,
          (select count(*) from unnest(v_words) w where lower(public.unaccent('public.unaccent'::regdictionary, a.label || ' ' || m.name || ' ' || coalesce(a.description, ''))) ~ ('\m' || w || '\M')) hits
        from public.permission_actions a join public.permission_modules m on m.code = a.module_code and m.is_active
        where a.is_active
        order by hits desc, m.sort_order, a.sort_order limit 8) x
      where hits >= greatest(1, ceil(cardinality(v_words) / 2.0));
    end if;
  end if;

  select coalesce(jsonb_agg(u.name order by u.name), '[]'::jsonb) into v_granters from (
    select u.name from public.users u where u.role::text = 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' order by u.name limit 5) u;

  return jsonb_build_object(
    'la_admin', v_role = 'ADMIN',
    'vai_tro', v_role,
    'nguon', v_sources,
    'quyen', case when v_role = 'ADMIN' then '[]'::jsonb else v_groups end,
    'so_phan_he', (select count(distinct a.module_code) from pg_temp.my_access_src s join public.permission_actions a on a.permission_code = s.code and a.is_active),
    'phong_du_an', v_rooms,
    'man_hinh', v_screen,
    'viec_can', v_match,
    'nguoi_cap', v_granters);
end $$;
revoke all on function public.assistant_my_access_v1(text, text) from public, anon;
grant execute on function public.assistant_my_access_v1(text, text) to authenticated;
