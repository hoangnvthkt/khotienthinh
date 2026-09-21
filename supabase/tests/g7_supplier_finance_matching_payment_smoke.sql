begin;

insert into public.users(id,name,email,username,role,is_active,account_status) values
('71111111-1111-4111-8111-111111111111','G7 Admin','g7-admin@example.test','g7-admin','ADMIN',true,'ACTIVE');
insert into public.projects(id,code,name,status) values
('g7-project-a','G7-A','G7 Project A','active'),('g7-project-b','G7-B','G7 Project B','active');
insert into public.business_partners(id,code,name,classifications) values
('g7-supplier','G7-SUP','G7 Supplier',array['supplier']);
insert into public.items(id,sku,name,category,unit,price_in,price_out,min_stock) values
('g7-item','G7-ITEM','G7 Item','test','bao',0,0,0);

insert into public.purchase_orders(id,project_id,vendor_id,vendor_name,po_number,order_date,status,items,total_amount) values
('g7-po-a','g7-project-a','g7-supplier','G7 Supplier',public.next_purchase_order_number_v2(),current_date::text,'delivered','[]',100),
('g7-po-b','g7-project-b','g7-supplier','G7 Supplier',public.next_purchase_order_number_v2(),current_date::text,'delivered','[]',100);
insert into public.purchase_order_delivery_batches(
  id,purchase_order_id,project_id,delivery_no,status,supplier_id,supplier_name_snapshot,vat_rate,received_at
) values
('71222222-2222-4222-8222-222222222221','g7-po-a','g7-project-a',1,'received','g7-supplier','G7 Supplier',0,now()),
('71222222-2222-4222-8222-222222222222','g7-po-b','g7-project-b',1,'received','g7-supplier','G7 Supplier',0,now());
insert into public.purchase_order_delivery_lines(
  id,delivery_batch_id,purchase_order_id,purchase_order_line_id,item_id,planned_qty,unit,
  stock_planned_qty,stock_unit,delivery_unit_price,delivered_qty,delivered_stock_qty,accepted_qty,accepted_stock_qty
) values
('71333333-3333-4333-8333-333333333331','71222222-2222-4222-8222-222222222221','g7-po-a','po-line-a','g7-item',10,'bao',10,'bao',10,10,10,10,10),
('71333333-3333-4333-8333-333333333332','71222222-2222-4222-8222-222222222222','g7-po-b','po-line-b','g7-item',10,'bao',10,'bao',10,10,10,10,10);
insert into public.supplier_payable_documents(
  id,code,source_type,source_id,project_id,supplier_id,supplier_name_snapshot,document_no,
  document_date,currency,committed_amount,recognized_amount,credit_amount,status,created_by
) values
('71444444-4444-4444-8444-444444444441','AP-G7-A','purchase_delivery_receipt','71222222-2222-4222-8222-222222222221','g7-project-a','g7-supplier','G7 Supplier','AP-G7-A',current_date,'VND',100,100,0,'open','71111111-1111-4111-8111-111111111111'),
('71444444-4444-4444-8444-444444444442','AP-G7-B','purchase_delivery_receipt','71222222-2222-4222-8222-222222222222','g7-project-b','g7-supplier','G7 Supplier','AP-G7-B',current_date,'VND',100,100,0,'open','71111111-1111-4111-8111-111111111111'),
('71444444-4444-4444-8444-444444444443','AP-G7-LEGACY','manual_adjustment','g7-legacy-ap','g7-project-b','g7-supplier','G7 Supplier','AP-G7-LEGACY',current_date,'VND',100,100,0,'open','71111111-1111-4111-8111-111111111111');

insert into public.supplier_payment_batches(
  id,code,project_id,supplier_id,supplier_name_snapshot,payment_date,payment_amount,currency,status,allocation_mode,created_by
) values
('71555555-5555-4555-8555-555555555551','PAY-G7-A','g7-project-a','g7-supplier','G7 Supplier',current_date,60,'VND','draft','manual','71111111-1111-4111-8111-111111111111');
insert into public.supplier_payment_allocations(
  payment_batch_id,payable_document_id,source_type,source_id,document_no_snapshot,
  recognized_amount_snapshot,paid_before_snapshot,outstanding_before_snapshot,allocated_amount,
  discount_amount,withholding_amount,allocation_mode
) values
('71555555-5555-4555-8555-555555555551','71444444-4444-4444-8444-444444444441','purchase_delivery_receipt','71222222-2222-4222-8222-222222222221','AP-G7-A',100,0,100,60,0,0,'manual');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','71111111-1111-4111-8111-111111111111','email','g7-admin@example.test','role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare
  v_result jsonb;
  v_invoice_id uuid;
  v_version bigint;
  v_period public.finance_accounting_period_locks%rowtype;
begin
  v_result := public.record_supplier_invoice_reconciliation_v3(
    jsonb_build_object('id','71666666-6666-4666-8666-666666666661','supplierId','g7-supplier','supplierNameSnapshot','G7 Supplier','invoiceNumber','INV-G7-PARTIAL','invoiceDate',current_date,'netAmount',54,'vatAmount',6,'grossAmount',60,'currency','VND','attachments','[]'::jsonb),
    jsonb_build_array(jsonb_build_object('payableDocumentId','71444444-4444-4444-8444-444444444441','allocatedNetAmount',54,'allocatedVatAmount',6,'allocatedGrossAmount',60)),
    jsonb_build_array(jsonb_build_object('payableDocumentId','71444444-4444-4444-8444-444444444441','deliveryLineId','71333333-3333-4333-8333-333333333331','quantity',6,'unit','bao','unitPrice',9,'netAmount',54,'vatAmount',6,'grossAmount',60,'priceSource','supplier_invoice')),
    'g7-invoice-partial'
  );
  if v_result #>> '{invoice,status}' <> 'posted'
     or (select invoiced_to_date from public.supplier_invoice_payable_balances where payable_document_id='71444444-4444-4444-8444-444444444441') <> 60
     or (select credit_amount from public.supplier_payable_documents where id='71444444-4444-4444-8444-444444444441') <> 0
     or exists(select 1 from public.supplier_payable_documents where source_type='supplier_invoice_adjustment')
     or exists(select 1 from public.project_transactions where source_ref like 'supplier_invoice_adjustment:%') then
    raise exception 'G7_PARTIAL_INVOICE_INVALID: %',v_result;
  end if;

  v_result := public.record_supplier_invoice_reconciliation_v3(
    jsonb_build_object('id','71666666-6666-4666-8666-666666666662','supplierId','g7-supplier','supplierNameSnapshot','G7 Supplier','invoiceNumber','INV-G7-MULTI','invoiceDate',current_date,'netAmount',80,'vatAmount',0,'grossAmount',80,'currency','VND','attachments','[]'::jsonb),
    jsonb_build_array(
      jsonb_build_object('payableDocumentId','71444444-4444-4444-8444-444444444441','allocatedNetAmount',40,'allocatedVatAmount',0,'allocatedGrossAmount',40),
      jsonb_build_object('payableDocumentId','71444444-4444-4444-8444-444444444442','allocatedNetAmount',40,'allocatedVatAmount',0,'allocatedGrossAmount',40)
    ),'[]'::jsonb,'g7-invoice-multi'
  );
  v_invoice_id := (v_result #>> '{invoice,id}')::uuid;
  v_version := (v_result #>> '{invoice,row_version}')::bigint;
  if (select count(distinct project_id) from public.supplier_invoice_payable_links where invoice_id=v_invoice_id) <> 2 then
    raise exception 'G7_MULTI_SCOPE_ATTRIBUTION_INVALID';
  end if;

  begin
    perform public.record_supplier_invoice_reconciliation_v3(
      jsonb_build_object('supplierId','g7-supplier','supplierNameSnapshot','G7 Supplier','invoiceNumber','INV-G7-OVER','invoiceDate',current_date,'netAmount',1,'vatAmount',0,'grossAmount',1,'currency','VND','attachments','[]'::jsonb),
      jsonb_build_array(jsonb_build_object('payableDocumentId','71444444-4444-4444-8444-444444444441','allocatedNetAmount',1,'allocatedVatAmount',0,'allocatedGrossAmount',1)),
      '[]'::jsonb,'g7-invoice-over'
    );
    raise exception 'G7_OVER_INVOICE_ACCEPTED';
  exception when check_violation then null;
  end;

  v_result := public.reverse_supplier_invoice_v1(v_invoice_id,v_version,'g7-invoice-reverse','Duplicate supplier invoice');
  if v_result #>> '{invoice,status}' <> 'reversed'
     or (select uninvoiced_amount from public.supplier_invoice_payable_balances where payable_document_id='71444444-4444-4444-8444-444444444441') <> 40 then
    raise exception 'G7_INVOICE_REVERSAL_INVALID: %',v_result;
  end if;

  v_period := public.set_finance_accounting_period_lock_v1('g7-project-a',null,'VND',current_date,current_date,true,'Month close',null);
  begin
    perform public.post_supplier_payment_batch_v2('71555555-5555-4555-8555-555555555551',1,'g7-payment-post');
    raise exception 'G7_LOCKED_PERIOD_PAYMENT_ACCEPTED';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'FINANCE_PERIOD_LOCKED' then raise; end if;
  end;
  v_period := public.set_finance_accounting_period_lock_v1('g7-project-a',null,'VND',current_date,current_date,false,'Reopen correction',v_period.row_version);
  v_result := public.post_supplier_payment_batch_v2('71555555-5555-4555-8555-555555555551',1,'g7-payment-post');
  if v_result #>> '{paymentBatch,status}' <> 'paid' then raise exception 'G7_PAYMENT_POST_INVALID: %',v_result; end if;
  v_version := (v_result #>> '{paymentBatch,row_version}')::bigint;
  v_result := public.post_supplier_payment_batch_v2('71555555-5555-4555-8555-555555555551',1,'g7-payment-post');
  if not (v_result->>'replayed')::boolean
     or (select count(*) from public.project_transactions where source_ref='supplier_payment_batch:71555555-5555-4555-8555-555555555551')<>1 then
    raise exception 'G7_PAYMENT_REPLAY_INVALID: %',v_result;
  end if;
  v_result := public.reverse_supplier_payment_batch_v2('71555555-5555-4555-8555-555555555551',v_version,'g7-payment-reverse','Wrong bank account');
  if v_result #>> '{paymentBatch,status}' <> 'reversed' then raise exception 'G7_PAYMENT_REVERSE_INVALID'; end if;

  v_result := public.get_supplier_finance_control_v1('g7-project-a',null,null);
  if jsonb_array_length(v_result->'layers')<>5
     or not exists(select 1 from jsonb_array_elements(v_result->'layers') layer where layer->>'layer'='ap') then
    raise exception 'G7_FINANCE_READ_MODEL_INVALID: %',v_result;
  end if;

  perform public.record_supplier_invoice_reconciliation_v2(
    jsonb_build_object('id','71666666-6666-4666-8666-666666666669','supplierId','g7-supplier','supplierNameSnapshot','G7 Supplier','invoiceNumber','INV-G7-V2-COMPAT','invoiceDate',current_date,'netAmount',100,'vatAmount',0,'grossAmount',100,'attachments','[]'::jsonb),
    jsonb_build_array(jsonb_build_object('payableDocumentId','71444444-4444-4444-8444-444444444443','allocatedGrossAmount',100)),
    '71111111-1111-4111-8111-111111111111'
  );
  if not exists(select 1 from public.supplier_invoice_payable_links where invoice_id='71666666-6666-4666-8666-666666666669' and payable_document_id='71444444-4444-4444-8444-444444444443' and allocated_net_amount=100 and allocated_vat_amount=0) then
    raise exception 'G7_V2_COMPATIBILITY_INVALID';
  end if;
end;
$$;

rollback;
