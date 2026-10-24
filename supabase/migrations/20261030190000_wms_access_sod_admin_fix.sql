-- Vá #341 (24/10/2026): xem trước / lưu Phân quyền kho hỏng khi lượt lưu đổi việc kho của tài khoản ADMIN — bộ quyền của
-- Admin Hoàng có system.settings.manage (chỉ cấp qua mẫu nghiệp vụ) nên bộ xét kiêm nhiệm cấp riêng từ chối cả bộ.
-- ADMIN đã có mọi quyền: không xét kiêm nhiệm. Người khác: chỉ đưa quyền cấp riêng được vào bộ xét.

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
      and r.scope_type = g ->> 'scope_type' and r.scope_id = g ->> 'scope_id')
      and exists (select 1 from public.permission_actions a where a.permission_code = g ->> 'permission_code' and a.is_active
        and a.direct_grant_allowed and a.permission_code <> 'system.settings.manage')), '[]'::jsonb)
  || coalesce((select jsonb_agg(jsonb_build_object('permission_code', a.code, 'scope_type', a.scope_type, 'scope_id', a.scope_id,
      'expires_at', null, 'is_active', true)) from pg_temp.wms_access_add a where a.user_id = p_user_id), '[]'::jsonb);
end;
$$;

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
      and u.role <> 'ADMIN'
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

