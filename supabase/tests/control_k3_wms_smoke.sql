-- Kiểm soát viên K3 đợt 1 (Kho): 9 luật chạy trên dữ liệu thật, giao dịch tự hủy.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261031090000_control_k3_wms.sql --smoke supabase/tests/control_k3_wms_smoke.sql
begin;
create temp table k3(buoc text primary key, ket_qua text) on commit drop;

do $$
declare r record; n bigint; dup bigint; res jsonb; v_mode text; v_before bigint; v_after bigint;
begin
  -- 1. Mỗi luật chạy không lỗi và object_key không trùng (khóa sổ phát hiện là rule_code + object_key).
  for r in select code, fn from public.control_rules where module_key = 'WMS' and sort_order between 190 and 270 order by sort_order loop
    execute format('select count(*), count(*) - count(distinct object_key) from app_private.%I()', r.fn) into n, dup;
    if dup > 0 then raise exception 'FAIL 1 luật % có % object_key trùng', r.code, dup; end if;
    insert into k3 values ('luat:' || r.code, n || ' dòng');
  end loop;

  -- 2. Cả 9 luật mới phải ở shadow: chưa báo ai, Admin bật sau khi xem số lệch thật.
  select string_agg(distinct mode, ',') into v_mode from public.control_rules where module_key = 'WMS' and sort_order between 190 and 270;
  if v_mode <> 'shadow' then raise exception 'FAIL 2 luật K3 phải ở shadow, đang %', v_mode; end if;
  insert into k3 values ('che_do', v_mode);

  -- 3. Bất biến gốc: tồn kho = tổng sổ kho, tồn không âm. Lệch ở đây là dữ liệu hỏng, phải là 0.
  if exists (select 1 from app_private.control_rule_stock_vs_ledger()) then
    raise exception 'FAIL 3 tồn kho lệch sổ kho: %', (select string_agg(title, ' | ') from app_private.control_rule_stock_vs_ledger()); end if;
  if exists (select 1 from app_private.control_rule_stock_negative()) then
    raise exception 'FAIL 3b tồn kho âm: %', (select string_agg(title, ' | ') from app_private.control_rule_stock_negative()); end if;
  insert into k3 values ('bat_bien_ton_kho', 'khớp');

  -- 3c. Mọi luật phải cho đường dẫn mở đúng chỗ sửa (bấm Mở là thấy ngay vật tư / phiếu / phiên).
  for r in select code, fn from public.control_rules where module_key = 'WMS' and sort_order between 190 and 270 order by sort_order loop
    execute format('select count(*) from app_private.%I() where link is null or link not like ''/%%''', r.fn) into n;
    if n > 0 then raise exception 'FAIL 3c luật % có % dòng thiếu đường dẫn', r.code, n; end if;
  end loop;
  if exists (select 1 from app_private.control_rule_stock_no_value() where link not like '/inventory?q=%') then
    raise exception 'FAIL 3d luật giá trị 0 không mở sẵn mã vật tư'; end if;
  if exists (select 1 from app_private.control_rule_count_open_stale() where link not like '/audit?q=%') then
    raise exception 'FAIL 3e luật kiểm kê không mở sẵn phiên'; end if;

  -- 4. Luật giá trị tồn bắt đúng các mã đã biết (24/10: 4 dòng giá trị âm, 25 dòng có hàng mà giá trị 0).
  select count(*) into n from app_private.control_rule_stock_value_negative();
  if n = 0 then raise exception 'FAIL 4 luật giá trị tồn âm không bắt được dòng nào'; end if;
  if exists (select 1 from app_private.control_rule_stock_value_negative() where amount >= 0) then
    raise exception 'FAIL 4b luật giá trị tồn âm trả dòng không âm'; end if;
  insert into k3 values ('gia_tri_am', n || ' dòng, ' || (select to_char(sum(amount), 'FM999G999G999G990') from app_private.control_rule_stock_value_negative()) || ' đ');
  -- Hai luật không được chồng nhau: giá trị âm và giá trị bằng 0 là hai tập rời.
  if exists (select object_key from app_private.control_rule_stock_value_negative()
             intersect select replace(object_key, 'stocknoval:', 'stockvalneg:') from app_private.control_rule_stock_no_value()) then
    raise exception 'FAIL 4c luật giá trị âm và giá trị 0 chồng nhau'; end if;
  select count(*) into n from app_private.control_rule_stock_no_value();
  insert into k3 values ('gia_tri_bang_0', n || ' dòng');

  -- 5. Luật ghi sổ làm tồn âm: gom theo phiếu, có đủ mã phiếu + đường dẫn mở phiếu.
  select count(*) into n from app_private.control_rule_ledger_negative_after();
  if n = 0 then raise exception 'FAIL 5 luật tồn âm tại thời điểm không bắt được phiếu nào'; end if;
  if exists (select 1 from app_private.control_rule_ledger_negative_after() where object_code is null or link not like '/operations%') then
    raise exception 'FAIL 5b luật tồn âm tại thời điểm thiếu mã phiếu hoặc đường dẫn'; end if;
  insert into k3 values ('ghi_so_ton_am', n || ' phiếu');

  -- 6. Luật thiếu lý do chỉ bắt phiếu điều chỉnh / hao hụt, không bắt phiếu đã có mô tả.
  if exists (select 1 from app_private.control_rule_wms_adjust_no_reason() w
             join public.inventory_transactions t on coalesce(t.source_id, t.id::text) = w.object_id
             where coalesce(nullif(btrim(t.description), ''), '') <> '') then
    raise exception 'FAIL 6 luật thiếu lý do bắt cả phiếu đã ghi lý do'; end if;
  insert into k3 values ('dieu_chinh_thieu_ly_do', (select count(*) from app_private.control_rule_wms_adjust_no_reason()) || ' phiếu');

  -- 7. Luật kiểm kê: chỉ phiên còn mở quá 7 ngày; phiên đã chốt / đã hủy không bị bắt.
  if exists (select 1 from app_private.control_rule_count_open_stale() c
             join public.wms_inventory_counts x on x.id::text = c.object_id
             where x.status not in ('counting', 'submitted')) then
    raise exception 'FAIL 7 luật kiểm kê bắt cả phiên đã chốt / đã hủy'; end if;
  insert into k3 values ('kiem_ke_mo_lau', (select count(*) from app_private.control_rule_count_open_stale()) || ' phiên');

  -- 8. Bộ chạy: mở lệch, chạy lần hai không mở trùng, luật shadow không sinh thông báo.
  select count(*) into v_before from public.notifications;
  res := app_private.control_run(null, 'smoke');
  if jsonb_array_length(res->'errors') > 0 then raise exception 'FAIL 8 bộ chạy lỗi: %', res->'errors'; end if;
  select count(*) into n from public.control_findings f join public.control_rules x on x.code = f.rule_code
    where x.module_key = 'WMS' and x.sort_order between 190 and 270 and f.status = 'open';
  if n = 0 then raise exception 'FAIL 8b sổ phát hiện không có lệch Kho nào'; end if;
  insert into k3 values ('so_phat_hien', n || ' lệch mở');
  res := app_private.control_run(null, 'smoke');
  select count(*) into v_after from public.control_findings f join public.control_rules x on x.code = f.rule_code
    where x.module_key = 'WMS' and x.sort_order between 190 and 270 and f.status = 'open';
  if v_after <> n then raise exception 'FAIL 8c chạy lần hai đổi số lệch: % -> %', n, v_after; end if;
  select count(*) into v_after from public.notifications;
  if v_after <> v_before then raise exception 'FAIL 8d luật shadow sinh % thông báo', v_after - v_before; end if;
  insert into k3 values ('chay_lai_khong_trung', 'đạt');

  -- 9. Luật shadow chưa báo ai (kể cả P0) và lệch cũ cũng không báo — Admin xem ở tab Kiểm soát rồi mới bật.
  if exists (select 1 from public.control_findings f join public.control_rules x on x.code = f.rule_code
             where x.module_key = 'WMS' and x.sort_order between 190 and 270 and f.notified_at is not null) then
    raise exception 'FAIL 9 luật K3 đang shadow mà đã báo người xử lý'; end if;
  -- Mốc lệch cũ / mới phải theo since_date của luật (01/10), không theo ngày chạy.
  if exists (select 1 from public.control_findings f join public.control_rules x on x.code = f.rule_code
             where x.module_key = 'WMS' and x.sort_order between 190 and 270
               and f.legacy <> (f.happened_on < x.since_date)) then
    raise exception 'FAIL 9b cờ lệch cũ không khớp since_date'; end if;
  insert into k3 values ('shadow_khong_bao',
    (select count(*) filter (where not f.legacy) || ' mới / ' || count(*) filter (where f.legacy) || ' cũ'
     from public.control_findings f join public.control_rules x on x.code = f.rule_code
     where x.module_key = 'WMS' and x.sort_order between 190 and 270 and f.status = 'open'));
end $$;

select buoc, ket_qua from k3 order by buoc;
rollback;
