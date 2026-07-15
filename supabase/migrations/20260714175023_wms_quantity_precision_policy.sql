-- Release A2: versioned per-unit quantity precision policies and a
-- six-decimal WMS quantity ledger. Conversion rounding remains metadata-only;
-- posting rejects over-scale values instead of silently rounding them.

set lock_timeout = '5s';
set statement_timeout = '60s';

create extension if not exists pgcrypto;
create schema if not exists app_private;

create or replace function app_private.normalize_quantity_unit(p_unit text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        coalesce(p_unit, ''),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  );
$$;

create or replace function app_private.quantity_policy_aliases_are_normalized(
  p_unit_key text,
  p_aliases text[]
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    pg_catalog.cardinality(coalesce(p_aliases, '{}'::text[])) = count(*)
    and count(*) = count(distinct alias_key)
    and coalesce(
      bool_and(
        alias_key <> ''
        and alias_key <> p_unit_key
        and alias_key = app_private.normalize_quantity_unit(alias_key)
      ),
      true
    )
  from pg_catalog.unnest(coalesce(p_aliases, '{}'::text[])) as normalized_alias(alias_key);
$$;

create table public.quantity_precision_policies (
  id uuid primary key default gen_random_uuid(),
  unit_key text not null,
  display_name text not null,
  aliases text[] not null default '{}'::text[],
  max_fraction_digits smallint not null default 6,
  conversion_rounding_mode text not null default 'half_away_from_zero',
  comparison_tolerance numeric(8, 7) generated always as (
    case max_fraction_digits
      when 0 then 0.5000000::numeric
      when 1 then 0.0500000::numeric
      when 2 then 0.0050000::numeric
      when 3 then 0.0005000::numeric
      when 4 then 0.0000500::numeric
      when 5 then 0.0000050::numeric
      when 6 then 0.0000005::numeric
    end
  ) stored,
  version integer not null default 1,
  lifecycle_status text not null default 'draft',
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  created_by uuid null references public.users(id) on delete set null,
  updated_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quantity_precision_policies_unit_key_normalized_check check (
    unit_key <> ''
    and unit_key = app_private.normalize_quantity_unit(unit_key)
  ),
  constraint quantity_precision_policies_display_name_check check (
    pg_catalog.btrim(display_name) <> ''
  ),
  constraint quantity_precision_policies_aliases_normalized_check check (
    app_private.quantity_policy_aliases_are_normalized(unit_key, aliases)
  ),
  constraint quantity_precision_policies_scale_check check (
    max_fraction_digits between 0 and 6
  ),
  constraint quantity_precision_policies_rounding_mode_check check (
    conversion_rounding_mode = 'half_away_from_zero'
  ),
  constraint quantity_precision_policies_version_check check (version > 0),
  constraint quantity_precision_policies_lifecycle_check check (
    lifecycle_status in ('draft', 'active', 'retired')
  ),
  constraint quantity_precision_policies_effective_window_check check (
    effective_to is null or effective_to > effective_from
  ),
  constraint quantity_precision_policies_unit_version_key unique (unit_key, version)
);

create unique index quantity_precision_policies_one_active_unit_idx
  on public.quantity_precision_policies(unit_key)
  where lifecycle_status = 'active';

create or replace function app_private.guard_quantity_precision_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflicting_policy_id uuid;
begin
  new.updated_at := pg_catalog.now();

  if new.lifecycle_status = 'active' then
    -- Serialize the small active keyspace so concurrent admin migrations cannot
    -- create ambiguous canonical/alias mappings.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('quantity_precision_policies:active-keyspace', 0)
    );

    select p.id
    into v_conflicting_policy_id
    from public.quantity_precision_policies p
    where p.id <> new.id
      and p.lifecycle_status = 'active'
      and (
        p.unit_key = new.unit_key
        or p.unit_key = any(new.aliases)
        or new.unit_key = any(p.aliases)
        or p.aliases && new.aliases
      )
    limit 1;

    if v_conflicting_policy_id is not null then
      raise exception 'active quantity precision policy key or alias conflicts with policy %',
        v_conflicting_policy_id
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_quantity_precision_policies_guard
before insert or update on public.quantity_precision_policies
for each row execute function app_private.guard_quantity_precision_policy();

alter table public.quantity_precision_policies enable row level security;
revoke all on table public.quantity_precision_policies from public, anon, authenticated;

comment on table public.quantity_precision_policies is
  'Release A2 unit precision policy catalog. Writes are migration/admin-only; authenticated clients resolve through the read-only RPC.';
comment on column public.quantity_precision_policies.conversion_rounding_mode is
  'Metadata for a future conversion release; Release A2 posting validates exactly and does not round inputs.';

create or replace function app_private.resolve_quantity_precision_policy(p_unit text)
returns table (
  policy_id uuid,
  input_unit_key text,
  unit_key text,
  display_name text,
  max_fraction_digits smallint,
  allow_fraction boolean,
  conversion_rounding_mode text,
  comparison_tolerance numeric,
  policy_version integer,
  is_default boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_normalized_unit text := app_private.normalize_quantity_unit(p_unit);
  v_policy public.quantity_precision_policies%rowtype;
  v_match_count integer := 0;
begin
  if v_normalized_unit <> '' then
    select count(*)::integer
    into v_match_count
    from public.quantity_precision_policies p
    where p.lifecycle_status = 'active'
      and p.effective_from <= pg_catalog.now()
      and (p.effective_to is null or p.effective_to > pg_catalog.now())
      and (
        p.unit_key = v_normalized_unit
        or v_normalized_unit = any(p.aliases)
      );

    if v_match_count > 1 then
      raise exception 'ambiguous quantity precision policy for normalized unit "%"',
        v_normalized_unit
        using errcode = '21000';
    end if;

    if v_match_count = 1 then
      select p.*
      into strict v_policy
      from public.quantity_precision_policies p
      where p.lifecycle_status = 'active'
        and p.effective_from <= pg_catalog.now()
        and (p.effective_to is null or p.effective_to > pg_catalog.now())
        and (
          p.unit_key = v_normalized_unit
          or v_normalized_unit = any(p.aliases)
        );

      return query
      select
        v_policy.id,
        v_normalized_unit,
        v_policy.unit_key,
        v_policy.display_name,
        v_policy.max_fraction_digits,
        v_policy.max_fraction_digits > 0,
        v_policy.conversion_rounding_mode,
        v_policy.comparison_tolerance,
        v_policy.version,
        false;
      return;
    end if;
  end if;

  return query
  select
    null::uuid,
    v_normalized_unit,
    ''::text,
    'Default six-decimal quantity policy'::text,
    6::smallint,
    true,
    'half_away_from_zero'::text,
    0.0000005::numeric,
    0::integer,
    true;
end;
$$;

create or replace function public.resolve_quantity_precision_policy(p_unit text)
returns table (
  policy_id uuid,
  input_unit_key text,
  unit_key text,
  display_name text,
  max_fraction_digits smallint,
  allow_fraction boolean,
  conversion_rounding_mode text,
  comparison_tolerance numeric,
  policy_version integer,
  is_default boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.resolve_quantity_precision_policy(p_unit);
$$;

create or replace function app_private.quantity_units_are_equivalent(
  p_authoritative_unit text,
  p_candidate_unit text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_authoritative_key text := app_private.normalize_quantity_unit(p_authoritative_unit);
  v_candidate_key text := app_private.normalize_quantity_unit(p_candidate_unit);
  authoritative_policy record;
  candidate_policy record;
begin
  if v_candidate_key = '' then
    return true;
  end if;

  if v_authoritative_key = '' then
    return false;
  end if;

  if v_authoritative_key = v_candidate_key then
    return true;
  end if;

  select *
  into strict authoritative_policy
  from app_private.resolve_quantity_precision_policy(v_authoritative_key);

  select *
  into strict candidate_policy
  from app_private.resolve_quantity_precision_policy(v_candidate_key);

  return not authoritative_policy.is_default
    and not candidate_policy.is_default
    and authoritative_policy.policy_id = candidate_policy.policy_id;
end;
$$;

create or replace function app_private.assert_quantity_precision(
  p_quantity_text text,
  p_unit_text text
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quantity numeric;
  v_policy record;
begin
  if nullif(pg_catalog.btrim(coalesce(p_quantity_text, '')), '') is null then
    raise exception 'transaction quantity must be a finite numeric value'
      using errcode = '22023';
  end if;

  begin
    v_quantity := p_quantity_text::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'transaction quantity must be a finite numeric value: %', p_quantity_text
        using errcode = '22023';
  end;

  if pg_catalog.lower(v_quantity::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'transaction quantity must be a finite numeric value: %', p_quantity_text
      using errcode = '22023';
  end if;

  if pg_catalog.abs(v_quantity) >= 100000000000000::numeric then
    raise exception 'transaction quantity is outside numeric(20,6) range: %', v_quantity
      using errcode = '22003';
  end if;

  select *
  into strict v_policy
  from app_private.resolve_quantity_precision_policy(p_unit_text);

  if v_quantity <> pg_catalog.round(v_quantity, v_policy.max_fraction_digits) then
    raise exception 'transaction quantity for unit "%" supports at most % fractional digits: %',
      coalesce(nullif(app_private.normalize_quantity_unit(p_unit_text), ''), '<default>'),
      v_policy.max_fraction_digits,
      v_quantity
      using errcode = '22023';
  end if;

  return v_quantity;
end;
$$;

revoke all on function app_private.normalize_quantity_unit(text) from public, anon, authenticated;
revoke all on function app_private.quantity_policy_aliases_are_normalized(text, text[]) from public, anon, authenticated;
revoke all on function app_private.guard_quantity_precision_policy() from public, anon, authenticated;
revoke all on function app_private.resolve_quantity_precision_policy(text) from public, anon;
revoke all on function app_private.quantity_units_are_equivalent(text, text) from public, anon, authenticated;
revoke all on function app_private.assert_quantity_precision(text, text) from public, anon, authenticated;

grant usage on schema app_private to authenticated;
grant execute on function app_private.resolve_quantity_precision_policy(text) to authenticated;
revoke all on function public.resolve_quantity_precision_policy(text) from public, anon;
grant execute on function public.resolve_quantity_precision_policy(text) to authenticated;

-- Direct ALTER is intentionally bounded. The estimate is a cheap first guard;
-- exact counts run only below the estimate threshold and while the same locks
-- required by ALTER TABLE are held. Larger relations require an explicit
-- expand/backfill/swap rollout.
do $quantity_widen_guard$
declare
  v_ledger_estimate bigint;
  v_balance_estimate bigint;
  v_ledger_count bigint;
  v_balance_count bigint;
  v_direct_alter_limit constant bigint := 1000000;
begin
  select greatest(c.reltuples::bigint, 0)
  into v_ledger_estimate
  from pg_catalog.pg_class c
  where c.oid = 'public.inventory_ledger_entries'::regclass;

  select greatest(c.reltuples::bigint, 0)
  into v_balance_estimate
  from pg_catalog.pg_class c
  where c.oid = 'public.inventory_balances'::regclass;

  if coalesce(v_ledger_estimate, 0) >= v_direct_alter_limit
     or coalesce(v_balance_estimate, 0) >= v_direct_alter_limit then
    raise exception 'Release A2 direct quantity widening refused: estimated rows ledger %, balances %; 1000000 or more rows require expand/backfill/swap',
      v_ledger_estimate,
      v_balance_estimate;
  end if;

  lock table public.inventory_ledger_entries, public.inventory_balances
    in access exclusive mode;

  select count(*) into v_ledger_count
  from public.inventory_ledger_entries;

  select count(*) into v_balance_count
  from public.inventory_balances;

  if v_ledger_count >= v_direct_alter_limit
     or v_balance_count >= v_direct_alter_limit then
    raise exception 'Release A2 direct quantity widening refused: live rows ledger %, balances %; 1000000 or more rows require expand/backfill/swap',
      v_ledger_count,
      v_balance_count;
  end if;
end;
$quantity_widen_guard$;

-- PostgreSQL 17 cannot alter quantity_in/out while stored generated columns
-- depend on them. Temporarily use constant generated expressions (retaining
-- generated identity and column OIDs), widen, then restore both expressions
-- before the atomic migration can commit. The clone rehearsal must prove the
-- complete sequence takes less than five seconds; this tighter production
-- timeout also aborts any single rewrite that unexpectedly exceeds the gate.
set statement_timeout = '5s';

alter table public.inventory_ledger_entries
  alter column quantity_delta set expression as (0::numeric),
  alter column amount set expression as (0::numeric);

alter table public.inventory_ledger_entries
  alter column quantity_in type numeric(20, 6) using quantity_in::numeric(20, 6),
  alter column quantity_out type numeric(20, 6) using quantity_out::numeric(20, 6),
  alter column quantity_delta type numeric(20, 6),
  alter column balance_after_qty type numeric(20, 6) using balance_after_qty::numeric(20, 6);

alter table public.inventory_balances
  alter column on_hand_qty type numeric(20, 6) using on_hand_qty::numeric(20, 6);

alter table public.inventory_ledger_entries
  alter column quantity_delta set expression as (quantity_in - quantity_out),
  alter column amount set expression as ((quantity_in - quantity_out) * unit_price);

set statement_timeout = '60s';

create or replace function public.process_transaction_status(
  p_transaction_id text,
  p_status public.transaction_status,
  p_approver_id uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_check record;
  v_item_id text;
  v_unit_text text;
  v_catalog_unit_text text;
  v_pending_unit_text text;
  v_supplied_unit_text text;
  v_qty numeric;
  v_on_hand numeric;
  v_tx_reserved numeric;
  v_request_reserved numeric;
  v_reserved numeric;
  v_available numeric;
  v_item_name text;
  v_warehouse_name text;
  v_stock_warehouse_id text;
  v_is_fulfillment_transfer boolean := false;
  v_can_approve boolean := false;
  v_can_complete boolean := false;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
    where nullif(line.value->>'fulfillmentBatchId', '') is not null
  )
  into v_is_fulfillment_transfer;

  v_is_fulfillment_transfer := v_is_fulfillment_transfer
    and v_tx.type = 'TRANSFER'::public.transaction_type
    and nullif(v_tx.target_warehouse_id, '') is not null;

  v_can_approve := app_private.wms_has_action(
    'wms.transaction.approve',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  v_can_complete := app_private.wms_has_action(
    'wms.transaction.complete',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  if p_status = 'APPROVED'::public.transaction_status and not v_can_approve then
    raise exception 'insufficient privilege to approve transaction'
      using errcode = '42501';
  end if;

  if p_status = 'CANCELLED'::public.transaction_status
     and not v_can_approve
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to cancel transaction'
      using errcode = '42501';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status and not v_can_complete then
    raise exception 'insufficient privilege to complete transaction'
      using errcode = '42501';
  end if;

  if v_tx.status = p_status then
    return v_tx;
  end if;
  if v_tx.status = 'CANCELLED'::public.transaction_status then
    raise exception 'cancelled transaction cannot be changed';
  end if;
  if v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'completed transaction cannot be changed';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_line in
      select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb))
    loop
      select nullif(app_private.normalize_quantity_unit(i.unit), '')
      into v_catalog_unit_text
      from public.items i
      where i.id = v_line->>'itemId';

      -- A matching pending item is authoritative even when its submitted unit
      -- is blank: item creation below persists that case as "Cái", so policy
      -- validation must apply the same default before consulting line evidence.
      select coalesce(
        nullif(app_private.normalize_quantity_unit(pending.value->>'unit'), ''),
        app_private.normalize_quantity_unit('Cái')
      )
      into v_pending_unit_text
      from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb)) pending(value)
      where pending.value->>'id' = v_line->>'itemId'
      limit 1;

      v_unit_text := coalesce(
        v_catalog_unit_text,
        v_pending_unit_text,
        nullif(app_private.normalize_quantity_unit(v_line->>'unit'), ''),
        nullif(app_private.normalize_quantity_unit(v_line->>'unitSnapshot'), ''),
        nullif(app_private.normalize_quantity_unit(v_line->>'unit_snapshot'), ''),
        ''
      );

      foreach v_supplied_unit_text in array array[
        v_pending_unit_text,
        app_private.normalize_quantity_unit(v_line->>'unit'),
        app_private.normalize_quantity_unit(v_line->>'unitSnapshot'),
        app_private.normalize_quantity_unit(v_line->>'unit_snapshot')
      ]
      loop
        if nullif(v_supplied_unit_text, '') is not null
           and not app_private.quantity_units_are_equivalent(
             v_unit_text,
             v_supplied_unit_text
           ) then
          raise exception 'transaction unit snapshot "%" does not match authoritative stock unit "%"',
            v_supplied_unit_text,
            coalesce(nullif(v_unit_text, ''), '<default>')
            using errcode = '22023';
        end if;
      end loop;

      v_qty := app_private.assert_quantity_precision(
        v_line->>'quantity',
        v_unit_text
      );
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status
     and v_is_fulfillment_transfer
     and v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'Đợt cấp cần được thủ kho công trường duyệt số lượng/chất lượng trước khi xác nhận nhập kho.';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status)
     and v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type, 'ADJUSTMENT'::public.transaction_type) then
    v_stock_warehouse_id := case
      when v_tx.type = 'ADJUSTMENT'::public.transaction_type then v_tx.target_warehouse_id
      else v_tx.source_warehouse_id
    end;
    if nullif(v_stock_warehouse_id, '') is null then
      raise exception 'source warehouse is required for stock-out transaction';
    end if;

    for v_check in
      select
        line.value->>'itemId' as item_id,
        sum(
          case
            when v_tx.type = 'ADJUSTMENT'::public.transaction_type
              then abs(least(0, coalesce(nullif(line.value->>'quantity', '')::numeric, 0)))
            else coalesce(nullif(line.value->>'quantity', '')::numeric, 0)
          end
        ) as qty
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
      group by line.value->>'itemId'
    loop
      v_item_id := v_check.item_id;
      v_qty := coalesce(v_check.qty, 0);
      if v_item_id is null then
        raise exception 'invalid transaction item payload';
      end if;
      if v_qty <= 0 then
        if v_tx.type = 'ADJUSTMENT'::public.transaction_type then
          continue;
        end if;
        raise exception 'invalid transaction item payload';
      end if;

      select
        coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> v_stock_warehouse_id)::numeric, 0),
        i.name
      into v_on_hand, v_item_name
      from public.items i
      where i.id = v_item_id
      for update;
      if not found then
        raise exception 'item not found: %', v_item_id;
      end if;

      select coalesce(sum(coalesce(nullif(line.value->>'quantity', '')::numeric, 0)), 0)
      into v_tx_reserved
      from public.transactions t
      cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) line(value)
      where t.id <> v_tx.id
        and t.source_warehouse_id = v_stock_warehouse_id
        and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
        and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
        and line.value->>'itemId' = v_item_id;

      select coalesce(sum(
        case
          when r.status = 'PENDING'::public.request_status
            then coalesce(nullif(line.value->>'requestQty', '')::numeric, 0)
          else coalesce(nullif(line.value->>'approvedQty', '')::numeric, 0)
        end
      ), 0)
      into v_request_reserved
      from public.requests r
      cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) line(value)
      where r.source_warehouse_id = v_stock_warehouse_id
        and (v_tx.related_request_id is null or r.id <> v_tx.related_request_id)
        and r.status in ('PENDING'::public.request_status, 'APPROVED'::public.request_status, 'IN_TRANSIT'::public.request_status)
        and not (
          (coalesce(r.request_origin, 'wms') = 'project' or r.project_id is not null or r.construction_site_id is not null)
          and r.status <> 'PENDING'::public.request_status
        )
        and line.value->>'itemId' = v_item_id;

      v_reserved := coalesce(v_tx_reserved, 0) + coalesce(v_request_reserved, 0);
      v_available := greatest(0, v_on_hand - v_reserved);
      if v_qty > v_available then
        select name into v_warehouse_name from public.warehouses where id = v_stock_warehouse_id;
        raise exception 'Không đủ tồn khả dụng tại kho "%": vật tư "%"; cần %, tồn thực %, đang giữ %, khả dụng %. Vui lòng xử lý phiếu pending/giữ chỗ trước.',
          coalesce(v_warehouse_name, v_stock_warehouse_id),
          coalesce(v_item_name, v_item_id),
          v_qty,
          v_on_hand,
          v_reserved,
          v_available;
      end if;
    end loop;
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_pending in
      select value from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb))
    loop
      insert into public.items (
        id, sku, name, category, unit, purchase_unit,
        price_in, price_out, min_stock, supplier_id, image_url,
        stock_by_warehouse, location
      )
      values (
        v_pending->>'id',
        v_pending->>'sku',
        v_pending->>'name',
        coalesce(nullif(v_pending->>'category', ''), 'Khác'),
        coalesce(nullif(v_pending->>'unit', ''), 'Cái'),
        nullif(v_pending->>'purchaseUnit', ''),
        coalesce(nullif(v_pending->>'priceIn', '')::numeric, 0),
        coalesce(nullif(v_pending->>'priceOut', '')::numeric, 0),
        coalesce(nullif(v_pending->>'minStock', '')::integer, 0),
        nullif(v_pending->>'supplierId', ''),
        nullif(v_pending->>'imageUrl', ''),
        coalesce(v_pending->'stockByWarehouse', '{}'::jsonb),
        nullif(v_pending->>'location', '')
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status then
    for v_line in
      select value from jsonb_array_elements(v_tx.items)
    loop
      v_item_id := v_line->>'itemId';
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
      if v_item_id is null
         or (v_tx.type = 'ADJUSTMENT'::public.transaction_type and v_qty = 0)
         or (v_tx.type <> 'ADJUSTMENT'::public.transaction_type and v_qty <= 0) then
        raise exception 'invalid transaction item payload';
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  end if;

  update public.transactions
  set status = p_status,
      approver_id = p_approver_id
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$$;

revoke execute on function public.apply_stock_change(text, text, numeric) from public, anon, authenticated;

revoke all on function public.process_transaction_status(text, public.transaction_status, uuid) from public;
revoke all on function public.process_transaction_status(text, public.transaction_status, uuid) from anon;
grant execute on function public.process_transaction_status(text, public.transaction_status, uuid) to authenticated;

reset statement_timeout;
reset lock_timeout;

notify pgrst, 'reload schema';
