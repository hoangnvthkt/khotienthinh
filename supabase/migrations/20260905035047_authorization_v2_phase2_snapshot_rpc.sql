create or replace function app_private.resolve_authorization_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.users%rowtype;
  v_flags jsonb := '{}'::jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_room_actions jsonb := '[]'::jsonb;
begin
  select user_row.*
    into v_actor
  from public.users user_row
  where user_row.id = p_user_id
    and user_row.is_active
    and user_row.account_status = 'ACTIVE';

  if v_actor.id is null then
    raise exception 'Active application account required'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(setting_row.key, setting_row.value), '{}'::jsonb)
    into v_flags
  from app_private.permission_hardening_settings setting_row;

  with source_rows as (
    select source_row.*
    from app_private.resolve_effective_permission_sources(
      p_user_id,
      null,
      null,
      null,
      now()
    ) source_row
    where not (
        source_row.permission_code like 'hrm.%'
        and source_row.source_type = 'LEGACY'
      )
      and (
        not app_private.is_hrm_template_only_permission(source_row.permission_code)
        or (
          source_row.source_type = 'ROLE'
          and source_row.source_code in ('HR', 'HR_MANAGE')
        )
      )
    union all
    select manager_source.*
    from app_private.resolve_manager_derived_permission_sources(p_user_id) manager_source
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'permissionCode', source_row.permission_code,
    'sourceType', source_row.source_type,
    'sourceId', source_row.source_id,
    'sourceCode', source_row.source_code,
    'sourceLabel', source_row.source_label,
    'scopeType', source_row.scope_type,
    'scopeId', source_row.scope_id,
    'startsAt', source_row.starts_at,
    'expiresAt', source_row.expires_at,
    'riskLevel', source_row.risk_level,
    'isBusinessApproval', source_row.is_business_approval,
    'metadata', coalesce(source_row.metadata, '{}'::jsonb)
  ) order by
    source_row.permission_code,
    source_row.scope_type,
    source_row.scope_id,
    source_row.source_type,
    source_row.source_id), '[]'::jsonb)
    into v_sources
  from source_rows source_row;

  with candidate_scopes as (
    select distinct
      staff_row.project_id,
      staff_row.construction_site_id
    from public.project_staff staff_row
    where staff_row.user_id = p_user_id::text
      and staff_row.end_date is null
      and staff_row.project_id is not null

    union

    select distinct
      member_row.project_id,
      member_row.construction_site_id
    from public.project_permission_room_members member_row
    join public.project_staff staff_row on staff_row.id = member_row.project_staff_id
    where staff_row.user_id = p_user_id::text
      and staff_row.end_date is null
      and member_row.is_active

    union

    select project_row.id, project_row.construction_site_id::text
    from public.projects project_row
    where v_actor.role = 'ADMIN'

    union

    select project_row.id, null::text
    from public.projects project_row
    where v_actor.role = 'ADMIN'
  ), room_rows as (
    select
      scope_row.project_id,
      scope_row.construction_site_id,
      binding.room_code,
      binding.action_code,
      case
        when v_actor.role = 'ADMIN' then 'admin'
        when binding.enforcement_status in ('pilot', 'enforced')
          and app_private.project_user_has_room_action(
            p_user_id,
            scope_row.project_id,
            scope_row.construction_site_id,
            binding.room_code,
            binding.action_code
          ) then 'room'
        else 'pbac_fallback'
      end as authorization_source,
      binding.enforcement_status,
      binding.pbac_fallback_enabled
    from candidate_scopes scope_row
    cross join app_private.project_permission_room_action_bindings binding
    where app_private.project_actor_has_effective_room_action(
      p_user_id,
      scope_row.project_id,
      scope_row.construction_site_id,
      binding.room_code,
      binding.action_code
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'projectId', room_row.project_id,
    'constructionSiteId', room_row.construction_site_id,
    'roomCode', room_row.room_code,
    'actionCode', room_row.action_code,
    'source', room_row.authorization_source,
    'enforcement', room_row.enforcement_status,
    'fallback', room_row.pbac_fallback_enabled
  ) order by
    room_row.project_id,
    room_row.construction_site_id nulls first,
    room_row.room_code,
    room_row.action_code), '[]'::jsonb)
    into v_room_actions
  from room_rows room_row;

  return jsonb_build_object(
    'generatedAt', now(),
    'flags', v_flags,
    'sources', v_sources,
    'roomActions', v_room_actions
  );
end;
$$;

create or replace function public.get_my_authorization_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
begin
  if v_actor_id is null then
    raise exception 'Active application account required'
      using errcode = '42501';
  end if;

  return app_private.resolve_authorization_snapshot(v_actor_id);
end;
$$;

revoke all on function app_private.resolve_authorization_snapshot(uuid) from public;
revoke all on function app_private.resolve_authorization_snapshot(uuid) from anon;
revoke all on function app_private.resolve_authorization_snapshot(uuid) from authenticated;
revoke all on function public.get_my_authorization_snapshot() from public;
revoke all on function public.get_my_authorization_snapshot() from anon;
grant execute on function public.get_my_authorization_snapshot() to authenticated;
