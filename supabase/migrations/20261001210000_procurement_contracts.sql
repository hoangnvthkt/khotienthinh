-- Mua hàng M2b — Hợp đồng nguyên tắc (chủ sản phẩm duyệt 01/10/2026).
--
-- * Công trường gọi thẳng NCC theo HĐ đã ký và nhập phiếu giao từng chuyến (như nay).
-- * Đơn giá khai trong HĐ, có ngày hiệu lực khi đổi giá; phiếu giao tự áp giá theo ngày giao.
-- * Lũy kế theo HĐ và theo vật tư, so với giá trị HĐ / hạn mức (cảnh báo 80% và 100%).
-- * Cuối tháng Mua hàng gom mọi phiếu giao của HĐ vào MỘT bảng đối soát, chốt với NCC;
--   kế toán dự án (Room Thanh toán — Xác nhận) hoặc Admin ghi công nợ. Người ghi công nợ
--   không phải người chốt. Công trường không tự lập đối soát / ghi công nợ nữa.

alter table public.supplier_contract_lines
  add column effective_from date,
  add column effective_to date,
  add constraint supplier_contract_lines_effective_range check (effective_to is null or effective_from is null or effective_to >= effective_from);

alter table public.supplier_delivery_statements drop constraint supplier_delivery_statements_status_check;
alter table public.supplier_delivery_statements add constraint supplier_delivery_statements_status_check
  check (status = any (array['draft', 'confirmed', 'posted', 'cancelled', 'reversed']));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Contract price of an item on a date: the latest line whose validity covers the date.
create function app_private.procurement_contract_price(p_contract_id text, p_item_id text, p_date date)
returns table (line_id uuid, unit_price numeric, vat_rate numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, l.unit_price, l.vat_rate from public.supplier_contract_lines l
  where l.supplier_contract_id = p_contract_id and l.item_id = p_item_id
    and (l.effective_from is null or l.effective_from <= coalesce(p_date, current_date))
    and (l.effective_to is null or l.effective_to >= coalesce(p_date, current_date))
  order by l.effective_from desc nulls last, l.line_no desc limit 1;
$$;

-- Accepted delivery lines of supplier contracts with the price that applies to each.
create function app_private.procurement_contract_delivery_lines()
returns table (contract_id text, note_id uuid, note_code text, ticket_no text, delivery_date date, project_id text, site_id text,
  line_id uuid, item_id text, item_name text, unit text, qty numeric, wms_ready boolean,
  statement_id uuid, statement_code text, statement_status text,
  unit_price numeric, vat_rate numeric, price_source text, amount numeric)
language sql stable security definer set search_path = '' as $$
  select n.supplier_contract_id, n.id, n.code, n.delivery_ticket_no, n.delivery_date, n.project_id, n.construction_site_id,
    l.id, l.item_id, l.item_name_snapshot, l.unit_snapshot, coalesce(nullif(l.accepted_quantity, 0), l.quantity),
    coalesce(l.wms_flow_mode, 'none') <> 'direct_in_out' or coalesce(l.wms_status, 'not_required') = 'exported',
    s.id, s.code, s.status,
    coalesce(sl.unit_price_snapshot, cp.unit_price, nullif(l.unit_price, 0)),
    coalesce(sl.vat_rate_snapshot, cp.vat_rate, l.vat_rate, 0),
    case when sl.id is not null then 'statement' when cp.line_id is not null then 'contract'
      when coalesce(l.unit_price, 0) > 0 then 'note' else 'missing' end,
    coalesce(sl.accepted_amount, round(coalesce(nullif(l.accepted_quantity, 0), l.quantity)
      * coalesce(cp.unit_price, nullif(l.unit_price, 0)), 0))
  from public.supplier_direct_delivery_notes n
  join public.supplier_direct_delivery_lines l on l.delivery_note_id = n.id and l.status in ('accepted', 'adjusted')
  left join lateral (
    select x.id, x.unit_price_snapshot, x.vat_rate_snapshot, x.accepted_amount, x.statement_id
    from public.supplier_delivery_statement_lines x join public.supplier_delivery_statements y on y.id = x.statement_id
    where x.delivery_line_id = l.id and y.status in ('draft', 'confirmed', 'posted') limit 1) sl on true
  left join public.supplier_delivery_statements s on s.id = sl.statement_id
  left join lateral app_private.procurement_contract_price(n.supplier_contract_id, l.item_id, n.delivery_date) cp on true
  where n.supplier_contract_id is not null and n.status not in ('cancelled', 'rejected', 'draft');
$$;

create function app_private.procurement_statement_accountant_ok(p_actor uuid, p_project_id text, p_site_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or app_private.project_actor_has_effective_room_action(p_actor, p_project_id, p_site_id, 'payment', 'confirm');
$$;

-- ---------------------------------------------------------------------------
-- Danh sách và chi tiết HĐ nguyên tắc
-- ---------------------------------------------------------------------------
create function public.list_procurement_contracts_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with dl as materialized (select * from app_private.procurement_contract_delivery_lines()),
    agg as (
      select contract_id, count(distinct note_id) notes, max(delivery_date) last_date,
        coalesce(sum(amount), 0) delivered_value, count(*) filter (where price_source = 'missing') unpriced,
        count(*) filter (where statement_id is null) open_lines,
        coalesce(sum(amount) filter (where statement_status = 'posted'), 0) posted_value
      from dl group by 1
    ),
    months as (
      select contract_id, jsonb_agg(jsonb_build_object('month', m, 'lines', n, 'value', v, 'unpriced', u) order by m) open_months
      from (select contract_id, date_trunc('month', delivery_date)::date m, count(*) n, coalesce(sum(amount), 0) v,
              count(*) filter (where price_source = 'missing') u
            from dl where statement_id is null group by 1, 2) z group by 1
    ),
    limits as (
      select l.supplier_contract_id contract_id, count(*) filter (where pct >= 80) near_n, count(*) filter (where pct >= 100) over_n
      from (select l.supplier_contract_id, l.item_id,
              greatest(case when max(l.quantity_limit) > 0 then coalesce((select sum(d.qty) from dl d where d.contract_id = l.supplier_contract_id and d.item_id = l.item_id), 0) / max(l.quantity_limit) * 100 end,
                case when max(l.amount_limit) > 0 then coalesce((select sum(d.amount) from dl d where d.contract_id = l.supplier_contract_id and d.item_id = l.item_id), 0) / max(l.amount_limit) * 100 end) pct
            from public.supplier_contract_lines l group by 1, 2) l group by 1
    ),
    rows as (
      select c.*, pr.code project_code, pr.name project_name, a.notes, a.last_date, a.delivered_value, a.unpriced, a.open_lines, a.posted_value,
        m.open_months, coalesce(li.near_n, 0) limit_near, coalesce(li.over_n, 0) limit_over,
        (select count(*) from public.supplier_contract_lines x where x.supplier_contract_id = c.id) price_lines,
        (select count(*) from public.supplier_delivery_statements s where s.supplier_contract_id = c.id and s.status in ('draft', 'confirmed')) open_statements
      from public.supplier_contracts c
      left join public.projects pr on pr.id = c.project_id
      left join agg a on a.contract_id = c.id
      left join months m on m.contract_id = c.id
      left join limits li on li.contract_id = c.id
      where coalesce(c.status, '') <> 'cancelled'
        and (nullif(v_filter->>'projectId', '') is null or c.project_id = v_filter->>'projectId')
        and (nullif(v_filter->>'search', '') is null or lower(concat_ws(' ', c.code, c.name, c.supplier_name, pr.code))
          like '%' || lower(v_filter->>'search') || '%')
    )
    select jsonb_build_object(
      'canManage', app_private.procurement_can('manage'),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'code', r.code, 'name', r.name, 'type', r.type, 'status', r.status,
          'supplierId', r.supplier_id, 'supplierName', r.supplier_name, 'projectId', r.project_id, 'projectCode', r.project_code,
          'projectName', r.project_name, 'constructionSiteId', r.construction_site_id, 'value', r.value,
          'signedDate', r.signed_date, 'effectiveDate', r.effective_date, 'expiryDate', r.expiry_date,
          'priceLines', r.price_lines, 'deliveryNotes', coalesce(r.notes, 0), 'lastDeliveryDate', r.last_date,
          'deliveredValue', coalesce(r.delivered_value, 0), 'postedValue', coalesce(r.posted_value, 0),
          'unpricedLines', coalesce(r.unpriced, 0), 'openLines', coalesce(r.open_lines, 0),
          'openMonths', coalesce(r.open_months, '[]'::jsonb), 'openStatements', r.open_statements,
          'usagePct', case when coalesce(r.value, 0) > 0 then round(coalesce(r.delivered_value, 0) / r.value * 100, 1) end,
          'limitNear', r.limit_near, 'limitOver', r.limit_over)
        order by (coalesce(r.open_lines, 0) > 0) desc, r.last_date desc nulls last, r.code) from rows r), '[]'::jsonb)
    )
  );
end;
$$;

create function public.get_procurement_contract_v1(p_contract_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c public.supplier_contracts%rowtype; v_actor uuid := public.current_app_user_id();
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select * into v_c from public.supplier_contracts where id = p_contract_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  return (
    with dl as materialized (select * from app_private.procurement_contract_delivery_lines() where contract_id = p_contract_id)
    select jsonb_build_object(
      'id', v_c.id, 'code', v_c.code, 'name', v_c.name, 'type', v_c.type, 'status', v_c.status,
      'supplierId', v_c.supplier_id, 'supplierName', v_c.supplier_name, 'projectId', v_c.project_id,
      'projectCode', (select code from public.projects where id = v_c.project_id), 'projectName', (select name from public.projects where id = v_c.project_id),
      'constructionSiteId', v_c.construction_site_id, 'value', v_c.value, 'paymentTerms', v_c.payment_terms,
      'signedDate', v_c.signed_date, 'effectiveDate', v_c.effective_date, 'expiryDate', v_c.expiry_date,
      'canManage', app_private.procurement_can('manage'),
      'priceLines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lineNo', l.line_no, 'itemId', l.item_id,
          'sku', coalesce(l.sku_snapshot, i.sku), 'name', coalesce(i.name, l.item_name_snapshot), 'unit', coalesce(l.unit_snapshot, i.unit),
          'unitPrice', l.unit_price, 'vatRate', l.vat_rate, 'quantityLimit', l.quantity_limit, 'amountLimit', l.amount_limit,
          'effectiveFrom', l.effective_from, 'effectiveTo', l.effective_to, 'note', l.note,
          'used', exists (select 1 from public.supplier_direct_delivery_lines d where d.supplier_contract_line_id = l.id))
        order by coalesce(i.name, l.item_name_snapshot), l.effective_from nulls first)
        from public.supplier_contract_lines l left join public.items i on i.id = l.item_id where l.supplier_contract_id = p_contract_id), '[]'::jsonb),
      'usage', coalesce((select jsonb_agg(u order by u->>'name') from (
          select jsonb_build_object('itemId', d.item_id, 'name', max(d.item_name), 'unit', max(d.unit),
            'deliveredQty', sum(d.qty), 'deliveredValue', sum(d.amount), 'unpricedLines', count(*) filter (where d.price_source = 'missing'),
            'quantityLimit', (select max(l.quantity_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'amountLimit', (select max(l.amount_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'currentPrice', (select cp.unit_price from app_private.procurement_contract_price(p_contract_id, d.item_id, current_date) cp)) u
          from dl d group by d.item_id) z), '[]'::jsonb),
      'deliveries', coalesce((select jsonb_agg(jsonb_build_object('noteId', n.note_id, 'code', n.note_code, 'ticketNo', n.ticket_no,
          'date', n.delivery_date, 'lines', n.lines) order by n.delivery_date desc, n.note_code desc)
        from (select note_id, note_code, ticket_no, delivery_date, jsonb_agg(jsonb_build_object('lineId', line_id, 'itemId', item_id,
                'name', item_name, 'unit', unit, 'qty', qty, 'unitPrice', unit_price, 'vatRate', vat_rate, 'priceSource', price_source,
                'amount', amount, 'wmsReady', wms_ready, 'statementId', statement_id, 'statementCode', statement_code,
                'statementStatus', statement_status) order by item_name) lines
              from dl group by 1, 2, 3, 4 order by delivery_date desc limit 200) n), '[]'::jsonb),
      'statements', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'periodMonth', s.period_month,
          'status', s.status, 'grossAmount', s.gross_amount, 'vatAmount', s.vat_amount, 'totalAmount', s.total_amount,
          'lineCount', (select count(*) from public.supplier_delivery_statement_lines x where x.statement_id = s.id),
          'createdByName', (select name from public.users where id = s.created_by), 'postedAt', s.posted_at,
          'postedByName', (select name from public.users where id = s.posted_by),
          'confirmedByName', s.metadata->>'confirmedByName', 'confirmedAt', s.metadata->>'confirmedAt',
          'returnReason', s.metadata->>'returnReason', 'note', s.note,
          'canPost', s.status = 'confirmed' and app_private.procurement_statement_accountant_ok(v_actor, s.project_id, s.construction_site_id)
            and coalesce(s.metadata->>'confirmedBy', '') <> v_actor::text)
        order by s.period_month desc, s.created_at desc) from public.supplier_delivery_statements s where s.supplier_contract_id = p_contract_id), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Đơn giá HĐ (có ngày hiệu lực)
-- ---------------------------------------------------------------------------
create function public.save_procurement_contract_lines_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.supplier_contracts%rowtype; ln jsonb; v_item record; v_id uuid; v_no integer; v_n integer := 0;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_c from public.supplier_contracts where id = p_input->>'contractId' for update;
  if not found or coalesce(v_c.status, '') = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;

  if jsonb_typeof(p_input->'deleteIds') = 'array' then
    if exists (select 1 from jsonb_array_elements_text(p_input->'deleteIds') d
               join public.supplier_direct_delivery_lines x on x.supplier_contract_line_id = d::uuid) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_LINE_IN_USE'; end if;
    delete from public.supplier_contract_lines where supplier_contract_id = v_c.id
      and id in (select d::uuid from jsonb_array_elements_text(p_input->'deleteIds') d);
  end if;

  for ln in select value from jsonb_array_elements(coalesce(p_input->'lines', '[]'::jsonb)) loop
    select i.id, i.name, i.sku, i.unit into v_item from public.items i where i.id = ln->>'itemId';
    if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_ITEM_INVALID'; end if;
    if coalesce(nullif(ln->>'unitPrice', '')::numeric, -1) < 0 or coalesce(nullif(ln->>'vatRate', '')::numeric, 0) not between 0 and 100
      or coalesce(nullif(ln->>'quantityLimit', '')::numeric, 0) < 0 or coalesce(nullif(ln->>'amountLimit', '')::numeric, 0) < 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if nullif(ln->>'effectiveTo', '')::date < nullif(ln->>'effectiveFrom', '')::date then
      raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_DATE_INVALID'; end if;
    v_id := nullif(ln->>'id', '')::uuid;
    if v_id is null then
      select coalesce(max(line_no), 0) + 1 into v_no from public.supplier_contract_lines where supplier_contract_id = v_c.id;
      insert into public.supplier_contract_lines (supplier_contract_id, line_no, item_id, sku_snapshot, item_name_snapshot, unit_snapshot,
        unit_price, vat_rate, quantity_limit, amount_limit, effective_from, effective_to, note)
      values (v_c.id, v_no, v_item.id, v_item.sku, v_item.name, v_item.unit, (ln->>'unitPrice')::numeric,
        coalesce(nullif(ln->>'vatRate', '')::numeric, 0), nullif(ln->>'quantityLimit', '')::numeric, nullif(ln->>'amountLimit', '')::numeric,
        nullif(ln->>'effectiveFrom', '')::date, nullif(ln->>'effectiveTo', '')::date, nullif(btrim(ln->>'note'), ''))
      returning id into v_id;
    else
      update public.supplier_contract_lines set item_id = v_item.id, sku_snapshot = v_item.sku, item_name_snapshot = v_item.name,
        unit_snapshot = v_item.unit, unit_price = (ln->>'unitPrice')::numeric, vat_rate = coalesce(nullif(ln->>'vatRate', '')::numeric, 0),
        quantity_limit = nullif(ln->>'quantityLimit', '')::numeric, amount_limit = nullif(ln->>'amountLimit', '')::numeric,
        effective_from = nullif(ln->>'effectiveFrom', '')::date, effective_to = nullif(ln->>'effectiveTo', '')::date,
        note = nullif(btrim(ln->>'note'), '')
      where id = v_id and supplier_contract_id = v_c.id;
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_LINE_INVALID'; end if;
    end if;
    v_n := v_n + 1;
  end loop;

  -- Two prices of the same item may not both apply on one day.
  if exists (select 1 from public.supplier_contract_lines a join public.supplier_contract_lines b
      on b.supplier_contract_id = a.supplier_contract_id and b.item_id = a.item_id and b.id > a.id
    where a.supplier_contract_id = v_c.id
      and coalesce(a.effective_from, '-infinity'::date) <= coalesce(b.effective_to, 'infinity'::date)
      and coalesce(b.effective_from, '-infinity'::date) <= coalesce(a.effective_to, 'infinity'::date)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_PRICE_OVERLAP'; end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('need', 'contract:' || v_c.id, 'contract_prices', public.current_app_user_id(), jsonb_build_object('saved', v_n));
  return jsonb_build_object('contractId', v_c.id, 'saved', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bảng đối soát tháng: Mua hàng lập & chốt, kế toán ghi công nợ
-- ---------------------------------------------------------------------------
create function public.save_procurement_contract_statement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.supplier_contracts%rowtype;
  v_s public.supplier_delivery_statements%rowtype;
  v_id uuid := nullif(p_input->>'statementId', '')::uuid;
  v_month date := date_trunc('month', nullif(p_input->>'month', '')::date)::date;
  v_scopes integer; v_project text; v_site text; v_n integer;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_c from public.supplier_contracts where id = p_input->>'contractId';
  if not found or coalesce(v_c.status, '') = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  if v_month is null or jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_EMPTY'; end if;

  create temp table if not exists pg_temp.stmt_lines (line_id uuid primary key, unit_price numeric, vat_rate numeric) on commit drop;
  truncate pg_temp.stmt_lines;
  insert into pg_temp.stmt_lines select (x->>'deliveryLineId')::uuid, (x->>'unitPrice')::numeric, coalesce(nullif(x->>'vatRate', '')::numeric, 0)
  from jsonb_array_elements(p_input->'lines') x;
  if exists (select 1 from pg_temp.stmt_lines where unit_price is null or unit_price < 0 or vat_rate not between 0 and 100) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;

  -- Every line: accepted delivery of this contract in the month, WMS done, not in another open/posted statement.
  if exists (select 1 from pg_temp.stmt_lines t
    left join app_private.procurement_contract_delivery_lines() d on d.line_id = t.line_id and d.contract_id = v_c.id
    where d.line_id is null or date_trunc('month', d.delivery_date)::date <> v_month or not d.wms_ready
      or (d.statement_id is not null and d.statement_id is distinct from v_id)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_LINE_INVALID'; end if;
  select count(distinct coalesce(n.project_id, '') || '|' || coalesce(n.construction_site_id, '')), min(n.project_id), min(n.construction_site_id)
  into v_scopes, v_project, v_site
  from pg_temp.stmt_lines t join public.supplier_direct_delivery_lines l on l.id = t.line_id
  join public.supplier_direct_delivery_notes n on n.id = l.delivery_note_id;
  if v_scopes <> 1 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.supplier_delivery_statements (id, code, project_id, construction_site_id, supplier_contract_id, supplier_contract_code,
      supplier_id, supplier_name_snapshot, period_month, statement_date, status, gross_amount, vat_amount, total_amount, metadata, created_by, note)
    values (v_id, 'DCHD-' || to_char(v_month, 'YYYYMM') || '-' || upper(substr(md5(v_id::text), 1, 6)), v_project, v_site, v_c.id, v_c.code,
      v_c.supplier_id, coalesce(nullif(v_c.supplier_name, ''), 'Nhà cung cấp'), v_month, current_date, 'draft', 0, 0, 0,
      jsonb_build_object('channel', 'procurement_hub'), v_actor, nullif(btrim(p_input->>'note'), ''))
    returning * into v_s;
  else
    select * into v_s from public.supplier_delivery_statements where id = v_id and supplier_contract_id = v_c.id for update;
    if not found or v_s.status <> 'draft' then raise exception using errcode = '42501', message = 'PROCUREMENT_STATEMENT_NOT_EDITABLE'; end if;
    delete from public.supplier_delivery_statement_lines where statement_id = v_id;
    update public.supplier_delivery_statements set note = nullif(btrim(p_input->>'note'), ''), statement_date = current_date,
      metadata = metadata - 'returnReason' where id = v_id;
  end if;

  insert into public.supplier_delivery_statement_lines (statement_id, delivery_note_id, delivery_line_id, supplier_contract_id,
    item_name_snapshot, unit_snapshot, accepted_quantity, unit_price_snapshot, vat_rate_snapshot, accepted_amount, vat_amount, total_amount)
  select v_id, l.delivery_note_id, l.id, v_c.id, l.item_name_snapshot, l.unit_snapshot, q.qty, t.unit_price, t.vat_rate,
    round(q.qty * t.unit_price, 0), round(round(q.qty * t.unit_price, 0) * t.vat_rate / 100, 0),
    round(q.qty * t.unit_price, 0) + round(round(q.qty * t.unit_price, 0) * t.vat_rate / 100, 0)
  from pg_temp.stmt_lines t join public.supplier_direct_delivery_lines l on l.id = t.line_id
  cross join lateral (select coalesce(nullif(l.accepted_quantity, 0), l.quantity) qty) q;
  get diagnostics v_n = row_count;
  update public.supplier_delivery_statements s set
    gross_amount = x.g, vat_amount = x.v, total_amount = x.t
  from (select coalesce(sum(accepted_amount), 0) g, coalesce(sum(vat_amount), 0) v, coalesce(sum(total_amount), 0) t
        from public.supplier_delivery_statement_lines where statement_id = v_id) x
  where s.id = v_id returning s.* into v_s;
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('statementId', v_id, 'code', v_s.code, 'lines', v_n, 'totalAmount', v_s.total_amount);
end;
$$;

create function public.transition_procurement_contract_statement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_s public.supplier_delivery_statements%rowtype;
  v_name text := (select name from public.users where id = public.current_app_user_id());
  v_user record;
begin
  select * into v_s from public.supplier_delivery_statements where id = nullif(p_input->>'statementId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_STATEMENT_NOT_FOUND'; end if;

  if v_action in ('confirm', 'withdraw', 'delete') then
    if not app_private.procurement_can('manage') then
      raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  elsif v_action in ('post', 'return') then
    if not app_private.procurement_statement_accountant_ok(v_actor, v_s.project_id, v_s.construction_site_id) then
      raise exception using errcode = '42501', message = 'PROCUREMENT_STATEMENT_POST_DENIED'; end if;
  else
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID';
  end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_action = 'confirm' then
    if v_s.status <> 'draft' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    if coalesce(v_s.total_amount, 0) <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_MISSING'; end if;
    update public.supplier_delivery_statements set status = 'confirmed',
      metadata = (metadata - 'returnReason') || jsonb_build_object('confirmedBy', v_actor, 'confirmedByName', v_name, 'confirmedAt', now())
    where id = v_s.id returning * into v_s;
    -- Tell the project's accountants (Room Thanh toán — Xác nhận).
    for v_user in select distinct s.user_id from public.project_staff s
      where s.project_id = v_s.project_id and s.user_id is not null and s.user_id <> v_actor::text
        and app_private.project_actor_has_effective_room_action(s.user_id::uuid, v_s.project_id, v_s.construction_site_id, 'payment', 'confirm')
    loop
      insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
        priority, push_enabled, metadata, delivery_reason)
      values (v_user.user_id, 'info', 'procurement', 'Bảng đối soát HĐ chờ ghi công nợ',
        v_s.code || ' · ' || coalesce(v_s.supplier_name_snapshot, '') || ' — ' || to_char(v_s.total_amount, 'FM999G999G999G999') || ' đ',
        v_s.code || ' · ' || coalesce(v_s.supplier_name_snapshot, '') || ' — ' || to_char(v_s.total_amount, 'FM999G999G999G999') || ' đ',
        'info', '🧾', '/#/da?projectId=' || v_s.project_id || '&tab=material&materialTab=po', 'procurement_statement',
        'procurement_statement:' || v_s.id || ':' || gen_random_uuid(), 'normal', true, jsonb_build_object('statementId', v_s.id), 'responsible');
    end loop;
  elsif v_action = 'withdraw' then
    if v_s.status <> 'confirmed' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    update public.supplier_delivery_statements set status = 'draft' where id = v_s.id returning * into v_s;
  elsif v_action = 'delete' then
    if v_s.status <> 'draft' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    delete from public.supplier_delivery_statement_lines where statement_id = v_s.id;
    delete from public.supplier_delivery_statements where id = v_s.id;
  elsif v_action = 'return' then
    if v_s.status <> 'confirmed' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_RETURN_REASON_REQUIRED'; end if;
    update public.supplier_delivery_statements set status = 'draft', metadata = metadata || jsonb_build_object('returnReason', v_reason)
    where id = v_s.id returning * into v_s;
    if v_s.metadata->>'confirmedBy' is not null then
      insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
        priority, push_enabled, metadata, delivery_reason)
      values (v_s.metadata->>'confirmedBy', 'info', 'procurement', 'Bảng đối soát bị trả lại', v_s.code || ': ' || v_reason,
        v_s.code || ': ' || v_reason, 'info', '🧾', '/#/procurement?contract=' || v_s.supplier_contract_id, 'procurement_statement',
        'procurement_statement:' || v_s.id || ':' || gen_random_uuid(), 'normal', true, jsonb_build_object('statementId', v_s.id), 'responsible');
    end if;
  elsif v_action = 'post' then
    if v_s.status <> 'confirmed' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    if v_s.metadata->>'confirmedBy' = v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_STATEMENT_SELF_POST'; end if;
    v_s := public.post_supplier_delivery_statement(v_s.id, v_actor);
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('need', 'statement:' || v_s.id, 'statement_' || v_action, v_actor, v_reason, jsonb_build_object('code', v_s.code));
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('statementId', v_s.id, 'status', case when v_action = 'delete' then 'deleted' else v_s.status end);
end;
$$;

create function public.search_procurement_items_v1(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'sku', i.sku, 'unit', i.unit) order by i.name)
    from (select id, name, sku, unit from public.items
          where nullif(btrim(p_search), '') is null or lower(concat_ws(' ', name, sku)) like '%' || lower(btrim(p_search)) || '%'
          order by name limit 20) i), '[]'::jsonb);
end;
$$;
revoke all on function public.search_procurement_items_v1(text) from public, anon;
grant execute on function public.search_procurement_items_v1(text) to authenticated;

-- Statements are now prepared only through Mua hàng (or by an admin).
create function app_private.guard_supplier_statement_origin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.current_app_user_id() is null or public.is_admin() or app_private.procurement_hub_context_enabled() then
    return new; end if;
  raise exception using errcode = '42501', message = 'SUPPLIER_STATEMENT_MOVED_TO_PROCUREMENT';
end;
$$;
create trigger trg_guard_supplier_statement_origin before insert on public.supplier_delivery_statements
  for each row execute function app_private.guard_supplier_statement_origin();

revoke all on function app_private.procurement_contract_price(text, text, date), app_private.procurement_contract_delivery_lines(),
  app_private.procurement_statement_accountant_ok(uuid, text, text), app_private.guard_supplier_statement_origin() from public, anon, authenticated;
revoke all on function public.list_procurement_contracts_v1(jsonb), public.get_procurement_contract_v1(text),
  public.save_procurement_contract_lines_v1(jsonb), public.save_procurement_contract_statement_v1(jsonb),
  public.transition_procurement_contract_statement_v1(jsonb) from public, anon;
grant execute on function public.list_procurement_contracts_v1(jsonb), public.get_procurement_contract_v1(text),
  public.save_procurement_contract_lines_v1(jsonb), public.save_procurement_contract_statement_v1(jsonb),
  public.transition_procurement_contract_statement_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Ghi công nợ từ bảng đối soát: chỉ qua Mua hàng (kế toán) hoặc Admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_supplier_delivery_statement(p_statement_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS supplier_delivery_statements
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_contract public.supplier_contracts%rowtype;
  v_document public.supplier_payable_documents%rowtype;
  v_gross numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
  v_blocked_item text;
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  -- 01/10/2026: công nợ HĐ nguyên tắc chỉ ghi qua Mua hàng (kế toán dự án) hoặc Admin.
  if not (app_private.procurement_hub_context_enabled() or public.is_admin()) then
    raise exception using errcode = '42501', message = 'SUPPLIER_STATEMENT_MOVED_TO_PROCUREMENT';
  end if;

  if v_statement.status = 'posted' then
    return v_statement;
  end if;

  if v_statement.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post bảng đối soát đã huỷ/đảo.';
  end if;

  select * into v_contract
  from public.supplier_contracts
  where id = v_statement.supplier_contract_id;

  if not found then
    raise exception 'Không tìm thấy HĐ NCC %. ', v_statement.supplier_contract_id;
  end if;

  if v_contract.status = 'cancelled' then
    raise exception 'Không thể ghi nhận phải trả từ HĐ NCC đã huỷ.';
  end if;

  if not exists (
    select 1
    from public.supplier_delivery_statement_lines
    where statement_id = p_statement_id
  ) then
    raise exception 'Bảng đối soát chưa có dòng giao nhận được duyệt.';
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
    where sl.statement_id = p_statement_id
      and dl.status not in ('accepted', 'adjusted')
  ) then
    raise exception 'Bảng đối soát chỉ được gồm dòng giao nhận accepted/adjusted.';
  end if;

  select dl.item_name_snapshot into v_blocked_item
  from public.supplier_delivery_statement_lines sl
  join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
  where sl.statement_id = p_statement_id
    and coalesce(dl.wms_flow_mode, 'none') = 'direct_in_out'
    and coalesce(dl.wms_status, 'not_required') <> 'exported'
  limit 1;

  if v_blocked_item is not null then
    raise exception 'Dòng nhập-xuất thẳng % phải hoàn tất WMS import và WMS xuất dùng trước khi post AP.', v_blocked_item;
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_delivery_statement_lines other_sl on other_sl.delivery_line_id = sl.delivery_line_id
    join public.supplier_delivery_statements other_s on other_s.id = other_sl.statement_id
    where sl.statement_id = p_statement_id
      and other_sl.statement_id <> p_statement_id
      and other_s.status in ('draft', 'confirmed', 'posted')
  ) then
    raise exception 'Có dòng giao nhận đã nằm trong bảng đối soát khác.';
  end if;

  select
    coalesce(sum(accepted_amount), 0)::numeric(18,2),
    coalesce(sum(vat_amount), 0)::numeric(18,2),
    coalesce(sum(total_amount), 0)::numeric(18,2)
  into v_gross, v_vat, v_total
  from public.supplier_delivery_statement_lines
  where statement_id = p_statement_id;

  if v_total <= 0 then
    raise exception 'Bảng đối soát chưa có giá trị được duyệt.';
  end if;

  update public.supplier_delivery_statements
  set
    gross_amount = v_gross,
    vat_amount = v_vat,
    total_amount = v_total,
    status = 'posted',
    posted_by = coalesce(p_actor_id, posted_by),
    posted_at = coalesce(posted_at, now()),
    supplier_contract_code = coalesce(supplier_contract_code, v_contract.code),
    supplier_id = coalesce(supplier_id, v_contract.supplier_id),
    supplier_name_snapshot = coalesce(nullif(supplier_name_snapshot, ''), v_contract.supplier_name, 'Nhà cung cấp'),
    updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  update public.supplier_direct_delivery_lines dl
  set statement_id = p_statement_id, updated_at = now()
  from public.supplier_delivery_statement_lines sl
  where sl.statement_id = p_statement_id
    and sl.delivery_line_id = dl.id;

  update public.supplier_direct_delivery_notes note
  set status = 'statemented', updated_at = now()
  where exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    where sl.statement_id = p_statement_id
      and sl.delivery_note_id = note.id
  )
  and not exists (
    select 1
    from public.supplier_direct_delivery_lines dl
    where dl.delivery_note_id = note.id
      and dl.status in ('accepted', 'adjusted')
      and dl.statement_id is null
  );

  v_document := public.sync_supplier_payable_from_delivery_statement(p_statement_id);

  update public.supplier_delivery_statements
  set payable_document_id = v_document.id, updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  return v_statement;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_supplier_payable_from_delivery_statement(p_statement_id uuid)
 RETURNS supplier_payable_documents
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  if not (app_private.ap_scope_can_mutate(v_statement.project_id, v_statement.construction_site_id)
      or app_private.procurement_hub_context_enabled()) then
    raise exception 'Bạn không có quyền đồng bộ công nợ bảng đối soát này.';
  end if;

  if v_statement.status <> 'posted' then
    raise exception 'Chỉ bảng đối soát đã post mới được ghi nhận phải trả NCC.';
  end if;

  if coalesce(v_statement.total_amount, 0) <= 0 then
    raise exception 'Bảng đối soát chưa có giá trị được duyệt.';
  end if;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, supplier_contract_id, supplier_contract_code,
    document_no, document_date, due_date, committed_amount, recognized_amount,
    credit_amount, status, qr_token, metadata, created_by
  )
  values (
    'AP-' || v_statement.code,
    'supplier_delivery_statement',
    v_statement.id::text,
    v_statement.project_id,
    v_statement.construction_site_id,
    v_statement.supplier_id,
    v_statement.supplier_name_snapshot,
    v_statement.supplier_contract_id,
    v_statement.supplier_contract_code,
    v_statement.code,
    v_statement.statement_date,
    null,
    v_statement.total_amount,
    v_statement.total_amount,
    0,
    'open',
    coalesce(v_statement.qr_token, 'ap_statement_' || replace(v_statement.id::text, '-', '')),
    jsonb_build_object(
      'supplierContractId', v_statement.supplier_contract_id,
      'supplierContractCode', v_statement.supplier_contract_code,
      'periodMonth', v_statement.period_month,
      'statementId', v_statement.id
    ) || coalesce(v_statement.metadata, '{}'::jsonb),
    v_statement.created_by
  )
  on conflict (source_type, source_id) do update
  set
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    supplier_id = excluded.supplier_id,
    supplier_name_snapshot = excluded.supplier_name_snapshot,
    supplier_contract_id = excluded.supplier_contract_id,
    supplier_contract_code = excluded.supplier_contract_code,
    document_no = excluded.document_no,
    document_date = excluded.document_date,
    committed_amount = excluded.committed_amount,
    recognized_amount = excluded.recognized_amount,
    metadata = public.supplier_payable_documents.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_document;

  update public.supplier_delivery_statements
  set payable_document_id = v_document.id, updated_at = now()
  where id = v_statement.id;

  return v_document;
end;
$function$;

notify pgrst, 'reload schema';
