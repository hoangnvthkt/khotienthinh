-- Task 12.4.2-F: reviewed, concurrency-safe and reversible authorization transitions.

create table app_private.authorization_transition_batches (
  batch_id text primary key,
  mapping_version text not null,
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('APPLIED', 'RESTORED')),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) >= 10),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array'),
  post_source_hashes jsonb not null default '{}'::jsonb,
  receipt jsonb not null default '{}'::jsonb,
  applied_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid references public.users(id) on delete restrict,
  restore_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.authorization_transition_items (
  batch_id text not null references app_private.authorization_transition_batches(batch_id) on delete restrict,
  source_id text not null,
  user_id uuid not null references public.users(id) on delete restrict,
  source_type text not null,
  disposition text not null check (disposition in ('retain', 'replace', 'revoke')),
  before_source jsonb not null,
  after_source jsonb,
  after_source_id uuid,
  after_source_created boolean not null default false,
  applied_at timestamptz not null default now(),
  primary key (batch_id, source_id)
);

revoke all on table app_private.authorization_transition_batches from public, anon, authenticated;
revoke all on table app_private.authorization_transition_items from public, anon, authenticated;

create or replace function app_private.authorization_transition_source_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sources as (
    select
      'DIRECT'::text as source_type,
      grant_row.id::text as source_id,
      jsonb_build_object(
        'sourceId', grant_row.id::text,
        'sourceType', 'DIRECT',
        'permissionCode', grant_row.permission_code,
        'scopeType', grant_row.scope_type,
        'scopeId', grant_row.scope_id,
        'expiresAt', grant_row.expires_at,
        'isActive', grant_row.is_active,
        'status', case when grant_row.is_active then 'ACTIVE' else 'REVOKED' end,
        'updatedAt', grant_row.updated_at,
        'state', jsonb_build_object(
          'grantedBy', grant_row.granted_by,
          'grantedAt', grant_row.granted_at,
          'createdAt', grant_row.created_at,
          'updatedAt', grant_row.updated_at,
          'revokedAt', grant_row.revoked_at,
          'revokedBy', grant_row.revoked_by,
          'revokedReason', grant_row.revoked_reason,
          'grantReason', grant_row.grant_reason
        )
      ) as source
    from public.user_permission_grants grant_row
    where grant_row.user_id = p_user_id

    union all

    select
      'ROLE_ASSIGNMENT',
      assignment_row.id::text,
      jsonb_build_object(
        'sourceId', assignment_row.id::text,
        'sourceType', 'ROLE_ASSIGNMENT',
        'permissionCode', 'role-template:' || template_row.code,
        'scopeType', assignment_row.scope_type,
        'scopeId', assignment_row.scope_id,
        'expiresAt', assignment_row.expires_at,
        'isActive', assignment_row.status = 'ACTIVE',
        'status', assignment_row.status,
        'updatedAt', assignment_row.updated_at,
        'state', jsonb_build_object(
          'templateId', template_row.id,
          'templateCode', template_row.code,
          'templateVersion', template_row.version,
          'templateActive', template_row.is_active,
          'startsAt', assignment_row.starts_at,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'permissionCode', item.permission_code,
              'scopeType', item.scope_type,
              'scopeId', item.scope_id
            ) order by item.permission_code, item.scope_type, item.scope_id)
            from public.role_permission_template_items item
            where item.template_id = template_row.id
          ), '[]'::jsonb)
        )
      )
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates template_row on template_row.id = assignment_row.role_template_id
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_user_id

    union all

    select
      'PROJECT_ROOM',
      room_member.id::text,
      jsonb_build_object(
        'sourceId', room_member.id::text,
        'sourceType', 'PROJECT_ROOM',
        'permissionCode', 'project.room.' || room_member.room_code,
        'scopeType', case when room_member.construction_site_id is null then 'project' else 'construction_site' end,
        'scopeId', coalesce(room_member.construction_site_id, room_member.project_id),
        'expiresAt', null,
        'isActive', room_member.is_active,
        'status', case when room_member.is_active then 'ACTIVE' else 'REVOKED' end,
        'updatedAt', room_member.updated_at,
        'state', jsonb_build_object(
          'projectStaffId', room_member.project_staff_id,
          'actions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'actionCode', action_row.action_code,
              'isActive', action_row.is_active,
              'grantSource', action_row.grant_source,
              'updatedAt', action_row.updated_at
            ) order by action_row.action_code)
            from public.project_permission_room_member_actions action_row
            where action_row.room_member_id = room_member.id
          ), '[]'::jsonb)
        )
      )
    from public.project_permission_room_members room_member
    join public.project_staff staff_row on staff_row.id = room_member.project_staff_id
    where staff_row.user_id = p_user_id::text

    union all

    select
      'WORKSPACE',
      workspace_member.id::text,
      jsonb_build_object(
        'sourceId', workspace_member.id::text,
        'sourceType', 'WORKSPACE',
        'permissionCode', 'work.workspace.' || workspace_member.role,
        'scopeType', 'work_workspace',
        'scopeId', workspace_member.workspace_id::text,
        'expiresAt', workspace_member.expires_at,
        'isActive', workspace_member.status = 'active',
        'status', upper(workspace_member.status),
        'updatedAt', workspace_member.updated_at,
        'state', jsonb_build_object(
          'origin', workspace_member.origin,
          'sourceReference', workspace_member.source_reference,
          'lockVersion', workspace_member.lock_version,
          'startsAt', workspace_member.starts_at
        )
      )
    from public.work_workspace_members workspace_member
    where workspace_member.user_id = p_user_id
  )
  select coalesce(jsonb_agg(source order by source_type, source_id), '[]'::jsonb)
  from sources;
$$;

create or replace function app_private.authorization_transition_source_hash(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(app_private.authorization_transition_source_snapshot(p_user_id)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.preview_authorization_transition_sources(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_target_updated_at timestamptz;
  v_sources jsonb;
begin
  v_actor := app_private.assert_authorization_permission('system.authorization.manage_grants');
  select updated_at into v_target_updated_at from public.users where id = p_user_id;
  if v_target_updated_at is null then
    raise exception 'Target user required' using errcode = '23503';
  end if;
  v_sources := app_private.authorization_transition_source_snapshot(p_user_id);
  return jsonb_build_object(
    'userId', p_user_id,
    'targetVersion', v_target_updated_at,
    'expectedSourceHash', app_private.authorization_transition_source_hash(p_user_id),
    'sources', v_sources
  );
end;
$$;

create or replace function app_private.authorization_transition_manifest_hash(p_items jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(coalesce((
    select jsonb_agg(item order by item->>'userId', item->>'sourceId')
    from jsonb_array_elements(p_items) item
  ), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function app_private.apply_authorization_transition_batch_v2_impl(
  p_batch_id text,
  p_mapping_version text,
  p_items jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_manifest_hash text;
  v_existing app_private.authorization_transition_batches%rowtype;
  v_item jsonb;
  v_user record;
  v_grant public.user_permission_grants%rowtype;
  v_after_id uuid;
  v_after_created boolean;
  v_post_hashes jsonb := '{}'::jsonb;
  v_receipt jsonb;
  v_applied_count integer := 0;
begin
  v_actor := app_private.assert_authorization_permission('system.authorization.manage_grants');
  if char_length(v_reason) < 10 then
    raise exception 'Transition reason must contain at least 10 characters' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
    or nullif(btrim(coalesce(p_mapping_version, '')), '') is null
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) = 0
  then
    raise exception 'Batch ID, mapping version and non-empty items are required' using errcode = '22023';
  end if;

  v_manifest_hash := app_private.authorization_transition_manifest_hash(p_items);
  perform pg_advisory_xact_lock(hashtext('authorization-transition:' || p_batch_id));
  select * into v_existing
  from app_private.authorization_transition_batches
  where batch_id = p_batch_id
  for update;
  if v_existing.batch_id is not null then
    if v_existing.manifest_hash is distinct from v_manifest_hash
      or v_existing.mapping_version is distinct from p_mapping_version
    then
      raise exception 'Batch ID already exists with different content' using errcode = '23505';
    end if;
    if v_existing.status = 'APPLIED' then
      return v_existing.receipt || jsonb_build_object('idempotentReplay', true);
    end if;
    raise exception 'Restored batch cannot be applied again; create a new reviewed batch' using errcode = '55000';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where item->>'batchId' is distinct from p_batch_id
      or item->>'mappingVersion' is distinct from p_mapping_version
      or item->>'disposition' not in ('retain', 'replace', 'revoke')
      or nullif(item->>'reason', '') is null
  ) then
    raise exception 'Manifest contains unreviewed or inconsistent items' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where item->>'disposition' in ('replace', 'revoke')
      and upper(item->>'sourceType') <> 'DIRECT'
  ) then
    raise exception 'Only reviewed DIRECT mutations are supported; role, Room and Workspace sources require dedicated commands'
      using errcode = '0A000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    group by item->>'sourceId'
    having count(*) > 1
  ) then
    raise exception 'Manifest contains duplicate source IDs' using errcode = '23505';
  end if;

  perform 1
  from public.users target
  join (
    select distinct (item->>'userId')::uuid as user_id
    from jsonb_array_elements(p_items) item
  ) selected on selected.user_id = target.id
  order by target.id
  for update of target;

  for v_user in
    select
      (item->>'userId')::uuid as user_id,
      min(item->>'expectedSourceHash') as expected_hash,
      max(item->>'expectedSourceHash') as maximum_hash,
      min(item->>'expectedTargetVersion') as expected_version,
      max(item->>'expectedTargetVersion') as maximum_version
    from jsonb_array_elements(p_items) item
    group by (item->>'userId')::uuid
  loop
    if v_user.expected_hash is distinct from v_user.maximum_hash
      or v_user.expected_version is distinct from v_user.maximum_version
    then
      raise exception 'Manifest has inconsistent user versions or source hashes' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.users target
      where target.id = v_user.user_id
        and target.updated_at = v_user.expected_version::timestamptz
    ) then
      raise exception 'Target version changed for user %', v_user.user_id using errcode = '40001';
    end if;
    if app_private.authorization_transition_source_hash(v_user.user_id) is distinct from v_user.expected_hash then
      raise exception 'Authorization sources changed for user %', v_user.user_id using errcode = '40001';
    end if;
  end loop;

  insert into app_private.authorization_transition_batches(
    batch_id, mapping_version, manifest_hash, status, actor_user_id, reason, manifest
  ) values (p_batch_id, p_mapping_version, v_manifest_hash, 'APPLIED', v_actor, v_reason, p_items);

  perform set_config('app.authorization_permission_command', 'on', true);
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_after_id := null;
    v_after_created := false;
    if v_item->>'disposition' in ('replace', 'revoke') then
      select * into v_grant
      from public.user_permission_grants
      where id = (v_item->>'sourceId')::uuid
      for update;
      if v_grant.id is null
        or v_grant.user_id is distinct from (v_item->>'userId')::uuid
        or v_grant.permission_code is distinct from v_item#>>'{before,permissionCode}'
        or v_grant.scope_type is distinct from v_item#>>'{before,scopeType}'
        or v_grant.scope_id is distinct from v_item#>>'{before,scopeId}'
        or v_grant.is_active is distinct from coalesce((v_item#>>'{before,isActive}')::boolean, true)
        or v_grant.expires_at is distinct from nullif(v_item#>>'{before,expiresAt}', '')::timestamptz
      then
        raise exception 'Direct source no longer matches manifest: %', v_item->>'sourceId' using errcode = '40001';
      end if;
      if not v_grant.is_active then
        raise exception 'Inactive direct source cannot be mutated: %', v_grant.id using errcode = '23514';
      end if;

      if v_item->>'disposition' = 'replace' then
        if upper(coalesce(v_item#>>'{after,sourceType}', 'DIRECT')) <> 'DIRECT'
          or v_item#>>'{after,scopeType}' is distinct from v_grant.scope_type
          or v_item#>>'{after,scopeId}' is distinct from v_grant.scope_id
          or nullif(v_item#>>'{after,expiresAt}', '')::timestamptz is distinct from v_grant.expires_at
          or not exists (
            select 1 from public.permission_actions action_row
            where action_row.permission_code = v_item#>>'{after,permissionCode}'
              and action_row.is_active
              and action_row.direct_grant_allowed
              and v_grant.scope_type = any(action_row.scope_modes)
          )
        then
          raise exception 'Replacement must be an allowed DIRECT capability with identical scope and expiry'
            using errcode = '23514';
        end if;
        select id into v_after_id
        from public.user_permission_grants
        where user_id = v_grant.user_id
          and permission_code = v_item#>>'{after,permissionCode}'
          and scope_type = v_grant.scope_type
          and scope_id = v_grant.scope_id
          and is_active
          and expires_at is not distinct from v_grant.expires_at
        order by id limit 1;
        if v_after_id is null then
          insert into public.user_permission_grants(
            user_id, permission_code, scope_type, scope_id, is_active,
            granted_by, granted_at, expires_at, grant_reason
          ) values (
            v_grant.user_id, v_item#>>'{after,permissionCode}', v_grant.scope_type, v_grant.scope_id, true,
            v_actor, now(), v_grant.expires_at, v_reason
          ) returning id into v_after_id;
          v_after_created := true;
        end if;
      end if;

      update public.user_permission_grants
      set is_active = false,
          revoked_at = now(),
          revoked_by = v_actor,
          revoked_reason = v_reason,
          updated_at = now()
      where id = v_grant.id;
      v_applied_count := v_applied_count + 1;
    end if;

    insert into app_private.authorization_transition_items(
      batch_id, source_id, user_id, source_type, disposition,
      before_source, after_source, after_source_id, after_source_created
    ) values (
      p_batch_id, v_item->>'sourceId', (v_item->>'userId')::uuid,
      upper(v_item->>'sourceType'), v_item->>'disposition',
      v_item->'before', v_item->'after', v_after_id, v_after_created
    );
  end loop;

  for v_user in
    select distinct (item->>'userId')::uuid as user_id
    from jsonb_array_elements(p_items) item
  loop
    v_post_hashes := v_post_hashes || jsonb_build_object(
      v_user.user_id::text,
      app_private.authorization_transition_source_hash(v_user.user_id)
    );
    insert into public.user_authorization_refresh_events(user_id, event_type, metadata)
    values (v_user.user_id, 'transition_batch_applied', jsonb_build_object('batchId', p_batch_id));
  end loop;

  insert into public.permission_audit_events(
    actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    v_actor, null, 'authorization_transition_batch_applied', p_items, '[]'::jsonb,
    jsonb_build_object('batchId', p_batch_id, 'mappingVersion', p_mapping_version, 'reason', v_reason)
  );

  v_receipt := jsonb_build_object(
    'batchId', p_batch_id,
    'mappingVersion', p_mapping_version,
    'manifestHash', v_manifest_hash,
    'status', 'APPLIED',
    'appliedCount', v_applied_count,
    'postSourceHashes', v_post_hashes,
    'idempotentReplay', false
  );
  update app_private.authorization_transition_batches
  set post_source_hashes = v_post_hashes, receipt = v_receipt, updated_at = now()
  where batch_id = p_batch_id;
  return v_receipt;
end;
$$;

create or replace function public.apply_authorization_transition_batch_v2(
  p_batch_id text,
  p_mapping_version text,
  p_items jsonb,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.apply_authorization_transition_batch_v2_impl(
    p_batch_id, p_mapping_version, p_items, p_reason
  );
$$;

create or replace function app_private.restore_authorization_transition_batch_v2_impl(
  p_batch_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_batch app_private.authorization_transition_batches%rowtype;
  v_item app_private.authorization_transition_items%rowtype;
  v_user record;
  v_restored_hashes jsonb := '{}'::jsonb;
  v_receipt jsonb;
  v_restored_count integer := 0;
begin
  v_actor := app_private.assert_authorization_permission('system.authorization.manage_grants');
  if char_length(v_reason) < 10 then
    raise exception 'Restore reason must contain at least 10 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('authorization-transition:' || p_batch_id));
  select * into v_batch
  from app_private.authorization_transition_batches
  where batch_id = p_batch_id
  for update;
  if v_batch.batch_id is null then
    raise exception 'Transition batch not found' using errcode = '23503';
  end if;
  if v_batch.status = 'RESTORED' then
    return v_batch.receipt || jsonb_build_object('idempotentReplay', true);
  end if;

  perform 1
  from public.users target
  join (
    select distinct user_id from app_private.authorization_transition_items where batch_id = p_batch_id
  ) selected on selected.user_id = target.id
  order by target.id
  for update of target;
  for v_user in
    select distinct user_id from app_private.authorization_transition_items where batch_id = p_batch_id
  loop
    if app_private.authorization_transition_source_hash(v_user.user_id)
      is distinct from v_batch.post_source_hashes->>v_user.user_id::text
    then
      raise exception 'Authorization sources changed after batch for user %', v_user.user_id using errcode = '40001';
    end if;
  end loop;

  perform set_config('app.authorization_permission_command', 'on', true);
  for v_item in
    select * from app_private.authorization_transition_items
    where batch_id = p_batch_id
    order by source_id desc
  loop
    if v_item.disposition in ('replace', 'revoke') then
      if v_item.after_source_created then
        delete from public.user_permission_grants where id = v_item.after_source_id;
      end if;
      update public.user_permission_grants
      set permission_code = v_item.before_source->>'permissionCode',
          scope_type = v_item.before_source->>'scopeType',
          scope_id = v_item.before_source->>'scopeId',
          is_active = coalesce((v_item.before_source->>'isActive')::boolean, true),
          expires_at = nullif(v_item.before_source->>'expiresAt', '')::timestamptz,
          granted_by = nullif(v_item.before_source#>>'{state,grantedBy}', '')::uuid,
          granted_at = (v_item.before_source#>>'{state,grantedAt}')::timestamptz,
          created_at = (v_item.before_source#>>'{state,createdAt}')::timestamptz,
          updated_at = (v_item.before_source#>>'{state,updatedAt}')::timestamptz,
          revoked_at = nullif(v_item.before_source#>>'{state,revokedAt}', '')::timestamptz,
          revoked_by = nullif(v_item.before_source#>>'{state,revokedBy}', '')::uuid,
          revoked_reason = v_item.before_source#>>'{state,revokedReason}',
          grant_reason = v_item.before_source#>>'{state,grantReason}'
      where id = v_item.source_id::uuid;
      if not found then
        raise exception 'Original direct source is unavailable during restore: %', v_item.source_id
          using errcode = '40001';
      end if;
      v_restored_count := v_restored_count + 1;
    end if;
  end loop;

  for v_user in
    select distinct user_id from app_private.authorization_transition_items where batch_id = p_batch_id
  loop
    v_restored_hashes := v_restored_hashes || jsonb_build_object(
      v_user.user_id::text,
      app_private.authorization_transition_source_hash(v_user.user_id)
    );
    insert into public.user_authorization_refresh_events(user_id, event_type, metadata)
    values (v_user.user_id, 'transition_batch_restored', jsonb_build_object('batchId', p_batch_id));
  end loop;

  insert into public.permission_audit_events(
    actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    v_actor, null, 'authorization_transition_batch_restored', v_batch.manifest, '[]'::jsonb,
    jsonb_build_object('batchId', p_batch_id, 'reason', v_reason, 'restoredSourceHashes', v_restored_hashes)
  );
  v_receipt := jsonb_build_object(
    'batchId', p_batch_id,
    'mappingVersion', v_batch.mapping_version,
    'manifestHash', v_batch.manifest_hash,
    'status', 'RESTORED',
    'restoredCount', v_restored_count,
    'restoredSourceHashes', v_restored_hashes,
    'idempotentReplay', false
  );
  update app_private.authorization_transition_batches
  set status = 'RESTORED', restored_at = now(), restored_by = v_actor,
      restore_reason = v_reason, receipt = v_receipt, updated_at = now()
  where batch_id = p_batch_id;
  return v_receipt;
end;
$$;

create or replace function public.restore_authorization_transition_batch_v2(
  p_batch_id text,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.restore_authorization_transition_batch_v2_impl(p_batch_id, p_reason);
$$;

revoke all on function app_private.authorization_transition_source_snapshot(uuid) from public, anon, authenticated;
revoke all on function app_private.authorization_transition_source_hash(uuid) from public, anon, authenticated;
revoke all on function app_private.authorization_transition_manifest_hash(jsonb) from public, anon, authenticated;
revoke all on function app_private.apply_authorization_transition_batch_v2_impl(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function app_private.restore_authorization_transition_batch_v2_impl(text, text) from public, anon, authenticated;
grant execute on function app_private.apply_authorization_transition_batch_v2_impl(text, text, jsonb, text) to authenticated, service_role;
grant execute on function app_private.restore_authorization_transition_batch_v2_impl(text, text) to authenticated, service_role;

revoke all on function public.preview_authorization_transition_sources(uuid) from public, anon, authenticated;
revoke all on function public.apply_authorization_transition_batch_v2(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.restore_authorization_transition_batch_v2(text, text) from public, anon, authenticated;
grant execute on function public.preview_authorization_transition_sources(uuid) to authenticated, service_role;
grant execute on function public.apply_authorization_transition_batch_v2(text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.restore_authorization_transition_batch_v2(text, text) to authenticated, service_role;
