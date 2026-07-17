-- Phase 2 governed Business Role, assignment, rollout and direct-grant commands.

create or replace function app_private.assert_authorization_permission(
  p_permission_code text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if v_actor_user_id is null
    or not app_private.has_permission(
      v_actor_user_id,
      p_permission_code,
      'global',
      '*'
    )
  then
    raise exception 'Authorization administration permission required'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

create or replace function app_private.assert_and_record_sod_warnings(
  p_decision jsonb,
  p_acceptances jsonb,
  p_command_type text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hard_denies jsonb := coalesce(p_decision -> 'hardDenies', '[]'::jsonb);
  v_warnings jsonb := coalesce(p_decision -> 'warnings', '[]'::jsonb);
  v_acceptances jsonb := coalesce(p_acceptances, '[]'::jsonb);
  v_warning jsonb;
  v_acceptance jsonb;
  v_owner_id uuid;
  v_expires_at timestamptz;
begin
  if p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_any_permission(
      public.current_app_user_id(),
      array[
        'system.authorization.manage_roles',
        'system.authorization.manage_grants'
      ],
      'global',
      '*'
    )
  then
    raise exception 'Authorization administration permission required'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_hard_denies) <> 'array'
    or jsonb_typeof(v_warnings) <> 'array'
    or jsonb_typeof(v_acceptances) <> 'array'
  then
    raise exception 'Invalid SoD decision or warning acceptances'
      using errcode = '22023';
  end if;

  if jsonb_array_length(v_hard_denies) > 0 then
    raise exception 'Authorization change violates a hard SoD rule'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_acceptances) supplied
    group by
      supplied.value ->> 'ruleCode',
      supplied.value ->> 'scopeType',
      supplied.value ->> 'scopeId'
    having count(*) > 1
  ) then
    raise exception 'Duplicate SoD warning acknowledgement'
      using errcode = '22023';
  end if;

  for v_warning in
    select value
    from jsonb_array_elements(v_warnings)
  loop
    select value
    into v_acceptance
    from jsonb_array_elements(v_acceptances)
    where value ->> 'ruleCode' = v_warning ->> 'ruleCode'
      and value ->> 'scopeType' = v_warning ->> 'scopeType'
      and value ->> 'scopeId' = v_warning ->> 'scopeId'
    limit 1;

    if v_acceptance is null then
      raise exception 'SoD warning acknowledgement required'
        using errcode = '22023';
    end if;

    begin
      v_owner_id := nullif(v_acceptance ->> 'controlOwnerUserId', '')::uuid;
      v_expires_at := nullif(v_acceptance ->> 'expiresAt', '')::timestamptz;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'Invalid SoD warning control evidence'
          using errcode = '22023';
    end;

    if char_length(btrim(coalesce(v_acceptance ->> 'reason', ''))) < 10
      or char_length(btrim(coalesce(v_acceptance ->> 'compensatingControls', ''))) < 10
      or v_expires_at is null
      or v_expires_at <= now()
      or v_owner_id is null
      or v_owner_id = p_actor_user_id
      or v_owner_id = p_target_user_id
      or not exists (
        select 1
        from public.users owner_row
        where owner_row.id = v_owner_id
          and owner_row.is_active
          and owner_row.account_status = 'ACTIVE'
          and app_private.has_permission(
            owner_row.id,
            'system.authorization.audit',
            'global',
            '*'
          )
      )
    then
      raise exception 'Invalid SoD warning control evidence'
        using errcode = '22023';
    end if;

    insert into public.authorization_sod_warning_acceptances (
      rule_code,
      command_type,
      command_id,
      actor_user_id,
      target_user_id,
      scope_type,
      scope_id,
      reason,
      control_owner_user_id,
      compensating_controls,
      expires_at
    )
    values (
      v_warning ->> 'ruleCode',
      p_command_type,
      p_command_id,
      p_actor_user_id,
      p_target_user_id,
      v_warning ->> 'scopeType',
      v_warning ->> 'scopeId',
      btrim(v_acceptance ->> 'reason'),
      v_owner_id,
      btrim(v_acceptance ->> 'compensatingControls'),
      v_expires_at
    );
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(v_acceptances) supplied
    where not exists (
      select 1
      from jsonb_array_elements(v_warnings) expected
      where expected ->> 'ruleCode' = supplied.value ->> 'ruleCode'
        and expected ->> 'scopeType' = supplied.value ->> 'scopeType'
        and expected ->> 'scopeId' = supplied.value ->> 'scopeId'
    )
  ) then
    raise exception 'Unexpected SoD warning acknowledgement'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function app_private.assert_authorization_permission(text)
  from public, anon, authenticated;
revoke all on function app_private.assert_and_record_sod_warnings(
  jsonb,jsonb,text,uuid,uuid,uuid
) from public, anon, authenticated;

create or replace function app_private.preview_business_role_change_impl(
  p_role_template_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_before_items jsonb := '[]'::jsonb;
  v_after_items jsonb := '[]'::jsonb;
  v_added_keys jsonb := '[]'::jsonb;
  v_removed_keys jsonb := '[]'::jsonb;
  v_affected_principal_count integer := 0;
  v_affected_scope_count integer := 0;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_roles'
  );

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Business Role items must be an array'
      using errcode = '22023';
  end if;

  if p_role_template_id is not null
    and not exists (
      select 1
      from public.role_permission_templates role_row
      where role_row.id = p_role_template_id
    )
  then
    raise exception 'Business Role does not exist'
      using errcode = '23503';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', item.permission_code,
        'scopeType', item.scope_type,
        'scopeId', item.scope_id,
        'sortOrder', item.sort_order
      )
      order by item.permission_code, item.scope_type, item.scope_id
    ),
    '[]'::jsonb
  )
  into v_before_items
  from public.role_permission_template_items item
  where item.template_id = p_role_template_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', normalized.permission_code,
        'scopeType', normalized.scope_type,
        'scopeId', normalized.scope_id,
        'sortOrder', normalized.sort_order
      )
      order by normalized.permission_code, normalized.scope_type, normalized.scope_id
    ),
    '[]'::jsonb
  )
  into v_after_items
  from (
    select distinct
      item.permission_code,
      coalesce(nullif(item.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(item.scope_id, ''), '*') as scope_id,
      coalesce(item.sort_order, 0) as sort_order
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) item(
      permission_code text,
      scope_type text,
      scope_id text,
      sort_order integer
    )
  ) normalized;

  select count(*), count(distinct assignment_row.scope_type || ':' || assignment_row.scope_id)
  into v_affected_principal_count, v_affected_scope_count
  from public.principal_role_assignments assignment_row
  where assignment_row.role_template_id = p_role_template_id;

  select coalesce(jsonb_agg(key_value order by key_value), '[]'::jsonb)
  into v_added_keys
  from (
    select (item.value ->> 'permissionCode')
      || '::' || (item.value ->> 'scopeType')
      || '::' || (item.value ->> 'scopeId') as key_value
    from jsonb_array_elements(v_after_items) item
    except
    select (item.value ->> 'permissionCode')
      || '::' || (item.value ->> 'scopeType')
      || '::' || (item.value ->> 'scopeId')
    from jsonb_array_elements(v_before_items) item
  ) added;

  select coalesce(jsonb_agg(key_value order by key_value), '[]'::jsonb)
  into v_removed_keys
  from (
    select (item.value ->> 'permissionCode')
      || '::' || (item.value ->> 'scopeType')
      || '::' || (item.value ->> 'scopeId') as key_value
    from jsonb_array_elements(v_before_items) item
    except
    select (item.value ->> 'permissionCode')
      || '::' || (item.value ->> 'scopeType')
      || '::' || (item.value ->> 'scopeId')
    from jsonb_array_elements(v_after_items) item
  ) removed;

  return jsonb_build_object(
    'affectedPrincipalCount', v_affected_principal_count,
    'affectedScopeCount', v_affected_scope_count,
    'addedPermissionKeys', v_added_keys,
    'removedPermissionKeys', v_removed_keys
  );
end;
$$;

create or replace function public.preview_business_role_change(
  p_role_template_id uuid,
  p_items jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preview_business_role_change_impl(
    p_role_template_id,
    p_items
  );
$$;

create or replace function app_private.save_business_role_impl(
  p_role_template_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_items jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_role public.role_permission_templates%rowtype;
  v_role_id uuid := p_role_template_id;
  v_code text;
  v_before_items jsonb := '[]'::jsonb;
  v_after_items jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_roles'
  );

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
    or char_length(btrim(coalesce(p_name, ''))) < 3
    or char_length(btrim(coalesce(p_reason, ''))) < 10
  then
    raise exception 'Invalid Business Role command'
      using errcode = '22023';
  end if;

  if p_role_template_id is not null then
    select *
    into v_role
    from public.role_permission_templates
    where id = p_role_template_id
    for update;

    if v_role.id is null then
      raise exception 'Business Role does not exist'
        using errcode = '23503';
    end if;

    if v_role.is_system then
      raise exception 'System Business Roles are seed-controlled'
        using errcode = '42501';
    end if;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) item(
      permission_code text,
      scope_type text,
      scope_id text
    )
    left join public.permission_actions action_row
      on action_row.permission_code = item.permission_code
     and action_row.is_active
    where action_row.permission_code is null
       or coalesce(nullif(item.scope_type, ''), 'global') <> all(action_row.scope_modes)
       or (
         coalesce(nullif(item.scope_type, ''), 'global') = 'global'
         and coalesce(nullif(item.scope_id, ''), '*') <> '*'
       )
       or (
         coalesce(nullif(item.scope_type, ''), 'global') <> 'global'
         and btrim(coalesce(item.scope_id, '')) = ''
       )
  ) then
    raise exception 'Business Role contains an unknown permission or unsupported scope'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) item(
      permission_code text,
      scope_type text,
      scope_id text
    )
    group by
      item.permission_code,
      coalesce(nullif(item.scope_type, ''), 'global'),
      coalesce(nullif(item.scope_id, ''), '*')
    having count(*) > 1
  ) then
    raise exception 'Duplicate Business Role permission item'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) item(permission_code text)
    where item.permission_code = 'system.settings.manage'
  ) then
    raise exception 'System identity permissions are seed-controlled'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', item.permission_code,
        'scopeType', item.scope_type,
        'scopeId', item.scope_id,
        'sortOrder', item.sort_order
      )
      order by item.permission_code, item.scope_type, item.scope_id
    ),
    '[]'::jsonb
  )
  into v_before_items
  from public.role_permission_template_items item
  where item.template_id = p_role_template_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', item.permission_code,
        'scopeType', item.scope_type,
        'scopeId', item.scope_id,
        'sortOrder', item.sort_order
      )
      order by item.permission_code, item.scope_type, item.scope_id
    ),
    '[]'::jsonb
  )
  into v_after_items
  from (
    select
      item.permission_code,
      coalesce(nullif(item.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(item.scope_id, ''), '*') as scope_id,
      coalesce(item.sort_order, 0) as sort_order
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) item(
      permission_code text,
      scope_type text,
      scope_id text,
      sort_order integer
    )
  ) item;

  if v_role.id is not null
    and v_before_items is distinct from v_after_items
    and exists (
      select 1
      from public.principal_role_assignments assignment_row
      where assignment_row.role_template_id = v_role.id
      for update
    )
  then
    raise exception 'Assigned Business Role permissions are immutable; create a new role and reassign principals'
      using errcode = '55000';
  end if;

  if v_role.id is null then
    v_code := trim(both '_' from regexp_replace(
      upper(btrim(coalesce(p_code, ''))),
      '[^A-Z0-9]+',
      '_',
      'g'
    ));

    if v_code !~ '^[A-Z][A-Z0-9_]*$' then
      raise exception 'Invalid Business Role code'
        using errcode = '22023';
    end if;

    v_role_id := gen_random_uuid();
    insert into public.role_permission_templates (
      id,
      code,
      name,
      description,
      is_active,
      is_system,
      version,
      created_by
    )
    values (
      v_role_id,
      v_code,
      btrim(p_name),
      nullif(btrim(coalesce(p_description, '')), ''),
      true,
      false,
      1,
      v_actor_user_id
    );
  else
    v_code := v_role.code;
    v_before := jsonb_build_object(
      'id', v_role.id,
      'code', v_role.code,
      'name', v_role.name,
      'description', v_role.description,
      'version', v_role.version,
      'items', v_before_items
    );

    update public.role_permission_templates
    set name = btrim(p_name),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        version = version + 1,
        updated_at = now()
    where id = v_role_id;
  end if;

  if v_role.id is null or v_before_items is distinct from v_after_items then
    delete from public.role_permission_template_items
    where template_id = v_role_id;

    insert into public.role_permission_template_items (
      template_id,
      permission_code,
      scope_type,
      scope_id,
      sort_order
    )
    select
      v_role_id,
      item.permission_code,
      coalesce(nullif(item.scope_type, ''), 'global'),
      coalesce(nullif(item.scope_id, ''), '*'),
      coalesce(item.sort_order, 0)
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) item(
      permission_code text,
      scope_type text,
      scope_id text,
      sort_order integer
    );
  end if;

  select jsonb_build_object(
    'id', role_row.id,
    'code', role_row.code,
    'name', role_row.name,
    'description', role_row.description,
    'version', role_row.version,
    'items', v_after_items
  )
  into v_after
  from public.role_permission_templates role_row
  where role_row.id = v_role_id;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    null,
    case
      when v_role.id is null then 'business_role_created'
      else 'business_role_permissions_changed'
    end,
    v_before,
    v_after,
    jsonb_build_object(
      'roleTemplateId', v_role_id,
      'reason', btrim(p_reason)
    )
  );

  return v_role_id;
end;
$$;

create or replace function public.save_business_role(
  p_role_template_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_items jsonb,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.save_business_role_impl(
    p_role_template_id,
    p_code,
    p_name,
    p_description,
    p_items,
    p_reason
  );
$$;

revoke all on function app_private.preview_business_role_change_impl(uuid,jsonb)
  from public, anon;
grant execute on function app_private.preview_business_role_change_impl(uuid,jsonb)
  to authenticated;
revoke all on function public.preview_business_role_change(uuid,jsonb)
  from public, anon;
grant execute on function public.preview_business_role_change(uuid,jsonb)
  to authenticated;
revoke all on function app_private.save_business_role_impl(uuid,text,text,text,jsonb,text)
  from public, anon;
grant execute on function app_private.save_business_role_impl(uuid,text,text,text,jsonb,text)
  to authenticated;
revoke all on function public.save_business_role(uuid,text,text,text,jsonb,text)
  from public, anon;
grant execute on function public.save_business_role(uuid,text,text,text,jsonb,text)
  to authenticated;

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
set search_path = ''
as $$
declare
  v_scope_type text := coalesce(nullif(p_scope_type, ''), 'global');
  v_scope_id text := coalesce(nullif(p_scope_id, ''), '*');
  v_proposed jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_permission(
      p_actor_user_id,
      'system.authorization.manage_roles',
      'global',
      '*'
    )
  then
    raise exception 'Authorization administration permission required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users target_row
    where target_row.id = p_target_user_id
      and target_row.is_active
      and target_row.account_status = 'ACTIVE'
  ) then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.role_permission_templates role_row
    where role_row.id = p_role_template_id
      and role_row.is_active
  ) then
    raise exception 'Valid Business Role required'
      using errcode = '23514';
  end if;

  if v_scope_type not in (
      'global','own','assigned','project','construction_site','warehouse','department'
    )
    or (v_scope_type = 'global' and v_scope_id <> '*')
    or (v_scope_type <> 'global' and btrim(v_scope_id) = '')
    or exists (
      select 1
      from public.role_permission_template_items item
      join public.permission_actions action_row
        on action_row.permission_code = item.permission_code
       and action_row.is_active
      where item.template_id = p_role_template_id
        and (
          (
            v_scope_type <> 'global'
            and item.scope_type <> 'global'
            and (
              item.scope_type <> v_scope_type
              or (
                v_scope_id <> '*'
                and item.scope_id <> '*'
                and item.scope_id <> v_scope_id
              )
            )
          )
          or not (
            case
              when v_scope_type <> 'global' then v_scope_type
              else item.scope_type
            end = any(action_row.scope_modes)
          )
        )
    )
  then
    raise exception 'Business Role does not support the requested assignment scope'
      using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', proposed.permission_code,
        'scopeType', proposed.scope_type,
        'scopeId', proposed.scope_id
      )
      order by proposed.permission_code, proposed.scope_type, proposed.scope_id
    ),
    '[]'::jsonb
  )
  into v_proposed
  from (
    select distinct
      item.permission_code,
      case
        when v_scope_type = 'global' then item.scope_type
        when item.scope_type = 'global' then v_scope_type
        else item.scope_type
      end as scope_type,
      case
        when v_scope_type = 'global' then item.scope_id
        when item.scope_type = 'global' then v_scope_id
        when v_scope_id = '*' then item.scope_id
        when item.scope_id = '*' then v_scope_id
        else v_scope_id
      end as scope_id
    from public.role_permission_template_items item
    where item.template_id = p_role_template_id
  ) proposed;

  return app_private.evaluate_authorization_change_set(
    p_actor_user_id,
    p_target_user_id,
    v_proposed,
    'ADD'
  );
end;
$$;

create or replace function app_private.preview_business_role_assignment_impl(
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_roles'
  );

  return app_private.evaluate_business_role_assignment_impl(
    v_actor_user_id,
    p_target_user_id,
    p_role_template_id,
    p_scope_type,
    p_scope_id
  );
end;
$$;

create or replace function public.preview_business_role_assignment(
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preview_business_role_assignment_impl(
    p_target_user_id,
    p_role_template_id,
    p_scope_type,
    p_scope_id
  );
$$;

create or replace function app_private.assert_rollout_operator_continuity(
  p_excluded_assignment_id uuid default null,
  p_excluded_user_id uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.users user_row
    join public.principal_role_assignments assignment_row
      on assignment_row.principal_type = 'user'
     and assignment_row.principal_id = user_row.id
     and assignment_row.status = 'ACTIVE'
     and assignment_row.starts_at <= now()
     and assignment_row.expires_at is null
    join public.role_permission_templates role_row
      on role_row.id = assignment_row.role_template_id
     and role_row.is_active
    join public.role_permission_template_items item
      on item.template_id = role_row.id
     and item.permission_code = 'system.authorization.manage_roles'
     and item.scope_type = 'global'
     and item.scope_id = '*'
    join public.permission_actions action_row
      on action_row.permission_code = item.permission_code
     and action_row.is_active
     and 'global' = any(action_row.scope_modes)
    where user_row.role = 'ADMIN'
      and user_row.is_active
      and user_row.account_status = 'ACTIVE'
      and assignment_row.scope_type = 'global'
      and assignment_row.scope_id = '*'
      and assignment_row.id is distinct from p_excluded_assignment_id
      and user_row.id is distinct from p_excluded_user_id
  ) then
    raise exception 'At least one durable rollout operator is required'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function app_private.guard_rollout_operator_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'ADMIN'
    and old.is_active
    and old.account_status = 'ACTIVE'
    and new.role <> 'ADMIN'
  then
    perform app_private.assert_rollout_operator_continuity(null, old.id);
  end if;

  return new;
end;
$$;

revoke all on function app_private.assert_rollout_operator_continuity(uuid,uuid)
  from public, anon, authenticated;
revoke all on function app_private.guard_rollout_operator_transition()
  from public, anon, authenticated;

drop trigger if exists trg_users_guard_rollout_operator_transition on public.users;
create trigger trg_users_guard_rollout_operator_transition
  before update of role on public.users
  for each row execute function app_private.guard_rollout_operator_transition();

create or replace function app_private.assign_business_role_impl(
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_scope_type text,
  p_scope_id text,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_reason text,
  p_warning_acceptances jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_target public.users%rowtype;
  v_role public.role_permission_templates%rowtype;
  v_scope_type text := coalesce(nullif(p_scope_type, ''), 'global');
  v_scope_id text := coalesce(nullif(p_scope_id, ''), '*');
  v_starts_at timestamptz := coalesce(p_starts_at, now());
  v_decision jsonb;
  v_assignment_id uuid := gen_random_uuid();
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_roles'
  );

  select *
  into v_target
  from public.users
  where id = p_target_user_id
  for update;

  if v_target.id is null
    or not v_target.is_active
    or v_target.account_status <> 'ACTIVE'
  then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  select *
  into v_role
  from public.role_permission_templates
  where id = p_role_template_id
    and is_active
  for update;

  if v_role.id is null
    or char_length(btrim(coalesce(p_reason, ''))) < 10
  then
    raise exception 'Valid Business Role and assignment reason required'
      using errcode = '22023';
  end if;

  if v_role.code = 'SYSTEM_ADMIN' and v_target.role <> 'ADMIN' then
    raise exception 'System Admin role assignment must follow the governed profile identity command'
      using errcode = '55000';
  end if;

  if v_role.code <> 'SYSTEM_ADMIN'
    and exists (
      select 1
      from public.role_permission_template_items item
      where item.template_id = v_role.id
        and item.permission_code = 'system.settings.manage'
    )
  then
    raise exception 'System identity permissions are seed-controlled'
      using errcode = '42501';
  end if;

  if v_starts_at > now() then
    raise exception 'Future Business Role scheduling is not enabled in Phase 2'
      using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= v_starts_at then
    raise exception 'Business Role assignment expiry must follow its start time'
      using errcode = '22023';
  end if;

  update public.principal_role_assignments
  set status = 'EXPIRED',
      updated_at = now()
  where principal_type = 'user'
    and principal_id = p_target_user_id
    and role_template_id = p_role_template_id
    and scope_type = v_scope_type
    and scope_id = v_scope_id
    and status = 'ACTIVE'
    and expires_at is not null
    and expires_at <= now();

  if exists (
    select 1
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.role_template_id = p_role_template_id
      and assignment_row.scope_type = v_scope_type
      and assignment_row.scope_id = v_scope_id
      and assignment_row.status = 'ACTIVE'
  ) then
    raise exception 'Active Business Role assignment already exists'
      using errcode = '23505';
  end if;

  v_decision := app_private.evaluate_business_role_assignment_impl(
    v_actor_user_id,
    p_target_user_id,
    p_role_template_id,
    v_scope_type,
    v_scope_id
  );

  perform app_private.assert_and_record_sod_warnings(
    v_decision,
    p_warning_acceptances,
    'ASSIGN_BUSINESS_ROLE',
    v_assignment_id,
    v_actor_user_id,
    p_target_user_id
  );

  insert into public.principal_role_assignments (
    id,
    principal_type,
    principal_id,
    role_template_id,
    scope_type,
    scope_id,
    starts_at,
    expires_at,
    status,
    assigned_by,
    assigned_reason
  )
  values (
    v_assignment_id,
    'user',
    p_target_user_id,
    p_role_template_id,
    v_scope_type,
    v_scope_id,
    v_starts_at,
    p_expires_at,
    'ACTIVE',
    v_actor_user_id,
    btrim(p_reason)
  );

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    p_target_user_id,
    'business_role_assigned',
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'assignmentId', v_assignment_id,
      'roleTemplateId', p_role_template_id,
      'scopeType', v_scope_type,
      'scopeId', v_scope_id,
      'startsAt', v_starts_at,
      'expiresAt', p_expires_at
    )),
    jsonb_build_object(
      'assignmentId', v_assignment_id,
      'roleTemplateId', p_role_template_id,
      'reason', btrim(p_reason),
      'decision', v_decision
    )
  );

  return v_assignment_id;
end;
$$;

create or replace function public.assign_business_role(
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_scope_type text,
  p_scope_id text,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_reason text,
  p_warning_acceptances jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.assign_business_role_impl(
    p_target_user_id,
    p_role_template_id,
    p_scope_type,
    p_scope_id,
    p_starts_at,
    p_expires_at,
    p_reason,
    p_warning_acceptances
  );
$$;

create or replace function app_private.revoke_business_role_assignment_impl(
  p_assignment_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_initial_target_id uuid;
  v_initial_role_id uuid;
  v_target public.users%rowtype;
  v_role public.role_permission_templates%rowtype;
  v_assignment public.principal_role_assignments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_roles'
  );

  if char_length(v_reason) < 10 then
    raise exception 'Business Role revoke reason required'
      using errcode = '22023';
  end if;

  select assignment_row.principal_id, assignment_row.role_template_id
  into v_initial_target_id, v_initial_role_id
  from public.principal_role_assignments assignment_row
  where assignment_row.id = p_assignment_id
    and assignment_row.principal_type = 'user';

  if v_initial_target_id is null then
    raise exception 'Business Role assignment does not exist'
      using errcode = '23503';
  end if;

  select *
  into v_target
  from public.users
  where id = v_initial_target_id
  for update;

  select *
  into v_role
  from public.role_permission_templates
  where id = v_initial_role_id
  for update;

  select *
  into v_assignment
  from public.principal_role_assignments
  where id = p_assignment_id
  for update;

  if v_target.id is null
    or v_role.id is null
    or v_assignment.id is null
    or v_assignment.principal_id is distinct from v_target.id
    or v_assignment.role_template_id is distinct from v_role.id
  then
    raise exception 'Business Role assignment changed during revoke'
      using errcode = '55000';
  end if;

  if v_assignment.status = 'REVOKED' then
    if btrim(coalesce(v_assignment.revoked_reason, '')) = v_reason then
      return;
    end if;

    raise exception 'Business Role assignment was already revoked with another reason'
      using errcode = '55000';
  end if;

  if v_assignment.status <> 'ACTIVE' then
    raise exception 'Only an active Business Role assignment can be revoked'
      using errcode = '55000';
  end if;

  if v_role.code = 'SYSTEM_ADMIN'
    and v_target.role = 'ADMIN'
    and v_target.is_active
    and v_target.account_status = 'ACTIVE'
  then
    raise exception 'System Admin identity must be demoted before revoking its role mirror'
      using errcode = '55000';
  end if;

  if v_assignment.expires_at is null
    and v_assignment.scope_type = 'global'
    and v_assignment.scope_id = '*'
    and exists (
      select 1
      from public.role_permission_template_items item
      where item.template_id = v_role.id
        and item.permission_code = 'system.authorization.manage_roles'
        and item.scope_type = 'global'
        and item.scope_id = '*'
    )
  then
    perform app_private.assert_rollout_operator_continuity(
      v_assignment.id,
      null
    );
  end if;

  update public.principal_role_assignments
  set status = 'REVOKED',
      revoked_at = now(),
      revoked_by = v_actor_user_id,
      revoked_reason = v_reason,
      updated_at = now()
  where id = v_assignment.id;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    v_target.id,
    'business_role_revoked',
    jsonb_build_array(to_jsonb(v_assignment)),
    '[]'::jsonb,
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'roleTemplateId', v_role.id,
      'reason', v_reason
    )
  );
end;
$$;

create or replace function public.revoke_business_role_assignment(
  p_assignment_id uuid,
  p_reason text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.revoke_business_role_assignment_impl(
    p_assignment_id,
    p_reason
  );
$$;

revoke all on function app_private.evaluate_business_role_assignment_impl(
  uuid,uuid,uuid,text,text
) from public, anon, authenticated;
revoke all on function app_private.preview_business_role_assignment_impl(
  uuid,uuid,text,text
) from public, anon;
grant execute on function app_private.preview_business_role_assignment_impl(
  uuid,uuid,text,text
) to authenticated;
revoke all on function public.preview_business_role_assignment(uuid,uuid,text,text)
  from public, anon;
grant execute on function public.preview_business_role_assignment(uuid,uuid,text,text)
  to authenticated;
revoke all on function app_private.assign_business_role_impl(
  uuid,uuid,text,text,timestamptz,timestamptz,text,jsonb
) from public, anon;
grant execute on function app_private.assign_business_role_impl(
  uuid,uuid,text,text,timestamptz,timestamptz,text,jsonb
) to authenticated;
revoke all on function public.assign_business_role(
  uuid,uuid,text,text,timestamptz,timestamptz,text,jsonb
) from public, anon;
grant execute on function public.assign_business_role(
  uuid,uuid,text,text,timestamptz,timestamptz,text,jsonb
) to authenticated;
revoke all on function app_private.revoke_business_role_assignment_impl(uuid,text)
  from public, anon;
grant execute on function app_private.revoke_business_role_assignment_impl(uuid,text)
  to authenticated;
revoke all on function public.revoke_business_role_assignment(uuid,text)
  from public, anon;
grant execute on function public.revoke_business_role_assignment(uuid,text)
  to authenticated;

create or replace function app_private.list_authorization_principals_impl()
returns table (
  user_id uuid,
  name text,
  email text,
  account_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if not app_private.has_permission(
    v_actor_user_id,
    'system.authorization.view',
    'global',
    '*'
  ) then
    raise exception 'Not allowed to view authorization principals'
      using errcode = '42501';
  end if;

  return query
  select user_row.id, user_row.name, user_row.email, user_row.account_status
  from public.users user_row
  order by user_row.name, user_row.email, user_row.id;
end;
$$;

create or replace function public.list_authorization_principals()
returns table (
  user_id uuid,
  name text,
  email text,
  account_status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.list_authorization_principals_impl();
$$;

create or replace function app_private.set_authorization_rollout_flags_impl(
  p_business_role_resolver_enabled boolean,
  p_legacy_governance_fallback_disabled boolean,
  p_admin_business_approval_bypass_disabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_before jsonb;
  v_after jsonb;
begin
  if (
      p_legacy_governance_fallback_disabled
      or p_admin_business_approval_bypass_disabled
    )
    and not p_business_role_resolver_enabled
  then
    raise exception 'Business Role resolver must be enabled before disabling compatibility fallbacks'
      using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 10
    or not exists (
      select 1
      from public.users actor_row
      where actor_row.id = v_actor_user_id
        and actor_row.role = 'ADMIN'
        and actor_row.is_active
        and actor_row.account_status = 'ACTIVE'
    )
    or not app_private.has_permission(
      v_actor_user_id,
      'system.authorization.manage_roles',
      'global',
      '*'
    )
  then
    raise exception 'System Admin and role-management permission required'
      using errcode = '42501';
  end if;

  if p_legacy_governance_fallback_disabled
    or p_admin_business_approval_bypass_disabled
  then
    perform app_private.assert_rollout_operator_continuity(null, null);
  end if;

  perform 1
  from app_private.permission_hardening_settings setting_row
  where setting_row.key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  )
  order by setting_row.key
  for update;

  select jsonb_object_agg(setting_row.key, setting_row.value)
  into v_before
  from app_private.permission_hardening_settings setting_row
  where setting_row.key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  );

  update app_private.permission_hardening_settings
  set value = case key
        when 'business_role_resolver_enabled'
          then to_jsonb(p_business_role_resolver_enabled)
        when 'legacy_governance_fallback_disabled'
          then to_jsonb(p_legacy_governance_fallback_disabled)
        else to_jsonb(p_admin_business_approval_bypass_disabled)
      end,
      updated_at = now()
  where key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  );

  v_after := jsonb_build_object(
    'business_role_resolver_enabled', p_business_role_resolver_enabled,
    'legacy_governance_fallback_disabled', p_legacy_governance_fallback_disabled,
    'system_admin_business_approval_bypass_disabled',
      p_admin_business_approval_bypass_disabled
  );

  if v_before is distinct from v_after then
    insert into public.permission_audit_events (
      actor_user_id,
      target_user_id,
      event_type,
      before_grants,
      after_grants,
      metadata
    )
    values (
      v_actor_user_id,
      v_actor_user_id,
      'authorization_rollout_flags_changed',
      coalesce(v_before, '{}'::jsonb),
      v_after,
      jsonb_build_object('reason', btrim(p_reason))
    );
  end if;

  return v_after;
end;
$$;

create or replace function public.set_authorization_rollout_flags(
  p_business_role_resolver_enabled boolean,
  p_legacy_governance_fallback_disabled boolean,
  p_admin_business_approval_bypass_disabled boolean,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.set_authorization_rollout_flags_impl(
    p_business_role_resolver_enabled,
    p_legacy_governance_fallback_disabled,
    p_admin_business_approval_bypass_disabled,
    p_reason
  );
$$;

revoke all on function app_private.list_authorization_principals_impl()
  from public, anon;
grant execute on function app_private.list_authorization_principals_impl()
  to authenticated;
revoke all on function public.list_authorization_principals()
  from public, anon;
grant execute on function public.list_authorization_principals()
  to authenticated;
revoke all on function app_private.set_authorization_rollout_flags_impl(
  boolean,boolean,boolean,text
) from public, anon;
grant execute on function app_private.set_authorization_rollout_flags_impl(
  boolean,boolean,boolean,text
) to authenticated;
revoke all on function public.set_authorization_rollout_flags(
  boolean,boolean,boolean,text
) from public, anon;
grant execute on function public.set_authorization_rollout_flags(
  boolean,boolean,boolean,text
) to authenticated;

create or replace function app_private.evaluate_direct_grant_replacement_impl(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_grants jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_grants jsonb := coalesce(p_grants, '[]'::jsonb);
  v_proposed jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_permission(
      p_actor_user_id,
      'system.authorization.manage_grants',
      'global',
      '*'
    )
  then
    raise exception 'Authorization administration permission required'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_grants) <> 'array' then
    raise exception 'Permission grants payload must be an array'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users target_row
    where target_row.id = p_target_user_id
      and target_row.is_active
      and target_row.account_status = 'ACTIVE'
  ) then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select
        grant_row.permission_code,
        coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
        coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id,
        count(*) as row_count
      from jsonb_to_recordset(v_grants) grant_row(
        permission_code text,
        scope_type text,
        scope_id text,
        is_active boolean,
        expires_at timestamptz
      )
      where coalesce(grant_row.is_active, true)
      group by 1, 2, 3
      having count(*) > 1
    ) duplicate_row
  ) then
    raise exception 'Duplicate direct permission grant key'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    left join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code
     and action_row.is_active
    where coalesce(grant_row.is_active, true)
      and (
        action_row.permission_code is null
        or coalesce(nullif(grant_row.scope_type, ''), 'global') <> all(action_row.scope_modes)
        or (
          coalesce(nullif(grant_row.scope_type, ''), 'global') = 'global'
          and coalesce(nullif(grant_row.scope_id, ''), '*') <> '*'
        )
        or (
          coalesce(nullif(grant_row.scope_type, ''), 'global') <> 'global'
          and btrim(coalesce(grant_row.scope_id, '')) = ''
        )
        or (
          action_row.direct_grant_requires_expiry
          and (
            grant_row.expires_at is null
            or grant_row.expires_at <= now()
          )
        )
      )
  ) then
    raise exception 'Invalid direct permission grant'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      is_active boolean
    )
    where coalesce(grant_row.is_active, true)
      and grant_row.permission_code = 'system.settings.manage'
  ) then
    raise exception 'System identity permissions cannot be granted directly'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code
     and action_row.is_active
    where p_target_user_id = p_actor_user_id
      and coalesce(grant_row.is_active, true)
      and action_row.risk_level = 'sensitive'
      and not exists (
        select 1
        from public.user_permission_grants existing
        where existing.user_id = p_target_user_id
          and existing.permission_code = grant_row.permission_code
          and existing.scope_type = coalesce(
            nullif(grant_row.scope_type, ''),
            'global'
          )
          and existing.scope_id = coalesce(nullif(grant_row.scope_id, ''), '*')
          and existing.is_active
          and existing.expires_at is not distinct from grant_row.expires_at
      )
  ) then
    raise exception 'Sensitive self-grant is not allowed'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', normalized.permission_code,
        'scopeType', normalized.scope_type,
        'scopeId', normalized.scope_id
      )
      order by normalized.permission_code, normalized.scope_type, normalized.scope_id
    ),
    '[]'::jsonb
  )
  into v_proposed
  from (
    select distinct
      grant_row.permission_code,
      coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    where coalesce(grant_row.is_active, true)
  ) normalized;

  return app_private.evaluate_authorization_change_set(
    p_actor_user_id,
    p_target_user_id,
    v_proposed,
    'REPLACE_DIRECT'
  );
end;
$$;

create or replace function app_private.preview_direct_grant_replacement_impl(
  p_target_user_id uuid,
  p_grants jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  return app_private.evaluate_direct_grant_replacement_impl(
    v_actor_user_id,
    p_target_user_id,
    p_grants
  );
end;
$$;

create or replace function public.preview_direct_grant_replacement(
  p_user_id uuid,
  p_grants jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preview_direct_grant_replacement_impl(
    p_user_id,
    p_grants
  );
$$;

create or replace function app_private.replace_user_permission_grants_v2_impl(
  p_user_id uuid,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_target public.users%rowtype;
  v_grants jsonb := coalesce(p_grants, '[]'::jsonb);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_decision jsonb;
  v_command_id uuid := gen_random_uuid();
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  if jsonb_typeof(v_grants) <> 'array' then
    raise exception 'Permission grants payload must be an array'
      using errcode = '22023';
  end if;

  select *
  into v_target
  from public.users
  where id = p_user_id
  for update;

  if v_target.id is null
    or not v_target.is_active
    or v_target.account_status <> 'ACTIVE'
  then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  v_decision := app_private.evaluate_direct_grant_replacement_impl(
    v_actor_user_id,
    p_user_id,
    v_grants
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', grant_row.permission_code,
        'scopeType', grant_row.scope_type,
        'scopeId', grant_row.scope_id,
        'expiresAt', grant_row.expires_at
      )
      order by grant_row.permission_code, grant_row.scope_type, grant_row.scope_id
    ),
    '[]'::jsonb
  )
  into v_before
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active
    and (
      grant_row.expires_at is null
      or grant_row.expires_at > now()
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', normalized.permission_code,
        'scopeType', normalized.scope_type,
        'scopeId', normalized.scope_id,
        'expiresAt', normalized.expires_at
      )
      order by normalized.permission_code, normalized.scope_type, normalized.scope_id
    ),
    '[]'::jsonb
  )
  into v_after
  from (
    select
      grant_row.permission_code,
      coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id,
      grant_row.expires_at
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    where coalesce(grant_row.is_active, true)
  ) normalized;

  if v_before is not distinct from v_after then
    return v_after;
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'Direct permission grant change reason required'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      is_active boolean
    )
    join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code
     and action_row.is_active
    where coalesce(grant_row.is_active, true)
      and action_row.risk_level in ('important', 'sensitive')
      and char_length(v_reason) < 10
  ) then
    raise exception 'Important direct permission grant requires a reason'
      using errcode = '23514';
  end if;

  perform app_private.assert_and_record_sod_warnings(
    v_decision,
    p_warning_acceptances,
    'REPLACE_DIRECT_GRANTS',
    v_command_id,
    v_actor_user_id,
    p_user_id
  );

  update public.user_permission_grants existing
  set is_active = false,
      revoked_at = coalesce(existing.revoked_at, now()),
      revoked_by = coalesce(existing.revoked_by, v_actor_user_id),
      revoked_reason = coalesce(existing.revoked_reason, v_reason),
      updated_at = now()
  where existing.user_id = p_user_id
    and existing.is_active
    and not exists (
      select 1
      from jsonb_to_recordset(v_grants) desired(
        permission_code text,
        scope_type text,
        scope_id text,
        is_active boolean,
        expires_at timestamptz
      )
      where coalesce(desired.is_active, true)
        and desired.permission_code = existing.permission_code
        and coalesce(nullif(desired.scope_type, ''), 'global') = existing.scope_type
        and coalesce(nullif(desired.scope_id, ''), '*') = existing.scope_id
    );

  insert into public.user_permission_grants (
    user_id,
    permission_code,
    scope_type,
    scope_id,
    is_active,
    granted_by,
    granted_at,
    expires_at,
    grant_reason,
    revoked_at,
    revoked_by,
    revoked_reason
  )
  select
    p_user_id,
    desired.permission_code,
    coalesce(nullif(desired.scope_type, ''), 'global'),
    coalesce(nullif(desired.scope_id, ''), '*'),
    true,
    v_actor_user_id,
    now(),
    desired.expires_at,
    nullif(v_reason, ''),
    null,
    null,
    null
  from jsonb_to_recordset(v_grants) desired(
    permission_code text,
    scope_type text,
    scope_id text,
    is_active boolean,
    expires_at timestamptz
  )
  where coalesce(desired.is_active, true)
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      grant_reason = excluded.grant_reason,
      revoked_at = null,
      revoked_by = null,
      revoked_reason = null,
      updated_at = now();

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    p_user_id,
    'direct_permission_grants_changed',
    v_before,
    v_after,
    jsonb_build_object(
      'commandId', v_command_id,
      'reason', v_reason,
      'decision', v_decision
    )
  );

  if app_private.permission_hardening_flag('legacy_projection_enabled') then
    perform app_private.sync_legacy_permission_projection(p_user_id);
  end if;

  return v_after;
end;
$$;

create or replace function public.replace_user_permission_grants_v2(
  p_user_id uuid,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.replace_user_permission_grants_v2_impl(
    p_user_id,
    p_grants,
    p_reason,
    p_warning_acceptances
  );
$$;

create or replace function public.replace_user_permission_grants(
  p_user_id uuid,
  p_grants jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.replace_user_permission_grants_v2(
    p_user_id,
    p_grants,
    'Compatibility permission update',
    '[]'::jsonb
  );
end;
$$;

revoke all on function app_private.evaluate_direct_grant_replacement_impl(
  uuid,uuid,jsonb
) from public, anon, authenticated;
revoke all on function app_private.preview_direct_grant_replacement_impl(uuid,jsonb)
  from public, anon;
grant execute on function app_private.preview_direct_grant_replacement_impl(uuid,jsonb)
  to authenticated;
revoke all on function public.preview_direct_grant_replacement(uuid,jsonb)
  from public, anon;
grant execute on function public.preview_direct_grant_replacement(uuid,jsonb)
  to authenticated;
revoke all on function app_private.replace_user_permission_grants_v2_impl(
  uuid,jsonb,text,jsonb
) from public, anon;
grant execute on function app_private.replace_user_permission_grants_v2_impl(
  uuid,jsonb,text,jsonb
) to authenticated;
revoke all on function public.replace_user_permission_grants_v2(
  uuid,jsonb,text,jsonb
) from public, anon;
grant execute on function public.replace_user_permission_grants_v2(
  uuid,jsonb,text,jsonb
) to authenticated;
revoke all on function public.replace_user_permission_grants(uuid,jsonb)
  from public, anon;
grant execute on function public.replace_user_permission_grants(uuid,jsonb)
  to authenticated;
