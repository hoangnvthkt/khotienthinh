-- Kiểm soát viên K3 đợt 3 — phủ luật sang phân hệ Nhân sự (14 luật, chạy thử shadow).
--   Phạm vi: chấm công, phép, lương. Dữ liệu thật đầy đủ (1.988 bản ghi chấm công, 42 đơn phép, 35 bảng lương)
--   nên đo được số lệch thật: 32 lệch trên 5 luật, 9 luật còn lại là luật canh đang bằng 0.
--   Thêm route 'hr' để lệch Nhân sự tới người có quyền Nhân sự · Quản trị (dữ liệu phép / lương là riêng tư,
--   không rải cho người khác).
-- Chỉ viết luật cho bất biến mà CSDL không tự chặn (chấm công trùng ngày, bảng lương trùng tháng,
-- số dư phép trùng năm đã có UNIQUE; số ngày phép bội 0,5 đã có CHECK).

-- ── Route 'hr': người có quyền Nhân sự · Quản trị ──────────────────────────────────────────────────────────────────
--   Giữ nguyên toàn bộ hành vi K1, chỉ thêm một nhánh. Không có ai thì rơi về chỉ Admin như cũ.
create or replace function app_private.control_route(p_rule public.control_rules, p_f public.control_findings, p_finance uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_po text := substring(coalesce(p_f.link, '') from 'po=([^&#]+)');
  v_wh text := p_f.warehouse_id;
  v_ids uuid[] := '{}'; v_esc uuid[] := '{}'; v_u uuid;
begin
  if v_po is not null and v_wh is null then select po.target_warehouse_id into v_wh from public.purchase_orders po where po.id = v_po; end if;
  if 'buyer' = any(p_rule.route) then
    if v_po is not null then
      select u.id into v_u from public.purchase_orders po join public.users u on u.id::text = po.created_by_id
      where po.id = v_po and u.is_active and u.account_status = 'ACTIVE';
      if v_u is not null then v_ids := v_ids || v_u; end if;
    end if;
    if p_f.object_type = 'material_request' and cardinality(v_ids) = 0 then
      v_ids := v_ids || coalesce((select array_agg(distinct a.assignee_user_id) from public.procurement_inbox_line_assignments a
        join public.users u on u.id = a.assignee_user_id and u.is_active and u.account_status = 'ACTIVE'
        where a.source_type = 'material_request' and a.source_id::text = p_f.object_id), '{}'::uuid[]);
    end if;
  end if;
  if 'warehouse' = any(p_rule.route) and v_wh is not null then
    v_ids := v_ids || coalesce((select array_agg(k) from app_private.wms_warehouse_keepers(v_wh) k), '{}'::uuid[]);
  end if;
  if 'payable' = any(p_rule.route) then v_ids := v_ids || coalesce(p_finance, '{}'::uuid[]); end if;
  -- Mới (K3 đợt 3): lệch Nhân sự giao cho người quản trị phân hệ Nhân sự. Phép / lương là dữ liệu riêng tư nên
  -- không giao cho quản lý trực tiếp của nhân viên bị báo.
  if 'hr' = any(p_rule.route) then
    v_ids := v_ids || coalesce(app_private.alert_module_manager_ids(array['HRM']), '{}'::uuid[]);
  end if;
  -- Không xác định được người phụ trách (đơn cũ không ghi người lập, đề xuất chưa có đơn / chưa giao dòng): chỉ giao Admin — không rải
  -- cho mọi người có quyền Quản trị phân hệ (thử 23/10: 9 người cùng nhận một lệch).
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('assignees', to_jsonb(app_private.alert_admin_ids()), 'escalate', '[]'::jsonb, 'fallback', true);
  end if;
  v_ids := array(select distinct x from unnest(v_ids) x where x is not null);
  -- Trưởng bộ phận: quản lý trực tiếp của từng người xử lý (không trùng người xử lý); không có thì người Quản trị phân hệ.
  v_esc := array(select distinct m from unnest(v_ids) a cross join lateral (select app_private.resolve_active_direct_manager(a) m) z
    where m is not null and not (m = any(v_ids)));
  if cardinality(v_esc) = 0 then
    v_esc := array(select x from unnest(app_private.alert_module_manager_ids(array[coalesce(p_rule.module_key, 'PROCUREMENT')])) x where not (x = any(v_ids)));
  end if;
  return jsonb_build_object('assignees', to_jsonb(v_ids), 'escalate', to_jsonb(v_esc));
end $$;

-- ── 1. Chấm công ngày tương lai (2 lệch thật) ──────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_att_future_date()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'attfuture:' || a.id::text, 'hrm_attendance', a.id::text, coalesce(u.employee_code, u.full_name, a."employeeId"::text), null::text, null::text,
    format('%s có bản ghi chấm công ngày %s — sau hôm nay', coalesce(u.full_name, '—'), a.date),
    jsonb_build_object('nhan_vien', u.full_name, 'ngay', a.date, 'trang_thai', a.status,
      'gio_vao', a."checkIn", 'gio_ra', a."checkOut"),
    null::numeric, a.date::date,
    '/hrm/attendance?tab=timesheet' || coalesce('&q=' || u.employee_code, '')
      || '&month=' || substr(a.date, 6, 2) || '&year=' || substr(a.date, 1, 4)
  from public.hrm_attendance a
  left join public.employees u on u.id = a."employeeId"
  where a.date > to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD');
$$;

-- ── 2. Giờ ra trước giờ vào ────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_att_checkout_before_checkin()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'attorder:' || a.id::text, 'hrm_attendance', a.id::text, coalesce(u.employee_code, u.full_name, a."employeeId"::text), null::text, null::text,
    format('%s ngày %s: giờ ra %s trước giờ vào %s', coalesce(u.full_name, '—'), a.date, a."checkOut", a."checkIn"),
    jsonb_build_object('nhan_vien', u.full_name, 'ngay', a.date, 'gio_vao', a."checkIn", 'gio_ra', a."checkOut",
      'so_lan_cham', a."eventCount"),
    null::numeric, a.date::date,
    '/hrm/attendance?tab=timesheet' || coalesce('&q=' || u.employee_code, '')
      || '&month=' || substr(a.date, 6, 2) || '&year=' || substr(a.date, 1, 4)
  from public.hrm_attendance a
  left join public.employees u on u.id = a."employeeId"
  where a."checkIn" is not null and a."checkOut" is not null and a."checkOut" < a."checkIn";
$$;

-- ── 3. Chấm công có dấu hiệu nhờ người khác chấm (6 lệch thật) ─────────────────────────────────────────────────────
--   Chỉ tính cờ thật (chung thiết bị, cùng điểm GPS). Bỏ 'no_passkey': chưa cài passkey là tình trạng thiết bị
--   của 299/1.988 bản ghi, không phải lệch.
create or replace function app_private.control_rule_att_suspicion_unresolved()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'attsuspect:' || a.id::text, 'hrm_attendance', a.id::text, coalesce(u.employee_code, u.full_name, a."employeeId"::text), null::text, null::text,
    format('%s ngày %s: chấm công có dấu hiệu %s', coalesce(u.full_name, '—'), a.date,
      (select string_agg(case f when 'shared_device' then 'chung thiết bị với người khác'
        when 'same_gps_fix' then 'cùng một điểm GPS với người khác' else f end, ', ')
       from jsonb_array_elements_text(a."suspicionFlags") f where f <> 'no_passkey')),
    jsonb_build_object('nhan_vien', u.full_name, 'ngay', a.date,
      'cac_dau_hieu', (select jsonb_agg(f) from jsonb_array_elements_text(a."suspicionFlags") f where f <> 'no_passkey'),
      'trang_thai_duyet', a."approvalStatus", 'ngoai_pham_vi', a."isOutOfRange", 'vi_tri', a."locationName"),
    null::numeric, a.date::date,
    '/hrm/attendance?tab=timesheet' || coalesce('&q=' || u.employee_code, '')
      || '&month=' || substr(a.date, 6, 2) || '&year=' || substr(a.date, 1, 4)
  from public.hrm_attendance a
  left join public.employees u on u.id = a."employeeId"
  where jsonb_typeof(a."suspicionFlags") = 'array'
    and exists (select 1 from jsonb_array_elements_text(a."suspicionFlags") f where f <> 'no_passkey')
    and coalesce(a."approvalStatus", 'pending') <> 'rejected';
$$;

-- ── 4. Chấm công ngoài phạm vi chưa ai duyệt ───────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_att_out_of_range_pending()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'attrange:' || a.id::text, 'hrm_attendance', a.id::text, coalesce(u.employee_code, u.full_name, a."employeeId"::text), null::text, null::text,
    format('%s ngày %s: chấm công ngoài phạm vi (%s), chờ duyệt %s ngày',
      coalesce(u.full_name, '—'), a.date, coalesce(a."locationName", 'không rõ vị trí'),
      (current_date - a.date::date)),
    jsonb_build_object('nhan_vien', u.full_name, 'ngay', a.date, 'vi_tri', a."locationName", 'loai_vi_tri', a."locationType",
      'so_ngay_cho', current_date - a.date::date),
    null::numeric, a.date::date,
    '/hrm/attendance?tab=timesheet' || coalesce('&q=' || u.employee_code, '')
      || '&month=' || substr(a.date, 6, 2) || '&year=' || substr(a.date, 1, 4)
  from public.hrm_attendance a
  left join public.employees u on u.id = a."employeeId"
  where a."isOutOfRange" and coalesce(a."approvalStatus", 'pending') = 'pending'
    and a.date::date < current_date;
$$;

-- ── 5. Đề xuất chấm công treo chờ duyệt quá 3 ngày ─────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_att_proposal_stuck()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'attproposal:' || p.id::text, 'hrm_attendance_proposal', p.id::text, coalesce(u.employee_code, u.full_name, p."targetEmployeeId"), null::text, null::text,
    format('Đề xuất chấm công cho %s ngày %s chờ duyệt %s ngày',
      coalesce(u.full_name, '—'), to_char(p.date, 'DD/MM/YYYY'),
      (current_date - (p."createdAt" at time zone 'Asia/Ho_Chi_Minh')::date)),
    jsonb_build_object('nhan_vien', u.full_name, 'ngay', p.date, 'nguoi_de_xuat', pu.full_name,
      'gui_toi', p."submittedToName", 'ly_do', p.reason,
      'so_ngay_cho', current_date - (p."createdAt" at time zone 'Asia/Ho_Chi_Minh')::date),
    null::numeric, (p."createdAt" at time zone 'Asia/Ho_Chi_Minh')::date,
    '/hrm/attendance?tab=proposals&proposal=' || p.id::text
  from public.hrm_attendance_proposals p
  left join public.employees u on u.id::text = p."targetEmployeeId"
  left join public.employees pu on pu.id::text = p."proposerEmployeeId"
  where coalesce(p."proposalStatus", 'pending') = 'pending' and p."createdAt" < now() - interval '3 days';
$$;

-- ── 6. Chấm công sau ngày nghỉ việc ────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_att_after_exit()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  with exits as (
    select e.employee_id, min(e.event_date) exit_date
    from public.hrm_employee_employment_events e
    where e.event_type_code = 'NGHI_VIEC' and coalesce(e.status, 'ACTIVE') <> 'VOID'
    group by 1
  )
  select 'attafterexit:' || a.id::text, 'hrm_attendance', a.id::text, coalesce(u.employee_code, u.full_name, a."employeeId"::text), null::text, null::text,
    format('%s đã nghỉ việc từ %s nhưng có chấm công ngày %s',
      coalesce(u.full_name, '—'), to_char(x.exit_date, 'DD/MM/YYYY'), a.date),
    jsonb_build_object('nhan_vien', u.full_name, 'ngay_nghi_viec', x.exit_date, 'ngay_cham_cong', a.date,
      'gio_vao', a."checkIn", 'gio_ra', a."checkOut"),
    null::numeric, a.date::date,
    '/hrm/attendance?tab=timesheet' || coalesce('&q=' || u.employee_code, '')
      || '&month=' || substr(a.date, 6, 2) || '&year=' || substr(a.date, 1, 4)
  from public.hrm_attendance a
  join exits x on x.employee_id = a."employeeId"
  left join public.employees u on u.id = a."employeeId"
  where a.date > to_char(x.exit_date, 'YYYY-MM-DD');
$$;

-- ── 7. Đã đánh dấu nghỉ việc mà chưa ghi ngày nghỉ việc (3 lệch thật) ─────────────────────────────────────────────
--   Thiếu ngày nghỉ việc thì không biết bản ghi chấm công / bảng lương nào sau ngày đó là sai (luật 6 cũng mù).
create or replace function app_private.control_rule_employee_resigned_no_exit_date()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'noexitdate:' || e.id::text, 'hrm_employee', e.id::text, coalesce(e.employee_code, e.full_name), null::text, null::text,
    format('%s đã đánh dấu nghỉ việc nhưng chưa ghi ngày nghỉ việc (còn %s bản ghi chấm công, %s bảng lương)',
      coalesce(e.full_name, '—'), v.so_cham_cong, v.so_bang_luong),
    jsonb_build_object('nhan_vien', e.full_name, 'ma_nhan_vien', e.employee_code, 'trang_thai', e.status,
      'ngay_vao', e.start_date, 'so_ban_ghi_cham_cong', v.so_cham_cong, 'so_bang_luong', v.so_bang_luong,
      'cham_cong_moi_nhat', v.cham_cong_cuoi),
    null::numeric, e.updated_at::date,
    '/hrm/employees?view=roster&person=' || e.id::text
  from public.employees e
  cross join lateral (
    select (select count(*) from public.hrm_attendance a where a."employeeId" = e.id) so_cham_cong,
      (select count(*) from public.hrm_payrolls p where p."employeeId" = e.id) so_bang_luong,
      (select max(a.date) from public.hrm_attendance a where a."employeeId" = e.id) cham_cong_cuoi
  ) v
  where e.status = 'Đã nghỉ việc'
    and not exists (select 1 from public.hrm_employee_employment_events x
      where x.employee_id = e.id and x.event_type_code = 'NGHI_VIEC' and coalesce(x.status, 'ACTIVE') <> 'VOID');
$$;

-- ── 8. Số dư phép khác sổ phép (bất biến gốc của phép) ─────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_leave_balance_vs_ledger()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  with led as (select l.employee_id, l.year, sum(l.days) d from public.hrm_leave_ledger l group by 1, 2)
  select 'leavebal:' || b.id::text, 'hrm_leave_balance', b.id::text, coalesce(u.employee_code, u.full_name, b."employeeId"::text), null::text, null::text,
    format('%s năm %s: số dư phép tính ra %s ngày, tổng sổ phép %s ngày — lệch %s ngày',
      coalesce(u.full_name, '—'), b.year,
      to_char(v.tinh, 'FM999990.0#'), to_char(coalesce(l.d, 0), 'FM999990.0#'), to_char(v.tinh - coalesce(l.d, 0), 'FM999990.0#')),
    jsonb_build_object('nhan_vien', u.full_name, 'nam', b.year, 'cong_don', b."accruedDays", 'chuyen_sang', b."carriedDays",
      'da_dung', b."usedPaidDays", 'dung_phep_chuyen', b."carryUsedDays",
      'so_du_tinh', v.tinh, 'tong_so_phep', coalesce(l.d, 0), 'lech', v.tinh - coalesce(l.d, 0)),
    null::numeric, make_date(b.year, 12, 31), '/hrm/leave?tab=balances'
  from public.hrm_leave_balances b
  left join led l on l.employee_id = b."employeeId" and l.year = b.year
  left join public.employees u on u.id = b."employeeId"
  cross join lateral (select coalesce(b."accruedDays", 0) + coalesce(b."carriedDays", 0)
    - coalesce(b."usedPaidDays", 0) - coalesce(b."carryUsedDays", 0) tinh) v
  where abs(v.tinh - coalesce(l.d, 0)) > 0.001;
$$;

-- ── 9. Số dư lũy kế trên sổ phép không khớp tổng sổ ────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_leave_ledger_running()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'leaveledger:' || z.employee_id::text || ':' || z.year, 'hrm_leave_balance', z.employee_id::text,
    coalesce(u.employee_code, u.full_name, z.employee_id::text), null::text, null::text,
    format('%s năm %s: dòng cuối sổ phép ghi còn %s ngày, tổng các dòng là %s ngày',
      coalesce(u.full_name, '—'), z.year, to_char(coalesce(z.ba, 0), 'FM999990.0#'), to_char(coalesce(z.d, 0), 'FM999990.0#')),
    jsonb_build_object('nhan_vien', u.full_name, 'nam', z.year, 'so_du_dong_cuoi', z.ba, 'tong_cac_dong', z.d,
      'lech', coalesce(z.ba, 0) - coalesce(z.d, 0), 'so_dong', z.n),
    null::numeric, make_date(z.year, 12, 31), '/hrm/leave?tab=balances'
  from (
    select l.employee_id, l.year, sum(l.days) d, count(*) n,
      (select x.balance_after from public.hrm_leave_ledger x
       where x.employee_id = l.employee_id and x.year = l.year order by x.created_at desc, x.id desc limit 1) ba
    from public.hrm_leave_ledger l group by 1, 2
  ) z
  left join public.employees u on u.id = z.employee_id
  where abs(coalesce(z.ba, 0) - coalesce(z.d, 0)) > 0.001;
$$;

-- ── 10. Phép có lương đã duyệt mà chưa vào sổ phép (6 lệch thật) ───────────────────────────────────────────────────
create or replace function app_private.control_rule_leave_approved_no_ledger()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'leavenoledger:' || r.id::text, 'hrm_leave_request', r.id::text, coalesce(nullif(r.code, ''), coalesce(u.full_name, '—')),
    null::text, null::text,
    format('%s: đơn phép có lương %s ngày (%s → %s) đã duyệt nhưng chưa trừ vào sổ phép',
      coalesce(u.full_name, '—'), to_char(coalesce(r."totalDays", 0), 'FM999990.0#'), r."startDate", r."endDate"),
    jsonb_build_object('nhan_vien', u.full_name, 'ma_don', r.code, 'loai_phep', r.type, 'so_ngay', r."totalDays",
      'tu_ngay', r."startDate", 'den_ngay', r."endDate", 'duyet_boi', r."approvedBy"),
    null::numeric, r."startDate"::date, '/hrm/leave?request=' || r.id::text
  from public.hrm_leave_requests r
  left join public.employees u on u.id = r."employeeId"
  where r.status = 'approved' and coalesce(r."isPaid", false)
    and not exists (select 1 from public.hrm_leave_ledger l where l.leave_request_id = r.id);
$$;

-- ── 11. Nghỉ phép đã duyệt mà vẫn chấm công đi làm (11 lệch thật) ──────────────────────────────────────────────────
create or replace function app_private.control_rule_leave_vs_attendance()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'leaveatt:' || r.id::text || ':' || a.date, 'hrm_leave_request', r.id::text,
    coalesce(nullif(r.code, ''), coalesce(u.full_name, '—')), null::text, null::text,
    format('%s nghỉ phép ngày %s (đơn đã duyệt) nhưng vẫn có chấm công vào %s',
      coalesce(u.full_name, '—'), a.date, a."checkIn"),
    jsonb_build_object('nhan_vien', u.full_name, 'ma_don', r.code, 'loai_phep', r.type,
      'tu_ngay', r."startDate", 'den_ngay', r."endDate", 'ngay_cham_cong', a.date,
      'gio_vao', a."checkIn", 'gio_ra', a."checkOut", 'co_luong', r."isPaid"),
    null::numeric, a.date::date, '/hrm/leave?request=' || r.id::text
  from public.hrm_leave_requests r
  join public.hrm_attendance a on a."employeeId" = r."employeeId" and a.date between r."startDate" and r."endDate"
  left join public.employees u on u.id = r."employeeId"
  where r.status = 'approved' and a."checkIn" is not null;
$$;

-- ── 12. Hai đơn phép trùng ngày ────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_leave_overlap()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'leaveoverlap:' || least(a.id::text, b.id::text) || ':' || greatest(a.id::text, b.id::text),
    'hrm_leave_request', a.id::text, coalesce(nullif(a.code, ''), coalesce(u.full_name, '—')), null::text, null::text,
    format('%s có hai đơn phép trùng ngày: %s (%s → %s) và %s (%s → %s)',
      coalesce(u.full_name, '—'), coalesce(nullif(a.code, ''), 'đơn 1'), a."startDate", a."endDate",
      coalesce(nullif(b.code, ''), 'đơn 2'), b."startDate", b."endDate"),
    jsonb_build_object('nhan_vien', u.full_name,
      'don_1', jsonb_build_object('ma', a.code, 'tu', a."startDate", 'den', a."endDate", 'trang_thai', a.status, 'so_ngay', a."totalDays"),
      'don_2', jsonb_build_object('ma', b.code, 'tu', b."startDate", 'den', b."endDate", 'trang_thai', b.status, 'so_ngay', b."totalDays")),
    null::numeric, a."startDate"::date, '/hrm/leave?request=' || a.id::text
  from public.hrm_leave_requests a
  join public.hrm_leave_requests b on b."employeeId" = a."employeeId" and b.id < a.id
    and a."startDate" <= b."endDate" and b."startDate" <= a."endDate"
  left join public.employees u on u.id = a."employeeId"
  where a.status in ('approved', 'pending') and b.status in ('approved', 'pending');
$$;

-- ── 13. Đơn phép treo duyệt quá 3 ngày (7 lệch thật) ───────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_leave_stuck_pending()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'leavestuck:' || r.id::text, 'hrm_leave_request', r.id::text, coalesce(nullif(r.code, ''), coalesce(u.full_name, '—')),
    null::text, null::text,
    format('%s: đơn phép %s ngày (%s → %s) chờ duyệt %s ngày',
      coalesce(u.full_name, '—'), to_char(coalesce(r."totalDays", 0), 'FM999990.0#'), r."startDate", r."endDate",
      (current_date - (r."createdAt" at time zone 'Asia/Ho_Chi_Minh')::date)),
    jsonb_build_object('nhan_vien', u.full_name, 'ma_don', r.code, 'loai_phep', r.type, 'so_ngay', r."totalDays",
      'tu_ngay', r."startDate", 'den_ngay', r."endDate", 'buoc', r.current_step,
      'so_ngay_cho', current_date - (r."createdAt" at time zone 'Asia/Ho_Chi_Minh')::date,
      'da_qua_ngay_nghi', r."startDate" < to_char(current_date, 'YYYY-MM-DD')),
    null::numeric, (r."createdAt" at time zone 'Asia/Ho_Chi_Minh')::date, '/hrm/leave?request=' || r.id::text
  from public.hrm_leave_requests r
  left join public.employees u on u.id = r."employeeId"
  where r.status = 'pending' and r."createdAt" < now() - interval '3 days';
$$;

-- ── 14. Lương thực nhận khác lương gộp trừ các khoản ───────────────────────────────────────────────────────────────
--   Tiêu đề chỉ nói số lệch; các con số lương để trong `detail` (chỉ người quyền Nhân sự và Admin xem được).
create or replace function app_private.control_rule_payroll_net_vs_gross()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'payrollnet:' || p.id::text, 'hrm_payroll', p.id::text, coalesce(u.employee_code, u.full_name, p."employeeId"::text), null::text, null::text,
    format('%s · lương tháng %s/%s: lương thực nhận lệch %s đ so với lương gộp trừ các khoản',
      coalesce(u.full_name, '—'), p.month, p.year, to_char(abs(v.lech), 'FM999G999G999G990')),
    jsonb_build_object('nhan_vien', u.full_name, 'thang', p.month, 'nam', p.year,
      'luong_gop', p."grossSalary", 'thuc_nhan', p."netSalary",
      'tru_bao_hiem', p."deductionInsurance", 'tru_thue', p."deductionTax",
      'tru_tam_ung', p."deductionAdvance", 'tru_khac', p."deductionOther",
      'tinh_ra_thuc_nhan', v.tinh, 'lech', v.lech, 'trang_thai', p.status),
    abs(v.lech), make_date(p.year, p.month, 1), '/hrm/payroll'
  from public.hrm_payrolls p
  left join public.employees u on u.id = p."employeeId"
  cross join lateral (
    select coalesce(p."grossSalary", 0) - coalesce(p."deductionInsurance", 0) - coalesce(p."deductionTax", 0)
      - coalesce(p."deductionAdvance", 0) - coalesce(p."deductionOther", 0) tinh,
      coalesce(p."netSalary", 0) - (coalesce(p."grossSalary", 0) - coalesce(p."deductionInsurance", 0)
        - coalesce(p."deductionTax", 0) - coalesce(p."deductionAdvance", 0) - coalesce(p."deductionOther", 0)) lech
  ) v
  where abs(v.lech) > 1;
$$;

-- ── Danh mục luật K3 đợt 3 (mặc định shadow: chưa báo ai) ──────────────────────────────────────────────────────────
insert into public.control_rules (code, module, module_key, title, principle, fix_hint, owner_hint, severity, fn, route, sort_order) values
  ('att_future_date', 'Nhân sự', 'HRM', 'Chấm công ngày tương lai',
    'Không thể chấm công cho ngày chưa đến; bản ghi ngày tương lai là nhập tay sai hoặc sai múi giờ của thiết bị.',
    'HR mở bảng chấm công tháng đó, xóa hoặc sửa bản ghi về ngày đúng.',
    'Nhân sự', 'P0', 'control_rule_att_future_date', '{hr}', 380),
  ('att_checkout_before_checkin', 'Nhân sự', 'HRM', 'Giờ ra trước giờ vào',
    'Giờ ra phải sau giờ vào, nếu không thì không tính được giờ làm và giờ tăng ca.',
    'HR mở bản ghi, đối chiếu các lần chấm trong ngày rồi sửa giờ cho đúng.',
    'Nhân sự', 'P0', 'control_rule_att_checkout_before_checkin', '{hr}', 390),
  ('att_suspicion_unresolved', 'Nhân sự', 'HRM', 'Chấm công có dấu hiệu nhờ người khác chấm',
    'Hai người chấm công cùng một thiết bị hoặc cùng một điểm GPS là dấu hiệu chấm hộ — phải xác minh rồi duyệt hoặc từ chối.',
    'HR hỏi lại người chấm và người quản lý công trường, rồi duyệt hoặc từ chối bản ghi.',
    'Nhân sự', 'P1', 'control_rule_att_suspicion_unresolved', '{hr}', 400),
  ('att_out_of_range_pending', 'Nhân sự', 'HRM', 'Chấm công ngoài phạm vi chưa ai duyệt',
    'Chấm công ngoài phạm vi điểm làm việc phải được duyệt mới tính công; để treo là công tháng chưa chốt được.',
    'HR hoặc quản lý trực tiếp xem lý do và vị trí rồi duyệt / từ chối.',
    'Nhân sự', 'P1', 'control_rule_att_out_of_range_pending', '{hr}', 410),
  ('att_proposal_stuck', 'Nhân sự', 'HRM', 'Đề xuất chấm công treo chờ duyệt',
    'Đề xuất chấm công bù để treo làm công tháng của nhân viên thiếu; phải duyệt hoặc từ chối.',
    'Người được gửi đề xuất mở tab Đề xuất, duyệt hoặc từ chối kèm lý do.',
    'Nhân sự', 'P2', 'control_rule_att_proposal_stuck', '{hr}', 420),
  ('att_after_exit', 'Nhân sự', 'HRM', 'Chấm công sau ngày nghỉ việc',
    'Người đã nghỉ việc không còn chấm công; có bản ghi sau ngày nghỉ là sai ngày nghỉ việc hoặc chấm hộ — và sẽ tính lương sai.',
    'HR kiểm lại ngày nghỉ việc trên hồ sơ; sai thì sửa ngày, đúng thì xóa bản ghi chấm công.',
    'Nhân sự', 'P0', 'control_rule_att_after_exit', '{hr}', 430),
  ('employee_resigned_no_exit_date', 'Nhân sự', 'HRM', 'Đã nghỉ việc mà chưa ghi ngày nghỉ việc',
    'Hồ sơ đã đánh dấu nghỉ việc phải có ngày nghỉ việc, nếu không thì không biết bản ghi chấm công hay bảng lương nào sau ngày đó là sai, và luật "chấm công sau ngày nghỉ việc" cũng không soi được.',
    'HR mở hồ sơ nhân viên, đổi trạng thái lại cho đúng để hệ thống ghi sự kiện nghỉ việc kèm ngày.',
    'Nhân sự', 'P1', 'control_rule_employee_resigned_no_exit_date', '{hr}', 440),
  ('leave_balance_vs_ledger', 'Nhân sự', 'HRM', 'Số dư phép khác sổ phép',
    'Số dư phép của mỗi người mỗi năm phải bằng tổng các dòng trên sổ phép; lệch là số dư bị sửa ngoài sổ.',
    'HR mở sổ phép của nhân viên, đối chiếu từng dòng; chênh thì ghi dòng điều chỉnh có lý do, không sửa thẳng số dư.',
    'Nhân sự', 'P0', 'control_rule_leave_balance_vs_ledger', '{hr}', 450),
  ('leave_ledger_running', 'Nhân sự', 'HRM', 'Số dư lũy kế trên sổ phép không khớp',
    'Số dư ghi ở dòng cuối sổ phép phải bằng tổng các dòng; lệch là sổ bị chèn hoặc xóa dòng.',
    'Báo Admin kiểm sổ phép của nhân viên; dựng lại số dư lũy kế theo thứ tự các dòng.',
    'Nhân sự + Admin', 'P0', 'control_rule_leave_ledger_running', '{hr}', 460),
  ('leave_approved_no_ledger', 'Nhân sự', 'HRM', 'Phép có lương đã duyệt mà chưa vào sổ phép',
    'Đơn phép có lương đã duyệt phải trừ ngay vào sổ phép, nếu không nhân viên vẫn còn nguyên số phép và nghỉ quá quyền.',
    'HR mở đơn phép, ghi dòng trừ phép vào sổ; nếu đơn không nên tính phép thì bỏ cờ có lương.',
    'Nhân sự', 'P0', 'control_rule_leave_approved_no_ledger', '{hr}', 470),
  ('leave_vs_attendance', 'Nhân sự', 'HRM', 'Nghỉ phép đã duyệt mà vẫn chấm công đi làm',
    'Một ngày không thể vừa nghỉ phép vừa đi làm: hoặc đơn phép sai ngày, hoặc bản ghi chấm công sai — cả hai đều làm công và phép sai.',
    'HR đối chiếu với quản lý trực tiếp: đi làm thật thì rút / sửa ngày đơn phép, nghỉ thật thì xóa bản ghi chấm công.',
    'Nhân sự', 'P1', 'control_rule_leave_vs_attendance', '{hr}', 480),
  ('leave_overlap', 'Nhân sự', 'HRM', 'Hai đơn phép trùng ngày',
    'Một người không có hai đơn phép cùng ngày; trùng là trừ phép hai lần.',
    'HR rút một trong hai đơn hoặc sửa khoảng ngày cho không chồng nhau.',
    'Nhân sự', 'P1', 'control_rule_leave_overlap', '{hr}', 490),
  ('leave_stuck_pending', 'Nhân sự', 'HRM', 'Đơn phép treo duyệt quá lâu',
    'Đơn phép để treo làm nhân viên không biết được nghỉ hay không, và công tháng không chốt được.',
    'Nhắc người duyệt ở bước đang treo; đã qua ngày nghỉ thì chốt theo thực tế hoặc rút đơn.',
    'Nhân sự', 'P2', 'control_rule_leave_stuck_pending', '{hr}', 500),
  ('payroll_net_vs_gross', 'Nhân sự', 'HRM', 'Lương thực nhận khác lương gộp trừ các khoản',
    'Lương thực nhận phải bằng lương gộp trừ bảo hiểm, thuế, tạm ứng và các khoản trừ khác.',
    'Kế toán lương mở bảng lương, tính lại; lệch do nhập tay thì sửa, do công thức thì báo Admin.',
    'Nhân sự + Kế toán lương', 'P0', 'control_rule_payroll_net_vs_gross', '{hr}', 510)
on conflict (code) do update set module = excluded.module, module_key = excluded.module_key, title = excluded.title,
  principle = excluded.principle, fix_hint = excluded.fix_hint, owner_hint = excluded.owner_hint,
  severity = excluded.severity, fn = excluded.fn, route = excluded.route, sort_order = excluded.sort_order, updated_at = now();

-- Quyền: như K0 — hàm luật chỉ bộ chạy (security definer) dùng, không mở cho người dùng.
do $$
declare fx record;
begin
  for fx in select n.nspname, pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'app_private' and pr.proname in ('control_rule_att_future_date', 'control_rule_att_checkout_before_checkin',
      'control_rule_att_suspicion_unresolved', 'control_rule_att_out_of_range_pending', 'control_rule_att_proposal_stuck',
      'control_rule_att_after_exit', 'control_rule_employee_resigned_no_exit_date', 'control_rule_leave_balance_vs_ledger',
      'control_rule_leave_ledger_running', 'control_rule_leave_approved_no_ledger', 'control_rule_leave_vs_attendance',
      'control_rule_leave_overlap', 'control_rule_leave_stuck_pending', 'control_rule_payroll_net_vs_gross') loop
    execute format('revoke all on function %I.%I() from public, anon, authenticated', fx.nspname, fx.proname);
  end loop;
end $$;

-- Chạy ngay để sổ phát hiện có số lệch thật cho Admin xem (shadow: không báo ai).
select app_private.control_run(code, 'migration') from public.control_rules
where code in ('att_future_date', 'att_checkout_before_checkin', 'att_suspicion_unresolved', 'att_out_of_range_pending',
  'att_proposal_stuck', 'att_after_exit', 'employee_resigned_no_exit_date', 'leave_balance_vs_ledger', 'leave_ledger_running',
  'leave_approved_no_ledger', 'leave_vs_attendance', 'leave_overlap', 'leave_stuck_pending', 'payroll_net_vs_gross');
