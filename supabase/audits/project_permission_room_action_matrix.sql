-- Read-only audit matrix for the fixed 14 Project permission Rooms.
-- Run with: npx supabase db query --linked -f supabase/audits/project_permission_room_action_matrix.sql

with action_matrix as (
  select
    room.group_code,
    room.code as room_code,
    room.name as room_name,
    binding.action_code,
    binding.enforcement_status,
    binding.pbac_fallback_enabled,
    binding.legacy_permission_codes,
    binding.relationship_description,
    binding.verified_at,
    binding.verified_source,
    case
      when binding.room_code in ('daily_log', 'material_planning', 'material_po', 'weekly_progress') then true
      else false
    end as frontend_capability_verified,
    case
      when binding.room_code = 'daily_log' then
        pg_get_functiondef('app_private.daily_log_has_action(text,text,text,uuid)'::regprocedure)
          like '%project_actor_has_effective_room_action%'
      when binding.room_code = 'material_planning' then exists (
        select 1
        from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename in ('material_budget_items', 'project_work_boq_items')
          and coalesce(policy.qual, policy.with_check, '') like '%project_actor_has_effective_room_action%'
      )
      when binding.room_code = 'material_po' then
        pg_get_functiondef('public.transition_project_purchase_order_status(text,text,jsonb)'::regprocedure)
          like '%project_actor_has_effective_room_action%'
        and pg_get_functiondef('app_private.guard_project_purchase_order_room_write()'::regprocedure)
          like '%material_po%'
      when binding.room_code = 'weekly_progress' then
        pg_get_functiondef('app_private.save_project_progress_period_impl(text,text,text,date,jsonb,jsonb)'::regprocedure)
          like '%assert_project_progress_action%'
        and pg_get_functiondef('app_private.close_project_progress_period_impl(text,text,text,date,jsonb,jsonb)'::regprocedure)
          like '%assert_project_progress_action%'
        and pg_get_functiondef('app_private.reopen_project_progress_period_impl(text,text,text,date,text)'::regprocedure)
          like '%assert_project_progress_action%'
      else false
    end as backend_enforcement_verified,
    case
      when binding.room_code = 'daily_log' then exists (
        select 1 from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = 'daily_logs'
          and policy.policyname in ('daily_logs_select', 'daily_logs_insert', 'daily_logs_update', 'daily_logs_delete')
      )
      when binding.room_code = 'material_planning' then (
        select count(*) = 8
        from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename in ('material_budget_items', 'project_work_boq_items')
          and policy.policyname in (
            'material_budget_items_select',
            'material_budget_items_insert',
            'material_budget_items_update',
            'material_budget_items_delete',
            'project_work_boq_items_select',
            'project_work_boq_items_insert',
            'project_work_boq_items_update',
            'project_work_boq_items_delete'
          )
      )
      when binding.room_code = 'material_po' then exists (
        select 1 from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = 'purchase_orders'
          and policy.policyname in ('purchase_orders_select', 'purchase_orders_insert', 'purchase_orders_update')
        group by policy.tablename
        having count(*) = 3
      )
      when binding.room_code = 'weekly_progress' then
        (
          select count(*) = 4
          from pg_policies policy
          where policy.schemaname = 'public'
            and policy.tablename in (
              'project_daily_task_progress',
              'project_weekly_task_progress',
              'weekly_progress_snapshots',
              'project_progress_period_states'
            )
            and policy.cmd = 'SELECT'
            and policy.policyname in (
              'project_daily_task_progress_select',
              'project_weekly_task_progress_select',
              'weekly_progress_snapshots_select',
              'project_progress_period_states_select'
            )
        )
        and not has_table_privilege('authenticated', 'public.project_daily_task_progress', 'INSERT')
        and not has_table_privilege('authenticated', 'public.project_daily_task_progress', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.project_daily_task_progress', 'DELETE')
        and not has_table_privilege('authenticated', 'public.project_weekly_task_progress', 'INSERT')
        and not has_table_privilege('authenticated', 'public.project_weekly_task_progress', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.project_weekly_task_progress', 'DELETE')
        and not has_table_privilege('authenticated', 'public.weekly_progress_snapshots', 'INSERT')
        and not has_table_privilege('authenticated', 'public.weekly_progress_snapshots', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.weekly_progress_snapshots', 'DELETE')
        and not has_table_privilege('authenticated', 'public.project_progress_period_states', 'INSERT')
        and not has_table_privilege('authenticated', 'public.project_progress_period_states', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.project_progress_period_states', 'DELETE')
      else false
    end as database_policy_verified
  from public.project_permission_rooms room
  join app_private.project_permission_room_action_bindings binding
    on binding.room_code = room.code
  where room.is_active
), fallback_only as (
  select
    binding.room_code,
    binding.action_code,
    count(distinct (staff.project_id, staff.construction_site_id, staff.user_id)) as fallback_only_users
  from public.project_staff staff
  join public.users user_row
    on user_row.id::text = staff.user_id and coalesce(user_row.is_active, true)
    join app_private.project_permission_room_action_bindings binding
    on binding.enforcement_status in ('pilot', 'enforced')
    and binding.pbac_fallback_enabled
  where staff.end_date is null
    and user_row.role <> 'ADMIN'
    and app_private.project_actor_has_effective_room_action(
      user_row.id,
      staff.project_id,
      staff.construction_site_id,
      binding.room_code,
      binding.action_code
    )
    and not app_private.project_user_has_room_action(
      user_row.id,
      staff.project_id,
      staff.construction_site_id,
      binding.room_code,
      binding.action_code
    )
  group by binding.room_code, binding.action_code
)
select
  matrix.*,
  coalesce(fallback.fallback_only_users, 0) as fallback_only_users,
  (
    matrix.frontend_capability_verified
    and matrix.backend_enforcement_verified
    and matrix.database_policy_verified
  ) as fully_wired
from action_matrix matrix
left join fallback_only fallback
  on fallback.room_code = matrix.room_code
  and fallback.action_code = matrix.action_code
order by matrix.group_code, matrix.room_code, matrix.action_code;

-- Legacy grants retained for audit after their per-action fallback is cut off.
select
  binding.room_code,
  binding.action_code,
  grant_row.user_id,
  user_row.name as user_name,
  grant_row.permission_code,
  grant_row.scope_type,
  grant_row.scope_id,
  grant_row.expires_at
from public.user_permission_grants grant_row
join public.users user_row on user_row.id = grant_row.user_id
join app_private.project_permission_room_action_bindings binding
  on grant_row.permission_code = any(binding.legacy_permission_codes)
  and not binding.pbac_fallback_enabled
where grant_row.is_active
  and (grant_row.expires_at is null or grant_row.expires_at > now())
order by binding.room_code, binding.action_code, user_row.name;

-- Active PBAC grants not mapped to a Room action. Broad grants such as
-- edit_all/delete_all/return/manage/confirm intentionally remain in this list.
select
  grant_row.user_id,
  user_row.name as user_name,
  grant_row.permission_code,
  grant_row.scope_type,
  grant_row.scope_id,
  grant_row.expires_at
from public.user_permission_grants grant_row
join public.users user_row on user_row.id = grant_row.user_id
where grant_row.is_active
  and (grant_row.expires_at is null or grant_row.expires_at > now())
  and grant_row.permission_code like 'project.%'
  and not exists (
    select 1
    from app_private.project_permission_room_action_bindings binding
    where grant_row.permission_code = any(binding.legacy_permission_codes)
  )
order by grant_row.permission_code, user_row.name, grant_row.scope_type, grant_row.scope_id;

-- Scope, staff and orphan diagnostics.
select
  member.id as room_member_id,
  member.project_id,
  member.construction_site_id as member_site_id,
  member.room_code,
  member.project_staff_id,
  staff.construction_site_id as staff_site_id,
  staff.end_date,
  user_row.id as user_id,
  user_row.name as user_name,
  user_row.is_active as user_is_active
from public.project_permission_room_members member
left join public.project_staff staff on staff.id = member.project_staff_id
left join public.users user_row on user_row.id::text = staff.user_id
where member.is_active
  and (
    staff.id is null
    or staff.end_date is not null
    or not coalesce(user_row.is_active, true)
    or staff.project_id is distinct from member.project_id
    or (
      member.construction_site_id is not null
      and staff.construction_site_id is not null
      and member.construction_site_id is distinct from staff.construction_site_id
    )
  )
order by member.project_id, member.room_code, member.id;
