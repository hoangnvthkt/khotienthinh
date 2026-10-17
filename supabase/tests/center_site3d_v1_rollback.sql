-- Gỡ Công trường 3D (migration 20261017220000_center_site3d_v1.sql). Không xoá tệp đã tải lên kho (xoá kho bằng màn Storage nếu cần).
begin;
drop function if exists public.vcc_site3d_v1(text);
drop policy if exists site_models_read on storage.objects;
drop policy if exists site_models_admin_insert on storage.objects;
drop policy if exists site_models_admin_update on storage.objects;
drop policy if exists site_models_admin_delete on storage.objects;
drop function if exists app_private.site3d_can_view_v1(uuid);
update public.permission_actions set is_active = false where permission_code = 'center.site3d.view';
update public.permission_modules set is_active = false where code = 'center.site3d';
commit;
