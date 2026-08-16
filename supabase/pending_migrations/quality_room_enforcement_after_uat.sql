-- Stage 3 promotion. Do not apply before Quality Room UAT is accepted.
-- Roll back operationally with a new migration that restores pilot + fallback;
-- never delete Room grants, command requests or audit history.

do $$
declare
  v_fallback_only_user_count bigint;
begin
  with permission_mapping(permission_code, action_code) as (
    values
      ('project.quality.view', 'view'),
      ('project.quality.edit_all', 'edit'),
      ('project.quality.checklist_edit_all', 'edit'),
      ('project.quality.manage', 'edit'),
      ('project.quality.delete', 'delete'),
      ('project.quality.delete_all', 'delete'),
      ('project.quality.manage', 'delete'),
      ('project.quality.submit', 'submit'),
      ('project.quality.manage', 'submit'),
      ('project.quality.verify', 'verify'),
      ('project.quality.manage', 'verify'),
      ('project.quality.approve', 'approve'),
      ('project.quality.return', 'approve'),
      ('project.quality.manage', 'approve')
  ), active_scopes as (
    select distinct grant_row.id as grant_id, grant_row.user_id,
      staff.project_id,
      case when grant_row.scope_type = 'construction_site'
        then staff.construction_site_id else null end as construction_site_id,
      mapping.action_code
    from public.user_permission_grants grant_row
    join permission_mapping mapping on mapping.permission_code = grant_row.permission_code
    join public.users user_row on user_row.id = grant_row.user_id
      and coalesce(user_row.is_active, true)
    join public.project_staff staff
      on staff.user_id = grant_row.user_id::text
      and staff.end_date is null
      and (
        (grant_row.scope_type = 'project' and grant_row.scope_id = staff.project_id
          and staff.construction_site_id is null)
        or (grant_row.scope_type = 'construction_site'
          and grant_row.scope_id = staff.construction_site_id)
      )
    where grant_row.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
  )
  select count(distinct (scope.grant_id, scope.action_code))
  into v_fallback_only_user_count
  from active_scopes scope
  where not app_private.project_user_has_room_action(
    scope.user_id, scope.project_id, scope.construction_site_id,
    'quality', scope.action_code
  );

  if v_fallback_only_user_count <> 0 then
    raise exception 'QUALITY_PROMOTION_BLOCKED: fallback_only_user_count=%',
      v_fallback_only_user_count using errcode = '23514';
  end if;
end;
$$;

update app_private.project_permission_room_action_bindings
set enforcement_status = 'enforced',
    pbac_fallback_enabled = false,
    verified_at = now(),
    verified_source = 'quality_room_enforcement_uat',
    updated_at = now()
where room_code = 'quality';

insert into public.permission_audit_events (
  actor_user_id, event_type, before_grants, after_grants, metadata
)
values (
  null, 'quality_room_enforced', '[]'::jsonb, '[]'::jsonb,
  jsonb_build_object(
    'source', 'quality_room_enforcement_uat',
    'room_code', 'quality',
    'fallback_only_user_count', 0,
    'pbac_fallback_enabled', false
  )
);

notify pgrst, 'reload schema';
