-- E27: versioned Business Role administration, rich assignment preview and
-- an authorization-admin read model. Generated with `supabase migration new`;
-- renamed after the Asia/Ho_Chi_Minh release ledger because the CLI uses UTC.

create or replace function app_private.evaluate_business_role_assignment_impl(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_scope_type text:=coalesce(nullif(p_scope_type,''),'global');
  v_scope_id text:=coalesce(nullif(p_scope_id,''),'*');
  v_role public.role_permission_templates%rowtype;
  v_proposed jsonb:='[]'::jsonb;
  v_decision jsonb;
  v_permission_count integer:=0;
  v_sensitive_count integer:=0;
  v_approval_count integer:=0;
  v_fingerprint text;
begin
  if p_actor_user_id is null
     or p_actor_user_id is distinct from public.current_app_user_id()
     or not app_private.has_permission(
       p_actor_user_id,'system.authorization.manage_roles','global','*'
     ) then
    raise exception 'Authorization administration permission required' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.users target_row
    where target_row.id=p_target_user_id
      and target_row.is_active and target_row.account_status='ACTIVE'
  ) then
    raise exception 'Active target user required' using errcode='23514';
  end if;

  select * into v_role
  from public.role_permission_templates role_row
  where role_row.id=p_role_template_id and role_row.is_active;
  if v_role.id is null then
    raise exception 'Valid Business Role required' using errcode='23514';
  end if;

  if v_role.code='SUPER_ADMIN' then
    if v_scope_type<>'global' or v_scope_id<>'*' then
      raise exception 'SUPER_ADMIN requires global scope' using errcode='23514';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'permissionCode',action_row.permission_code,
      'scopeType',case when 'global'=any(action_row.scope_modes)
        then 'global' else action_row.scope_modes[1] end,
      'scopeId','*'
    ) order by action_row.permission_code),'[]'::jsonb),
      count(*),
      count(*) filter(where action_row.risk_level='sensitive'),
      count(*) filter(where action_row.is_business_approval)
    into v_proposed,v_permission_count,v_sensitive_count,v_approval_count
    from public.permission_actions action_row
    join public.permission_modules module_row on module_row.code=action_row.module_code
    where action_row.is_active and module_row.is_active;
  else
    if v_scope_type not in (
      'global','own','assigned','project','construction_site','warehouse',
      'department','direct_reports','org_unit','work_workspace'
    ) or (v_scope_type='global' and v_scope_id<>'*')
      or (v_scope_type<>'global' and btrim(v_scope_id)='')
      or exists (
        select 1
        from public.role_permission_template_items item
        join public.permission_actions action_row
          on action_row.permission_code=item.permission_code and action_row.is_active
        where item.template_id=p_role_template_id
          and (
            (v_scope_type<>'global' and item.scope_type<>'global' and (
              item.scope_type<>v_scope_type or (
                v_scope_id<>'*' and item.scope_id<>'*' and item.scope_id<>v_scope_id
              )
            ))
            or not (case when v_scope_type<>'global' then v_scope_type
              else item.scope_type end=any(action_row.scope_modes))
          )
      ) then
      raise exception 'Business Role does not support the requested assignment scope'
        using errcode='23514';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'permissionCode',proposed.permission_code,
      'scopeType',proposed.scope_type,
      'scopeId',proposed.scope_id
    ) order by proposed.permission_code,proposed.scope_type,proposed.scope_id),'[]'::jsonb),
      count(*),
      count(*) filter(where action_row.risk_level='sensitive'),
      count(*) filter(where action_row.is_business_approval)
    into v_proposed,v_permission_count,v_sensitive_count,v_approval_count
    from (
      select distinct item.permission_code,
        case when v_scope_type='global' then item.scope_type
          when item.scope_type='global' then v_scope_type else item.scope_type end scope_type,
        case when v_scope_type='global' then item.scope_id
          when item.scope_type='global' then v_scope_id
          when v_scope_id='*' then item.scope_id
          when item.scope_id='*' then v_scope_id else v_scope_id end scope_id
      from public.role_permission_template_items item
      where item.template_id=p_role_template_id
    ) proposed
    join public.permission_actions action_row
      on action_row.permission_code=proposed.permission_code and action_row.is_active;
  end if;

  v_decision:=app_private.evaluate_authorization_change_set(
    p_actor_user_id,p_target_user_id,v_proposed,'ADD'
  );

  if v_role.code='SUPER_ADMIN' and (
    p_actor_user_id=p_target_user_id
    or not app_private.actor_has_permission_admin_role(p_actor_user_id)
  ) then
    v_decision:=jsonb_set(v_decision,'{hardDenies}',
      coalesce(v_decision->'hardDenies','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
        'ruleCode','SUPER_ADMIN_PROTECTED_ASSIGNMENT',
        'scopeType','global','scopeId','*',
        'message','SUPER_ADMIN requires another active global PERMISSION_ADMIN actor.'
      ))
    );
  end if;

  v_fingerprint:=md5(jsonb_build_object(
    'targetUserId',p_target_user_id,'roleTemplateId',v_role.id,
    'roleVersion',v_role.version,'scopeType',v_scope_type,'scopeId',v_scope_id,
    'decision',v_decision,'permissions',v_proposed
  )::text);

  return v_decision||jsonb_build_object(
    'roleTemplateId',v_role.id,
    'roleCode',v_role.code,
    'roleVersion',v_role.version,
    'dynamic',v_role.code='SUPER_ADMIN',
    'futureActionPolicy',case when v_role.code='SUPER_ADMIN'
      then 'auto_include' else 'manual_review' end,
    'assignmentScopeType',v_scope_type,
    'assignmentScopeId',v_scope_id,
    'permissionCount',v_permission_count,
    'sensitivePermissionCount',v_sensitive_count,
    'businessApprovalPermissionCount',v_approval_count,
    'permissions',v_proposed,
    'fingerprint',v_fingerprint
  );
end;
$$;

create or replace function app_private.get_business_role_admin_snapshot_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid;
begin
  v_actor:=app_private.assert_authorization_permission('system.authorization.manage_roles');
  return jsonb_build_object(
    'generatedAt',now(),
    'templates',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',template_row.id,'code',template_row.code,'name',template_row.name,
        'description',template_row.description,'isActive',template_row.is_active,
        'isSystem',template_row.is_system,'version',template_row.version,
        'dynamic',template_row.code='SUPER_ADMIN',
        'locked',template_row.is_system,
        'futureActionPolicy',case when template_row.code='SUPER_ADMIN'
          then 'auto_include' else 'manual_review' end,
        'effectiveActionCount',case when template_row.code='SUPER_ADMIN'
          then (select count(*) from public.permission_actions action_row
            join public.permission_modules module_row on module_row.code=action_row.module_code
            where action_row.is_active and module_row.is_active)
          else (select count(*) from public.role_permission_template_items role_item
            where role_item.template_id=template_row.id) end,
        'items',coalesce((select jsonb_agg(jsonb_build_object(
          'permissionCode',role_item.permission_code,
          'scopeType',role_item.scope_type,'scopeId',role_item.scope_id,
          'sortOrder',role_item.sort_order
        ) order by role_item.sort_order,role_item.permission_code)
          from public.role_permission_template_items role_item
          where role_item.template_id=template_row.id),'[]'::jsonb),
        'assignments',coalesce((select jsonb_agg(jsonb_build_object(
          'id',assignment.id,'targetUserId',assignment.principal_id,
          'scopeType',assignment.scope_type,'scopeId',assignment.scope_id,
          'startsAt',assignment.starts_at,'expiresAt',assignment.expires_at,
          'status',assignment.status,'assignedReason',assignment.assigned_reason,
          'updatedAt',assignment.updated_at
        ) order by assignment.created_at desc)
          from public.principal_role_assignments assignment
          where assignment.role_template_id=template_row.id
            and assignment.principal_type='user'
            and assignment.status='ACTIVE'),'[]'::jsonb)
      ) order by template_row.is_system desc,template_row.name,template_row.code)
      from public.role_permission_templates template_row
      where template_row.is_active
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_business_role_admin_snapshot()
returns jsonb
language sql
stable
set search_path=''
as $$ select app_private.get_business_role_admin_snapshot_impl(); $$;

create or replace function public.preview_business_role_assignment_v2(
  p_target_user_id uuid,p_role_template_id uuid,p_scope_type text,p_scope_id text
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select app_private.preview_business_role_assignment_impl(
    p_target_user_id,p_role_template_id,p_scope_type,p_scope_id
  );
$$;

create or replace function app_private.save_business_role_v2_impl(
  p_role_template_id uuid,p_expected_role_version integer,p_code text,p_name text,
  p_description text,p_items jsonb,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid;
  v_current_version integer;
  v_role_id uuid;
begin
  v_actor:=app_private.assert_authorization_permission('system.authorization.manage_roles');
  if p_role_template_id is null then
    if p_expected_role_version is not null and p_expected_role_version<>0 then
      raise exception 'AUTHORIZATION_STALE_ROLE_VERSION' using errcode='40001';
    end if;
  else
    select version into v_current_version
    from public.role_permission_templates where id=p_role_template_id for update;
    if v_current_version is null then
      raise exception 'Business Role does not exist' using errcode='23503';
    end if;
    if p_expected_role_version is null or p_expected_role_version<>v_current_version then
      raise exception 'AUTHORIZATION_STALE_ROLE_VERSION' using errcode='40001';
    end if;
  end if;

  v_role_id:=app_private.save_business_role_impl(
    p_role_template_id,p_code,p_name,p_description,p_items,p_reason
  );
  select version into v_current_version
  from public.role_permission_templates where id=v_role_id;
  return jsonb_build_object(
    'roleTemplateId',v_role_id,'version',v_current_version,
    'savedAt',now(),'actorUserId',v_actor
  );
end;
$$;

create or replace function public.save_business_role_v2(
  p_role_template_id uuid,p_expected_role_version integer,p_code text,p_name text,
  p_description text,p_items jsonb,p_reason text
)
returns jsonb
language sql
set search_path=''
as $$
  select app_private.save_business_role_v2_impl(
    p_role_template_id,p_expected_role_version,p_code,p_name,p_description,p_items,p_reason
  );
$$;

create or replace function app_private.assign_business_role_v2_impl(
  p_target_user_id uuid,p_role_template_id uuid,p_expected_role_version integer,
  p_scope_type text,p_scope_id text,p_starts_at timestamptz,p_expires_at timestamptz,
  p_reason text,p_warning_acceptances jsonb,p_expected_preview_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid;
  v_role_version integer;
  v_preview jsonb;
  v_assignment_id uuid;
begin
  v_actor:=app_private.assert_authorization_permission('system.authorization.manage_roles');
  perform 1 from public.users where id=p_target_user_id for update;
  select version into v_role_version
  from public.role_permission_templates where id=p_role_template_id for update;
  if v_role_version is null then
    raise exception 'Business Role does not exist' using errcode='23503';
  end if;
  if p_expected_role_version is null or p_expected_role_version<>v_role_version then
    raise exception 'AUTHORIZATION_STALE_ROLE_VERSION' using errcode='40001';
  end if;

  v_preview:=app_private.evaluate_business_role_assignment_impl(
    v_actor,p_target_user_id,p_role_template_id,p_scope_type,p_scope_id
  );
  if nullif(p_expected_preview_fingerprint,'') is null
     or p_expected_preview_fingerprint is distinct from v_preview->>'fingerprint' then
    raise exception 'AUTHORIZATION_STALE_ASSIGNMENT_PREVIEW' using errcode='40001';
  end if;

  v_assignment_id:=app_private.assign_business_role_impl(
    p_target_user_id,p_role_template_id,p_scope_type,p_scope_id,p_starts_at,
    p_expires_at,p_reason,p_warning_acceptances
  );
  return jsonb_build_object(
    'assignmentId',v_assignment_id,'roleTemplateId',p_role_template_id,
    'roleVersion',v_role_version,'previewFingerprint',v_preview->>'fingerprint',
    'assignedAt',now(),'actorUserId',v_actor
  );
end;
$$;

create or replace function public.assign_business_role_v2(
  p_target_user_id uuid,p_role_template_id uuid,p_expected_role_version integer,
  p_scope_type text,p_scope_id text,p_starts_at timestamptz,p_expires_at timestamptz,
  p_reason text,p_warning_acceptances jsonb,p_expected_preview_fingerprint text
)
returns jsonb
language sql
set search_path=''
as $$
  select app_private.assign_business_role_v2_impl(
    p_target_user_id,p_role_template_id,p_expected_role_version,p_scope_type,p_scope_id,
    p_starts_at,p_expires_at,p_reason,p_warning_acceptances,p_expected_preview_fingerprint
  );
$$;

revoke all on function app_private.get_business_role_admin_snapshot_impl()
  from public,anon;
revoke all on function app_private.save_business_role_v2_impl(uuid,integer,text,text,text,jsonb,text)
  from public,anon;
revoke all on function app_private.assign_business_role_v2_impl(uuid,uuid,integer,text,text,timestamptz,timestamptz,text,jsonb,text)
  from public,anon;
grant execute on function app_private.get_business_role_admin_snapshot_impl() to authenticated,service_role;
grant execute on function app_private.save_business_role_v2_impl(uuid,integer,text,text,text,jsonb,text) to authenticated,service_role;
grant execute on function app_private.assign_business_role_v2_impl(uuid,uuid,integer,text,text,timestamptz,timestamptz,text,jsonb,text) to authenticated,service_role;

revoke all on function public.get_business_role_admin_snapshot() from public,anon;
revoke all on function public.preview_business_role_assignment_v2(uuid,uuid,text,text) from public,anon;
revoke all on function public.save_business_role_v2(uuid,integer,text,text,text,jsonb,text) from public,anon;
revoke all on function public.assign_business_role_v2(uuid,uuid,integer,text,text,timestamptz,timestamptz,text,jsonb,text) from public,anon;
grant execute on function public.get_business_role_admin_snapshot() to authenticated,service_role;
grant execute on function public.preview_business_role_assignment_v2(uuid,uuid,text,text) to authenticated,service_role;
grant execute on function public.save_business_role_v2(uuid,integer,text,text,text,jsonb,text) to authenticated,service_role;
grant execute on function public.assign_business_role_v2(uuid,uuid,integer,text,text,timestamptz,timestamptz,text,jsonb,text) to authenticated,service_role;

-- Browser clients must use the versioned commands. Service-role maintenance
-- retains the compatibility wrappers for controlled operational recovery.
revoke execute on function public.save_business_role(uuid,text,text,text,jsonb,text)
  from anon,authenticated;
revoke execute on function public.assign_business_role(uuid,uuid,text,text,timestamptz,timestamptz,text,jsonb)
  from anon,authenticated;
