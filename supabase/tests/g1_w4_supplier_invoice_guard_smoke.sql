begin;

insert into public.users (id, name, email, username, role, is_active, account_status)
values (
  '51111111-1111-4111-8111-111111111111',
  'G1 W4 Admin',
  'g1-w4-admin@example.test',
  'g1-w4-admin',
  'ADMIN',
  true,
  'ACTIVE'
);

insert into public.projects (id, code, name, status)
values
  ('g1-w4-project-a', 'G1-W4-A', 'G1 W4 project A', 'active'),
  ('g1-w4-project-b', 'G1-W4-B', 'G1 W4 project B', 'active');

insert into public.business_partners (id, code, name, classifications)
values ('g1-w4-supplier', 'G1-W4-SUPPLIER', 'G1 W4 supplier', array['supplier']);

insert into public.supplier_payable_documents (
  id, code, source_type, source_id, project_id, supplier_id,
  supplier_name_snapshot, document_no, document_date, currency,
  committed_amount, recognized_amount, credit_amount, status, created_by
) values
  (
    '53333333-3333-4333-8333-333333333331', 'AP-G1-W4-A', 'manual_adjustment', 'g1-w4-ap-a',
    'g1-w4-project-a', 'g1-w4-supplier', 'G1 W4 supplier', 'AP-G1-W4-A', current_date,
    'VND', 100, 100, 0, 'open', '51111111-1111-4111-8111-111111111111'
  ),
  (
    '53333333-3333-4333-8333-333333333332', 'AP-G1-W4-B', 'manual_adjustment', 'g1-w4-ap-b',
    'g1-w4-project-b', 'g1-w4-supplier', 'G1 W4 supplier', 'AP-G1-W4-B', current_date,
    'VND', 100, 100, 0, 'open', '51111111-1111-4111-8111-111111111111'
  );

create function public.g1_w4_fail_invoice_link_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('g1_w4.fail_invoice_link_insert', true) = 'on' then
    raise exception 'G1_W4_INJECTED_LINK_FAILURE';
  end if;
  return new;
end;
$$;

create trigger g1_w4_fail_invoice_link_insert
before insert on public.supplier_invoice_payable_links
for each row execute function public.g1_w4_fail_invoice_link_insert();

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '51111111-1111-4111-8111-111111111111',
    'email', 'g1-w4-admin@example.test',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
declare
  v_invoice_a jsonb := jsonb_build_object(
    'id', '52222222-2222-4222-8222-222222222221',
    'supplierId', 'g1-w4-supplier',
    'supplierNameSnapshot', 'G1 W4 supplier',
    'invoiceNumber', 'INV-G1-W4-A',
    'invoiceDate', current_date::text,
    'netAmount', 100,
    'vatAmount', 0,
    'grossAmount', 100,
    'varianceReason', null,
    'attachments', '[]'::jsonb
  );
  v_link_a jsonb := jsonb_build_array(jsonb_build_object(
    'payableDocumentId', '53333333-3333-4333-8333-333333333331',
    'allocatedGrossAmount', 100
  ));
  v_result public.supplier_invoices%rowtype;
begin
  begin
    perform public.record_supplier_invoice_reconciliation_v2(
      v_invoice_a || jsonb_build_object(
        'id', '52222222-2222-4222-8222-222222222229',
        'invoiceNumber', 'INV-G1-W4-PARTIAL',
        'netAmount', 60,
        'grossAmount', 60,
        'varianceReason', 'Partial invoice must not create AP credit'
      ),
      jsonb_build_array(jsonb_build_object(
        'payableDocumentId', '53333333-3333-4333-8333-333333333331',
        'allocatedGrossAmount', 60
      )),
      '51111111-1111-4111-8111-111111111111'
    );
    raise exception 'G1_W4_PARTIAL_INVOICE_ACCEPTED';
  exception when feature_not_supported then
    if sqlerrm <> 'SUPPLIER_INVOICE_COVERAGE_UNSUPPORTED' then raise; end if;
  end;

  if exists (
    select 1 from public.supplier_invoices
    where id = '52222222-2222-4222-8222-222222222229'
  ) or exists (
    select 1 from public.supplier_payable_documents
    where source_type = 'supplier_invoice_adjustment'
      and source_id = '52222222-2222-4222-8222-222222222229'
  ) then
    raise exception 'G1_W4_PARTIAL_GUARD_RAN_AFTER_EFFECT';
  end if;

  begin
    perform public.record_supplier_invoice_reconciliation_v2(
      v_invoice_a || jsonb_build_object(
        'id', '52222222-2222-4222-8222-222222222228',
        'invoiceNumber', 'INV-G1-W4-MULTI',
        'netAmount', 200,
        'grossAmount', 200
      ),
      jsonb_build_array(
        jsonb_build_object(
          'payableDocumentId', '53333333-3333-4333-8333-333333333331',
          'allocatedGrossAmount', 100
        ),
        jsonb_build_object(
          'payableDocumentId', '53333333-3333-4333-8333-333333333332',
          'allocatedGrossAmount', 100
        )
      ),
      '51111111-1111-4111-8111-111111111111'
    );
    raise exception 'G1_W4_MULTI_SCOPE_INVOICE_ACCEPTED';
  exception when feature_not_supported then
    if sqlerrm <> 'SUPPLIER_INVOICE_MULTI_SCOPE_UNSUPPORTED' then raise; end if;
  end;

  if exists (
    select 1 from public.supplier_invoices
    where id = '52222222-2222-4222-8222-222222222228'
  ) then
    raise exception 'G1_W4_MULTI_SCOPE_GUARD_RAN_AFTER_EFFECT';
  end if;

  perform set_config('g1_w4.fail_invoice_link_insert', 'on', true);
  begin
    perform public.record_supplier_invoice_reconciliation_v2(
      v_invoice_a || jsonb_build_object(
        'id', '52222222-2222-4222-8222-222222222227',
        'invoiceNumber', 'INV-G1-W4-FAULT'
      ),
      v_link_a,
      '51111111-1111-4111-8111-111111111111'
    );
    raise exception 'G1_W4_INJECTED_FAILURE_NOT_RAISED';
  exception when raise_exception then
    if sqlerrm <> 'G1_W4_INJECTED_LINK_FAILURE' then raise; end if;
  end;
  perform set_config('g1_w4.fail_invoice_link_insert', 'off', true);

  if exists (
    select 1 from public.supplier_invoices
    where id = '52222222-2222-4222-8222-222222222227'
  ) or exists (
    select 1 from public.supplier_invoice_payable_links
    where invoice_id = '52222222-2222-4222-8222-222222222227'
  ) or (
    select invoice_number from public.supplier_payable_documents
    where id = '53333333-3333-4333-8333-333333333331'
  ) is not null then
    raise exception 'G1_W4_INVOICE_FAILURE_DID_NOT_ROLL_BACK';
  end if;

  select * into v_result
  from public.record_supplier_invoice_reconciliation_v2(
    v_invoice_a,
    v_link_a,
    '51111111-1111-4111-8111-111111111111'
  );
  if v_result.id <> '52222222-2222-4222-8222-222222222221' then
    raise exception 'G1_W4_FULL_INVOICE_RESULT_INVALID';
  end if;

  select * into v_result
  from public.record_supplier_invoice_reconciliation_v2(
    v_invoice_a,
    v_link_a,
    '51111111-1111-4111-8111-111111111111'
  );
  if v_result.id <> '52222222-2222-4222-8222-222222222221'
     or (select count(*) from public.supplier_invoices where id = v_result.id) <> 1
     or (select count(*) from public.supplier_invoice_payable_links where invoice_id = v_result.id) <> 1 then
    raise exception 'G1_W4_RETRY_DUPLICATED_EFFECT';
  end if;

  begin
    perform public.record_supplier_invoice_reconciliation_v2(
      v_invoice_a || jsonb_build_object('supplierNameSnapshot', 'G1 W4 changed supplier name'),
      v_link_a,
      '51111111-1111-4111-8111-111111111111'
    );
    raise exception 'G1_W4_REPLAY_CONFLICT_ACCEPTED';
  exception when invalid_parameter_value then
    if sqlerrm <> 'SUPPLIER_INVOICE_REPLAY_CONFLICT' then raise; end if;
  end;

  if exists (
    select 1 from public.supplier_payable_documents
    where source_type = 'supplier_invoice_adjustment'
      and source_id = '52222222-2222-4222-8222-222222222221'
  ) or exists (
    select 1 from public.project_transactions
    where source_ref = 'supplier_invoice_adjustment:52222222-2222-4222-8222-222222222221'
  ) then
    raise exception 'G1_W4_FULL_EXACT_INVOICE_CREATED_ADJUSTMENT';
  end if;
end;
$$;

rollback;
