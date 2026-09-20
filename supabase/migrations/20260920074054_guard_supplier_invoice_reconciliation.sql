alter function app_private.record_supplier_invoice_reconciliation_v2(jsonb, jsonb, uuid)
  rename to record_supplier_invoice_reconciliation_v2_engine;

revoke all on function app_private.record_supplier_invoice_reconciliation_v2_engine(
  jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;

create or replace function app_private.record_supplier_invoice_reconciliation_v2(
  p_invoice jsonb,
  p_links jsonb,
  p_actor_user_id uuid
)
returns public.supplier_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.supplier_invoices%rowtype;
  v_requested_invoice_id uuid;
  v_invoice_id uuid;
  v_supplier_id text := nullif(trim(coalesce(p_invoice ->> 'supplierId', p_invoice ->> 'supplier_id')), '');
  v_supplier_name text := nullif(trim(coalesce(p_invoice ->> 'supplierNameSnapshot', p_invoice ->> 'supplier_name_snapshot')), '');
  v_invoice_number text := nullif(trim(coalesce(p_invoice ->> 'invoiceNumber', p_invoice ->> 'invoice_number')), '');
  v_invoice_date date;
  v_net_amount numeric(18,2);
  v_vat_amount numeric(18,2);
  v_gross_amount numeric(18,2);
  v_variance_reason text := nullif(trim(coalesce(p_invoice ->> 'varianceReason', p_invoice ->> 'variance_reason', '')), '');
  v_attachments jsonb := coalesce(p_invoice -> 'attachments', '[]'::jsonb);
  v_link jsonb;
  v_payable_id uuid;
  v_allocated numeric(18,2);
  v_allocated_total numeric(18,2) := 0;
  v_expected_coverage numeric(18,2);
  v_ap public.supplier_payable_documents%rowtype;
  v_link_count integer;
  v_distinct_link_count integer;
  v_scope_initialized boolean := false;
  v_project_id text;
  v_site_id text;
begin
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thao tac khong hop le.' using errcode = '42501';
  end if;

  begin
    v_requested_invoice_id := nullif(p_invoice ->> 'id', '')::uuid;
    v_invoice_date := nullif(coalesce(p_invoice ->> 'invoiceDate', p_invoice ->> 'invoice_date'), '')::date;
    v_net_amount := round(coalesce(nullif(coalesce(p_invoice ->> 'netAmount', p_invoice ->> 'net_amount'), '')::numeric, 0), 2);
    v_vat_amount := round(coalesce(nullif(coalesce(p_invoice ->> 'vatAmount', p_invoice ->> 'vat_amount'), '')::numeric, 0), 2);
    v_gross_amount := round(coalesce(nullif(coalesce(p_invoice ->> 'grossAmount', p_invoice ->> 'gross_amount'), '')::numeric, 0), 2);
  exception when invalid_text_representation then
    raise exception 'Hoa don khong hop le.' using errcode = '22023';
  end;

  if v_supplier_id is null or v_supplier_name is null or v_invoice_number is null or v_invoice_date is null then
    raise exception 'Hoa don thieu NCC, so hoa don hoac ngay hoa don.' using errcode = '22023';
  end if;
  if v_gross_amount <= 0 or v_net_amount < 0 or v_vat_amount < 0 then
    raise exception 'Gia tri hoa don khong hop le.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_links, '[]'::jsonb)) = 0 then
    raise exception 'Hoa don phai link it nhat mot AP.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'Dinh kem hoa don phai la mang JSON.' using errcode = '22023';
  end if;

  begin
    select count(*), count(distinct nullif(coalesce(
      link.value ->> 'payableDocumentId',
      link.value ->> 'payable_document_id'
    ), '')::uuid)
    into v_link_count, v_distinct_link_count
    from jsonb_array_elements(p_links) link(value);
  exception when invalid_text_representation then
    raise exception 'Link AP hoa don khong hop le.' using errcode = '22023';
  end;

  if v_link_count <> v_distinct_link_count then
    raise exception 'Moi AP chi duoc link mot lan trong hoa don.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'supplier-invoice:' || v_supplier_id || ':' || lower(v_invoice_number),
    0
  ));

  select * into v_invoice
  from public.supplier_invoices invoice
  where invoice.supplier_id = v_supplier_id
    and lower(trim(invoice.invoice_number)) = lower(v_invoice_number)
  for update;

  if found then
    if (v_requested_invoice_id is not null and v_requested_invoice_id <> v_invoice.id)
       or v_invoice.supplier_name_snapshot is distinct from v_supplier_name
       or v_invoice.invoice_date is distinct from v_invoice_date
       or v_invoice.net_amount is distinct from v_net_amount
       or v_invoice.vat_amount is distinct from v_vat_amount
       or v_invoice.gross_amount is distinct from v_gross_amount
       or v_invoice.variance_reason is distinct from v_variance_reason
       or v_invoice.attachments is distinct from v_attachments
       or (
         select count(*)
         from public.supplier_invoice_payable_links invoice_link
         where invoice_link.invoice_id = v_invoice.id
       ) <> v_link_count
       or exists (
         select 1
         from jsonb_array_elements(p_links) link(value)
         where not exists (
           select 1
           from public.supplier_invoice_payable_links invoice_link
           where invoice_link.invoice_id = v_invoice.id
             and invoice_link.payable_document_id = nullif(coalesce(
               link.value ->> 'payableDocumentId',
               link.value ->> 'payable_document_id'
             ), '')::uuid
             and invoice_link.allocated_gross_amount = round(coalesce(nullif(coalesce(
               link.value ->> 'allocatedGrossAmount',
               link.value ->> 'allocated_gross_amount'
             ), '')::numeric, 0), 2)
         )
       ) then
      raise exception 'SUPPLIER_INVOICE_REPLAY_CONFLICT' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.supplier_invoice_payable_links invoice_link
      join public.supplier_payable_documents document
        on document.id = invoice_link.payable_document_id
      where invoice_link.invoice_id = v_invoice.id
        and not app_private.ap_scope_can_mutate(document.project_id, document.construction_site_id)
    ) then
      raise exception 'Nguoi dung khong co quyen doi soat AP.' using errcode = '42501';
    end if;

    return v_invoice;
  end if;

  v_invoice_id := coalesce(v_requested_invoice_id, gen_random_uuid());

  perform document.id
  from public.supplier_payable_documents document
  where document.id in (
    select nullif(coalesce(
      link.value ->> 'payableDocumentId',
      link.value ->> 'payable_document_id'
    ), '')::uuid
    from jsonb_array_elements(p_links) link(value)
  )
  order by document.id
  for update;

  if (
    select count(*)
    from public.supplier_payable_documents document
    where document.id in (
      select nullif(coalesce(
        link.value ->> 'payableDocumentId',
        link.value ->> 'payable_document_id'
      ), '')::uuid
      from jsonb_array_elements(p_links) link(value)
    )
  ) <> v_distinct_link_count then
    raise exception 'Khong tim thay AP duoc link.' using errcode = '22023';
  end if;

  for v_link in
    select value
    from jsonb_array_elements(p_links) link(value)
    order by coalesce(value ->> 'payableDocumentId', value ->> 'payable_document_id')
  loop
    begin
      v_payable_id := nullif(coalesce(
        v_link ->> 'payableDocumentId',
        v_link ->> 'payable_document_id'
      ), '')::uuid;
      v_allocated := round(coalesce(nullif(coalesce(
        v_link ->> 'allocatedGrossAmount',
        v_link ->> 'allocated_gross_amount'
      ), '')::numeric, 0), 2);
    exception when invalid_text_representation then
      raise exception 'Link AP hoa don khong hop le.' using errcode = '22023';
    end;

    if v_payable_id is null or v_allocated <= 0 then
      raise exception 'Link AP hoa don khong hop le.' using errcode = '22023';
    end if;

    select * into strict v_ap
    from public.supplier_payable_documents document
    where document.id = v_payable_id;

    if coalesce(v_ap.supplier_id, '') <> v_supplier_id then
      raise exception 'Tat ca AP duoc link phai cung nha cung cap voi hoa don.' using errcode = '22023';
    end if;
    if not app_private.ap_scope_can_mutate(v_ap.project_id, v_ap.construction_site_id) then
      raise exception 'Nguoi dung khong co quyen doi soat AP.' using errcode = '42501';
    end if;
    if v_ap.status in ('cancelled', 'reversed') then
      raise exception 'AP khong con hop le de doi soat hoa don.' using errcode = '22023';
    end if;

    if not v_scope_initialized then
      v_project_id := v_ap.project_id;
      v_site_id := v_ap.construction_site_id;
      v_scope_initialized := true;
    elsif v_ap.project_id is distinct from v_project_id
       or v_ap.construction_site_id is distinct from v_site_id then
      raise exception 'SUPPLIER_INVOICE_MULTI_SCOPE_UNSUPPORTED' using errcode = '0A000';
    end if;

    if exists (
      select 1
      from public.supplier_invoice_payable_links invoice_link
      where invoice_link.payable_document_id = v_payable_id
    ) then
      raise exception 'AP da duoc doi soat voi hoa don khac.' using errcode = '23505';
    end if;

    v_expected_coverage := round(greatest(
      coalesce(v_ap.recognized_amount, 0) - coalesce(v_ap.credit_amount, 0),
      0
    ), 2);
    if v_expected_coverage <= 0 or v_allocated <> v_expected_coverage then
      raise exception 'SUPPLIER_INVOICE_COVERAGE_UNSUPPORTED' using errcode = '0A000';
    end if;

    v_allocated_total := round(v_allocated_total + v_allocated, 2);
  end loop;

  if v_allocated_total <> v_gross_amount then
    raise exception 'Tong phan bo AP phai bang tong tien hoa don.' using errcode = '22023';
  end if;

  return app_private.record_supplier_invoice_reconciliation_v2_engine(
    p_invoice || jsonb_build_object('id', v_invoice_id),
    p_links,
    p_actor_user_id
  );
end;
$$;

revoke all on function app_private.record_supplier_invoice_reconciliation_v2(
  jsonb, jsonb, uuid
) from public, anon;
grant execute on function app_private.record_supplier_invoice_reconciliation_v2(
  jsonb, jsonb, uuid
) to authenticated, service_role;
