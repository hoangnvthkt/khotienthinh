-- Workspace capabilities are canonical sources, never legacy ADMIN privileges.
insert into public.permission_modules(application_code,code,name,description,routes,legacy_module_key,sort_order,is_active)
values('work','work.workspace','Không gian làm việc','Quản trị không gian cộng tác.',array['/work/spaces/new','/work/spaces/:workspaceId','/work/spaces/:workspaceId/members','/work/spaces/:workspaceId/settings'],null,30,true)
on conflict(code) do update set name=excluded.name,description=excluded.description,routes=excluded.routes,legacy_module_key=null,is_active=true,updated_at=now();
insert into public.permission_actions(module_code,action,permission_code,label,description,scope_modes,legacy_module_key,legacy_route,legacy_admin_only,sort_order,is_active,risk_level,is_business_action,is_business_approval,direct_grant_requires_expiry,grant_readiness,access_application_code)
select 'work.workspace',v.action,'work.workspace.'||v.action,v.label,v.label,v.scopes,null,null,false,v.ord,true,v.risk,true,false,v.expiry,'enforced','work'
from (values
('create','Tạo không gian làm việc',array['global','department','project']::text[],10,'important',false),
('manage_members','Quản trị thành viên không gian',array['work_workspace']::text[],20,'sensitive',true),
('archive','Lưu trữ không gian',array['work_workspace']::text[],30,'sensitive',true),
('recover','Khôi phục quản trị không gian',array['global']::text[],40,'sensitive',true)
) v(action,label,scopes,ord,risk,expiry)
on conflict(permission_code) do update set scope_modes=excluded.scope_modes,label=excluded.label,legacy_module_key=null,legacy_route=null,legacy_admin_only=false,risk_level=excluded.risk_level,direct_grant_requires_expiry=excluded.direct_grant_requires_expiry,grant_readiness='enforced',updated_at=now();
update public.permission_actions set scope_modes=array_append(scope_modes,'work_workspace'),updated_at=now()
where module_code='work.task' and not('work_workspace'=any(scope_modes));

-- Canonical grant/template storage accepts the new scope. Existing scopes stay unchanged.
alter table public.user_permission_grants drop constraint user_permission_grants_scope_type_chk;
alter table public.user_permission_grants add constraint user_permission_grants_scope_type_chk check(scope_type in('global','own','assigned','project','construction_site','warehouse','department','direct_reports','org_unit','work_workspace'));
alter table public.role_permission_template_items drop constraint role_permission_template_items_scope_type_chk;
alter table public.role_permission_template_items add constraint role_permission_template_items_scope_type_chk check(scope_type in('global','own','assigned','project','construction_site','warehouse','department','direct_reports','org_unit','work_workspace'));
alter table public.principal_role_assignments drop constraint principal_role_assignments_scope_type_check;
alter table public.principal_role_assignments add constraint principal_role_assignments_scope_type_check check(scope_type in('global','own','assigned','project','construction_site','warehouse','department','direct_reports','org_unit','work_workspace'));

create or replace function app_private.work_workspace_permission_sources(
 p_user_id uuid,p_permission_code text default null,p_scope_type text default null,p_scope_id text default null,p_at timestamptz default now())
returns table(permission_code text,source_type text,source_id text,source_code text,source_label text,scope_type text,scope_id text,starts_at timestamptz,expires_at timestamptz,risk_level text,is_business_approval boolean,metadata jsonb)
language sql stable security definer set search_path='' as $$
 select a.permission_code,'WORKSPACE_MEMBER'::text,m.id::text,('WORKSPACE_'||upper(m.role))::text,w.name,
 case when a.permission_code='work.module.access' then 'global' else 'work_workspace' end,
 case when a.permission_code='work.module.access' then '*' else w.id::text end,
 m.starts_at,m.expires_at,a.risk_level,a.is_business_approval,
 jsonb_build_object('workspaceId',w.id,'memberId',m.id,'role',m.role,'workspaceStatus',w.status)
 from public.users u join public.work_workspace_members m on m.user_id=u.id
 join public.work_workspaces w on w.id=m.workspace_id
 cross join public.permission_actions a join public.permission_modules pm on pm.code=a.module_code
 where u.id=p_user_id and u.is_active and u.account_status='ACTIVE'
 and m.status='active' and m.starts_at<=p_at and(m.expires_at is null or m.expires_at>p_at)
 and w.access_mode='workspace' and a.is_active and pm.is_active
 and(a.permission_code in('work.module.access','work.task.create','work.task.view_scope','work.task.view_related','work.task.assign_user','work.task.review','work.task.audit_view')
 or(m.role='admin' and a.permission_code in('work.task.manage_scope','work.task.configure','work.workspace.manage_members','work.workspace.archive')))
 and(w.status='active' or a.permission_code in('work.module.access','work.task.view_scope','work.task.view_related','work.task.audit_view','work.workspace.archive'))
 and(p_permission_code is null or a.permission_code=p_permission_code)
 and(p_scope_type is null or app_private.scope_covers(
 case when a.permission_code='work.module.access' then 'global' else 'work_workspace' end,
 case when a.permission_code='work.module.access' then '*' else w.id::text end,p_scope_type,p_scope_id));
$$;
revoke all on function app_private.work_workspace_permission_sources(uuid,text,text,text,timestamptz) from public,anon,authenticated;

-- Preserve resolver OID and all existing non-Work source semantics.
CREATE OR REPLACE FUNCTION app_private.resolve_effective_permission_sources(p_user_id uuid, p_permission_code text DEFAULT NULL::text, p_scope_type text DEFAULT NULL::text, p_scope_id text DEFAULT NULL::text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(permission_code text, source_type text, source_id text, source_code text, source_label text, scope_type text, scope_id text, starts_at timestamp with time zone, expires_at timestamp with time zone, risk_level text, is_business_approval boolean, metadata jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select * from legacy_sources
  union all
  select * from app_private.work_workspace_permission_sources(p_user_id,p_permission_code,p_scope_type,p_scope_id,p_at);
$function$
;

-- Vioo Work Workspace membership commands/readers (WS2).
--
-- Browser entry points are guarded RPCs; tables stay deny by default.
-- Membership changes do not create direct permission grants.

create or replace function app_private.work_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.work_workspace_members m
  join public.work_workspaces w on w.id = m.workspace_id
  join public.users u on u.id = m.user_id
  where m.workspace_id = p_workspace_id
    and m.user_id = p_user_id
    and m.status = 'active'
    and m.starts_at <= now()
    and (m.expires_at is null or m.expires_at > now())
    and u.is_active
    and u.account_status = 'ACTIVE'
    and w.access_mode = 'workspace'
  limit 1
$$;
revoke all on function app_private.work_workspace_member_role(uuid,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_active_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not exists (
    select 1 from public.users u
    where u.id = v_actor and u.is_active and u.account_status = 'ACTIVE'
  ) then
    raise exception 'WORK_ACCESS_DENIED' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function app_private.work_workspace_active_actor()
  from public, anon, authenticated;

create or replace function app_private.work_workspace_assert_member(
  p_workspace_id uuid,
  p_user_id uuid default public.current_app_user_id()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  v_role := app_private.work_workspace_member_role(p_workspace_id, p_user_id);
  if v_role is null
     or not app_private.has_permission(p_user_id,'work.module.access','global','*') then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  return v_role;
end;
$$;
revoke all on function app_private.work_workspace_assert_member(uuid,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_assert_admin(
  p_workspace_id uuid,
  p_user_id uuid default public.current_app_user_id()
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app_private.work_workspace_member_role(p_workspace_id, p_user_id) is distinct from 'admin'
     or not app_private.has_permission(p_user_id,'work.workspace.manage_members','work_workspace',p_workspace_id::text) then
    raise exception 'WORK_WORKSPACE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.work_workspace_assert_admin(uuid,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_assert_admin_role(
  p_workspace_id uuid,
  p_user_id uuid default public.current_app_user_id()
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app_private.work_workspace_member_role(p_workspace_id,p_user_id) is distinct from 'admin'
     or not app_private.has_permission(p_user_id,'work.module.access','global','*') then
    raise exception 'WORK_WORKSPACE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.work_workspace_assert_admin_role(uuid,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_source_name(
  p_kind text,
  p_department_id uuid,
  p_project_id text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'department' then (select d.name from public.org_units d where d.id = p_department_id)
    when 'project' then (select p.name from public.projects p where p.id = p_project_id)
    else null
  end
$$;
revoke all on function app_private.work_workspace_source_name(text,uuid,text)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_open_assignment_count(
  p_workspace_id uuid,
  p_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.work_task_assignments a
  join public.work_tasks t on t.id = a.task_id
  where t.workspace_id = p_workspace_id
    and a.user_id = p_user_id
    and a.ended_at is null
    and t.status not in ('completed', 'cancelled')
$$;
revoke all on function app_private.work_workspace_open_assignment_count(uuid,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_open_review_count(
  p_workspace_id uuid,
  p_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct x.task_id)::integer
  from (
    select t.id as task_id
    from public.work_tasks t
    where t.workspace_id = p_workspace_id
      and t.reviewer_user_id = p_user_id
      and t.status not in ('completed', 'cancelled')
    union all
    select t.id as task_id
    from public.work_task_participants p
    join public.work_tasks t on t.id = p.task_id
    where t.workspace_id = p_workspace_id
      and p.user_id = p_user_id
      and p.participant_role = 'reviewer'
      and p.ended_at is null
      and t.status not in ('completed', 'cancelled')
  ) x
$$;
revoke all on function app_private.work_workspace_open_review_count(uuid,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_validate_cursor(
  p_cursor jsonb,
  p_require_sort_at boolean default true
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sort_at timestamptz;
  v_id uuid;
begin
  if p_cursor is null then return; end if;
  if jsonb_typeof(p_cursor) is distinct from 'object'
     or p_cursor->>'id' is null
     or (p_require_sort_at and p_cursor->>'sortAt' is null)
     or (select count(*) from jsonb_object_keys(p_cursor)) <> (case when p_require_sort_at then 2 else 1 end) then
    raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
  end if;
  begin
    v_id := (p_cursor->>'id')::uuid;
    if p_cursor->>'sortAt' is not null then
      v_sort_at := (p_cursor->>'sortAt')::timestamptz;
    end if;
  exception when others then
    raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
  end;
end;
$$;
revoke all on function app_private.work_workspace_validate_cursor(jsonb,boolean)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_summary(
  p_workspace_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.work_workspaces%rowtype;
  v_role text;
  v_pinned boolean;
  v_source text;
  v_member_count integer;
  v_can_create boolean;
  v_can_manage_members boolean;
  v_can_configure boolean;
  v_can_archive boolean;
  v_can_view boolean;
begin
  select * into w from public.work_workspaces where id = p_workspace_id;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  v_role := app_private.work_workspace_member_role(p_workspace_id, p_actor_id);
  if v_role is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  v_can_view := app_private.has_permission(p_actor_id,'work.module.access','global','*');
  if not v_can_view then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  select p.pinned into v_pinned
  from public.work_workspace_preferences p
  where p.user_id = p_actor_id and p.workspace_id = p_workspace_id;
  v_source := app_private.work_workspace_source_name(w.kind,w.department_id,w.project_id);
  select count(*)::integer into v_member_count
  from public.work_workspace_members m
  join public.users u on u.id=m.user_id
  where m.workspace_id=p_workspace_id and m.status='active'
    and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())
    and u.is_active and u.account_status='ACTIVE';
  v_can_create := w.status='active'
    and app_private.has_permission(p_actor_id,'work.task.create','work_workspace',w.id::text);
  v_can_manage_members := w.status='active' and v_role='admin'
    and app_private.has_permission(p_actor_id,'work.workspace.manage_members','work_workspace',w.id::text);
  v_can_configure := w.status='active' and v_role='admin'
    and app_private.has_permission(p_actor_id,'work.task.configure','work_workspace',w.id::text);
  -- The same archive capability drives both archive and restore UI; the
  -- command still checks the current status and open-task policy server side.
  v_can_archive := v_role='admin'
    and app_private.has_permission(p_actor_id,'work.workspace.archive','work_workspace',w.id::text);
  return jsonb_build_object(
    'id', w.id,
    'name', w.name,
    'kind', w.kind,
    'status', w.status,
    'sourceName', v_source,
    'iconKey', w.icon_key,
    'colorKey', w.color_key,
    'coverKey', w.cover_key,
    'pinned', coalesce(v_pinned,false),
    -- WS4 owns task visibility/count projections.  Membership count is safe
    -- to expose here because it contains no task data.
    'memberCount', v_member_count,
    'visibleOpenTaskCount', 0,
    'myActionCount', 0,
    'capabilities', jsonb_build_object(
      'canView', v_can_view,
      'canCreateTask', v_can_create,
      'canManageMembers', v_can_manage_members,
      'canConfigure', v_can_configure,
      'canArchive', v_can_archive
    ),
    'lockVersion', w.lock_version
  );
end;
$$;
revoke all on function app_private.work_workspace_summary(uuid,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_list_sources(
  p_kind text,
  p_search text default '',
  p_cursor jsonb default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := coalesce(p_limit,30);
  v_cursor_at timestamptz;
  v_cursor_id text;
  v_rows jsonb;
begin
  if p_kind is null or p_kind not in ('department','project','collaboration')
     or char_length(v_search) > 100 then
    raise exception 'WORK_INVALID_FILTER' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'WORK_INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object'
       or p_cursor->>'sortAt' is null
       or p_cursor->>'id' is null
       or (select count(*) from jsonb_object_keys(p_cursor)) <> 2 then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end if;
    begin
      v_cursor_at := (p_cursor->>'sortAt')::timestamptz;
    exception when others then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end;
    v_cursor_id := p_cursor->>'id';
  end if;

  -- Collaboration has no organization/project source.  It is still a valid
  -- source kind for the create screen and requires the global capability.
  if p_kind = 'collaboration' then
    if not app_private.has_permission(v_actor,'work.workspace.create','global','*') then
      raise exception 'WORK_WORKSPACE_CREATE_DENIED' using errcode = '42501';
    end if;
    return jsonb_build_object('items','[]'::jsonb,'nextCursor',null);
  end if;

  with source_rows as (
    select d.id::text as source_id, d.name, 'department'::text as source_kind,
      coalesce(d.created_at,'-infinity'::timestamptz) as created_at
    from public.org_units d
    where p_kind = 'department'
      and d.is_active
      and app_private.has_permission(v_actor,'work.workspace.create','department',d.id::text)
    union all
    select p.id::text, p.name, 'project'::text,coalesce(p.created_at,'-infinity'::timestamptz)
    from public.projects p
      where p_kind = 'project'
      and p.status in ('planning','active','paused')
      and not p.is_hidden
      and app_private.has_permission(v_actor,'work.workspace.create','project',p.id)
      and (app_private.can_access_module('DA')
        or app_private.project_scope_has_any_grant_v2(p.id,p.construction_site_id::text,v_actor))
  ), visible_rows as (
    select s.source_id, s.name, s.source_kind,s.created_at,
      w.id as existing_workspace_id
    from source_rows s
    left join public.work_workspaces w
      on (s.source_kind='department' and w.department_id::text=s.source_id)
      or (s.source_kind='project' and w.project_id=s.source_id)
    where (v_search='' or lower(s.name) like '%'||lower(v_search)||'%')
      and (v_cursor_at is null or (s.created_at,s.source_id) < (v_cursor_at,v_cursor_id))
  ), page_rows as (
    select v.source_id, v.name, v.source_kind,v.created_at,
      case when v.existing_workspace_id is not null
        and app_private.work_workspace_member_role(v.existing_workspace_id,v_actor) is not null
        then v.existing_workspace_id end as existing_workspace_id
    from visible_rows v
    order by v.created_at desc,v.source_id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.source_id,
      'name',p.name,
      'kind',p.source_kind,
      'existingWorkspaceId',p.existing_workspace_id,
      '__sortAt',p.created_at
    ) order by p.created_at desc,p.source_id desc),'[]'::jsonb)
    into v_rows
  from page_rows p;

  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(x.value - '__sortAt' order by x.ordinality),'[]'::jsonb)
             from jsonb_array_elements(v_rows) with ordinality x(value,ordinality)
             where x.ordinality <= v_limit),
    'nextCursor',case when jsonb_array_length(v_rows)>v_limit then
      jsonb_build_object('sortAt',v_rows->(v_limit-1)->>'__sortAt','id',v_rows->(v_limit-1)->>'id')
      else null end
  );
end;
$$;
revoke all on function app_private.work_workspace_list_sources(text,text,jsonb,integer)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_create(
  p_input jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_existing app_private.work_command_idempotency%rowtype;
  v_hash text;
  v_kind text;
  v_name text;
  v_description text;
  v_icon text;
  v_color text;
  v_cover text;
  v_department uuid;
  v_project text;
  v_scope_id text;
  v_workspace public.work_workspaces%rowtype;
  v_member public.work_workspace_members%rowtype;
  v_result jsonb;
  v_constraint text;
begin
  if p_idempotency_key is null or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_hash := md5(jsonb_build_object('command','create_work_workspace','input',p_input)::text);
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(v_actor,p_idempotency_key,'create_work_workspace',v_hash)
    on conflict (actor_user_id,idempotency_key) do nothing;
  select * into strict v_existing
  from app_private.work_command_idempotency
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key
  for update;
  if v_existing.command_name <> 'create_work_workspace' or v_existing.request_hash <> v_hash then
    raise exception 'WORK_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.response_payload is not null then
    if app_private.work_workspace_member_role((v_existing.response_payload->>'id')::uuid,v_actor) is null then
      raise exception 'WORK_ACCESS_DENIED' using errcode = '42501';
    end if;
    return v_existing.response_payload;
  end if;

  if p_input - array['kind','name','description','iconKey','colorKey','coverKey','departmentId','projectId']
       <> '{}'::jsonb
     or jsonb_typeof(p_input->'kind') is distinct from 'string'
     or jsonb_typeof(p_input->'name') is distinct from 'string'
     or (p_input ? 'description' and jsonb_typeof(p_input->'description') not in ('string','null'))
     or jsonb_typeof(p_input->'iconKey') is distinct from 'string'
     or jsonb_typeof(p_input->'colorKey') is distinct from 'string'
     or jsonb_typeof(p_input->'coverKey') is distinct from 'string' then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_kind := p_input->>'kind';
  v_name := btrim(p_input->>'name');
  v_description := case when p_input ? 'description' then p_input->>'description' end;
  v_icon := p_input->>'iconKey';
  v_color := p_input->>'colorKey';
  v_cover := p_input->>'coverKey';
  if v_kind not in ('department','project','collaboration')
     or char_length(v_name) not between 2 and 160
     or (v_description is not null and char_length(v_description)>2000)
     or v_icon not in ('folder','building','briefcase','users','rocket','target','layers','calendar')
     or v_color not in ('slate','blue','teal','green','amber','orange','rose','violet')
     or v_cover not in ('plain','grid','waves','dots','blueprint','sunrise') then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;

  if v_kind = 'department' then
    if (p_input ? 'projectId') or nullif(btrim(p_input->>'departmentId'),'') is null then
      raise exception 'WORK_INVALID_SCOPE' using errcode = '22023';
    end if;
    begin v_department := (p_input->>'departmentId')::uuid;
    exception when others then raise exception 'WORK_INVALID_SCOPE' using errcode = '22023'; end;
    v_scope_id := v_department::text;
  elsif v_kind = 'project' then
    if (p_input ? 'departmentId') or nullif(btrim(p_input->>'projectId'),'') is null then
      raise exception 'WORK_INVALID_SCOPE' using errcode = '22023';
    end if;
    v_project := btrim(p_input->>'projectId');
    v_scope_id := v_project;
  else
    if p_input ? 'departmentId' or p_input ? 'projectId' then
      raise exception 'WORK_INVALID_SCOPE' using errcode = '22023';
    end if;
    v_scope_id := '*';
  end if;
  if not app_private.has_permission(v_actor,'work.workspace.create',case when v_kind='collaboration' then 'global' else v_kind end,v_scope_id) then
    raise exception 'WORK_WORKSPACE_CREATE_DENIED' using errcode = '42501';
  end if;
  -- Match the existing source SELECT policies after checking create authority.
  -- Missing/invisible projects share one response; their status is not probed.
  if v_kind='project' then
    if not exists(select 1 from public.projects p where p.id=v_project
      and (app_private.can_access_module('DA')
        or app_private.project_scope_has_any_grant_v2(p.id,p.construction_site_id::text,v_actor))) then
      raise exception 'WORK_SOURCE_VIEW_DENIED' using errcode='42501';
    end if;
    if not exists(select 1 from public.projects p where p.id=v_project
      and p.status in ('planning','active','paused') and not p.is_hidden) then
      raise exception 'WORK_SOURCE_NOT_ACTIVE' using errcode='42501';
    end if;
  elsif v_kind='department' and not exists(select 1 from public.org_units d where d.id=v_department and d.is_active) then
    raise exception 'WORK_SOURCE_NOT_ACTIVE' using errcode='42501';
  end if;

  -- A new Workspace must not hide legacy source data.  WS5 will provide the
  -- explicit backfill path for these rows.
  if v_kind='department' and (
      exists(select 1 from public.work_tasks t where t.scope_type='department' and t.department_id=v_department and t.workspace_id is null)
      or exists(select 1 from public.work_task_groups g where g.scope_type='department' and g.department_id=v_department and g.workspace_id is null)
      or exists(select 1 from public.work_sla_policies p where p.scope_type='department' and p.department_id=v_department and p.workspace_id is null)
      or exists(select 1 from public.work_sla_calendars c
        where c.workspace_id is null and c.scope_type='department' and c.department_id=v_department)
    ) then
    raise exception 'WORK_WORKSPACE_MIGRATION_REQUIRED' using errcode = '55000';
  end if;
  if v_kind='project' and (
      exists(select 1 from public.work_tasks t where t.scope_type='project' and t.project_id=v_project and t.workspace_id is null)
      or exists(select 1 from public.work_task_groups g where g.scope_type='project' and g.project_id=v_project and g.workspace_id is null)
      or exists(select 1 from public.work_sla_policies p where p.scope_type='project' and p.project_id=v_project and p.workspace_id is null)
      or exists(select 1 from public.work_sla_calendars c
        where c.workspace_id is null and c.scope_type='project' and c.project_id=v_project)
    ) then
    raise exception 'WORK_WORKSPACE_MIGRATION_REQUIRED' using errcode = '55000';
  end if;

  begin
    insert into public.work_workspaces(
      kind,department_id,project_id,name,description,icon_key,color_key,cover_key,
      status,access_mode,lock_version,created_by
    ) values (
      v_kind,v_department,v_project,v_name,v_description,v_icon,v_color,v_cover,
      'active','workspace',1,v_actor
    ) returning * into v_workspace;
  exception when unique_violation then
    get stacked diagnostics v_constraint = CONSTRAINT_NAME;
    if v_constraint in ('work_workspace_department_unique','work_workspace_project_unique') then
      raise exception 'WORK_WORKSPACE_SOURCE_EXISTS' using errcode = '23505';
    end if;
    raise;
  end;
  insert into public.work_workspace_members(
    workspace_id,user_id,role,status,starts_at,added_by,origin,lock_version
  ) values(v_workspace.id,v_actor,'admin','active',now(),v_actor,'manual',1)
  returning * into v_member;
  insert into app_private.work_workspace_events(
    actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
  ) values(
    v_actor,v_workspace.id,'workspace.created',null,
    jsonb_build_object('workspace',to_jsonb(v_workspace),'member',to_jsonb(v_member)),
    'Workspace created',p_idempotency_key
  );
  v_result := app_private.work_workspace_summary(v_workspace.id,v_actor);
  update app_private.work_command_idempotency
  set response_payload=v_result,completed_at=now()
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_create(jsonb,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_get(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
begin
  if p_workspace_id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  return app_private.work_workspace_summary(p_workspace_id,v_actor);
end;
$$;
revoke all on function app_private.work_workspace_get(uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_list(
  p_search text default '',
  p_kind text default null,
  p_cursor jsonb default null,
  p_pinned_only boolean default null,
  p_sort text default 'updated',
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := coalesce(p_limit,30);
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_rows jsonb;
begin
  if char_length(v_search)>100 or (p_kind is not null and p_kind not in ('department','project','collaboration'))
     or p_sort is null or p_sort not in ('updated','recent') then
    raise exception 'WORK_INVALID_FILTER' using errcode = '22023';
  end if;
  if v_limit<1 or v_limit>50 then
    raise exception 'WORK_INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_cursor is not null then
    perform app_private.work_workspace_validate_cursor(p_cursor,true);
    begin
      v_cursor_at := (p_cursor->>'sortAt')::timestamptz;
      v_cursor_id := (p_cursor->>'id')::uuid;
    exception when others then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end;
  end if;
  with memberships as (
    select distinct m.workspace_id
    from public.work_workspace_members m
    join public.work_workspaces w on w.id=m.workspace_id
    where m.user_id=v_actor and m.status='active'
      and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())
      and w.access_mode='workspace'
  ), source_names as (
    select w.id,
      app_private.work_workspace_source_name(w.kind,w.department_id,w.project_id) source_name
    from public.work_workspaces w join memberships m on m.workspace_id=w.id
  ), candidates as (
    select w.*,sn.source_name,
      coalesce(pref.pinned,false) pinned,
      case when p_sort='recent' then coalesce(pref.last_opened_at,'-infinity'::timestamptz)
        else w.updated_at end sort_at
    from public.work_workspaces w
    join memberships m on m.workspace_id=w.id
    join source_names sn on sn.id=w.id
    left join public.work_workspace_preferences pref
      on pref.workspace_id=w.id and pref.user_id=v_actor
    where (p_kind is null or w.kind=p_kind)
      and (p_pinned_only is null or coalesce(pref.pinned,false)=p_pinned_only)
      and (v_search='' or lower(w.name) like '%'||lower(v_search)||'%' or lower(coalesce(sn.source_name,'')) like '%'||lower(v_search)||'%')
      and (v_cursor_at is null or (case when p_sort='recent' then coalesce(pref.last_opened_at,'-infinity'::timestamptz) else w.updated_at end,w.id)<(v_cursor_at,v_cursor_id))
  ), page_rows as (
    select c.id,c.sort_at
    from candidates c
    order by c.sort_at desc,c.id desc
    limit v_limit+1
  )
  select coalesce(jsonb_agg(
    app_private.work_workspace_summary(p.id,v_actor) || jsonb_build_object('__sortAt',p.sort_at)
    order by p.sort_at desc,p.id desc),'[]'::jsonb)
    into v_rows
  from page_rows p;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(x.value - '__sortAt' order by x.ordinality),'[]'::jsonb)
             from jsonb_array_elements(v_rows) with ordinality x(value,ordinality)
             where x.ordinality<=v_limit),
    'nextCursor',case when jsonb_array_length(v_rows)>v_limit then
      jsonb_build_object('sortAt',v_rows->(v_limit-1)->>'__sortAt','id',v_rows->(v_limit-1)->>'id')
      else null end
  );
end;
$$;
revoke all on function app_private.work_workspace_list(text,text,jsonb,boolean,text,integer)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_members(
  p_workspace_id uuid,
  p_search text default '',
  p_cursor jsonb default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := coalesce(p_limit,30);
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_rows jsonb;
begin
  perform app_private.work_workspace_assert_member(p_workspace_id,v_actor);
  if char_length(v_search)>100 then
    raise exception 'WORK_INVALID_FILTER' using errcode = '22023';
  end if;
  if v_limit<1 or v_limit>50 then
    raise exception 'WORK_INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_cursor is not null then
    perform app_private.work_workspace_validate_cursor(p_cursor,true);
    begin
      v_cursor_at := (p_cursor->>'sortAt')::timestamptz;
      v_cursor_id := (p_cursor->>'id')::uuid;
    exception when others then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end;
  end if;
  with candidates as (
    select m.id,m.user_id,u.name,u.email,u.avatar,m.role,m.origin,m.expires_at,m.lock_version,m.updated_at
    from public.work_workspace_members m
    join public.users u on u.id=m.user_id
    where m.workspace_id=p_workspace_id
      and m.status='active'
      and m.starts_at<=now()
      and (m.expires_at is null or m.expires_at>now())
      and (v_search='' or lower(u.name) like '%'||lower(v_search)||'%' or lower(u.email) like '%'||lower(v_search)||'%')
      and (v_cursor_at is null or (m.updated_at,m.id)<(v_cursor_at,v_cursor_id))
  ), page_rows as (
    select c.* from candidates c
    order by c.updated_at desc,c.id desc
    limit v_limit+1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId',p.user_id,
      'name',p.name,
      'avatarUrl',p.avatar,
      'role',p.role,
      'origin',p.origin,
      'expiresAt',p.expires_at,
      'lockVersion',p.lock_version,
      'updatedAt',p.updated_at,
      '__sortAt',p.updated_at,
      '__id',p.id
    ) order by p.updated_at desc,p.id desc),'[]'::jsonb)
    into v_rows from page_rows p;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(x.value - array['__sortAt','__id'] order by x.ordinality),'[]'::jsonb)
             from jsonb_array_elements(v_rows) with ordinality x(value,ordinality)
             where x.ordinality<=v_limit),
    'nextCursor',case when jsonb_array_length(v_rows)>v_limit then
      jsonb_build_object('sortAt',v_rows->(v_limit-1)->>'__sortAt','id',v_rows->(v_limit-1)->>'__id')
      else null end
  );
end;
$$;
revoke all on function app_private.work_workspace_members(uuid,text,jsonb,integer)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_audit(
  p_workspace_id uuid,
  p_cursor jsonb default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_limit integer := coalesce(p_limit,30);
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_rows jsonb;
begin
  perform app_private.work_workspace_assert_member(p_workspace_id,v_actor);
  if v_limit<1 or v_limit>50 then
    raise exception 'WORK_INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_cursor is not null then
    perform app_private.work_workspace_validate_cursor(p_cursor,true);
    begin
      v_cursor_at := (p_cursor->>'sortAt')::timestamptz;
      v_cursor_id := (p_cursor->>'id')::uuid;
    exception when others then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,
      'actorUserId',p.actor_user_id,
      'kind',p.kind,
      'before',p.before_value,
      'after',p.after_value,
      'reason',p.reason,
      'idempotencyKey',p.idempotency_key,
      'createdAt',p.created_at,
      '__sortAt',p.created_at,
      '__id',p.id
    ) order by p.created_at desc,p.id desc),'[]'::jsonb)
    into v_rows
  from (
    select e.*
    from app_private.work_workspace_events e
    where e.workspace_id=p_workspace_id
      and (v_cursor_at is null or (e.created_at,e.id)<(v_cursor_at,v_cursor_id))
    order by e.created_at desc,e.id desc
    limit v_limit+1
  ) p;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(x.value - array['__sortAt','__id'] order by x.ordinality),'[]'::jsonb)
             from jsonb_array_elements(v_rows) with ordinality x(value,ordinality)
             where x.ordinality<=v_limit),
    'nextCursor',case when jsonb_array_length(v_rows)>v_limit then
      jsonb_build_object('sortAt',v_rows->(v_limit-1)->>'__sortAt','id',v_rows->(v_limit-1)->>'__id')
      else null end
  );
end;
$$;
revoke all on function app_private.work_workspace_audit(uuid,jsonb,integer)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_normalize_changes(
  p_changes jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_operation text;
  v_user_id uuid;
  v_role text;
  v_expiry text;
  v_result jsonb;
begin
  if jsonb_typeof(p_changes) is distinct from 'array'
     or jsonb_array_length(p_changes)>100 then
    raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or v_item - array['operation','userId','role','expiresAt'] <> '{}'::jsonb
       or jsonb_typeof(v_item->'operation') is distinct from 'string'
       or jsonb_typeof(v_item->'userId') is distinct from 'string'
       or (v_item ? 'role' and v_item->'role' is not null and jsonb_typeof(v_item->'role') is distinct from 'string')
       or (v_item ? 'expiresAt' and jsonb_typeof(v_item->'expiresAt') not in ('string','null')) then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    v_operation := v_item->>'operation';
    begin v_user_id := (v_item->>'userId')::uuid;
    exception when others then raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023'; end;
    if v_operation not in ('add','remove','set_role') then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    v_role := case when v_operation='add' then coalesce(nullif(v_item->>'role',''),'member') else v_item->>'role' end;
    if v_operation='set_role' and v_role is null then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    if v_role is not null and v_role not in ('admin','member') then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    if v_operation='remove' and v_item ? 'expiresAt' then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    v_expiry := case when v_item ? 'expiresAt' then v_item->>'expiresAt' end;
    if v_expiry is not null then
      begin perform v_expiry::timestamptz;
      exception when others then raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023'; end;
    end if;
  end loop;
  if exists (
    select 1 from (
      select lower((value->>'userId')::uuid::text) as user_id,
        count(*) over(partition by lower((value->>'userId')::uuid::text)) as n
      from jsonb_array_elements(p_changes) value
    ) x where x.n>1
  ) then
    raise exception 'WORK_DUPLICATE_USERS' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(
      jsonb_build_object('operation',x.operation,'userId',x.user_id)
      || case when x.role is null then '{}'::jsonb else jsonb_build_object('role',x.role) end
      || case when x.has_expires then jsonb_build_object('expiresAt',x.expires_at) else '{}'::jsonb end
      order by x.user_id,x.operation,x.role,coalesce(x.expires_at,'')),'[]'::jsonb)
    into v_result
  from (
    select value->>'operation' as operation,
      lower((value->>'userId')::uuid::text) as user_id,
      case when value->>'operation'='add' then coalesce(nullif(value->>'role',''),'member') else value->>'role' end as role,
      case when value ? 'expiresAt' then value->>'expiresAt' end as expires_at,
      value ? 'expiresAt' as has_expires
    from jsonb_array_elements(p_changes) value
  ) x;
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_normalize_changes(jsonb)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_membership_fingerprint(
  p_workspace_id uuid,
  p_changes jsonb,
  p_at timestamptz default now()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.work_workspaces%rowtype;
  v_changes jsonb := app_private.work_workspace_normalize_changes(p_changes);
  v_members jsonb;
  v_users jsonb;
  v_result text;
begin
  select * into w from public.work_workspaces where id=p_workspace_id;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.user_id,m.id),'[]'::jsonb)
    into v_members
  from public.work_workspace_members m
  where m.workspace_id=p_workspace_id
    and m.user_id in (select (value->>'userId')::uuid from jsonb_array_elements(v_changes));
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',u.id,'isActive',u.is_active,'accountStatus',u.account_status
    ) order by u.id),'[]'::jsonb)
    into v_users
  from public.users u
  where u.id in (select (value->>'userId')::uuid from jsonb_array_elements(v_changes));
  v_result := md5(jsonb_build_object(
    'workspaceId',w.id,
    'lockVersion',w.lock_version,
    'status',w.status,
    'accessMode',w.access_mode,
    'changes',v_changes,
    'members',v_members,
    'users',v_users
  )::text);
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_membership_fingerprint(uuid,jsonb,timestamptz)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_membership_blockers(
  p_workspace_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := app_private.work_workspace_normalize_changes(p_changes);
  v_after_admin_count integer;
  v_rows jsonb;
  v_item jsonb;
begin
  with requested as (
    select value->>'operation' operation,(value->>'userId')::uuid user_id,
      value->>'role' role,value ? 'expiresAt' has_expires,
      case when value->>'expiresAt' is null then null::timestamptz else (value->>'expiresAt')::timestamptz end expires_at
    from jsonb_array_elements(v_changes) value
  ), effective_members as (
    select m.user_id,
      case when r.operation='set_role' then r.role else m.role end role,
      case when r.has_expires then r.expires_at else m.expires_at end expires_at
    from public.work_workspace_members m
    join public.users u on u.id=m.user_id
    left join requested r on r.user_id=m.user_id
    where m.workspace_id=p_workspace_id and m.status='active'
      and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())
      and u.is_active and u.account_status='ACTIVE'
      and coalesce(r.operation,'') <> 'remove'
    union all
    select r.user_id,r.role,r.expires_at
    from requested r
    join public.users u on u.id=r.user_id and u.is_active and u.account_status='ACTIVE'
    where r.operation='add'
      and not exists(select 1 from public.work_workspace_members m where m.workspace_id=p_workspace_id and m.user_id=r.user_id and m.status='active')
  )
  select count(*)::integer into v_after_admin_count
  from effective_members e
  where e.role='admin' and (e.expires_at is null or e.expires_at>now());
  with requested as (
    select value->>'operation' operation,(value->>'userId')::uuid user_id,value->>'role' role
    from jsonb_array_elements(v_changes) value
  ), blockers as (
    select r.user_id,'WORK_LAST_ADMIN'::text code,0::integer open_assignment_count,0::integer open_review_count
    from requested r
    where r.operation in ('remove','set_role')
      and (r.operation='remove' or r.role='member')
      and v_after_admin_count<=0
      and exists(select 1 from public.work_workspace_members m join public.users u on u.id=m.user_id
        where m.workspace_id=p_workspace_id and m.user_id=r.user_id and m.role='admin' and m.status='active'
          and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())
          and u.is_active and u.account_status='ACTIVE')
    union all
    select r.user_id,'WORK_MEMBER_OPEN_ASSIGNMENTS',app_private.work_workspace_open_assignment_count(p_workspace_id,r.user_id),app_private.work_workspace_open_review_count(p_workspace_id,r.user_id)
    from requested r
    where r.operation='remove'
      and (app_private.work_workspace_open_assignment_count(p_workspace_id,r.user_id)>0
        or app_private.work_workspace_open_review_count(p_workspace_id,r.user_id)>0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId',b.user_id,
      'code',b.code,
      'openAssignmentCount',b.open_assignment_count,
      'openReviewCount',b.open_review_count
    ) order by b.user_id,b.code),'[]'::jsonb)
    into v_rows from blockers b;
  return v_rows;
end;
$$;
revoke all on function app_private.work_workspace_membership_blockers(uuid,jsonb)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_preview_members(
  p_workspace_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  w public.work_workspaces%rowtype;
  v_actor_expires timestamptz;
  v_changes jsonb;
  v_item jsonb;
  v_member public.work_workspace_members%rowtype;
  v_expiry timestamptz;
  v_has_expiry boolean;
  v_role text;
  v_blockers jsonb;
  v_fingerprint text;
begin
  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  select * into w from public.work_workspaces where id=p_workspace_id;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  if w.status <> 'active' or w.access_mode <> 'workspace' then
    raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode = '42501';
  end if;
  v_changes := app_private.work_workspace_normalize_changes(p_changes);
  if jsonb_array_length(v_changes)=0 then
    raise exception 'WORK_EMPTY_MEMBERSHIP_BATCH' using errcode = '22023';
  end if;
  select m.expires_at into v_actor_expires
  from public.work_workspace_members m
  where m.workspace_id=p_workspace_id and m.user_id=v_actor and m.status='active'
    and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now());

  for v_item in select value from jsonb_array_elements(v_changes) loop
    v_role := v_item->>'role';
    if v_item->>'operation' in ('add','set_role')
       and not exists(select 1 from public.users u where u.id=(v_item->>'userId')::uuid and u.is_active and u.account_status='ACTIVE') then
      raise exception 'WORK_MEMBER_USER_INACTIVE' using errcode = '42501';
    end if;
    select * into v_member
    from public.work_workspace_members m
    where m.workspace_id=p_workspace_id and m.user_id=(v_item->>'userId')::uuid;
    v_has_expiry := v_item ? 'expiresAt';
    if v_has_expiry and v_item->>'expiresAt' is not null then
      begin v_expiry := (v_item->>'expiresAt')::timestamptz;
      exception when others then raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023'; end;
      if v_expiry <= now() then
        raise exception 'WORK_MEMBERSHIP_EXPIRY_INVALID' using errcode = '22023';
      end if;
      if v_actor_expires is not null and v_expiry > v_actor_expires then
        raise exception 'WORK_MEMBERSHIP_EXPIRY_EXCEEDS_ACTOR' using errcode = '42501';
      end if;
    elsif v_item->>'operation'='add' and v_actor_expires is not null then
      raise exception 'WORK_MEMBERSHIP_EXPIRY_EXCEEDS_ACTOR' using errcode = '42501';
    end if;
    if v_item->>'operation'='set_role' and v_role='admin' and v_actor_expires is not null then
      if (v_has_expiry and v_item->>'expiresAt' is null)
         or (not v_has_expiry and v_member.expires_at is null)
         or (v_has_expiry and v_item->>'expiresAt' is not null and v_expiry > v_actor_expires)
         or (not v_has_expiry and v_member.expires_at > v_actor_expires) then
        raise exception 'WORK_MEMBERSHIP_EXPIRY_EXCEEDS_ACTOR' using errcode = '42501';
      end if;
    end if;
    if v_item->>'operation'='add' and v_member.id is not null and v_member.status='active' then
      raise exception 'WORK_MEMBER_ALREADY_ACTIVE' using errcode = '22023';
    elsif v_item->>'operation' in ('remove','set_role')
      and (v_member.id is null or v_member.status <> 'active'
        or v_member.starts_at>now() or (v_member.expires_at is not null and v_member.expires_at<=now())) then
      raise exception 'WORK_MEMBER_NOT_FOUND' using errcode = '42501';
    end if;
  end loop;
  v_blockers := app_private.work_workspace_membership_blockers(p_workspace_id,v_changes);
  v_fingerprint := app_private.work_workspace_membership_fingerprint(p_workspace_id,v_changes,now());
  return jsonb_build_object(
    'fingerprint',v_fingerprint,
    'changes',v_changes,
    'blockers',v_blockers
  );
end;
$$;
revoke all on function app_private.work_workspace_preview_members(uuid,jsonb)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_apply_members(
  p_workspace_id uuid,
  p_preview jsonb,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_existing app_private.work_command_idempotency%rowtype;
  v_hash text;
  w public.work_workspaces%rowtype;
  v_changes jsonb;
  v_fresh jsonb;
  v_blockers jsonb;
  v_item jsonb;
  v_member public.work_workspace_members%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_expiry timestamptz;
  v_has_expiry boolean;
  v_event_kind text;
  v_changed integer := 0;
  v_result jsonb;
begin
  if p_idempotency_key is null or p_expected_version is null
     or p_preview is null or jsonb_typeof(p_preview) is distinct from 'object'
     or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  perform app_private.work_workspace_assert_member(p_workspace_id,v_actor);
  v_hash := md5(jsonb_build_object(
    'workspaceId',p_workspace_id,'preview',p_preview,
    'expectedVersion',p_expected_version,'reason',btrim(p_reason)
  )::text);
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(v_actor,p_idempotency_key,'apply_work_workspace_members',v_hash)
    on conflict (actor_user_id,idempotency_key) do nothing;
  select * into strict v_existing
  from app_private.work_command_idempotency
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key
  for update;
  if v_existing.command_name <> 'apply_work_workspace_members' or v_existing.request_hash <> v_hash then
    raise exception 'WORK_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.response_payload is not null then
    if app_private.work_workspace_member_role(p_workspace_id,v_actor) is null
       or not app_private.has_permission(v_actor,'work.module.access','global','*') then
      raise exception 'WORK_ACCESS_DENIED' using errcode = '42501';
    end if;
    return v_existing.response_payload;
  end if;
  if p_preview - array['fingerprint','changes','blockers'] <> '{}'::jsonb
     or jsonb_typeof(p_preview->'fingerprint') is distinct from 'string'
     or jsonb_typeof(p_preview->'changes') is distinct from 'array'
     or jsonb_typeof(p_preview->'blockers') is distinct from 'array' then
    raise exception 'WORK_INVALID_MEMBERSHIP_PREVIEW' using errcode = '22023';
  end if;

  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  -- One workspace row is the serialization fence for all membership changes.
  select * into w from public.work_workspaces where id=p_workspace_id for update;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  if w.status <> 'active' or w.access_mode <> 'workspace' then
    raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode = '42501';
  end if;
  if w.lock_version <> p_expected_version then
    raise exception 'WORK_VERSION_CONFLICT';
  end if;
  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  v_changes := app_private.work_workspace_normalize_changes(p_preview->'changes');
  v_fresh := app_private.work_workspace_preview_members(p_workspace_id,v_changes);
  if v_fresh->>'fingerprint' <> p_preview->>'fingerprint' then
    raise exception 'WORK_MEMBERSHIP_PREVIEW_STALE';
  end if;
  v_blockers := v_fresh->'blockers';
  if jsonb_array_length(v_blockers)>0 then
    raise exception '%',v_blockers->0->>'code' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(v_changes) loop
    v_before := null;
    v_after := null;
    v_event_kind := null;
    v_member := null;
    v_has_expiry := v_item ? 'expiresAt';
    v_expiry := case when v_has_expiry and v_item->>'expiresAt' is not null
      then (v_item->>'expiresAt')::timestamptz end;
    select * into v_member
    from public.work_workspace_members m
    where m.workspace_id=p_workspace_id and m.user_id=(v_item->>'userId')::uuid
    for update;
    if v_item->>'operation'='add' then
      if v_member.id is null then
        insert into public.work_workspace_members(
          workspace_id,user_id,role,status,starts_at,expires_at,added_by,origin,lock_version
        ) values(
          p_workspace_id,(v_item->>'userId')::uuid,v_item->>'role','active',now(),v_expiry,v_actor,'manual',1
        ) returning * into v_member;
        v_before := null;
        v_event_kind := 'membership.added';
      else
        v_before := to_jsonb(v_member);
        update public.work_workspace_members
        set role=v_item->>'role',status='active',starts_at=now(),
          expires_at=v_expiry,added_by=v_actor,origin='manual',source_reference=null,
          lock_version=lock_version+1,updated_at=now()
        where id=v_member.id
        returning * into v_member;
        v_event_kind := 'membership.added';
      end if;
      v_after := to_jsonb(v_member);
      v_changed := v_changed+1;
    elsif v_item->>'operation'='remove' then
      v_before := to_jsonb(v_member);
      update public.work_workspace_members
      set status='removed',lock_version=lock_version+1,updated_at=now()
      where id=v_member.id
      returning * into v_member;
      v_after := to_jsonb(v_member);
      v_event_kind := 'membership.removed';
      v_changed := v_changed+1;
    else
      if v_member.role is distinct from v_item->>'role'
         or (v_has_expiry and v_member.expires_at is distinct from v_expiry) then
        v_before := to_jsonb(v_member);
        update public.work_workspace_members
        set role=v_item->>'role',
          expires_at=case when v_has_expiry then v_expiry else expires_at end,
          lock_version=lock_version+1,updated_at=now()
        where id=v_member.id
        returning * into v_member;
        v_after := to_jsonb(v_member);
        v_event_kind := 'membership.role_changed';
        v_changed := v_changed+1;
      end if;
    end if;
    if v_changed > 0 and v_after is not null then
      insert into app_private.work_workspace_events(
        actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
      ) values(v_actor,p_workspace_id,v_event_kind,v_before,v_after,btrim(p_reason),p_idempotency_key);
    end if;
  end loop;
  if v_changed>0 then
    update public.work_workspaces
    set lock_version=lock_version+1,updated_at=now()
    where id=p_workspace_id
    returning * into w;
  end if;
  v_result := jsonb_build_object('lockVersion',w.lock_version);
  update app_private.work_command_idempotency
  set response_payload=v_result,completed_at=now()
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_apply_members(uuid,jsonb,bigint,text,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_command(
  p_workspace_id uuid,
  p_command text,
  p_payload jsonb,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_existing app_private.work_command_idempotency%rowtype;
  v_hash text;
  w public.work_workspaces%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_open_tasks integer;
  v_name text;
  v_description text;
  v_icon text;
  v_color text;
  v_cover text;
begin
  if p_workspace_id is null or p_command is null
     or p_command not in ('update_profile','archive','restore')
     or p_expected_version is null or p_idempotency_key is null
     or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object'
     or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  -- Authorization is checked before revealing or locking the target row.
  perform app_private.work_workspace_assert_admin_role(p_workspace_id,v_actor);
  if p_command in ('archive','restore')
     and not app_private.has_permission(v_actor,'work.workspace.archive','work_workspace',p_workspace_id::text) then
    raise exception 'WORK_WORKSPACE_ARCHIVE_DENIED' using errcode = '42501';
  end if;
  if p_command='update_profile'
     and not app_private.has_permission(v_actor,'work.task.configure','work_workspace',p_workspace_id::text) then
    raise exception 'WORK_WORKSPACE_CONFIGURE_DENIED' using errcode = '42501';
  end if;
  if p_command in ('archive','restore') and p_payload <> '{}'::jsonb then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_hash := md5(jsonb_build_object(
    'workspaceId',p_workspace_id,'command',p_command,'payload',p_payload,
    'expectedVersion',p_expected_version,'reason',btrim(p_reason)
  )::text);
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(v_actor,p_idempotency_key,'command_work_workspace',v_hash)
    on conflict (actor_user_id,idempotency_key) do nothing;
  select * into strict v_existing
  from app_private.work_command_idempotency
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key
  for update;
  if v_existing.command_name <> 'command_work_workspace' or v_existing.request_hash<>v_hash then
    raise exception 'WORK_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.response_payload is not null then
    if app_private.work_workspace_member_role(p_workspace_id,v_actor) is null
       or not app_private.has_permission(v_actor,'work.module.access','global','*') then
      raise exception 'WORK_ACCESS_DENIED' using errcode = '42501';
    end if;
    return v_existing.response_payload;
  end if;
  select * into w from public.work_workspaces where id=p_workspace_id for update;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  if w.lock_version<>p_expected_version then
    raise exception 'WORK_VERSION_CONFLICT';
  end if;
  perform app_private.work_workspace_assert_admin_role(p_workspace_id,v_actor);
  if p_command='update_profile' then
    if w.status<>'active' or w.access_mode<>'workspace' then
      raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode = '42501';
    end if;
    if p_payload - array['name','description','iconKey','colorKey','coverKey'] <> '{}'::jsonb
       or (p_payload ? 'name' and jsonb_typeof(p_payload->'name') is distinct from 'string')
       or (p_payload ? 'description' and jsonb_typeof(p_payload->'description') not in ('string','null'))
       or (p_payload ? 'iconKey' and jsonb_typeof(p_payload->'iconKey') is distinct from 'string')
       or (p_payload ? 'colorKey' and jsonb_typeof(p_payload->'colorKey') is distinct from 'string')
       or (p_payload ? 'coverKey' and jsonb_typeof(p_payload->'coverKey') is distinct from 'string') then
      raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
    end if;
    v_name := case when p_payload ? 'name' then btrim(p_payload->>'name') else w.name end;
    v_description := case when p_payload ? 'description' then p_payload->>'description' else w.description end;
    v_icon := case when p_payload ? 'iconKey' then p_payload->>'iconKey' else w.icon_key end;
    v_color := case when p_payload ? 'colorKey' then p_payload->>'colorKey' else w.color_key end;
    v_cover := case when p_payload ? 'coverKey' then p_payload->>'coverKey' else w.cover_key end;
    if char_length(v_name) not between 2 and 160
       or (v_description is not null and char_length(v_description)>2000)
       or v_icon not in ('folder','building','briefcase','users','rocket','target','layers','calendar')
       or v_color not in ('slate','blue','teal','green','amber','orange','rose','violet')
       or v_cover not in ('plain','grid','waves','dots','blueprint','sunrise') then
      raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
    end if;
    v_before := to_jsonb(w);
    update public.work_workspaces
    set name=v_name,description=v_description,icon_key=v_icon,color_key=v_color,cover_key=v_cover,
      lock_version=lock_version+1,updated_at=now()
    where id=w.id returning * into w;
    v_after := to_jsonb(w);
    insert into app_private.work_workspace_events(
      actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
    ) values(v_actor,w.id,'workspace.profile_updated',v_before,v_after,btrim(p_reason),p_idempotency_key);
  elsif p_command='archive' then
    if w.status='archived' then
      raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode = '42501';
    end if;
    select count(*)::integer into v_open_tasks
    from public.work_tasks t
    where t.workspace_id=w.id and t.status not in ('completed','cancelled');
    if v_open_tasks>0 then
      raise exception 'WORK_WORKSPACE_OPEN_TASKS' using errcode = '42501';
    end if;
    v_before := to_jsonb(w);
    update public.work_workspaces
    set status='archived',lock_version=lock_version+1,updated_at=now()
    where id=w.id returning * into w;
    v_after := to_jsonb(w);
    insert into app_private.work_workspace_events(
      actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
    ) values(v_actor,w.id,'workspace.archived',v_before,v_after,btrim(p_reason),p_idempotency_key);
  else
    if w.status<>'archived' then
      raise exception 'WORK_WORKSPACE_NOT_ARCHIVED' using errcode = '42501';
    end if;
    v_before := to_jsonb(w);
    update public.work_workspaces
    set status='active',lock_version=lock_version+1,updated_at=now()
    where id=w.id returning * into w;
    v_after := to_jsonb(w);
    insert into app_private.work_workspace_events(
      actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
    ) values(v_actor,w.id,'workspace.restored',v_before,v_after,btrim(p_reason),p_idempotency_key);
  end if;
  v_result := app_private.work_workspace_summary(w.id,v_actor);
  update app_private.work_command_idempotency
  set response_payload=v_result,completed_at=now()
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_command(uuid,text,jsonb,bigint,text,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_recover_admin(
  p_workspace_id uuid,
  p_user_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_existing app_private.work_command_idempotency%rowtype;
  v_hash text;
  w public.work_workspaces%rowtype;
  v_target public.users%rowtype;
  v_member public.work_workspace_members%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_active_admins integer;
begin
  if p_workspace_id is null or p_user_id is null or p_idempotency_key is null
     or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  if not app_private.has_permission(v_actor,'work.workspace.recover','global','*') then
    raise exception 'WORK_WORKSPACE_RECOVERY_DENIED' using errcode = '42501';
  end if;
  v_hash := md5(jsonb_build_object(
    'workspaceId',p_workspace_id,'userId',p_user_id,'reason',btrim(p_reason)
  )::text);
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(v_actor,p_idempotency_key,'recover_work_workspace_admin',v_hash)
    on conflict (actor_user_id,idempotency_key) do nothing;
  select * into strict v_existing
  from app_private.work_command_idempotency
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key
  for update;
  if v_existing.command_name<>'recover_work_workspace_admin' or v_existing.request_hash<>v_hash then
    raise exception 'WORK_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.response_payload is not null then
    if not app_private.has_permission(v_actor,'work.workspace.recover','global','*') then
      raise exception 'WORK_WORKSPACE_RECOVERY_DENIED' using errcode = '42501';
    end if;
    return v_existing.response_payload;
  end if;
  select * into w from public.work_workspaces where id=p_workspace_id for update;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  if w.access_mode <> 'workspace' then
    raise exception 'WORK_WORKSPACE_MIGRATION_REQUIRED' using errcode = '55000';
  end if;
  select * into v_target from public.users u
  where u.id=p_user_id and u.is_active and u.account_status='ACTIVE';
  if v_target.id is null then
    raise exception 'WORK_MEMBER_USER_INACTIVE' using errcode = '42501';
  end if;
  select count(*)::integer into v_active_admins
  from public.work_workspace_members m
  join public.users u on u.id=m.user_id
  where m.workspace_id=w.id and m.role='admin' and m.status='active'
    and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())
    and u.is_active and u.account_status='ACTIVE';
  if v_active_admins>0 then
    raise exception 'WORK_RECOVERY_NOT_REQUIRED' using errcode = '42501';
  end if;
  select * into v_member
  from public.work_workspace_members m
  where m.workspace_id=w.id and m.user_id=p_user_id
  for update;
  if v_member.id is null then
    insert into public.work_workspace_members(
      workspace_id,user_id,role,status,starts_at,expires_at,added_by,origin,lock_version
    ) values(w.id,p_user_id,'admin','active',now(),null,v_actor,'manual',1)
    returning * into v_member;
    v_before := null;
  else
    v_before := to_jsonb(v_member);
    update public.work_workspace_members
    set role='admin',status='active',starts_at=now(),expires_at=null,
      added_by=v_actor,origin='manual',source_reference=null,
      lock_version=lock_version+1,updated_at=now()
    where id=v_member.id returning * into v_member;
  end if;
  v_after := to_jsonb(v_member);
  update public.work_workspaces
  set lock_version=lock_version+1,updated_at=now()
  where id=w.id returning * into w;
  insert into app_private.work_workspace_events(
    actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
  ) values(v_actor,w.id,'workspace.admin_recovered',v_before,
    jsonb_build_object('workspace',to_jsonb(w),'member',v_after),btrim(p_reason),p_idempotency_key);
  v_result := jsonb_build_object('workspaceId',w.id,'userId',p_user_id,'lockVersion',w.lock_version);
  update app_private.work_command_idempotency
  set response_payload=v_result,completed_at=now()
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_recover_admin(uuid,uuid,text,uuid)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_set_preference(
  p_workspace_id uuid,
  p_pinned boolean default null,
  p_opened boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_pinned boolean;
  v_last_opened timestamptz;
begin
  perform app_private.work_workspace_assert_member(p_workspace_id,v_actor);
  if p_opened is null then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  insert into public.work_workspace_preferences(user_id,workspace_id,pinned,last_opened_at)
  values(v_actor,p_workspace_id,coalesce(p_pinned,false),case when p_opened then now() end)
  on conflict (user_id,workspace_id) do update set
    pinned=case when p_pinned is null then public.work_workspace_preferences.pinned else excluded.pinned end,
    last_opened_at=case when p_opened then now() else public.work_workspace_preferences.last_opened_at end,
    updated_at=now();
  select p.pinned,p.last_opened_at into v_pinned,v_last_opened
  from public.work_workspace_preferences p
  where p.user_id=v_actor and p.workspace_id=p_workspace_id;
  return jsonb_build_object('workspaceId',p_workspace_id,'pinned',v_pinned,'lastOpenedAt',v_last_opened);
end;
$$;
revoke all on function app_private.work_workspace_set_preference(uuid,boolean,boolean)
  from public, anon, authenticated;

-- Public RPCs are intentionally thin invoker wrappers.  The private guarded
-- implementation owns all reads/writes and is executed with an empty search
-- path; browser roles receive execute on these names only.
create or replace function public.create_work_workspace(p_input jsonb,p_key uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app_private.work_workspace_create(p_input,p_key)
$$;
create or replace function public.list_work_workspace_sources(
  p_kind text,p_search text default '',p_cursor jsonb default null,p_limit integer default 30
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_workspace_list_sources(p_kind,p_search,p_cursor,p_limit)
$$;
create or replace function public.list_my_work_workspaces(
  p_search text default '',p_kind text default null,p_cursor jsonb default null,
  p_pinned_only boolean default null,p_sort text default 'updated',p_limit integer default 30
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_workspace_list(p_search,p_kind,p_cursor,p_pinned_only,p_sort,p_limit)
$$;
create or replace function public.get_work_workspace(p_workspace_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_workspace_get(p_workspace_id)
$$;
create or replace function public.list_work_workspace_members(
  p_workspace_id uuid,p_search text default '',p_cursor jsonb default null,p_limit integer default 30
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_workspace_members(p_workspace_id,p_search,p_cursor,p_limit)
$$;
create or replace function public.list_work_workspace_audit(
  p_workspace_id uuid,p_cursor jsonb default null,p_limit integer default 30
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_workspace_audit(p_workspace_id,p_cursor,p_limit)
$$;
create or replace function public.preview_work_workspace_members(
  p_workspace_id uuid,p_changes jsonb
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_workspace_preview_members(p_workspace_id,p_changes)
$$;
create or replace function public.apply_work_workspace_members(
  p_workspace_id uuid,p_preview jsonb,p_expected_version bigint,p_reason text,p_key uuid
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app_private.work_workspace_apply_members(p_workspace_id,p_preview,p_expected_version,p_reason,p_key)
$$;
create or replace function public.command_work_workspace(
  p_workspace_id uuid,p_command text,p_payload jsonb,p_expected_version bigint,p_reason text,p_key uuid
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app_private.work_workspace_command(p_workspace_id,p_command,p_payload,p_expected_version,p_reason,p_key)
$$;
create or replace function public.recover_work_workspace_admin(
  p_workspace_id uuid,p_user_id uuid,p_reason text,p_key uuid
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app_private.work_workspace_recover_admin(p_workspace_id,p_user_id,p_reason,p_key)
$$;
create or replace function public.set_work_workspace_preference(
  p_workspace_id uuid,p_pinned boolean default null,p_opened boolean default false
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app_private.work_workspace_set_preference(p_workspace_id,p_pinned,p_opened)
$$;

revoke all on function public.create_work_workspace(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_work_workspace(jsonb,uuid) to authenticated;
revoke all on function public.list_work_workspace_sources(text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.list_work_workspace_sources(text,text,jsonb,integer) to authenticated;
revoke all on function public.list_my_work_workspaces(text,text,jsonb,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.list_my_work_workspaces(text,text,jsonb,boolean,text,integer) to authenticated;
revoke all on function public.get_work_workspace(uuid) from public,anon,authenticated;
grant execute on function public.get_work_workspace(uuid) to authenticated;
revoke all on function public.list_work_workspace_members(uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.list_work_workspace_members(uuid,text,jsonb,integer) to authenticated;
revoke all on function public.list_work_workspace_audit(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.list_work_workspace_audit(uuid,jsonb,integer) to authenticated;
revoke all on function public.preview_work_workspace_members(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.preview_work_workspace_members(uuid,jsonb) to authenticated;
revoke all on function public.apply_work_workspace_members(uuid,jsonb,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.apply_work_workspace_members(uuid,jsonb,bigint,text,uuid) to authenticated;
revoke all on function public.command_work_workspace(uuid,text,jsonb,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.command_work_workspace(uuid,text,jsonb,bigint,text,uuid) to authenticated;
revoke all on function public.recover_work_workspace_admin(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.recover_work_workspace_admin(uuid,uuid,text,uuid) to authenticated;
revoke all on function public.set_work_workspace_preference(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.set_work_workspace_preference(uuid,boolean,boolean) to authenticated;

-- Private guarded entries may be invoked by the authenticated gateway as well
-- (the same actor and capability checks still run); all lower-level helpers
-- remain revoked.
grant execute on function app_private.work_workspace_create(jsonb,uuid) to authenticated;
grant execute on function app_private.work_workspace_list_sources(text,text,jsonb,integer) to authenticated;
grant execute on function app_private.work_workspace_list(text,text,jsonb,boolean,text,integer) to authenticated;
grant execute on function app_private.work_workspace_get(uuid) to authenticated;
grant execute on function app_private.work_workspace_members(uuid,text,jsonb,integer) to authenticated;
grant execute on function app_private.work_workspace_audit(uuid,jsonb,integer) to authenticated;
grant execute on function app_private.work_workspace_preview_members(uuid,jsonb) to authenticated;
grant execute on function app_private.work_workspace_apply_members(uuid,jsonb,bigint,text,uuid) to authenticated;
grant execute on function app_private.work_workspace_command(uuid,text,jsonb,bigint,text,uuid) to authenticated;
grant execute on function app_private.work_workspace_recover_admin(uuid,uuid,text,uuid) to authenticated;
grant execute on function app_private.work_workspace_set_preference(uuid,boolean,boolean) to authenticated;
