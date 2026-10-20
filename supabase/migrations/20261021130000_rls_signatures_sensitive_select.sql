-- Audit 20/10/2026 (S1, S2): nhân viên đã đăng nhập đọc được chữ ký của mọi người và các bảng
-- tiền / lương / hợp đồng vì policy SELECT còn `using (true)`. Migration này thu hẹp quyền đọc
-- theo hàm quyền có sẵn, bọc `(select …)` để Postgres tính một lần mỗi câu lệnh (không gọi theo dòng).
-- Admin không đổi. Người có quyền (Tài chính, HR lương, Hợp đồng, Room thanh toán, nhân sự dự án)
-- giữ nguyên trải nghiệm. Nhân viên thường thấy 0 dòng ở bảng tiền / lương, không lỗi 42501.
--
-- Giữ `true` (ghi lý do ở docs/security/sensitive-select-2026-10.md):
--   approval_rules       — ai nộp phiếu cũng cần tra người duyệt (lib/approvalService.ts).
--   contract_cost_items  — danh mục mã chi phí (ký hiệu, tên), không có số tiền.
--   hrm_salary_policies  — danh mục tên chính sách lương (id, name, description), không có số tiền.
--   user_xp              — bảng xếp hạng XP là tính năng công khai nội bộ (pages/Leaderboard.tsx).

-- =====================================================================================
-- 1. Chữ ký số: chủ sở hữu, Admin / quản trị quy trình, và người cùng xử lý một phiếu.
-- =====================================================================================

-- Ai được xem mọi chữ ký: Admin, quản trị module Quy trình, người xem / quản trị mọi phiếu.
create or replace function app_private.user_signature_can_read_all()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_user_id() is not null and (
    public.is_admin()
    or app_private.has_permission(public.current_app_user_id(), 'system.wf.manage', 'global', '*')
    or app_private.has_permission(public.current_app_user_id(), 'workflow.instance.view', 'global', '*')
    or app_private.has_permission(public.current_app_user_id(), 'workflow.instance.administer', 'global', '*')
  );
$$;

-- Danh sách người mà người đang đăng nhập được xem chữ ký: chính mình + người tạo / người đã xử lý /
-- người tham gia các phiếu mà mình tham gia (tạo, được giao, theo dõi, đã xử lý, quản trị mẫu,
-- giám sát mẫu, phiếu dự án mình tạo hoặc đang được giao). Tính một lần mỗi câu lệnh.
create or replace function app_private.user_signature_visible_owner_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select public.current_app_user_id() as id
  ),
  my_instances as (
    select participant.instance_id
    from public.workflow_instance_participants participant
    join me on participant.user_id = me.id
    where participant.ended_at is null
    union
    select log_row.instance_id
    from public.workflow_instance_logs log_row
    join me on log_row.acted_by = me.id
    union
    select instance_row.id
    from public.workflow_instances instance_row
    join me on instance_row.created_by = me.id
    union
    select instance_row.id
    from public.workflow_instances instance_row
    join public.workflow_templates template_row on template_row.id = instance_row.template_id
    join me on true
    where coalesce(template_row.managers, '{}'::text[]) @> array[me.id::text]
       or coalesce(template_row.default_watchers, '{}'::text[]) @> array[me.id::text]
    union
    select subject_row.workflow_instance_id
    from public.workflow_subjects subject_row
    join me on true
    where subject_row.created_by = me.id
       or subject_row.current_assignee_user_id = me.id
       or me.id = any(coalesce(subject_row.current_assignee_user_ids, '{}'::uuid[]))
  )
  select coalesce(array_agg(distinct owner.owner_id), '{}'::uuid[])
  from (
    select me.id as owner_id from me
    union all
    select log_row.acted_by
    from public.workflow_instance_logs log_row
    where log_row.instance_id in (select instance_id from my_instances)
    union all
    select instance_row.created_by
    from public.workflow_instances instance_row
    where instance_row.id in (select instance_id from my_instances)
    union all
    select participant.user_id
    from public.workflow_instance_participants participant
    where participant.instance_id in (select instance_id from my_instances)
  ) owner
  where owner.owner_id is not null;
$$;

create or replace function app_private.user_signature_can_read(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner_id is not null
    and public.current_app_user_id() is not null
    and (
      p_owner_id = public.current_app_user_id()
      or app_private.user_signature_can_read_all()
      or p_owner_id = any(app_private.user_signature_visible_owner_ids())
    );
$$;

-- Tệp trong bucket workflow-templates: signatures/<user_id>.png theo quyền trên; tên khác dưới
-- signatures/ chỉ Admin.
create or replace function app_private.user_signature_object_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_name ~ '^signatures/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
      then app_private.user_signature_can_read(substring(p_name from 12 for 36)::uuid)
    else public.is_admin()
  end;
$$;

revoke all on function app_private.user_signature_can_read_all() from public, anon;
revoke all on function app_private.user_signature_visible_owner_ids() from public, anon;
revoke all on function app_private.user_signature_can_read(uuid) from public, anon;
revoke all on function app_private.user_signature_object_can_read(text) from public, anon;
grant execute on function app_private.user_signature_can_read_all() to authenticated;
grant execute on function app_private.user_signature_visible_owner_ids() to authenticated;
grant execute on function app_private.user_signature_can_read(uuid) to authenticated;
grant execute on function app_private.user_signature_object_can_read(text) to authenticated;

drop policy if exists "Users can read all signatures" on public.user_signatures;
drop policy if exists user_signatures_select on public.user_signatures;
create policy user_signatures_select on public.user_signatures
  for select to authenticated
  using (
    user_id = (select public.current_app_user_id())
    or (select app_private.user_signature_can_read_all())
    or user_id = any((select app_private.user_signature_visible_owner_ids())::uuid[])
  );

-- Storage: mẫu in / tệp mẫu giữ như cũ; chỉ signatures/… đi qua hàm trên.
-- Client đọc chữ ký bằng download / createSignedUrl (đi qua policy này), không dùng getPublicUrl.
alter policy workflow_templates_read on storage.objects
  using (
    bucket_id = 'workflow-templates'
    and (name not like 'signatures/%' or app_private.user_signature_object_can_read(name))
  );

-- =====================================================================================
-- 2. Dự án của tôi (nhân sự dự án đang hiệu lực) — dùng cho NCC / HĐ nhà cung cấp / thầu phụ
-- =====================================================================================

create or replace function app_private.actor_staff_project_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct scoped.project_id), '{}'::text[])
  from (
    select staff.project_id
    from public.project_staff staff
    where staff.user_id = public.current_app_user_id()::text
      and staff.project_id is not null
      and (staff.end_date is null or staff.end_date >= current_date)
    union
    select project_row.id
    from public.project_staff staff
    join public.projects project_row on project_row.construction_site_id::text = staff.construction_site_id
    where staff.user_id = public.current_app_user_id()::text
      and staff.project_id is null
      and staff.construction_site_id is not null
      and (staff.end_date is null or staff.end_date >= current_date)
  ) scoped
  where scoped.project_id is not null;
$$;

create or replace function app_private.actor_staff_site_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct scoped.site_id), '{}'::text[])
  from (
    select staff.construction_site_id as site_id
    from public.project_staff staff
    where staff.user_id = public.current_app_user_id()::text
      and staff.construction_site_id is not null
      and (staff.end_date is null or staff.end_date >= current_date)
    union
    select project_row.construction_site_id::text
    from public.projects project_row
    where project_row.construction_site_id is not null
      and project_row.id = any(app_private.actor_staff_project_ids())
  ) scoped
  where scoped.site_id is not null;
$$;

revoke all on function app_private.actor_staff_project_ids() from public, anon;
revoke all on function app_private.actor_staff_site_ids() from public, anon;
grant execute on function app_private.actor_staff_project_ids() to authenticated;
grant execute on function app_private.actor_staff_site_ids() to authenticated;

-- =====================================================================================
-- 3. Tài chính: quỹ, phiếu thu chi, lịch thanh toán
-- =====================================================================================

-- Quỹ tiền: Tài chính (system.finance.*) hoặc người được bật xem tài chính dự án / Room thanh toán
-- (cần chọn quỹ khi lập bộ hoàn ứng ở ProjectFinanceWorkspace). Số dư chi tiết nằm ở RPC Tài chính.
drop policy if exists cash_funds_select on public.cash_funds;
create policy cash_funds_select on public.cash_funds
  for select to authenticated
  using (
    (select app_private.finance_can('view'))
    or (select app_private.sensitive_view_all('finance'))
    or (select cardinality(app_private.sensitive_view_project_ids('finance')) > 0)
  );

drop policy if exists cash_vouchers_select on public.cash_vouchers;
create policy cash_vouchers_select on public.cash_vouchers
  for select to authenticated
  using ((select app_private.finance_can('view')));

drop policy if exists cash_voucher_items_select on public.cash_voucher_items;
create policy cash_voucher_items_select on public.cash_voucher_items
  for select to authenticated
  using ((select app_private.finance_can('view')));

-- Lịch thanh toán: Tài chính, người được bật xem tài chính / hợp đồng, Room thanh toán & nghiệm thu
-- của dự án (cùng quy tắc project_finances ở P0-C).
drop policy if exists pay_sched_select on public.payment_schedules;
drop policy if exists payment_schedules_select on public.payment_schedules;
create policy payment_schedules_select on public.payment_schedules
  for select to authenticated
  using (
    (select app_private.finance_can('view'))
    or (select app_private.sensitive_view_all('finance'))
    or (select app_private.sensitive_view_all('contract'))
    or project_id = any((select app_private.sensitive_view_project_ids('finance'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('finance'))::text[])
    or project_id = any((select app_private.sensitive_view_project_ids('contract'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('contract'))::text[])
  );

-- =====================================================================================
-- 4. Hợp đồng NCC / thầu phụ, nhà cung cấp theo dự án
-- =====================================================================================
-- Màn dùng: Hợp đồng (hd/*), Vận hành, Chuỗi cung ứng / Thầu phụ / Hợp đồng trong dự án,
-- An toàn (nhà thầu), Xuất vật tư, form Kho. Người được xem: quản lý hợp đồng (contract domain),
-- quyền contract.supplier.view (mẫu Cán bộ vật tư), Tài chính, Room thanh toán / nghiệm thu,
-- và nhân sự đang tham gia dự án đó.

drop policy if exists supplier_contracts_select on public.supplier_contracts;
create policy supplier_contracts_select on public.supplier_contracts
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('contract'))
    or (select app_private.has_permission(public.current_app_user_id(), 'contract.supplier.view', 'global', '*'))
    or (select app_private.finance_can('view'))
    or project_id = any((select app_private.sensitive_view_project_ids('contract'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('contract'))::text[])
    or project_id = any((select app_private.actor_staff_project_ids())::text[])
    or construction_site_id = any((select app_private.actor_staff_site_ids())::text[])
  );

drop policy if exists subcontractor_contracts_select on public.subcontractor_contracts;
create policy subcontractor_contracts_select on public.subcontractor_contracts
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('contract'))
    or (select app_private.has_permission(public.current_app_user_id(), 'contract.supplier.view', 'global', '*'))
    or (select app_private.finance_can('view'))
    or project_id = any((select app_private.sensitive_view_project_ids('contract'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('contract'))::text[])
    or project_id = any((select app_private.actor_staff_project_ids())::text[])
    or construction_site_id = any((select app_private.actor_staff_site_ids())::text[])
  );

-- Nhà cung cấp của dự án (liên hệ, tổng giá trị đơn): nhân sự dự án, người xem tài chính / hợp đồng.
drop policy if exists proj_vendors_select on public.project_vendors;
drop policy if exists project_vendors_select on public.project_vendors;
create policy project_vendors_select on public.project_vendors
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('finance'))
    or (select app_private.sensitive_view_all('contract'))
    or (select app_private.finance_can('view'))
    or project_id = any((select app_private.sensitive_view_project_ids('finance'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('finance'))::text[])
    or project_id = any((select app_private.actor_staff_project_ids())::text[])
    or construction_site_id = any((select app_private.actor_staff_site_ids())::text[])
  );

-- =====================================================================================
-- 5. Lương 3P, KPI
-- =====================================================================================

-- Hồ sơ nhân viên của người đang đăng nhập (để tự xem KPI của mình).
create or replace function app_private.actor_employee_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(employee.id), '{}'::uuid[])
  from public.employees employee
  where employee.user_id = public.current_app_user_id();
$$;
revoke all on function app_private.actor_employee_ids() from public, anon;
grant execute on function app_private.actor_employee_ids() to authenticated;

-- Thiết lập lương 3P: người xem lương / đãi ngộ (hrm.payroll.view, hrm.compensation.view) và Admin.
drop policy if exists salary_3p_settings_select on public.salary_3p_settings;
create policy salary_3p_settings_select on public.salary_3p_settings
  for select to authenticated
  using (
    (select public.is_admin())
    or (select app_private.can_view_hrm_payroll_3p())
  );

-- Điểm KPI: người xem lương, Admin, hoặc chính nhân viên được chấm.
drop policy if exists kpi_scores_select on public.kpi_scores;
create policy kpi_scores_select on public.kpi_scores
  for select to authenticated
  using (
    (select public.is_admin())
    or (select app_private.can_view_hrm_payroll_3p())
    or employee_id = any((select app_private.actor_employee_ids())::uuid[])
  );

-- Kỳ KPI: như trên; nhân viên thấy kỳ có điểm của mình (qua RLS kpi_scores).
drop policy if exists kpi_periods_select on public.kpi_periods;
create policy kpi_periods_select on public.kpi_periods
  for select to authenticated
  using (
    (select public.is_admin())
    or (select app_private.can_view_hrm_payroll_3p())
    or exists (select 1 from public.kpi_scores score where score.period_id = kpi_periods.id)
  );

-- =====================================================================================
-- 6. Nhật ký phiếu yêu cầu vật tư: theo quyền xem phiếu tương ứng (RLS của public.requests).
-- =====================================================================================

drop policy if exists rq_logs_select on public.request_logs;
drop policy if exists request_logs_select on public.request_logs;
create policy request_logs_select on public.request_logs
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.requests request_row where request_row.id = request_logs.request_id::text)
  );

-- =====================================================================================
-- 7. Cấp phát tài sản: bỏ policy `true`, giữ asset_assignments_select_action (theo asset.assignment.view).
-- =====================================================================================

drop policy if exists asset_assign_select on public.asset_assignments;

-- =====================================================================================
-- 8. Lịch sử XP: chỉ của mình (và Admin). user_xp giữ nguyên cho bảng xếp hạng.
-- =====================================================================================

drop policy if exists xp_events_select on public.xp_events;
create policy xp_events_select on public.xp_events
  for select to authenticated
  using (
    user_id = (select public.current_app_user_id())::text
    or (select public.is_admin())
  );

-- =====================================================================================
-- 9. Kiểm tra: không còn policy SELECT `true` trên các bảng vừa thu hẹp.
-- =====================================================================================

do $$
declare
  leftover text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
  into leftover
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'user_signatures', 'cash_funds', 'cash_vouchers', 'cash_voucher_items', 'payment_schedules',
      'supplier_contracts', 'subcontractor_contracts', 'project_vendors', 'salary_3p_settings',
      'kpi_scores', 'kpi_periods', 'request_logs', 'asset_assignments', 'xp_events'
    )
    and cmd in ('SELECT', 'ALL')
    and permissive = 'PERMISSIVE'
    and qual = 'true';
  if leftover is not null then
    raise exception 'Còn policy SELECT true: %', leftover;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'workflow_templates_read'
      and qual like '%user_signature_object_can_read%'
  ) then
    raise exception 'Storage policy workflow_templates_read chưa nhận điều kiện chữ ký';
  end if;
end;
$$;

notify pgrst, 'reload schema';
