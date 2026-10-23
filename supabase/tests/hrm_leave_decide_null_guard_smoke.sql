-- Smoke duyệt / hủy đơn nghỉ phép khi bước HR không ghi người (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/hrm_leave_decide_null_guard_smoke.sql
-- Dữ liệu thật 23/10/2026: NP-2026-0030 (một bước HR, userId null), NP-2026-0031 (anh Phạm Ngọc Sơn duyệt bước 1,
-- bước 2 HR), NP-2026-0026 (chờ bước HR), NP-2026-0029 (giả hồ sơ chưa liên kết tài khoản để thử hủy).
-- Anh Phạm Đình Dương: nhân viên thường. Chị Hà Thị Hải Hồng: HR (hrm.employee.view_sensitive).
\set ON_ERROR_STOP 1
begin;

create temp table p on commit drop as
select key, u.id, u.auth_id from (values
  ('duong', 'Phạm Đình Dương'), ('hong', 'Hà Thị Hải Hồng'), ('son', 'Phạm Ngọc Sơn'), ('phuong', 'Vũ Thị Hồng Phương')
) x(key, name) join public.users u on u.name = x.name and u.is_active;
create temp table np on commit drop as
select code, id from public.hrm_leave_requests
where code in ('NP-2026-0026', 'NP-2026-0029', 'NP-2026-0030', 'NP-2026-0031') and status = 'pending';
create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;
create function pg_temp.np(c text) returns uuid language sql as $$ select id from np where code = c $$;

do $$ begin
  if (select count(*) from p) <> 4 or (select count(*) from np) <> 4 then
    raise exception 'SMOKE: dữ liệu thử đã đổi (cần 4 người, 4 đơn đang chờ)'; end if;
  if app_private.has_hrm_template_permission((select id from p where key = 'duong'), 'hrm.employee.view_sensitive')
     or not app_private.has_hrm_template_permission((select id from p where key = 'hong'), 'hrm.employee.view_sensitive') then
    raise exception 'SMOKE: anh Dương phải không là HR, chị Hồng phải là HR'; end if;
end $$;

-- ===== Trước khi sửa: tái hiện lỗ hổng (chỉ báo, không chặn) =====
savepoint before_fix;
select pg_temp.act_as('duong');
do $$ begin
  perform public.decide_leave_request(pg_temp.np('NP-2026-0030'), 'approve', null);
  raise notice 'TRƯỚC SỬA: anh Dương (không phải HR) duyệt được NP-2026-0030 — lỗ hổng';
exception when insufficient_privilege then
  raise notice 'TRƯỚC SỬA: đã chặn sẵn (bản sửa đã áp?)';
end $$;
rollback to savepoint before_fix;

\ir ../migrations/20261029120000_hrm_leave_decide_null_guard.sql

-- ===== Nhân viên thường bị chặn ở bước HR không ghi người =====
select pg_temp.act_as('duong');
do $$ begin
  begin
    perform public.decide_leave_request(pg_temp.np('NP-2026-0030'), 'approve', null);
    raise exception 'SMOKE: anh Dương duyệt được NP-2026-0030';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.decide_leave_request(pg_temp.np('NP-2026-0030'), 'reject', 'smoke từ chối');
    raise exception 'SMOKE: anh Dương từ chối được NP-2026-0030';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.decide_leave_request(pg_temp.np('NP-2026-0026'), 'approve', 'smoke duyệt thay');
    raise exception 'SMOKE: anh Dương duyệt được bước 2 HR của NP-2026-0026';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.hrm_leave_requests where id = pg_temp.np('NP-2026-0030')) <> 'pending' then
    raise exception 'SMOKE: NP-2026-0030 bị đổi trạng thái'; end if;
  raise notice 'OK anh Dương: không duyệt / từ chối được bước HR không ghi người (NP-2026-0030, NP-2026-0026)';
end $$;

-- ===== Hủy đơn của hồ sơ chưa liên kết tài khoản =====
update public.employees set user_id = null
where id = (select "employeeId" from public.hrm_leave_requests where id = pg_temp.np('NP-2026-0029'));
do $$ begin
  begin
    perform public.cancel_leave_request(pg_temp.np('NP-2026-0029'), 'smoke hủy hộ');
    raise exception 'SMOKE: anh Dương hủy được đơn của hồ sơ chưa liên kết tài khoản';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK anh Dương: không hủy được NP-2026-0029 khi hồ sơ chưa liên kết tài khoản';
end $$;

-- ===== HR vẫn duyệt được bước HR không ghi người, không cần lý do =====
select pg_temp.act_as('hong');
do $$ declare v public.hrm_leave_requests; begin
  v := public.decide_leave_request(pg_temp.np('NP-2026-0030'), 'approve', null);
  if v.status <> 'approved' or (v.approvers -> 0 ->> 'onBehalf')::boolean then
    raise exception 'SMOKE: chị Hồng duyệt NP-2026-0030 sai (%, onBehalf %)', v.status, v.approvers -> 0 ->> 'onBehalf'; end if;
  v := public.cancel_leave_request(pg_temp.np('NP-2026-0029'), 'smoke HR hủy');
  if v.status <> 'cancelled' then raise exception 'SMOKE: chị Hồng chưa hủy được NP-2026-0029'; end if;
  raise notice 'OK chị Hồng (HR): duyệt NP-2026-0030 (không phải duyệt thay), hủy được NP-2026-0029';
end $$;

-- ===== Người được ghi tên ở bước vẫn duyệt được; sang bước HR thì không =====
select pg_temp.act_as('son');
do $$ declare v public.hrm_leave_requests; begin
  v := public.decide_leave_request(pg_temp.np('NP-2026-0031'), 'approve', null);
  if v.status <> 'pending' or v.current_step <> 2 or v.approvers -> 0 ->> 'status' <> 'approved' then
    raise exception 'SMOKE: anh Sơn duyệt bước 1 NP-2026-0031 sai'; end if;
  begin
    perform public.decide_leave_request(pg_temp.np('NP-2026-0031'), 'approve', 'smoke bước 2');
    raise exception 'SMOKE: anh Sơn duyệt được bước 2 HR của NP-2026-0031';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK anh Sơn: duyệt bước 1 của mình; không duyệt được bước 2 HR';
end $$;
select pg_temp.act_as('hong');
do $$ declare v public.hrm_leave_requests; begin
  v := public.decide_leave_request(pg_temp.np('NP-2026-0031'), 'approve', null);
  if v.status <> 'approved' then raise exception 'SMOKE: chị Hồng chưa duyệt xong NP-2026-0031'; end if;
  raise notice 'OK chị Hồng: duyệt bước 2 HR của NP-2026-0031';
end $$;

-- ===== Người tạo đơn vẫn tự rút đơn chờ =====
select pg_temp.act_as('phuong');
do $$ declare v public.hrm_leave_requests; begin
  v := public.cancel_leave_request(pg_temp.np('NP-2026-0026'), 'smoke tự rút');
  if v.status <> 'cancelled' then raise exception 'SMOKE: chị Phương chưa rút được NP-2026-0026'; end if;
  raise notice 'OK chị Phương: tự rút đơn chờ NP-2026-0026';
end $$;

-- ===== Luồng Yêu cầu cũ: bước chờ không ghi người =====
update public.request_instances set approvers = '[{"order": 1, "status": "waiting"}]'::jsonb
where id = (select id from public.request_instances where status in ('PENDING', 'IN_PROGRESS') order by created_at limit 1);
select pg_temp.act_as('duong');
do $$ begin
  begin
    perform public.process_request_step(
      (select id from public.request_instances where approvers = '[{"order": 1, "status": "waiting"}]'::jsonb limit 1),
      (select id from p where key = 'duong'), 'APPROVED', 'smoke');
    raise exception 'SMOKE: anh Dương duyệt được bước Yêu cầu không ghi người';
  exception when raise_exception then
    if sqlerrm <> 'user is not the current approver' then raise; end if;
  end;
  raise notice 'OK anh Dương: không duyệt được bước Yêu cầu cũ không ghi người';
end $$;

rollback;
