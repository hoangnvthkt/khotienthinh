-- Kiểm soát viên K3 đợt 3 (Nhân sự): 14 luật trên dữ liệu thật + ca dựng cho luật đang bằng 0, giao dịch tự hủy.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261031120000_control_k3_hrm.sql --smoke supabase/tests/control_k3_hrm_smoke.sql
begin;
create temp table k3h(buoc text primary key, ket_qua text) on commit drop;

do $$
declare
  r record; n bigint; dup bigint; res jsonb; v_mode text; v_before bigint; v_after bigint;
  v_emp uuid; v_att uuid; v_req uuid; v_bal uuid; v_pay uuid; v_hr uuid[]; v_date text;
  v_led uuid; v_emp2 uuid;
begin
  -- ── 1. Mọi luật chạy không lỗi, object_key không trùng, đường dẫn mở được màn Nhân sự ──
  for r in select code, fn from public.control_rules where module_key = 'HRM' and sort_order between 380 and 510 order by sort_order loop
    execute format('select count(*), count(*) - count(distinct object_key) from app_private.%I()', r.fn) into n, dup;
    if dup > 0 then raise exception 'FAIL 1 luật % có % object_key trùng', r.code, dup; end if;
    execute format('select count(*) from app_private.%I() where link is null or link not like ''/hrm/%%''', r.fn) into dup;
    if dup > 0 then raise exception 'FAIL 1b luật % có % dòng thiếu đường dẫn Nhân sự', r.code, dup; end if;
    insert into k3h values ('luat:' || r.code, n || ' dòng');
  end loop;

  -- ── 2. Cả 14 luật phải ở shadow ──
  select string_agg(distinct mode, ',') into v_mode from public.control_rules where module_key = 'HRM' and sort_order between 380 and 510;
  if v_mode <> 'shadow' then raise exception 'FAIL 2 luật K3 Nhân sự phải ở shadow, đang %', v_mode; end if;
  insert into k3h values ('che_do', v_mode);

  -- ── 3. Route 'hr' phải ra người có quyền Nhân sự · Quản trị, không rải cho người khác ──
  v_hr := app_private.alert_module_manager_ids(array['HRM']);
  if coalesce(array_length(v_hr, 1), 0) = 0 then
    raise exception 'FAIL 3 không có ai quyền Nhân sự · Quản trị — lệch Nhân sự sẽ chỉ tới Admin'; end if;
  insert into k3h values ('route_hr', array_length(v_hr, 1) || ' người quyền Nhân sự · Quản trị');
  -- Route cũ không được đổi hành vi: luật Kho vẫn ra thủ kho, luật Công nợ vẫn ra người Tài chính.
  if not exists (select 1 from public.control_rules where code = 'batch_wms_status' and route = '{warehouse,buyer}') then
    raise exception 'FAIL 3b route luật Kho bị đổi'; end if;
  if not exists (select 1 from public.control_rules where code = 'ap_vs_accepted' and route = '{payable}') then
    raise exception 'FAIL 3c route luật Công nợ bị đổi'; end if;
  insert into k3h values ('route_cu_khong_doi', 'đạt');

  -- ── 3d. Luật phải đọc tên từ bảng employees: HRM trỏ employees(id), KHÔNG phải users(id).
  -- Bản đầu join users khớp 0/1.988 dòng nên mọi tiêu đề ra "—" và một luật thành mã chết.
  if exists (select 1 from app_private.control_rule_att_future_date() where object_code is null or object_code = '—') then
    raise exception 'FAIL 3d luật chấm công không lấy được mã / tên nhân viên'; end if;
  if exists (select 1 from app_private.control_rule_att_suspicion_unresolved() where title like '%—%') then
    raise exception 'FAIL 3e tiêu đề luật dấu hiệu chấm hộ thiếu tên nhân viên'; end if;
  insert into k3h values ('doc_dung_bang_employees', 'đạt');

  -- ── 4. Bất biến gốc của phép: số dư = tổng sổ, số dư lũy kế khớp. Lệch ở đây là dữ liệu hỏng, phải là 0 ──
  if exists (select 1 from app_private.control_rule_leave_balance_vs_ledger()) then
    raise exception 'FAIL 4 số dư phép lệch sổ phép: %', (select string_agg(title, ' | ') from app_private.control_rule_leave_balance_vs_ledger()); end if;
  if exists (select 1 from app_private.control_rule_leave_ledger_running()) then
    raise exception 'FAIL 4b số dư lũy kế sổ phép không khớp: %', (select string_agg(title, ' | ') from app_private.control_rule_leave_ledger_running()); end if;
  insert into k3h values ('bat_bien_phep', 'khớp');

  -- ── 5. Các luật có lệch thật hôm nay ──
  select count(*) into n from app_private.control_rule_att_future_date();
  if n = 0 then raise exception 'FAIL 5 luật chấm công ngày tương lai không bắt được bản ghi nào'; end if;
  insert into k3h values ('cham_cong_ngay_tuong_lai', n || ' bản ghi');
  select count(*) into n from app_private.control_rule_att_suspicion_unresolved();
  if n = 0 then raise exception 'FAIL 5b luật dấu hiệu chấm hộ không bắt được bản ghi nào'; end if;
  -- Không được bắt bản ghi chỉ có cờ no_passkey (299 bản ghi — chưa cài passkey không phải lệch).
  if exists (select 1 from app_private.control_rule_att_suspicion_unresolved() s
             join public.hrm_attendance a on a.id::text = s.object_id
             where not exists (select 1 from jsonb_array_elements_text(a."suspicionFlags") f where f <> 'no_passkey')) then
    raise exception 'FAIL 5c luật dấu hiệu chấm hộ bắt cả bản ghi chỉ thiếu passkey'; end if;
  insert into k3h values ('dau_hieu_cham_ho', n || ' bản ghi (đã bỏ no_passkey)');
  select count(*) into n from app_private.control_rule_leave_approved_no_ledger();
  if n = 0 then raise exception 'FAIL 5d luật phép duyệt chưa vào sổ không bắt được đơn nào'; end if;
  insert into k3h values ('phep_duyet_chua_vao_so', n || ' đơn');
  select count(*) into n from app_private.control_rule_leave_vs_attendance();
  if n = 0 then raise exception 'FAIL 5e luật nghỉ phép mà vẫn chấm công không bắt được ngày nào'; end if;
  insert into k3h values ('nghi_phep_van_cham_cong', n || ' ngày');
  select count(*) into n from app_private.control_rule_leave_stuck_pending();
  if n = 0 then raise exception 'FAIL 5f luật đơn phép treo duyệt không bắt được đơn nào'; end if;
  insert into k3h values ('don_phep_treo_duyet', n || ' đơn');
  select count(*) into n from app_private.control_rule_employee_resigned_no_exit_date();
  if n = 0 then raise exception 'FAIL 5g luật nghỉ việc chưa ghi ngày không bắt được ai'; end if;
  if exists (select 1 from app_private.control_rule_employee_resigned_no_exit_date() z
             join public.employees e on e.id::text = z.object_id where e.status <> 'Đã nghỉ việc') then
    raise exception 'FAIL 5h luật nghỉ việc bắt cả người đang làm'; end if;
  insert into k3h values ('nghi_viec_chua_ghi_ngay', n || ' người');

  -- ── 6. Bộ chạy trên dữ liệu thật SẠCH (phải chạy TRƯỚC khi dựng ca) ──
  select count(*) into v_before from public.notifications;
  res := app_private.control_run(null, 'smoke');
  if jsonb_array_length(res->'errors') > 0 then raise exception 'FAIL 6 bộ chạy lỗi: %', res->'errors'; end if;
  select count(*) into n from public.control_findings f join public.control_rules x on x.code = f.rule_code
    where x.module_key = 'HRM' and x.sort_order between 380 and 510 and f.status = 'open';
  if n = 0 then raise exception 'FAIL 6b sổ phát hiện không có lệch Nhân sự nào'; end if;
  res := app_private.control_run(null, 'smoke');
  select count(*) into v_after from public.control_findings f join public.control_rules x on x.code = f.rule_code
    where x.module_key = 'HRM' and x.sort_order between 380 and 510 and f.status = 'open';
  if v_after <> n then raise exception 'FAIL 6c chạy lần hai đổi số lệch: % -> %', n, v_after; end if;
  select count(*) into v_after from public.notifications;
  if v_after <> v_before then raise exception 'FAIL 6d luật shadow sinh % thông báo', v_after - v_before; end if;
  if exists (select 1 from public.control_findings f join public.control_rules x on x.code = f.rule_code
             where x.module_key = 'HRM' and x.sort_order between 380 and 510 and f.notified_at is not null) then
    raise exception 'FAIL 6e luật Nhân sự đang shadow mà đã báo người xử lý'; end if;
  insert into k3h values ('bo_chay', n || ' lệch mở trên dữ liệu thật, chạy lại không trùng, không báo ai');

  -- ── 7. Ca dựng cho các luật đang bằng 0 (giao dịch tự hủy nên không để lại gì) ──
  select at."employeeId", at.id, at.date into v_emp, v_att, v_date
  from public.hrm_attendance at where at."checkIn" is not null and at."checkOut" is not null
    and at.date < to_char(current_date, 'YYYY-MM-DD') order by at.date desc limit 1;
  if v_emp is null then raise exception 'FAIL 7 không có bản ghi chấm công nền để dựng ca'; end if;

  -- 7a. Giờ ra trước giờ vào.
  update public.hrm_attendance set "checkOut" = '06:00', "checkIn" = '17:00' where id = v_att;
  if not exists (select 1 from app_private.control_rule_att_checkout_before_checkin() where object_id = v_att::text) then
    raise exception 'FAIL 7a luật giờ ra trước giờ vào không bắt'; end if;
  update public.hrm_attendance set "checkIn" = '06:00', "checkOut" = '17:00' where id = v_att;
  if exists (select 1 from app_private.control_rule_att_checkout_before_checkin() where object_id = v_att::text) then
    raise exception 'FAIL 7a2 luật giờ ra trước giờ vào báo nhầm bản ghi bình thường'; end if;
  insert into k3h values ('ca_dung:gio_ra_truoc_vao', 'bắt đúng, bình thường thì sạch');

  -- 7b. Chấm công ngoài phạm vi chưa duyệt.
  update public.hrm_attendance set "isOutOfRange" = true, "approvalStatus" = 'pending' where id = v_att;
  if not exists (select 1 from app_private.control_rule_att_out_of_range_pending() where object_id = v_att::text) then
    raise exception 'FAIL 7b luật chấm ngoài phạm vi không bắt'; end if;
  update public.hrm_attendance set "approvalStatus" = 'approved' where id = v_att;
  if exists (select 1 from app_private.control_rule_att_out_of_range_pending() where object_id = v_att::text) then
    raise exception 'FAIL 7b2 luật chấm ngoài phạm vi vẫn báo sau khi đã duyệt'; end if;
  update public.hrm_attendance set "isOutOfRange" = false where id = v_att;
  insert into k3h values ('ca_dung:ngoai_pham_vi', 'bắt đúng, duyệt rồi thì sạch');

  -- 7c. Chấm công sau ngày nghỉ việc.
  insert into public.hrm_employee_employment_events (employee_id, record_code, event_type_code, event_date, reason, status, created_by)
  values (v_emp, 'KSTEST-EXIT', 'NGHI_VIEC', (v_date::date - 1), 'ca dựng kiểm soát', 'ACTIVE',
    (select id from public.users where is_active order by created_at limit 1));
  if not exists (select 1 from app_private.control_rule_att_after_exit() where object_id = v_att::text) then
    raise exception 'FAIL 7c luật chấm công sau ngày nghỉ việc không bắt'; end if;
  -- Sự kiện đã hủy (VOID) thì không còn tính là nghỉ việc.
  update public.hrm_employee_employment_events set status = 'VOID' where employee_id = v_emp and record_code = 'KSTEST-EXIT';
  if exists (select 1 from app_private.control_rule_att_after_exit() where object_id = v_att::text) then
    raise exception 'FAIL 7c2 luật vẫn tính nghỉ việc dù sự kiện đã hủy (VOID)'; end if;
  update public.hrm_employee_employment_events set status = 'ACTIVE' where employee_id = v_emp and record_code = 'KSTEST-EXIT';
  insert into k3h values ('ca_dung:sau_ngay_nghi_viec', 'bắt đúng, sự kiện hủy thì sạch');

  -- 7d. Số dư phép khác sổ phép (bất biến gốc). Không phá được từ phía số dư: trigger
  -- `trg_hrm_leave_balance_write_ledger` tự ghi dòng sổ cho mọi lần sửa số dư. Lỗi thật chỉ đến từ phía SỔ
  -- (dòng bị sửa / xóa), nên ca dựng sửa một dòng sổ không phải dòng cuối.
  select ll.id, ll.employee_id into v_led, v_emp2 from public.hrm_leave_ledger ll
  where ll.kind = 'opening' and exists (select 1 from public.hrm_leave_ledger x
    where x.employee_id = ll.employee_id and x.year = ll.year and (x.created_at, x.id) > (ll.created_at, ll.id))
  limit 1;
  if v_led is null then raise exception 'FAIL 7d không tìm được dòng sổ phép giữa để dựng ca'; end if;
  select lb.id into v_bal from public.hrm_leave_balances lb where lb."employeeId" = v_emp2 limit 1;
  update public.hrm_leave_ledger set days = days - 2 where id = v_led;
  if not exists (select 1 from app_private.control_rule_leave_balance_vs_ledger() where object_id = v_bal::text) then
    raise exception 'FAIL 7d luật số dư phép khác sổ không bắt'; end if;
  if not exists (select 1 from app_private.control_rule_leave_balance_vs_ledger()
                 where object_id = v_bal::text and (detail->>'lech')::numeric > 1.9) then
    raise exception 'FAIL 7d2 luật số dư phép ghi sai số lệch'; end if;
  -- Sửa dòng giữa cũng làm số dư lũy kế ở dòng cuối không còn khớp tổng.
  if not exists (select 1 from app_private.control_rule_leave_ledger_running() where object_id = v_emp2::text) then
    raise exception 'FAIL 7d3 luật số dư lũy kế sổ phép không bắt'; end if;
  update public.hrm_leave_ledger set days = days + 2 where id = v_led;
  if exists (select 1 from app_private.control_rule_leave_balance_vs_ledger() where object_id = v_bal::text) then
    raise exception 'FAIL 7d4 luật số dư phép vẫn báo sau khi đưa sổ về đúng'; end if;
  insert into k3h values ('ca_dung:so_du_phep', 'hai luật bất biến bắt đúng, đưa sổ về đúng thì sạch');

  -- 7e. Hai đơn phép trùng ngày.
  -- Bí danh phải khác biến `r record` ở trên, nếu không plpgsql hiểu `r.id` là trường của biến (lỗi 42703).
  select lr.id into v_req from public.hrm_leave_requests lr where lr.status in ('approved', 'pending') order by lr."createdAt" desc limit 1;
  if v_req is null then raise exception 'FAIL 7e không có đơn phép nền để dựng ca'; end if;
  insert into public.hrm_leave_requests ("employeeId", type, "startDate", "endDate", "totalDays", reason, status, "isPaid", code, created_by)
  select lr."employeeId", lr.type, lr."startDate", lr."endDate", lr."totalDays", 'ca dựng kiểm soát', 'pending', lr."isPaid",
    'KSTEST-LV-1', (select id from public.users where is_active order by created_at limit 1)
  from public.hrm_leave_requests lr where lr.id = v_req;
  if not exists (select 1 from app_private.control_rule_leave_overlap()) then
    raise exception 'FAIL 7e luật hai đơn phép trùng ngày không bắt'; end if;
  insert into k3h values ('ca_dung:don_phep_trung', 'bắt đúng');

  -- 7f. Lương thực nhận khác lương gộp trừ các khoản.
  select pr.id into v_pay from public.hrm_payrolls pr order by pr."createdAt" desc limit 1;
  if v_pay is null then raise exception 'FAIL 7f không có bảng lương nền để dựng ca'; end if;
  update public.hrm_payrolls set "netSalary" = coalesce("netSalary", 0) + 1000000 where id = v_pay;
  if not exists (select 1 from app_private.control_rule_payroll_net_vs_gross() where object_id = v_pay::text) then
    raise exception 'FAIL 7f luật lương thực nhận lệch không bắt'; end if;
  if not exists (select 1 from app_private.control_rule_payroll_net_vs_gross()
                 where object_id = v_pay::text and amount > 999999) then
    raise exception 'FAIL 7f2 luật lương ghi sai số lệch'; end if;
  -- Tiêu đề không được in con số lương; chỉ nói số lệch (các số lương để trong detail).
  if exists (select 1 from app_private.control_rule_payroll_net_vs_gross() where object_id = v_pay::text
             and title like '%' || to_char((select coalesce("grossSalary", 0) from public.hrm_payrolls where id = v_pay), 'FM999G999G999G990') || '%') then
    raise exception 'FAIL 7f3 tiêu đề luật lương in cả con số lương gộp'; end if;
  update public.hrm_payrolls set "netSalary" = coalesce("netSalary", 0) - 1000000 where id = v_pay;
  insert into k3h values ('ca_dung:luong_thuc_nhan', 'bắt đúng + đúng số lệch, tiêu đề không in lương');

  -- 7g. Đề xuất chấm công treo duyệt quá 3 ngày.
  insert into public.hrm_attendance_proposals ("proposerEmployeeId", "targetEmployeeId", date, "checkIn", "checkOut",
    status, reason, "proposalStatus", "createdAt")
  values (v_emp::text, v_emp::text, current_date - 10, '08:00', '17:00', 'present', 'ca dựng kiểm soát', 'pending', now() - interval '10 days');
  if not exists (select 1 from app_private.control_rule_att_proposal_stuck()) then
    raise exception 'FAIL 7g luật đề xuất chấm công treo duyệt không bắt'; end if;
  insert into k3h values ('ca_dung:de_xuat_treo', 'bắt đúng');

  -- 7h. Ghi ngày nghỉ việc cho một người đang bị báo thì luật phải sạch người đó.
  select z.object_id::uuid into v_bal from app_private.control_rule_employee_resigned_no_exit_date() z limit 1;
  insert into public.hrm_employee_employment_events (employee_id, record_code, event_type_code, event_date, reason, status, created_by)
  values (v_bal, 'KSTEST-EXIT2', 'NGHI_VIEC', current_date - 30, 'ca dựng kiểm soát', 'ACTIVE',
    (select id from public.users where is_active order by created_at limit 1));
  if exists (select 1 from app_private.control_rule_employee_resigned_no_exit_date() where object_id = v_bal::text) then
    raise exception 'FAIL 7h luật nghỉ việc vẫn báo sau khi đã ghi ngày nghỉ việc'; end if;
  insert into k3h values ('ca_dung:ghi_ngay_nghi_viec', 'ghi ngày rồi thì sạch');
end $$;

select buoc, ket_qua from k3h order by buoc;
rollback;
