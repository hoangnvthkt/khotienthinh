-- Trợ lý · tình hình hôm nay của một nhóm. Giao dịch tự hủy trên Cloud, dữ liệu thật + 3 hạng người.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261031160000_assistant_today_status.sql --smoke supabase/tests/assistant_today_status_smoke.sql
begin;
create temp table tt(buoc text primary key, ket_qua text) on commit drop;

do $$
declare r jsonb; v_admin uuid; v_hr uuid; v_thuong uuid; n bigint;
begin
  select id into v_admin from public.users where name = 'Admin Hoàng' and auth_id is not null limit 1;
  if v_admin is null then raise exception 'FAIL 0 không tìm được Admin'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'email', u.email, 'role', 'authenticated')::text, true)
  from public.users u where u.id = v_admin;

  -- ── 1. Chấm công: đúng câu chủ SP hỏi, lọc theo phòng ──
  r := public.assistant_today_status_v1('cham_cong', 'hanh chinh nhan su');
  if (r->>'tong_nguoi_xem_duoc')::bigint = 0 then raise exception 'FAIL 1 Admin không xem được ai'; end if;
  if jsonb_array_length(r->'ket_qua') = 0 and (r->>'tong_so')::bigint > 0 then
    raise exception 'FAIL 1b có người chưa chấm mà không trả danh sách'; end if;
  -- Lọc không dấu phải ra đúng phòng đó.
  if exists (select 1 from jsonb_array_elements(r->'ket_qua') x
             where not app_private.vi_match(x->>'don_vi', 'hanh chinh nhan su')) then
    raise exception 'FAIL 1c lọc theo phòng ra cả người phòng khác'; end if;
  -- Khớp theo từng từ: gõ có dấu / không dấu / thiếu gạch ngang đều phải ra như nhau.
  if (public.assistant_today_status_v1('cham_cong', 'Hành chính Nhân sự')->>'tong_nguoi_xem_duoc')::bigint
     <> (r->>'tong_nguoi_xem_duoc')::bigint then
    raise exception 'FAIL 1e gõ có dấu ra khác gõ không dấu'; end if;
  insert into tt values ('admin:cham_cong_HCNS',
    (r->>'tong_nguoi_xem_duoc') || ' người · đã chấm ' || (r->>'da_cham') || ' · nghỉ phép ' || (r->>'dang_nghi_phep')
    || ' · CHƯA CHẤM ' || (r->>'tong_so'));

  -- 1d. Người đang nghỉ phép đã duyệt KHÔNG được tính là chưa chấm công.
  r := public.assistant_today_status_v1('cham_cong');
  if exists (select 1 from jsonb_array_elements(r->'ket_qua') x
             join public.employees e on e.employee_code = x->>'ma'
             where exists (select 1 from public.hrm_leave_requests lr where lr."employeeId" = e.id and lr.status = 'approved'
               and to_char(current_date, 'YYYY-MM-DD') between lr."startDate" and lr."endDate")) then
    raise exception 'FAIL 1d người đang nghỉ phép bị tính là chưa chấm công'; end if;
  insert into tt values ('admin:cham_cong_toan_cong_ty',
    (r->>'tong_so') || ' chưa chấm / ' || (r->>'tong_nguoi_xem_duoc') || ' người');

  -- ── 2. Nghỉ phép hôm nay ──
  r := public.assistant_today_status_v1('nghi_phep');
  insert into tt values ('admin:nghi_phep_hom_nay', (r->>'tong_so') || ' người');
  if (r->>'tong_so')::bigint > 0 and jsonb_array_length(r->'ket_qua') = 0 then
    raise exception 'FAIL 2 có người nghỉ mà không trả danh sách'; end if;
  if exists (select 1 from jsonb_array_elements(r->'ket_qua') x where x->>'ten' is null or x->>'link' not like '/hrm/leave%') then
    raise exception 'FAIL 2b thiếu tên hoặc đường dẫn'; end if;

  -- ── 3. Nhật ký: chỉ tính công trường ĐANG dùng, không tính công trường chưa ghi bao giờ ──
  r := public.assistant_today_status_v1('nhat_ky');
  if (r->>'cong_truong_dang_dung')::bigint > (select count(*) from public.hrm_construction_sites) then
    raise exception 'FAIL 3 đếm sai số công trường'; end if;
  if exists (select 1 from jsonb_array_elements(r->'ket_qua') x
             where not exists (select 1 from public.daily_logs l
               join public.hrm_construction_sites s on s.id::text = l.construction_site_id
               where s.name = x->>'ten' and l.date::date >= current_date - 30)) then
    raise exception 'FAIL 3b báo cả công trường không dùng nhật ký'; end if;
  insert into tt values ('admin:nhat_ky', (r->>'cong_truong_dang_dung') || ' công trường đang dùng · đã gửi '
    || (r->>'da_gui') || ' · CHƯA GỬI ' || (r->>'tong_so'));

  -- ── 4. Phiếu quy trình đứng im ──
  r := public.assistant_today_status_v1('phieu_dung', null, null, 7);
  insert into tt values ('admin:phieu_dung_7_ngay', (r->>'tong_so') || ' phiếu');
  if (r->>'tong_so')::bigint = 0 then raise exception 'FAIL 4 không bắt được phiếu đứng im nào'; end if;
  if exists (select 1 from jsonb_array_elements(r->'ket_qua') x where (x->>'so_ngay_dung')::int < 7) then
    raise exception 'FAIL 4b trả cả phiếu mới động dưới 7 ngày'; end if;
  -- Ngưỡng ngày phải có tác dụng.
  if (public.assistant_today_status_v1('phieu_dung', null, null, 60)->>'tong_so')::bigint
     > (r->>'tong_so')::bigint then raise exception 'FAIL 4c ngưỡng 60 ngày ra nhiều hơn 7 ngày'; end if;
  insert into tt values ('admin:nguong_ngay', 'có tác dụng');

  -- ── 5. Chặn đầu vào sai ──
  begin r := public.assistant_today_status_v1('linh tinh'); raise exception 'FAIL 5 loại sai vẫn chạy';
  exception when sqlstate '22023' then null; end;
  begin r := public.assistant_today_status_v1('cham_cong', null, current_date + 1); raise exception 'FAIL 5b ngày tương lai vẫn chạy';
  exception when sqlstate '22023' then null; end;
  insert into tt values ('chan_dau_vao_sai', 'đạt');

  -- ── 6. Nhân viên thường: không có quyền xem chấm công người khác thì chỉ thấy chính mình hoặc rỗng ──
  select u.id into v_thuong from public.users u
  join public.employees e on e.user_id = u.id
  where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null and u.role <> 'ADMIN'
    and not app_private.has_governed_hrm_permission(u.id, 'hrm.attendance.view', 'global', '*')
    and not app_private.has_governed_hrm_permission(u.id, 'hrm.attendance.view', 'direct_reports', '*')
  limit 1;
  if v_thuong is null then raise exception 'FAIL 6 không tìm được nhân viên thường để thử'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'email', u.email, 'role', 'authenticated')::text, true)
  from public.users u where u.id = v_thuong;
  r := public.assistant_today_status_v1('cham_cong');
  if (r->>'tong_nguoi_xem_duoc')::bigint > 1 then
    raise exception 'FAIL 6 nhân viên thường xem được % người', r->>'tong_nguoi_xem_duoc'; end if;
  insert into tt values ('nhan_vien_thuong:chi_thay_minh', (r->>'tong_nguoi_xem_duoc') || ' người');
  r := public.assistant_today_status_v1('nghi_phep');
  if (r->>'tong_so')::bigint > 1 then raise exception 'FAIL 6b nhân viên thường thấy % đơn nghỉ', r->>'tong_so'; end if;
  insert into tt values ('nhan_vien_thuong:nghi_phep', (r->>'tong_so') || ' đơn');

  -- ── 7. Chưa đăng nhập thì chặn ──
  perform set_config('request.jwt.claims', '{}', true);
  begin r := public.assistant_today_status_v1('cham_cong'); raise exception 'FAIL 7 chưa đăng nhập vẫn tra được';
  exception when sqlstate '42501' then null; end;
  insert into tt values ('chua_dang_nhap:chan', 'đạt');
end $$;

select buoc, ket_qua from tt order by buoc;
rollback;
