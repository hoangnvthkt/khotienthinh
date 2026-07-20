-- Phase 2 authoritative effective-permission resolver and source explanation.

insert into app_private.permission_hardening_settings (key, value)
values
  ('business_role_resolver_enabled', 'false'::jsonb),
  ('legacy_governance_fallback_disabled', 'false'::jsonb),
  ('system_admin_business_approval_bypass_disabled', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function app_private.scope_covers(
  p_grant_scope_type text,
  p_grant_scope_id text,
  p_requested_scope_type text,
  p_requested_scope_id text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_grant_scope_type = 'global'
    or (
      p_grant_scope_type = coalesce(p_requested_scope_type, 'global')
      and (
        coalesce(nullif(p_grant_scope_id, ''), '*') = '*'
        or coalesce(nullif(p_grant_scope_id, ''), '*') = coalesce(nullif(p_requested_scope_id, ''), '*')
      )
    );
$$;

revoke all on function app_private.scope_covers(text,text,text,text)
  from public, anon;
grant execute on function app_private.scope_covers(text,text,text,text)
  to authenticated;

create or replace function app_private.resolve_effective_permission_sources(
  p_user_id uuid,
  p_permission_code text default null,
  p_scope_type text default null,
  p_scope_id text default null,
  p_at timestamptz default now()
)
returns table (
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
language sql
stable
security definer
set search_path = ''
as $$
  with active_user as (
    select u.*
    from public.users u
    where u.id = p_user_id
      and u.is_active
      and u.account_status = 'ACTIVE'
  ),
  active_actions as (
    select pa.*, pm.application_code, pm.legacy_module_key as module_legacy_key
    from public.permission_actions pa
    join public.permission_modules pm on pm.code = pa.module_code
    where pa.is_active
      and pm.is_active
      and (p_permission_code is null or pa.permission_code = p_permission_code)
  ),
  role_sources as (
    select
      item.permission_code,
      'ROLE'::text as source_type,
      assignment.id::text as source_id,
      role_template.code as source_code,
      role_template.name as source_label,
      case
        when assignment.scope_type = 'global' then item.scope_type
        else assignment.scope_type
      end as scope_type,
      case
        when assignment.scope_type = 'global' then item.scope_id
        when item.scope_type = 'global' then assignment.scope_id
        when assignment.scope_id = '*' then item.scope_id
        else assignment.scope_id
      end as scope_id,
      assignment.starts_at,
      assignment.expires_at,
      action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object(
        'roleTemplateId', role_template.id,
        'assignmentId', assignment.id,
        'assignmentScopeType', assignment.scope_type,
        'assignmentScopeId', assignment.scope_id
      ) as metadata
    from active_user user_row
    join public.principal_role_assignments assignment
      on assignment.principal_type = 'user'
     and assignment.principal_id = user_row.id
     and assignment.status = 'ACTIVE'
     and assignment.starts_at <= p_at
     and (assignment.expires_at is null or assignment.expires_at > p_at)
    join public.role_permission_templates role_template
      on role_template.id = assignment.role_template_id
     and role_template.is_active
    join public.role_permission_template_items item
      on item.template_id = role_template.id
    join active_actions action_row
      on action_row.permission_code = item.permission_code
    where app_private.permission_hardening_flag('business_role_resolver_enabled')
      and (
        item.permission_code <> 'system.settings.manage'
        or (role_template.code = 'SYSTEM_ADMIN' and user_row.role = 'ADMIN')
      )
      and (
        assignment.scope_type = 'global'
        or item.scope_type = 'global'
        or (
          assignment.scope_type = item.scope_type
          and (assignment.scope_id = '*' or item.scope_id = '*' or assignment.scope_id = item.scope_id)
        )
      )
      and (
        p_scope_type is null
        or (
          app_private.scope_covers(assignment.scope_type, assignment.scope_id, p_scope_type, p_scope_id)
          and app_private.scope_covers(item.scope_type, item.scope_id, p_scope_type, p_scope_id)
        )
      )
  ),
  direct_sources as (
    select
      grant_row.permission_code,
      'DIRECT'::text,
      grant_row.id::text,
      'DIRECT'::text,
      'Direct grant'::text,
      grant_row.scope_type,
      grant_row.scope_id,
      grant_row.granted_at,
      grant_row.expires_at,
      action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object('grantedBy', grant_row.granted_by, 'reason', grant_row.grant_reason)
    from active_user user_row
    join public.user_permission_grants grant_row
      on grant_row.user_id = user_row.id
     and grant_row.is_active
     and grant_row.granted_at <= p_at
     and (grant_row.expires_at is null or grant_row.expires_at > p_at)
    join active_actions action_row
      on action_row.permission_code = grant_row.permission_code
    where grant_row.permission_code <> 'system.settings.manage'
      and (
        p_scope_type is null
        or app_private.scope_covers(grant_row.scope_type, grant_row.scope_id, p_scope_type, p_scope_id)
      )
  ),
  legacy_sources as (
    select
      action_row.permission_code,
      'LEGACY'::text,
      coalesce(action_row.legacy_module_key, action_row.module_legacy_key, 'legacy')::text,
      coalesce(action_row.legacy_module_key, action_row.module_legacy_key, 'LEGACY')::text,
      'Legacy permission'::text,
      'global'::text,
      '*'::text,
      null::timestamptz,
      null::timestamptz,
      action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object(
        'legacyModuleKey', coalesce(action_row.legacy_module_key, action_row.module_legacy_key),
        'legacyRoute', action_row.legacy_route,
        'legacyAdminCompatibility', user_row.role = 'ADMIN'
      )
    from active_user user_row
    join active_actions action_row on true
    where not app_private.permission_hardening_flag('legacy_fallback_disabled')
      and (
        (
          user_row.role = 'ADMIN'
          and (
            (
              action_row.is_business_approval
              and not app_private.permission_hardening_flag('system_admin_business_approval_bypass_disabled')
            )
            or (
              action_row.module_code = 'system.authorization'
              and not app_private.permission_hardening_flag('legacy_governance_fallback_disabled')
            )
            or (
              not action_row.is_business_approval
              and action_row.module_code <> 'system.authorization'
            )
          )
        )
        or (
          user_row.role <> 'ADMIN'
          and (
            action_row.module_code <> 'system.authorization'
            or not app_private.permission_hardening_flag('legacy_governance_fallback_disabled')
          )
          and coalesce(action_row.legacy_module_key, action_row.module_legacy_key) is not null
          and case
            when action_row.legacy_admin_only or action_row.action = 'manage' then
              coalesce(action_row.legacy_module_key, action_row.module_legacy_key) = any(coalesce(user_row.admin_modules, '{}'::text[]))
              or (
                action_row.legacy_route is null
                and coalesce(user_row.admin_sub_modules, '{}'::jsonb) ? coalesce(action_row.legacy_module_key, action_row.module_legacy_key)
              )
              or (
                action_row.legacy_route is not null
                and coalesce(user_row.admin_sub_modules -> coalesce(action_row.legacy_module_key, action_row.module_legacy_key), '[]'::jsonb) ? action_row.legacy_route
              )
            else
              user_row.allowed_modules is null
              or coalesce(action_row.legacy_module_key, action_row.module_legacy_key) = any(coalesce(user_row.allowed_modules, '{}'::text[]))
              or coalesce(action_row.legacy_module_key, action_row.module_legacy_key) = any(coalesce(user_row.admin_modules, '{}'::text[]))
              or (
                action_row.legacy_route is null
                and (
                  coalesce(user_row.allowed_sub_modules, '{}'::jsonb) ? coalesce(action_row.legacy_module_key, action_row.module_legacy_key)
                  or coalesce(user_row.admin_sub_modules, '{}'::jsonb) ? coalesce(action_row.legacy_module_key, action_row.module_legacy_key)
                )
              )
              or (
                action_row.legacy_route is not null
                and (
                  coalesce(user_row.allowed_sub_modules -> coalesce(action_row.legacy_module_key, action_row.module_legacy_key), '[]'::jsonb) ? action_row.legacy_route
                  or coalesce(user_row.admin_sub_modules -> coalesce(action_row.legacy_module_key, action_row.module_legacy_key), '[]'::jsonb) ? action_row.legacy_route
                )
              )
          end
        )
      )
  )
  select * from role_sources
  union all
  select * from direct_sources
  union all
  select * from legacy_sources;
$$;

revoke all on function app_private.resolve_effective_permission_sources(uuid,text,text,text,timestamptz)
  from public, anon, authenticated;

create or replace function app_private.has_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id, p_permission_code, p_scope_type, p_scope_id, now()
    ) source_row
  );
$$;

create or replace function app_private.can_manage_permissions()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_permission(
    public.current_app_user_id(),
    'system.authorization.manage_grants',
    'global',
    '*'
  );
$$;

revoke all on function app_private.has_permission(uuid,text,text,text) from public, anon;
revoke all on function app_private.can_manage_permissions() from public, anon;
grant execute on function app_private.has_permission(uuid,text,text,text) to authenticated;
grant execute on function app_private.can_manage_permissions() to authenticated;

create or replace function app_private.get_effective_permission_sources_authorized(
  p_target_user_id uuid default public.current_app_user_id()
)
returns table (
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
      array['system.authorization.view','system.authorization.audit','system.authorization.manage_roles','system.authorization.manage_grants'],
      'global',
      '*'
    )
  then
    raise exception 'Not allowed to view authorization sources' using errcode = '42501';
  end if;

  return query
  select *
  from app_private.resolve_effective_permission_sources(
    p_target_user_id, null, null, null, now()
  );
end;
$$;

revoke all on function app_private.get_effective_permission_sources_authorized(uuid)
  from public, anon, authenticated;
grant execute on function app_private.get_effective_permission_sources_authorized(uuid)
  to authenticated;

create or replace function public.get_effective_permission_sources(
  p_target_user_id uuid default public.current_app_user_id()
)
returns table (
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
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_effective_permission_sources_authorized(p_target_user_id);
$$;

revoke all on function public.get_effective_permission_sources(uuid) from public, anon;
grant execute on function public.get_effective_permission_sources(uuid) to authenticated;

create index if not exists permission_audit_events_actor_idx
  on public.permission_audit_events (actor_user_id, created_at desc);

drop policy if exists principal_role_assignments_self_select on public.principal_role_assignments;
create policy principal_role_assignments_authorized_select
on public.principal_role_assignments for select
to authenticated
using (
  (principal_type = 'user' and principal_id = (select public.current_app_user_id()))
  or (select app_private.has_any_permission(
    public.current_app_user_id(),
    array['system.authorization.audit','system.authorization.manage_roles','system.authorization.manage_grants'],
    'global',
    '*'
  ))
);

drop policy if exists permission_audit_events_select on public.permission_audit_events;
create policy permission_audit_events_select
on public.permission_audit_events for select
to authenticated
using (
  actor_user_id = (select public.current_app_user_id())
  or target_user_id = (select public.current_app_user_id())
  or (select app_private.has_permission(
    public.current_app_user_id(), 'system.authorization.audit', 'global', '*'
  ))
);

notify pgrst, 'reload schema';
