-- Controlled, compensating reversal for A3.1 atomic project opening balances.
-- Posted WMS/ledger history remains immutable; this command writes only new
-- compensation documents and moves the protected opening document to `void`.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $project_opening_reversal_prerequisites$
begin
  if pg_catalog.to_regprocedure('public.lock_project_opening_balance(jsonb)') is null
     or pg_catalog.to_regprocedure('public.process_transaction_status(text,public.transaction_status,uuid)') is null
     or pg_catalog.to_regprocedure('app_private.project_has_permission_v2(text,text,text,uuid)') is null
     or pg_catalog.to_regprocedure('app_private.wms_has_action(text,text,text,uuid,uuid,uuid)') is null
     or pg_catalog.to_regprocedure('app_private.authorize_project_opening_write(uuid,jsonb,jsonb)') is null
     or pg_catalog.to_regprocedure('app_private.wms_transaction_intent(public.transactions)') is null
     or pg_catalog.to_regclass('app_private.project_opening_call_contexts') is null then
    raise exception 'controlled project opening reversal prerequisites are missing'
      using errcode = '55000';
  end if;
end;
$project_opening_reversal_prerequisites$;

alter table public.project_opening_balances
  add column if not exists reversal_command_id uuid,
  add column if not exists reversal_request_hash text,
  add column if not exists reversed_by text,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversal_reason text,
  add column if not exists reversal_stock_transaction_ids jsonb not null default '[]'::jsonb,
  add column if not exists reversal_material_project_transaction_id text;

create unique index if not exists project_opening_balances_reversal_command_uidx
  on public.project_opening_balances(reversal_command_id)
  where reversal_command_id is not null;

comment on column public.project_opening_balances.reversal_command_id is
  'Idempotency identity of the controlled compensating reversal.';
comment on column public.project_opening_balances.reversal_request_hash is
  'SHA-256 of the canonical reversal request excluding commandId.';
comment on column public.project_opening_balances.reversal_stock_transaction_ids is
  'Deterministic compensating WMS transactions. Original transaction IDs remain in stock_transaction_ids.';

create table app_private.project_opening_reversal_results (
  command_id uuid primary key,
  opening_balance_id uuid not null unique
    references public.project_opening_balances(id) on delete restrict,
  actor_id uuid not null,
  request_hash text not null check (pg_catalog.btrim(request_hash) <> ''),
  reason text not null check (pg_catalog.btrim(reason) <> ''),
  finance_before jsonb not null check (pg_catalog.jsonb_typeof(finance_before) = 'object'),
  finance_after jsonb not null check (pg_catalog.jsonb_typeof(finance_after) = 'object'),
  stock_transaction_map jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(stock_transaction_map) = 'array'),
  material_transaction_map jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(material_transaction_map) = 'object'),
  result jsonb not null check (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on table app_private.project_opening_reversal_results
  from public, anon, authenticated, service_role;
revoke truncate on table app_private.project_opening_reversal_results
  from public, anon, authenticated, service_role;

create unlogged table app_private.project_opening_reversal_write_authorizations (
  id uuid primary key default gen_random_uuid(),
  backend_pid integer not null,
  transaction_xid bigint not null,
  target_key uuid not null,
  expected_before jsonb not null,
  expected_after jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index project_opening_reversal_write_authorizations_lookup_idx
  on app_private.project_opening_reversal_write_authorizations(
    backend_pid, transaction_xid, target_key, created_at
  );

revoke all on table app_private.project_opening_reversal_write_authorizations
  from public, anon, authenticated, service_role;
revoke truncate on table app_private.project_opening_reversal_write_authorizations
  from public, anon, authenticated, service_role;

create or replace function app_private.authorize_project_opening_reversal_write(
  p_target_key uuid,
  p_expected_before jsonb,
  p_expected_after jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_target_key is null or p_expected_before is null or p_expected_after is null then
    raise exception 'project opening reversal authorization requires exact row images'
      using errcode = '22023';
  end if;

  insert into app_private.project_opening_reversal_write_authorizations(
    backend_pid, transaction_xid, target_key, expected_before, expected_after
  )
  values (
    pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), p_target_key,
    p_expected_before, p_expected_after
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function app_private.authorize_project_opening_reversal_write(uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role;

-- A separate capability prevents a different owner-level function or direct
-- Data API insert from spoofing the reserved reversal source identity.
create unlogged table app_private.project_opening_reversal_source_authorizations (
  id uuid primary key default gen_random_uuid(),
  backend_pid integer not null,
  transaction_xid bigint not null,
  transaction_id text not null,
  source_id text not null,
  warehouse_id text not null,
  actor_id uuid not null,
  items_hash text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index project_opening_reversal_source_authorizations_lookup_idx
  on app_private.project_opening_reversal_source_authorizations(
    backend_pid, transaction_xid, transaction_id, source_id, created_at
  );

revoke all on table app_private.project_opening_reversal_source_authorizations
  from public, anon, authenticated, service_role;
revoke truncate on table app_private.project_opening_reversal_source_authorizations
  from public, anon, authenticated, service_role;

create or replace function app_private.authorize_project_opening_reversal_source(
  p_transaction_id text,
  p_source_id text,
  p_warehouse_id text,
  p_actor_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(pg_catalog.btrim(p_transaction_id), '') is null
     or nullif(pg_catalog.btrim(p_source_id), '') is null
     or nullif(pg_catalog.btrim(p_warehouse_id), '') is null
     or p_actor_id is null
     or pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid project opening reversal source authorization'
      using errcode = '22023';
  end if;

  insert into app_private.project_opening_reversal_source_authorizations(
    backend_pid, transaction_xid, transaction_id, source_id,
    warehouse_id, actor_id, items_hash
  )
  values (
    pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), p_transaction_id,
    p_source_id, p_warehouse_id, p_actor_id,
    app_private.sha256_text(p_items::text)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function app_private.authorize_project_opening_reversal_source(text,text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;

do $project_opening_reversal_source_preflight$
declare
  v_invalid text;
  v_duplicates text;
begin
  select pg_catalog.string_agg(transaction_row.id, ', ' order by transaction_row.id)
  into v_invalid
  from public.transactions transaction_row
  where transaction_row.source_type = 'project_opening_balance_reversal'
    and (
      nullif(pg_catalog.btrim(transaction_row.source_id), '') is null
      or transaction_row.posting_engine_version is distinct from 'wf001-opening-reversal-v1'
    );
  if v_invalid is not null then
    raise exception 'invalid project opening reversal source preflight failed: %', v_invalid
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
    where transaction_row.source_type = 'project_opening_balance_reversal'
    group by transaction_row.source_id
    having pg_catalog.count(*) > 1
  ) duplicate_source;
  if v_duplicates is not null then
    raise exception 'duplicate project opening reversal source preflight failed: %', v_duplicates
      using errcode = '23505';
  end if;
end;
$project_opening_reversal_source_preflight$;

create unique index transactions_project_opening_reversal_source_uidx
  on public.transactions(source_type, source_id)
  where source_type = 'project_opening_balance_reversal';

create or replace function app_private.guard_project_opening_reversal_source()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization_id uuid;
  v_actor uuid := public.current_app_user_id();
begin
  if tg_op = 'UPDATE'
     and old.source_type = 'project_opening_balance_reversal' then
    if new.id is distinct from old.id
       or new.source_type is distinct from old.source_type
       or new.source_id is distinct from old.source_id
       or new.type is distinct from old.type
       or new.target_warehouse_id is distinct from old.target_warehouse_id
       or new.items is distinct from old.items
       or new.posting_engine_version is distinct from old.posting_engine_version then
      raise exception 'reserved project opening reversal source is immutable'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if new.source_type is distinct from 'project_opening_balance_reversal' then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'reserved project opening reversal source cannot be reassigned'
      using errcode = '55000';
  end if;
  if new.posting_engine_version is distinct from 'wf001-opening-reversal-v1'
     or new.status::text <> 'PENDING'
     or new.type::text <> 'ADJUSTMENT'
     or new.source_warehouse_id is not null
     or nullif(pg_catalog.btrim(new.target_warehouse_id), '') is null
     or new.requester_id is distinct from v_actor
     or new.created_by is distinct from v_actor then
    raise exception 'reserved project opening reversal source requires the controlled PENDING adjustment path'
      using errcode = '42501';
  end if;

  delete from app_private.project_opening_reversal_source_authorizations auth_row
  where auth_row.id = (
    select candidate.id
    from app_private.project_opening_reversal_source_authorizations candidate
    where candidate.backend_pid = pg_catalog.pg_backend_pid()
      and candidate.transaction_xid = pg_catalog.txid_current()
      and candidate.transaction_id = new.id
      and candidate.source_id = new.source_id
      and candidate.warehouse_id = new.target_warehouse_id
      and candidate.actor_id = v_actor
      and candidate.items_hash = app_private.sha256_text(new.items::text)
    order by candidate.created_at, candidate.id
    limit 1
    for update
  )
  returning auth_row.id into v_authorization_id;

  if v_authorization_id is null then
    raise exception 'reserved project opening reversal source requires a one-use command capability'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_project_opening_reversal_source()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_project_opening_reversal_source on public.transactions;
create trigger trg_guard_project_opening_reversal_source
before insert or update on public.transactions
for each row execute function app_private.guard_project_opening_reversal_source();
alter table public.transactions
  enable always trigger trg_guard_project_opening_reversal_source;

create unlogged table app_private.project_opening_reversal_material_authorizations (
  id uuid primary key default gen_random_uuid(),
  backend_pid integer not null,
  transaction_xid bigint not null,
  project_transaction_id text not null,
  source_ref text not null,
  project_finance_id text not null,
  actor_id uuid not null,
  amount numeric not null check (amount < 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on table app_private.project_opening_reversal_material_authorizations
  from public, anon, authenticated, service_role;
revoke truncate on table app_private.project_opening_reversal_material_authorizations
  from public, anon, authenticated, service_role;

create or replace function app_private.authorize_project_opening_reversal_material(
  p_project_transaction_id text,
  p_source_ref text,
  p_project_finance_id text,
  p_actor_id uuid,
  p_amount numeric
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(pg_catalog.btrim(p_project_transaction_id), '') is null
     or nullif(pg_catalog.btrim(p_source_ref), '') is null
     or nullif(pg_catalog.btrim(p_project_finance_id), '') is null
     or p_actor_id is null
     or p_amount >= 0 then
    raise exception 'invalid opening reversal material authorization'
      using errcode = '22023';
  end if;
  insert into app_private.project_opening_reversal_material_authorizations(
    backend_pid, transaction_xid, project_transaction_id, source_ref,
    project_finance_id, actor_id, amount
  )
  values (
    pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), p_project_transaction_id,
    p_source_ref, p_project_finance_id, p_actor_id, p_amount
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function app_private.authorize_project_opening_reversal_material(text,text,text,uuid,numeric)
  from public, anon, authenticated, service_role;

-- Freeze both sides of the material lineage while grandfathered rows are
-- validated and the effective dual-alias source identity becomes unique.
lock table public.project_transactions in share row exclusive mode;
lock table public.project_opening_balances in share row exclusive mode;

do $project_opening_material_source_preflight$
begin
  if exists (
    select 1
    from public.project_transactions project_transaction
    where (
      coalesce(project_transaction.source_ref like 'opening_balance:%:materials', false)
      or coalesce(project_transaction."sourceRef" like 'opening_balance:%:materials', false)
      or coalesce(project_transaction.source_ref like 'opening_balance_reversal:%:materials', false)
      or coalesce(project_transaction."sourceRef" like 'opening_balance_reversal:%:materials', false)
    )
      and project_transaction.source_ref is distinct from project_transaction."sourceRef"
  ) then
    raise exception 'reserved project opening material source aliases must match before reversal deployment'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.project_transactions project_transaction
    left join public.project_opening_balances opening
      on opening.material_project_transaction_id = project_transaction.id
     and opening.status = 'locked'
     and opening.posting_engine_version = 'wf001-opening-v1'
    where project_transaction.source_ref like 'opening_balance:%:materials'
      and (
        opening.id is null
        or project_transaction.id is distinct from 'opening-material:' || opening.id::text
        or project_transaction.source_ref is distinct from
          'opening_balance:' || opening.id::text || ':materials'
        or project_transaction.type is distinct from 'expense'
        or project_transaction.category is distinct from 'materials'
        or project_transaction.amount is distinct from opening.recognized_value
        or project_transaction.amount <= 0
        or coalesce(project_transaction.project_finance_id, project_transaction."projectFinanceId")
          is distinct from opening.project_finance_id
        or project_transaction.project_id is distinct from opening.project_id
        or project_transaction.construction_site_id is distinct from opening.construction_site_id
      )
  ) then
    raise exception 'existing project opening material source has invalid positive lineage'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.project_transactions project_transaction
    where project_transaction.source_ref like 'opening_balance_reversal:%:materials'
      and (
        project_transaction.type is distinct from 'expense'
        or project_transaction.category is distinct from 'materials'
        or project_transaction.amount >= 0
      )
  ) then
    raise exception 'existing project opening reversal material source has invalid negative lineage'
      using errcode = '55000';
  end if;

  if exists (
    select coalesce(project_transaction.source_ref, project_transaction."sourceRef")
    from public.project_transactions project_transaction
    where coalesce(project_transaction.source_ref, project_transaction."sourceRef")
      like 'opening_balance:%:materials'
       or coalesce(project_transaction.source_ref, project_transaction."sourceRef")
      like 'opening_balance_reversal:%:materials'
    group by coalesce(project_transaction.source_ref, project_transaction."sourceRef")
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'duplicate project opening material source identity exists'
      using errcode = '23505';
  end if;
end;
$project_opening_material_source_preflight$;

create unique index if not exists project_transactions_opening_material_source_uidx
  on public.project_transactions ((coalesce(source_ref, "sourceRef")))
  where coalesce(source_ref like 'opening_balance:%:materials', false)
     or coalesce("sourceRef" like 'opening_balance:%:materials', false)
     or coalesce(source_ref like 'opening_balance_reversal:%:materials', false)
     or coalesce("sourceRef" like 'opening_balance_reversal:%:materials', false);

create or replace function app_private.guard_project_opening_reversal_material_source()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization_id uuid;
  v_source_ref text;
  v_project_finance_id text;
  v_actor uuid := public.current_app_user_id();
  v_opening_id uuid;
  v_has_context boolean := false;
  v_old_is_original boolean := false;
  v_old_is_reversal boolean := false;
  v_new_is_original boolean := false;
  v_new_is_reversal boolean := false;
begin
  if tg_op = 'DELETE' then
    v_old_is_original := coalesce(old.source_ref like 'opening_balance:%:materials', false)
      or coalesce(old."sourceRef" like 'opening_balance:%:materials', false);
    v_old_is_reversal := coalesce(old.source_ref like 'opening_balance_reversal:%:materials', false)
      or coalesce(old."sourceRef" like 'opening_balance_reversal:%:materials', false);
    if v_old_is_original or v_old_is_reversal then
      raise exception 'project opening reversal material evidence is immutable'
        using errcode = '55000';
    end if;
    return old;
  end if;

  v_new_is_original := coalesce(new.source_ref like 'opening_balance:%:materials', false)
    or coalesce(new."sourceRef" like 'opening_balance:%:materials', false);
  v_new_is_reversal := coalesce(new.source_ref like 'opening_balance_reversal:%:materials', false)
    or coalesce(new."sourceRef" like 'opening_balance_reversal:%:materials', false);
  if (v_new_is_original or v_new_is_reversal)
     and new.source_ref is distinct from new."sourceRef" then
    raise exception 'project opening material source aliases must match'
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    v_old_is_original := coalesce(old.source_ref like 'opening_balance:%:materials', false)
      or coalesce(old."sourceRef" like 'opening_balance:%:materials', false);
    v_old_is_reversal := coalesce(old.source_ref like 'opening_balance_reversal:%:materials', false)
      or coalesce(old."sourceRef" like 'opening_balance_reversal:%:materials', false);
    if (v_old_is_original or v_old_is_reversal)
       and pg_catalog.to_jsonb(old) is distinct from pg_catalog.to_jsonb(new) then
      raise exception 'project opening reversal material evidence is immutable'
        using errcode = '55000';
    end if;
    if not (v_new_is_original or v_new_is_reversal) then
      return new;
    end if;
    raise exception 'project opening material source cannot be reassigned'
      using errcode = '55000';
  end if;
  if not (v_new_is_original or v_new_is_reversal) then
    return new;
  end if;

  v_source_ref := new.source_ref;
  v_project_finance_id := coalesce(new.project_finance_id, new."projectFinanceId");

  if v_new_is_original then
    begin
      v_opening_id := pg_catalog.split_part(v_source_ref, ':', 2)::uuid;
    exception
      when invalid_text_representation then
        raise exception 'reserved project opening material source contains an invalid opening identity'
          using errcode = '22023';
    end;
    if v_source_ref is distinct from 'opening_balance:' || v_opening_id::text || ':materials'
       or new.id is distinct from 'opening-material:' || v_opening_id::text
       or new.type is distinct from 'expense'
       or new.category is distinct from 'materials'
       or new.amount <= 0
       or new.source is distinct from 'import'
       or new."createdBy" is distinct from v_actor::text
       or new.project_finance_id is distinct from new."projectFinanceId"
       or nullif(v_project_finance_id, '') is null then
      raise exception 'reserved project opening material source requires the controlled positive expense path'
        using errcode = '42501';
    end if;

    select true
    into v_has_context
    from app_private.project_opening_call_contexts call_context
    where call_context.backend_pid = pg_catalog.pg_backend_pid()
      and call_context.transaction_xid = pg_catalog.txid_current()
      and call_context.actor_id = v_actor
      and exists (
        select 1
        from public.project_opening_balances opening
        join public.project_finances finance on finance.id = v_project_finance_id
        where opening.id = v_opening_id
          and opening.status = 'draft'
          and opening.recognized_value = new.amount
          and opening.created_by = v_actor::text
          and opening.project_id is not distinct from new.project_id
          and opening.construction_site_id is not distinct from new.construction_site_id
          and finance.project_id is not distinct from opening.project_id
          and nullif(coalesce(finance.construction_site_id, finance."constructionSiteId"), '')
            is not distinct from opening.construction_site_id
      )
      and not exists (
        select 1
        from public.project_opening_balance_lines line
        where line.opening_balance_id = v_opening_id
          and line.remaining_qty > 0
          and not (line.warehouse_id = any(call_context.target_warehouse_ids))
      )
    limit 1
    for update;

    if not coalesce(v_has_context, false) then
      raise exception 'reserved project opening material source requires an active opening command capability'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.type is distinct from 'expense'
     or new.category is distinct from 'materials'
     or new.amount >= 0
     or new."createdBy" is distinct from v_actor::text then
    raise exception 'reserved opening reversal material source requires a controlled negative expense'
      using errcode = '42501';
  end if;

  delete from app_private.project_opening_reversal_material_authorizations auth_row
  where auth_row.id = (
    select candidate.id
    from app_private.project_opening_reversal_material_authorizations candidate
    where candidate.backend_pid = pg_catalog.pg_backend_pid()
      and candidate.transaction_xid = pg_catalog.txid_current()
      and candidate.project_transaction_id = new.id
      and candidate.source_ref = v_source_ref
      and candidate.project_finance_id = v_project_finance_id
      and candidate.actor_id = v_actor
      and candidate.amount = new.amount
    order by candidate.created_at, candidate.id
    limit 1
    for update
  )
  returning auth_row.id into v_authorization_id;
  if v_authorization_id is null then
    raise exception 'reserved opening reversal material source requires a one-use command capability'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_project_opening_reversal_material_source()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_project_opening_reversal_material_source
  on public.project_transactions;
create trigger trg_guard_project_opening_reversal_material_source
before insert or update or delete on public.project_transactions
for each row execute function app_private.guard_project_opening_reversal_material_source();
alter table public.project_transactions
  enable always trigger trg_guard_project_opening_reversal_material_source;

-- Preserve the original draft->locked capability while adding exactly one
-- protected locked->void transition. Content and child lines stay immutable.
create or replace function app_private.guard_locked_project_opening_balance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorization_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'direct opening balance lock is forbidden; use lock_project_opening_balance'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'locked' then
    if tg_op = 'UPDATE' and new.status = 'void' then
      delete from app_private.project_opening_reversal_write_authorizations auth_row
      where auth_row.id = (
        select candidate.id
        from app_private.project_opening_reversal_write_authorizations candidate
        where candidate.backend_pid = pg_catalog.pg_backend_pid()
          and candidate.transaction_xid = pg_catalog.txid_current()
          and candidate.target_key = old.id
          and candidate.expected_before = pg_catalog.to_jsonb(old)
          and candidate.expected_after = pg_catalog.to_jsonb(new)
        order by candidate.created_at, candidate.id
        limit 1
        for update
      )
      returning auth_row.id into v_authorization_id;
      if v_authorization_id is null then
        raise exception 'locked opening balance can be voided only by reverse_project_opening_balance'
          using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'locked opening balance content is immutable; use a controlled reversal business path'
      using errcode = '55000';
  end if;

  if old.status = 'void' then
    raise exception 'void opening balance content is immutable'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if old.status is not distinct from new.status then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'locked' then
    delete from app_private.project_opening_write_authorizations auth_row
    where auth_row.id = (
      select candidate.id
      from app_private.project_opening_write_authorizations candidate
      where candidate.backend_pid = pg_catalog.pg_backend_pid()
        and candidate.transaction_xid = pg_catalog.txid_current()
        and candidate.write_kind = 'lock'
        and candidate.target_key = old.id
        and candidate.expected_before = pg_catalog.to_jsonb(old)
        and candidate.expected_after = pg_catalog.to_jsonb(new)
      order by candidate.created_at, candidate.id
      limit 1
      for update
    )
    returning auth_row.id into v_authorization_id;
    if v_authorization_id is null then
      raise exception 'direct opening balance lock is forbidden; use lock_project_opening_balance'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'opening balance status transitions require a controlled business path'
    using errcode = '42501';
end;
$$;

revoke all on function app_private.guard_locked_project_opening_balance()
  from public, anon, authenticated, service_role;
alter table public.project_opening_balances
  enable always trigger trg_guard_locked_project_opening_balance;

create or replace function app_private.project_opening_reversal_finance_snapshot(
  p_finance public.project_finances
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_finance.id,
    'projectId', p_finance.project_id,
    'constructionSiteId', nullif(coalesce(p_finance.construction_site_id, p_finance."constructionSiteId"), ''),
    'contractValue', p_finance."contractValue",
    'progressPercent', p_finance."progressPercent",
    'status', p_finance.status,
    'notes', p_finance.notes,
    'updatedAt', pg_catalog.to_jsonb(p_finance."updatedAt")
  );
$$;

revoke all on function app_private.project_opening_reversal_finance_snapshot(public.project_finances)
  from public, anon, authenticated, service_role;

-- A single lock primitive keeps permission checks and posting on the same
-- sorted warehouse row set. Missing or archived rows are detected by the
-- caller by comparing the returned cardinality with the authoritative lines.
create or replace function app_private.lock_project_opening_reversal_warehouses(
  p_opening_balance_id uuid
)
returns setof text
language sql
volatile
security definer
set search_path = ''
as $$
  select warehouse.id
  from public.warehouses warehouse
  join (
    select distinct line.warehouse_id
    from public.project_opening_balance_lines line
    where line.opening_balance_id = p_opening_balance_id
      and line.remaining_qty > 0
  ) affected_warehouse on affected_warehouse.warehouse_id = warehouse.id
  where not coalesce(warehouse.is_archived, false)
  order by warehouse.id
  for update of warehouse;
$$;

revoke all on function app_private.lock_project_opening_reversal_warehouses(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.reverse_project_opening_balance(
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
  v_actor_row public.users%rowtype;
  v_command_id uuid;
  v_opening_balance_id uuid;
  v_reason text;
  v_expected_input jsonb;
  v_corrected_input jsonb;
  v_expected_finance_id text;
  v_corrected_finance_id text;
  v_expected_project_id text;
  v_corrected_project_id text;
  v_expected_site_id text;
  v_corrected_site_id text;
  v_expected_contract_value numeric;
  v_corrected_contract_value numeric;
  v_expected_progress_percent numeric;
  v_corrected_progress_percent numeric;
  v_expected_status text;
  v_corrected_status text;
  v_expected_notes text;
  v_corrected_notes text;
  v_expected_updated_at timestamptz;
  v_expected_finance_snapshot jsonb;
  v_corrected_finance_snapshot jsonb;
  v_canonical_request jsonb;
  v_request_hash text;
  v_scope_key text;
  v_opening public.project_opening_balances%rowtype;
  v_opening_before public.project_opening_balances%rowtype;
  v_authorized_opening public.project_opening_balances%rowtype;
  v_command_result app_private.project_opening_reversal_results%rowtype;
  v_other_result app_private.project_opening_reversal_results%rowtype;
  v_finance public.project_finances%rowtype;
  v_finance_before jsonb;
  v_finance_after jsonb;
  v_original_transaction public.transactions%rowtype;
  v_reversal_transaction public.transactions%rowtype;
  v_posted_transaction public.transactions%rowtype;
  v_original_material public.project_transactions%rowtype;
  v_reversal_material public.project_transactions%rowtype;
  v_warehouse_id text;
  v_item_id text;
  v_original_transaction_id text;
  v_reversal_transaction_id text;
  v_transaction_source_id text;
  v_original_inventory_transaction_id uuid;
  v_transaction_items jsonb;
  v_transaction_hash text;
  v_stock_transaction_ids jsonb := '[]'::jsonb;
  v_stock_transaction_map jsonb := '[]'::jsonb;
  v_material_transaction_map jsonb := '{}'::jsonb;
  v_reversal_material_id text;
  v_material_source_ref text;
  v_cache_qty numeric;
  v_balance_qty numeric;
  v_expected_qty numeric;
  v_reserved_transaction_qty numeric;
  v_reserved_request_qty numeric;
  v_reserved_qty numeric;
  v_available_qty numeric;
  v_lineage_count bigint;
  v_warehouse_count bigint;
  v_locked_warehouse_count bigint;
  v_revalidated_warehouse_count bigint;
  v_saved_result jsonb;
  v_now timestamptz;
  v_record record;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);

  if p_command is null or pg_catalog.jsonb_typeof(p_command) <> 'object' then
    raise exception 'project opening reversal command must be a JSON object'
      using errcode = '22023';
  end if;
  begin
    v_command_id := nullif(pg_catalog.btrim(p_command->>'commandId'), '')::uuid;
    v_opening_balance_id := nullif(pg_catalog.btrim(p_command->>'openingBalanceId'), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'reversal commandId and openingBalanceId must be UUID values'
        using errcode = '22023';
  end;
  if v_command_id is null or v_opening_balance_id is null then
    raise exception 'reversal commandId and openingBalanceId are required'
      using errcode = '22023';
  end if;

  v_reason := nullif(pg_catalog.btrim(p_command->>'reason'), '');
  if v_reason is null then
    raise exception 'project opening reversal reason is required'
      using errcode = '22023';
  end if;
  if pg_catalog.length(v_reason) > 2000 then
    raise exception 'project opening reversal reason is too long'
      using errcode = '22023';
  end if;

  v_expected_input := p_command->'expectedFinanceSnapshot';
  v_corrected_input := p_command->'correctedFinanceSnapshot';
  if pg_catalog.jsonb_typeof(v_expected_input) <> 'object'
     or not (v_expected_input ?& array[
       'id', 'projectId', 'constructionSiteId', 'contractValue',
       'progressPercent', 'status', 'notes', 'updatedAt'
     ]) then
    raise exception 'expectedFinanceSnapshot must be a complete finance snapshot'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_corrected_input) <> 'object'
     or not (v_corrected_input ?& array[
       'id', 'projectId', 'constructionSiteId', 'contractValue',
       'progressPercent', 'status', 'notes'
     ]) then
    raise exception 'correctedFinanceSnapshot must explicitly provide the corrected finance state'
      using errcode = '22023';
  end if;

  v_expected_finance_id := nullif(pg_catalog.btrim(v_expected_input->>'id'), '');
  v_corrected_finance_id := nullif(pg_catalog.btrim(v_corrected_input->>'id'), '');
  v_expected_project_id := nullif(pg_catalog.btrim(v_expected_input->>'projectId'), '');
  v_corrected_project_id := nullif(pg_catalog.btrim(v_corrected_input->>'projectId'), '');
  v_expected_site_id := nullif(pg_catalog.btrim(v_expected_input->>'constructionSiteId'), '');
  v_corrected_site_id := nullif(pg_catalog.btrim(v_corrected_input->>'constructionSiteId'), '');
  v_expected_status := nullif(pg_catalog.btrim(v_expected_input->>'status'), '');
  v_corrected_status := nullif(pg_catalog.btrim(v_corrected_input->>'status'), '');
  v_expected_notes := v_expected_input->>'notes';
  v_corrected_notes := v_corrected_input->>'notes';
  begin
    v_expected_contract_value := app_private.parse_project_opening_nonnegative_numeric(
      v_expected_input->>'contractValue', 'expectedFinanceSnapshot.contractValue'
    );
    v_corrected_contract_value := app_private.parse_project_opening_nonnegative_numeric(
      v_corrected_input->>'contractValue', 'correctedFinanceSnapshot.contractValue'
    );
    v_expected_progress_percent := app_private.parse_project_opening_nonnegative_numeric(
      v_expected_input->>'progressPercent', 'expectedFinanceSnapshot.progressPercent'
    );
    v_corrected_progress_percent := app_private.parse_project_opening_nonnegative_numeric(
      v_corrected_input->>'progressPercent', 'correctedFinanceSnapshot.progressPercent'
    );
    v_expected_updated_at := nullif(pg_catalog.btrim(v_expected_input->>'updatedAt'), '')::timestamptz;
  exception
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'project opening reversal finance snapshot contains an invalid value'
        using errcode = '22023';
  end;
  if v_expected_finance_id is null or v_corrected_finance_id is null
     or v_expected_updated_at is null
     or v_expected_status is null or v_corrected_status is null
     or v_expected_progress_percent > 100 or v_corrected_progress_percent > 100 then
    raise exception 'project opening reversal finance snapshot is incomplete or outside the accepted range'
      using errcode = '22023';
  end if;
  if not (v_expected_status = any(array[
       'planning', 'active', 'paused', 'completed'
     ]::text[]))
     or not (v_corrected_status = any(array[
       'planning', 'active', 'paused', 'completed'
     ]::text[])) then
    raise exception 'project opening reversal finance status is outside the ProjectStatus domain'
      using errcode = '22023';
  end if;
  if v_expected_finance_id is distinct from v_corrected_finance_id
     or v_expected_project_id is distinct from v_corrected_project_id
     or v_expected_site_id is distinct from v_corrected_site_id then
    raise exception 'expected and corrected finance snapshots must identify the same project/site row'
      using errcode = '22023';
  end if;

  v_expected_finance_snapshot := pg_catalog.jsonb_build_object(
    'id', v_expected_finance_id,
    'projectId', v_expected_project_id,
    'constructionSiteId', v_expected_site_id,
    'contractValue', v_expected_contract_value,
    'progressPercent', v_expected_progress_percent,
    'status', v_expected_status,
    'notes', v_expected_notes,
    'updatedAt', pg_catalog.to_jsonb(v_expected_updated_at)
  );
  v_corrected_finance_snapshot := pg_catalog.jsonb_build_object(
    'id', v_corrected_finance_id,
    'projectId', v_corrected_project_id,
    'constructionSiteId', v_corrected_site_id,
    'contractValue', v_corrected_contract_value,
    'progressPercent', v_corrected_progress_percent,
    'status', v_corrected_status,
    'notes', v_corrected_notes
  );
  v_canonical_request := pg_catalog.jsonb_build_object(
    'openingBalanceId', v_opening_balance_id,
    'reason', v_reason,
    'expectedFinanceSnapshot', v_expected_finance_snapshot,
    'correctedFinanceSnapshot', v_corrected_finance_snapshot
  );
  v_request_hash := app_private.sha256_text(v_canonical_request::text);

  -- Read only the immutable identity needed to enter the scope lock. The row
  -- is re-read FOR UPDATE after the scope and command advisory locks.
  select * into v_opening
  from public.project_opening_balances opening
  where opening.id = v_opening_balance_id;
  if not found then
    raise exception 'project opening balance not found: %', v_opening_balance_id
      using errcode = 'P0002';
  end if;
  v_scope_key := app_private.normalize_project_opening_scope_key(v_opening.scope_key);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('project-opening-scope:' || v_scope_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('project-opening-reversal-command:' || v_command_id::text, 0)
  );

  select * into strict v_opening
  from public.project_opening_balances opening
  where opening.id = v_opening_balance_id
  for update;
  if app_private.normalize_project_opening_scope_key(v_opening.scope_key)
       is distinct from v_scope_key then
    raise exception 'project opening scope changed while the reversal command was waiting'
      using errcode = '40001';
  end if;

  select * into v_actor_row
  from public.users actor_row
  where actor_row.id = v_actor;
  if not found then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;
  if not coalesce(v_actor_row.is_active, false) then
    raise exception 'inactive user cannot reverse a project opening balance'
      using errcode = '42501';
  end if;
  if not app_private.project_has_permission_v2(
    v_opening.project_id,
    v_opening.construction_site_id,
    'project.budget.manage',
    v_actor
  ) then
    raise exception 'project.budget.manage is required to reverse this opening balance'
      using errcode = '42501';
  end if;

  -- Every affected warehouse must still exist and the current actor must hold
  -- both create and complete capabilities, including on exact command replay.
  select pg_catalog.count(distinct line.warehouse_id)
  into v_warehouse_count
  from public.project_opening_balance_lines line
  where line.opening_balance_id = v_opening.id
    and line.remaining_qty > 0;
  v_locked_warehouse_count := 0;
  for v_warehouse_id in
    select locked_warehouse.warehouse_id
    from app_private.lock_project_opening_reversal_warehouses(v_opening.id)
      as locked_warehouse(warehouse_id)
  loop
    v_locked_warehouse_count := v_locked_warehouse_count + 1;
    if not app_private.wms_has_action(
      'wms.transaction.create', null, v_warehouse_id,
      null, null, v_actor
    ) then
      raise exception 'wms.transaction.create is required for %', v_warehouse_id
        using errcode = '42501';
    end if;
    if not app_private.wms_has_action(
      'wms.transaction.complete', null, v_warehouse_id,
      null, null, v_actor
    ) then
      raise exception 'wms.transaction.complete is required for %', v_warehouse_id
        using errcode = '42501';
    end if;
  end loop;
  if v_locked_warehouse_count is distinct from v_warehouse_count then
    raise exception 'opening reversal warehouse set changed while locked or contains a missing/archived warehouse'
      using errcode = '40001';
  end if;

  select * into v_command_result
  from app_private.project_opening_reversal_results command_result
  where command_result.command_id = v_command_id;
  if found then
    if v_command_result.opening_balance_id is distinct from v_opening.id
       or v_command_result.request_hash is distinct from v_request_hash then
      raise exception 'project opening reversal commandId was reused with different content'
        using errcode = '22023';
    end if;
    if v_command_result.actor_id is distinct from v_actor then
      raise exception 'cross-actor project opening reversal retry is forbidden'
        using errcode = '42501';
    end if;
    if v_opening.status <> 'void'
       or v_opening.reversal_command_id is distinct from v_command_id
       or v_opening.reversal_request_hash is distinct from v_request_hash then
      raise exception 'project opening reversal result exists but document state is inconsistent'
        using errcode = '55000';
    end if;
    return v_command_result.result;
  end if;

  select * into v_other_result
  from app_private.project_opening_reversal_results command_result
  where command_result.opening_balance_id = v_opening.id;
  if found or v_opening.status = 'void' then
    raise exception 'project opening balance is already reversed by another command'
      using errcode = '55000';
  end if;
  if v_opening.status <> 'locked'
     or v_opening.posting_engine_version is distinct from 'wf001-opening-v1' then
    raise exception 'only a locked wf001-opening-v1 document can be reversed; quarantine legacy lineage for reconciliation'
      using errcode = '55000';
  end if;
  if v_opening.lock_command_id is null
     or nullif(v_opening.lock_request_hash, '') is null
     or nullif(v_opening.project_finance_id, '') is null
     or nullif(v_opening.locked_by, '') is null
     or v_opening.locked_at is null then
    raise exception 'project opening lineage is incomplete; quarantine it for reconciliation'
      using errcode = '55000';
  end if;
  if v_expected_finance_id is distinct from v_opening.project_finance_id
     or v_expected_project_id is distinct from v_opening.project_id
     or v_expected_site_id is distinct from v_opening.construction_site_id then
    raise exception 'finance snapshots do not belong to the locked opening project/site'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(v_opening.stock_transaction_ids) is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_opening.reversal_stock_transaction_ids) is distinct from 'array' then
    raise exception 'project opening WMS lineage is malformed; use reconciliation'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
      and line.inventory_item_id is null
  ) then
    raise exception 'project opening line is missing inventory lineage; use reconciliation'
      using errcode = '55000';
  end if;

  select pg_catalog.count(distinct line.warehouse_id)
  into v_warehouse_count
  from public.project_opening_balance_lines line
  where line.opening_balance_id = v_opening.id
    and line.remaining_qty > 0;
  select pg_catalog.count(distinct source_id.value)
  into v_lineage_count
  from pg_catalog.jsonb_array_elements_text(v_opening.stock_transaction_ids) source_id(value);
  if pg_catalog.jsonb_array_length(v_opening.stock_transaction_ids) <> v_warehouse_count
     or v_lineage_count <> v_warehouse_count
     or pg_catalog.jsonb_array_length(v_opening.reversal_stock_transaction_ids) <> 0
     or v_opening.reversal_material_project_transaction_id is not null
     or v_opening.reversal_command_id is not null
     or v_opening.reversal_request_hash is not null then
    raise exception 'project opening compensation lineage is incomplete or already populated; use reconciliation'
      using errcode = '55000';
  end if;

  -- Reserve all original and compensating WMS business/source identities,
  -- then every transaction identity, before any item row is locked.
  for v_warehouse_id in
    select distinct line.warehouse_id
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
    order by line.warehouse_id
  loop
    v_transaction_source_id := v_opening.id::text || ':' || v_warehouse_id;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'wms-source:project_opening_balance:' || v_transaction_source_id, 0
      )
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'wms-source:project_opening_balance_reversal:' || v_transaction_source_id, 0
      )
    );
  end loop;
  for v_warehouse_id in
    select distinct line.warehouse_id
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
    order by line.warehouse_id
  loop
    v_original_transaction_id := 'opening-balance:' || v_opening.id::text || ':'
      || pg_catalog.left(app_private.sha256_text(v_warehouse_id), 16);
    v_reversal_transaction_id := 'opening-reversal:' || v_opening.id::text || ':'
      || pg_catalog.left(app_private.sha256_text(v_warehouse_id), 16);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wms-transaction:' || v_original_transaction_id, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wms-transaction:' || v_reversal_transaction_id, 0)
    );
  end loop;

  -- Lock immutable original transaction rows before item rows, following the
  -- posting engine's transaction -> item order.
  for v_warehouse_id in
    select distinct line.warehouse_id
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
    order by line.warehouse_id
  loop
    v_original_transaction_id := 'opening-balance:' || v_opening.id::text || ':'
      || pg_catalog.left(app_private.sha256_text(v_warehouse_id), 16);
    select * into v_original_transaction
    from public.transactions transaction_row
    where transaction_row.id = v_original_transaction_id
    for update;
    if not found then
      raise exception 'project opening WMS lineage is missing transaction %; use reconciliation',
        v_original_transaction_id using errcode = '55000';
    end if;
  end loop;

  for v_item_id in
    select distinct line.inventory_item_id
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
    order by line.inventory_item_id
  loop
    perform 1
    from public.items item
    where item.id = v_item_id
    for update;
    if not found then
      raise exception 'project opening item lineage is missing item %; use reconciliation', v_item_id
        using errcode = '55000';
    end if;
  end loop;

  -- Validate every original line against the authoritative catalog precision.
  for v_record in
    select line.id, line.inventory_item_id, line.remaining_qty, line.unit, item.unit as item_unit
    from public.project_opening_balance_lines line
    join public.items item on item.id = line.inventory_item_id
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
    order by line.inventory_item_id, line.warehouse_id, line.id
  loop
    if not app_private.quantity_units_are_equivalent(v_record.unit, v_record.item_unit)
       or app_private.assert_quantity_precision(
         v_record.remaining_qty::text, v_record.item_unit
       ) is distinct from v_record.remaining_qty then
      raise exception 'project opening quantity/unit lineage changed for line %; use reconciliation',
        v_record.id using errcode = '55000';
    end if;
  end loop;

  -- Original transaction, inventory header and immutable ledger must all
  -- reproduce the locked opening quantities exactly before compensation.
  for v_warehouse_id in
    select distinct line.warehouse_id
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
    order by line.warehouse_id
  loop
    v_transaction_source_id := v_opening.id::text || ':' || v_warehouse_id;
    v_original_transaction_id := 'opening-balance:' || v_opening.id::text || ':'
      || pg_catalog.left(app_private.sha256_text(v_warehouse_id), 16);
    select * into strict v_original_transaction
    from public.transactions transaction_row
    where transaction_row.id = v_original_transaction_id;

    if not (v_opening.stock_transaction_ids ? v_original_transaction_id)
       or v_original_transaction.source_type is distinct from 'project_opening_balance'
       or v_original_transaction.source_id is distinct from v_transaction_source_id
       or v_original_transaction.posting_engine_version is distinct from 'wf001-opening-v1'
       or v_original_transaction.status::text <> 'COMPLETED'
       or v_original_transaction.type::text <> 'ADJUSTMENT'
       or v_original_transaction.source_warehouse_id is not null
       or v_original_transaction.target_warehouse_id is distinct from v_warehouse_id
       or pg_catalog.jsonb_typeof(v_original_transaction.items) is distinct from 'array' then
      raise exception 'project opening WMS transaction % has incomplete lineage; use reconciliation',
        v_original_transaction_id using errcode = '55000';
    end if;

    select pg_catalog.count(*)
    into v_lineage_count
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.warehouse_id = v_warehouse_id
      and line.remaining_qty > 0;
    if pg_catalog.jsonb_array_length(v_original_transaction.items) <> v_lineage_count then
      raise exception 'project opening WMS transaction % line count changed; use reconciliation',
        v_original_transaction_id using errcode = '55000';
    end if;

    if exists (
      with expected as (
        select line.inventory_item_id as item_id, pg_catalog.sum(line.remaining_qty) as quantity
        from public.project_opening_balance_lines line
        where line.opening_balance_id = v_opening.id
          and line.warehouse_id = v_warehouse_id
          and line.remaining_qty > 0
        group by line.inventory_item_id
      ), actual as (
        select source_line.value->>'itemId' as item_id,
               pg_catalog.sum((source_line.value->>'quantity')::numeric) as quantity
        from pg_catalog.jsonb_array_elements(v_original_transaction.items) source_line(value)
        group by source_line.value->>'itemId'
      )
      select 1
      from expected
      full join actual using (item_id)
      where expected.item_id is null or actual.item_id is null
         or expected.quantity is distinct from actual.quantity
    ) then
      raise exception 'project opening WMS transaction % quantity lineage changed; use reconciliation',
        v_original_transaction_id using errcode = '55000';
    end if;

    for v_record in
      select source_line.value
      from pg_catalog.jsonb_array_elements(v_original_transaction.items) source_line(value)
    loop
      if (v_record.value->>'quantity')::numeric <= 0
         or app_private.assert_quantity_precision(
           v_record.value->>'quantity',
           coalesce(v_record.value->>'unitSnapshot', v_record.value->>'unit')
         ) is distinct from (v_record.value->>'quantity')::numeric then
        raise exception 'project opening WMS transaction % contains invalid decimal lineage; use reconciliation',
          v_original_transaction_id using errcode = '55000';
      end if;
    end loop;

    select pg_catalog.count(*)
    into v_lineage_count
    from public.inventory_transactions inventory_transaction
    where inventory_transaction.source_type = 'wms_transaction'
      and inventory_transaction.source_id = v_original_transaction_id
      and inventory_transaction.status = 'posted';
    if v_lineage_count <> 1 then
      raise exception 'project opening inventory header lineage is missing or ambiguous for %; use reconciliation',
        v_original_transaction_id using errcode = '55000';
    end if;
    select inventory_transaction.id
    into strict v_original_inventory_transaction_id
    from public.inventory_transactions inventory_transaction
    where inventory_transaction.source_type = 'wms_transaction'
      and inventory_transaction.source_id = v_original_transaction_id
      and inventory_transaction.status = 'posted';

    select pg_catalog.count(*)
    into v_lineage_count
    from public.inventory_ledger_entries ledger
    where ledger.inventory_transaction_id = v_original_inventory_transaction_id;
    if v_lineage_count <> pg_catalog.jsonb_array_length(v_original_transaction.items)
       or exists (
         with expected as (
           select source_line.value->>'itemId' as item_id,
                  pg_catalog.sum((source_line.value->>'quantity')::numeric) as quantity
           from pg_catalog.jsonb_array_elements(v_original_transaction.items) source_line(value)
           group by source_line.value->>'itemId'
         ), actual as (
           select ledger.material_id as item_id,
                  pg_catalog.sum(ledger.quantity_in) as quantity
           from public.inventory_ledger_entries ledger
           where ledger.inventory_transaction_id = v_original_inventory_transaction_id
             and ledger.warehouse_id = v_warehouse_id
             and ledger.movement_direction = 'in'
             and ledger.quantity_out = 0
           group by ledger.material_id
         )
         select 1
         from expected
         full join actual using (item_id)
         where expected.item_id is null or actual.item_id is null
            or expected.quantity is distinct from actual.quantity
       ) then
      raise exception 'project opening immutable ledger lineage does not match %; use reconciliation',
        v_original_transaction_id using errcode = '55000';
    end if;
  end loop;

  -- Lock every derived balance row in warehouse/item/scope order before the
  -- cache/balance and reservation preconditions are evaluated.
  for v_record in
    select balance.id
    from public.inventory_balances balance
    where (balance.material_id, balance.warehouse_id) in (
      select distinct line.inventory_item_id, line.warehouse_id
      from public.project_opening_balance_lines line
      where line.opening_balance_id = v_opening.id
        and line.remaining_qty > 0
    )
    order by balance.warehouse_id, balance.material_id, balance.scope_key, balance.id
    for update
  loop
    null;
  end loop;

  for v_record in
    select line.inventory_item_id as item_id,
           line.warehouse_id,
           pg_catalog.sum(line.remaining_qty) as expected_qty
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
    group by line.inventory_item_id, line.warehouse_id
    order by line.warehouse_id, line.inventory_item_id
  loop
    v_item_id := v_record.item_id;
    v_warehouse_id := v_record.warehouse_id;
    v_expected_qty := v_record.expected_qty;
    select coalesce((coalesce(item.stock_by_warehouse, '{}'::jsonb)
      ->> v_warehouse_id)::numeric, 0)
    into v_cache_qty
    from public.items item
    where item.id = v_item_id;
    select coalesce(pg_catalog.sum(balance.on_hand_qty), 0)
    into v_balance_qty
    from public.inventory_balances balance
    where balance.material_id = v_item_id
      and balance.warehouse_id = v_warehouse_id;
    if v_cache_qty is distinct from v_balance_qty then
      raise exception 'stock cache/balance mismatch for item %, warehouse %; run reconciliation before reversal',
        v_item_id, v_warehouse_id using errcode = '55000';
    end if;

    select coalesce(pg_catalog.sum((line.value->>'quantity')::numeric), 0)
    into v_reserved_transaction_qty
    from public.transactions transaction_row
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(transaction_row.items, '[]'::jsonb)
    ) line(value)
    where transaction_row.source_warehouse_id = v_warehouse_id
      and transaction_row.status::text in ('PENDING', 'APPROVED')
      and transaction_row.type::text in ('EXPORT', 'LIQUIDATION', 'TRANSFER')
      and line.value->>'itemId' = v_item_id;

    select coalesce(pg_catalog.sum(
      case when request.status::text = 'PENDING'
        then coalesce(nullif(line.value->>'requestQty', '')::numeric, 0)
        else coalesce(nullif(line.value->>'approvedQty', '')::numeric, 0)
      end
    ), 0)
    into v_reserved_request_qty
    from public.requests request
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(request.items, '[]'::jsonb)
    ) line(value)
    where request.source_warehouse_id = v_warehouse_id
      and request.status::text in ('PENDING', 'APPROVED', 'IN_TRANSIT')
      and not (
        (coalesce(request.request_origin, 'wms') = 'project'
          or request.project_id is not null
          or request.construction_site_id is not null)
        and request.status::text <> 'PENDING'
      )
      and line.value->>'itemId' = v_item_id;

    v_reserved_qty := coalesce(v_reserved_transaction_qty, 0)
      + coalesce(v_reserved_request_qty, 0);
    v_available_qty := greatest(0::numeric, v_cache_qty - v_reserved_qty);
    if v_expected_qty > v_available_qty then
      raise exception 'insufficient stock after reservations for item %, warehouse % (need %, available %); run reconciliation before reversal',
        v_item_id, v_warehouse_id, v_expected_qty, v_available_qty
        using errcode = '40001';
    end if;
  end loop;

  -- Re-run the same sorted lock primitive immediately before finance/material
  -- compensation and WMS posting. The locks acquired above are still held;
  -- any cardinality drift is therefore corruption or an invalid warehouse set.
  select pg_catalog.count(*)
  into v_revalidated_warehouse_count
  from app_private.lock_project_opening_reversal_warehouses(v_opening.id);
  if v_revalidated_warehouse_count is distinct from v_warehouse_count then
    raise exception 'locked warehouse set changed before reversal posting'
      using errcode = '40001';
  end if;

  select * into v_finance
  from public.project_finances finance
  where finance.id = v_opening.project_finance_id
  for update;
  if not found then
    raise exception 'project opening finance lineage is missing; use reconciliation'
      using errcode = '55000';
  end if;
  v_finance_before := app_private.project_opening_reversal_finance_snapshot(v_finance);
  if v_finance_before is distinct from v_expected_finance_snapshot then
    raise exception 'finance snapshot is stale; reload the exact current finance version before reversal'
      using errcode = '40001';
  end if;
  if v_finance.project_id is distinct from v_opening.project_id
     or nullif(coalesce(v_finance.construction_site_id, v_finance."constructionSiteId"), '')
       is distinct from v_opening.construction_site_id then
    raise exception 'project opening finance row no longer belongs to the locked project/site'
      using errcode = '55000';
  end if;

  update public.project_finances finance
  set "contractValue" = v_corrected_contract_value,
      "progressPercent" = v_corrected_progress_percent,
      status = v_corrected_status,
      notes = v_corrected_notes,
      project_id = v_corrected_project_id,
      construction_site_id = v_corrected_site_id,
      "constructionSiteId" = coalesce(v_corrected_site_id, '')
  where finance.id = v_expected_finance_id
    and finance."updatedAt" = v_expected_updated_at
  returning * into v_finance;
  if not found then
    raise exception 'finance snapshot is stale; project finance changed during reversal'
      using errcode = '40001';
  end if;
  v_finance_after := app_private.project_opening_reversal_finance_snapshot(v_finance);

  -- The finance row is corrected explicitly, never deleted or blindly reset.
  -- Project material cost is compensated with a new immutable negative expense.
  if v_opening.recognized_value > 0 then
    if nullif(v_opening.material_project_transaction_id, '') is null then
      raise exception 'project opening material expense lineage is missing; use reconciliation'
        using errcode = '55000';
    end if;
    select * into v_original_material
    from public.project_transactions project_transaction
    where project_transaction.id = v_opening.material_project_transaction_id
    for update;
    if not found
       or v_original_material.id is distinct from 'opening-material:' || v_opening.id::text
       or v_original_material.type is distinct from 'expense'
       or v_original_material.category is distinct from 'materials'
       or v_original_material.amount is distinct from v_opening.recognized_value
       or coalesce(v_original_material.project_finance_id, v_original_material."projectFinanceId")
         is distinct from v_opening.project_finance_id
       or v_original_material.source_ref is distinct from
         'opening_balance:' || v_opening.id::text || ':materials'
       or v_original_material."sourceRef" is distinct from
         'opening_balance:' || v_opening.id::text || ':materials' then
      raise exception 'project opening material expense lineage is incomplete; use reconciliation'
        using errcode = '55000';
    end if;

    v_reversal_material_id := 'opening-material-reversal:' || v_opening.id::text;
    v_material_source_ref := 'opening_balance_reversal:' || v_opening.id::text || ':materials';
    if exists (
      select 1 from public.project_transactions project_transaction
      where project_transaction.id = v_reversal_material_id
         or project_transaction.source_ref = v_material_source_ref
         or project_transaction."sourceRef" = v_material_source_ref
    ) then
      raise exception 'project opening material reversal identity already exists without a command result; use reconciliation'
        using errcode = '55000';
    end if;

    perform app_private.authorize_project_opening_reversal_material(
      v_reversal_material_id,
      v_material_source_ref,
      v_opening.project_finance_id,
      v_actor,
      -pg_catalog.abs(v_original_material.amount)
    );
    insert into public.project_transactions (
      id,
      "projectFinanceId",
      "constructionSiteId",
      project_id,
      project_finance_id,
      construction_site_id,
      type,
      category,
      amount,
      description,
      date,
      source,
      "sourceRef",
      source_ref,
      attachments,
      "createdBy",
      "createdAt"
    )
    values (
      v_reversal_material_id,
      v_opening.project_finance_id,
      coalesce(v_opening.construction_site_id, ''),
      v_opening.project_id,
      v_opening.project_finance_id,
      v_opening.construction_site_id,
      'expense',
      'materials',
      -pg_catalog.abs(v_original_material.amount),
      'Hoàn nguyên chi phí vật tư đầu kỳ: ' || v_reason,
      current_date::text,
      'workflow',
      v_material_source_ref,
      v_material_source_ref,
      '[]'::jsonb,
      v_actor::text,
      pg_catalog.clock_timestamp()
    )
    returning * into v_reversal_material;
    v_material_transaction_map := pg_catalog.jsonb_build_object(
      'originalTransactionId', v_original_material.id,
      'compensatingTransactionId', v_reversal_material.id
    );
  else
    if v_opening.material_project_transaction_id is not null then
      raise exception 'zero-value project opening has unexpected material expense lineage; use reconciliation'
        using errcode = '55000';
    end if;
    v_reversal_material_id := null;
  end if;

  -- Mirror each immutable original transaction line with a negative decimal
  -- quantity. The hardened posting engine performs availability, cache, ledger
  -- and rollback atomically inside this outer reversal transaction.
  for v_warehouse_id in
    select distinct line.warehouse_id
    from public.project_opening_balance_lines line
    where line.opening_balance_id = v_opening.id
      and line.remaining_qty > 0
    order by line.warehouse_id
  loop
    v_transaction_source_id := v_opening.id::text || ':' || v_warehouse_id;
    v_original_transaction_id := 'opening-balance:' || v_opening.id::text || ':'
      || pg_catalog.left(app_private.sha256_text(v_warehouse_id), 16);
    v_reversal_transaction_id := 'opening-reversal:' || v_opening.id::text || ':'
      || pg_catalog.left(app_private.sha256_text(v_warehouse_id), 16);
    select * into strict v_original_transaction
    from public.transactions transaction_row
    where transaction_row.id = v_original_transaction_id;

    select pg_catalog.jsonb_agg(
      (source_line.value - 'lineId' - 'quantity')
      || pg_catalog.jsonb_build_object(
        'lineId', 'reversal:' || v_opening.id::text || ':' || source_line.ordinality::text,
        'reversalOfLineId', source_line.value->>'lineId',
        'quantity', -((source_line.value->>'quantity')::numeric)
      )
      order by source_line.value->>'itemId', source_line.ordinality
    )
    into v_transaction_items
    from pg_catalog.jsonb_array_elements(v_original_transaction.items)
      with ordinality as source_line(value, ordinality);

    if exists (
      select 1 from public.transactions transaction_row
      where transaction_row.id = v_reversal_transaction_id
         or (
           transaction_row.source_type = 'project_opening_balance_reversal'
           and transaction_row.source_id = v_transaction_source_id
         )
    ) then
      raise exception 'project opening WMS reversal identity already exists without a command result; use reconciliation'
        using errcode = '55000';
    end if;

    perform app_private.authorize_project_opening_reversal_source(
      v_reversal_transaction_id,
      v_transaction_source_id,
      v_warehouse_id,
      v_actor,
      v_transaction_items
    );
    insert into public.transactions (
      id,
      type,
      date,
      items,
      source_warehouse_id,
      target_warehouse_id,
      supplier_id,
      requester_id,
      approver_id,
      status,
      note,
      related_request_id,
      pending_items,
      created_by,
      updated_by,
      source_type,
      source_id,
      posting_request_hash,
      posting_engine_version
    )
    values (
      v_reversal_transaction_id,
      'ADJUSTMENT'::public.transaction_type,
      pg_catalog.clock_timestamp(),
      v_transaction_items,
      null,
      v_warehouse_id,
      null,
      v_actor,
      v_actor,
      'PENDING'::public.transaction_status,
      'Hoàn nguyên tồn đầu kỳ dự án ' || v_scope_key || ': ' || v_reason,
      null,
      '[]'::jsonb,
      v_actor,
      v_actor,
      'project_opening_balance_reversal',
      v_transaction_source_id,
      null,
      'wf001-opening-reversal-v1'
    )
    returning * into v_reversal_transaction;

    v_transaction_hash := app_private.sha256_text(
      app_private.wms_transaction_intent(v_reversal_transaction)::text
    );
    update public.transactions transaction_row
    set posting_request_hash = v_transaction_hash
    where transaction_row.id = v_reversal_transaction_id
    returning * into v_reversal_transaction;

    v_posted_transaction := public.process_transaction_status(
      v_reversal_transaction_id,
      'COMPLETED'::public.transaction_status,
      v_actor
    );
    v_stock_transaction_ids := v_stock_transaction_ids
      || pg_catalog.jsonb_build_array(v_posted_transaction.id);
    v_stock_transaction_map := v_stock_transaction_map
      || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'originalTransactionId', v_original_transaction_id,
        'compensatingTransactionId', v_posted_transaction.id
      ));
  end loop;

  v_now := pg_catalog.now();
  v_opening_before := v_opening;
  v_authorized_opening := v_opening;
  v_authorized_opening.status := 'void';
  v_authorized_opening.reversal_command_id := v_command_id;
  v_authorized_opening.reversal_request_hash := v_request_hash;
  v_authorized_opening.reversed_by := v_actor::text;
  v_authorized_opening.reversed_at := v_now;
  v_authorized_opening.reversal_reason := v_reason;
  v_authorized_opening.reversal_stock_transaction_ids := v_stock_transaction_ids;
  v_authorized_opening.reversal_material_project_transaction_id := v_reversal_material_id;
  v_authorized_opening.updated_at := v_now;

  perform app_private.authorize_project_opening_reversal_write(
    v_opening.id,
    pg_catalog.to_jsonb(v_opening_before),
    pg_catalog.to_jsonb(v_authorized_opening)
  );
  update public.project_opening_balances opening
  set status = 'void',
      reversal_command_id = v_command_id,
      reversal_request_hash = v_request_hash,
      reversed_by = v_actor::text,
      reversed_at = v_now,
      reversal_reason = v_reason,
      reversal_stock_transaction_ids = v_stock_transaction_ids,
      reversal_material_project_transaction_id = v_reversal_material_id,
      updated_at = v_now
  where opening.id = v_opening.id
  returning * into v_opening;

  v_saved_result := pg_catalog.jsonb_build_object(
    'opening_balance', pg_catalog.to_jsonb(v_opening),
    'project_finance', pg_catalog.to_jsonb(v_finance),
    'finance_before', v_finance_before,
    'finance_after', v_finance_after,
    'compensating_stock_transactions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(transaction_row) order by transaction_row.id)
      from public.transactions transaction_row
      where transaction_row.id in (
        select source_id.value
        from pg_catalog.jsonb_array_elements_text(v_stock_transaction_ids) source_id(value)
      )
    ), '[]'::jsonb),
    'compensating_material_project_transaction', case
      when v_reversal_material_id is null then null
      else pg_catalog.to_jsonb(v_reversal_material)
    end,
    'stock_transaction_map', v_stock_transaction_map,
    'material_transaction_map', v_material_transaction_map,
    'reversal', pg_catalog.jsonb_build_object(
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'actorId', v_actor,
      'reason', v_reason,
      'reversedAt', pg_catalog.to_jsonb(v_now)
    )
  );

  insert into app_private.project_opening_reversal_results(
    command_id,
    opening_balance_id,
    actor_id,
    request_hash,
    reason,
    finance_before,
    finance_after,
    stock_transaction_map,
    material_transaction_map,
    result
  )
  values (
    v_command_id,
    v_opening.id,
    v_actor,
    v_request_hash,
    v_reason,
    v_finance_before,
    v_finance_after,
    v_stock_transaction_map,
    v_material_transaction_map,
    v_saved_result
  );

  return v_saved_result;
end;
$$;

revoke all on function public.reverse_project_opening_balance(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reverse_project_opening_balance(jsonb)
  to authenticated;

reset statement_timeout;
reset lock_timeout;

notify pgrst, 'reload schema';
