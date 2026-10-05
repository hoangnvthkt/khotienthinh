-- ===========================================================================
-- Xuất bản Module Tài chính — P3 (05/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/14-xuat-ban-module-tai-chinh.md (chủ SP duyệt câu 5, 6, 8, 9 phương án a).
--  1. Nhập Excel số MISA ở Tài chính (quyền Ghi nhận): xem trước trên máy chủ (mốc chi phí, trùng, kỳ khoá) → nhập theo lô → huỷ lô (Xác nhận).
--  2. Chặn ghi thẳng sổ giao dịch dự án từ trình duyệt (PROJECT_TRANSACTION_FINANCE_ONLY); hàm Tài chính / quy trình vẫn ghi được.
--  3. Mẫu phân quyền Tài chính theo chức vụ.
-- ===========================================================================

-- 1. Lô nhập MISA --------------------------------------------------------------
create table public.finance_misa_import_batches (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id),
  file_name text,
  row_count integer not null,
  total_amount numeric(18, 2) not null,
  by_item jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text
);
create index finance_misa_import_batches_project_idx on public.finance_misa_import_batches (project_id, created_at desc);
alter table public.finance_misa_import_batches enable row level security;
-- Chính sách đọc dùng hàm xem tài chính theo dự án (P1) → cho phép vai trò authenticated gọi hàm kiểm tra này.
grant execute on function app_private.finance_project_visible(text) to authenticated;
create policy finance_misa_import_batches_select on public.finance_misa_import_batches for select to authenticated
  using (app_private.finance_project_visible(project_id));
revoke all on public.finance_misa_import_batches from anon;
grant select on public.finance_misa_import_batches to authenticated;

-- Khoản mục vật tư (theo mã) luôn là 'materials' để không lách được mốc chi phí.
create function app_private.finance_misa_category(p_symbol text, p_category text)
returns text language sql immutable set search_path = '' as $$
  select case
    when upper(coalesce(p_symbol, '')) ~ '^(CPNVL|CPVL|NVL|VL$|VATTU|VAT_TU)' then 'materials'
    when p_category in ('materials', 'labor', 'machinery', 'subcontract', 'overhead', 'other') then p_category
    else 'other' end;
$$;

-- Kiểm từng dòng: trả mảng {row, status, message, ...dòng đã chuẩn hoá}. status = ok | bad_date | bad_amount | no_cost_item |
-- after_cutover | period_locked | duplicate | duplicate_in_file.
create function app_private.finance_misa_check_rows(p_project text, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cut date; r jsonb; v_out jsonb := '[]'::jsonb; v_seen text[] := '{}'; v_key text; v_date date; v_amount numeric;
  v_item public.contract_cost_items%rowtype; v_cat text; v_status text; v_msg text; v_inv text; v_desc text; v_n integer := 0;
begin
  select cutover_date into v_cut from public.finance_project_cost_cutovers where project_id = p_project;
  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_n := v_n + 1; v_status := 'ok'; v_msg := null; v_item := null;
    v_date := case when coalesce(r->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'date')::date end;
    v_amount := case when coalesce(r->>'amount', '') ~ '^-?\d+(\.\d+)?$' then round((r->>'amount')::numeric, 2) end;
    v_inv := nullif(btrim(coalesce(r->>'invoiceNo', '')), '');
    v_desc := nullif(btrim(coalesce(r->>'description', '')), '');
    if coalesce(r->>'costItemId', '') ~ '^[0-9a-f-]{36}$' then
      select * into v_item from public.contract_cost_items where id = (r->>'costItemId')::uuid;
    end if;
    v_cat := app_private.finance_misa_category(v_item.symbol, r->>'category');
    if v_date is null then v_status := 'bad_date'; v_msg := 'Ngày không hợp lệ';
    elsif v_amount is null or v_amount <= 0 then v_status := 'bad_amount'; v_msg := 'Số tiền phải lớn hơn 0';
    elsif v_item.id is null then v_status := 'no_cost_item'; v_msg := 'Chưa chọn khoản mục chi phí';
    elsif v_cut is not null and v_cat = 'materials' and v_date >= v_cut then
      v_status := 'after_cutover'; v_msg := 'Vật tư từ ' || to_char(v_cut, 'DD/MM/YYYY') || ' do Vioo ghi khi nhận hàng — không nhập từ MISA';
    elsif app_private.finance_period_is_locked(p_project, null, 'VND', v_date) then
      v_status := 'period_locked'; v_msg := 'Tháng ' || to_char(v_date, 'MM/YYYY') || ' đã khoá sổ';
    elsif v_inv is not null then
      v_key := v_inv || '|' || v_amount::text || '|' || v_date::text || '|' || coalesce(v_desc, '');
      if exists (select 1 from public.project_transactions t where t.project_id = p_project and t.source = 'import' and t.invoice_no = v_inv
          and t.amount = v_amount and t.date = v_date::text and t.description is not distinct from v_desc) then
        v_status := 'duplicate'; v_msg := 'Chứng từ ' || v_inv || ' đã nhập trước đó';
      elsif v_key = any(v_seen) then
        v_status := 'duplicate_in_file'; v_msg := 'Trùng dòng khác trong file (chứng từ ' || v_inv || ')';
      else v_seen := v_seen || v_key; end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('row', coalesce((r->>'row')::integer, v_n), 'status', v_status, 'message', v_msg,
      'date', v_date, 'amount', v_amount, 'costItemId', v_item.id, 'symbol', v_item.symbol, 'itemName', v_item.name, 'category', v_cat,
      'description', v_desc, 'invoiceNo', v_inv,
      'invoiceDate', case when coalesce(r->>'invoiceDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then r->>'invoiceDate' end,
      'partnerId', (select p.id from public.business_partners p where p.id = nullif(r->>'partnerId', '')),
      'partnerName', nullif(btrim(coalesce(r->>'partnerName', '')), '')));
  end loop;
  return v_out;
end $$;

create function public.preview_finance_misa_import_v1(p_project_id text, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p public.projects%rowtype; v_rows jsonb;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into v_p from public.projects where id = p_project_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_MISA_EMPTY'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception using errcode = '22023', message = 'FINANCE_MISA_TOO_MANY'; end if;
  v_rows := app_private.finance_misa_check_rows(v_p.id, p_rows);
  return jsonb_build_object('projectId', v_p.id, 'cutoverDate', (select cutover_date from public.finance_project_cost_cutovers where project_id = v_p.id),
    'rows', v_rows);
end $$;

create function public.import_finance_misa_costs_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_p public.projects%rowtype; v_rows jsonb; v_bad jsonb; v_batch uuid := gen_random_uuid();
  v_fin text; r jsonb; v_n integer := 0; v_total numeric := 0;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into v_p from public.projects where id = p_input->>'projectId' for share;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(p_input->'rows', 'null'::jsonb)) <> 'array' or jsonb_array_length(p_input->'rows') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_MISA_EMPTY'; end if;
  if jsonb_array_length(p_input->'rows') > 3000 then raise exception using errcode = '22023', message = 'FINANCE_MISA_TOO_MANY'; end if;
  -- Chống bấm 2 lần / 2 người nhập cùng lúc cho 1 dự án.
  perform pg_advisory_xact_lock(hashtext('finance_misa_import:' || v_p.id));
  v_rows := app_private.finance_misa_check_rows(v_p.id, p_input->'rows');
  select jsonb_agg(x) into v_bad from jsonb_array_elements(v_rows) x where x->>'status' <> 'ok';
  if v_bad is not null then
    raise exception using errcode = '22023', message = 'FINANCE_MISA_ROWS_INVALID',
      detail = (select string_agg('dòng ' || (x->>'row') || ': ' || (x->>'message'), '; ') from (select x from jsonb_array_elements(v_bad) x limit 5) s);
  end if;
  select id into v_fin from public.project_finances where project_id = v_p.id limit 1;
  for r in select value from jsonb_array_elements(v_rows) loop
    v_n := v_n + 1; v_total := v_total + (r->>'amount')::numeric;
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt",
      contract_cost_item_id, contract_cost_item_symbol_snapshot, contract_cost_item_name_snapshot, cost_classification_status,
      counterparty_partner_id, counterparty_name, invoice_no, invoice_date)
    values (gen_random_uuid()::text, coalesce(v_fin, ''), coalesce(v_p.construction_site_id::text, ''), v_p.id, v_fin, v_p.construction_site_id::text,
      'expense', r->>'category', (r->>'amount')::numeric, coalesce(r->>'description', 'Nhập từ MISA'), r->>'date', 'import',
      'misa:' || v_batch || ':' || v_n, 'misa:' || v_batch || ':' || v_n, '[]'::jsonb, v_actor::text, now(),
      (r->>'costItemId')::uuid, r->>'symbol', r->>'itemName', 'manual',
      r->>'partnerId', coalesce(r->>'partnerName', (select p.name from public.business_partners p where p.id = r->>'partnerId')),
      r->>'invoiceNo', (r->>'invoiceDate')::date);
  end loop;
  insert into public.finance_misa_import_batches (id, project_id, file_name, row_count, total_amount, by_item, created_by)
  values (v_batch, v_p.id, nullif(btrim(coalesce(p_input->>'fileName', '')), ''), v_n, v_total,
    coalesce((select jsonb_agg(jsonb_build_object('symbol', s.symbol, 'name', s.name, 'count', s.n, 'amount', s.amount) order by s.amount desc)
      from (select x->>'symbol' symbol, max(x->>'itemName') name, count(*) n, sum((x->>'amount')::numeric) amount
        from jsonb_array_elements(v_rows) x group by 1) s), '[]'::jsonb), v_actor);
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('misa_import', v_batch::text, 'misa_import', v_actor,
    jsonb_build_object('projectId', v_p.id, 'fileName', p_input->>'fileName', 'rows', v_n, 'total', v_total));
  return jsonb_build_object('batchId', v_batch, 'inserted', v_n, 'total', v_total);
end $$;

-- Huỷ cả lô (nhập nhầm file / nhầm dự án): xoá các dòng của lô, giữ lô + nhật ký đủ dòng đã xoá để truy vết.
create function public.cancel_finance_misa_import_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); b public.finance_misa_import_batches%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_rows jsonb; v_locked text; v_n integer;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into b from public.finance_misa_import_batches where id = nullif(p_input->>'batchId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_MISA_BATCH_NOT_FOUND'; end if;
  if b.cancelled_at is not null then raise exception using errcode = '22023', message = 'FINANCE_MISA_BATCH_CANCELLED'; end if;
  select min(t.date) into v_locked from public.project_transactions t
  where t.source_ref like 'misa:' || b.id || ':%' and app_private.finance_period_is_locked(t.project_id, null, 'VND', left(t.date, 10)::date);
  if v_locked is not null then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED', detail = v_locked; end if;
  select jsonb_agg(to_jsonb(t) order by t.source_ref) into v_rows from public.project_transactions t where t.source_ref like 'misa:' || b.id || ':%';
  delete from public.project_transactions where source_ref like 'misa:' || b.id || ':%';
  get diagnostics v_n = row_count;
  update public.finance_misa_import_batches set cancelled_at = now(), cancelled_by = v_actor, cancel_reason = v_reason where id = b.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, payload)
  values ('misa_import', b.id::text, 'misa_import_cancel', v_actor, v_reason, v_rows,
    jsonb_build_object('projectId', b.project_id, 'rows', v_n, 'total', b.total_amount));
  return jsonb_build_object('batchId', b.id, 'removed', v_n, 'total', b.total_amount);
end $$;

create function public.get_finance_misa_imports_v1(p_project_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_p public.projects%rowtype;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  if not app_private.finance_project_visible(v_p.id) then raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'; end if;
  return jsonb_build_object('projectId', v_p.id, 'code', v_p.code,
    'cutoverDate', (select cutover_date from public.finance_project_cost_cutovers where project_id = v_p.id),
    'canRecord', app_private.finance_can('record'), 'canCancel', app_private.finance_can('confirm'),
    -- Số đã nhập ở sổ Dự án trước khi chuyển sang Tài chính (không theo lô).
    'legacy', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(t.amount), 0), 'from', min(t.date), 'to', max(t.date))
      from public.project_transactions t where t.project_id = v_p.id and t.source = 'import' and coalesce(t.source_ref, '') not like 'misa:%'),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'fileName', b.file_name, 'rows', b.row_count, 'total', b.total_amount,
        'byItem', b.by_item, 'createdAt', b.created_at, 'createdBy', (select u.name from public.users u where u.id = b.created_by),
        'from', (select min(t.date) from public.project_transactions t where t.source_ref like 'misa:' || b.id || ':%'),
        'to', (select max(t.date) from public.project_transactions t where t.source_ref like 'misa:' || b.id || ':%'),
        'cancelledAt', b.cancelled_at, 'cancelledBy', (select u.name from public.users u where u.id = b.cancelled_by), 'cancelReason', b.cancel_reason)
      order by b.created_at desc) from public.finance_misa_import_batches b where b.project_id = v_p.id), '[]'::jsonb));
end $$;

revoke all on function app_private.finance_misa_category(text, text) from public, anon, authenticated;
revoke all on function app_private.finance_misa_check_rows(text, jsonb) from public, anon, authenticated;
revoke all on function public.preview_finance_misa_import_v1(text, jsonb) from public, anon;
revoke all on function public.import_finance_misa_costs_v1(jsonb) from public, anon;
revoke all on function public.cancel_finance_misa_import_v1(jsonb) from public, anon;
revoke all on function public.get_finance_misa_imports_v1(text) from public, anon;
grant execute on function public.preview_finance_misa_import_v1(text, jsonb) to authenticated;
grant execute on function public.import_finance_misa_costs_v1(jsonb) to authenticated;
grant execute on function public.cancel_finance_misa_import_v1(jsonb) to authenticated;
grant execute on function public.get_finance_misa_imports_v1(text) to authenticated;

-- 2. Chặn ghi thẳng sổ giao dịch dự án từ trình duyệt ----------------------------------
-- Ghi qua hàm (RPC, trigger của luồng Tài chính / Mua hàng / Kho) vẫn chạy. Ngoại lệ duy nhất: chốt đầu kỳ vật tư ở tab Vật tư
-- (dòng chi phí 'opening_balance:<id>:materials' của đúng bản đầu kỳ đã lưu).
create function app_private.guard_project_transaction_finance_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_path text := coalesce(current_setting('request.path', true), ''); v_ref text; v_id text;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or v_path = '' or v_path like '/rpc/%' then
    return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op <> 'DELETE' then
    v_ref := coalesce(new.source_ref, '');
    v_id := substring(v_ref from '^opening_balance:(.+):materials$');
    if tg_op = 'UPDATE' then
      if old.source_ref is distinct from new.source_ref then v_id := null; end if;
    end if;
    if v_id is not null and new.source = 'import' and new.type = 'expense' and new.category = 'materials'
      and exists (select 1 from public.project_opening_balances o where o.id::text = v_id
        and (o.project_id is not distinct from new.project_id)) then
      return new;
    end if;
  end if;
  raise exception using errcode = '42501', message = 'PROJECT_TRANSACTION_FINANCE_ONLY';
end $$;
create trigger trg_guard_project_transaction_finance_write before insert or update or delete on public.project_transactions
  for each row execute function app_private.guard_project_transaction_finance_write();

-- 3. Mẫu phân quyền Tài chính theo chức vụ (Cài đặt → Phân quyền; sửa mẫu không đổi người đã áp) -------------------
update public.user_permission_templates t set
  items = app_private.normalize_user_permission_template_items(t.items || '[{"permissionCode":"system.finance.view","scopeType":"global"},
    {"permissionCode":"system.finance.record","scopeType":"global"}]'::jsonb),
  description = coalesce(t.description, '') || ' Tài chính: xem toàn công ty, ghi nhận (lập đề nghị chi, phiếu thu chi, nhập MISA).',
  updated_at = now()
where t.code = 'accountant';
update public.user_permission_templates t set
  items = app_private.normalize_user_permission_template_items(t.items || '[{"permissionCode":"system.finance.view","scopeType":"global"},
    {"permissionCode":"system.finance.record","scopeType":"global"}, {"permissionCode":"system.finance.confirm","scopeType":"global"}]'::jsonb),
  description = coalesce(t.description, '') || ' Tài chính: xem, ghi nhận, xác nhận (duyệt chứng từ, huỷ lô MISA).',
  suggested_position_ids = array_remove(t.suggested_position_ids, 'f19bf9b0-e59f-46ce-a2da-c9b3ad8bba08'::uuid),
  updated_at = now()
where t.code = 'chief_accountant';
insert into public.user_permission_templates (code, name, description, items, suggested_position_ids, sort_order, is_active, updated_at)
select 'finance_director', 'Giám đốc tài chính',
  'Kế toán trưởng + Quản trị Tài chính: tài khoản tiền, quỹ, mốc chi phí, khoá sổ, ngưỡng duyệt, dự báo dòng tiền.',
  app_private.normalize_user_permission_template_items(t.items || '[{"permissionCode":"system.finance.manage","scopeType":"global"}]'::jsonb),
  array['f19bf9b0-e59f-46ce-a2da-c9b3ad8bba08'::uuid], 65, true, now()
from public.user_permission_templates t where t.code = 'chief_accountant'
on conflict (code) do nothing;
