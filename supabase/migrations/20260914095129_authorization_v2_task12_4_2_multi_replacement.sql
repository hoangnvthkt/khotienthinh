-- Task 12.4.2: allow one reviewed DIRECT legacy source to become multiple
-- same-scope DIRECT capabilities while preserving atomic apply/restore.

alter table app_private.authorization_transition_items
  add column after_source_ids uuid[] not null default '{}'::uuid[],
  add column after_source_created_ids uuid[] not null default '{}'::uuid[];

update app_private.authorization_transition_items
set after_source_ids = case
      when after_source_id is null then '{}'::uuid[]
      else array[after_source_id]
    end,
    after_source_created_ids = case
      when after_source_created and after_source_id is not null then array[after_source_id]
      else '{}'::uuid[]
    end;

alter function app_private.apply_authorization_transition_batch_v2_impl(text, text, jsonb, text)
  rename to apply_authorization_transition_batch_v2_single_impl;
alter function app_private.restore_authorization_transition_batch_v2_impl(text, text)
  rename to restore_authorization_transition_batch_v2_single_impl;

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
  v_manifest_hash text;
  v_existing app_private.authorization_transition_batches%rowtype;
  v_single_items jsonb;
  v_receipt jsonb;
  v_item jsonb;
  v_replacement jsonb;
  v_transition_item app_private.authorization_transition_items%rowtype;
  v_after_id uuid;
  v_after_ids uuid[];
  v_created_ids uuid[];
  v_post_hashes jsonb := '{}'::jsonb;
  v_user record;
  v_extra_count integer := 0;
begin
  v_actor := app_private.assert_authorization_permission('system.authorization.manage_grants');
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Non-empty transition items are required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where item->>'disposition' = 'replace'
      and (
        jsonb_typeof(item->'after') not in ('object', 'array')
        or (jsonb_typeof(item->'after') = 'array' and jsonb_array_length(item->'after') = 0)
      )
  ) then
    raise exception 'Replacement requires one or more reviewed targets' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(item->'after')
        when 'array' then item->'after'
        when 'object' then jsonb_build_array(item->'after')
        else '[]'::jsonb
      end
    ) replacement
    where item->>'disposition' = 'replace'
    group by item->>'sourceId',
      upper(coalesce(replacement->>'sourceType', 'DIRECT')),
      replacement->>'permissionCode', replacement->>'scopeType', replacement->>'scopeId',
      replacement->>'expiresAt'
    having count(*) > 1
  ) then
    raise exception 'Manifest contains duplicate replacement targets' using errcode = '23505';
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

  select jsonb_agg(
    case
      when item->>'disposition' = 'replace' and jsonb_typeof(item->'after') = 'array'
        then jsonb_set(item, '{after}', item->'after'->0)
      else item
    end
    order by ordinal
  ) into v_single_items
  from jsonb_array_elements(p_items) with ordinality expanded(item, ordinal);

  v_receipt := app_private.apply_authorization_transition_batch_v2_single_impl(
    p_batch_id, p_mapping_version, v_single_items, p_reason
  );
  perform set_config('app.authorization_permission_command', 'on', true);

  for v_item in
    select item
    from jsonb_array_elements(p_items) item
    where item->>'disposition' = 'replace'
  loop
    select * into v_transition_item
    from app_private.authorization_transition_items
    where batch_id = p_batch_id and source_id = v_item->>'sourceId'
    for update;

    v_after_ids := case
      when v_transition_item.after_source_id is null then '{}'::uuid[]
      else array[v_transition_item.after_source_id]
    end;
    v_created_ids := case
      when v_transition_item.after_source_created and v_transition_item.after_source_id is not null
        then array[v_transition_item.after_source_id]
      else '{}'::uuid[]
    end;

    for v_replacement in
      select replacement
      from jsonb_array_elements(
        case jsonb_typeof(v_item->'after')
          when 'array' then v_item->'after'
          else jsonb_build_array(v_item->'after')
        end
      ) with ordinality expanded(replacement, ordinal)
      where ordinal > 1
      order by ordinal
    loop
      if upper(coalesce(v_replacement->>'sourceType', 'DIRECT')) <> 'DIRECT'
        or v_replacement->>'scopeType' is distinct from v_transition_item.before_source->>'scopeType'
        or v_replacement->>'scopeId' is distinct from v_transition_item.before_source->>'scopeId'
        or nullif(v_replacement->>'expiresAt', '')::timestamptz
          is distinct from nullif(v_transition_item.before_source->>'expiresAt', '')::timestamptz
        or not exists (
          select 1 from public.permission_actions action_row
          where action_row.permission_code = v_replacement->>'permissionCode'
            and action_row.is_active
            and action_row.direct_grant_allowed
            and v_transition_item.before_source->>'scopeType' = any(action_row.scope_modes)
        )
      then
        raise exception 'Replacement must be an allowed DIRECT capability with identical scope and expiry'
          using errcode = '23514';
      end if;

      select id into v_after_id
      from public.user_permission_grants
      where user_id = v_transition_item.user_id
        and permission_code = v_replacement->>'permissionCode'
        and scope_type = v_transition_item.before_source->>'scopeType'
        and scope_id = v_transition_item.before_source->>'scopeId'
        and is_active
        and expires_at is not distinct from nullif(v_transition_item.before_source->>'expiresAt', '')::timestamptz
      order by id limit 1;
      if v_after_id is null then
        insert into public.user_permission_grants(
          user_id, permission_code, scope_type, scope_id, is_active,
          granted_by, granted_at, expires_at, grant_reason
        ) values (
          v_transition_item.user_id, v_replacement->>'permissionCode',
          v_transition_item.before_source->>'scopeType', v_transition_item.before_source->>'scopeId', true,
          v_actor, now(), nullif(v_transition_item.before_source->>'expiresAt', '')::timestamptz,
          btrim(p_reason)
        ) returning id into v_after_id;
        v_created_ids := array_append(v_created_ids, v_after_id);
      end if;
      v_after_ids := array_append(v_after_ids, v_after_id);
      v_extra_count := v_extra_count + 1;
    end loop;

    update app_private.authorization_transition_items
    set after_source = v_item->'after',
        after_source_ids = v_after_ids,
        after_source_created_ids = v_created_ids
    where batch_id = p_batch_id and source_id = v_item->>'sourceId';
  end loop;

  update app_private.authorization_transition_items
  set after_source_ids = case
        when after_source_id is null then '{}'::uuid[] else array[after_source_id]
      end,
      after_source_created_ids = case
        when after_source_created and after_source_id is not null then array[after_source_id]
        else '{}'::uuid[]
      end
  where batch_id = p_batch_id and cardinality(after_source_ids) = 0
    and jsonb_typeof(after_source) = 'object';

  for v_user in
    select distinct (item->>'userId')::uuid as user_id
    from jsonb_array_elements(p_items) item
  loop
    v_post_hashes := v_post_hashes || jsonb_build_object(
      v_user.user_id::text,
      app_private.authorization_transition_source_hash(v_user.user_id)
    );
  end loop;

  v_receipt := v_receipt || jsonb_build_object(
    'manifestHash', v_manifest_hash,
    'postSourceHashes', v_post_hashes,
    'replacementGrantCount', v_extra_count + (
      select count(*) from app_private.authorization_transition_items
      where batch_id = p_batch_id and after_source_id is not null
    ),
    'idempotentReplay', false
  );
  update app_private.authorization_transition_batches
  set manifest_hash = v_manifest_hash,
      manifest = p_items,
      post_source_hashes = v_post_hashes,
      receipt = v_receipt,
      updated_at = now()
  where batch_id = p_batch_id;

  if v_extra_count > 0 then
    insert into public.permission_audit_events(
      actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
    ) values (
      v_actor, null, 'authorization_transition_multi_replacements_applied',
      v_single_items, p_items,
      jsonb_build_object('batchId', p_batch_id, 'extraReplacementCount', v_extra_count)
    );
  end if;
  return v_receipt;
end;
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
  v_batch app_private.authorization_transition_batches%rowtype;
  v_item app_private.authorization_transition_items%rowtype;
  v_user record;
  v_interim_hashes jsonb := '{}'::jsonb;
  v_receipt jsonb;
begin
  v_actor := app_private.assert_authorization_permission('system.authorization.manage_grants');
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
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
    select distinct user_id
    from app_private.authorization_transition_items
    where batch_id = p_batch_id
  ) selected on selected.user_id = target.id
  order by target.id
  for update of target;
  for v_user in
    select distinct user_id
    from app_private.authorization_transition_items
    where batch_id = p_batch_id
  loop
    if app_private.authorization_transition_source_hash(v_user.user_id)
      is distinct from v_batch.post_source_hashes->>v_user.user_id::text
    then
      raise exception 'Authorization sources changed after batch for user %', v_user.user_id
        using errcode = '40001';
    end if;
  end loop;

  perform set_config('app.authorization_permission_command', 'on', true);
  for v_item in
    select *
    from app_private.authorization_transition_items
    where batch_id = p_batch_id
    order by source_id desc
  loop
    if cardinality(v_item.after_source_created_ids) > 0 then
      delete from public.user_permission_grants
      where id = any(v_item.after_source_created_ids)
        and id is distinct from v_item.after_source_id;
    end if;
  end loop;

  for v_user in
    select distinct user_id
    from app_private.authorization_transition_items
    where batch_id = p_batch_id
  loop
    v_interim_hashes := v_interim_hashes || jsonb_build_object(
      v_user.user_id::text,
      app_private.authorization_transition_source_hash(v_user.user_id)
    );
  end loop;
  update app_private.authorization_transition_batches
  set post_source_hashes = v_interim_hashes, updated_at = now()
  where batch_id = p_batch_id;

  v_receipt := app_private.restore_authorization_transition_batch_v2_single_impl(p_batch_id, p_reason);
  return v_receipt || jsonb_build_object('multiReplacementRestore', true);
end;
$$;

revoke all on function app_private.apply_authorization_transition_batch_v2_single_impl(text, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.restore_authorization_transition_batch_v2_single_impl(text, text)
  from public, anon, authenticated, service_role;

revoke all on function app_private.apply_authorization_transition_batch_v2_impl(text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function app_private.restore_authorization_transition_batch_v2_impl(text, text)
  from public, anon, authenticated;
grant execute on function app_private.apply_authorization_transition_batch_v2_impl(text, text, jsonb, text)
  to authenticated, service_role;
grant execute on function app_private.restore_authorization_transition_batch_v2_impl(text, text)
  to authenticated, service_role;
