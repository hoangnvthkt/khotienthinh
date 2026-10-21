-- Tìm kiếm toàn hệ thống (Global Search) v1 — một lần gọi tìm mọi loại hồ sơ người dùng được xem.
--
-- Quyền: public.search_global_v1 chạy SECURITY INVOKER (bằng quyền của chính người gọi). Mỗi bảng tự lọc dòng
-- bằng RLS sẵn có của module (dự án theo Room, phiếu kho theo kho, tài chính theo finance_can, văn bản theo
-- office_can_view…), danh bạ nhân sự đi qua list_hrm_employee_directory(). Tìm kiếm không bao giờ trả nhiều hơn
-- những gì người đó đã đọc được — không có luật quyền thứ hai để lệch nhau.
--
-- Tốc độ: RLS của vài bảng tốn tới ~20 ms mỗi dòng (đo trên Cloud 09/10: đếm 346 phiếu kho mất 8 s). Nên làm hai
-- bước: app_private.gs_candidates_v1 (SECURITY DEFINER, không lộ ra API) chỉ lọc theo chữ và trả tối đa 25 mã
-- ứng viên; rồi hàm chính đọc lại đúng các mã đó bằng quyền người gọi (id = any(...) đi chỉ mục, RLS chỉ chạy trên
-- ứng viên). Hàm ứng viên chỉ trả mã, không trả nội dung — nội dung luôn đi qua RLS.
--
-- Nguồn nào người gọi không có quyền (42501) thì bỏ qua êm ('denied'); lỗi khác ghi vào 'failed' để giao diện báo
-- "một số nguồn chưa tìm được" thay vì im lặng.
--
-- Khớp chữ: trình duyệt gửi các cụm đã bỏ dấu (p_terms = [["po","don hang"],["thep"]]): AND giữa cụm, OR giữa
-- cách hiểu trong cụm, khớp ở đầu từ. Mỗi nguồn có thêm "từ chỉ loại" (vd. PO có "don hang") để gõ "đơn hàng thép"
-- ra đơn có thép. Không có cụm nào + có p_kinds = liệt kê mới nhất của loại đó.

create function app_private.gs_fold(p_text text)
returns text language sql stable parallel safe set search_path = '' as $$
  select lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p_text, '')))
$$;

-- Chữ cái đầu: "Nguyễn Văn Hoàng" → "nvh" (gõ tắt tên người, tên dự án).
create function app_private.gs_initials(p_text text)
returns text language sql stable parallel safe set search_path = '' as $$
  select coalesce(string_agg(left(w, 1), '' order by n), '')
  from regexp_split_to_table(app_private.gs_fold(p_text), '[^a-z0-9]+') with ordinality as t(w, n)
  where w <> ''
$$;

create function app_private.gs_rank(p_code text, p_title text, p_compact text, p_first text)
returns integer language sql stable parallel safe set search_path = '' as $$
  select case
    when coalesce(p_compact, '') <> '' and regexp_replace(app_private.gs_fold(p_code), '[^a-z0-9]+', '', 'g') = p_compact then 100
    when length(coalesce(p_compact, '')) >= 3 and regexp_replace(app_private.gs_fold(p_code), '[^a-z0-9]+', '', 'g') like p_compact || '%' then 80
    when p_first is not null and app_private.gs_fold(p_title) ~ ('^' || p_first) then 60
    when p_first is not null and app_private.gs_fold(p_title) ~ ('\m' || p_first) then 50
    else 40
  end
$$;

create function app_private.gs_line_text(p_lines jsonb)
returns text language sql immutable parallel safe set search_path = '' as $$
  select string_agg(concat_ws(' ', l->>'itemName', l->>'itemNameSnapshot', l->>'name', l->>'sku', l->>'materialName', l->>'description'), ' ')
  from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) l
  where jsonb_typeof(l) = 'object'
$$;

create function app_private.gs_row(
  p_kind text, p_id text, p_code text, p_title text, p_subtitle text, p_status text, p_date text,
  p_project_id text, p_site_id text, p_extra jsonb, p_rank integer)
returns jsonb language sql immutable parallel safe set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind', p_kind, 'id', p_id, 'code', nullif(btrim(p_code), ''), 'title', left(nullif(btrim(p_title), ''), 300),
    'subtitle', left(nullif(btrim(p_subtitle), ''), 300), 'status', p_status, 'date', p_date,
    'projectId', p_project_id, 'siteId', p_site_id, 'extra', coalesce(p_extra, '{}'::jsonb), 'rank', p_rank))
$$;

-- Bước 1: ứng viên theo chữ. Chỉ trả mã + hạng; không đọc ra nội dung. Không nằm trong schema API (app_private).
create function app_private.gs_candidates_v1(p_kind text, p_patterns text[], p_compact text, p_first text, p_cap integer)
returns table(cand_id text, cand_rank integer, cand_ord bigint)
language plpgsql stable security definer set search_path = '' rows 25 as $$
begin
  if public.current_app_user_id() is null then
    raise exception using errcode = '42501', message = 'SEARCH_AUTH_REQUIRED';
  end if;
  p_cap := least(greatest(coalesce(p_cap, 25), 1), 40);
  p_patterns := coalesce(p_patterns, '{}');

  -- 1. Dự án
  if p_kind = 'project' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select p.id::text as cid, app_private.gs_rank(p.code, p.name, p_compact, p_first) as k, (coalesce(p.status, '') = 'active')::int + coalesce(p.is_pinned, false)::int as b, p.updated_at as recency
        from public.projects p
        where not coalesce(p.is_hidden, false)
          and app_private.gs_fold(concat_ws(' ', p.code, p.name, app_private.gs_initials(p.name), p.client_name, p.description, 'du an cong trinh cong truong project')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 3. Vật tư (danh mục)
  if p_kind = 'item' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select i.id::text as cid, app_private.gs_rank(i.sku, i.name, p_compact, p_first) as k, (coalesce(i.status, 'active') = 'active')::int as b, i.created_at as recency
        from public.items i
        where i.merged_into_id is null
          and app_private.gs_fold(concat_ws(' ', i.sku, regexp_replace(coalesce(i.sku, ''), '[^A-Za-z0-9]+', '', 'g'), i.name, i.category, i.accounting_code, 'vat tu vat lieu hang hoa ton kho')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 4. Phiếu kho (nhập / xuất / chuyển)
  if p_kind = 'wms_tx' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select t.id::text as cid, app_private.gs_rank(t.id, coalesce(wt.name, ws.name), p_compact, p_first) as k, 0 as b, t.created_at as recency
        from public.transactions t
          left join public.warehouses ws on ws.id = t.source_warehouse_id
          left join public.warehouses wt on wt.id = t.target_warehouse_id
        where true
          and app_private.gs_fold(concat_ws(' ', t.id, t.note, t.business_partner_name_snapshot, ws.name, wt.name, app_private.gs_line_text(t.items),
            (select string_agg(concat_ws(' ', li.name, li.sku), ' ')
               from jsonb_array_elements(case when jsonb_typeof(t.items) = 'array' then t.items else '[]'::jsonb end) l
               join public.items li on li.id = l->>'itemId'),
            case t.type::text when 'IMPORT' then 'nhap kho phieu nhap' when 'in' then 'nhap kho phieu nhap' when 'nhap' then 'nhap kho phieu nhap'
              when 'EXPORT' then 'xuat kho phieu xuat cap phat' when 'TRANSFER' then 'chuyen kho dieu chuyen'
              when 'ADJUSTMENT' then 'dieu chinh kiem ke' else 'xuat huy thanh ly' end, 'phieu kho')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 5. Đề xuất vật tư (kho + dự án)
  if p_kind = 'material_request' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select r.id::text as cid, app_private.gs_rank(r.code, r.title, p_compact, p_first) as k, 0 as b, coalesce(r.last_action_at, r.created_at) as recency
        from public.requests r
          left join public.projects p on p.id = r.project_id
        where true
          and app_private.gs_fold(concat_ws(' ', r.code, r.title, r.note, p.name, app_private.gs_line_text(r.items), 'de xuat vat tu yeu cau vat tu phieu vat tu')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 6. Đơn hàng (PO)
  if p_kind = 'purchase_order' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select po.id::text as cid, app_private.gs_rank(po.po_number, coalesce(nullif(po.approval_request_title, ''), po.vendor_name), p_compact, p_first) as k, 0 as b, coalesce(po.last_action_at, po.created_at) as recency
        from public.purchase_orders po
          left join public.projects p on p.id = po.project_id
        where po.archived_at is null
          and app_private.gs_fold(concat_ws(' ', po.po_number, regexp_replace(coalesce(po.po_number, ''), '[^A-Za-z0-9]+', '', 'g'), po.vendor_name, po.approval_request_title,
            po.note, po.invoice_number, po.procurement_group_no, p.name, app_private.gs_line_text(po.items), 'po don hang don mua dat hang mua hang')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 7. Phiếu yêu cầu (RQ)
  if p_kind = 'rq' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select ri.id::text as cid, app_private.gs_rank(ri.code, ri.title, p_compact, p_first) as k, 0 as b, coalesce(ri.updated_at, ri.created_at) as recency
        from public.request_instances ri
        where ri.deleted_at is null
          and app_private.gs_fold(concat_ws(' ', ri.code, regexp_replace(coalesce(ri.code, ''), '[^A-Za-z0-9]+', '', 'g'), ri.title, left(ri.description, 2000), 'yeu cau de xuat phieu yeu cau rq')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 8. Phiếu quy trình
  if p_kind = 'wf' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select wi.id::text as cid, app_private.gs_rank(wi.code, wi.title, p_compact, p_first) as k, 0 as b, coalesce(wi.updated_at, wi.created_at) as recency
        from public.workflow_instances wi
        where true
          and app_private.gs_fold(concat_ws(' ', wi.code, regexp_replace(coalesce(wi.code, ''), '[^A-Za-z0-9]+', '', 'g'), wi.title, 'quy trinh workflow phieu quy trinh')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 9. Đối tác (NCC, chủ đầu tư, thầu phụ)
  if p_kind = 'partner' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select bp.id::text as cid, app_private.gs_rank(bp.code, bp.name, p_compact, p_first) as k, coalesce(bp.is_active, true)::int as b, bp.updated_at as recency
        from public.business_partners bp
        where true
          and app_private.gs_fold(concat_ws(' ', bp.code, bp.name, bp.tax_code, bp.phone, regexp_replace(coalesce(bp.phone, ''), '[^0-9]+', '', 'g'), bp.email, bp.contact_name, bp.contact_phone, bp.address, bp.province, bp.classifications::text, 'doi tac ncc nha cung cap khach hang chu dau tu thau phu')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 10. Hợp đồng nhận thầu
  if p_kind = 'customer_contract' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select c.id::text as cid, app_private.gs_rank(c.code, c.name, p_compact, p_first) as k, 0 as b, c.updated_at as recency
        from public.customer_contracts c
          left join public.projects p on p.id = c.project_id
        where true
          and app_private.gs_fold(concat_ws(' ', c.code, c.name, c.customer_name, c.customer_tax_code, p.name, 'hop dong nhan thau chu dau tu khach hang')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 11. Hợp đồng thầu phụ
  if p_kind = 'subcontract' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select c.id::text as cid, app_private.gs_rank(c.code, c.name, p_compact, p_first) as k, 0 as b, c.updated_at as recency
        from public.subcontractor_contracts c
          left join public.projects p on p.id = c.project_id
        where true
          and app_private.gs_fold(concat_ws(' ', c.code, c.name, c.subcontractor_name, c.subcontractor_tax_code, c.scope_of_work, p.name, 'hop dong thau phu nha thau')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 12. Hợp đồng nhà cung cấp
  if p_kind = 'supplier_contract' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select c.id::text as cid, app_private.gs_rank(c.code, c.name, p_compact, p_first) as k, 0 as b, c.updated_at as recency
        from public.supplier_contracts c
          left join public.projects p on p.id = c.project_id
        where true
          and app_private.gs_fold(concat_ws(' ', c.code, c.name, c.supplier_name, c.purchase_order_number, p.name, 'hop dong nha cung cap ncc khung')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 13. Tài sản
  if p_kind = 'asset' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select a.id::text as cid, app_private.gs_rank(a.code, a.name, p_compact, p_first) as k, 0 as b, a.updated_at as recency
        from public.assets a
        where true
          and app_private.gs_fold(concat_ws(' ', a.code, a.name, a.serial_number, a.brand, a.model, a.assigned_to_name, a.location_note, a.contract_number, a.invoice_number, 'tai san thiet bi')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 14. Văn bản (Vioo Office)
  if p_kind = 'office_doc' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select d.id::text as cid, app_private.gs_rank(d.document_number, d.title, p_compact, p_first) as k, 0 as b, d.updated_at as recency
        from public.office_documents d
        where true
          and app_private.gs_fold(concat_ws(' ', d.document_number, d.title, d.summary, d.source_organization, d.source_document_number, d.creator_name, left(d.content_text, 4000), 'van ban cong van')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 15. Công việc (Vioo Work)
  if p_kind = 'work_task' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select w.id::text as cid, app_private.gs_rank(w.task_code, w.title, p_compact, p_first) as k, 0 as b, w.updated_at as recency
        from public.work_tasks w
        where true
          and app_private.gs_fold(concat_ws(' ', w.task_code, w.title, left(w.description_text, 2000), 'cong viec viec task')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 16. Đề nghị chi / tạm ứng (Tài chính)
  if p_kind = 'payment_request' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select f.id::text as cid, app_private.gs_rank(f.code, f.supplier_name, p_compact, p_first) as k, 0 as b, f.updated_at as recency
        from public.finance_payment_requests f
        where true
          and app_private.gs_fold(concat_ws(' ', f.code, f.supplier_name, f.note, f.expense_category, f.cost_category, 'de nghi chi de nghi thanh toan tam ung chi tien')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 17. Đặt xe
  if p_kind = 'vehicle_booking' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select b.id::text as cid, app_private.gs_rank(b.booking_code, b.purpose, p_compact, p_first) as k, 0 as b, b.requested_pickup_at as recency
        from public.vehicle_bookings b
        where true
          and app_private.gs_fold(concat_ws(' ', b.booking_code, b.purpose, b.pickup_location_text, b.destination_text, b.note, 'dat xe xe chuyen xe')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 18. Đơn nghỉ phép
  if p_kind = 'leave' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select l.id::text as cid, app_private.gs_rank(l.code, l.reason, p_compact, p_first) as k, 0 as b, l."createdAt" as recency
        from public.hrm_leave_requests l
        where true
          and app_private.gs_fold(concat_ws(' ', l.code, l.reason, l.type, l."startDate", 'nghi phep don nghi phep')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 19. Góp ý / báo lỗi
  if p_kind = 'feedback' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select f.id::text as cid, app_private.gs_rank(null, f.title, p_compact, p_first) as k, 0 as b, coalesce(f.last_activity_at, f.updated_at) as recency
        from public.feedback_items f
        where true
          and app_private.gs_fold(concat_ws(' ', f.title, left(f.description, 2000), f.module, f.tags::text, 'gop y bao loi feedback')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;

  -- 20. Đề xuất cấp mã vật tư
  if p_kind = 'material_code' then
    return query
      select y.cid, y.k, row_number() over (order by y.k desc, y.b desc, y.recency desc nulls last)
      from (
        select m.id::text as cid, app_private.gs_rank(m.code, m.proposed_name, p_compact, p_first) as k, 0 as b, m.updated_at as recency
        from public.material_code_requests m
        where true
          and app_private.gs_fold(concat_ws(' ', m.code, m.proposed_name, m.proposed_specification, m.approved_sku, m.requested_by_name, 'cap ma ma vat tu moi de xuat cap ma')) ~ all (p_patterns)
      ) y
      order by 3
      limit p_cap;
    return;
  end if;
  raise exception using errcode = '22023', message = 'SEARCH_KIND_UNKNOWN';
end $$;

revoke all on function app_private.gs_fold(text), app_private.gs_initials(text), app_private.gs_rank(text, text, text, text),
  app_private.gs_line_text(jsonb),
  app_private.gs_row(text, text, text, text, text, text, text, text, text, jsonb, integer),
  app_private.gs_candidates_v1(text, text[], text, text, integer) from public, anon;
grant execute on function app_private.gs_fold(text), app_private.gs_initials(text), app_private.gs_rank(text, text, text, text),
  app_private.gs_line_text(jsonb),
  app_private.gs_row(text, text, text, text, text, text, text, text, text, jsonb, integer),
  app_private.gs_candidates_v1(text, text[], text, text, integer) to authenticated, service_role;

-- Bước 2: đọc lại ứng viên bằng quyền người gọi.
create function public.search_global_v1(p_terms jsonb default '[]'::jsonb, p_kinds text[] default null, p_limit integer default 6)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  c_all_kinds constant text[] := array['project', 'employee', 'item', 'wms_tx', 'material_request', 'purchase_order', 'rq', 'wf',
    'partner', 'customer_contract', 'subcontract', 'supplier_contract', 'asset', 'office_doc', 'work_task', 'payment_request',
    'vehicle_booking', 'leave', 'feedback', 'material_code'];
  v_kinds text[];
  v_patterns text[] := '{}';
  v_alts text[];
  v_first text;
  v_compact text := '';
  v_group jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 25);
  v_cap integer;
  v_heavy_cap integer;
  v_ids text[];
  v_ranks integer[];
  v_records jsonb := '[]'::jsonb;
  v_part jsonb;
  v_failed text[] := '{}';
  v_denied text[] := '{}';
begin
  if public.current_app_user_id() is null then
    raise exception using errcode = '42501', message = 'SEARCH_AUTH_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_terms, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'SEARCH_TERMS_INVALID';
  end if;

  for v_group in select value from jsonb_array_elements(coalesce(p_terms, '[]'::jsonb)) limit 6 loop
    -- Chỉ nhận chữ đã bỏ dấu, số và . / - (trình duyệt đã chuẩn hóa); '.' thoát cho biểu thức chính quy.
    -- Cách hiểu đầu = chữ người dùng gõ (khớp đầu từ); viết tắt đồng nghĩa ≤ 3 chữ phải khớp trọn từ ("cc" không khớp "ccdc").
    select array_agg(replace(a.alt, '.', '\.') || case when a.ord > 1 and length(a.alt) <= 3 then '\M' else '' end order by a.ord) into v_alts
    from (select t.value as alt, t.ord
          from jsonb_array_elements_text(case when jsonb_typeof(v_group) = 'array' then v_group else '[]'::jsonb end) with ordinality as t(value, ord)
          limit 8) a
    where a.alt ~ '^[a-z0-9 ./-]{1,60}$';
    if v_alts is not null then
      v_patterns := v_patterns || ('\m(' || array_to_string(v_alts, '|') || ')');
      v_first := coalesce(v_first, v_alts[1]);
      v_compact := v_compact || regexp_replace(v_alts[1], '[^a-z0-9]+', '', 'g');
    end if;
  end loop;

  v_kinds := (select coalesce(array_agg(k), '{}') from unnest(coalesce(p_kinds, c_all_kinds)) k where k = any(c_all_kinds));
  if cardinality(v_patterns) = 0 and p_kinds is null then
    return jsonb_build_object('records', '[]'::jsonb, 'failed', '[]'::jsonb, 'denied', '[]'::jsonb);
  end if;
  v_cap := greatest(v_limit * 3, 25);
  -- Phiếu kho, đề xuất cấp mã: RLS đắt từng dòng (≈10–20 ms) → ít ứng viên hơn.
  v_heavy_cap := greatest(v_limit * 2, 10);

  -- 2. Nhân sự: danh bạ theo luật của HRM (hàm của module tự kiểm quyền, danh bạ nhỏ nên lọc thẳng).
  if 'employee' = any(v_kinds) then
    begin
      select coalesce(jsonb_agg(app_private.gs_row('employee', s.e->>'id', s.e->>'employee_code', s.e->>'full_name',
          concat_ws(' · ', nullif(s.e->>'title', ''), nullif(s.e->>'phone', '')), s.e->>'status', s.e->>'updated_at',
          null, s.e->>'construction_site_id',
          jsonb_build_object('phone', s.e->>'phone', 'email', s.e->>'email', 'jobTitle', s.e->>'title', 'userId', s.e->>'user_id'), s.k)
        order by s.k desc, s.working desc, s.e->>'full_name'), '[]'::jsonb) into v_part
      from (
        select d.e, app_private.gs_rank(d.e->>'employee_code', d.e->>'full_name', v_compact, v_first) as k,
          (coalesce(d.e->>'status', '') = 'Đang làm việc')::int as working
        from jsonb_array_elements(public.list_hrm_employee_directory()) d(e)
        where app_private.gs_fold(concat_ws(' ', d.e->>'employee_code', d.e->>'full_name', app_private.gs_initials(d.e->>'full_name'),
          d.e->>'title', d.e->>'phone', regexp_replace(coalesce(d.e->>'phone', ''), '[^0-9]+', '', 'g'), d.e->>'email', 'nhan vien nhan su')) ~ all (v_patterns)
        order by k desc, working desc, d.e->>'full_name'
        limit v_limit
      ) s;
      v_records := v_records || v_part;
    exception
      when insufficient_privilege then v_denied := v_denied || 'employee'::text;
      when others then v_failed := v_failed || 'employee'::text;
    end;
  end if;

  -- 1. Dự án
  if 'project' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('project', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('project', p.id, p.code, p.name, p.client_name, p.status, p.updated_at::text, p.id, p.construction_site_id::text, jsonb_build_object('pinned', coalesce(p.is_pinned, false)),
              v_ranks[array_position(v_ids, p.id)]) as r,
            array_position(v_ids, p.id) as o
          from public.projects p
          where p.id = any (v_ids) and not coalesce(p.is_hidden, false)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'project'::text;
      when others then v_failed := v_failed || 'project'::text;
    end;
  end if;

  -- 3. Vật tư (danh mục)
  if 'item' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('item', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('item', i.id, i.sku, i.name, concat_ws(' · ', i.unit, i.category), i.status, i.created_at::text, null, null, jsonb_build_object('unit', i.unit, 'category', i.category),
              v_ranks[array_position(v_ids, i.id)]) as r,
            array_position(v_ids, i.id) as o
          from public.items i
          where i.id = any (v_ids) and i.merged_into_id is null
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'item'::text;
      when others then v_failed := v_failed || 'item'::text;
    end;
  end if;

  -- 4. Phiếu kho (nhập / xuất / chuyển)
  if 'wms_tx' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('wms_tx', v_patterns, v_compact, v_first, v_heavy_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('wms_tx', t.id, null,
          'Phiếu ' || case t.type::text when 'IMPORT' then 'nhập' when 'in' then 'nhập' when 'nhap' then 'nhập' when 'EXPORT' then 'xuất'
            when 'TRANSFER' then 'chuyển' when 'ADJUSTMENT' then 'điều chỉnh' else 'hủy' end || ' kho' || coalesce(' · ' || coalesce(wt.name, ws.name), ''),
          concat_ws(' · ', nullif(t.business_partner_name_snapshot, ''),
            case when jsonb_typeof(t.items) = 'array' then jsonb_array_length(t.items) else 0 end || ' mặt hàng',
            to_char(t.date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY')),
          t.status::text, t.created_at::text, null, null,
          jsonb_build_object('type', t.type::text, 'lines', case when jsonb_typeof(t.items) = 'array' then jsonb_array_length(t.items) else 0 end),
              v_ranks[array_position(v_ids, t.id)]) as r,
            array_position(v_ids, t.id) as o
          from public.transactions t
        left join public.warehouses ws on ws.id = t.source_warehouse_id
        left join public.warehouses wt on wt.id = t.target_warehouse_id
          where t.id = any (v_ids)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'wms_tx'::text;
      when others then v_failed := v_failed || 'wms_tx'::text;
    end;
  end if;

  -- 5. Đề xuất vật tư (kho + dự án)
  if 'material_request' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('material_request', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('material_request', r.id, r.code, coalesce(nullif(r.title, ''), 'Đề xuất vật tư'),
          concat_ws(' · ', p.name, to_char(r.created_date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY')), r.status::text,
          coalesce(r.last_action_at, r.created_at)::text, r.project_id, r.construction_site_id, jsonb_build_object('origin', r.request_origin),
              v_ranks[array_position(v_ids, r.id)]) as r,
            array_position(v_ids, r.id) as o
          from public.requests r
        left join public.projects p on p.id = r.project_id
          where r.id = any (v_ids)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'material_request'::text;
      when others then v_failed := v_failed || 'material_request'::text;
    end;
  end if;

  -- 6. Đơn hàng (PO)
  if 'purchase_order' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('purchase_order', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('purchase_order', po.id, po.po_number, coalesce(nullif(po.approval_request_title, ''), nullif(po.vendor_name, ''), 'Đơn hàng'),
          concat_ws(' · ', case when nullif(po.approval_request_title, '') is not null then po.vendor_name end, p.name), po.status,
          coalesce(po.last_action_at, po.created_at)::text, po.project_id, po.construction_site_id,
          jsonb_build_object('amount', coalesce(po.approved_total_amount, po.total_amount), 'orderDate', po.order_date, 'vendor', po.vendor_name),
              v_ranks[array_position(v_ids, po.id)]) as r,
            array_position(v_ids, po.id) as o
          from public.purchase_orders po
        left join public.projects p on p.id = po.project_id
          where po.id = any (v_ids) and po.archived_at is null
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'purchase_order'::text;
      when others then v_failed := v_failed || 'purchase_order'::text;
    end;
  end if;

  -- 7. Phiếu yêu cầu (RQ)
  if 'rq' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('rq', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('rq', ri.id::text, ri.code, ri.title, null, ri.status, coalesce(ri.updated_at, ri.created_at)::text, null, null, jsonb_build_object('dueAt', ri.due_at),
              v_ranks[array_position(v_ids, ri.id::text)]) as r,
            array_position(v_ids, ri.id::text) as o
          from public.request_instances ri
          where ri.id = any (v_ids::uuid[]) and ri.deleted_at is null
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'rq'::text;
      when others then v_failed := v_failed || 'rq'::text;
    end;
  end if;

  -- 8. Phiếu quy trình
  if 'wf' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('wf', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('wf', wi.id::text, wi.code, wi.title, null, wi.status::text, coalesce(wi.updated_at, wi.created_at)::text, null, null, '{}'::jsonb,
              v_ranks[array_position(v_ids, wi.id::text)]) as r,
            array_position(v_ids, wi.id::text) as o
          from public.workflow_instances wi
          where wi.id = any (v_ids::uuid[])
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'wf'::text;
      when others then v_failed := v_failed || 'wf'::text;
    end;
  end if;

  -- 9. Đối tác (NCC, chủ đầu tư, thầu phụ)
  if 'partner' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('partner', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('partner', bp.id, bp.code, bp.name, concat_ws(' · ', 'MST ' || nullif(bp.tax_code, ''), nullif(bp.phone, ''), nullif(bp.province, '')),
          case when coalesce(bp.is_active, true) then 'active' else 'inactive' end, bp.updated_at::text, null, null,
          jsonb_build_object('phone', bp.phone, 'email', bp.email, 'taxCode', bp.tax_code, 'contact', bp.contact_name),
              v_ranks[array_position(v_ids, bp.id)]) as r,
            array_position(v_ids, bp.id) as o
          from public.business_partners bp
          where bp.id = any (v_ids)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'partner'::text;
      when others then v_failed := v_failed || 'partner'::text;
    end;
  end if;

  -- 10. Hợp đồng nhận thầu
  if 'customer_contract' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('customer_contract', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('customer_contract', c.id, c.code, c.name, concat_ws(' · ', nullif(c.customer_name, ''), p.name), c.status, c.updated_at::text,
          c.project_id, null, jsonb_build_object('value', c.value, 'counterparty', c.customer_name),
              v_ranks[array_position(v_ids, c.id)]) as r,
            array_position(v_ids, c.id) as o
          from public.customer_contracts c
        left join public.projects p on p.id = c.project_id
          where c.id = any (v_ids)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'customer_contract'::text;
      when others then v_failed := v_failed || 'customer_contract'::text;
    end;
  end if;

  -- 11. Hợp đồng thầu phụ
  if 'subcontract' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('subcontract', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('subcontract', c.id, c.code, c.name, concat_ws(' · ', nullif(c.subcontractor_name, ''), p.name), c.status, c.updated_at::text,
          c.project_id, null, jsonb_build_object('value', c.value, 'counterparty', c.subcontractor_name),
              v_ranks[array_position(v_ids, c.id)]) as r,
            array_position(v_ids, c.id) as o
          from public.subcontractor_contracts c
        left join public.projects p on p.id = c.project_id
          where c.id = any (v_ids)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'subcontract'::text;
      when others then v_failed := v_failed || 'subcontract'::text;
    end;
  end if;

  -- 12. Hợp đồng nhà cung cấp
  if 'supplier_contract' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('supplier_contract', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('supplier_contract', c.id, c.code, c.name, concat_ws(' · ', nullif(c.supplier_name, ''), p.name), c.status, c.updated_at::text,
          c.project_id, null, jsonb_build_object('value', c.value, 'counterparty', c.supplier_name),
              v_ranks[array_position(v_ids, c.id)]) as r,
            array_position(v_ids, c.id) as o
          from public.supplier_contracts c
        left join public.projects p on p.id = c.project_id
          where c.id = any (v_ids)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'supplier_contract'::text;
      when others then v_failed := v_failed || 'supplier_contract'::text;
    end;
  end if;

  -- 13. Tài sản
  if 'asset' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('asset', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('asset', a.id, a.code, a.name, concat_ws(' · ', nullif(a.serial_number, ''), nullif(a.assigned_to_name, ''), nullif(a.location_note, '')),
          a.status::text, a.updated_at::text, null, a.construction_site_id::text, jsonb_build_object('holder', a.assigned_to_name),
              v_ranks[array_position(v_ids, a.id)]) as r,
            array_position(v_ids, a.id) as o
          from public.assets a
          where a.id = any (v_ids)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'asset'::text;
      when others then v_failed := v_failed || 'asset'::text;
    end;
  end if;

  -- 14. Văn bản (Vioo Office)
  if 'office_doc' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('office_doc', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('office_doc', d.id::text, d.document_number, d.title, concat_ws(' · ', nullif(d.source_organization, ''), to_char(d.document_date, 'DD/MM/YYYY')),
          d.status, d.updated_at::text, d.project_id, null, jsonb_build_object('group', d.document_group),
              v_ranks[array_position(v_ids, d.id::text)]) as r,
            array_position(v_ids, d.id::text) as o
          from public.office_documents d
          where d.id = any (v_ids::uuid[])
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'office_doc'::text;
      when others then v_failed := v_failed || 'office_doc'::text;
    end;
  end if;

  -- 15. Công việc (Vioo Work)
  if 'work_task' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('work_task', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('work_task', w.id::text, w.task_code, w.title, null, w.status, w.updated_at::text, w.project_id, null, jsonb_build_object('deadline', w.deadline_at),
              v_ranks[array_position(v_ids, w.id::text)]) as r,
            array_position(v_ids, w.id::text) as o
          from public.work_tasks w
          where w.id = any (v_ids::uuid[])
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'work_task'::text;
      when others then v_failed := v_failed || 'work_task'::text;
    end;
  end if;

  -- 16. Đề nghị chi / tạm ứng (Tài chính)
  if 'payment_request' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('payment_request', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('payment_request', f.id::text, f.code, coalesce(nullif(f.supplier_name, ''), 'Đề nghị chi'),
          concat_ws(' · ', nullif(f.note, ''), to_char(f.planned_date, 'DD/MM/YYYY')), f.status, f.updated_at::text, f.project_id, null,
          jsonb_build_object('amount', f.amount, 'kind', f.kind),
              v_ranks[array_position(v_ids, f.id::text)]) as r,
            array_position(v_ids, f.id::text) as o
          from public.finance_payment_requests f
          where f.id = any (v_ids::uuid[])
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'payment_request'::text;
      when others then v_failed := v_failed || 'payment_request'::text;
    end;
  end if;

  -- 17. Đặt xe
  if 'vehicle_booking' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('vehicle_booking', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('vehicle_booking', b.id::text, b.booking_code, coalesce(nullif(b.purpose, ''), nullif(b.destination_text, ''), 'Đơn đặt xe'),
          concat_ws(' → ', nullif(b.pickup_location_text, ''), nullif(b.destination_text, '')), b.status, b.updated_at::text, null, null,
          jsonb_build_object('pickupAt', b.requested_pickup_at),
              v_ranks[array_position(v_ids, b.id::text)]) as r,
            array_position(v_ids, b.id::text) as o
          from public.vehicle_bookings b
          where b.id = any (v_ids::uuid[])
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'vehicle_booking'::text;
      when others then v_failed := v_failed || 'vehicle_booking'::text;
    end;
  end if;

  -- 18. Đơn nghỉ phép
  if 'leave' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('leave', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('leave', l.id::text, l.code, 'Đơn nghỉ phép',
          concat_ws(' · ', l."startDate" || case when l."endDate" is distinct from l."startDate" then ' → ' || l."endDate" else '' end, nullif(l.reason, '')),
          l.status, l."createdAt"::text, null, null, jsonb_build_object('type', l.type, 'days', l."totalDays"),
              v_ranks[array_position(v_ids, l.id::text)]) as r,
            array_position(v_ids, l.id::text) as o
          from public.hrm_leave_requests l
          where l.id = any (v_ids::uuid[])
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'leave'::text;
      when others then v_failed := v_failed || 'leave'::text;
    end;
  end if;

  -- 19. Góp ý / báo lỗi
  if 'feedback' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('feedback', v_patterns, v_compact, v_first, v_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('feedback', f.id::text, null, f.title, concat_ws(' · ', f.type, f.module), f.status, coalesce(f.last_activity_at, f.updated_at)::text,
          null, null, '{}'::jsonb,
              v_ranks[array_position(v_ids, f.id::text)]) as r,
            array_position(v_ids, f.id::text) as o
          from public.feedback_items f
          where f.id = any (v_ids::uuid[])
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'feedback'::text;
      when others then v_failed := v_failed || 'feedback'::text;
    end;
  end if;

  -- 20. Đề xuất cấp mã vật tư
  if 'material_code' = any(v_kinds) then
    begin
      select array_agg(c.cand_id order by c.cand_ord), array_agg(c.cand_rank order by c.cand_ord) into v_ids, v_ranks
      from app_private.gs_candidates_v1('material_code', v_patterns, v_compact, v_first, v_heavy_cap) c;
      if v_ids is not null then
        select coalesce(jsonb_agg(x.r order by x.o), '[]'::jsonb) into v_part
        from (
          select app_private.gs_row('material_code', m.id, m.code, m.proposed_name,
          concat_ws(' · ', nullif(m.proposed_unit, ''), nullif(m.requested_by_name, ''), 'mã cấp ' || nullif(m.approved_sku, '')), m.status,
          m.updated_at::text, null, null, jsonb_build_object('approvedItemId', m.approved_item_id),
              v_ranks[array_position(v_ids, m.id)]) as r,
            array_position(v_ids, m.id) as o
          from public.material_code_requests m
          where m.id = any (v_ids)
          order by o
          limit v_limit
        ) x;
        v_records := v_records || v_part;
      end if;
    exception
      when insufficient_privilege then v_denied := v_denied || 'material_code'::text;
      when others then v_failed := v_failed || 'material_code'::text;
    end;
  end if;
  return jsonb_build_object('records', v_records, 'failed', to_jsonb(v_failed), 'denied', to_jsonb(v_denied));
end $$;

comment on function public.search_global_v1(jsonb, text[], integer) is
  'Tìm kiếm toàn hệ thống: SECURITY INVOKER, RLS từng bảng quyết định dòng được thấy. p_terms = cụm đã bỏ dấu (AND giữa cụm, OR trong cụm).';

revoke all on function public.search_global_v1(jsonb, text[], integer) from public, anon;
grant execute on function public.search_global_v1(jsonb, text[], integer) to authenticated, service_role;
