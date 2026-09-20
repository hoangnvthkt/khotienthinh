begin;

insert into public.users (id, name, email, username, role, is_active, account_status)
values
  ('31111111-1111-4111-8111-111111111111', 'G1 W3 Admin', 'g1-w3-admin@example.test', 'g1-w3-admin', 'ADMIN', true, 'ACTIVE'),
  ('31111111-1111-4111-8111-111111111112', 'G1 W3 Other', 'g1-w3-other@example.test', 'g1-w3-other', 'EMPLOYEE', true, 'ACTIVE');

insert into public.projects (id, code, name, status)
values
  ('g1-w3-project', 'G1-W3', 'G1 W3 project', 'active'),
  ('g1-w3-other-project', 'G1-W3-OTHER', 'G1 W3 other project', 'active');

insert into public.business_partners (id, code, name, classifications)
values ('g1-w3-supplier', 'G1-W3-SUPPLIER', 'G1 W3 supplier', array['supplier']);

insert into public.supplier_payable_documents (
  id, code, source_type, source_id, project_id, supplier_id,
  supplier_name_snapshot, document_no, document_date, currency,
  committed_amount, recognized_amount, credit_amount, status, created_by
) values
  (
    '33333333-3333-4333-8333-333333333331', 'AP-G1-W3-1', 'purchase_order', 'g1-w3-po-1',
    'g1-w3-project', 'g1-w3-supplier', 'G1 W3 supplier', 'PO-G1-W3-1', current_date,
    'VND', 100, 100, 0, 'open', '31111111-1111-4111-8111-111111111111'
  ),
  (
    '33333333-3333-4333-8333-333333333332', 'AP-G1-W3-2', 'purchase_order', 'g1-w3-po-2',
    'g1-w3-project', 'g1-w3-supplier', 'G1 W3 supplier', 'PO-G1-W3-2', current_date,
    'VND', 200, 200, 0, 'open', '31111111-1111-4111-8111-111111111111'
  ),
  (
    '33333333-3333-4333-8333-333333333339', 'AP-G1-W3-OTHER', 'purchase_order', 'g1-w3-po-other',
    'g1-w3-other-project', 'g1-w3-supplier', 'G1 W3 supplier', 'PO-G1-W3-OTHER', current_date,
    'VND', 80, 80, 0, 'open', '31111111-1111-4111-8111-111111111111'
  );

create function public.g1_w3_fail_allocation_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('g1_w3.fail_allocation_insert', true) = 'on' then
    raise exception 'G1_W3_INJECTED_ALLOCATION_FAILURE';
  end if;
  return new;
end;
$$;

create trigger g1_w3_fail_allocation_insert
before insert on public.supplier_payment_allocations
for each row execute function public.g1_w3_fail_allocation_insert();

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '31111111-1111-4111-8111-111111111111',
    'email', 'g1-w3-admin@example.test',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
declare
  v_batch_a jsonb := jsonb_build_object(
    'id', '32222222-2222-4222-8222-222222222221',
    'code', 'PAY-G1-W3-A',
    'project_id', 'g1-w3-project',
    'construction_site_id', null,
    'supplier_id', 'g1-w3-supplier',
    'supplier_name_snapshot', 'G1 W3 supplier',
    'payment_date', current_date,
    'payment_method', 'bank_transfer',
    'total_recognized_snapshot', 100,
    'payment_amount', 80,
    'currency', 'VND',
    'allocation_mode', 'manual',
    'status', 'draft',
    'qr_token', 'pay_g1_w3_a',
    'attachments', '[]'::jsonb,
    'metadata', '{}'::jsonb,
    'created_by', '31111111-1111-4111-8111-111111111111'
  );
  v_allocation_a jsonb := jsonb_build_array(jsonb_build_object(
    'payment_batch_id', '32222222-2222-4222-8222-222222222221',
    'payable_document_id', '33333333-3333-4333-8333-333333333331',
    'allocated_amount', 80,
    'discount_amount', 0,
    'withholding_amount', 0,
    'allocation_mode', 'manual'
  ));
  v_batch_b jsonb;
  v_allocation_b jsonb;
  v_result jsonb;
  v_posted public.supplier_payment_batches%rowtype;
  v_version bigint;
begin
  begin
    perform public.save_supplier_payment_batch_draft_v1(
      v_batch_a, v_allocation_a, null,
      '31111111-1111-4111-8111-111111111112',
      '34444444-4444-4444-8444-444444444440'
    );
    raise exception 'G1_W3_ACTOR_SPOOF_ACCEPTED';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '31111111-1111-4111-8111-111111111112',
      'email', 'g1-w3-other@example.test',
      'role', 'authenticated'
    )::text,
    true
  );
  begin
    perform public.save_supplier_payment_batch_draft_v1(
      v_batch_a || jsonb_build_object(
        'id', '32222222-2222-4222-8222-222222222229',
        'code', 'PAY-G1-W3-UNSCOPED',
        'created_by', '31111111-1111-4111-8111-111111111112'
      ),
      jsonb_build_array((v_allocation_a -> 0) || jsonb_build_object(
        'payment_batch_id', '32222222-2222-4222-8222-222222222229'
      )),
      null,
      '31111111-1111-4111-8111-111111111112',
      '34444444-4444-4444-8444-444444444449'
    );
    raise exception 'G1_W3_SCOPE_DENIAL_MISSING';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '31111111-1111-4111-8111-111111111111',
      'email', 'g1-w3-admin@example.test',
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.save_supplier_payment_batch_draft_v1(
      v_batch_a,
      jsonb_build_array((v_allocation_a -> 0) || jsonb_build_object('allocated_amount', 70)),
      null,
      '31111111-1111-4111-8111-111111111111',
      '34444444-4444-4444-8444-444444444441'
    );
    raise exception 'G1_W3_TOTAL_MISMATCH_ACCEPTED';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    perform public.save_supplier_payment_batch_draft_v1(
      v_batch_a || jsonb_build_object(
        'id', '32222222-2222-4222-8222-222222222228',
        'code', 'PAY-G1-W3-WRONG-AP-SCOPE',
        'qr_token', 'pay_g1_w3_wrong_ap_scope'
      ),
      jsonb_build_array((v_allocation_a -> 0) || jsonb_build_object(
        'payment_batch_id', '32222222-2222-4222-8222-222222222228',
        'payable_document_id', '33333333-3333-4333-8333-333333333339'
      )),
      null,
      '31111111-1111-4111-8111-111111111111',
      '34444444-4444-4444-8444-444444444448'
    );
    raise exception 'G1_W3_AP_SCOPE_MISMATCH_ACCEPTED';
  exception when insufficient_privilege then
    null;
  end;

  v_result := public.save_supplier_payment_batch_draft_v1(
    v_batch_a, v_allocation_a, null,
    '31111111-1111-4111-8111-111111111111',
    '34444444-4444-4444-8444-444444444442'
  );
  if v_result #>> '{paymentBatch,id}' <> '32222222-2222-4222-8222-222222222221'
     or (v_result #>> '{paymentBatch,row_version}')::bigint <> 1
     or (v_result ->> 'allocationCount')::integer <> 1
     or (v_result ->> 'replayed')::boolean then
    raise exception 'G1_W3_CREATE_RESULT_INVALID: %', v_result;
  end if;

  v_result := public.save_supplier_payment_batch_draft_v1(
    v_batch_a, v_allocation_a, null,
    '31111111-1111-4111-8111-111111111111',
    '34444444-4444-4444-8444-444444444442'
  );
  if not (v_result ->> 'replayed')::boolean
     or (select count(*) from public.supplier_payment_batches where id = '32222222-2222-4222-8222-222222222221') <> 1
     or (select count(*) from public.supplier_payment_allocations where payment_batch_id = '32222222-2222-4222-8222-222222222221') <> 1 then
    raise exception 'G1_W3_REPLAY_DUPLICATED_ROWS: %', v_result;
  end if;

  v_result := public.save_supplier_payment_batch_draft_v1(
    v_batch_a, v_allocation_a, 1,
    '31111111-1111-4111-8111-111111111111',
    '34444444-4444-4444-8444-444444444443'
  );
  if (v_result #>> '{paymentBatch,row_version}')::bigint <> 2 then
    raise exception 'G1_W3_UPDATE_VERSION_INVALID: %', v_result;
  end if;

  begin
    perform public.save_supplier_payment_batch_draft_v1(
      v_batch_a, v_allocation_a, 1,
      '31111111-1111-4111-8111-111111111111',
      '34444444-4444-4444-8444-444444444444'
    );
    raise exception 'G1_W3_STALE_VERSION_ACCEPTED';
  exception when serialization_failure then
    null;
  end;

  perform set_config('g1_w3.fail_allocation_insert', 'on', true);
  begin
    perform public.save_supplier_payment_batch_draft_v1(
      v_batch_a || jsonb_build_object('payment_amount', 75),
      jsonb_build_array((v_allocation_a -> 0) || jsonb_build_object('allocated_amount', 75)),
      2,
      '31111111-1111-4111-8111-111111111111',
      '34444444-4444-4444-8444-444444444445'
    );
    raise exception 'G1_W3_INJECTED_FAILURE_NOT_RAISED';
  exception when raise_exception then
    if sqlerrm <> 'G1_W3_INJECTED_ALLOCATION_FAILURE' then raise; end if;
  end;
  perform set_config('g1_w3.fail_allocation_insert', 'off', true);
  if (select payment_amount from public.supplier_payment_batches where id = '32222222-2222-4222-8222-222222222221') <> 80
     or (select row_version from public.supplier_payment_batches where id = '32222222-2222-4222-8222-222222222221') <> 2
     or (select sum(allocated_amount) from public.supplier_payment_allocations where payment_batch_id = '32222222-2222-4222-8222-222222222221') <> 80 then
    raise exception 'G1_W3_FAULT_DID_NOT_ROLL_BACK';
  end if;

  v_batch_b := v_batch_a || jsonb_build_object(
    'id', '32222222-2222-4222-8222-222222222222',
    'code', 'PAY-G1-W3-B',
    'payment_amount', 30,
    'qr_token', 'pay_g1_w3_b'
  );
  v_allocation_b := jsonb_build_array((v_allocation_a -> 0) || jsonb_build_object(
    'payment_batch_id', '32222222-2222-4222-8222-222222222222',
    'allocated_amount', 30
  ));
  perform public.save_supplier_payment_batch_draft_v1(
    v_batch_b, v_allocation_b, null,
    '31111111-1111-4111-8111-111111111111',
    '34444444-4444-4444-8444-444444444446'
  );

  v_posted := public.post_supplier_payment_batch(
    '32222222-2222-4222-8222-222222222221',
    '31111111-1111-4111-8111-111111111111'
  );
  if v_posted.status <> 'paid' then
    raise exception 'G1_W3_POST_DID_NOT_COMPLETE';
  end if;
  v_version := v_posted.row_version;

  v_posted := public.post_supplier_payment_batch(
    '32222222-2222-4222-8222-222222222221',
    '31111111-1111-4111-8111-111111111111'
  );
  if v_posted.row_version <> v_version
     or (select count(*) from public.project_transactions where source_ref = 'supplier_payment_batch:32222222-2222-4222-8222-222222222221') <> 1 then
    raise exception 'G1_W3_POST_REPLAY_CREATED_EFFECT';
  end if;

  begin
    perform public.post_supplier_payment_batch(
      '32222222-2222-4222-8222-222222222222',
      '31111111-1111-4111-8111-111111111111'
    );
    raise exception 'G1_W3_CONSUMED_CREDIT_REUSED';
  exception when check_violation then
    null;
  end;

  begin
    perform public.save_supplier_payment_batch_draft_v1(
      v_batch_a, v_allocation_a, v_version,
      '31111111-1111-4111-8111-111111111111',
      '34444444-4444-4444-8444-444444444447'
    );
    raise exception 'G1_W3_POSTED_DRAFT_MUTATED';
  exception when invalid_parameter_value then
    null;
  end;
end;
$$;

rollback;
