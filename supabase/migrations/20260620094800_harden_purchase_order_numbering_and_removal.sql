-- Allocate PO numbers globally and keep every issued number reserved forever.
-- Existing duplicate historical codes remain readable, but no new duplicate can
-- be inserted and an existing PO number cannot be edited.

create schema if not exists app_private;

create sequence if not exists app_private.purchase_order_number_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1
  no cycle;

create table if not exists app_private.purchase_order_number_registry (
  po_number text primary key,
  purchase_order_id text,
  issued_at timestamptz not null default now()
);

insert into app_private.purchase_order_number_registry(po_number, purchase_order_id, issued_at)
select distinct on (po.po_number)
  po.po_number,
  po.id::text,
  coalesce(po.created_at, now())
from public.purchase_orders po
where nullif(trim(po.po_number), '') is not null
order by po.po_number, po.created_at, po.id
on conflict (po_number) do nothing;

do $$
declare
  v_max_existing bigint := 0;
  v_last_sequence bigint := 1;
begin
  select coalesce(max(substring(po.po_number from '^PO-([0-9]+)')::bigint), 0)
    into v_max_existing
  from public.purchase_orders po
  where po.po_number ~ '^PO-[0-9]+';

  select last_value
    into v_last_sequence
  from app_private.purchase_order_number_seq;

  if greatest(v_max_existing, v_last_sequence) <= 1 and v_max_existing = 0 then
    perform setval('app_private.purchase_order_number_seq', 1, false);
  else
    perform setval(
      'app_private.purchase_order_number_seq',
      greatest(v_max_existing, v_last_sequence),
      true
    );
  end if;
end;
$$;

create or replace function public.next_purchase_order_number_v2()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_number bigint;
  v_po_number text;
begin
  loop
    v_number := nextval('app_private.purchase_order_number_seq');
    v_po_number := 'PO-' || lpad(v_number::text, 3, '0');

    insert into app_private.purchase_order_number_registry(po_number)
    values (v_po_number)
    on conflict (po_number) do nothing;

    if found and not exists (
      select 1
      from public.purchase_orders po
      where po.po_number = v_po_number
    ) then
      return v_po_number;
    end if;
  end loop;
end;
$$;

-- Keep older clients safe: their scoped v1 call now uses the same global allocator.
create or replace function public.next_purchase_order_number_v1(
  p_project_id text default null,
  p_construction_site_id text default null,
  p_prefix text default 'PO'
)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select public.next_purchase_order_number_v2();
$$;

create or replace function app_private.enforce_purchase_order_number_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_number text;
begin
  if tg_op = 'UPDATE' then
    if old.po_number is distinct from new.po_number then
      raise exception 'Số PO được hệ thống tự sinh và không thể chỉnh sửa.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Supabase upsert executes the INSERT trigger before resolving an existing id.
  -- Allow that existing row to continue through its normal UPDATE path.
  if exists (
    select 1
    from public.purchase_orders po
    where po.id = new.id
      and po.po_number = new.po_number
  ) then
    return new;
  end if;

  if new.po_number !~ '^PO-[0-9]{3,}(-[0-9]{2})?$' then
    raise exception 'Số PO không hợp lệ. Hệ thống phải tự cấp số PO.'
      using errcode = '23514';
  end if;

  v_base_number := regexp_replace(new.po_number, '-[0-9]{2}$', '');

  if new.po_number = v_base_number then
    update app_private.purchase_order_number_registry registry
    set purchase_order_id = new.id::text
    where registry.po_number = new.po_number
      and registry.purchase_order_id is null;

    if not found then
      raise exception 'Số PO % chưa được cấp hoặc đã được sử dụng.', new.po_number
        using errcode = '23505';
    end if;
  else
    if not exists (
      select 1
      from app_private.purchase_order_number_registry registry
      where registry.po_number = v_base_number
    ) then
      raise exception 'Nhóm số PO % chưa được hệ thống cấp.', v_base_number
        using errcode = '23505';
    end if;

    insert into app_private.purchase_order_number_registry(po_number, purchase_order_id)
    values (new.po_number, new.id::text)
    on conflict (po_number) do nothing;

    if not found then
      raise exception 'Số PO % đã được sử dụng.', new.po_number
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_purchase_order_number_v2 on public.purchase_orders;
create trigger trg_enforce_purchase_order_number_v2
  before insert or update of po_number on public.purchase_orders
  for each row execute function app_private.enforce_purchase_order_number_v2();

revoke all on sequence app_private.purchase_order_number_seq from public, anon, authenticated;
revoke all on table app_private.purchase_order_number_registry from public, anon, authenticated;
revoke all on function public.next_purchase_order_number_v2() from public, anon;
grant execute on function public.next_purchase_order_number_v2() to authenticated;
revoke all on function public.next_purchase_order_number_v1(text, text, text) from public, anon;
grant execute on function public.next_purchase_order_number_v1(text, text, text) to authenticated;
revoke all on function app_private.enforce_purchase_order_number_v2() from public, anon, authenticated;

notify pgrst, 'reload schema';
