-- Trợ lý đọc sổ lệch: tra theo luật / người / phân hệ, quyền giữ nguyên. Giao dịch tự hủy trên Cloud.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261031150000_control_findings_search.sql --smoke supabase/tests/control_findings_search_smoke.sql
begin;
create temp table ks(buoc text primary key, ket_qua text) on commit drop;

do $$
declare r jsonb; v_admin uuid; v_hr uuid; v_nguoi_la uuid; n bigint;
begin
  select id into v_admin from public.users where name = 'Admin Hoàng' and auth_id is not null limit 1;
  if v_admin is null then raise exception 'FAIL 0 không tìm được Admin'; end if;

  -- ── Admin: thấy hết ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'email', u.email, 'role', 'authenticated')::text, true)
  from public.users u where u.id = v_admin;

  -- 1. Không lọc → bảng tổng hợp theo luật, không trả danh sách dài.
  r := public.control_findings_search_v1();
  if jsonb_array_length(r->'tom_tat') = 0 then raise exception 'FAIL 1 không có bảng tổng hợp'; end if;
  if jsonb_array_length(r->'ket_qua') <> 0 then raise exception 'FAIL 1b không lọc mà vẫn trả danh sách'; end if;
  insert into ks values ('admin:tong_hop', jsonb_array_length(r->'tom_tat') || ' luật đang báo, ' || (r->>'tong_so') || ' lệch');

  -- 2. Đúng câu chủ SP hỏi 24/10: "3 người đã nghỉ việc mà chưa ghi ngày nghỉ là ai".
  r := public.control_findings_search_v1(p_rule => 'nghỉ việc');
  if jsonb_array_length(r->'ket_qua') = 0 then raise exception 'FAIL 2 tra theo tên luật không ra gì'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'ket_qua') x where x->>'ma' is not null and x->>'lech' is not null) then
    raise exception 'FAIL 2b kết quả thiếu mã / câu mô tả lệch'; end if;
  insert into ks values ('admin:tra_theo_ten_luat', (r->>'tong_so') || ' lệch · ' ||
    (select string_agg(x->>'ma', ', ') from jsonb_array_elements(r->'ket_qua') x));

  -- 3. Tra theo mã luật chính xác.
  r := public.control_findings_search_v1(p_rule => 'leave_approved_no_ledger');
  if (r->>'tong_so')::bigint = 0 then raise exception 'FAIL 3 tra theo mã luật không ra gì'; end if;
  insert into ks values ('admin:tra_theo_ma_luat', (r->>'tong_so') || ' lệch');

  -- 4. Tra theo người — không dấu cũng phải ra (người dùng gõ nhanh không bỏ dấu).
  r := public.control_findings_search_v1(p_who => 'nguyen');
  insert into ks values ('admin:tra_theo_nguoi_khong_dau', (r->>'tong_so') || ' lệch');
  if (r->>'tong_so')::bigint = 0 then raise exception 'FAIL 4 tra theo tên không dấu không ra gì'; end if;

  -- 5. Tra theo phân hệ + mức.
  r := public.control_findings_search_v1(p_module => 'Nhân sự', p_severity => 'P0');
  if not exists (select 1 from jsonb_array_elements(r->'ket_qua') x where x->>'muc' = 'P0' and x->>'phan_he' = 'Nhân sự') then
    raise exception 'FAIL 5 lọc phân hệ + mức ra sai'; end if;
  insert into ks values ('admin:loc_phan_he_muc', (r->>'tong_so') || ' lệch P0 Nhân sự');

  -- 6. Vẫn tra được theo mã chứng từ như công cụ cũ.
  r := public.control_findings_search_v1(p_who => 'PO-');
  insert into ks values ('admin:tra_theo_ma_chung_tu', (r->>'tong_so') || ' lệch có mã PO');

  -- 7. Luật đang chạy thử phải ghi rõ, để Trợ lý không nói như đã bật.
  if exists (select 1 from jsonb_array_elements(public.control_findings_search_v1(p_module => 'Kho')->'tom_tat') x
             join public.control_rules cr on cr.code = x->>'ma_luat'
             where (x->>'dang_chay_thu')::boolean is distinct from (cr.mode <> 'live')) then
    raise exception 'FAIL 7 cờ đang chạy thử sai'; end if;
  insert into ks values ('admin:co_chay_thu', 'đúng');

  -- 8. Giới hạn số dòng.
  r := public.control_findings_search_v1(p_module => 'Kho', p_limit => 3);
  if jsonb_array_length(r->'ket_qua') > 3 then raise exception 'FAIL 8 không tôn trọng p_limit'; end if;
  insert into ks values ('admin:gioi_han', jsonb_array_length(r->'ket_qua') || '/3 dòng');

  -- ── Người không phải Admin, không phải người xử lý: KHÔNG được thấy gì ──
  select u.id into v_nguoi_la from public.users u
  where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null and u.role <> 'ADMIN'
    and not exists (select 1 from public.control_findings f where u.id = any(f.assignee_ids) or u.id = any(f.escalate_ids))
  limit 1;
  if v_nguoi_la is null then raise exception 'FAIL 9 không tìm được người ngoài để thử quyền'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'email', u.email, 'role', 'authenticated')::text, true)
  from public.users u where u.id = v_nguoi_la;
  r := public.control_findings_search_v1(p_rule => 'nghỉ việc');
  if (r->>'tong_so')::bigint <> 0 then raise exception 'FAIL 9 người ngoài thấy % lệch Nhân sự', r->>'tong_so'; end if;
  r := public.control_findings_search_v1();
  if jsonb_array_length(r->'tom_tat') <> 0 then raise exception 'FAIL 9b người ngoài thấy bảng tổng hợp'; end if;
  insert into ks values ('nguoi_ngoai:khong_thay_gi', 'đạt');

  -- ── Người xử lý thật (được giao lệch ở luật đã bật): thấy đúng lệch của mình, không thấy lệch cũ ──
  select u.id into v_hr from public.users u
  join public.control_findings f on u.id = any(f.assignee_ids)
  join public.control_rules cr on cr.code = f.rule_code and cr.mode = 'live'
  where u.is_active and u.auth_id is not null and not f.legacy and u.role <> 'ADMIN' limit 1;
  if v_hr is null then raise exception 'FAIL 10 không tìm được người xử lý để thử'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'email', u.email, 'role', 'authenticated')::text, true)
  from public.users u where u.id = v_hr;
  r := public.control_findings_search_v1();
  if (r->>'tong_so')::bigint = 0 then raise exception 'FAIL 10 người xử lý không thấy lệch nào của mình'; end if;
  -- Không được lọt lệch cũ hoặc lệch của luật đang chạy thử.
  if exists (select 1 from jsonb_array_elements(r->'tom_tat') x where (x->>'so_lech_cu')::bigint > 0) then
    raise exception 'FAIL 10b người xử lý thấy dữ liệu cũ'; end if;
  if exists (select 1 from jsonb_array_elements(r->'tom_tat') x where (x->>'dang_chay_thu')::boolean) then
    raise exception 'FAIL 10c người xử lý thấy luật đang chạy thử'; end if;
  insert into ks values ('nguoi_xu_ly:chi_thay_cua_minh', (r->>'tong_so') || ' lệch, không có dữ liệu cũ / luật chạy thử');

  -- ── Chưa đăng nhập thì chặn ──
  perform set_config('request.jwt.claims', '{}', true);
  begin
    r := public.control_findings_search_v1();
    raise exception 'FAIL 11 chưa đăng nhập vẫn tra được';
  exception when sqlstate '42501' then null;
  end;
  insert into ks values ('chua_dang_nhap:chan', 'đạt');
end $$;

select buoc, ket_qua from ks order by buoc;
rollback;
