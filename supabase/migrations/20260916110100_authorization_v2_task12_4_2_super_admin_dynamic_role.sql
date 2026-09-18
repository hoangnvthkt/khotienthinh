-- E26-B: protected dynamic SUPER_ADMIN. The template intentionally has no
-- permission items; the resolver expands active catalog actions at read time.

do $$
begin
  if exists (
    select 1 from public.role_permission_templates
    where code='SUPER_ADMIN' and not is_system
  ) then
    raise exception 'Existing non-system SUPER_ADMIN template blocks protected seed'
      using errcode='55000';
  end if;
end;
$$;

insert into public.role_permission_templates (
  code,name,description,is_active,is_system,version,created_by
)
values (
  'SUPER_ADMIN','Super Admin',
  'Vai trò gốc được khóa, tự nhận toàn bộ capability hiện tại và tương lai.',
  true,true,1,null
)
on conflict (code) do update
set name=excluded.name,
    description=excluded.description,
    is_active=true,
    is_system=true,
    updated_at=now();

do $$
begin
  if exists (
    select 1 from public.role_permission_template_items item
    join public.role_permission_templates template_row on template_row.id=item.template_id
    where template_row.code='SUPER_ADMIN'
  ) then
    raise exception 'SUPER_ADMIN must remain dynamic and item-free' using errcode='55000';
  end if;
end;
$$;

create or replace function app_private.actor_has_permission_admin_role(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.users actor
    join public.principal_role_assignments assignment
      on assignment.principal_type='user'
     and assignment.principal_id=actor.id
     and assignment.status='ACTIVE'
     and assignment.starts_at<=now()
     and (assignment.expires_at is null or assignment.expires_at>now())
     and assignment.scope_type='global'
     and assignment.scope_id='*'
    join public.role_permission_templates template_row
      on template_row.id=assignment.role_template_id
     and template_row.code='PERMISSION_ADMIN'
     and template_row.is_system
     and template_row.is_active
    where actor.id=p_actor_id
      and actor.is_active
      and actor.account_status='ACTIVE'
  );
$$;

revoke all on function app_private.actor_has_permission_admin_role(uuid)
  from public,anon,authenticated,service_role;

create or replace function app_private.guard_super_admin_assignment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=public.current_app_user_id();
  v_role_code text;
  v_other_count integer;
begin
  select code into v_role_code
  from public.role_permission_templates
  where id=coalesce(new.role_template_id,old.role_template_id);
  if v_role_code is distinct from 'SUPER_ADMIN' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if not app_private.actor_has_permission_admin_role(v_actor) then
    raise exception 'SUPER_ADMIN_REQUIRES_PERMISSION_ADMIN' using errcode='42501';
  end if;

  if tg_op='INSERT' then
    if new.principal_type<>'user' or new.principal_id=v_actor
       or new.scope_type<>'global' or new.scope_id<>'*'
       or new.status<>'ACTIVE' or new.starts_at>now() or new.expires_at is not null then
      raise exception 'SUPER_ADMIN_ASSIGNMENT_INVALID' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.users target
      where target.id=new.principal_id and target.is_active and target.account_status='ACTIVE'
    ) then
      raise exception 'SUPER_ADMIN_TARGET_INACTIVE' using errcode='23514';
    end if;
    return new;
  end if;

  if new.principal_id is distinct from old.principal_id
     or new.role_template_id is distinct from old.role_template_id
     or new.scope_type is distinct from old.scope_type
     or new.scope_id is distinct from old.scope_id
     or new.starts_at is distinct from old.starts_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'SUPER_ADMIN_ASSIGNMENT_IMMUTABLE' using errcode='55000';
  end if;

  if old.status='ACTIVE' and new.status<>'ACTIVE' then
    select count(*) into v_other_count
    from public.principal_role_assignments assignment
    join public.role_permission_templates template_row
      on template_row.id=assignment.role_template_id and template_row.code='SUPER_ADMIN'
    join public.users target
      on target.id=assignment.principal_id and target.is_active and target.account_status='ACTIVE'
    where assignment.id<>old.id
      and assignment.principal_type='user'
      and assignment.status='ACTIVE'
      and assignment.starts_at<=now()
      and assignment.expires_at is null
      and assignment.scope_type='global'
      and assignment.scope_id='*';
    if v_other_count=0 then
      raise exception 'LAST_SUPER_ADMIN_REQUIRED' using errcode='55000';
    end if;
  elsif old.status<>'ACTIVE' and new.status='ACTIVE' then
    raise exception 'SUPER_ADMIN_REACTIVATION_REQUIRES_NEW_ASSIGNMENT' using errcode='55000';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_super_admin_assignment()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_guard_super_admin_assignment on public.principal_role_assignments;
create trigger trg_guard_super_admin_assignment
before insert or update on public.principal_role_assignments
for each row execute function app_private.guard_super_admin_assignment();

create or replace function app_private.guard_super_admin_template()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.code='SUPER_ADMIN' then
    raise exception 'SUPER_ADMIN_TEMPLATE_LOCKED' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.guard_super_admin_template()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_guard_super_admin_template on public.role_permission_templates;
create trigger trg_guard_super_admin_template
before update or delete on public.role_permission_templates
for each row execute function app_private.guard_super_admin_template();

create or replace function app_private.guard_super_admin_template_item()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if exists (
    select 1 from public.role_permission_templates template_row
    where template_row.id=coalesce(new.template_id,old.template_id)
      and template_row.code='SUPER_ADMIN'
  ) then
    raise exception 'SUPER_ADMIN_TEMPLATE_ITEMS_FORBIDDEN' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.guard_super_admin_template_item()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_guard_super_admin_template_item on public.role_permission_template_items;
create trigger trg_guard_super_admin_template_item
before insert or update or delete on public.role_permission_template_items
for each row execute function app_private.guard_super_admin_template_item();

create or replace function app_private.resolve_effective_permission_sources(
  p_user_id uuid,
  p_permission_code text default null,
  p_scope_type text default null,
  p_scope_id text default null,
  p_at timestamptz default now()
)
returns table(
  permission_code text,source_type text,source_id text,source_code text,
  source_label text,scope_type text,scope_id text,starts_at timestamptz,
  expires_at timestamptz,risk_level text,is_business_approval boolean,metadata jsonb
)
language sql
stable
security definer
set search_path=''
as $$
  with active_user as (
    select u.* from public.users u
    where u.id=p_user_id and u.is_active and u.account_status='ACTIVE'
  ), active_actions as (
    select pa.*,pm.application_code,pm.legacy_module_key as module_legacy_key
    from public.permission_actions pa
    join public.permission_modules pm on pm.code=pa.module_code
    where pa.is_active and pm.is_active
      and (p_permission_code is null or pa.permission_code=p_permission_code)
  ), role_sources as (
    select item.permission_code,'ROLE'::text,assignment.id::text,
      role_template.code,role_template.name,
      case when assignment.scope_type='global' then item.scope_type else assignment.scope_type end,
      case when assignment.scope_type='global' then item.scope_id
        when item.scope_type='global' then assignment.scope_id
        when assignment.scope_id='*' then item.scope_id else assignment.scope_id end,
      assignment.starts_at,assignment.expires_at,action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object('roleTemplateId',role_template.id,'assignmentId',assignment.id,
        'assignmentScopeType',assignment.scope_type,'assignmentScopeId',assignment.scope_id)
    from active_user user_row
    join public.principal_role_assignments assignment
      on assignment.principal_type='user' and assignment.principal_id=user_row.id
     and assignment.status='ACTIVE' and assignment.starts_at<=p_at
     and (assignment.expires_at is null or assignment.expires_at>p_at)
    join public.role_permission_templates role_template
      on role_template.id=assignment.role_template_id and role_template.is_active
    join public.role_permission_template_items item on item.template_id=role_template.id
    join active_actions action_row on action_row.permission_code=item.permission_code
    where app_private.permission_hardening_flag('business_role_resolver_enabled')
      and (item.permission_code<>'system.settings.manage'
        or (role_template.code='SYSTEM_ADMIN' and user_row.role='ADMIN'))
      and (assignment.scope_type='global' or item.scope_type='global'
        or (assignment.scope_type=item.scope_type and
          (assignment.scope_id='*' or item.scope_id='*' or assignment.scope_id=item.scope_id)))
      and (p_scope_type is null or (
        app_private.scope_covers(assignment.scope_type,assignment.scope_id,p_scope_type,p_scope_id)
        and app_private.scope_covers(item.scope_type,item.scope_id,p_scope_type,p_scope_id)))
  ), super_admin_sources as (
    select action_row.permission_code,'ROLE'::text,assignment.id::text,
      role_template.code,role_template.name,'global'::text,'*'::text,
      assignment.starts_at,assignment.expires_at,action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object('roleTemplateId',role_template.id,'assignmentId',assignment.id,
        'dynamic',true,'futureActionPolicy','auto_include')
    from active_user user_row
    join public.principal_role_assignments assignment
      on assignment.principal_type='user' and assignment.principal_id=user_row.id
     and assignment.status='ACTIVE' and assignment.starts_at<=p_at
     and assignment.expires_at is null
     and assignment.scope_type='global' and assignment.scope_id='*'
    join public.role_permission_templates role_template
      on role_template.id=assignment.role_template_id
     and role_template.code='SUPER_ADMIN' and role_template.is_system and role_template.is_active
    cross join active_actions action_row
    where app_private.permission_hardening_flag('business_role_resolver_enabled')
      and (p_scope_type is null or app_private.scope_covers('global','*',p_scope_type,p_scope_id))
  ), direct_sources as (
    select grant_row.permission_code,'DIRECT'::text,grant_row.id::text,'DIRECT'::text,
      'Direct grant'::text,grant_row.scope_type,grant_row.scope_id,
      grant_row.granted_at,grant_row.expires_at,action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object('grantedBy',grant_row.granted_by,'reason',grant_row.grant_reason)
    from active_user user_row
    join public.user_permission_grants grant_row
      on grant_row.user_id=user_row.id and grant_row.is_active
     and grant_row.granted_at<=p_at and (grant_row.expires_at is null or grant_row.expires_at>p_at)
    join active_actions action_row on action_row.permission_code=grant_row.permission_code
    where grant_row.permission_code<>'system.settings.manage'
      and (p_scope_type is null or app_private.scope_covers(
        grant_row.scope_type,grant_row.scope_id,p_scope_type,p_scope_id))
  ), legacy_sources as (
    select action_row.permission_code,'LEGACY'::text,
      coalesce(action_row.legacy_module_key,action_row.module_legacy_key,'legacy')::text,
      coalesce(action_row.legacy_module_key,action_row.module_legacy_key,'LEGACY')::text,
      'Legacy permission'::text,'global'::text,'*'::text,null::timestamptz,null::timestamptz,
      action_row.risk_level,action_row.is_business_approval,
      jsonb_build_object('legacyModuleKey',coalesce(action_row.legacy_module_key,action_row.module_legacy_key),
        'legacyRoute',action_row.legacy_route,'legacyAdminCompatibility',user_row.role='ADMIN')
    from active_user user_row join active_actions action_row on true
    where not app_private.permission_hardening_flag('legacy_fallback_disabled') and (
      (user_row.role='ADMIN' and (
        (action_row.is_business_approval and not app_private.permission_hardening_flag('system_admin_business_approval_bypass_disabled'))
        or (action_row.module_code='system.authorization' and not app_private.permission_hardening_flag('legacy_governance_fallback_disabled'))
        or (not action_row.is_business_approval and action_row.module_code<>'system.authorization')
      )) or (user_row.role<>'ADMIN'
        and (action_row.module_code<>'system.authorization' or not app_private.permission_hardening_flag('legacy_governance_fallback_disabled'))
        and coalesce(action_row.legacy_module_key,action_row.module_legacy_key) is not null
        and case when action_row.legacy_admin_only or action_row.action='manage' then
          coalesce(action_row.legacy_module_key,action_row.module_legacy_key)=any(coalesce(user_row.admin_modules,'{}'::text[]))
          or (action_row.legacy_route is null and coalesce(user_row.admin_sub_modules,'{}'::jsonb)?coalesce(action_row.legacy_module_key,action_row.module_legacy_key))
          or (action_row.legacy_route is not null and coalesce(user_row.admin_sub_modules->coalesce(action_row.legacy_module_key,action_row.module_legacy_key),'[]'::jsonb)?action_row.legacy_route)
        else user_row.allowed_modules is null
          or coalesce(action_row.legacy_module_key,action_row.module_legacy_key)=any(coalesce(user_row.allowed_modules,'{}'::text[]))
          or coalesce(action_row.legacy_module_key,action_row.module_legacy_key)=any(coalesce(user_row.admin_modules,'{}'::text[]))
          or (action_row.legacy_route is null and (coalesce(user_row.allowed_sub_modules,'{}'::jsonb)?coalesce(action_row.legacy_module_key,action_row.module_legacy_key)
            or coalesce(user_row.admin_sub_modules,'{}'::jsonb)?coalesce(action_row.legacy_module_key,action_row.module_legacy_key)))
          or (action_row.legacy_route is not null and (coalesce(user_row.allowed_sub_modules->coalesce(action_row.legacy_module_key,action_row.module_legacy_key),'[]'::jsonb)?action_row.legacy_route
            or coalesce(user_row.admin_sub_modules->coalesce(action_row.legacy_module_key,action_row.module_legacy_key),'[]'::jsonb)?action_row.legacy_route))
        end)
    )
  )
  select * from role_sources
  union all select * from super_admin_sources
  union all select * from direct_sources
  union all select * from legacy_sources
  union all select * from app_private.work_workspace_permission_sources(
    p_user_id,p_permission_code,p_scope_type,p_scope_id,p_at
  );
$$;

comment on function app_private.resolve_effective_permission_sources(uuid,text,text,text,timestamptz) is
  'Authorization V2 resolver including protected dynamic SUPER_ADMIN sources.';
