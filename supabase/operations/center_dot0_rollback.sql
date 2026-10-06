-- Gỡ Trung tâm điều hành đợt 0 PR-A (migration 20261008138000_center_dot0_foundation).
-- Gỡ kèm frontend (route /center, mục Sidebar) cùng lúc. Lịch sử bật/tắt trong audit_trail được giữ.
-- Quyền center.* đã cấp (nếu có) không xóa ở đây: mã quyền bị tắt nên không còn tác dụng;
-- bỏ cấp trên màn Phân quyền nếu muốn dọn hẳn.
begin;
drop function if exists public.save_center_layout_v1(jsonb);
drop function if exists public.get_center_layout_v1();
drop function if exists public.get_center_access_v1();
drop function if exists app_private.center_actor_v1();
drop table if exists public.center_user_layouts;
drop table if exists app_private.center_rollout_actors;
drop function if exists app_private.audit_center_rollout_change_v1();
update public.permission_actions set is_active = false, updated_at = now()
where permission_code in ('center.module.access', 'center.layout.manage');
update public.permission_modules set is_active = false where code in ('center.module', 'center.layout');
update public.permission_applications set is_active = false where code = 'center';
commit;
