-- Gỡ PR-1 Dòng chảy công việc (migration 20261013141500_center_flow_v1.sql). Chạy trên Cloud khi cần lùi; không đụng dữ liệu nghiệp vụ.
begin;
drop function if exists public.vcc_flow_v1(integer, text, uuid, boolean);
drop function if exists app_private.vcc_flow_managed_units(uuid);
drop function if exists app_private.vcc_flow_unit_tree(uuid);
drop function if exists app_private.vcc_flow_business_days(timestamptz, timestamptz, integer);
drop index if exists public.idx_wsa_flow_assigned_at;
drop index if exists public.idx_wsa_flow_pending;
drop index if exists public.idx_employees_user_id;
update public.user_permission_templates
set items = (select coalesce(jsonb_agg(i), '[]'::jsonb) from jsonb_array_elements(items) i where i ->> 'permissionCode' <> 'center.flow.view'), updated_at = now()
where code = 'executive';
update public.user_permission_grants set is_active = false, revoked_at = now(), revoked_reason = 'Gỡ PR-1 Dòng chảy công việc'
where permission_code = 'center.flow.view' and is_active;
delete from public.permission_actions where permission_code = 'center.flow.view';
delete from public.permission_modules where code = 'center.flow';
commit;
