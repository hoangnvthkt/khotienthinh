-- Run after the authoritative PO Room cutover migration.
-- Safe on Cloud: all temporary Nguyễn Phương Thảo toggles are rolled back.

begin;

do $$
declare
  v_expected_actions integer;
  v_global_fallback boolean;
  v_select_qual text;
begin
  select sum(cardinality(room.allowed_actions))::integer
  into v_expected_actions
  from public.project_permission_rooms room
  where room.is_active;

  if (select count(*) from app_private.project_permission_room_action_bindings) <> v_expected_actions then
    raise exception 'Binding registry is not one-to-one with active Room actions';
  end if;
  if (select count(*) from app_private.project_permission_room_action_bindings
      where room_code = 'material_po' and enforcement_status = 'pilot') <> 6 then
    raise exception 'All six Material PO actions must remain pilot';
  end if;
  if (select count(*) from app_private.project_permission_room_action_bindings
      where room_code = 'material_po' and not pbac_fallback_enabled) <> 6 then
    raise exception 'All six Material PO PBAC fallbacks must be disabled';
  end if;
  if exists (
    select 1 from app_private.project_permission_room_action_bindings
    where room_code <> 'material_po' and not pbac_fallback_enabled
  ) then
    raise exception 'A non-PO Room fallback was disabled';
  end if;

  v_global_fallback := app_private.permission_hardening_flag('project_room_pbac_fallback_enabled');
  if not v_global_fallback then
    raise exception 'Global Room PBAC fallback must remain enabled during PO pilot';
  end if;

  if exists (
    select 1
    from public.project_permission_room_members member
    join public.project_permission_room_member_actions action
      on action.room_member_id = member.id and action.is_active
    where member.room_code = 'material_po'
      and member.is_active
      and action.action_code <> 'view'
      and not exists (
        select 1 from public.project_permission_room_member_actions view_action
        where view_action.room_member_id = member.id
          and view_action.action_code = 'view'
          and view_action.is_active
      )
  ) then
    raise exception 'An active Material PO workflow action is missing Room view';
  end if;

  select policy.qual into v_select_qual
  from pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename = 'purchase_orders'
    and policy.policyname = 'purchase_orders_select';
  if v_select_qual not like '%purchase_order_can_view(id)%' then
    raise exception 'purchase_orders SELECT is not parent-view authoritative';
  end if;

  if pg_get_functiondef('app_private.purchase_order_delivery_can_view(text)'::regprocedure)
      like '%project_doc_can_view%'
    or pg_get_functiondef('app_private.purchase_order_supplemental_can_view(text)'::regprocedure)
      like '%project_doc_can_view%'
    or pg_get_functiondef('app_private.purchase_order_delivery_can_view(text)'::regprocedure)
      like '%is_module_admin%'
  then
    raise exception 'A dependent PO view helper still trusts module/project-doc permission';
  end if;

  if has_function_privilege(
    'authenticated', 'app_private.replace_project_staff_permission_grants(uuid,jsonb)', 'EXECUTE'
  ) then
    raise exception 'Authenticated can bypass the guarded public PBAC RPC';
  end if;
end $$;

-- Regression case requested for Nguyễn Phương Thảo: a legacy PBAC/module key
-- cannot keep PO visibility alive after Room view is removed.
do $$
declare
  actor record;
  v_checked integer := 0;
begin
  for actor in
    select distinct
      user_row.id as user_id,
      staff.project_id,
      member.construction_site_id,
      member.id as member_id
    from public.users user_row
    join public.project_staff staff on staff.user_id = user_row.id::text and staff.end_date is null
    join public.project_permission_room_members member
      on member.project_staff_id = staff.id
      and member.project_id = staff.project_id
      and member.room_code = 'material_po'
      and member.is_active
    join public.project_permission_room_member_actions action
      on action.room_member_id = member.id
      and action.action_code = 'view'
      and action.is_active
    where user_row.name = 'Nguyễn Phương Thảo'
      and user_row.role <> 'ADMIN'
  loop
    if not app_private.project_actor_has_effective_room_action(
      actor.user_id, actor.project_id, actor.construction_site_id, 'material_po', 'view'
    ) then
      raise exception 'Nguyễn Phương Thảo Room view was not effective before toggle';
    end if;

    update public.project_permission_room_member_actions
    set is_active = false, updated_at = now()
    where room_member_id = actor.member_id and action_code = 'view';

    if app_private.project_actor_has_effective_room_action(
      actor.user_id, actor.project_id, actor.construction_site_id, 'material_po', 'view'
    ) then
      raise exception 'Legacy PBAC/module kept Nguyễn Phương Thảo PO view alive';
    end if;

    update public.project_permission_room_member_actions
    set is_active = true, updated_at = now()
    where room_member_id = actor.member_id and action_code = 'view';
    v_checked := v_checked + 1;
  end loop;

  if v_checked = 0 then
    raise notice 'Nguyễn Phương Thảo has no active Room view row in this environment; generic contract checks still passed.';
  end if;
end $$;

create temp table material_po_thao_rls_scope on commit drop as
select
  user_row.id as user_id,
  user_row.email,
  member.project_id,
  member.construction_site_id
from public.users user_row
join public.project_staff staff on staff.user_id = user_row.id::text and staff.end_date is null
join public.project_permission_room_members member
  on member.project_staff_id = staff.id
  and member.project_id = staff.project_id
  and member.room_code = 'material_po'
  and member.is_active
join public.project_permission_room_member_actions action
  on action.room_member_id = member.id
  and action.action_code = 'view'
  and action.is_active
where user_row.name = 'Nguyễn Phương Thảo'
  and user_row.role <> 'ADMIN'
order by member.project_id, member.construction_site_id nulls first
limit 1;

grant select on material_po_thao_rls_scope to authenticated;

update public.project_permission_room_member_actions action
set is_active = false, updated_at = now()
from public.project_permission_room_members member
join public.project_staff staff on staff.id = member.project_staff_id and staff.end_date is null
join material_po_thao_rls_scope scope
  on scope.user_id::text = staff.user_id
  and scope.project_id = member.project_id
  and (
    scope.construction_site_id is null
    or member.construction_site_id is null
    or member.construction_site_id = scope.construction_site_id
  )
where action.room_member_id = member.id
  and member.room_code = 'material_po'
  and action.action_code = 'view'
  and action.is_active;

set local role authenticated;

select set_config('request.jwt.claim.sub', user_id::text, true),
       set_config('request.jwt.claim.email', email, true),
       set_config('request.jwt.claims', jsonb_build_object(
         'sub', user_id::text, 'email', email
       )::text, true)
from material_po_thao_rls_scope;

do $$
declare
  scope material_po_thao_rls_scope%rowtype;
  v_visible_count integer;
begin
  select * into scope from material_po_thao_rls_scope;
  if scope.user_id is null then
    raise notice 'Nguyễn Phương Thảo RLS scope is unavailable in this environment.';
    return;
  end if;

  select count(*) into v_visible_count
  from public.purchase_orders po
  where po.source_mode is distinct from 'company_consolidated'
    and po.project_id = scope.project_id
    and (
      scope.construction_site_id is null
      or po.construction_site_id is not distinct from scope.construction_site_id
    );

  if v_visible_count <> 0 then
    raise exception 'Direct REST-equivalent SELECT still exposes % PO rows without Room view', v_visible_count;
  end if;
end $$;

reset role;

select
  (select count(*) from app_private.project_permission_room_action_bindings) as binding_count,
  (select count(*) from app_private.project_permission_room_action_bindings
    where enforcement_status = 'pilot') as pilot_action_count,
  (select count(*) from app_private.project_permission_room_action_bindings
    where room_code = 'material_po' and not pbac_fallback_enabled) as po_fallback_disabled_count,
  'material_po_room_authoritative_cutover_smoke_passed' as result;

rollback;
