-- Forward-only hardening for the A3.1 atomic project opening command.
-- The original 20260715102000 migration remains immutable; its function is
-- retained as a fully-revoked implementation behind a least-privilege wrapper.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $hardening_prerequisites$
begin
  if pg_catalog.to_regprocedure('public.lock_project_opening_balance(jsonb)') is null
     or pg_catalog.to_regprocedure('app_private.wms_has_action(text,text,text,uuid,uuid,uuid)') is null
     or pg_catalog.to_regprocedure('app_private.quantity_units_are_equivalent(text,text)') is null then
    raise exception 'atomic project opening hardening prerequisites are missing'
      using errcode = '55000';
  end if;
end;
$hardening_prerequisites$;

-- Legacy finance rows may predate optimistic concurrency. Backfill only the
-- nullable fields the opening RPC compares, then make their future shape exact.
lock table public.project_finances in share row exclusive mode;

do $legacy_nullable_finance_preflight$
declare
  v_affected_rows bigint;
begin
  select pg_catalog.count(*)
  into v_affected_rows
  from public.project_finances finance
  where finance."contractValue" is null
     or finance."progressPercent" is null
     or finance."updatedAt" is null;

  raise notice 'legacy nullable finance preflight: % row(s) require backfill',
    v_affected_rows;
end;
$legacy_nullable_finance_preflight$;

update public.project_finances finance
set "contractValue" = coalesce(finance."contractValue", 0),
    "progressPercent" = coalesce(finance."progressPercent", 0),
    "updatedAt" = coalesce(finance."updatedAt", pg_catalog.clock_timestamp())
where finance."contractValue" is null
   or finance."progressPercent" is null
   or finance."updatedAt" is null;

alter table public.project_finances
  alter column "contractValue" set default 0,
  alter column "contractValue" set not null,
  alter column "progressPercent" set default 0,
  alter column "progressPercent" set not null,
  alter column "updatedAt" set default pg_catalog.now(),
  alter column "updatedAt" set not null;

create or replace function app_private.touch_project_finance_updated_at()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if (pg_catalog.to_jsonb(new) - 'updatedAt')
       is distinct from (pg_catalog.to_jsonb(old) - 'updatedAt')
     or new."updatedAt" is null then
    new."updatedAt" := greatest(
      pg_catalog.clock_timestamp(),
      old."updatedAt" + interval '1 microsecond'
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.touch_project_finance_updated_at()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_touch_project_finance_updated_at on public.project_finances;
create trigger trg_touch_project_finance_updated_at
before update on public.project_finances
for each row execute function app_private.touch_project_finance_updated_at();
alter table public.project_finances
  enable always trigger trg_touch_project_finance_updated_at;

-- Protected capability proving that the public opening wrapper, rather than a
-- different same-owner SECURITY DEFINER function, initiated the current call.
create unlogged table app_private.project_opening_call_contexts (
  backend_pid integer not null,
  transaction_xid bigint not null,
  command_id uuid not null,
  actor_id uuid not null,
  target_warehouse_ids text[] not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (backend_pid, transaction_xid),
  check (pg_catalog.cardinality(target_warehouse_ids) > 0)
);

revoke all on table app_private.project_opening_call_contexts
  from public, anon, authenticated, service_role;
revoke truncate on table app_private.project_opening_call_contexts
  from public, anon, authenticated, service_role;

comment on table app_private.project_opening_call_contexts is
  'Per-backend/per-XID opening-command capabilities. The public wrapper creates and removes them; ALWAYS triggers consume only their presence.';

-- Duplicate project opening transaction source preflight. Existing reserved
-- sources must already have trustworthy provenance before uniqueness is added.
do $duplicate_project_opening_transaction_source_preflight$
declare
  v_invalid text;
  v_duplicates text;
begin
  select pg_catalog.string_agg(transaction_row.id, ', ' order by transaction_row.id)
  into v_invalid
  from public.transactions transaction_row
  where transaction_row.source_type = 'project_opening_balance'
    and (
      nullif(pg_catalog.btrim(transaction_row.source_id), '') is null
      or transaction_row.posting_engine_version is distinct from 'wf001-opening-v1'
    );

  if v_invalid is not null then
    raise exception 'invalid project opening transaction source preflight failed: %', v_invalid
      using errcode = '23514';
  end if;

  select pg_catalog.string_agg(
    duplicate_source.source_id || ' (' || duplicate_source.row_count::text || ' rows)',
    ', ' order by duplicate_source.source_id
  )
  into v_duplicates
  from (
    select transaction_row.source_id, pg_catalog.count(*) as row_count
    from public.transactions transaction_row
    where transaction_row.source_type = 'project_opening_balance'
    group by transaction_row.source_id
    having pg_catalog.count(*) > 1
  ) duplicate_source;

  if v_duplicates is not null then
    raise exception 'duplicate project opening transaction source preflight failed: %', v_duplicates
      using errcode = '23505';
  end if;
end;
$duplicate_project_opening_transaction_source_preflight$;

create unique index transactions_project_opening_source_uidx
  on public.transactions(source_type, source_id)
  where source_type = 'project_opening_balance';

create or replace function app_private.guard_project_opening_transaction_source()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_table_owner name;
  v_actor uuid := public.current_app_user_id();
  v_has_context boolean := false;
begin
  if tg_op = 'UPDATE'
     and old.source_type = 'project_opening_balance'
     and (
       new.source_type is distinct from old.source_type
       or new.source_id is distinct from old.source_id
       or new.id is distinct from old.id
       or new.target_warehouse_id is distinct from old.target_warehouse_id
       or new.posting_engine_version is distinct from old.posting_engine_version
     ) then
    raise exception 'reserved opening source identity is immutable'
      using errcode = '55000';
  end if;

  if new.source_type is distinct from 'project_opening_balance' then
    return new;
  end if;

  select owner_role.rolname
  into v_table_owner
  from pg_catalog.pg_class table_row
  join pg_catalog.pg_roles owner_role on owner_role.oid = table_row.relowner
  where table_row.oid = tg_relid;

  if current_user::text is distinct from v_table_owner::text then
    raise exception 'reserved opening source requires the table-owner command path'
      using errcode = '42501';
  end if;
  if new.posting_engine_version is distinct from 'wf001-opening-v1' then
    raise exception 'reserved opening source requires posting engine wf001-opening-v1'
      using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(new.source_id), '') is null then
    raise exception 'reserved opening source_id is required'
      using errcode = '22023';
  end if;
  if new.status::text <> 'PENDING'
     and not (tg_op = 'UPDATE' and old.source_type = 'project_opening_balance') then
    raise exception 'reserved opening source must be inserted as PENDING'
      using errcode = '42501';
  end if;
  if new.type::text <> 'ADJUSTMENT' or new.source_warehouse_id is not null then
    raise exception 'reserved opening source requires a target-only ADJUSTMENT'
      using errcode = '22023';
  end if;

  select true
  into v_has_context
  from app_private.project_opening_call_contexts call_context
  where call_context.backend_pid = pg_catalog.pg_backend_pid()
    and call_context.transaction_xid = pg_catalog.txid_current()
    and call_context.actor_id = v_actor
    and new.target_warehouse_id = any(call_context.target_warehouse_ids)
  limit 1
  for update;

  if not coalesce(v_has_context, false) then
    raise exception 'reserved opening source requires an active opening command capability'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_project_opening_transaction_source()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_project_opening_transaction_source on public.transactions;
create trigger trg_guard_project_opening_transaction_source
before insert or update on public.transactions
for each row execute function app_private.guard_project_opening_transaction_source();
alter table public.transactions
  enable always trigger trg_guard_project_opening_transaction_source;

-- Exact catalog permission enforcement happens only when the opening core
-- actually inserts an item or repairs a missing price. Exact replay and
-- ON CONFLICT DO NOTHING therefore do not require catalog mutation rights.
create or replace function app_private.guard_project_opening_catalog_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_has_context boolean := false;
begin
  select true
  into v_has_context
  from app_private.project_opening_call_contexts call_context
  where call_context.backend_pid = pg_catalog.pg_backend_pid()
    and call_context.transaction_xid = pg_catalog.txid_current()
    and call_context.actor_id = v_actor
  limit 1;

  if not coalesce(v_has_context, false) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and row(old.price_in, old.price_out)
       is not distinct from row(new.price_in, new.price_out) then
    return new;
  end if;

  if not (
    app_private.wms_has_action('wms.inventory.edit', null, null, null, null, v_actor)
    or app_private.wms_has_action('wms.master_data.manage', null, null, null, null, v_actor)
  ) then
    raise exception 'catalog permission is required for opening item mutation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_project_opening_catalog_write()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_project_opening_catalog_write on public.items;
create trigger trg_guard_project_opening_catalog_write
after insert or update of price_in, price_out on public.items
for each row execute function app_private.guard_project_opening_catalog_write();
alter table public.items
  enable always trigger trg_guard_project_opening_catalog_write;

-- Scope keys are presentation/cache keys. The project/site pair is the
-- authoritative identity, and a linked project always contributes its exact
-- canonical HRM site (or no site when the project is intentionally unlinked).
create or replace function app_private.project_opening_authoritative_scope_key(
  p_project_id text,
  p_construction_site_id text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select app_private.normalize_project_opening_scope_key(
    case
      when nullif(pg_catalog.btrim(p_project_id), '') is not null
       and nullif(pg_catalog.btrim(p_construction_site_id), '') is not null
        then pg_catalog.btrim(p_project_id) || '_' || pg_catalog.btrim(p_construction_site_id)
      when nullif(pg_catalog.btrim(p_project_id), '') is not null
        then pg_catalog.btrim(p_project_id)
      else coalesce(nullif(pg_catalog.btrim(p_construction_site_id), ''), '')
    end
  );
$$;

revoke all on function app_private.project_opening_authoritative_scope_key(text, text)
  from public, anon, authenticated, service_role;

-- Authoritative locked-scope preflight. Reject stale/spoofed scope keys and
-- project-site mismatch rows before replacing the legacy scope-key index.
do $authoritative_locked_scope_preflight$
declare
  v_invalid text;
  v_duplicates text;
begin
  select pg_catalog.string_agg(opening.id::text, ', ' order by opening.id::text)
  into v_invalid
  from public.project_opening_balances opening
  left join public.projects project_row
    on project_row.id = nullif(pg_catalog.btrim(opening.project_id), '')
  left join public.hrm_construction_sites site_row
    on site_row.id::text = nullif(pg_catalog.btrim(opening.construction_site_id), '')
  where opening.status = 'locked'
    and (
      (
        nullif(pg_catalog.btrim(opening.project_id), '') is null
        and nullif(pg_catalog.btrim(opening.construction_site_id), '') is null
      )
      or (
        nullif(pg_catalog.btrim(opening.project_id), '') is not null
        and project_row.id is null
      )
      or (
        nullif(pg_catalog.btrim(opening.project_id), '') is not null
        and project_row.construction_site_id::text
          is distinct from nullif(pg_catalog.btrim(opening.construction_site_id), '')
      )
      or (
        nullif(pg_catalog.btrim(opening.project_id), '') is null
        and nullif(pg_catalog.btrim(opening.construction_site_id), '') is not null
        and site_row.id is null
      )
      or app_private.normalize_project_opening_scope_key(opening.scope_key)
        is distinct from app_private.project_opening_authoritative_scope_key(
          opening.project_id,
          opening.construction_site_id
        )
    );

  if v_invalid is not null then
    raise exception 'authoritative scope project-site mismatch preflight failed: %', v_invalid
      using errcode = '23514';
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format(
      '(%s,%s): %s rows',
      duplicate_scope.project_id,
      duplicate_scope.construction_site_id,
      duplicate_scope.row_count
    ),
    ', '
    order by duplicate_scope.project_id, duplicate_scope.construction_site_id
  )
  into v_duplicates
  from (
    select
      coalesce(nullif(pg_catalog.btrim(opening.project_id), ''), '') as project_id,
      coalesce(nullif(pg_catalog.btrim(opening.construction_site_id), ''), '') as construction_site_id,
      pg_catalog.count(*) as row_count
    from public.project_opening_balances opening
    where opening.status = 'locked'
    group by
      coalesce(nullif(pg_catalog.btrim(opening.project_id), ''), ''),
      coalesce(nullif(pg_catalog.btrim(opening.construction_site_id), ''), '')
    having pg_catalog.count(*) > 1
  ) duplicate_scope;

  if v_duplicates is not null then
    raise exception 'duplicate authoritative locked scope preflight failed: %', v_duplicates
      using errcode = '23505';
  end if;
end;
$authoritative_locked_scope_preflight$;

-- Existing locked rows must already agree with their resolved item identity;
-- otherwise adding a transition guard would preserve an untrustworthy state.
do $locked_line_identity_coherence_preflight$
declare
  v_invalid text;
begin
  select pg_catalog.string_agg(opening.id::text, ', ' order by opening.id::text)
  into v_invalid
  from public.project_opening_balances opening
  where opening.status = 'locked'
    and (
      not exists (
        select 1
        from public.project_opening_balance_lines line
        where line.opening_balance_id = opening.id
      )
      or exists (
        select 1
        from public.project_opening_balance_lines line
        where line.opening_balance_id = opening.id
        group by pg_catalog.lower(pg_catalog.btrim(line.sku))
        having pg_catalog.count(distinct pg_catalog.jsonb_build_array(
          coalesce(nullif(pg_catalog.btrim(line.accounting_code), ''), ''),
          app_private.normalize_quantity_unit(line.unit),
          coalesce(line.inventory_item_id, '')
        )) > 1
      )
      or exists (
        select 1
        from public.project_opening_balance_lines line
        where line.opening_balance_id = opening.id
          and nullif(pg_catalog.btrim(line.accounting_code), '') is not null
        group by pg_catalog.btrim(line.accounting_code)
        having pg_catalog.count(distinct pg_catalog.jsonb_build_array(
          pg_catalog.lower(pg_catalog.btrim(line.sku)),
          app_private.normalize_quantity_unit(line.unit),
          coalesce(line.inventory_item_id, '')
        )) > 1
      )
      or exists (
        select 1
        from public.project_opening_balance_lines line
        left join public.items item on item.id = line.inventory_item_id
        where line.opening_balance_id = opening.id
          and (
            line.inventory_item_id is null
            or item.id is null
            or pg_catalog.lower(pg_catalog.btrim(line.sku))
              is distinct from pg_catalog.lower(pg_catalog.btrim(item.sku))
            or coalesce(nullif(pg_catalog.btrim(line.accounting_code), ''), '')
              is distinct from coalesce(nullif(pg_catalog.btrim(item.accounting_code), ''), '')
            or not app_private.quantity_units_are_equivalent(line.unit, item.unit)
          )
      )
    );

  if v_invalid is not null then
    raise exception 'locked line identity coherence preflight failed: %', v_invalid
      using errcode = '23514';
  end if;
end;
$locked_line_identity_coherence_preflight$;

drop index if exists public.idx_project_opening_balances_locked_scope;
create unique index project_opening_balances_locked_authoritative_scope_uidx
  on public.project_opening_balances (
    (coalesce(nullif(pg_catalog.btrim(project_id), ''), '')),
    (coalesce(nullif(pg_catalog.btrim(construction_site_id), ''), ''))
  )
  where status = 'locked';

create or replace function app_private.validate_project_opening_lock()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_project_site_id uuid;
begin
  if not (old.status is distinct from 'locked' and new.status = 'locked') then
    return new;
  end if;

  if nullif(pg_catalog.btrim(new.project_id), '') is null
     and nullif(pg_catalog.btrim(new.construction_site_id), '') is null then
    raise exception 'authoritative opening scope requires a project or construction site'
      using errcode = '23514';
  end if;

  if nullif(pg_catalog.btrim(new.project_id), '') is not null then
    select project_row.construction_site_id
    into v_project_site_id
    from public.projects project_row
    where project_row.id = pg_catalog.btrim(new.project_id);
    if not found then
      raise exception 'authoritative opening project does not exist: %', new.project_id
        using errcode = '23503';
    end if;
    if v_project_site_id::text
       is distinct from nullif(pg_catalog.btrim(new.construction_site_id), '') then
      raise exception 'authoritative opening project-site mismatch'
        using errcode = '23514';
    end if;
  elsif not exists (
    select 1
    from public.hrm_construction_sites site_row
    where site_row.id::text = pg_catalog.btrim(new.construction_site_id)
  ) then
    raise exception 'authoritative opening construction site does not exist: %',
      new.construction_site_id
      using errcode = '23503';
  end if;

  if app_private.normalize_project_opening_scope_key(new.scope_key)
     is distinct from app_private.project_opening_authoritative_scope_key(
       new.project_id,
       new.construction_site_id
     ) then
    raise exception 'authoritative opening scopeKey does not match its project/site identity'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.project_opening_balance_lines line
    where line.opening_balance_id = new.id
  ) then
    raise exception 'line identity coherence requires at least one opening line'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.project_opening_balance_lines line
    where line.opening_balance_id = new.id
    group by pg_catalog.lower(pg_catalog.btrim(line.sku))
    having pg_catalog.count(distinct pg_catalog.jsonb_build_array(
      coalesce(nullif(pg_catalog.btrim(line.accounting_code), ''), ''),
      app_private.normalize_quantity_unit(line.unit),
      coalesce(line.inventory_item_id, '')
    )) > 1
  ) then
    raise exception 'line identity coherence failed: one SKU maps to conflicting accounting, unit, or item identities'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.project_opening_balance_lines line
    where line.opening_balance_id = new.id
      and nullif(pg_catalog.btrim(line.accounting_code), '') is not null
    group by pg_catalog.btrim(line.accounting_code)
    having pg_catalog.count(distinct pg_catalog.jsonb_build_array(
      pg_catalog.lower(pg_catalog.btrim(line.sku)),
      app_private.normalize_quantity_unit(line.unit),
      coalesce(line.inventory_item_id, '')
    )) > 1
  ) then
    raise exception 'line identity coherence failed: one accounting code maps to conflicting SKU, unit, or item identities'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.project_opening_balance_lines line
    left join public.items item on item.id = line.inventory_item_id
    where line.opening_balance_id = new.id
      and (
        line.inventory_item_id is null
        or item.id is null
        or pg_catalog.lower(pg_catalog.btrim(line.sku))
          is distinct from pg_catalog.lower(pg_catalog.btrim(item.sku))
        or coalesce(nullif(pg_catalog.btrim(line.accounting_code), ''), '')
          is distinct from coalesce(nullif(pg_catalog.btrim(item.accounting_code), ''), '')
        or not app_private.quantity_units_are_equivalent(line.unit, item.unit)
      )
  ) then
    raise exception 'line identity coherence failed: an opening line disagrees with its authoritative item'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function app_private.validate_project_opening_lock()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_validate_project_opening_lock
  on public.project_opening_balances;
create trigger trg_validate_project_opening_lock
before update on public.project_opening_balances
for each row execute function app_private.validate_project_opening_lock();
alter table public.project_opening_balances
  enable always trigger trg_validate_project_opening_lock;

-- Preserve the reviewed A3.1 body byte-for-byte behind a fully-revoked name.
-- The new public entry point canonicalizes scope and establishes the protected
-- capability consumed by the source/catalog ALWAYS triggers.
alter function public.lock_project_opening_balance(jsonb)
  rename to lock_project_opening_balance_v1;

revoke all on function public.lock_project_opening_balance_v1(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.lock_project_opening_balance(
  p_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_command_id uuid;
  v_opening jsonb;
  v_lines jsonb;
  v_project_id text;
  v_requested_site_id text;
  v_requested_site_uuid uuid;
  v_project_site_uuid uuid;
  v_construction_site_id text;
  v_authoritative_scope_key text;
  v_supplied_scope_key text;
  v_target_warehouse_ids text[];
  v_warehouse_id text;
  v_canonical_command jsonb;
  v_result jsonb;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);

  if p_command is null or pg_catalog.jsonb_typeof(p_command) <> 'object' then
    raise exception 'opening balance command must be a JSON object'
      using errcode = '22023';
  end if;

  begin
    v_command_id := nullif(pg_catalog.btrim(p_command->>'commandId'), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'opening balance commandId must be a UUID'
        using errcode = '22023';
  end;
  if v_command_id is null then
    raise exception 'opening balance commandId is required'
      using errcode = '22023';
  end if;

  v_opening := p_command->'openingBalance';
  v_lines := p_command->'lines';
  if pg_catalog.jsonb_typeof(v_opening) <> 'object' then
    raise exception 'openingBalance must be a JSON object'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_lines) <> 'array'
     or pg_catalog.jsonb_array_length(v_lines) = 0 then
    raise exception 'opening balance lines must be a non-empty JSON array'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users actor_row
    where actor_row.id = v_actor
      and coalesce(actor_row.is_active, false)
  ) then
    raise exception 'active authentication is required'
      using errcode = '28000';
  end if;

  v_project_id := nullif(pg_catalog.btrim(v_opening->>'projectId'), '');
  v_requested_site_id := nullif(pg_catalog.btrim(v_opening->>'constructionSiteId'), '');
  v_supplied_scope_key := app_private.normalize_project_opening_scope_key(
    v_opening->>'scopeKey'
  );
  if v_project_id is null and v_requested_site_id is null then
    raise exception 'authoritative opening scope requires a project or construction site'
      using errcode = '22023';
  end if;

  if v_requested_site_id is not null then
    begin
      v_requested_site_uuid := v_requested_site_id::uuid;
    exception
      when invalid_text_representation then
        raise exception 'opening constructionSiteId must be a UUID'
          using errcode = '22023';
    end;
  end if;

  if v_project_id is not null then
    select project_row.construction_site_id
    into v_project_site_uuid
    from public.projects project_row
    where project_row.id = v_project_id;
    if not found then
      raise exception 'opening project does not exist: %', v_project_id
        using errcode = '23503';
    end if;
    if v_requested_site_id is not null
       and v_requested_site_uuid is distinct from v_project_site_uuid then
      raise exception 'opening project-site mismatch'
        using errcode = '23514';
    end if;
    v_construction_site_id := v_project_site_uuid::text;
  else
    select site_row.id
    into v_requested_site_uuid
    from public.hrm_construction_sites site_row
    where site_row.id = v_requested_site_uuid;
    if not found then
      raise exception 'opening construction site does not exist: %', v_requested_site_id
        using errcode = '23503';
    end if;
    v_construction_site_id := v_requested_site_uuid::text;
  end if;

  v_authoritative_scope_key := app_private.project_opening_authoritative_scope_key(
    v_project_id,
    v_construction_site_id
  );
  if v_supplied_scope_key is distinct from v_authoritative_scope_key then
    raise exception 'opening scopeKey does not match its authoritative project/site identity'
      using errcode = '23514';
  end if;

  v_canonical_command := p_command || pg_catalog.jsonb_build_object(
    'openingBalance',
    v_opening || pg_catalog.jsonb_build_object(
      'scopeKey', v_authoritative_scope_key,
      'projectId', v_project_id,
      'constructionSiteId', v_construction_site_id
    )
  );

  select pg_catalog.array_agg(target.id order by target.id)
  into v_target_warehouse_ids
  from (
    select distinct nullif(pg_catalog.btrim(input_line.value->>'warehouseId'), '') as id
    from pg_catalog.jsonb_array_elements(v_lines) input_line(value)
  ) target
  where target.id is not null;

  if coalesce(pg_catalog.cardinality(v_target_warehouse_ids), 0) = 0 then
    raise exception 'opening balance requires a target warehouse'
      using errcode = '22023';
  end if;

  foreach v_warehouse_id in array v_target_warehouse_ids
  loop
    if not app_private.wms_has_action(
      'wms.transaction.create',
      null,
      v_warehouse_id,
      null,
      null,
      v_actor
    ) then
      raise exception 'wms.transaction.create is required for %', v_warehouse_id
        using errcode = '42501';
    end if;
    if not app_private.wms_has_action(
      'wms.transaction.complete',
      null,
      v_warehouse_id,
      null,
      null,
      v_actor
    ) then
      raise exception 'wms.transaction.complete is required for %', v_warehouse_id
        using errcode = '42501';
    end if;
  end loop;

  insert into app_private.project_opening_call_contexts (
    backend_pid,
    transaction_xid,
    command_id,
    actor_id,
    target_warehouse_ids
  )
  values (
    pg_catalog.pg_backend_pid(),
    pg_catalog.txid_current(),
    v_command_id,
    v_actor,
    v_target_warehouse_ids
  );

  v_result := public.lock_project_opening_balance_v1(v_canonical_command);

  delete from app_private.project_opening_call_contexts call_context
  where call_context.backend_pid = pg_catalog.pg_backend_pid()
    and call_context.transaction_xid = pg_catalog.txid_current()
    and call_context.command_id = v_command_id
    and call_context.actor_id = v_actor;

  return v_result;
exception
  when others then
    delete from app_private.project_opening_call_contexts call_context
    where call_context.backend_pid = pg_catalog.pg_backend_pid()
      and call_context.transaction_xid = pg_catalog.txid_current()
      and call_context.command_id = v_command_id
      and call_context.actor_id = v_actor;
    raise;
end;
$$;

revoke all on function public.lock_project_opening_balance(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.lock_project_opening_balance(jsonb)
  to authenticated;
