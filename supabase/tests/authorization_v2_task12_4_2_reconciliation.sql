-- Cloud-only Task 12.4.2-F apply/reconciliation smoke. All writes roll back.
begin;

create temporary table task12_4_2_transition_context (
  actor_id uuid,
  actor_auth_id uuid,
  target_id uuid,
  source_id uuid,
  batch_id text,
  mapping_version text,
  items jsonb
) on commit drop;

with actor as (
  select id, auth_id from public.users
  where is_active and account_status = 'ACTIVE' and role::text = 'ADMIN' and auth_id is not null
  order by id limit 1
), target as (
  select u.id, u.updated_at from public.users u
  where u.is_active and u.account_status = 'ACTIVE' and u.role::text = 'EMPLOYEE'
    and not exists (
      select 1 from public.user_permission_grants g
      where g.user_id = u.id and g.permission_code in (
        'system.rq.view', 'request.instance.view_own', 'request.template.view', 'settings.general.view'
      )
    )
  order by u.id limit 1
)
insert into task12_4_2_transition_context(
  actor_id, actor_auth_id, target_id, batch_id, mapping_version
)
select actor.id, actor.auth_id, target.id,
       'task12.4.2-smoke-direct', '2026-09-14.smoke'
from actor cross join target;

with source as (
  insert into public.user_permission_grants(
    user_id, permission_code, scope_type, scope_id, is_active, grant_reason
  )
  select target_id, 'system.rq.view', 'global', '*', true,
         'Task 12.4.2 reversible transition fixture'
  from task12_4_2_transition_context
  returning id
)
update task12_4_2_transition_context context_row
set source_id = source.id
from source;

update task12_4_2_transition_context context_row
set items = jsonb_build_array(jsonb_build_object(
      'batchId', 'task12.4.2-smoke-direct',
      'mappingVersion', '2026-09-14.smoke',
      'userId', context_row.target_id,
      'sourceId', context_row.source_id::text,
      'sourceType', 'DIRECT',
      'before', (
        select entry from jsonb_array_elements(
          app_private.authorization_transition_source_snapshot(context_row.target_id)
        ) entry
        where entry->>'sourceId' = context_row.source_id::text
      ),
      'after', jsonb_build_array(
        jsonb_build_object(
          'sourceId', null,
          'sourceType', 'DIRECT',
          'permissionCode', 'request.instance.view_own',
          'scopeType', 'global',
          'scopeId', '*',
          'expiresAt', null
        ),
        jsonb_build_object(
          'sourceId', null,
          'sourceType', 'DIRECT',
          'permissionCode', 'request.template.view',
          'scopeType', 'global',
          'scopeId', '*',
          'expiresAt', null
        )
      ),
      'disposition', 'replace',
      'reason', 'Reviewed equivalent request read replacement',
      'expectedSourceHash', app_private.authorization_transition_source_hash(context_row.target_id),
      'expectedTargetVersion', (select updated_at from public.users where id = context_row.target_id)
    ));

grant select on task12_4_2_transition_context to authenticated;

do $$
begin
  if not exists (select 1 from task12_4_2_transition_context) then
    raise exception 'Transition smoke fixtures unavailable';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', actor_auth_id::text, true)
from task12_4_2_transition_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_context task12_4_2_transition_context%rowtype;
  v_receipt jsonb;
  v_invalid_items jsonb;
begin
  select * into v_context from task12_4_2_transition_context;
  if public.preview_authorization_transition_sources(v_context.target_id)->>'expectedSourceHash'
    is distinct from v_context.items->0->>'expectedSourceHash'
  then
    raise exception 'Preview and manifest source hashes differ';
  end if;

  begin
    perform public.apply_authorization_transition_batch_v2(
      'task12.4.2-smoke-manual', v_context.mapping_version,
      jsonb_set(
        jsonb_set(v_context.items, '{0,batchId}', '"task12.4.2-smoke-manual"'),
        '{0,disposition}', '"manual_review"'
      ),
      'Task 12.4.2 manual review must fail'
    );
    raise exception 'Manual-review item unexpectedly applied';
  exception when check_violation then
    null;
  end;

  begin
    perform public.apply_authorization_transition_batch_v2(
      'task12.4.2-smoke-role', v_context.mapping_version,
      jsonb_set(
        jsonb_set(
          jsonb_set(v_context.items, '{0,batchId}', '"task12.4.2-smoke-role"'),
          '{0,sourceType}', '"ROLE_ASSIGNMENT"'
        ),
        '{0,disposition}', '"revoke"'
      ),
      'Task 12.4.2 unsupported role mutation must fail'
    );
    raise exception 'Unsupported role mutation unexpectedly applied';
  exception when feature_not_supported then
    null;
  end;

  begin
    perform public.apply_authorization_transition_batch_v2(
      'task12.4.2-smoke-stale', v_context.mapping_version,
      jsonb_set(
        jsonb_set(v_context.items, '{0,batchId}', '"task12.4.2-smoke-stale"'),
        '{0,expectedSourceHash}', to_jsonb(repeat('0', 64))
      ),
      'Task 12.4.2 stale source hash must fail'
    );
    raise exception 'Stale source hash unexpectedly applied';
  exception when serialization_failure then
    null;
  end;

  -- A rejected second target must roll back the already-processed first target.
  v_invalid_items := jsonb_set(v_context.items, '{0,after,1,permissionCode}',
    '"not.a.catalog.permission"');
  begin
    perform public.apply_authorization_transition_batch_v2(
      v_context.batch_id, v_context.mapping_version, v_invalid_items,
      'Task 12.4.2 invalid second target must roll back'
    );
    raise exception 'Invalid second replacement unexpectedly applied';
  exception when check_violation then null;
  end;
  if public.preview_authorization_transition_sources(v_context.target_id)->>'expectedSourceHash'
    is distinct from v_context.items->0->>'expectedSourceHash'
  then
    raise exception 'Rejected second replacement left partial source changes';
  end if;

  v_invalid_items := jsonb_set(v_context.items, '{0,after,1}', v_context.items#>'{0,after,0}');
  begin
    perform public.apply_authorization_transition_batch_v2(
      v_context.batch_id, v_context.mapping_version, v_invalid_items,
      'Task 12.4.2 duplicate replacement must fail'
    );
    raise exception 'Duplicate replacement unexpectedly applied';
  exception when unique_violation then null;
  end;

  v_receipt := public.apply_authorization_transition_batch_v2(
    v_context.batch_id, v_context.mapping_version, v_context.items,
    'Task 12.4.2 apply reversible smoke batch'
  );
  if v_receipt->>'status' <> 'APPLIED' or (v_receipt->>'appliedCount')::integer <> 1 then
    raise exception 'Unexpected apply receipt: %', v_receipt;
  end if;
  if (public.apply_authorization_transition_batch_v2(
    v_context.batch_id, v_context.mapping_version, v_context.items,
    'Task 12.4.2 apply reversible smoke batch'
  )->>'idempotentReplay')::boolean is not true then
    raise exception 'Identical apply retry was not idempotent';
  end if;
  if exists (select 1 from public.user_permission_grants where id = v_context.source_id and is_active) then
    raise exception 'Legacy direct source remains active after apply';
  end if;
  if not exists (
    select 1 from public.user_permission_grants
    where user_id = v_context.target_id and permission_code = 'request.instance.view_own'
      and scope_type = 'global' and scope_id = '*' and is_active
  ) then
    raise exception 'First replacement direct source is missing after apply';
  end if;
  if not exists (
    select 1 from public.user_permission_grants
    where user_id = v_context.target_id and permission_code = 'request.template.view'
      and scope_type = 'global' and scope_id = '*' and is_active
  ) then
    raise exception 'Second replacement direct source is missing after apply';
  end if;
end;
$$;

reset role;

-- Any independent authorization edit after apply must stop restore.
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select target_id, 'settings.general.view', 'global', '*', true,
       'Task 12.4.2 concurrent edit restore guard'
from task12_4_2_transition_context;

set local role authenticated;
do $$
declare v_context task12_4_2_transition_context%rowtype;
begin
  select * into v_context from task12_4_2_transition_context;
  begin
    perform public.restore_authorization_transition_batch_v2(
      v_context.batch_id, 'Task 12.4.2 stale restore must fail'
    );
    raise exception 'Restore ignored a concurrent authorization edit';
  exception when serialization_failure then
    null;
  end;
end;
$$;

reset role;
delete from public.user_permission_grants
where user_id = (select target_id from task12_4_2_transition_context)
  and permission_code = 'settings.general.view'
  and grant_reason = 'Task 12.4.2 concurrent edit restore guard';

set local role authenticated;
do $$
declare
  v_context task12_4_2_transition_context%rowtype;
  v_receipt jsonb;
begin
  select * into v_context from task12_4_2_transition_context;
  v_receipt := public.restore_authorization_transition_batch_v2(
    v_context.batch_id, 'Task 12.4.2 restore reversible smoke batch'
  );
  if v_receipt->>'status' <> 'RESTORED' or (v_receipt->>'restoredCount')::integer <> 1 then
    raise exception 'Unexpected restore receipt: %', v_receipt;
  end if;
  if (public.restore_authorization_transition_batch_v2(
    v_context.batch_id, 'Task 12.4.2 restore reversible smoke batch'
  )->>'idempotentReplay')::boolean is not true then
    raise exception 'Identical restore retry was not idempotent';
  end if;
  if not exists (select 1 from public.user_permission_grants where id = v_context.source_id and is_active) then
    raise exception 'Original direct source was not restored';
  end if;
  if exists (
    select 1 from public.user_permission_grants
    where user_id = v_context.target_id
      and permission_code in ('request.instance.view_own', 'request.template.view')
      and grant_reason = 'Task 12.4.2 apply reversible smoke batch'
  ) then
    raise exception 'Batch-created replacement survived restore';
  end if;
end;
$$;

reset role;

-- Reusing a pre-existing first target must not delete it on restore, while
-- the newly-created second target must still be removed.
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select target_id, 'request.instance.view_own', 'global', '*', true,
       'Task 12.4.2 pre-existing replacement fixture'
from task12_4_2_transition_context;

update task12_4_2_transition_context c
set batch_id = 'task12.4.2-smoke-reuse',
    items = jsonb_set(jsonb_set(c.items,
      '{0,batchId}', '"task12.4.2-smoke-reuse"'),
      '{0,expectedSourceHash}', to_jsonb(app_private.authorization_transition_source_hash(c.target_id)));

set local role authenticated;
do $$
declare
  v_context task12_4_2_transition_context%rowtype;
  v_receipt jsonb;
begin
  select * into v_context from task12_4_2_transition_context;
  perform public.apply_authorization_transition_batch_v2(
    v_context.batch_id, v_context.mapping_version, v_context.items,
    'Task 12.4.2 reuse existing replacement test'
  );
  v_receipt := public.restore_authorization_transition_batch_v2(
    v_context.batch_id, 'Task 12.4.2 restore with reused replacement'
  );
  if v_receipt->'restoredSourceHashes'->>v_context.target_id::text
    is distinct from v_context.items->0->>'expectedSourceHash'
  then
    raise exception 'Restore did not reproduce the full pre-apply source snapshot';
  end if;
  if not exists (
    select 1 from public.user_permission_grants
    where user_id = v_context.target_id and permission_code = 'request.instance.view_own'
      and is_active and grant_reason = 'Task 12.4.2 pre-existing replacement fixture'
  ) then
    raise exception 'Restore deleted a pre-existing replacement';
  end if;
  if exists (
    select 1 from public.user_permission_grants
    where user_id = v_context.target_id and permission_code = 'request.template.view'
      and grant_reason = 'Task 12.4.2 reuse existing replacement test'
  ) then
    raise exception 'Restore kept newly created second target after reusing the first';
  end if;
end;
$$;
reset role;
rollback;
