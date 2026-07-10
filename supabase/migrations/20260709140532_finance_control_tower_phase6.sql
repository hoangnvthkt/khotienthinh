create schema if not exists app_private;

alter table if exists public.supplier_delivery_statements enable row level security;
alter table if exists public.supplier_delivery_statement_lines enable row level security;
alter table if exists public.supplier_payable_documents enable row level security;
alter table if exists public.supplier_payment_batches enable row level security;
alter table if exists public.supplier_payment_allocations enable row level security;
alter table if exists public.site_direct_purchases enable row level security;
alter table if exists public.site_direct_purchase_lines enable row level security;
alter table if exists public.site_cash_settlement_batches enable row level security;
alter table if exists public.site_cash_settlement_lines enable row level security;

create or replace function app_private.audit_supplier_ap_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id text;
  v_description text;
begin
  v_record_id := case when tg_op = 'DELETE' then old.id::text else new.id::text end;
  v_description := case tg_table_name
    when 'supplier_delivery_statements' then 'Lưu vết đối soát HĐ NCC'
    when 'supplier_delivery_statement_lines' then 'Lưu vết dòng đối soát HĐ NCC'
    when 'supplier_payable_documents' then 'Lưu vết công nợ NCC'
    when 'supplier_payment_batches' then 'Lưu vết đợt thanh toán NCC'
    when 'supplier_payment_allocations' then 'Lưu vết phân bổ thanh toán NCC'
    when 'site_direct_purchases' then 'Lưu vết mua nóng công trường'
    when 'site_direct_purchase_lines' then 'Lưu vết dòng mua nóng công trường'
    when 'site_cash_settlement_batches' then 'Lưu vết hoàn ứng công trường'
    when 'site_cash_settlement_lines' then 'Lưu vết dòng hoàn ứng công trường'
    else 'Lưu vết chứng từ NCC'
  end;

  insert into public.audit_trail (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    user_id,
    user_name,
    module,
    description
  )
  values (
    tg_table_name,
    v_record_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end,
    public.current_app_user_id()::text,
    '',
    'TC',
    v_description
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  v_item record;
begin
  for v_item in
    select *
    from (
      values
        ('supplier_delivery_statements', 'trg_audit_supplier_delivery_statements'),
        ('supplier_delivery_statement_lines', 'trg_audit_supplier_delivery_statement_lines'),
        ('supplier_payable_documents', 'trg_audit_supplier_payable_documents'),
        ('supplier_payment_batches', 'trg_audit_supplier_payment_batches'),
        ('supplier_payment_allocations', 'trg_audit_supplier_payment_allocations'),
        ('site_direct_purchases', 'trg_audit_site_direct_purchases'),
        ('site_direct_purchase_lines', 'trg_audit_site_direct_purchase_lines'),
        ('site_cash_settlement_batches', 'trg_audit_site_cash_settlement_batches'),
        ('site_cash_settlement_lines', 'trg_audit_site_cash_settlement_lines')
    ) as t(table_name, trigger_name)
  loop
    if to_regclass('public.' || v_item.table_name) is not null then
      execute format('drop trigger if exists %I on public.%I', v_item.trigger_name, v_item.table_name);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function app_private.audit_supplier_ap_change()',
        v_item.trigger_name,
        v_item.table_name
      );
    end if;
  end loop;
end;
$$;

create index if not exists idx_supplier_payable_documents_phase6_scope_supplier_status_date
  on public.supplier_payable_documents(project_id, construction_site_id, supplier_id, status, document_date desc);

create index if not exists idx_supplier_payable_documents_phase6_source_status_date
  on public.supplier_payable_documents(source_type, source_id, status, document_date desc);

create index if not exists idx_supplier_payment_batches_phase6_scope_supplier_status_date_period
  on public.supplier_payment_batches(project_id, construction_site_id, supplier_id, status, payment_date desc, period_month);

create index if not exists idx_supplier_delivery_statements_phase6_scope_contract_status_period
  on public.supplier_delivery_statements(project_id, construction_site_id, supplier_contract_id, status, period_month);

create index if not exists idx_site_direct_purchases_phase6_scope_supplier_status_date
  on public.site_direct_purchases(project_id, construction_site_id, supplier_id, status, purchase_date desc);

create index if not exists idx_site_cash_settlement_batches_phase6_scope_status_period
  on public.site_cash_settlement_batches(project_id, construction_site_id, status, period_month);

create index if not exists idx_project_document_links_phase6_project_source_status
  on public.project_document_links(project_id, source_type, source_id, status);

create index if not exists idx_project_document_links_phase6_project_target_status
  on public.project_document_links(project_id, target_type, target_id, status);

revoke all on function app_private.audit_supplier_ap_change() from public, anon, authenticated;
