-- Kiểm soát viên K3 đợt 1 — phủ luật sang phân hệ Kho (9 luật, chạy thử shadow).
--   Nguyên tắc: mỗi luật là một bất biến của sổ kho. Luật mới vào shadow (không báo ai) tối thiểu 1 tuần;
--   Admin xem số lệch thật ở Trung tâm AI → tab Kiểm soát rồi mới bật Báo người xử lý.
--   Số lệch đo trên dữ liệu thật 24/10: xem docs/command-center/16-kiem-soat-vien-k0.md mục K3.
-- Không đổi bảng, không đổi bộ chạy — chỉ thêm 9 hàm luật + 9 dòng control_rules.

-- ── 1. Tồn kho khác tổng sổ kho (bất biến gốc của kho) ─────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_stock_vs_ledger()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  with bal as (
    select coalesce(b.material_id, '') || '|' || coalesce(b.warehouse_id, '') || '|' || coalesce(b.project_id, '') || '|' || coalesce(b.construction_site_id, '') k,
      min(b.material_id) material_id, min(b.warehouse_id) warehouse_id, min(b.project_id) project_id,
      sum(b.on_hand_qty) qty, max(b.last_transaction_date) at
    from public.inventory_balances b group by 1
  ), led as (
    select coalesce(l.material_id, '') || '|' || coalesce(l.warehouse_id, '') || '|' || coalesce(l.project_id, '') || '|' || coalesce(l.construction_site_id, '') k,
      min(l.material_id) material_id, min(l.warehouse_id) warehouse_id, min(l.project_id) project_id,
      sum(l.quantity_delta) qty, max(l.transaction_date) at
    from public.inventory_ledger_entries l group by 1
  ), j as (
    select coalesce(b.k, l.k) k,
      coalesce(b.material_id, l.material_id) material_id, coalesce(b.warehouse_id, l.warehouse_id) warehouse_id,
      coalesce(b.project_id, l.project_id) project_id,
      coalesce(b.qty, 0) bq, coalesce(l.qty, 0) lq,
      greatest(coalesce(b.at, l.at), coalesce(l.at, b.at)) at
    from bal b full join led l on l.k = b.k
  )
  select 'stock:' || j.k, 'inventory_balance', j.material_id, coalesce(i.sku, i.name),
    j.project_id, j.warehouse_id,
    format('Tồn kho %s tại %s: sổ tồn %s, tổng phát sinh %s — lệch %s %s',
      coalesce(i.sku, i.name, '—'), coalesce(w.name, '—'),
      to_char(j.bq, 'FM999999999990.####'), to_char(j.lq, 'FM999999999990.####'),
      to_char(j.bq - j.lq, 'FM999999999990.####'), coalesce(i.unit, '')),
    jsonb_build_object('ton_kho', j.bq, 'tong_so_kho', j.lq, 'lech', j.bq - j.lq, 'don_vi', i.unit),
    null::numeric, (j.at at time zone 'Asia/Ho_Chi_Minh')::date,
    '/inventory' || coalesce('?q=' || nullif(coalesce(i.sku, i.name), ''), '')
  from j
  left join public.items i on i.id = j.material_id
  left join public.warehouses w on w.id = j.warehouse_id
  where abs(j.bq - j.lq) > 0.001;
$$;

-- ── 2. Tồn kho âm ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_stock_negative()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'stockneg:' || coalesce(b.material_id, '') || '|' || coalesce(b.warehouse_id, '') || '|' || coalesce(b.project_id, '')
      || '|' || coalesce(b.construction_site_id, '') || '|' || coalesce(b.lot_no, '') || '|' || coalesce(b.batch_no, '') || '|' || coalesce(b.serial_no, ''),
    'inventory_balance', b.material_id, coalesce(i.sku, i.name), b.project_id, b.warehouse_id,
    format('Tồn kho âm: %s tại %s còn %s %s',
      coalesce(i.sku, i.name, '—'), coalesce(w.name, '—'), to_char(b.on_hand_qty, 'FM999999999990.####'), coalesce(i.unit, '')),
    jsonb_build_object('ton_kho', b.on_hand_qty, 'gia_tri', b.total_value, 'don_vi', i.unit),
    null::numeric, (b.last_transaction_date at time zone 'Asia/Ho_Chi_Minh')::date,
    '/inventory' || coalesce('?q=' || nullif(coalesce(i.sku, i.name), ''), '')
  from public.inventory_balances b
  left join public.items i on i.id = b.material_id
  left join public.warehouses w on w.id = b.warehouse_id
  where b.on_hand_qty < -0.0001;
$$;

-- ── 3. Ghi sổ làm tồn âm tại thời điểm (xuất quá tồn) ──────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_ledger_negative_after()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'negafter:' || t.id::text, 'wms_transaction', coalesce(t.source_id, t.id::text), coalesce(t.source_code, t.code),
    min(l.project_id), min(l.warehouse_id),
    format('Phiếu kho %s làm tồn âm lúc ghi sổ: %s dòng, thấp nhất %s',
      coalesce(t.source_code, t.code), count(*), to_char(min(l.balance_after_qty), 'FM999999999990.####')),
    jsonb_build_object('so_dong', count(*), 'thap_nhat', min(l.balance_after_qty), 'loai', t.transaction_type,
      'cac_vat_tu', jsonb_agg(distinct coalesce(i.sku, i.name))),
    null::numeric, (min(l.transaction_date) at time zone 'Asia/Ho_Chi_Minh')::date,
    '/operations' || coalesce('?tx=' || t.source_id, '')
  from public.inventory_ledger_entries l
  join public.inventory_transactions t on t.id = l.inventory_transaction_id
  left join public.items i on i.id = l.material_id
  where t.reversed_at is null and l.balance_after_qty < -0.0001
  group by t.id, t.source_id, t.source_code, t.code, t.transaction_type;
$$;

-- ── 4. Giá trị tồn kho âm ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_stock_value_negative()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'stockvalneg:' || coalesce(b.material_id, '') || '|' || coalesce(b.warehouse_id, '') || '|' || coalesce(b.project_id, '')
      || '|' || coalesce(b.construction_site_id, '') || '|' || coalesce(b.lot_no, '') || '|' || coalesce(b.batch_no, '') || '|' || coalesce(b.serial_no, ''),
    'inventory_balance', b.material_id, coalesce(i.sku, i.name), b.project_id, b.warehouse_id,
    format('Giá trị tồn âm: %s tại %s còn %s %s nhưng giá trị %s đ',
      coalesce(i.sku, i.name, '—'), coalesce(w.name, '—'), to_char(b.on_hand_qty, 'FM999999999990.####'),
      coalesce(i.unit, ''), to_char(b.total_value, 'FM999G999G999G990')),
    jsonb_build_object('ton_kho', b.on_hand_qty, 'gia_tri', b.total_value, 'gia_binh_quan', b.average_unit_cost, 'don_vi', i.unit),
    b.total_value, (b.last_transaction_date at time zone 'Asia/Ho_Chi_Minh')::date,
    '/inventory' || coalesce('?q=' || nullif(coalesce(i.sku, i.name), ''), '')
  from public.inventory_balances b
  left join public.items i on i.id = b.material_id
  left join public.warehouses w on w.id = b.warehouse_id
  where coalesce(b.total_value, 0) < -0.0001;
$$;

-- ── 5. Có hàng trong kho mà giá trị tồn bằng 0 ─────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_stock_no_value()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'stocknoval:' || coalesce(b.material_id, '') || '|' || coalesce(b.warehouse_id, '') || '|' || coalesce(b.project_id, '')
      || '|' || coalesce(b.construction_site_id, '') || '|' || coalesce(b.lot_no, '') || '|' || coalesce(b.batch_no, '') || '|' || coalesce(b.serial_no, ''),
    'inventory_balance', b.material_id, coalesce(i.sku, i.name), b.project_id, b.warehouse_id,
    format('Kho còn %s %s %s nhưng giá trị tồn bằng 0 (tại %s)',
      to_char(b.on_hand_qty, 'FM999999999990.####'), coalesce(i.unit, ''),
      coalesce(i.sku, i.name, '—'), coalesce(w.name, '—')),
    jsonb_build_object('ton_kho', b.on_hand_qty, 'don_vi', i.unit, 'gia_nhap_danh_muc', i.price_in),
    null::numeric, (b.last_transaction_date at time zone 'Asia/Ho_Chi_Minh')::date,
    '/inventory' || coalesce('?q=' || nullif(coalesce(i.sku, i.name), ''), '')
  from public.inventory_balances b
  left join public.items i on i.id = b.material_id
  left join public.warehouses w on w.id = b.warehouse_id
  where b.on_hand_qty > 0.0001 and coalesce(b.total_value, 0) between -0.0001 and 0.0001;
$$;

-- ── 6. Phiếu điều chỉnh / hao hụt kho không ghi lý do ──────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_wms_adjust_no_reason()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'adjnoreason:' || t.id::text, 'wms_transaction', coalesce(t.source_id, t.id::text), coalesce(t.source_code, t.code),
    t.project_id,
    (select min(l.warehouse_id) from public.inventory_ledger_entries l where l.inventory_transaction_id = t.id),
    format('Phiếu %s (%s) không ghi lý do', coalesce(t.source_code, t.code),
      case t.transaction_type when 'adjustment_in' then 'điều chỉnh tăng'
        when 'adjustment_out' then 'điều chỉnh giảm' else 'hao hụt' end),
    jsonb_build_object('loai', t.transaction_type,
      'so_dong', (select count(*) from public.inventory_ledger_entries l where l.inventory_transaction_id = t.id)),
    null::numeric, (t.transaction_date at time zone 'Asia/Ho_Chi_Minh')::date,
    '/operations' || coalesce('?tx=' || t.source_id, '')
  from public.inventory_transactions t
  where t.reversed_at is null
    and t.transaction_type in ('adjustment_in', 'adjustment_out', 'loss_issue')
    and coalesce(nullif(btrim(t.description), ''), '') = '';
$$;

-- ── 7. Phiên kiểm kê mở lâu chưa chốt ──────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_count_open_stale()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'count:' || c.id::text, 'wms_inventory_count', c.id::text, c.count_no, null::text, c.warehouse_id,
    format('Phiên kiểm kê %s tại %s mở %s ngày chưa chốt',
      c.count_no, coalesce(w.name, '—'),
      (current_date - (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date)),
    jsonb_build_object('trang_thai', c.status,
      'so_ngay', current_date - (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date,
      'so_dong', (select count(*) from public.wms_inventory_count_lines l where l.inventory_count_id = c.id),
      'so_dong_da_dem', (select count(*) from public.wms_inventory_count_lines l where l.inventory_count_id = c.id and l.counted_qty is not null)),
    null::numeric, (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date, '/audit?q=' || c.count_no
  from public.wms_inventory_counts c
  left join public.warehouses w on w.id = c.warehouse_id
  where c.status in ('counting', 'submitted') and c.created_at < now() - interval '7 days';
$$;

-- ── 8. Dòng kiểm kê lệch chưa ghi nguyên nhân ──────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_count_variance_no_reason()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'countvar:' || c.id::text, 'wms_inventory_count', c.id::text, c.count_no, null::text, c.warehouse_id,
    format('Phiên kiểm kê %s có %s dòng lệch chưa ghi nguyên nhân', c.count_no, count(*)),
    jsonb_build_object('so_dong_lech', count(*), 'trang_thai', c.status,
      'cac_vat_tu', jsonb_agg(distinct coalesce(i.sku, i.name))),
    null::numeric, (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date, '/audit?q=' || c.count_no
  from public.wms_inventory_counts c
  join public.wms_inventory_count_lines l on l.inventory_count_id = c.id
  left join public.items i on i.id = l.item_id
  where c.status in ('submitted', 'posted')
    and abs(coalesce(l.variance_qty, 0)) > 0.0001
    and coalesce(nullif(btrim(l.variance_reason), ''), '') = ''
  group by c.id, c.count_no, c.warehouse_id, c.status, c.created_at;
$$;

-- ── 9. Điều chuyển đã gửi, chưa nhận đủ quá 3 ngày ─────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_transfer_not_received()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'transfer:' || t.id, 'wms_transaction', t.id, t.id, null::text, t.source_warehouse_id,
    format('Điều chuyển %s gửi %s ngày chưa nhận đủ: %s dòng còn thiếu',
      t.id, (current_date - (t.date at time zone 'Asia/Ho_Chi_Minh')::date), count(*)),
    jsonb_build_object('so_dong_thieu', count(*),
      'tu_kho', max(ws.name), 'den_kho', max(wt.name),
      'cac_vat_tu', jsonb_agg(distinct coalesce(i.sku, i.name))),
    null::numeric, (t.date at time zone 'Asia/Ho_Chi_Minh')::date, '/operations?tx=' || t.id
  from public.transactions t
  join public.wms_transfer_lines tl on tl.transaction_id = t.id
  left join public.items i on i.id = tl.item_id
  left join public.warehouses ws on ws.id = t.source_warehouse_id
  left join public.warehouses wt on wt.id = t.target_warehouse_id
  where t.type::text = 'TRANSFER' and t.status::text <> 'CANCELLED'
    and t.date < now() - interval '3 days'
    and coalesce(tl.dispatched_qty, 0) - coalesce(tl.received_qty, 0) - coalesce(tl.returned_qty, 0) - coalesce(tl.lost_qty, 0) > 0.0001
  group by t.id, t.source_warehouse_id, t.date;
$$;

-- ── Danh mục luật K3 đợt 1 (mặc định shadow: chưa báo ai) ──────────────────────────────────────────────────────────
insert into public.control_rules (code, module, module_key, title, principle, fix_hint, owner_hint, severity, fn, route, sort_order) values
  ('stock_vs_ledger', 'Kho', 'WMS', 'Tồn kho khác tổng sổ kho',
    'Tồn của mỗi vật tư trong một kho phải bằng tổng phát sinh nhập − xuất trên sổ kho. Lệch là tồn bị sửa ngoài sổ, báo cáo và giá xuất đều sai.',
    'Báo Admin đối chiếu sổ kho và tồn; chênh thì lập phiếu điều chỉnh kho có lý do, không sửa thẳng số tồn.',
    'Kho + Admin', 'P0', 'control_rule_stock_vs_ledger', '{warehouse}', 190),
  ('stock_negative', 'Kho', 'WMS', 'Tồn kho âm',
    'Tồn kho không bao giờ âm. Âm là xuất quá tồn hoặc thiếu phiếu nhập.',
    'Kiểm các phiếu xuất gần nhất của vật tư; thiếu phiếu nhập thì nhập bù, xuất sai thì sửa số xuất hoặc lập phiếu điều chỉnh.',
    'Kho', 'P0', 'control_rule_stock_negative', '{warehouse}', 200),
  ('ledger_negative_after', 'Kho', 'WMS', 'Ghi sổ làm tồn âm tại thời điểm',
    'Mỗi lần ghi sổ, tồn sau bút toán phải ≥ 0. Âm nghĩa là xuất trước khi có hàng — giá bình quân và chi phí dự án từ đó đều lệch.',
    'Mở phiếu, đối chiếu ngày hàng về thực tế; sửa ngày phiếu nhập hoặc lập phiếu điều chỉnh có lý do.',
    'Kho', 'P0', 'control_rule_ledger_negative_after', '{warehouse}', 210),
  ('stock_value_negative', 'Kho', 'WMS', 'Giá trị tồn kho âm',
    'Giá trị tồn không bao giờ âm. Âm là xuất theo giá cao hơn giá nhập, làm chi phí dự án và báo cáo kho sai.',
    'Kế toán kho + thủ kho đối chiếu giá nhập của vật tư; lập phiếu điều chỉnh giá trị kho có lý do.',
    'Kho + Kế toán', 'P0', 'control_rule_stock_value_negative', '{warehouse}', 220),
  ('stock_no_value', 'Kho', 'WMS', 'Có hàng trong kho mà giá trị tồn bằng 0',
    'Hàng trong kho phải có giá trị. Giá trị 0 là nhập kho không có giá — xuất sau sẽ ghi chi phí dự án bằng 0.',
    'Đối chiếu giá nhập của các phiếu nhập vật tư này; lập phiếu điều chỉnh giá trị kho để đưa về đúng giá.',
    'Kho + Kế toán', 'P1', 'control_rule_stock_no_value', '{warehouse}', 230),
  ('wms_adjust_no_reason', 'Kho', 'WMS', 'Phiếu điều chỉnh / hao hụt kho không ghi lý do',
    'Điều chỉnh tăng giảm và hao hụt làm thay đổi tồn mà không có chứng từ gốc, nên bắt buộc ghi lý do để kiểm tra lại được.',
    'Mở phiếu, ghi lý do điều chỉnh (kiểm kê, hỏng, mất, nhầm mã…).',
    'Kho', 'P1', 'control_rule_wms_adjust_no_reason', '{warehouse}', 240),
  ('count_open_stale', 'Kho', 'WMS', 'Phiên kiểm kê mở lâu chưa chốt',
    'Phiên kiểm kê mở lâu làm số đếm lệch với phát sinh sau đó; phải chốt hoặc hủy.',
    'Thủ kho đếm xong thì nộp kết quả; không kiểm nữa thì hủy phiên có lý do.',
    'Kho', 'P2', 'control_rule_count_open_stale', '{warehouse}', 250),
  ('count_variance_no_reason', 'Kho', 'WMS', 'Dòng kiểm kê lệch chưa ghi nguyên nhân',
    'Mỗi dòng lệch kiểm kê phải có nguyên nhân trước khi ghi sổ, vì nó thành điều chỉnh tồn.',
    'Mở phiên kiểm kê, chọn nguyên nhân cho từng dòng chênh rồi duyệt ghi sổ.',
    'Kho', 'P1', 'control_rule_count_variance_no_reason', '{warehouse}', 260),
  ('transfer_not_received', 'Kho', 'WMS', 'Điều chuyển đã gửi chưa nhận đủ',
    'Hàng điều chuyển đã xuất khỏi kho gửi phải được kho nhận xác nhận; để treo là hàng đi đường không ai chịu trách nhiệm.',
    'Kho nhận xác nhận số nhận thực tế; thiếu hàng thì ghi số mất / trả lại để sổ hai kho khớp.',
    'Kho', 'P1', 'control_rule_transfer_not_received', '{warehouse}', 270)
on conflict (code) do update set module = excluded.module, module_key = excluded.module_key, title = excluded.title,
  principle = excluded.principle, fix_hint = excluded.fix_hint, owner_hint = excluded.owner_hint,
  severity = excluded.severity, fn = excluded.fn, route = excluded.route, sort_order = excluded.sort_order, updated_at = now();

-- Quyền: như K0 — hàm luật chỉ bộ chạy (security definer) dùng, không mở cho người dùng.
do $$
declare fx record;
begin
  for fx in select n.nspname, pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'app_private' and pr.proname in ('control_rule_stock_vs_ledger', 'control_rule_stock_negative',
      'control_rule_ledger_negative_after', 'control_rule_stock_value_negative', 'control_rule_stock_no_value',
      'control_rule_wms_adjust_no_reason', 'control_rule_count_open_stale', 'control_rule_count_variance_no_reason',
      'control_rule_transfer_not_received') loop
    execute format('revoke all on function %I.%I() from public, anon, authenticated', fx.nspname, fx.proname);
  end loop;
end $$;

-- Chạy ngay để sổ phát hiện có số lệch thật cho Admin xem (shadow: không báo ai).
select app_private.control_run(code, 'migration') from public.control_rules
where code in ('stock_vs_ledger', 'stock_negative', 'ledger_negative_after', 'stock_value_negative', 'stock_no_value',
  'wms_adjust_no_reason', 'count_open_stale', 'count_variance_no_reason', 'transfer_not_received');
