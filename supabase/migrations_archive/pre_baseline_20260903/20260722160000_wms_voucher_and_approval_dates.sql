alter table public.transactions
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

alter table public.material_issue_orders
  add column if not exists voucher_date date;

create or replace function public.process_transaction_approval(
  p_transaction_id text,
  p_status public.transaction_status,
  p_approver_id uuid,
  p_approved_at timestamptz default null,
  p_approval_note text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
begin
  select * into v_tx
  from public.process_transaction_status(p_transaction_id, p_status, p_approver_id);

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    update public.transactions
    set approved_at = coalesce(p_approved_at, now()),
        approval_note = nullif(trim(coalesce(p_approval_note, '')), '')
    where id = p_transaction_id
    returning * into v_tx;
  end if;

  return v_tx;
end;
$$;

revoke all on function public.process_transaction_approval(text, public.transaction_status, uuid, timestamptz, text) from public, anon;
grant execute on function public.process_transaction_approval(text, public.transaction_status, uuid, timestamptz, text) to authenticated;

create or replace function public.submit_material_issue_order_with_date(
  p_order_id uuid,
  p_override_reason text default null,
  p_transaction_date timestamptz default null
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.material_issue_orders%rowtype;
begin
  select * into v_order
  from public.submit_material_issue_order(p_order_id, p_override_reason);

  if p_transaction_date is not null then
    update public.material_issue_orders
    set voucher_date = p_transaction_date::date
    where id = v_order.id
    returning * into v_order;

    update public.transactions
    set date = p_transaction_date
    where id = v_order.transaction_id;
  end if;

  return v_order;
end;
$$;

revoke all on function public.submit_material_issue_order_with_date(uuid, text, timestamptz) from public, anon;
grant execute on function public.submit_material_issue_order_with_date(uuid, text, timestamptz) to authenticated;
