-- Read-only pre/post snapshot for the Material PO authoritative Room cutover.

with binding_snapshot as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'actionCode', action_code,
    'status', enforcement_status,
    'legacyCodes', legacy_permission_codes,
    'pbacFallbackEnabled', case
      when to_regprocedure('app_private.project_actor_has_effective_room_action(uuid,text,text,text,text)') is null then null
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'app_private'
          and table_name = 'project_permission_room_action_bindings'
          and column_name = 'pbac_fallback_enabled'
      ) then (to_jsonb(binding) ->> 'pbac_fallback_enabled')::boolean
      else null
    end
  ) order by action_code), '[]'::jsonb) value
  from app_private.project_permission_room_action_bindings binding
  where room_code = 'material_po'
), room_snapshot as (
  select jsonb_build_object(
    'memberCount', count(distinct member.id),
    'activeActionCount', count(action.*),
    'membersMissingView', count(distinct member.id) filter (
      where action.action_code <> 'view' and not exists (
        select 1 from public.project_permission_room_member_actions view_action
        where view_action.room_member_id = member.id
          and view_action.action_code = 'view' and view_action.is_active
      )
    ),
    'grantSources', coalesce(jsonb_agg(distinct
      coalesce(to_jsonb(action) ->> 'grant_source', 'legacy'))
      filter (where action.room_member_id is not null), '[]'::jsonb)
  ) value
  from public.project_permission_room_members member
  left join public.project_permission_room_member_actions action
    on action.room_member_id = member.id and action.is_active
  where member.room_code = 'material_po' and member.is_active
), pbac_snapshot as (
  select jsonb_build_object(
    'activeGrantCount', count(*) filter (where grant_row.is_active),
    'inactiveGrantCount', count(*) filter (where not grant_row.is_active),
    'userCount', count(distinct grant_row.user_id)
  ) value
  from public.user_permission_grants grant_row
  where grant_row.permission_code like 'project.material_po.%'
), definition_snapshot as (
  select jsonb_build_object(
    'purchaseOrdersSelect', md5(coalesce((
      select policy.qual from pg_policies policy
      where policy.schemaname = 'public' and policy.tablename = 'purchase_orders'
        and policy.policyname = 'purchase_orders_select'
    ), '')),
    'effectiveActionHelper', md5(pg_get_functiondef(
      'app_private.project_actor_has_effective_room_action(uuid,text,text,text,text)'::regprocedure
    )),
    'deliveryViewHelper', md5(pg_get_functiondef(
      'app_private.purchase_order_delivery_can_view(text)'::regprocedure
    ))
  ) value
)
select jsonb_build_object(
  'capturedAt', now(),
  'bindings', binding_snapshot.value,
  'room', room_snapshot.value,
  'pbac', pbac_snapshot.value,
  'definitions', definition_snapshot.value
) as material_po_cutover_snapshot
from binding_snapshot, room_snapshot, pbac_snapshot, definition_snapshot;
