-- Cấp quyền "Xem dòng chảy công việc toàn công ty" (center.flow.view) cho Ban lãnh đạo hiện tại.
-- Chủ SP chốt 13/10: toàn công ty = Admin + mẫu Ban giám đốc. Mẫu đã có quyền này (migration), nhưng người đã áp mẫu không tự đổi,
-- nên script này cấp cho: nhân viên đang làm việc thuộc đơn vị "Ban lãnh đạo" có tài khoản đang hoạt động.
-- Mặc định ROLLBACK để diễn tập; đổi dòng cuối thành COMMIT khi cấp thật. Có audit_trail và không cấp trùng.
begin;
with targets as (
  select distinct u.id as user_id, u.name
  from public.employees e
  join public.org_units o on o.id = e.org_unit_id and o.is_active and o.name = 'Ban lãnh đạo'
  join public.users u on u.id = e.user_id and u.is_active and u.account_status = 'ACTIVE'
  where e.status = 'Đang làm việc'
    and not exists (select 1 from public.user_permission_grants g where g.user_id = u.id and g.permission_code = 'center.flow.view' and g.is_active)
), ins as (
  insert into public.user_permission_grants(user_id, permission_code, scope_type, scope_id, grant_reason)
  select user_id, 'center.flow.view', 'global', '*', 'Dòng chảy công việc: Ban lãnh đạo (chủ SP 13/10/2026)' from targets
  returning user_id
)
insert into public.audit_trail(table_name, record_id, record_label, action, new_data, user_id, user_name, module, description, impact_level)
select 'user_permission_grants', t.user_id::text, t.name, 'INSERT', jsonb_build_object('permissionCode', 'center.flow.view', 'scope', 'global'),
  null, 'center_flow_v1_grant_executive.sql', 'CENTER', 'Cấp quyền xem Dòng chảy công việc toàn công ty cho Ban lãnh đạo', 'normal'
from targets t join ins on ins.user_id = t.user_id;
select u.name, g.granted_at from public.user_permission_grants g join public.users u on u.id = g.user_id
where g.permission_code = 'center.flow.view' and g.is_active order by u.name;
-- đổi dòng dưới thành COMMIT để cấp thật
rollback;
