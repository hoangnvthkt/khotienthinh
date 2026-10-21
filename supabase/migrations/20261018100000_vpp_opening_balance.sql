-- Văn phòng phẩm (17/10/2026): nhóm VPP, 82 mã VPP001–VPP082 và tồn đầu kỳ Kho VPP Hưng Yên
-- theo bảng XNT VPP chị Đặng Thị Hương (thủ kho) chốt ngày 17/10/2026: 573 đơn vị, 11.479.200 đ.
-- Mã tồn 0 vẫn tạo để nhân viên đề xuất được. ĐVT chuẩn hóa (VPP046 thiếu ĐVT → Cuộn).
-- Ghi một phiếu nhập COMPLETED mục đích "opening_balance" → trigger sổ kho ghi inventory_ledger_entries / inventory_balances.
-- Chỉ chạy trên Cloud có Kho VPP Hưng Yên; môi trường khác hoặc chạy lại thì bỏ qua.
do $vpp$
declare
  v_wh constant text := 'wh-1782120782470-7ey83';
  v_keeper constant uuid := '9805b19f-0b39-40bf-a4a8-a1aa3f8ebce8';
  v_tx constant text := 'tx-vpp-opening-20261017';
  v_lines jsonb;
begin
  if not exists (select 1 from public.warehouses where id = v_wh)
     or not exists (select 1 from public.users where id = v_keeper)
     or exists (select 1 from public.transactions where id = v_tx) then
    return;
  end if;

  create temp table vpp_seed (sku text primary key, name text not null, unit text not null, price numeric not null, qty numeric not null) on commit drop;
  insert into vpp_seed (sku, name, unit, price, qty) values
  ('VPP001', 'Giấy A4', 'Gam', 62500, 10),
  ('VPP002', 'Giấy A3', 'Gam', 138000, 7),
  ('VPP003', 'Giấy A5', 'Gam', 35000, 1),
  ('VPP004', 'Giấy A5 màu hồng', 'Gam', 55000, 2),
  ('VPP005', 'Bút bi xanh', 'Cái', 3500, 86),
  ('VPP006', 'Bút bi màu đỏ', 'Cái', 3300, 20),
  ('VPP007', 'Bút bảng trắng', 'Cái', 7500, 19),
  ('VPP008', 'Bút lông dầu', 'Cái', 7800, 4),
  ('VPP009', 'Dao rọc giấy', 'Cái', 15000, 1),
  ('VPP010', 'Chân ghim số 10 Plus', 'Hộp', 3500, 0),
  ('VPP011', 'Ruột ghim 23/17', 'Hộp', 25000, 8),
  ('VPP012', 'Ruột ghim 23/20', 'Hộp', 28000, 5),
  ('VPP013', 'Ruột ghim 23/23', 'Hộp', 32000, 5),
  ('VPP014', 'Ruột ghim 23/10', 'Hộp', 19000, 5),
  ('VPP015', 'Dập ghim đại Deli', 'Cái', 60000, 1),
  ('VPP016', 'Ghim cài tam giác', 'Hộp', 3500, 1),
  ('VPP017', 'Kẹp đen 15mm', 'Hộp', 5500, 8),
  ('VPP018', 'Kẹp đen 19mm', 'Hộp', 8500, 0),
  ('VPP019', 'Kẹp đen 25mm', 'Hộp', 8500, 10),
  ('VPP020', 'Kẹp đen 32mm', 'Hộp', 14000, 9),
  ('VPP021', 'Kẹp đen 41mm', 'Hộp', 18000, 7),
  ('VPP022', 'Kẹp đen 51mm', 'Hộp', 23000, 9),
  ('VPP023', 'Bìa Mika A4', 'Tệp', 90000, 1),
  ('VPP024', 'Bìa Mika A3', 'Tệp', 180000, 2),
  ('VPP025', 'Bìa A4 màu xanh dương', 'Gam', 35000, 3),
  ('VPP026', 'Bìa A4 màu trắng', 'Gam', 33000, 1),
  ('VPP027', 'Bìa A3 màu xanh', 'Gam', 70000, 3),
  ('VPP028', 'Giấy in A4 hồng', 'Gam', 100000, 2),
  ('VPP029', 'Giấy chia tài liệu A4 10 màu', 'Tệp', 13000, 6),
  ('VPP030', 'Giấy than', 'Tệp', 80000, 3),
  ('VPP031', 'Trình ký đỏ', 'Cái', 70000, 3),
  ('VPP032', 'Trình ký xanh', 'Cái', 26000, 0),
  ('VPP033', 'Túi sơ mi lỗ A4', 'Tệp', 75000, 6),
  ('VPP034', 'Sổ kế toán', 'Quyển', 18000, 5),
  ('VPP035', 'Giấy note ký', 'Tệp', 13000, 34),
  ('VPP036', 'Bút nhớ', 'Cái', 7800, 20),
  ('VPP037', 'Kéo', 'Cái', 25000, 2),
  ('VPP038', 'Tẩy chì', 'Cái', 3500, 13),
  ('VPP039', 'Bút chì', 'Cái', 3000, 14),
  ('VPP040', 'Bút ký pentel', 'Cái', 45000, 12),
  ('VPP041', 'Băng dính giấy', 'Cuộn', 6500, 5),
  ('VPP042', 'Băng dính trong 4,7cm', 'Cuộn', 16000, 9),
  ('VPP043', 'Băng dính xanh dán gáy 7cm', 'Cuộn', 29000, 0),
  ('VPP044', 'Băng dính xanh dán gáy 10cm', 'Cuộn', 37000, 0),
  ('VPP045', 'Băng dính xanh dán gáy 4,7cm', 'Cuộn', 20000, 0),
  ('VPP046', 'Băng dính xanh dán gáy 3,5cm', 'Cuộn', 19000, 7),
  ('VPP047', 'Băng dính 2 mặt 2cm', 'Cuộn', 7000, 4),
  ('VPP048', 'Bút xóa', 'Cái', 19000, 29),
  ('VPP049', 'Bút xoá giấy', 'Cái', 20000, 4),
  ('VPP050', 'File còng 3cm', 'Cái', 28000, 0),
  ('VPP051', 'File còng 7cm', 'Cái', 30000, 0),
  ('VPP052', 'File còng 5cm', 'Cái', 30000, 3),
  ('VPP053', 'File còng 9cm', 'Cái', 40000, 2),
  ('VPP054', 'Khay đựng bút', 'Cái', 40000, 4),
  ('VPP055', 'Sổ lò xo to', 'Quyển', 35000, 1),
  ('VPP056', 'Sổ lò xo nhỏ', 'Quyển', 10000, 2),
  ('VPP057', 'Sổ bìa da nhỏ', 'Quyển', 35000, 3),
  ('VPP058', 'Sổ bìa da to', 'Quyển', 65000, 4),
  ('VPP059', 'Nẹp giấy nhựa', 'Hộp', 18000, 1),
  ('VPP060', 'Giấy nhớ 3x4', 'Tệp', 12500, 10),
  ('VPP061', 'Giấy nhớ 3x2', 'Tệp', 8000, 8),
  ('VPP062', 'Giấy nhớ 3x3', 'Tệp', 9000, 7),
  ('VPP063', 'Dập ghim số 10 Plus', 'Cái', 35000, 4),
  ('VPP064', 'Túi cúc đại', 'Tệp', 66000, 3),
  ('VPP065', 'Túi cúc trung', 'Tệp', 60000, 7),
  ('VPP066', 'Nẹp giấy sắt', 'Hộp', 22000, 3),
  ('VPP067', 'Hộp tài liệu vuông A4 7cm', 'Cái', 38000, 2),
  ('VPP068', 'Hộp vuông A4 - 15cm EKE', 'Cái', 55000, 2),
  ('VPP069', 'Keo dán giấy', 'Lọ', 3000, 3),
  ('VPP070', 'Pin đũa Panasonic', 'Đôi', 10000, 12),
  ('VPP071', 'Pin tiểu Panasonic LR6T/2B', 'Đôi', 25000, 4),
  ('VPP072', 'Pin panasonic AA Hi-Top', 'Đôi', 8000, 35),
  ('VPP073', 'Pin panasonic D xanh', 'Đôi', 30000, 1),
  ('VPP074', 'Pin con thỏ', 'Đôi', 4000, 7),
  ('VPP075', 'Pin CR2032 Panasonic', 'Viên', 15000, 24),
  ('VPP076', 'Pin cửa cuốn 23A/12v', 'Cái', 20000, 4),
  ('VPP077', 'Nhổ ghim', 'Cái', 14000, 5),
  ('VPP078', 'Thước kẻ dẹt 30cm', 'Cái', 4500, 2),
  ('VPP079', 'Dây rút nhựa 5*350mm', 'Gói', 165000, 1),
  ('VPP080', 'Dây rút nhựa 5*300mm', 'Gói', 165000, 1),
  ('VPP081', 'Dây rút nhựa 5*250mm', 'Gói', 165000, 1),
  ('VPP082', 'Phong bì máy bay', 'Tệp', 20000, 1)
;

  insert into public.categories (id, name) values ('cat-vpp', 'VPP') on conflict (id) do nothing;

  insert into public.items (id, sku, name, category, unit, price_in, price_out, min_stock, stock_by_warehouse, status, inventory_mode, purchase_conversion_factor)
  select 'it-vpp-' || lower(s.sku), s.sku, s.name, 'VPP', s.unit, s.price, 0, 0,
    case when s.qty > 0 then jsonb_build_object(v_wh, s.qty) else '{}'::jsonb end, 'active', 'stock', 1
  from vpp_seed s;

  insert into public.item_catalog_events (item_id, action, after, reason, actor_id)
  select 'it-vpp-' || lower(s.sku), 'issue', jsonb_build_object('sku', s.sku, 'name', s.name, 'unit', s.unit, 'category', 'VPP'),
    'Đưa VPP lên Kho VPP Hưng Yên (XNT chốt 17/10/2026)', v_keeper
  from vpp_seed s;

  select jsonb_agg(jsonb_build_object('itemId', 'it-vpp-' || lower(s.sku), 'quantity', s.qty, 'unit', s.unit, 'price', s.price,
      'accountingQty', s.qty, 'accountingUnit', s.unit, 'accountingPrice', s.price) order by s.sku)
  into v_lines from vpp_seed s where s.qty > 0;

  insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, status, note, pending_items,
    source_type, source_id, business_event_type, business_event_reason)
  values (v_tx, 'IMPORT', '2026-10-17 08:00:00+07', v_lines, v_wh, v_keeper, 'COMPLETED', 'Tồn đầu kỳ VPP 17/10/2026', '[]'::jsonb,
    'office_supply_opening', 'xnt-vpp-20261017', 'opening_balance', 'Tồn đầu kỳ theo bảng XNT VPP chốt 17/10/2026 (Đặng Thị Hương)');
end
$vpp$;
