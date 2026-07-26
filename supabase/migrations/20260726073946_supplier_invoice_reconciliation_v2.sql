alter table public.supplier_payable_documents
  drop constraint if exists supplier_payable_documents_source_type_check;

alter table public.supplier_payable_documents
  add constraint supplier_payable_documents_source_type_check
  check (source_type in (
    'purchase_order',
    'purchase_delivery_receipt',
    'supplier_invoice_adjustment',
    'site_direct_purchase',
    'supplier_delivery_statement',
    'supplier_return_credit',
    'opening_balance',
    'manual_adjustment'
  ));

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id text not null,
  supplier_name_snapshot text not null,
  invoice_number text not null,
  invoice_date date not null,
  net_amount numeric not null check (net_amount >= 0),
  vat_amount numeric not null check (vat_amount >= 0),
  gross_amount numeric not null check (gross_amount >= 0),
  variance_reason text,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_supplier_invoice_header_number
  on public.supplier_invoices(supplier_id, lower(trim(invoice_number)));

create table if not exists public.supplier_invoice_payable_links (
  invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  payable_document_id uuid not null references public.supplier_payable_documents(id) on delete restrict,
  allocated_gross_amount numeric not null check (allocated_gross_amount > 0),
  created_at timestamptz not null default now(),
  primary key (invoice_id, payable_document_id)
);

create index if not exists idx_supplier_invoices_supplier_date_v2
  on public.supplier_invoices(supplier_id, invoice_date desc);

create index if not exists idx_supplier_invoice_links_payable_v2
  on public.supplier_invoice_payable_links(payable_document_id);

alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_payable_links enable row level security;

drop policy if exists supplier_invoices_access_v2 on public.supplier_invoices;
create policy supplier_invoices_access_v2
on public.supplier_invoices
for all to authenticated
using (
  exists (
    select 1
    from public.supplier_invoice_payable_links link
    join public.supplier_payable_documents ap
      on ap.id = link.payable_document_id
    where link.invoice_id = supplier_invoices.id
      and app_private.ap_scope_can_view(ap.project_id, ap.construction_site_id)
  )
)
with check (
  public.is_admin()
  or app_private.company_procurement_can_manage()
);

drop policy if exists supplier_invoice_links_access_v2 on public.supplier_invoice_payable_links;
create policy supplier_invoice_links_access_v2
on public.supplier_invoice_payable_links
for all to authenticated
using (
  exists (
    select 1
    from public.supplier_payable_documents ap
    where ap.id = supplier_invoice_payable_links.payable_document_id
      and app_private.ap_scope_can_view(ap.project_id, ap.construction_site_id)
  )
)
with check (
  exists (
    select 1
    from public.supplier_payable_documents ap
    where ap.id = supplier_invoice_payable_links.payable_document_id
      and app_private.ap_scope_can_mutate(ap.project_id, ap.construction_site_id)
  )
);

drop trigger if exists trg_supplier_invoices_updated_at on public.supplier_invoices;
create trigger trg_supplier_invoices_updated_at
before update on public.supplier_invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_audit_supplier_invoices on public.supplier_invoices;
create trigger trg_audit_supplier_invoices
after insert or update or delete on public.supplier_invoices
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_supplier_invoice_payable_links on public.supplier_invoice_payable_links;

revoke all on table public.supplier_invoices from public, anon, authenticated;
revoke all on table public.supplier_invoice_payable_links from public, anon, authenticated;
grant select, insert, update on table public.supplier_invoices to authenticated;
grant select, insert, update, delete on table public.supplier_invoice_payable_links to authenticated;

create or replace function app_private.record_supplier_invoice_reconciliation_v2(
  p_invoice jsonb,
  p_links jsonb,
  p_actor_user_id uuid
) returns public.supplier_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.supplier_invoices%rowtype;
  v_invoice_id uuid := coalesce(nullif(p_invoice ->> 'id', '')::uuid, gen_random_uuid());
  v_supplier_id text := nullif(trim(coalesce(p_invoice ->> 'supplierId', p_invoice ->> 'supplier_id')), '');
  v_supplier_name text := nullif(trim(coalesce(p_invoice ->> 'supplierNameSnapshot', p_invoice ->> 'supplier_name_snapshot')), '');
  v_invoice_number text := nullif(trim(coalesce(p_invoice ->> 'invoiceNumber', p_invoice ->> 'invoice_number')), '');
  v_invoice_date date := nullif(coalesce(p_invoice ->> 'invoiceDate', p_invoice ->> 'invoice_date'), '')::date;
  v_net_amount numeric(18,2) := round(coalesce(nullif(coalesce(p_invoice ->> 'netAmount', p_invoice ->> 'net_amount'), '')::numeric, 0), 2);
  v_vat_amount numeric(18,2) := round(coalesce(nullif(coalesce(p_invoice ->> 'vatAmount', p_invoice ->> 'vat_amount'), '')::numeric, 0), 2);
  v_gross_amount numeric(18,2) := round(coalesce(nullif(coalesce(p_invoice ->> 'grossAmount', p_invoice ->> 'gross_amount'), '')::numeric, 0), 2);
  v_variance_reason text := nullif(trim(coalesce(p_invoice ->> 'varianceReason', p_invoice ->> 'variance_reason', '')), '');
  v_attachments jsonb := coalesce(p_invoice -> 'attachments', '[]'::jsonb);
  v_link jsonb;
  v_payable_id uuid;
  v_allocated numeric(18,2);
  v_allocated_total numeric(18,2) := 0;
  v_estimated_total numeric(18,2) := 0;
  v_variance numeric(18,2);
  v_ap public.supplier_payable_documents%rowtype;
  v_project_id text := null;
  v_site_id text := null;
  v_project_finance_id text := null;
  v_adjustment_ref text;
  v_adjustment_id text;
begin
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thao tac khong hop le.' using errcode = '42501';
  end if;
  if v_supplier_id is null or v_supplier_name is null or v_invoice_number is null then
    raise exception 'Hoa don thieu NCC hoac so hoa don.' using errcode = '22023';
  end if;
  if v_gross_amount <= 0 or v_net_amount < 0 or v_vat_amount < 0 then
    raise exception 'Gia tri hoa don khong hop le.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array' or jsonb_array_length(p_links) = 0 then
    raise exception 'Hoa don phai link it nhat mot AP.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'Dinh kem hoa don phai la mang JSON.' using errcode = '22023';
  end if;

  for v_link in select value from jsonb_array_elements(p_links) as link(value)
  loop
    v_payable_id := nullif(coalesce(v_link ->> 'payableDocumentId', v_link ->> 'payable_document_id'), '')::uuid;
    v_allocated := round(coalesce(nullif(coalesce(v_link ->> 'allocatedGrossAmount', v_link ->> 'allocated_gross_amount'), '')::numeric, 0), 2);
    if v_payable_id is null or v_allocated <= 0 then
      raise exception 'Link AP hoa don khong hop le.' using errcode = '22023';
    end if;

    select * into v_ap
    from public.supplier_payable_documents
    where id = v_payable_id
    for update;
    if not found then
      raise exception 'Khong tim thay AP %.', v_payable_id using errcode = '22023';
    end if;
    if coalesce(v_ap.supplier_id, '') <> v_supplier_id then
      raise exception 'Tat ca AP duoc link phai cung nha cung cap voi hoa don.' using errcode = '22023';
    end if;
    if not app_private.ap_scope_can_mutate(v_ap.project_id, v_ap.construction_site_id) then
      raise exception 'Nguoi dung khong co quyen doi soat AP.' using errcode = '42501';
    end if;
    if v_project_id is null and v_site_id is null then
      v_project_id := v_ap.project_id;
      v_site_id := v_ap.construction_site_id;
    end if;

    v_allocated_total := round(v_allocated_total + v_allocated, 2);
    v_estimated_total := round(v_estimated_total + greatest(coalesce(v_ap.recognized_amount, 0) - coalesce(v_ap.credit_amount, 0), 0), 2);
  end loop;

  if v_allocated_total <> v_gross_amount then
    raise exception 'Tong phan bo AP phai bang tong tien hoa don.' using errcode = '22023';
  end if;

  v_variance := round(v_gross_amount - v_estimated_total, 2);
  if v_variance <> 0 and v_variance_reason is null then
    raise exception 'Hoa don lech AP phai co ly do chenh lech.' using errcode = '22023';
  end if;

  insert into public.supplier_invoices (
    id, supplier_id, supplier_name_snapshot, invoice_number, invoice_date,
    net_amount, vat_amount, gross_amount, variance_reason, attachments, created_by
  )
  values (
    v_invoice_id, v_supplier_id, v_supplier_name, v_invoice_number, v_invoice_date,
    v_net_amount, v_vat_amount, v_gross_amount, v_variance_reason, v_attachments, p_actor_user_id
  )
  returning * into v_invoice;

  for v_link in select value from jsonb_array_elements(p_links) as link(value)
  loop
    v_payable_id := nullif(coalesce(v_link ->> 'payableDocumentId', v_link ->> 'payable_document_id'), '')::uuid;
    v_allocated := round(coalesce(nullif(coalesce(v_link ->> 'allocatedGrossAmount', v_link ->> 'allocated_gross_amount'), '')::numeric, 0), 2);

    insert into public.supplier_invoice_payable_links (
      invoice_id, payable_document_id, allocated_gross_amount
    ) values (
      v_invoice_id, v_payable_id, v_allocated
    );

    update public.supplier_payable_documents
    set invoice_number = v_invoice_number,
        invoice_date = v_invoice_date,
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('supplierInvoiceId', v_invoice_id, 'supplierInvoiceNumber', v_invoice_number),
        updated_at = now()
    where id = v_payable_id;
  end loop;

  if v_variance <> 0 then
    select id into v_project_finance_id
    from public.project_finances
    where (v_project_id is not null and project_id = v_project_id)
       or (v_site_id is not null and construction_site_id = v_site_id)
    limit 1;

    v_adjustment_ref := 'supplier_invoice_adjustment:' || v_invoice_id::text;
    v_adjustment_id := 'supplier-invoice-adjustment-' || v_invoice_id::text;

    insert into public.project_transactions (
      id, "projectFinanceId", "constructionSiteId",
      project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source,
      "sourceRef", source_ref, contract_cost_item_id,
      cost_classification_status, counterparty_partner_id,
      counterparty_name, attachments, "createdBy", "createdAt"
    )
    values (
      v_adjustment_id,
      coalesce(v_project_finance_id, ''),
      coalesce(v_site_id, ''),
      v_project_id,
      nullif(v_project_finance_id, ''),
      v_site_id,
      'expense',
      'materials',
      v_variance,
      'Chênh lệch hóa đơn NCC ' || v_invoice_number,
      v_invoice_date::text,
      'workflow',
      v_adjustment_ref,
      v_adjustment_ref,
      null,
      'auto',
      null,
      v_supplier_name,
      v_attachments,
      p_actor_user_id::text,
      now()
    )
    on conflict (source_ref) do nothing;

    insert into public.supplier_payable_documents (
      code, source_type, source_id, project_id, construction_site_id,
      supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
      committed_amount, recognized_amount, credit_amount, status, qr_token,
      invoice_number, invoice_date, metadata, created_by
    )
    values (
      'AP-INV-ADJ-' || replace(v_invoice_id::text, '-', ''),
      'supplier_invoice_adjustment',
      v_invoice_id::text,
      v_project_id,
      v_site_id,
      v_supplier_id,
      v_supplier_name,
      v_invoice_number || '-ADJ',
      v_invoice_date,
      null,
      abs(v_variance),
      greatest(v_variance, 0),
      greatest(-v_variance, 0),
      case when v_variance > 0 then 'open' else 'paid' end,
      'ap_invoice_adj_' || replace(v_invoice_id::text, '-', ''),
      v_invoice_number,
      v_invoice_date,
      jsonb_build_object(
        'supplierInvoiceId', v_invoice_id,
        'supplierInvoiceNumber', v_invoice_number,
        'sourceRef', v_adjustment_ref,
        'varianceAmount', v_variance,
        'varianceReason', v_variance_reason
      ),
      p_actor_user_id
    )
    on conflict (source_type, source_id) do nothing;
  end if;

  if to_regclass('public.project_document_links') is not null then
    for v_link in select value from jsonb_array_elements(p_links) as link(value)
    loop
      v_payable_id := nullif(coalesce(v_link ->> 'payableDocumentId', v_link ->> 'payable_document_id'), '')::uuid;
      v_allocated := round(coalesce(nullif(coalesce(v_link ->> 'allocatedGrossAmount', v_link ->> 'allocated_gross_amount'), '')::numeric, 0), 2);
      insert into public.project_document_links (
        source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata
      )
      values (
        'supplier_payable_document', v_payable_id::text,
        'supplier_invoice', v_invoice_id::text,
        v_project_id,
        'invoiced_by',
        'active',
        jsonb_build_object('allocatedGrossAmount', v_allocated)
      )
      on conflict (source_type, source_id, target_type, target_id, relation_type) do update
      set status = excluded.status,
          metadata = coalesce(public.project_document_links.metadata, '{}'::jsonb) || excluded.metadata,
          updated_at = now();
    end loop;

    if v_variance <> 0 then
      insert into public.project_document_links (
        source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata
      )
      values (
        'supplier_invoice', v_invoice_id::text,
        'supplier_payable_document',
        (select id::text from public.supplier_payable_documents
         where source_type = 'supplier_invoice_adjustment' and source_id = v_invoice_id::text limit 1),
        v_project_id,
        'adjusts_ap',
        'active',
        jsonb_build_object('varianceAmount', v_variance)
      )
      on conflict (source_type, source_id, target_type, target_id, relation_type) do update
      set status = excluded.status,
          metadata = coalesce(public.project_document_links.metadata, '{}'::jsonb) || excluded.metadata,
          updated_at = now();

      insert into public.project_document_links (
        source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata
      )
      values (
        'supplier_invoice', v_invoice_id::text,
        'project_transaction', v_adjustment_id,
        v_project_id,
        'adjusts_cost',
        'active',
        jsonb_build_object('varianceAmount', v_variance)
      )
      on conflict (source_type, source_id, target_type, target_id, relation_type) do update
      set status = excluded.status,
          metadata = coalesce(public.project_document_links.metadata, '{}'::jsonb) || excluded.metadata,
          updated_at = now();
    end if;
  end if;

  return v_invoice;
end;
$$;

revoke all on function app_private.record_supplier_invoice_reconciliation_v2(jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function app_private.record_supplier_invoice_reconciliation_v2(jsonb, jsonb, uuid)
  to authenticated;

create or replace function public.record_supplier_invoice_reconciliation_v2(
  p_invoice jsonb,
  p_links jsonb,
  p_actor_user_id uuid
) returns public.supplier_invoices
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.record_supplier_invoice_reconciliation_v2(p_invoice, p_links, p_actor_user_id);
end;
$$;

revoke all on function public.record_supplier_invoice_reconciliation_v2(jsonb, jsonb, uuid)
  from public, anon;
grant execute on function public.record_supplier_invoice_reconciliation_v2(jsonb, jsonb, uuid)
  to authenticated;
