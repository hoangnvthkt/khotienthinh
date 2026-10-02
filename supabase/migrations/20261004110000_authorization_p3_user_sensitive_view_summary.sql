-- Read-only summary for one person of what they may see in Finance and Contracts:
-- Admin switches (all projects / one project), automatic access through the Payment or
-- Quantity-acceptance Room, and company-level contract management.
create or replace function public.get_user_sensitive_view_summary(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
begin
  if not public.is_admin() then
    raise exception 'SENSITIVE_VIEW_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select * into v_user from public.users where id = p_user_id;
  if v_user.id is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'isSystemAdmin', v_user.role = 'ADMIN',
    'financeAll', exists (select 1 from public.project_sensitive_view_grants g
      where g.user_id = p_user_id and g.is_active and g.domain = 'finance' and g.project_id is null),
    'contractAll', exists (select 1 from public.project_sensitive_view_grants g
      where g.user_id = p_user_id and g.is_active and g.domain = 'contract' and g.project_id is null),
    'financeProjectIds', coalesce((select jsonb_agg(distinct g.project_id order by g.project_id)
      from public.project_sensitive_view_grants g
      where g.user_id = p_user_id and g.is_active and g.domain = 'finance' and g.project_id is not null), '[]'::jsonb),
    'contractProjectIds', coalesce((select jsonb_agg(distinct g.project_id order by g.project_id)
      from public.project_sensitive_view_grants g
      where g.user_id = p_user_id and g.is_active and g.domain = 'contract' and g.project_id is not null), '[]'::jsonb),
    'roomProjectIds', coalesce((
      select jsonb_agg(distinct member.project_id order by member.project_id)
      from public.project_permission_room_members member
      join public.project_permission_room_member_actions action
        on action.room_member_id = member.id and action.is_active
       and action.action_code in ('edit', 'submit', 'verify', 'approve', 'confirm')
      join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
      where member.is_active
        and member.room_code in ('payment', 'quantity_acceptance')
        and staff.user_id = p_user_id::text), '[]'::jsonb),
    'contractManager', v_user.role = 'ADMIN'
      or app_private.has_permission(p_user_id, 'system.hd.manage', 'global', '*')
      or exists (
        select 1 from unnest(array[
          'contract.customer.manage', 'contract.supplier.manage', 'contract.partner.manage',
          'contract.cost_library.manage', 'system.tender_ai.manage'
        ]) as code(permission_code)
        where app_private.has_permission(p_user_id, code.permission_code, 'global', '*'))
  );
end;
$$;

revoke all on function public.get_user_sensitive_view_summary(uuid) from public, anon;
grant execute on function public.get_user_sensitive_view_summary(uuid) to authenticated;
