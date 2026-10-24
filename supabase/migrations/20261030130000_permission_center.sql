-- Trung tâm phân quyền — bước 2 (chủ SP duyệt mockup 23/10/2026): Toàn cảnh, Theo người, Theo vị trí.
-- 1. Mỗi mẫu có phần "Làm được gì" viết bằng lời thường (Admin sửa được), thay vì liệt kê mã quyền.
-- 2. Một lệnh đọc toàn cảnh cho người quản lý phân quyền: người, mẫu, ô tích, quyền nhạy cảm,
--    quyền ngoài mẫu, kho, vai trò nhân sự, Room dự án, kiêm nhiệm.

alter table public.user_permission_templates add column if not exists summary jsonb not null default '[]'::jsonb;

comment on column public.user_permission_templates.summary is
  'Làm được gì, bằng lời thường: [{"ab": "TC", "title": "Tài chính", "text": "…"}]. Hiện ở Trung tâm phân quyền.';

update public.user_permission_templates t set summary = s.summary, updated_at = now()
from (values
  ('executive', '[{"ab":"TC","title":"Tài chính","text":"Xem toàn công ty; Quản trị Tài chính do Admin cấp riêng"},
    {"ab":"MH","title":"Mua hàng","text":"Xem mọi đơn mua; duyệt PO khi tích ô"},
    {"ab":"DA","title":"Dự án","text":"Xem tất cả dự án, tiến độ, nhật ký"},
    {"ab":"NS","title":"Nhân sự","text":"Xem tổng hợp, sơ đồ, định biên"},
    {"ab":"CP","title":"Chi phí, ngân sách","text":"Tạo, xem, duyệt chi phí"},
    {"ab":"AI","title":"Báo cáo AI","text":"Tạo, xem báo cáo điều hành"},
    {"ab":"YC","title":"Phiếu yêu cầu","text":"Xem tất cả; duyệt bước được giao"}]'::jsonb),
  ('finance_director', '[{"ab":"TC","title":"Tài chính","text":"Xem, ghi nhận, xác nhận chi, cấu hình"},
    {"ab":"CP","title":"Chi phí, ngân sách","text":"Sửa ngân sách, danh mục chi phí, duyệt chi phí"},
    {"ab":"DA","title":"Dự án, kho, mua hàng","text":"Xem"},
    {"ab":"HĐ","title":"Hợp đồng","text":"Xem hợp đồng khách hàng, NCC, đối tác"}]'::jsonb),
  ('accountant', '[{"ab":"TC","title":"Tài chính","text":"Công nợ, đề nghị chi, thu chi, sao kê, hóa đơn"},
    {"ab":"CP","title":"Chi phí, ngân sách","text":"Tạo, duyệt chi phí; xem ngân sách"},
    {"ab":"KH","title":"Kho, mua hàng","text":"Xem tồn, phiếu kho, đơn mua"},
    {"ab":"HĐ","title":"Hợp đồng, tài sản","text":"Xem"}]'::jsonb),
  ('material_staff', '[{"ab":"MH","title":"Mua hàng","text":"Lập, sửa, gửi đơn mua; HĐ nguyên tắc, gọi hàng, mua nóng"},
    {"ab":"KH","title":"Kho","text":"Xem tồn, phiếu kho, đề xuất vật tư"},
    {"ab":"HĐ","title":"Hợp đồng NCC","text":"Xem"},
    {"ab":"DL","title":"Dữ liệu gốc, kho bãi","text":"Xem"}]'::jsonb),
  ('warehouse_manager', '[{"ab":"KH","title":"Kho","text":"Xem tồn, phiếu kho, đề xuất vật tư"},
    {"ab":"TK","title":"Thủ kho","text":"Nhập, xuất, kiểm kê theo kho được giao (Phân quyền kho)"},
    {"ab":"MH","title":"Mua hàng","text":"Xem đơn mua để nhận hàng"},
    {"ab":"DL","title":"Định mức, dữ liệu gốc","text":"Xem"}]'::jsonb),
  ('hr_staff', '[{"ab":"NS","title":"Nhân sự","text":"Hồ sơ, chấm công (sửa, chốt), nghỉ phép (duyệt), tổ chức, định biên"},
    {"ab":"TS","title":"Tài sản","text":"Cấp phát, thu hồi, kiểm kê, bảo trì"},
    {"ab":"XE","title":"Đội xe","text":"Điều phối, bàn giao, hồ sơ xe, báo cáo"}]'::jsonb),
  ('site_staff', '[{"ab":"KH","title":"Kho công trường","text":"Xem tồn, phiếu kho, đề xuất vật tư"},
    {"ab":"TS","title":"Tài sản","text":"Xem"},
    {"ab":"DA","title":"Việc dự án","text":"Theo vai trò trong Room từng dự án"}]'::jsonb),
  ('basic_employee', '[{"ab":"NS","title":"Nhân sự của tôi","text":"Hồ sơ, chấm công, nghỉ phép, phiếu lương của mình; danh bạ"},
    {"ab":"YC","title":"Phiếu yêu cầu","text":"Tạo, sửa, hủy phiếu của mình; xử lý bước được giao"},
    {"ab":"QT","title":"Quy trình","text":"Tạo, sửa nháp; xử lý bước được giao; hủy phiếu của mình"},
    {"ab":"VB","title":"Vioo Office","text":"Xem; xử lý và duyệt văn bản được giao"},
    {"ab":"CV","title":"Vioo Work","text":"Tạo việc, nhận việc, cập nhật tiến độ"},
    {"ab":"XE","title":"Đặt xe, văn phòng phẩm","text":"Đặt xe; xin cấp VPP"},
    {"ab":"AI","title":"Trợ lý AI","text":"Mức Tiêu chuẩn"}]'::jsonb)
) s(code, summary)
where t.code = s.code and t.summary = '[]'::jsonb;

-- Lưu mẫu kèm phần mô tả bằng lời (giữ nguyên mọi việc của save_user_permission_template_v2).
create or replace function public.save_user_permission_template_summary_v1(p_code text, p_summary jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.user_permission_templates;
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_TEMPLATE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_summary, '[]'::jsonb)) <> 'array'
    or exists (select 1 from jsonb_array_elements(coalesce(p_summary, '[]'::jsonb)) r
               where char_length(btrim(coalesce(r ->> 'title', ''))) = 0) then
    raise exception 'PERMISSION_TEMPLATE_SUMMARY_INVALID' using errcode = '22023';
  end if;
  update public.user_permission_templates set summary = coalesce(p_summary, '[]'::jsonb), updated_by = public.current_app_user_id(), updated_at = now()
  where code = p_code returning * into v_row;
  if v_row.code is null then raise exception 'PERMISSION_TEMPLATE_NOT_FOUND' using errcode = '22023'; end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.save_user_permission_template_summary_v1(text, jsonb) from public, anon;
grant execute on function public.save_user_permission_template_summary_v1(text, jsonb) to authenticated;

-- Toàn cảnh cho người quản lý phân quyền.
create or replace function public.get_permission_center_v1()
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
    with people as (
      select u.id, u.name, u.role, u.avatar,
        coalesce(ou.name, '') as department, coalesce(pos.name, e.title, '') as position
      from public.users u
      left join public.employees e on e.user_id = u.id
      left join public.org_units ou on ou.id = e.org_unit_id
      left join public.hrm_positions pos on pos.id = e.position_id
      where u.is_active and u.account_status = 'ACTIVE' and u.role <> 'ADMIN'
    ),
    live as (
      select g.user_id, g.permission_code, g.scope_type, g.scope_id, g.expires_at, a.label, a.risk_level, m.name as module
      from public.user_permission_grants g
      join people p on p.id = g.user_id
      join public.permission_actions a on a.permission_code = g.permission_code
      left join public.permission_modules m on m.code = a.module_code
      where g.is_active and (g.expires_at is null or g.expires_at > now())
    ),
    assigned as (
      select a.user_id, a.template_code, a.options,
        app_private.permission_item_keys(app_private.permission_template_desired_items(t.items, t.options, a.options, '[]'::jsonb)) as keys
      from public.user_template_assignments a
      join public.user_permission_templates t on t.code = a.template_code
    ),
    conflicts as (
      select c.user_id, r.name as rule, c.rule_code,
        string_agg(case when c.scope_type = 'warehouse' then coalesce(w.name, c.scope_id) else 'Toàn công ty' end, ', ' order by c.scope_id) as scope
      from app_private.user_sod_conflict_pairs(null) c
      join public.authorization_sod_rules r on r.rule_code = c.rule_code
      left join public.warehouses w on w.id = c.scope_id
      group by c.user_id, r.name, c.rule_code
    )
    select jsonb_build_object(
      'generatedAt', now(),
      'templates', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'code', t.code, 'name', t.name, 'description', t.description, 'sortOrder', t.sort_order,
            'itemCount', jsonb_array_length(t.items), 'summary', t.summary,
            'people', (select count(*) from assigned a join people p on p.id = a.user_id where a.template_code = t.code),
            'options', coalesce((select jsonb_agg(jsonb_build_object('key', o.key, 'label', o.label, 'description', o.description) order by o.sort_order)
              from public.permission_template_option_defs o where o.key = any(t.options) and o.is_active), '[]'::jsonb))
          order by t.sort_order, t.name), '[]'::jsonb)
        from public.user_permission_templates t where t.is_active),
      'people', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'userId', p.id, 'name', p.name, 'department', p.department, 'position', p.position,
            'avatar', case when p.avatar ~ '^https?://' then p.avatar end,
            'templateCode', a.template_code, 'options', coalesce(to_jsonb(a.options), '[]'::jsonb),
            'grantCount', (select count(*) from live l where l.user_id = p.id),
            'sensitive', coalesce((select jsonb_agg(distinct coalesce(l.module, '') || ': ' || l.label) from live l
              where l.user_id = p.id and l.risk_level = 'sensitive'), '[]'::jsonb),
            'extraCount', (select count(*) from live l where l.user_id = p.id and l.scope_id = '*' and a.user_id is not null
              and (l.permission_code || '@' || l.scope_type) <> all(a.keys)),
            'extra', coalesce((select jsonb_agg(x.lbl) from (
                select distinct coalesce(l.module, '') || ': ' || l.label as lbl from live l
                where l.user_id = p.id and l.scope_id = '*' and a.user_id is not null and (l.permission_code || '@' || l.scope_type) <> all(a.keys)
                order by 1 limit 6) x), '[]'::jsonb),
            'expiringSoon', (select count(*) from live l where l.user_id = p.id and l.expires_at < now() + interval '30 days'),
            'warehouses', coalesce((select jsonb_agg(distinct coalesce(w.name, l.scope_id)) from live l left join public.warehouses w on w.id = l.scope_id
              where l.user_id = p.id and l.permission_code = 'wms.transaction.keeper'), '[]'::jsonb),
            'hrRoles', coalesce((select jsonb_agg(distinct rt.name) from public.principal_role_assignments pra
              join public.role_permission_templates rt on rt.id = pra.role_template_id
              where pra.principal_id = p.id and pra.status = 'ACTIVE' and (pra.expires_at is null or pra.expires_at > now())), '[]'::jsonb),
            'roomProjects', (select count(distinct ps.project_id) from public.project_staff ps where ps.user_id = p.id::text and ps.end_date is null),
            'conflicts', coalesce((select jsonb_agg(jsonb_build_object('rule', c.rule, 'scope', c.scope,
                'until', (select max(acc.expires_at) from public.authorization_sod_warning_acceptances acc
                          where acc.target_user_id = p.id and acc.rule_code = c.rule_code and acc.expires_at > now()),
                'controlOwner', (select o.name from public.authorization_sod_warning_acceptances acc join public.users o on o.id = acc.control_owner_user_id
                          where acc.target_user_id = p.id and acc.rule_code = c.rule_code and acc.expires_at > now()
                          order by acc.created_at desc limit 1)))
              from conflicts c where c.user_id = p.id), '[]'::jsonb))
          order by p.department, p.name), '[]'::jsonb)
        from people p left join assigned a on a.user_id = p.id)
    )
  );
end;
$$;

revoke all on function public.get_permission_center_v1() from public, anon;
grant execute on function public.get_permission_center_v1() to authenticated;

notify pgrst, 'reload schema';
