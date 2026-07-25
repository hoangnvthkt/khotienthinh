-- Material issue recipient source permission fix smoke test.
-- The transaction always rolls back and does not create or modify business data.

begin;

do $$
declare
  v_create_rpc regprocedure := to_regprocedure('public.create_material_issue_order(text,text,text,text,text,text,uuid,text,text,text,date,text,jsonb,text,text)');
  v_function_def text;
begin
  if v_create_rpc is null then
    raise exception 'Missing recipient-source create_material_issue_order RPC signature';
  end if;

  select pg_get_functiondef(v_create_rpc) into v_function_def;
  if v_function_def not like '%recipient_source_type, recipient_source_id%' then
    raise exception 'Create RPC does not persist recipient source columns';
  end if;

  if not has_function_privilege(
    'authenticated',
    v_create_rpc,
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute recipient-source create RPC';
  end if;

  if not has_table_privilege('authenticated', 'public.material_issue_orders', 'SELECT') then
    raise exception 'authenticated lost SELECT on material_issue_orders';
  end if;

  if has_table_privilege('authenticated', 'public.material_issue_orders', 'UPDATE') then
    raise exception 'authenticated must not receive direct UPDATE on material_issue_orders';
  end if;

  if (
    select count(*)
    from public.material_issue_orders
    where id = any(array[
      'b94122f7-56fb-4d98-8080-b98b92bafcac'::uuid,
      '38a56f6c-7f5a-4d05-8d4e-013b32882ac3'::uuid,
      '7f7d8661-2bd9-43a8-aa22-9a8f3e795a13'::uuid,
      'fce2f9bf-537b-433d-bc4e-1955253f11f7'::uuid,
      '716fdddf-70d6-42e2-b477-b075ddb412f1'::uuid
    ])
      and status = 'draft'
      and transaction_id is null
      and recipient_source_type is null
      and recipient_source_id is null
  ) <> 5 then
    raise exception 'The five known draft orders must remain unchanged';
  end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e9be7010-cbb9-4cf1-9d5a-8ec558ec5d99","role":"authenticated","email":"luatnv@tienthinhjsc.vn"}',
  true
);

do $$
begin
  if public.current_app_user_id() <> 'e9be7010-cbb9-4cf1-9d5a-8ec558ec5d99'::uuid then
    raise exception 'Nguyen Van Luat session was not resolved as the active app user';
  end if;

  if (
    select count(*)
    from public.material_issue_orders
    where source_warehouse_id = 'wh-1773110380822-zm5oj'
  ) = 0 then
    raise exception 'Nguyen Van Luat cannot view material issue orders for Kho Son Mien Bac';
  end if;
end
$$;

rollback;
