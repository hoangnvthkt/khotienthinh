-- Quy cách ở Tài chính (dòng giá chứng từ công nợ, chốt giá). Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261010181700_finance_spec_lines.sql --smoke supabase/tests/finance_spec_lines_smoke.sql
do $$
declare v_doc uuid; v_line jsonb; v_settle uuid; v_spec text;
begin
  -- 1. Dòng giá của chứng từ công nợ có dòng mang quy cách → JSON trả đúng quy cách.
  select d.id into v_doc from public.supplier_payable_documents d
  where exists (select 1 from app_private.finance_price_doc_lines(d.id) x where app_private.finance_price_line_spec(x.kind, x.line_id) is not null) limit 1;
  if v_doc is null then
    raise notice 'SKIP 1: chưa có chứng từ công nợ có quy cách';
  else
    select x into v_line from jsonb_array_elements(app_private.finance_doc_price_lines_json(v_doc)) x where x->>'specification' is not null limit 1;
    if v_line is null then raise exception 'FAIL 1 dòng giá thiếu quy cách: %', v_doc; end if;

    -- 2. Dòng chốt giá chụp quy cách lúc lập.
    insert into public.supplier_price_settlements (id, code, supplier_id, supplier_name_snapshot, basis, reason, status, delta_gross, increase_gross, created_by, agreement_date)
    select gen_random_uuid(), 'CG-SMOKE', d.supplier_id, d.supplier_name_snapshot, 'agreement', 'smoke', 'pending_approval', 0, 0,
      (select u.id from public.users u where u.is_active order by u.id limit 1), current_date
    from public.supplier_payable_documents d where d.id = v_doc returning id into v_settle;
    insert into public.supplier_price_settlement_lines (settlement_id, payable_document_id, source_kind, source_line_id, item_name, unit, qty, from_price, to_price, vat_rate, delta_gross)
    values (v_settle, v_doc, v_line->>'kind', (v_line->>'lineId')::uuid, v_line->>'itemName', v_line->>'unit', 1, 1, 1, 0, 0)
    returning specification into v_spec;
    if v_spec is distinct from v_line->>'specification' then raise exception 'FAIL 2 chốt giá thiếu quy cách: %', v_spec; end if;
  end if;
  raise notice 'finance_spec_lines_smoke OK';
end $$;
