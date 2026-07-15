-- DESTRUCTIVE DDL REHEARSAL: run only on a recent, masked production clone.
--
-- This executes the exact Release A2 generated-expression and typmod sequence
-- inside a transaction, verifies the final catalog, enforces the five-second
-- end-to-end DDL gate, and rolls everything back. If the row-count or elapsed
-- gate fails, production must use expand/backfill/validate/swap instead.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5s';

do $rehearsal_prerequisites$
declare
  v_ledger_count bigint;
  v_balance_count bigint;
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'Release A2 direct rehearsal requires PostgreSQL 17 or newer';
  end if;

  select count(*) into v_ledger_count from public.inventory_ledger_entries;
  select count(*) into v_balance_count from public.inventory_balances;

  if v_ledger_count >= 1000000 or v_balance_count >= 1000000 then
    raise exception 'Direct rehearsal refused: ledger %, balances %; use expand/backfill/validate/swap',
      v_ledger_count,
      v_balance_count;
  end if;
end;
$rehearsal_prerequisites$;

create temp table wms_quantity_precision_rehearsal_clock (
  started_at timestamptz not null,
  finished_at timestamptz null
) on commit drop;

insert into wms_quantity_precision_rehearsal_clock(started_at)
values (clock_timestamp());

lock table public.inventory_ledger_entries, public.inventory_balances
  in access exclusive mode;

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

update wms_quantity_precision_rehearsal_clock
set finished_at = clock_timestamp();

do $rehearsal_contract$
declare
  v_elapsed interval;
begin
  select finished_at - started_at
  into strict v_elapsed
  from wms_quantity_precision_rehearsal_clock;

  if v_elapsed >= interval '5 seconds' then
    raise exception 'Release A2 DDL rehearsal took %, so production requires expand/backfill/validate/swap',
      v_elapsed;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where (
      (a.attrelid = 'public.inventory_ledger_entries'::regclass
       and a.attname in ('quantity_in', 'quantity_out', 'quantity_delta', 'balance_after_qty'))
      or
      (a.attrelid = 'public.inventory_balances'::regclass
       and a.attname = 'on_hand_qty')
    )
      and not a.attisdropped
      and pg_catalog.format_type(a.atttypid, a.atttypmod) <> 'numeric(20,6)'
  ) then
    raise exception 'Rehearsal finished with an unexpected quantity typmod';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid
     and d.adnum = a.attnum
    where a.attrelid = 'public.inventory_ledger_entries'::regclass
      and a.attname = 'quantity_delta'
      and a.attgenerated = 's'
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '(quantity_in - quantity_out)'
  ) then
    raise exception 'Rehearsal did not restore quantity_delta generated expression';
  end if;

  raise notice 'Release A2 direct DDL rehearsal passed in %', v_elapsed;
end;
$rehearsal_contract$;

rollback;
