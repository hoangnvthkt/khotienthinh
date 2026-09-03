create or replace function public.update_transaction_voucher_metadata(
  p_transaction_id text,
  p_date timestamptz,
  p_note text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_can_approve boolean;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user
  from public.users
  where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  if v_tx.status <> 'PENDING'::public.transaction_status then
    raise exception 'only pending transactions can have voucher metadata edited'
      using errcode = '55000';
  end if;

  v_can_approve := app_private.wms_has_action(
    'wms.transaction.approve',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  if v_tx.requester_id is distinct from v_user.id and not v_can_approve then
    raise exception 'insufficient privilege to edit voucher metadata'
      using errcode = '42501';
  end if;

  if p_date is null then
    raise exception 'voucher date is required';
  end if;

  update public.transactions
  set date = p_date,
      note = nullif(trim(coalesce(p_note, '')), ''),
      updated_by = v_user.id
  where id = v_tx.id
  returning * into v_tx;

  return v_tx;
end;
$$;

revoke all on function public.update_transaction_voucher_metadata(text, timestamptz, text) from public, anon;
grant execute on function public.update_transaction_voucher_metadata(text, timestamptz, text) to authenticated;
