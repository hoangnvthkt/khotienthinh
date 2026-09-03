begin;

create or replace function app_private.get_effective_permission_sources_authorized(
  p_target_user_id uuid default public.current_app_user_id()
)
returns table(
  permission_code text,
  source_type text,
  source_id text,
  source_code text,
  source_label text,
  scope_type text,
  scope_id text,
  starts_at timestamptz,
  expires_at timestamptz,
  risk_level text,
  is_business_approval boolean,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if v_actor_user_id is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;

  if p_target_user_id <> v_actor_user_id
    and not app_private.has_any_permission(
      v_actor_user_id,
      array[
        'system.authorization.view',
        'system.authorization.audit',
        'system.authorization.manage_roles',
        'system.authorization.manage_grants'
      ],
      'global',
      '*'
    )
  then
    raise exception 'Not allowed to view authorization sources' using errcode = '42501';
  end if;

  return query
  select source_row.*
  from app_private.resolve_effective_permission_sources(
    p_target_user_id,
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
    );

  return query
  select manager_source.*
  from app_private.resolve_manager_derived_permission_sources(p_target_user_id) manager_source;
end;
$$;

revoke all on function app_private.get_effective_permission_sources_authorized(uuid)
from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
