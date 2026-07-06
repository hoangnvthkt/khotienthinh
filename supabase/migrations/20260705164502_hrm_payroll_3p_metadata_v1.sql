-- HRM payroll 3P metadata source of truth v1.
-- Seeded from Data_HR2026_1.xlsx and Data_HR2026_2.xlsx on 2026-07-05.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create or replace function app_private.can_view_hrm_payroll_3p()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, true)
      and (
        u.role = 'ADMIN'
        or 'HRM' = any(coalesce(u.allowed_modules, '{}'::text[]))
        or 'HRM' = any(coalesce(u.admin_modules, '{}'::text[]))
        or coalesce(u.allowed_sub_modules -> 'HRM', '[]'::jsonb) ?| array['/hrm/payroll', '/hrm/salary-3p']
        or coalesce(u.admin_sub_modules -> 'HRM', '[]'::jsonb) ?| array['/hrm/payroll', '/hrm/salary-3p']
      )
  );
$$;

create or replace function app_private.can_manage_hrm_payroll_3p()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, true)
      and (
        u.role = 'ADMIN'
        or 'HRM' = any(coalesce(u.admin_modules, '{}'::text[]))
        or coalesce(u.admin_sub_modules -> 'HRM', '[]'::jsonb) ?| array['/hrm/payroll', '/hrm/salary-3p']
      )
  );
$$;

revoke all on function app_private.can_view_hrm_payroll_3p() from public, anon, authenticated;
revoke all on function app_private.can_manage_hrm_payroll_3p() from public, anon, authenticated;
grant execute on function app_private.can_view_hrm_payroll_3p() to authenticated;
grant execute on function app_private.can_manage_hrm_payroll_3p() to authenticated;

create table if not exists public.hrm_compensation_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  effective_from date not null,
  effective_to date,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  default_p3_band_code text not null default 'B3',
  default_kpi_rating_code text not null default 'B3',
  has_p2 boolean not null default false,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.salary_grades add column if not exists plan_id uuid;
alter table public.salary_grades add column if not exists hrm_level_code text;
alter table public.salary_grades add column if not exists p1_salary_amount numeric(14,2);
alter table public.salary_grades add column if not exists source text not null default 'legacy';
alter table public.salary_grades add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.salary_grades add column if not exists updated_at timestamptz not null default now();

create table if not exists public.hrm_3p_bands (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.hrm_compensation_plans(id) on delete cascade,
  code text not null,
  group_code text not null,
  p3_coefficient numeric(10,4) not null default 0,
  kpi_pay_multiplier numeric(10,4) not null default 1,
  market_bucket text,
  ratio numeric(10,4),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, code)
);

create table if not exists public.hrm_3p_grade_band_rates (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.hrm_compensation_plans(id) on delete cascade,
  salary_grade_id uuid not null references public.salary_grades(id) on delete cascade,
  p3_band_id uuid not null references public.hrm_3p_bands(id) on delete cascade,
  p1_salary_amount numeric(14,2) not null default 0,
  p3_standard_amount numeric(14,2) not null default 0,
  standard_total_amount numeric(14,2) not null default 0,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, salary_grade_id, p3_band_id)
);

create table if not exists public.hrm_position_salary_mappings (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.hrm_compensation_plans(id) on delete cascade,
  position_id uuid not null references public.hrm_positions(id) on delete cascade,
  position_code_snapshot text,
  org_unit_code_snapshot text,
  salary_grade_id uuid not null references public.salary_grades(id) on delete restrict,
  confidence text not null default 'exact' check (confidence in ('exact', 'contextual', 'manual_review')),
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, position_id)
);

create table if not exists public.hrm_employee_compensation_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  employee_code_snapshot text not null,
  employee_name_snapshot text not null,
  plan_id uuid not null references public.hrm_compensation_plans(id) on delete cascade,
  position_id uuid references public.hrm_positions(id) on delete set null,
  org_unit_id uuid references public.org_units(id) on delete set null,
  salary_grade_id uuid not null references public.salary_grades(id) on delete restrict,
  p3_band_id uuid not null references public.hrm_3p_bands(id) on delete restrict,
  effective_from date not null default date '2026-07-01',
  effective_to date,
  status text not null default 'active' check (status in ('draft', 'active', 'superseded')),
  source text not null default 'manual',
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'needs_review')),
  review_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, plan_id, effective_from)
);

create table if not exists public.hrm_payroll_components (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.hrm_compensation_plans(id) on delete cascade,
  code text not null,
  name text not null,
  component_type text not null,
  formula_key text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_recurring boolean not null default true,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, code)
);

create table if not exists public.hrm_payroll_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file_name text not null,
  source_file_hash text not null,
  import_type text not null check (import_type in ('employee_compensation_seed')),
  status text not null default 'uploaded' check (status in ('uploaded', 'validated', 'partially_approved', 'applied', 'rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_file_hash, import_type)
);

create table if not exists public.hrm_payroll_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.hrm_payroll_import_batches(id) on delete cascade,
  source_row_number integer not null,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  validation_status text not null default 'valid' check (validation_status in ('valid', 'warning', 'error')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'needs_review')),
  matched_employee_id uuid references public.employees(id) on delete set null,
  applied_assignment_id uuid references public.hrm_employee_compensation_assignments(id) on delete set null,
  warning_messages jsonb not null default '[]'::jsonb,
  error_messages jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, source_row_number)
);

alter table public.hrm_payrolls add column if not exists "calculationMode" text not null default 'legacy_template';
alter table public.hrm_payrolls add column if not exists "compensationPlanId" uuid references public.hrm_compensation_plans(id) on delete set null;
alter table public.hrm_payrolls add column if not exists "compensationAssignmentId" uuid references public.hrm_employee_compensation_assignments(id) on delete set null;
alter table public.hrm_payrolls add column if not exists "salaryGradeId" uuid references public.salary_grades(id) on delete set null;
alter table public.hrm_payrolls add column if not exists "p3BandId" uuid references public.hrm_3p_bands(id) on delete set null;
alter table public.hrm_payrolls add column if not exists "kpiBandId" uuid references public.hrm_3p_bands(id) on delete set null;
alter table public.hrm_payrolls add column if not exists "p1Salary" numeric(14,2) not null default 0;
alter table public.hrm_payrolls add column if not exists "p3StandardSalary" numeric(14,2) not null default 0;
alter table public.hrm_payrolls add column if not exists "p3ActualSalary" numeric(14,2) not null default 0;
alter table public.hrm_payrolls add column if not exists "kpiMultiplier" numeric(10,4) not null default 1;
alter table public.hrm_payrolls add column if not exists "recurringAllowanceTotal" numeric(14,2) not null default 0;
alter table public.hrm_payrolls add column if not exists "payrollComponentSnapshot" jsonb not null default '{}'::jsonb;
alter table public.hrm_payrolls add column if not exists "calculationSnapshot" jsonb not null default '{}'::jsonb;
alter table public.hrm_payrolls add column if not exists "templateId" uuid;
alter table public.hrm_payrolls add column if not exists "templateValues" jsonb not null default '{}'::jsonb;

create index if not exists idx_salary_grades_plan_id on public.salary_grades(plan_id);
create index if not exists idx_hrm_3p_bands_plan_id on public.hrm_3p_bands(plan_id);
create index if not exists idx_hrm_3p_rates_plan_id on public.hrm_3p_grade_band_rates(plan_id);
create index if not exists idx_hrm_position_salary_mappings_position on public.hrm_position_salary_mappings(position_id);
create index if not exists idx_hrm_employee_comp_assignments_employee on public.hrm_employee_compensation_assignments(employee_id);
create index if not exists idx_hrm_employee_comp_assignments_plan on public.hrm_employee_compensation_assignments(plan_id);
create index if not exists idx_hrm_payroll_import_rows_batch on public.hrm_payroll_import_rows(batch_id);
create index if not exists idx_hrm_payrolls_3p_plan on public.hrm_payrolls("compensationPlanId") where "compensationPlanId" is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'salary_grades_plan_id_fkey' and conrelid = 'public.salary_grades'::regclass) then
    alter table public.salary_grades
      add constraint salary_grades_plan_id_fkey
      foreign key (plan_id) references public.hrm_compensation_plans(id) on delete set null;
  end if;
end $$;

insert into public.hrm_compensation_plans (code, name, effective_from, effective_to, status, default_p3_band_code, default_kpi_rating_code, has_p2, source, metadata)
values ('3P_2026', 'Thang bảng lương 3P năm 2026', date '2026-07-01', null, 'active', 'B3', 'B3', false, 'excel_seed', jsonb_build_object('matrix_file', 'Data_HR2026_1.xlsx', 'matrix_file_hash', '8cf3ec98fabdffa15419a18ccc457fb4f912cd702b4896d002535310578e495b', 'assignment_file', 'Data_HR2026_2.xlsx', 'assignment_file_hash', '426935907e5901d3e9cee9f10142df7fbdefc6dc1a8e69aa9e05dd487bfc4953'))
on conflict (code) do update set
  name = excluded.name,
  effective_from = excluded.effective_from,
  effective_to = excluded.effective_to,
  status = excluded.status,
  default_p3_band_code = excluded.default_p3_band_code,
  default_kpi_rating_code = excluded.default_kpi_rating_code,
  has_p2 = false,
  source = excluded.source,
  metadata = excluded.metadata,
  updated_at = now();

with plan_row as (select id from public.hrm_compensation_plans where code = '3P_2026'),
seed(code, name, group_name, level, hrm_level_code, p1_salary_amount, bhxh_coefficient, regulated_salary, metadata) as (
  values
  ('E11', 'E11', 'BOD', 11, 'L11', 11400000, 4.5, 11400000, '{"sourceRowNumber":7,"titles":["Chủ tịch HĐQT"]}'::jsonb),
  ('E10', 'E10', 'BOD', 10, 'L10', 10000000, 3.95, 10000000, '{"sourceRowNumber":8,"titles":["Tổng giám đốc"]}'::jsonb),
  ('E9', 'E9', 'BOD', 9, 'L9', 9000000, 3.55, 9000000, '{"sourceRowNumber":9,"titles":["Giám đốc điều hành","Giám đốc Nhân sự","Giám đốc đối ngoại","Giám đốc nội chính","Giám đốc tài chính","Trợ lý cao cấp (cho Chủ tịch HĐQT)"]}'::jsonb),
  ('E8', 'E8', 'Quản lý cấp trung - Nhóm 2', 8, 'L8', 8000000, 3.15, 8000000, '{"sourceRowNumber":10,"titles":["Kế toán trưởng","Trưởng phòng HCNS","Trưởng phòng QLDA","Trưởng phòng TKĐT","Trưởng phòng VTTB","Trưởng phòng TCKT","Trưởng phòng Truyền thông","Giám đốc NMSXKCT","Chỉ huy trưởng BCH RICO","Chỉ huy trưởng BCH SMB","Chuyên gia","Chuyên gia cao cấp","Trợ lý TGĐ"]}'::jsonb),
  ('E7', 'E7', 'Quản lý cấp trung - Nhóm 1', 7, 'L7', 7600000, 3, 7600000, '{"sourceRowNumber":11,"titles":["Phó phòng HCNS","Phó phòng QLDA","Phó phòng TKĐT","Phó phòng VTTB","Phó phòng TCKT","Phó phòng Truyền thông","Phó giám đốc NMSXKCT","Chỉ huy phó BCH RICO","Chỉ huy phó BCH SMB","Trợ lý Phó TGĐ/Giám đốc chức năng"]}'::jsonb),
  ('E6', 'E6', 'Quản lý nhóm', 6, 'L6', 7100000, 2.8, 7100000, '{"sourceRowNumber":12,"titles":["Trưởng nhóm Chất lượng","Trưởng nhóm Kế hoạch","Trưởng nhóm Thiết kế","Trưởng nhóm Pháp lý","Kĩ thuật trưởng"]}'::jsonb),
  ('E5', 'E5', 'Nhân viên kĩ thuật', 5, 'L5', 6600000, 2.6, 6600000, '{"sourceRowNumber":13,"titles":["Trưởng nhóm Hành chính","Trưởng nhóm ATLĐ","Trưởng nhóm Vật tư","Trưởng nhóm Thiết bị","Quản đốc nhà máy","Chuyên viên Công nghệ thông tin (IT)","Chuyên viên QLDA","Chuyên viên Kế hoạch","Chuyên viên kĩ thuật","Chuyên viên Thiết kế (theo bộ môn)","Chuyên viên Diễn họa 3D","Chuyên viên Dự toán","Chuyên viên Pháp lý","Chuyên viên Kế toán tổng hợp","Cán bộ giám sát","Cán bộ ME","Cán bộ QS/QC","Cán bộ Trắc đạc","Chuyên viên thiết kế đồ họa"]}'::jsonb),
  ('E4', 'E4', 'Chuyên viên và Nhân viên quản lý chuyên môn', 4, 'L4', 6000000, 2.35, 6000000, '{"sourceRowNumber":14,"titles":["Chuyên viên hành chính tổng hợp","Chuyên viên pháp chế","Chuyên viên nhân sự tổng hợp","Chuyên viên ATVSLĐ","Nhân viên kĩ thuật","Chuyên viên Vật tư","Chuyên viên Thiết bị","Chuyên viên Kế toán dự án","Chuyên viên Kế toán thuế","Chuyên viên tài chính","Cán bộ KCS","Cán bộ HSE","Cán bộ Shopdrawing","Cán bộ QS/QC","Cán bộ Shopdrawing","Cán bộ ATLĐ","Chuyên viên truyền thông","Chuyên viên phiên dịch","Cố vấn","Thư kí TGĐ"]}'::jsonb),
  ('E3', 'E3', 'Nhân viên quản lý chuyên môn', 3, 'L3', 5500000, 2.15, 5500000, '{"sourceRowNumber":15,"titles":["Đội trưởng đội xe","Đội trưởng đội bảo vệ","Chuyên viên quản lý kho","Nhân viên Kế toán thanh toán","Cán bộ Thống kê","Trợ lý dự án"]}'::jsonb),
  ('E2', 'E2', 'Nhân viên trực tiếp', 2, 'L2', 5400000, 2.1, 5400000, '{"sourceRowNumber":16,"titles":["Nhân viên lễ tân","Nhân viên lái xe ô tô con văn phòng","Nhân viên Vật tư","Nhân viên Thủ kho","Thợ điện","Nhân viên Vật tư","Nhân viên Thủ kho","Nhân viên lái xe tải","Nhân viên lái cẩu tự hành","Nhân viên lái máy xúc"]}'::jsonb),
  ('E1', 'E1', 'Công nhân trực tiếp', 1, 'L1', 5300000, 2.06, 5300000, '{"sourceRowNumber":17,"titles":["Nhân viên bảo vệ","Nhân viên tạp vụ/vệ sinh","Nhân viên cấp dưỡng","Công nhân hàn/cắt","Công nhân hàn/gá","Công nhân hàn/hoàn thiện","Công nhân sơn","Công nhân bốc xếp","Nhân viên bảo vệ","Nhân viên cấp dưỡng"]}'::jsonb)
)
insert into public.salary_grades (code, name, group_name, level, bhxh_coefficient, regulated_salary, plan_id, hrm_level_code, p1_salary_amount, source, metadata)
select seed.code, seed.name, seed.group_name, seed.level, coalesce(seed.bhxh_coefficient, 0), coalesce(seed.regulated_salary, 0), plan_row.id, seed.hrm_level_code, seed.p1_salary_amount, 'excel_seed', seed.metadata
from seed cross join plan_row
on conflict (code) do update set
  name = excluded.name,
  group_name = excluded.group_name,
  level = excluded.level,
  bhxh_coefficient = excluded.bhxh_coefficient,
  regulated_salary = excluded.regulated_salary,
  plan_id = excluded.plan_id,
  hrm_level_code = excluded.hrm_level_code,
  p1_salary_amount = excluded.p1_salary_amount,
  source = excluded.source,
  metadata = excluded.metadata,
  updated_at = now();

with plan_row as (select id from public.hrm_compensation_plans where code = '3P_2026'),
seed(code, group_code, p3_coefficient, kpi_pay_multiplier, market_bucket, ratio, sort_order) as (
  values
  ('D1', 'D', 0.3, 0.3, 'Lag/P0-P25', 0.15, 1),
  ('D2', 'D', 0.45, 0.45, 'Lag/P0-P25', 0.15, 2),
  ('D3', 'D', 0.6, 0.6, 'Lag/P0-P25', 0.15, 3),
  ('D4', 'D', 0.75, 0.75, 'Lag/P0-P25', 0.15, 4),
  ('C1', 'C', 0.93, 0.93, 'Lag/Mix/P25-P50', 0.18, 5),
  ('C2', 'C', 1.11, 1.11, 'Lag/Mix/P25-P50', 0.18, 6),
  ('C3', 'C', 1.29, 1.29, 'Lag/Mix/P25-P50', 0.18, 7),
  ('C4', 'C', 1.47, 1.47, 'Lag/Mix/P25-P50', 0.18, 8),
  ('B1', 'B', 1.67, 1.67, 'Match/Mix/P50-P75', 0.2, 9),
  ('B2', 'B', 1.87, 1.87, 'Match/Mix/P50-P75', 0.2, 10),
  ('B3', 'B', 2.07, 2.07, 'Match/Mix/P50-P75', 0.2, 11),
  ('B4', 'B', 2.27, 2.27, 'Match/Mix/P50-P75', 0.2, 12),
  ('A1', 'A', 2.62, 2.62, 'Lead/P75-P100', 0.35, 13),
  ('A2', 'A', 2.97, 2.97, 'Lead/P75-P100', 0.35, 14),
  ('A3', 'A', 3.32, 3.32, 'Lead/P75-P100', 0.35, 15),
  ('A4', 'A', 3.67, 3.67, 'Lead/P75-P100', 0.35, 16)
)
insert into public.hrm_3p_bands (plan_id, code, group_code, p3_coefficient, kpi_pay_multiplier, market_bucket, ratio, sort_order, source)
select plan_row.id, seed.code, seed.group_code, seed.p3_coefficient, seed.kpi_pay_multiplier, seed.market_bucket, seed.ratio, seed.sort_order, 'excel_seed'
from seed cross join plan_row
on conflict (plan_id, code) do update set
  group_code = excluded.group_code,
  p3_coefficient = excluded.p3_coefficient,
  kpi_pay_multiplier = excluded.kpi_pay_multiplier,
  market_bucket = excluded.market_bucket,
  ratio = excluded.ratio,
  sort_order = excluded.sort_order,
  source = excluded.source,
  is_active = true,
  updated_at = now();

with plan_row as (select id from public.hrm_compensation_plans where code = '3P_2026'),
seed(grade_code, band_code, p1_salary_amount, p3_standard_amount, standard_total_amount) as (
  values
  ('E11', 'D1', 11400000, 3500000, 14900000),
  ('E11', 'D2', 11400000, 5200000, 16600000),
  ('E11', 'D3', 11400000, 6900000, 18300000),
  ('E11', 'D4', 11400000, 8600000, 20000000),
  ('E11', 'C1', 11400000, 10700000, 22100000),
  ('E11', 'C2', 11400000, 12700000, 24100000),
  ('E11', 'C3', 11400000, 14800000, 26200000),
  ('E11', 'C4', 11400000, 16800000, 28200000),
  ('E11', 'B1', 11400000, 19100000, 30500000),
  ('E11', 'B2', 11400000, 21400000, 32800000),
  ('E11', 'B3', 11400000, 23600000, 35000000),
  ('E11', 'B4', 11400000, 25900000, 37300000),
  ('E11', 'A1', 11400000, 29900000, 41300000),
  ('E11', 'A2', 11400000, 33900000, 45300000),
  ('E11', 'A3', 11400000, 37900000, 49300000),
  ('E11', 'A4', 11400000, 41900000, 53300000),
  ('E10', 'D1', 10000000, 3000000, 13000000),
  ('E10', 'D2', 10000000, 4500000, 14500000),
  ('E10', 'D3', 10000000, 6000000, 16000000),
  ('E10', 'D4', 10000000, 7500000, 17500000),
  ('E10', 'C1', 10000000, 9300000, 19300000),
  ('E10', 'C2', 10000000, 11100000, 21100000),
  ('E10', 'C3', 10000000, 12900000, 22900000),
  ('E10', 'C4', 10000000, 14700000, 24700000),
  ('E10', 'B1', 10000000, 16700000, 26700000),
  ('E10', 'B2', 10000000, 18700000, 28700000),
  ('E10', 'B3', 10000000, 20700000, 30700000),
  ('E10', 'B4', 10000000, 22700000, 32700000),
  ('E10', 'A1', 10000000, 26200000, 36200000),
  ('E10', 'A2', 10000000, 29700000, 39700000),
  ('E10', 'A3', 10000000, 33200000, 43200000),
  ('E10', 'A4', 10000000, 36700000, 46700000),
  ('E9', 'D1', 9000000, 2700000, 11700000),
  ('E9', 'D2', 9000000, 4100000, 13100000),
  ('E9', 'D3', 9000000, 5400000, 14400000),
  ('E9', 'D4', 9000000, 6800000, 15800000),
  ('E9', 'C1', 9000000, 8400000, 17400000),
  ('E9', 'C2', 9000000, 10000000, 19000000),
  ('E9', 'C3', 9000000, 11700000, 20700000),
  ('E9', 'C4', 9000000, 13300000, 22300000),
  ('E9', 'B1', 9000000, 15100000, 24100000),
  ('E9', 'B2', 9000000, 16900000, 25900000),
  ('E9', 'B3', 9000000, 18700000, 27700000),
  ('E9', 'B4', 9000000, 20500000, 29500000),
  ('E9', 'A1', 9000000, 23600000, 32600000),
  ('E9', 'A2', 9000000, 26800000, 35800000),
  ('E9', 'A3', 9000000, 29900000, 38900000),
  ('E9', 'A4', 9000000, 33100000, 42100000),
  ('E8', 'D1', 8000000, 2400000, 10400000),
  ('E8', 'D2', 8000000, 3600000, 11600000),
  ('E8', 'D3', 8000000, 4800000, 12800000),
  ('E8', 'D4', 8000000, 6000000, 14000000),
  ('E8', 'C1', 8000000, 7500000, 15500000),
  ('E8', 'C2', 8000000, 8900000, 16900000),
  ('E8', 'C3', 8000000, 10400000, 18400000),
  ('E8', 'C4', 8000000, 11800000, 19800000),
  ('E8', 'B1', 8000000, 13400000, 21400000),
  ('E8', 'B2', 8000000, 15000000, 23000000),
  ('E8', 'B3', 8000000, 16600000, 24600000),
  ('E8', 'B4', 8000000, 18200000, 26200000),
  ('E8', 'A1', 8000000, 21000000, 29000000),
  ('E8', 'A2', 8000000, 23800000, 31800000),
  ('E8', 'A3', 8000000, 26600000, 34600000),
  ('E8', 'A4', 8000000, 29400000, 37400000),
  ('E7', 'D1', 7600000, 2300000, 9900000),
  ('E7', 'D2', 7600000, 3500000, 11100000),
  ('E7', 'D3', 7600000, 4600000, 12200000),
  ('E7', 'D4', 7600000, 5700000, 13300000),
  ('E7', 'C1', 7600000, 7100000, 14700000),
  ('E7', 'C2', 7600000, 8500000, 16100000),
  ('E7', 'C3', 7600000, 9900000, 17500000),
  ('E7', 'C4', 7600000, 11200000, 18800000),
  ('E7', 'B1', 7600000, 12700000, 20300000),
  ('E7', 'B2', 7600000, 14300000, 21900000),
  ('E7', 'B3', 7600000, 15800000, 23400000),
  ('E7', 'B4', 7600000, 17300000, 24900000),
  ('E7', 'A1', 7600000, 20000000, 27600000),
  ('E7', 'A2', 7600000, 22600000, 30200000),
  ('E7', 'A3', 7600000, 25300000, 32900000),
  ('E7', 'A4', 7600000, 27900000, 35500000),
  ('E6', 'D1', 7100000, 2200000, 9300000),
  ('E6', 'D2', 7100000, 3200000, 10300000),
  ('E6', 'D3', 7100000, 4300000, 11400000),
  ('E6', 'D4', 7100000, 5400000, 12500000),
  ('E6', 'C1', 7100000, 6700000, 13800000),
  ('E6', 'C2', 7100000, 7900000, 15000000),
  ('E6', 'C3', 7100000, 9200000, 16300000),
  ('E6', 'C4', 7100000, 10500000, 17600000),
  ('E6', 'B1', 7100000, 11900000, 19000000),
  ('E6', 'B2', 7100000, 13300000, 20400000),
  ('E6', 'B3', 7100000, 14700000, 21800000),
  ('E6', 'B4', 7100000, 16200000, 23300000),
  ('E6', 'A1', 7100000, 18700000, 25800000),
  ('E6', 'A2', 7100000, 21100000, 28200000),
  ('E6', 'A3', 7100000, 23600000, 30700000),
  ('E6', 'A4', 7100000, 26100000, 33200000),
  ('E5', 'D1', 6600000, 2000000, 8600000),
  ('E5', 'D2', 6600000, 3000000, 9600000),
  ('E5', 'D3', 6600000, 4000000, 10600000),
  ('E5', 'D4', 6600000, 5000000, 11600000),
  ('E5', 'C1', 6600000, 6200000, 12800000),
  ('E5', 'C2', 6600000, 7400000, 14000000),
  ('E5', 'C3', 6600000, 8600000, 15200000),
  ('E5', 'C4', 6600000, 9800000, 16400000),
  ('E5', 'B1', 6600000, 11100000, 17700000),
  ('E5', 'B2', 6600000, 12400000, 19000000),
  ('E5', 'B3', 6600000, 13700000, 20300000),
  ('E5', 'B4', 6600000, 15000000, 21600000),
  ('E5', 'A1', 6600000, 17300000, 23900000),
  ('E5', 'A2', 6600000, 19700000, 26300000),
  ('E5', 'A3', 6600000, 22000000, 28600000),
  ('E5', 'A4', 6600000, 24300000, 30900000),
  ('E4', 'D1', 6000000, 1800000, 7800000),
  ('E4', 'D2', 6000000, 2700000, 8700000),
  ('E4', 'D3', 6000000, 3600000, 9600000),
  ('E4', 'D4', 6000000, 4500000, 10500000),
  ('E4', 'C1', 6000000, 5600000, 11600000),
  ('E4', 'C2', 6000000, 6700000, 12700000),
  ('E4', 'C3', 6000000, 7800000, 13800000),
  ('E4', 'C4', 6000000, 8900000, 14900000),
  ('E4', 'B1', 6000000, 10100000, 16100000),
  ('E4', 'B2', 6000000, 11300000, 17300000),
  ('E4', 'B3', 6000000, 12500000, 18500000),
  ('E4', 'B4', 6000000, 13700000, 19700000),
  ('E4', 'A1', 6000000, 15800000, 21800000),
  ('E4', 'A2', 6000000, 17900000, 23900000),
  ('E4', 'A3', 6000000, 20000000, 26000000),
  ('E4', 'A4', 6000000, 22100000, 28100000),
  ('E3', 'D1', 5500000, 1700000, 7200000),
  ('E3', 'D2', 5500000, 2500000, 8000000),
  ('E3', 'D3', 5500000, 3300000, 8800000),
  ('E3', 'D4', 5500000, 4200000, 9700000),
  ('E3', 'C1', 5500000, 5200000, 10700000),
  ('E3', 'C2', 5500000, 6200000, 11700000),
  ('E3', 'C3', 5500000, 7100000, 12600000),
  ('E3', 'C4', 5500000, 8100000, 13600000),
  ('E3', 'B1', 5500000, 9200000, 14700000),
  ('E3', 'B2', 5500000, 10300000, 15800000),
  ('E3', 'B3', 5500000, 11400000, 16900000),
  ('E3', 'B4', 5500000, 12500000, 18000000),
  ('E3', 'A1', 5500000, 14500000, 20000000),
  ('E3', 'A2', 5500000, 16400000, 21900000),
  ('E3', 'A3', 5500000, 18300000, 23800000),
  ('E3', 'A4', 5500000, 20200000, 25700000),
  ('E2', 'D1', 5400000, 1700000, 7100000),
  ('E2', 'D2', 5400000, 2500000, 7900000),
  ('E2', 'D3', 5400000, 3300000, 8700000),
  ('E2', 'D4', 5400000, 4100000, 9500000),
  ('E2', 'C1', 5400000, 5100000, 10500000),
  ('E2', 'C2', 5400000, 6000000, 11400000),
  ('E2', 'C3', 5400000, 7000000, 12400000),
  ('E2', 'C4', 5400000, 8000000, 13400000),
  ('E2', 'B1', 5400000, 9100000, 14500000),
  ('E2', 'B2', 5400000, 10100000, 15500000),
  ('E2', 'B3', 5400000, 11200000, 16600000),
  ('E2', 'B4', 5400000, 12300000, 17700000),
  ('E2', 'A1', 5400000, 14200000, 19600000),
  ('E2', 'A2', 5400000, 16100000, 21500000),
  ('E2', 'A3', 5400000, 18000000, 23400000),
  ('E2', 'A4', 5400000, 19900000, 25300000),
  ('E1', 'D1', 5300000, 1600000, 6900000),
  ('E1', 'D2', 5300000, 2400000, 7700000),
  ('E1', 'D3', 5300000, 3200000, 8500000),
  ('E1', 'D4', 5300000, 4000000, 9300000),
  ('E1', 'C1', 5300000, 5000000, 10300000),
  ('E1', 'C2', 5300000, 5900000, 11200000),
  ('E1', 'C3', 5300000, 6900000, 12200000),
  ('E1', 'C4', 5300000, 7800000, 13100000),
  ('E1', 'B1', 5300000, 8900000, 14200000),
  ('E1', 'B2', 5300000, 10000000, 15300000),
  ('E1', 'B3', 5300000, 11000000, 16300000),
  ('E1', 'B4', 5300000, 12100000, 17400000),
  ('E1', 'A1', 5300000, 13900000, 19200000),
  ('E1', 'A2', 5300000, 15800000, 21100000),
  ('E1', 'A3', 5300000, 17600000, 22900000),
  ('E1', 'A4', 5300000, 19500000, 24800000)
)
insert into public.hrm_3p_grade_band_rates (plan_id, salary_grade_id, p3_band_id, p1_salary_amount, p3_standard_amount, standard_total_amount, source)
select plan_row.id, sg.id, band.id, seed.p1_salary_amount, seed.p3_standard_amount, seed.standard_total_amount, 'excel_seed'
from seed
cross join plan_row
join public.salary_grades sg on sg.code = seed.grade_code
join public.hrm_3p_bands band on band.plan_id = plan_row.id and band.code = seed.band_code
on conflict (plan_id, salary_grade_id, p3_band_id) do update set
  p1_salary_amount = excluded.p1_salary_amount,
  p3_standard_amount = excluded.p3_standard_amount,
  standard_total_amount = excluded.standard_total_amount,
  source = excluded.source,
  updated_at = now();

with plan_row as (select id from public.hrm_compensation_plans where code = '3P_2026'),
seed(code, name, component_type, formula_key, sort_order, is_recurring) as (
  values
  ('P1', 'Lương P1 (BHXH)', 'income', 'p1_salary', 1, true),
  ('P3_STANDARD', 'Lương P3 tiêu chuẩn', 'income', 'p3_standard', 2, true),
  ('KPI_MULTIPLIER', 'Hệ số KPI tháng', 'info', 'kpi_multiplier', 3, false),
  ('P3_ACTUAL', 'Lương P3 thực tính', 'income', 'p3_standard * kpi_multiplier', 4, true),
  ('PC_CHUC_DANH', 'Phụ cấp chức danh', 'allowance', 'title_allowance', 5, true),
  ('PC_DIEN_THOAI', 'Phụ cấp điện thoại', 'allowance', 'phone_allowance', 6, true),
  ('HO_TRO_THU_HUT', 'Hỗ trợ thu hút', 'allowance', 'attraction_support', 7, true),
  ('HO_TRO_AN_CA', 'Hỗ trợ ăn ca', 'allowance', 'meal_support', 8, true),
  ('PC_THAM_NIEN', 'Phụ cấp thâm niên', 'allowance', 'seniority_allowance', 9, true),
  ('BHXH_BASE', 'Lương căn cứ đóng BHXH', 'info', 'p1 + title_allowance + seniority_allowance', 10, false)
)
insert into public.hrm_payroll_components (plan_id, code, name, component_type, formula_key, sort_order, is_recurring, source)
select plan_row.id, seed.code, seed.name, seed.component_type, seed.formula_key, seed.sort_order, seed.is_recurring, 'catalog'
from seed cross join plan_row
on conflict (plan_id, code) do update set
  name = excluded.name,
  component_type = excluded.component_type,
  formula_key = excluded.formula_key,
  sort_order = excluded.sort_order,
  is_recurring = excluded.is_recurring,
  is_active = true,
  source = excluded.source,
  updated_at = now();

with plan_row as (select id from public.hrm_compensation_plans where code = '3P_2026')
insert into public.hrm_position_salary_mappings (plan_id, position_id, position_code_snapshot, org_unit_code_snapshot, salary_grade_id, confidence, source, metadata)
select
  plan_row.id,
  hp.id,
  hp.code,
  hp.suggested_org_unit_code,
  sg.id,
  case when hp.source = 'catalog' then 'exact' else 'manual_review' end,
  'catalog',
  jsonb_build_object('level_code', hp.level_code, 'position_name', hp.name)
from plan_row
join public.hrm_positions hp on hp.level_code is not null
join public.salary_grades sg on sg.code = ('E' || nullif(regexp_replace(hp.level_code, '\D', '', 'g'), ''))
on conflict (plan_id, position_id) do update set
  position_code_snapshot = excluded.position_code_snapshot,
  org_unit_code_snapshot = excluded.org_unit_code_snapshot,
  salary_grade_id = excluded.salary_grade_id,
  confidence = excluded.confidence,
  source = excluded.source,
  metadata = excluded.metadata,
  updated_at = now();

with upsert_batch as (
  insert into public.hrm_payroll_import_batches (source_file_name, source_file_hash, import_type, status, metadata)
  values ('Data_HR2026_2.xlsx', '426935907e5901d3e9cee9f10142df7fbdefc6dc1a8e69aa9e05dd487bfc4953', 'employee_compensation_seed', 'validated', jsonb_build_object('row_count', 117, 'duplicate_employee_codes', jsonb_build_array('TT0071'), 'default_p3_band_code', 'B3', 'default_grade_code', 'E4'))
  on conflict (source_file_hash, import_type) do update set
    source_file_name = excluded.source_file_name,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = now()
  returning id
), seed(source_row_number, employee_code, employee_name, block_code, org_unit_code, position_name, level_code, grade_code, p3_band_code, p1_salary_amount, p3_standard_amount, title_allowance_amount, phone_allowance_amount, attraction_support_amount, meal_support_amount, seniority_allowance_amount, standard_total_income, social_insurance_base_amount, source, validation_status, review_status, warning_messages, error_messages, raw_payload) as (
  values
  (5, 'TT0001', 'Dương Xuân Thịnh', 'K1', 'BLĐ', 'Chủ tịch HĐQT', 'L11', 'E11', 'C4', 11400000, 16800000, 1000000, 1000000, 0, 0, 1000000, 31200000, 13400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"1","c1":"TT0001","c2":"Dương Xuân Thịnh","c3":"Nam","c4":"01/07/1981","c5":"034081007572","c6":"15/09/2021","c7":"Quỳnh Trang, Quỳnh Phụ, Thái Bình","c8":"KĐT Kỳ Đồng, P.Trần Hưng Đạo, tỉnh Hưng Yên","c9":"","c10":"Văn phòng Hưng Yên","c11":"Ban Giám đốc","c12":"K1","c13":"BLĐ","c14":"Chủ tịch HĐQT","c15":"L11","c16":"BoD","c17":"Đại học","c18":"15/04/2011","c19":"15/04/2011","c20":"182","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"23,000,000","c27":"5,000,000","c28":"28,000,000","c29":"6,500,000","c30":"200,000","c31":"28,200,000","c32":"11,400,000","c33":"1,000,000","c34":"1,000,000","c35":"-","c36":"0","c37":"-","c38":"0","c39":"1,000,000","c40":"Bậc C4","c41":"16,800,000","c42":"31,200,000","c43":"13,400,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (6, 'TT0012', 'Nguyễn Thị Mơ', 'K1', 'BLĐ', 'Giám đốc nội chính', 'L9', 'E9', 'B1', 9000000, 15100000, 800000, 800000, 0, 650000, 900000, 27250000, 10700000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"2","c1":"TT0012","c2":"Nguyễn Thị Mơ","c3":"Nữ","c4":"28/01/1985","c5":"034185004221","c6":"25/05/2016","c7":"Đông Hải, Quỳnh Phụ, Thái Bình","c8":"P. Trần Hưng Đạo, TP. Thái Bình","c9":"0904280262","c10":"Văn phòng Hưng Yên","c11":"Ban Giám đốc","c12":"K1","c13":"BLĐ","c14":"Giám đốc nội chính","c15":"L9","c16":"BoD","c17":"Đại học","c18":"01/06/2016","c19":"01/06/2016","c20":"121","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"18,000,000","c27":"5,000,000","c28":"23,000,000","c29":"6,500,000","c30":"1,100,000","c31":"24,100,000","c32":"9,000,000","c33":"800,000","c34":"800,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"900,000","c40":"Bậc B1","c41":"15,100,000","c42":"27,250,000","c43":"10,700,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (7, 'TT0020', 'Giang Xuân Kiên', 'K1', 'BLĐ', 'Giám đốc đối ngoại', 'L9', 'E9', 'B4', 9000000, 20500000, 800000, 800000, 0, 650000, 700000, 32450000, 10500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"3","c1":"TT0020","c2":"Giang Xuân Kiên","c3":"Nam","c4":"03/02/1983","c5":"034083007228","c6":"24/06/2021","c7":"SN 05 B5 tổ 36, phường Trần Lãm, Tp Thái Bình","c8":"SN 05 B5 tổ 36, phường Trần Lãm, Tp Thái Bình","c9":"0989384555","c10":"Văn phòng Hưng Yên","c11":"Ban Giám đốc","c12":"K1","c13":"BLĐ","c14":"Giám đốc đối ngoại","c15":"L9","c16":"BoD","c17":"Cao đẳng","c18":"01/03/2018","c19":"01/04/2018","c20":"99","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"20,000,000","c27":"10,000,000","c28":"30,000,000","c29":"5,500,000","c30":"(500,000)","c31":"29,500,000","c32":"9,000,000","c33":"800,000","c34":"800,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"700,000","c40":"Bậc B4","c41":"20,500,000","c42":"32,450,000","c43":"10,500,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (8, 'TT0115', 'Lưu Công Danh', 'K1', 'QLDA', 'Phó phòng QLDA', 'L7', 'E7', 'A2', 7600000, 22600000, 650000, 650000, 0, 650000, 0, 32150000, 8250000, 'excel_seed', 'warning', 'needs_review', '["BHXH: Sẽ tham gia từ T06/2026"]'::jsonb, '[]'::jsonb, '{"c0":"4","c1":"TT0115","c2":"Lưu Công Danh","c3":"Nam","c4":"21/08/1985","c5":"036085021422","c6":"06/08/2025","c7":"Ninh Bình","c8":"CT3, Khu đô thị 5, Tổ 8, Phường Trần Hưng Đạo, Hưng Yên","c9":"0912159558","c10":"Văn phòng Hưng Yên","c11":"Phòng Quản lý Dự án","c12":"K1","c13":"QLDA","c14":"Phó phòng QLDA","c15":"L7","c16":"QLCT","c17":"Đại học","c18":"01/04/2026","c19":"01/06/2026","c20":"1","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"30,000,000","c27":"-","c28":"30,000,000","c29":"","c30":"200,000","c31":"30,200,000","c32":"7,600,000","c33":"650,000","c34":"650,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc A2","c41":"22,600,000","c42":"32,150,000","c43":"8,250,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"BHXH: Sẽ tham gia từ T06/2026","c48":"","c49":""}'::jsonb),
  (9, 'TT0063', 'Vũ Trọng Hiệp', 'K1', 'QLDA', 'Chuyên viên QLDA', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 650000, 100000, 19350000, 7150000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"5","c1":"TT0063","c2":"Vũ Trọng Hiệp","c3":"Nam","c4":"04/11/1994","c5":"034094019126","c6":"15/07/2021","c7":"Xã Bình Thanh, huyện Kiến Xương, tỉnh Thái Bình","c8":"Xã Bình Thanh, huyện Kiến Xương, tỉnh Thái Bình","c9":"0384690169","c10":"Văn phòng Hưng Yên","c11":"Phòng Quản lý Dự án","c12":"K1","c13":"QLDA","c14":"Chuyên viên QLDA","c15":"L5","c16":"CV","c17":"Đại học","c18":"19/02/2024","c19":"19/03/2024","c20":"27","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"14,000,000","c27":"4,000,000","c28":"18,000,000","c29":"5,100,000","c30":"(300,000)","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc B1","c41":"11,100,000","c42":"19,350,000","c43":"7,150,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (10, 'TT0102', 'Nguyễn Thành Đô', 'K1', 'QLDA', 'Chuyên viên QLDA', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 650000, 0, 19250000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"6","c1":"TT0102","c2":"Nguyễn Thành Đô","c3":"Nam","c4":"18/08/1992","c5":"034092020814","c6":"19/08/2022","c7":"Xã Phụ Dực, tỉnh Hưng yên","c8":"Thôn Phúc Thượng, xã Vũ Phúc, tỉnh Hưng Yên","c9":"0982286392","c10":"Văn phòng Hưng Yên","c11":"Phòng Quản lý Dự án","c12":"K1","c13":"QLDA","c14":"Chuyên viên QLDA","c15":"L5","c16":"CV","c17":"Đại học","c18":"02/10/2025","c19":"01/11/2025","c20":"8","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"16,000,000","c27":"-","c28":"16,000,000","c29":"5,100,000","c30":"1,700,000","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc B1","c41":"11,100,000","c42":"19,250,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (11, 'TT0103', 'Bùi Thanh Tùng', 'K1', 'QLDA', 'Chuyên viên QLDA', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 650000, 0, 19250000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"7","c1":"TT0103","c2":"Bùi Thanh Tùng","c3":"Nam","c4":"09/09/1991","c5":"034091011166","c6":"13/08/2021","c7":"Tổ 5, Trần Hưng Đạo, Hưng Yên","c8":"Tổ 5, Trần Hưng Đạo, Hưng Yên","c9":"0349800439","c10":"Văn phòng Hưng Yên","c11":"Phòng Quản lý Dự án","c12":"K1","c13":"QLDA","c14":"Chuyên viên QLDA","c15":"L5","c16":"CV","c17":"Đại học","c18":"15/09/2025","c19":"16/10/2025","c20":"8","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"-","c28":"15,000,000","c29":"5,100,000","c30":"2,700,000","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc B1","c41":"11,100,000","c42":"19,250,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (12, 'TT0126', 'Nguyễn Thị Phương Thảo', 'K1', 'QLDA', 'Chuyên viên Kế hoạch', 'L5', 'E5', 'C4', 6600000, 9800000, 450000, 450000, 0, 650000, 0, 17950000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"8","c1":"TT0126","c2":"Nguyễn Thị Phương Thảo","c3":"Nữ","c4":"27/03/1994","c5":"034194003482","c6":"15/09/2021","c7":"Xã Tây Thái Ninh, Tỉnh Hưng Yên","c8":"Thôn Nam Cường, Xã Tây Thái Ninh, Tỉnh Hưng Yên","c9":"0963142273","c10":"Văn phòng Hưng Yên","c11":"Phòng Quản lý Dự án","c12":"K1","c13":"QLDA","c14":"Chuyên viên Kế hoạch","c15":"L5","c16":"CV","c17":"Đại học","c18":"18/05/2026","c19":"18/07/2026","c20":"-","c21":"Thử việc","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"17,000,000","c27":"-","c28":"17,000,000","c29":"","c30":"(600,000)","c31":"16,400,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc C4","c41":"9,800,000","c42":"17,950,000","c43":"7,050,000","c44":"","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (13, 'TT0105', 'Nguyễn Văn Thanh', 'K1', 'QLDA', 'Cán bộ HSE', 'L4', 'E4', 'A2', 6000000, 17900000, 350000, 350000, 0, 650000, 0, 25250000, 6350000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"9","c1":"TT0105","c2":"Nguyễn Văn Thanh","c3":"Nam","c4":"23/11/1994","c5":"034094006974","c6":"05/10/2022","c7":"Bái Thượng, Thuỵ Anh, Hưng Yên","c8":"Tam Lạc, Trần Lãm, Hưng Yên","c9":"0982305192","c10":"Văn phòng Hưng Yên","c11":"Phòng Quản lý Dự án","c12":"K1","c13":"QLDA","c14":"Cán bộ HSE","c15":"L4","c16":"CV","c17":"Cao đẳng","c18":"01/10/2025","c19":"01/11/2025","c20":"8","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"25,000,000","c27":"-","c28":"25,000,000","c29":"5,100,000","c30":"(1,100,000)","c31":"23,900,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc A2","c41":"17,900,000","c42":"25,250,000","c43":"6,350,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (14, 'TT0032', 'Nguyễn Khắc Vĩnh', 'K1', 'QLDA', 'Nhân viên lái máy xúc', 'L2', 'E2', 'B2', 5400000, 10100000, 200000, 200000, 0, 650000, 400000, 16950000, 6000000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"10","c1":"TT0032","c2":"Nguyễn Khắc Vĩnh","c3":"Nam","c4":"02/01/1986","c5":"034086003987","c6":"29/11/2018","c7":"Xóm 9, thôn Kim Ngọc 3, xã Liên Giang, Đông Hưng, Thái Bình","c8":"Xóm 9, thôn Kim Ngọc 3, xã Liên Giang, Đông Hưng, Thái Bình","c9":"0985483196","c10":"Văn phòng Hưng Yên","c11":"Phòng Quản lý Dự án","c12":"K1","c13":"QLDA","c14":"Nhân viên lái máy xúc","c15":"L2","c16":"NV","c17":"Trung cấp","c18":"04/03/2021","c19":"04/04/2021","c20":"63","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"2,000,000","c28":"15,000,000","c29":"5,100,000","c30":"500,000","c31":"15,500,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"400,000","c40":"Bậc B2","c41":"10,100,000","c42":"16,950,000","c43":"6,000,000","c44":"Tham gia","c45":"","c46":"01/04/2026","c47":"","c48":"","c49":""}'::jsonb),
  (15, 'TT0067', 'Nguyễn Ngọc Trìu', 'K1', 'QLDA', 'Nhân viên lái máy xúc', 'L2', 'E2', 'B2', 5400000, 10100000, 200000, 200000, 0, 650000, 100000, 16650000, 5700000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"11","c1":"TT0067","c2":"Nguyễn Ngọc Trìu","c3":"Nam","c4":"20/06/1977","c5":"034077007110","c6":"12/08/2021","c7":"Thôn Tam Lạc, Vũ Lạc, TP Thái Bình","c8":"Thôn Tam Lạc, Vũ Lạc, TP Thái Bình","c9":"0327518078","c10":"Văn phòng Hưng Yên","c11":"Phòng Quản lý Dự án","c12":"K1","c13":"QLDA","c14":"Nhân viên lái máy xúc","c15":"L2","c16":"NV","c17":"Trung cấp","c18":"04/04/2024","c19":"04/05/2024","c20":"26","c21":"12 tháng","c22":"05/05/2026","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"2,000,000","c28":"15,000,000","c29":"5,100,000","c30":"500,000","c31":"15,500,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc B2","c41":"10,100,000","c42":"16,650,000","c43":"5,700,000","c44":"Tham gia","c45":"","c46":"01/04/2026","c47":"","c48":"","c49":""}'::jsonb),
  (16, 'TT0022', 'Nguyễn Thị Hương', 'K1', 'TCKT', 'Trưởng phòng TCKT', 'L8', 'E8', 'B1', 8000000, 13400000, 750000, 750000, 0, 650000, 700000, 24250000, 9450000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"12","c1":"TT0022","c2":"Nguyễn Thị Hương","c3":"Nữ","c4":"07/07/1979","c5":"034179015973","c6":"18/12/2013","c7":"Thôn Bắc Lạng, Nguyên Xá, Đông Hưng, Thái Bình","c8":"thôn Bắc Lạng, Nguyên Xá, Đông Hưng, Thái Bình","c9":"0987413868","c10":"Văn phòng Hưng Yên","c11":"Phòng Tài chính Kế toán","c12":"K1","c13":"TCKT","c14":"Trưởng phòng TCKT","c15":"L8","c16":"QLCT","c17":"Đại học","c18":"05/04/2018","c19":"05/05/2018","c20":"98","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"20,000,000","c27":"5,000,000","c28":"25,000,000","c29":"5,500,000","c30":"(3,600,000)","c31":"21,400,000","c32":"8,000,000","c33":"750,000","c34":"750,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"700,000","c40":"Bậc B1","c41":"13,400,000","c42":"24,250,000","c43":"9,450,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (17, 'TT0013', 'Phạm Thị Thủy', 'K1', 'TCKT', 'Chuyên viên Kế toán tổng hợp', 'L5', 'E5', 'C1', 6600000, 6200000, 450000, 450000, 0, 650000, 900000, 15250000, 7950000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"13","c1":"TT0013","c2":"Phạm Thị Thủy","c3":"Nữ","c4":"23/12/1989","c5":"034189017688","c6":"19/12/2021","c7":"Minh Quang, Vũ Thư, Thái Bình","c8":"Minh Quang, Vũ Thư, Thái Bình","c9":"0973687305","c10":"Văn phòng Hưng Yên","c11":"Phòng Tài chính Kế toán","c12":"K1","c13":"TCKT","c14":"Chuyên viên Kế toán tổng hợp","c15":"L5","c16":"CV","c17":"Đại học","c18":"01/06/2016","c19":"01/07/2016","c20":"120","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"11,000,000","c27":"2,000,000","c28":"13,000,000","c29":"5,100,000","c30":"(200,000)","c31":"12,800,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"900,000","c40":"Bậc C1","c41":"6,200,000","c42":"15,250,000","c43":"7,950,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (18, 'TT0050', 'Bùi Thị Tâm', 'K1', 'TCKT', 'Chuyên viên Kế toán dự án', 'L4', 'E4', 'C2', 6000000, 6700000, 350000, 350000, 0, 650000, 200000, 14250000, 6550000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"14","c1":"TT0050","c2":"Bùi Thị Tâm","c3":"Nữ","c4":"02/09/1986","c5":"034186017399","c6":"31/08/2021","c7":"Thôn Đình Phùng, xã Vũ Đông, TP.Thái Bình, tỉnh Thái Bình","c8":"Thôn Đình Phùng, xã Vũ Đông, TP.Thái Bình, tỉnh Thái Bình","c9":"0943911934","c10":"Văn phòng Hưng Yên","c11":"Phòng Tài chính Kế toán","c12":"K1","c13":"TCKT","c14":"Chuyên viên Kế toán dự án","c15":"L4","c16":"CV","c17":"Đại học","c18":"01/04/2023","c19":"01/05/2023","c20":"38","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"2,000,000","c28":"12,000,000","c29":"5,100,000","c30":"700,000","c31":"12,700,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc C2","c41":"6,700,000","c42":"14,250,000","c43":"6,550,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (19, 'TT0062', 'Hoàng Thị Hải Yến', 'K1', 'TCKT', 'Chuyên viên Kế toán thuế', 'L4', 'E4', 'C2', 6000000, 6700000, 350000, 350000, 0, 650000, 100000, 14150000, 6450000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"15","c1":"TT0062","c2":"Hoàng Thị Hải Yến","c3":"Nữ","c4":"09/12/1999","c5":"034199005800","c6":"18/02/2023","c7":"Thôn Đoàn Kết, xã Đông Thọ, Thành phố Thái Bình.","c8":"Thôn Đoàn Kết, xã Đông Thọ, Thành phố Thái Bình.","c9":"0392570912","c10":"Văn phòng Hưng Yên","c11":"Phòng Tài chính Kế toán","c12":"K1","c13":"TCKT","c14":"Chuyên viên Kế toán thuế","c15":"L4","c16":"CV","c17":"Đại học","c18":"09/11/2023","c19":"09/12/2023","c20":"30","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"11,000,000","c27":"2,000,000","c28":"13,000,000","c29":"5,100,000","c30":"(300,000)","c31":"12,700,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc C2","c41":"6,700,000","c42":"14,150,000","c43":"6,450,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (20, 'TT0087', 'Vũ Thị Hải Yến', 'K1', 'TCKT', 'Nhân viên Kế toán thanh toán', 'L3', 'E3', 'C3', 5500000, 7100000, 300000, 300000, 0, 650000, 0, 13850000, 5800000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"16","c1":"TT0087","c2":"Vũ Thị Hải Yến","c3":"Nữ","c4":"22/02/1994","c5":"034194018520","c6":"19/12/2021","c7":"Tam Quang, Vũ Thư, Thái Bình","c8":"Tổ 2, thị trấn Quỳnh Côi, Quỳnh Phụ, Thái Bình","c9":"0974646832","c10":"Văn phòng Hưng Yên","c11":"Phòng Tài chính Kế toán","c12":"K1","c13":"TCKT","c14":"Nhân viên Kế toán thanh toán","c15":"L3","c16":"CV","c17":"Đại học","c18":"09/08/2025","c19":"09/08/2025","c20":"10","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"3,000,000","c28":"13,000,000","c29":"5,100,000","c30":"(400,000)","c31":"12,600,000","c32":"5,500,000","c33":"300,000","c34":"300,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc C3","c41":"7,100,000","c42":"13,850,000","c43":"5,800,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (21, 'TT0041', 'Trần Thị Tươi', 'K1', 'HCNS', 'Trưởng nhóm Hành chính', 'L5', 'E5', 'C3', 6600000, 8600000, 450000, 450000, 0, 650000, 200000, 16950000, 7250000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"17","c1":"TT0041","c2":"Trần Thị Tươi","c3":"Nữ","c4":"07/07/1992","c5":"020192004776","c6":"08/09/2022","c7":"Bắc Thủy, Chi Lăng, Lạng Sơn","c8":"Xóm 17 Đông Hòa, TP.Thái Bình","c9":"0963927792","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Trưởng nhóm Hành chính","c15":"L5","c16":"QLN","c17":"Đại học","c18":"01/07/2022","c19":"01/08/2022","c20":"47","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"2,000,000","c28":"15,000,000","c29":"5,100,000","c30":"200,000","c31":"15,200,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc C3","c41":"8,600,000","c42":"16,950,000","c43":"7,250,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (22, 'TT0068', 'Nguyễn Văn Hoàng', 'K1', 'HCNS', 'Chuyên viên Công nghệ thông tin (IT)', 'L5', 'E5', 'D4', 6600000, 5000000, 450000, 450000, 0, 650000, 0, 13150000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"18","c1":"TT0068","c2":"Nguyễn Văn Hoàng","c3":"Nam","c4":"12/08/1992","c5":"034092019716","c6":"05/10/2021","c7":"Ấp 6, Tiến Hưng, TP Đồng Xoài, Bình Phước","c8":"Tổ 1 Trần Hứng Đạo, TP Thái Bình","c9":"0969666840","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Chuyên viên Công nghệ thông tin (IT)","c15":"L5","c16":"CV","c17":"Đại học","c18":"24/06/2024","c19":"24/07/2024","c20":"23","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"1,000,000","c28":"11,000,000","c29":"5,100,000","c30":"600,000","c31":"11,600,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D4","c41":"5,000,000","c42":"13,150,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (23, 'TT0038', 'Hà Thị Hải Hồng', 'K1', 'HCNS', 'Chuyên viên nhân sự tổng hợp', 'L4', 'E4', 'D4', 6000000, 4500000, 350000, 350000, 0, 650000, 300000, 12150000, 6650000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"19","c1":"TT0038","c2":"Hà Thị Hải Hồng","c3":"Nữ","c4":"29/05/1992","c5":"022192003559","c6":"19/01/2022","c7":"SN 04/17, ngõ 23, tổ 8, phường Kỳ Bá, thành phố Thái Bình, tình Thái Bình","c8":"SN 19A, ngõ 482, tổ 7, phường Trần Hưng Đạo, thành phố Thái Bình, tỉnh Thái Bình","c9":"0397483385","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Chuyên viên nhân sự tổng hợp","c15":"L4","c16":"CV","c17":"Đại học","c18":"11/04/2022","c19":"11/05/2022","c20":"49","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"8,000,000","c27":"2,500,000","c28":"10,500,000","c29":"5,100,000","c30":"-","c31":"10,500,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"300,000","c40":"Bậc D4","c41":"4,500,000","c42":"12,150,000","c43":"6,650,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (24, 'TT0059', 'Nguyễn Thị Nhung', 'K1', 'HCNS', 'Chuyên viên pháp chế', 'L4', 'E4', 'C4', 6000000, 8900000, 350000, 350000, 0, 650000, 100000, 16350000, 6450000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"20","c1":"TT0059","c2":"Nguyễn Thị Nhung","c3":"Nữ","c4":"05/11/1994","c5":"034194016503","c6":"28/06/2022","c7":"Thôn Nam Tiền, Hòa Bình, Kiến Xương, Thái Bình","c8":"Thôn Nam Tiền, Hòa Bình, Kiến Xương, Thái Bình","c9":"0347161405","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Chuyên viên pháp chế","c15":"L4","c16":"CV","c17":"Đại học","c18":"01/11/2023","c19":"01/12/2023","c20":"31","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"11,000,000","c27":"3,000,000","c28":"14,000,000","c29":"5,100,000","c30":"900,000","c31":"14,900,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc C4","c41":"8,900,000","c42":"16,350,000","c43":"6,450,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (25, 'TT0056', 'Đặng Thị Hương', 'K1', 'HCNS', 'Nhân viên lễ tân', 'L2', 'E2', 'D2', 5400000, 2500000, 200000, 200000, 0, 650000, 100000, 9050000, 5700000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"21","c1":"TT0056","c2":"Đặng Thị Hương","c3":"Nữ","c4":"10/11/1996","c5":"034196001924","c6":"19/12/2021","c7":"Thôn Thống Nhất, xã Quang Minh, huyện Kiến Xương, tỉnh Thái Bình","c8":"Thôn Thống Nhất, xã Quang Minh, huyện Kiến Xương, tỉnh Thái Bình","c9":"0971887596","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên lễ tân","c15":"L2","c16":"NV","c17":"Đại học","c18":"07/09/2023","c19":"07/10/2023","c20":"32","c21":"12 tháng","c22":"05/05/2026","c23":"Đang làm","c24":"","c25":"","c26":"7,000,000","c27":"1,000,000","c28":"8,000,000","c29":"5,100,000","c30":"(100,000)","c31":"7,900,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc D2","c41":"2,500,000","c42":"9,050,000","c43":"5,700,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (26, 'TT0122', 'Vũ Thu Hương', 'K1', 'HCNS', 'Nhân viên lễ tân', 'L2', 'E2', 'D1', 5400000, 1700000, 200000, 200000, 0, 650000, 100000, 8250000, 5700000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"22","c1":"TT0122","c2":"Vũ Thu Hương","c3":"Nữ","c4":"09/07/1998","c5":"034198004114","c6":"14/09/2021","c7":"Đường Chu Văn An, phường Vũ Phúc, tỉnh Hưng Yên","c8":"Xóm 7 Mỹ Giá, Quỳnh Hưng, Quỳnh Phụ, Thái Bình","c9":"0967355918","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên lễ tân","c15":"L2","c16":"NV","c17":"Đại học","c18":"09/10/2023","c19":"01/12/2023","c20":"31","c21":"12 tháng","c22":"01/04/2026","c23":"Đang làm","c24":"","c25":"","c26":"6,000,000","c27":"500,000","c28":"6,500,000","c29":"5,100,000","c30":"600,000","c31":"7,100,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc D1","c41":"1,700,000","c42":"8,250,000","c43":"5,700,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (27, 'TT0018', 'Mai Đức Duân', 'K1', 'HCNS', 'Nhân viên lái xe ô tô con văn phòng', 'L2', 'E2', 'C3', 5400000, 7000000, 200000, 200000, 0, 650000, 800000, 14250000, 6400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"23","c1":"TT0018","c2":"Mai Đức Duân","c3":"Nam","c4":"17/12/1982","c5":"034082007326","c6":"22/02/2017","c7":"thôn Đồng Kinh, Thái Thuần, Thái Thụy, Thái Bình","c8":"Thôn Nam, Đông Sơn, Đông Hưng, Thái Bình","c9":"0976259150","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên lái xe ô tô con văn phòng","c15":"L2","c16":"NV","c17":"LĐPT","c18":"01/04/2017","c19":"01/05/2017","c20":"110","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"2,000,000","c28":"12,000,000","c29":"5,100,000","c30":"400,000","c31":"12,400,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"800,000","c40":"Bậc C3","c41":"7,000,000","c42":"14,250,000","c43":"6,400,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (28, 'TT0036', 'Bùi Đình Thứ', 'K1', 'HCNS', 'Nhân viên lái cẩu tự hành', 'L2', 'E2', 'B2', 5400000, 10100000, 200000, 200000, 0, 650000, 300000, 16850000, 5900000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"24","c1":"TT0036","c2":"Bùi Đình Thứ","c3":"Nam","c4":"04/03/1981","c5":"034081000545","c6":"19/09/2014","c7":"xã Châu Sơn, huyện Quỳnh Phụ, tỉnh Thái Bình","c8":"xã Châu Sơn, huyện Quỳnh Phụ, tỉnh Thái Bình","c9":"0988132356","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên lái cẩu tự hành","c15":"L2","c16":"NV","c17":"Trung cấp","c18":"21/03/2022","c19":"21/04/2022","c20":"50","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"2,000,000","c28":"15,000,000","c29":"5,100,000","c30":"500,000","c31":"15,500,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"300,000","c40":"Bậc B2","c41":"10,100,000","c42":"16,850,000","c43":"5,900,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (29, 'TT0069', 'Nguyễn Xuân Vũ', 'K1', 'HCNS', 'Nhân viên lái xe ô tô con văn phòng', 'L2', 'E2', 'C4', 5400000, 8000000, 200000, 200000, 0, 650000, 0, 14450000, 5600000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"25","c1":"TT0069","c2":"Nguyễn Xuân Vũ","c3":"Nam","c4":"01/06/1985","c5":"034085007877","c6":"12/08/2021","c7":"Thôn Trung Hòa, Việt Thuận, Vũ Thư, Thái Bình","c8":"Thôn Trung Hòa, Việt Thuận, Vũ Thư, Thái Bình","c9":"0914861717","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên lái xe ô tô con văn phòng","c15":"L2","c16":"NV","c17":"Trung cấp","c18":"16/07/2024","c19":"16/08/2024","c20":"22","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"3,000,000","c28":"13,000,000","c29":"5,100,000","c30":"400,000","c31":"13,400,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc C4","c41":"8,000,000","c42":"14,450,000","c43":"5,600,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (30, 'TT0118', 'Trần Đăng Thành', 'K1', 'HCNS', 'Nhân viên lái xe ô tô con văn phòng', 'L2', 'E2', 'C2', 5400000, 6000000, 200000, 200000, 0, 650000, 600000, 13050000, 6200000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"26","c1":"TT0118","c2":"Trần Đăng Thành","c3":"Nam","c4":"19/04/1995","c5":"034095014038","c6":"25/02/2022","c7":"Xóm 7 Mỹ Giá, Quỳnh Hưng, Quỳnh Phụ, Thái Bình","c8":"Xóm 3 thôn Hiệp Trung, Đông Hòa, TP Thái Bình, Tỉnh Thái Bình","c9":"0867778123","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên lái xe ô tô con văn phòng","c15":"L2","c16":"NV","c17":"LĐPT","c18":"07/08/2018","c19":"07/08/2018","c20":"94","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"1,000,000","c28":"11,000,000","c29":"5,100,000","c30":"400,000","c31":"11,400,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"600,000","c40":"Bậc C2","c41":"6,000,000","c42":"13,050,000","c43":"6,200,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (31, 'TT0124', 'Nguyễn Thanh Phong', 'K1', 'HCNS', 'Nhân viên lái cẩu tự hành', 'L2', 'E2', 'B2', 5400000, 10100000, 200000, 200000, 0, 650000, 0, 16550000, 5600000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"27","c1":"TT0124","c2":"Nguyễn Thanh Phong","c3":"Nam","c4":"10/04/1995","c5":"034095013158","c6":"13/08/2021","c7":"Vũ Hội, Vũ Thư, Thái Bình","c8":"Kỳ Bá, Thành phố Thái Bình, Thái Bình","c9":"0972572895","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên lái cẩu tự hành","c15":"L2","c16":"NV","c17":"Sơ cấp","c18":"11/05/2026","c19":"11/06/2026","c20":"-","c21":"Thử việc","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"-","c28":"15,000,000","c29":"","c30":"500,000","c31":"15,500,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc B2","c41":"10,100,000","c42":"16,550,000","c43":"5,600,000","c44":"","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (32, 'TT0016', 'Nguyễn Thị Ngọc', 'K1', 'HCNS', 'Nhân viên tạp vụ/vệ sinh', 'L1', 'E1', 'D4', 5300000, 4000000, 100000, 100000, 0, 650000, 800000, 10950000, 6200000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"28","c1":"TT0016","c2":"Nguyễn Thị Ngọc","c3":"Nữ","c4":"01/01/1965","c5":"034165012351","c6":"13/08/2021","c7":"Xóm 9, Đồng Cừ, Đông Hải, Quỳnh Phụ, Thái Bình","c8":"SN 04/17, ngõ 23, tổ 8, phường Kỳ Bá, thành phố Thái Bình, tình Thái Bình","c9":"0394193957","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên tạp vụ/vệ sinh","c15":"L1","c16":"NV","c17":"LĐPT","c18":"01/01/2017","c19":"01/01/2017","c20":"114","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"8,000,000","c27":"1,000,000","c28":"9,000,000","c29":"","c30":"300,000","c31":"9,300,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"800,000","c40":"Bậc D4","c41":"4,000,000","c42":"10,950,000","c43":"6,200,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (33, 'TT0029', 'Phạm Thị Hoa', 'K1', 'HCNS', 'Nhân viên tạp vụ/vệ sinh', 'L1', 'E1', 'D2', 5300000, 2400000, 100000, 100000, 0, 650000, 500000, 9050000, 5900000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"29","c1":"TT0029","c2":"Phạm Thị Hoa","c3":"Nữ","c4":"26/10/1970","c5":"034170004082","c6":"06/09/2021","c7":"Lô 21B4, Tổ 36 phường Trần Lãm, Tp Thái Bình, tỉnh Thái Bình","c8":"Lô 21B4, phường Trần Lãm, Tp Thái Bình, tỉnh Thái Bình","c9":"0946591575","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên tạp vụ/vệ sinh","c15":"L1","c16":"NV","c17":"LĐPT","c18":"21/02/2020","c19":"21/02/2020","c20":"76","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"7,000,000","c27":"500,000","c28":"7,500,000","c29":"","c30":"200,000","c31":"7,700,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"500,000","c40":"Bậc D2","c41":"2,400,000","c42":"9,050,000","c43":"5,900,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (34, 'TT0051', 'Vũ Thị Hằng', 'K1', 'HCNS', 'Nhân viên tạp vụ/vệ sinh', 'L1', 'E1', 'D3', 5300000, 3200000, 100000, 100000, 0, 650000, 200000, 9550000, 5600000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"30","c1":"TT0051","c2":"Vũ Thị Hằng","c3":"Nữ","c4":"12/07/1987","c5":"034187021606","c6":"16/09/2021","c7":"Thôn Thái Phú Thọ, xã Hồng phong, huyện Vũ Thư, tỉnh Thái Bình","c8":"Thôn Thái Phú Thọ, xã Hồng phong, huyện Vũ Thư, tỉnh Thái Bình","c9":"0984107887","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên tạp vụ/vệ sinh","c15":"L1","c16":"NV","c17":"LĐPT","c18":"12/05/2023","c19":"12/05/2023","c20":"37","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"6,000,000","c27":"2,000,000","c28":"8,000,000","c29":"5,100,000","c30":"500,000","c31":"8,500,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc D3","c41":"3,200,000","c42":"9,550,000","c43":"5,600,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (35, 'TT0073', 'Nguyễn Thị Xuyên', 'K1', 'HCNS', 'Nhân viên tạp vụ/vệ sinh', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"31","c1":"TT0073","c2":"Nguyễn Thị Xuyên","c3":"Nữ","c4":"04/05/1968","c5":"034168017187","c6":"10/08/2021","c7":"Thôn Cầu nhân, xã Đông Hòa, TP.Thái Bình","c8":"Thôn Cầu nhân, xã Đông Hòa, TP.Thái Bình","c9":"0358180174","c10":"Văn phòng Hưng Yên","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên tạp vụ/vệ sinh","c15":"L1","c16":"NV","c17":"LĐPT","c18":"18/03/2025","c19":"01/04/2025","c20":"15","c21":"KXĐ","c22":"01/04/2026","c23":"Đang làm","c24":"","c25":"","c26":"6,000,000","c27":"500,000","c28":"6,500,000","c29":"","c30":"400,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (36, 'TT0028', 'Phạm Minh Tiến', 'K1', 'TKĐT', 'Trưởng phòng TKĐT', 'L8', 'E8', 'B3', 8000000, 16600000, 750000, 750000, 0, 650000, 500000, 27250000, 9250000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"32","c1":"TT0028","c2":"Phạm Minh Tiến","c3":"Nam","c4":"10/03/1987","c5":"034087009031","c6":"25/05/2018","c7":"Tổ 2 Quỳnh Côi, Quỳnh Phụ, Thái Bình","c8":"xóm 4, Vũ Lạc, Kiến Xương, Thái Bình","c9":"0983587310","c10":"Văn phòng Hưng Yên","c11":"Phòng Thiết Kế Đấu thầu","c12":"K1","c13":"TKĐT","c14":"Trưởng phòng TKĐT","c15":"L8","c16":"QLCT","c17":"Thạc sĩ","c18":"01/11/2019","c19":"01/12/2019","c20":"79","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"20,000,000","c27":"5,000,000","c28":"25,000,000","c29":"5,500,000","c30":"(400,000)","c31":"24,600,000","c32":"8,000,000","c33":"750,000","c34":"750,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"500,000","c40":"Bậc B3","c41":"16,600,000","c42":"27,250,000","c43":"9,250,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (37, 'TT0007', 'Nguyễn Hữu Hoàng', 'K1', 'TKĐT', 'Chuyên viên Thiết kế (theo bộ môn)', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 650000, 1000000, 20250000, 8050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"33","c1":"TT0007","c2":"Nguyễn Hữu Hoàng","c3":"Nam","c4":"20/06/1989","c5":"034089001105","c6":"21/11/2018","c7":"Xóm 5 Khang Ninh, Quỳnh Trang, Quỳnh Phụ, TB","c8":"Xóm 5 Khang Ninh, Quỳnh Trang, Quỳnh Phụ, TB","c9":"0975474463","c10":"Văn phòng Hưng Yên","c11":"Phòng Thiết Kế Đấu thầu","c12":"K1","c13":"TKĐT","c14":"Chuyên viên Thiết kế (theo bộ môn)","c15":"L5","c16":"CV","c17":"Đại học","c18":"01/03/2015","c19":"01/04/2015","c20":"135","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"3,000,000","c28":"18,000,000","c29":"5,100,000","c30":"(300,000)","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"1,000,000","c40":"Bậc B1","c41":"11,100,000","c42":"20,250,000","c43":"8,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (38, 'TT0021', 'Hà Thị Tuyết Minh', 'K1', 'TKĐT', 'Chuyên viên Thiết kế (theo bộ môn)', 'L5', 'E5', 'B3', 6600000, 13700000, 450000, 450000, 0, 650000, 700000, 22550000, 7750000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"34","c1":"TT0021","c2":"Hà Thị Tuyết Minh","c3":"Nữ","c4":"03/11/1987","c5":"017187000683","c6":"28/05/2015","c7":"Tổ 2, thị trấn Quỳnh Côi, Quỳnh Phụ, Thái Bình","c8":"xóm 4, Vũ Lạc, Kiến Xương, Thái Bình","c9":"0984741499","c10":"Văn phòng Hưng Yên","c11":"Phòng Thiết Kế Đấu thầu","c12":"K1","c13":"TKĐT","c14":"Chuyên viên Thiết kế (theo bộ môn)","c15":"L5","c16":"CV","c17":"Đại học","c18":"01/03/2018","c19":"01/04/2018","c20":"99","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"17,000,000","c27":"3,000,000","c28":"20,000,000","c29":"5,500,000","c30":"300,000","c31":"20,300,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"700,000","c40":"Bậc B3","c41":"13,700,000","c42":"22,550,000","c43":"7,750,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (39, 'TT0034', 'Phạm Đức Thiện', 'K1', 'TKĐT', 'Chuyên viên Thiết kế (theo bộ môn)', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 650000, 300000, 19550000, 7350000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"35","c1":"TT0034","c2":"Phạm Đức Thiện","c3":"Nam","c4":"10/08/1990","c5":"034090009528","c6":"28/11/2018","c7":"Xóm Thái Hòa, thôn Tri Lễ, xã Vũ Lễ, huyện Kiến Xương, tỉnh Thái Bình","c8":"Xóm Thái Hòa, thôn Tri Lễ, xã Vũ Lễ, huyện Kiến Xương, tỉnh Thái Bình","c9":"0981177701","c10":"Văn phòng Hưng Yên","c11":"Phòng Thiết Kế Đấu thầu","c12":"K1","c13":"TKĐT","c14":"Chuyên viên Thiết kế (theo bộ môn)","c15":"L5","c16":"CV","c17":"Đại học","c18":"13/10/2021","c19":"13/11/2021","c20":"55","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"3,000,000","c28":"18,000,000","c29":"5,100,000","c30":"(300,000)","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"300,000","c40":"Bậc B1","c41":"11,100,000","c42":"19,550,000","c43":"7,350,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (40, 'TT0017', 'Đặng Thị Thu Hà', 'K1', 'VTTB', 'Phó phòng VTTB', 'L7', 'E7', 'C3', 7600000, 9900000, 650000, 650000, 0, 650000, 800000, 20250000, 9050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"36","c1":"TT0017","c2":"Đặng Thị Thu Hà","c3":"Nữ","c4":"13/11/1984","c5":"034184018343","c6":"25/02/2022","c7":"Tổ 33, P. Kỳ Bá, TP. Thái Bình","c8":"Tổ 33, P. Kỳ Bá, TP. Thái Bình","c9":"0912078572","c10":"Văn phòng Hưng Yên","c11":"Phòng Vật tư thiết bị","c12":"K1","c13":"VTTB","c14":"Phó phòng VTTB","c15":"L7","c16":"QLCT","c17":"Đại học","c18":"26/03/2017","c19":"26/04/2017","c20":"110","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"3,000,000","c28":"16,000,000","c29":"5,100,000","c30":"1,500,000","c31":"17,500,000","c32":"7,600,000","c33":"650,000","c34":"650,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"800,000","c40":"Bậc C3","c41":"9,900,000","c42":"20,250,000","c43":"9,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (41, 'TT0033', 'Bùi Thùy Linh', 'K1', 'VTTB', 'Chuyên viên quản lý kho', 'L3', 'E3', 'C3', 5500000, 7100000, 300000, 300000, 0, 650000, 400000, 14250000, 6200000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"37","c1":"TT0033","c2":"Bùi Thùy Linh","c3":"Nữ","c4":"14/10/1993","c5":"034193004484","c6":"15/09/2017","c7":"SN 158B khu 3, TT Diêm Điền, Thái Thụy, Thái Bình","c8":"Số 33, đường 33, tổ 19, phường Trần Lãm, TPTB","c9":"0985482763","c10":"Văn phòng Hưng Yên","c11":"Phòng Tài chính Kế toán","c12":"K1","c13":"VTTB","c14":"Chuyên viên quản lý kho","c15":"L3","c16":"NV","c17":"Đại học","c18":"10/05/2021","c19":"10/06/2021","c20":"60","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"2,000,000","c28":"12,000,000","c29":"5,100,000","c30":"600,000","c31":"12,600,000","c32":"5,500,000","c33":"300,000","c34":"300,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"400,000","c40":"Bậc C3","c41":"7,100,000","c42":"14,250,000","c43":"6,200,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (42, 'TT0035', 'Bùi Quang Chung', 'K1', 'VTTB', 'Chuyên viên Vật tư', 'L4', 'E4', 'C2', 6000000, 6700000, 350000, 350000, 0, 650000, 300000, 14350000, 6650000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"38","c1":"TT0035","c2":"Bùi Quang Chung","c3":"Nam","c4":"02/09/1992","c5":"034092005791","c6":"08/09/2017","c7":"xã Việt Thuận, huyện Vũ Thư, tỉnh Thái Bình","c8":"thôn Hợp Long, xã Việt Thuận, huyện Vũ Thư, tỉnh Thái Bình","c9":"0962431226","c10":"Văn phòng Hưng Yên","c11":"Phòng Vật tư thiết bị","c12":"K1","c13":"VTTB","c14":"Chuyên viên Vật tư","c15":"L4","c16":"CV","c17":"Cao đẳng","c18":"21/03/2022","c19":"21/04/2022","c20":"50","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"3,000,000","c28":"13,000,000","c29":"5,100,000","c30":"(300,000)","c31":"12,700,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"300,000","c40":"Bậc C2","c41":"6,700,000","c42":"14,350,000","c43":"6,650,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (43, 'TT0030', 'Trần Bá Tuần', 'K1', 'CGCV', 'Cố vấn', 'L4', 'E4', 'D1', 6000000, 1800000, 350000, 350000, 0, 650000, 500000, 9650000, 6850000, 'excel_seed', 'warning', 'needs_review', '["Chức danh chưa có trong danh mục - cần bổ sung/chọn lại; BHXH: BHXH đóng tại đơn vị khác"]'::jsonb, '[]'::jsonb, '{"c0":"39","c1":"TT0030","c2":"Trần Bá Tuần","c3":"Nam","c4":"09/02/1979","c5":"034079025301","c6":"23/11/2022","c7":"Thôn Nam, Đông Sơn, Đông Hưng, Thái Bình","c8":"Thôn Nam, Đông Sơn, Đông Hưng, Thái Bình","c9":"0977942678","c10":"Văn phòng Hưng Yên","c11":"Cố vấn","c12":"K1","c13":"CGCV","c14":"Cố vấn","c15":"L4","c16":"CV","c17":"Đại học","c18":"18/05/2020","c19":"18/05/2020","c20":"73","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"","c27":"","c28":"-","c29":"","c30":"","c31":"7,800,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"500,000","c40":"Bậc D1","c41":"1,800,000","c42":"9,650,000","c43":"6,850,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"Chức danh chưa có trong danh mục - cần bổ sung/chọn lại; BHXH: BHXH đóng tại đơn vị khác","c48":"","c49":""}'::jsonb),
  (44, 'TT0121', 'Dương Văn Lễ', 'K1', 'CGCV', 'Cố vấn', 'L4', 'E4', 'D1', 6000000, 1800000, 350000, 350000, 0, 650000, 0, 9150000, 6350000, 'excel_seed', 'warning', 'needs_review', '["Trùng tên trong DS nghỉ việc 2026 - cần xác minh; Chi Bộ Đảng - tạm xếp BLĐ, cần xác minh; Chức danh chưa có trong danh mục - cần bổ sung/chọn lại"]'::jsonb, '[]'::jsonb, '{"c0":"40","c1":"TT0121","c2":"Dương Văn Lễ","c3":"Nam","c4":"","c5":"","c6":"","c7":"Trần Hưng Đạo, tỉnh Hưng Yên","c8":"Trần Hưng Đạo, tỉnh Hưng Yên","c9":"","c10":"Văn phòng Hưng Yên","c11":"Cố vấn","c12":"K1","c13":"CGCV","c14":"Cố vấn","c15":"L4","c16":"CV","c17":"Đại học","c18":"","c19":"","c20":"","c21":"Chuyên gia","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"5,000,000","c27":"","c28":"5,000,000","c29":"","c30":"","c31":"7,800,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"","c40":"Bậc D1","c41":"1,800,000","c42":"9,150,000","c43":"6,350,000","c44":"Hưu trí","c45":"","c46":"","c47":"Trùng tên trong DS nghỉ việc 2026 - cần xác minh; Chi Bộ Đảng - tạm xếp BLĐ, cần xác minh; Chức danh chưa có trong danh mục - cần bổ sung/chọn lại","c48":"","c49":""}'::jsonb),
  (46, 'TT0097', 'Nguyễn Quang Thuận', 'K2', 'BCH RICO', 'Chỉ huy trưởng BCH RICO', 'L8', 'E8', 'B4', 8000000, 18200000, 750000, 750000, 0, 0, 0, 27700000, 8750000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"41","c1":"TT0097","c2":"Nguyễn Quang Thuận","c3":"Nam","c4":"16/01/1989","c5":"034089010185","c6":"17/11/2022","c7":"Quỳnh Bảo, Quỳnh Phụ, Thái Bình","c8":"Tổ 8, Trần Hưng Đạo, Hưng Yên","c9":"0976651056","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chỉ huy trưởng BCH RICO","c15":"L8","c16":"QLCT","c17":"Đại học","c18":"01/10/2025","c19":"01/10/2025","c20":"9","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"20,000,000","c27":"5,000,000","c28":"25,000,000","c29":"5,500,000","c30":"1,200,000","c31":"26,200,000","c32":"8,000,000","c33":"750,000","c34":"750,000","c35":"-","c36":"0","c37":"-","c38":"0","c39":"0","c40":"Bậc B4","c41":"18,200,000","c42":"27,700,000","c43":"8,750,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (47, 'TT0070', 'Bùi Ngọc Lân', 'K2', 'BCH RICO', 'Chỉ huy phó BCH RICO', 'L7', 'E7', 'A2', 7600000, 22600000, 650000, 650000, 0, 2600000, 0, 34100000, 8250000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"42","c1":"TT0070","c2":"Bùi Ngọc Lân","c3":"Nam","c4":"19/03/1980","c5":"034080003516","c6":"10/11/2022","c7":"Quỳnh Trang, Quỳnh Phụ, Thái Bình","c8":"Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0912000074","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chỉ huy phó BCH RICO","c15":"L7","c16":"QLCT","c17":"Đại học","c18":"12/09/2024","c19":"12/09/2024","c20":"21","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"25,000,000","c27":"5,000,000","c28":"30,000,000","c29":"5,500,000","c30":"200,000","c31":"30,200,000","c32":"7,600,000","c33":"650,000","c34":"650,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc A2","c41":"22,600,000","c42":"34,100,000","c43":"8,250,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (48, 'TT0008', 'Trần Văn Nghĩa', 'K2', 'BCH RICO', 'Cán bộ Trắc đạc', 'L5', 'E5', 'B3', 6600000, 13700000, 450000, 450000, 0, 2600000, 1000000, 24800000, 8050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"43","c1":"TT0008","c2":"Trần Văn Nghĩa","c3":"Nam","c4":"02/01/1982","c5":"034082006388","c6":"21/10/2016","c7":"KĐT 379, phường Quang Trung, Tp Thái Bình","c8":"KĐT 379, phường Quang Trung, Tp Thái Bình","c9":"0914205362","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Cán bộ Trắc đạc","c15":"L5","c16":"CV","c17":"Trung cấp","c18":"01/05/2015","c19":"01/06/2015","c20":"133","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"5,000,000","c28":"20,000,000","c29":"5,100,000","c30":"300,000","c31":"20,300,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"1,000,000","c40":"Bậc B3","c41":"13,700,000","c42":"24,800,000","c43":"8,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (49, 'TT0019', 'Vũ Duy Tùng', 'K2', 'BCH RICO', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 2600000, 700000, 21900000, 7750000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"44","c1":"TT0019","c2":"Vũ Duy Tùng","c3":"Nam","c4":"22/09/2025","c5":"034082007859","c6":"26/04/2017","c7":"Bương Hạ, Quỳnh Ngọc, Quỳnh Phụ, Thái Bình","c8":"Bương Hạ, Quỳnh Ngọc, Quỳnh Phụ, Thái Bình","c9":"0976879582","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Trung cấp","c18":"01/09/2017","c19":"01/10/2017","c20":"105","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"2,000,000","c28":"17,000,000","c29":"5,100,000","c30":"700,000","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"700,000","c40":"Bậc B1","c41":"11,100,000","c42":"21,900,000","c43":"7,750,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (50, 'TT0074', 'Đặng Ngọc Chiến', 'K2', 'BCH RICO', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'C2', 6600000, 7400000, 450000, 450000, 0, 2600000, 0, 17500000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"45","c1":"TT0074","c2":"Đặng Ngọc Chiến","c3":"Nam","c4":"13/07/1986","c5":"058086005332","c6":"27/06/2021","c7":"Xuân Hải, Ninh Hải, Ninh Thuận","c8":"Xuân Hải, Ninh Hải, Ninh Thuận","c9":"0967432534","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Cao đẳng","c18":"01/03/2025","c19":"01/04/2025","c20":"15","c21":"12 tháng","c22":"01/04/2026","c23":"Đang làm","c24":"","c25":"","c26":"12,000,000","c27":"2,000,000","c28":"14,000,000","c29":"5,100,000","c30":"-","c31":"14,000,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc C2","c41":"7,400,000","c42":"17,500,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (51, 'TT0081', 'Phạm Văn Thắng', 'K2', 'BCH RICO', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'C3', 6600000, 8600000, 450000, 450000, 0, 2600000, 0, 18700000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"46","c1":"TT0081","c2":"Phạm Văn Thắng","c3":"Nam","c4":"28/04/1985","c5":"034085006389","c6":"01/09/2021","c7":"Đông Hợp, Đông Hưng, Thái Bình","c8":"Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0762800222","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Cao đẳng","c18":"05/05/2025","c19":"05/06/2025","c20":"13","c21":"KXĐ","c22":"05/06/2026","c23":"Đang làm","c24":"","c25":"","c26":"12,000,000","c27":"3,000,000","c28":"15,000,000","c29":"5,100,000","c30":"200,000","c31":"15,200,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc C3","c41":"8,600,000","c42":"18,700,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (52, 'TT0088', 'Lưu Khắc Vịnh', 'K2', 'BCH RICO', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 2600000, 0, 21200000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"47","c1":"TT0088","c2":"Lưu Khắc Vịnh","c3":"Nam","c4":"28/10/1984","c5":"034084017090","c6":"03/01/2025","c7":"Ngọc Chi, Trang Bảo Xá, Quỳnh Phụ, Thái Bình","c8":"Ngọc Chi, Trang Bảo Xá, Quỳnh Phụ, Thái Bình","c9":"0984152607","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Đại học","c18":"01/08/2025","c19":"01/09/2025","c20":"10","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"16,000,000","c27":"2,000,000","c28":"18,000,000","c29":"5,100,000","c30":"(300,000)","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc B1","c41":"11,100,000","c42":"21,200,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (53, 'TT0096', 'Đoàn Văn Tới', 'K2', 'BCH RICO', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 2600000, 0, 21200000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"48","c1":"TT0096","c2":"Đoàn Văn Tới","c3":"Nam","c4":"05/06/1993","c5":"034093009944","c6":"01/03/2022","c7":"Hoà Bình, Vũ Thư, Thái Bình","c8":"Hoà Bình, Vũ Thư, Thái Bình","c9":"0974192235","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Đại học","c18":"07/07/2025","c19":"07/08/2025","c20":"10","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"17,000,000","c27":"-","c28":"17,000,000","c29":"5,100,000","c30":"700,000","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc B1","c41":"11,100,000","c42":"21,200,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (54, 'TT0113', 'Nguyễn Ngọc Đức (2)', 'K2', 'BCH RICO', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 2600000, 0, 21200000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"49","c1":"TT0113","c2":"Nguyễn Ngọc Đức (2)","c3":"Nam","c4":"13/09/1990","c5":"034090010674","c6":"13/08/2021","c7":"Thôn trình Uyên, Quỳnh Nguyên, Quỳnh Phụ, Thái Bình","c8":"Khang Ninh, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0988701558","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Đại học","c18":"12/11/2025","c19":"12/12/2025","c20":"6","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"18,000,000","c27":"-","c28":"18,000,000","c29":"5,100,000","c30":"(300,000)","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc B1","c41":"11,100,000","c42":"21,200,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (55, 'TT0043', 'Vũ Duy Bằng', 'K2', 'BCH RICO', 'Cán bộ KCS', 'L4', 'E4', 'B1', 6000000, 10100000, 350000, 350000, 0, 2600000, 200000, 19600000, 6550000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"50","c1":"TT0043","c2":"Vũ Duy Bằng","c3":"Nam","c4":"12/10/1984","c5":"034084013217","c6":"01/09/2021","c7":"Tân Phong - Vũ Thư - Thái Bình","c8":"Tân Phong - Vũ Thư - Thái Bình","c9":"0936870412","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Cán bộ KCS","c15":"L4","c16":"CV","c17":"Đại học","c18":"10/08/2022","c19":"10/09/2022","c20":"45","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"12,000,000","c27":"3,000,000","c28":"15,000,000","c29":"5,100,000","c30":"1,100,000","c31":"16,100,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"200,000","c40":"Bậc B1","c41":"10,100,000","c42":"19,600,000","c43":"6,550,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (56, 'TT0099', 'Vũ Thị Hồng Phương', 'K2', 'BCH RICO', 'Chuyên viên Kế toán dự án', 'L4', 'E4', 'C1', 6000000, 5600000, 350000, 350000, 0, 2600000, 0, 14900000, 6350000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"51","c1":"TT0099","c2":"Vũ Thị Hồng Phương","c3":"Nữ","c4":"16/09/1983","c5":"034183018506","c6":"08/09/2022","c7":"Quang Bình, Kiến Xương, Thái Bình","c8":"Quang Bình, Kiến Xương, Thái Bình","c9":"0378178288","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Chuyên viên Kế toán dự án","c15":"L4","c16":"CV","c17":"Cao đẳng","c18":"18/08/2025","c19":"19/09/2025","c20":"9","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"9,000,000","c27":"2,000,000","c28":"11,000,000","c29":"5,100,000","c30":"600,000","c31":"11,600,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc C1","c41":"5,600,000","c42":"14,900,000","c43":"6,350,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (57, 'TT0108', 'Nguyễn Đăng Giáp', 'K2', 'BCH RICO', 'Cán bộ QS/QC', 'L4', 'E4', 'B1', 6000000, 10100000, 350000, 350000, 0, 2600000, 0, 19400000, 6350000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"52","c1":"TT0108","c2":"Nguyễn Đăng Giáp","c3":"Nam","c4":"09/02/1996","c5":"034096006683","c6":"12/09/2022","c7":"Bắc Sơn, Quỳnh Thọ, Quỳnh Phụ, Thái Bình","c8":"Bắc Sơn, Quỳnh Thọ, Quỳnh Phụ, Thái Bình","c9":"0356683356","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Cán bộ QS/QC","c15":"L4","c16":"CV","c17":"Đại học","c18":"01/11/2025","c19":"01/12/2025","c20":"7","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"16,000,000","c27":"-","c28":"16,000,000","c29":"5,100,000","c30":"100,000","c31":"16,100,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc B1","c41":"10,100,000","c42":"19,400,000","c43":"6,350,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (58, 'TT0014', 'Phạm Văn Thủy', 'K2', 'BCH RICO', 'Đội trưởng đội xe', 'L3', 'E3', 'B4', 5500000, 12500000, 300000, 300000, 0, 2600000, 900000, 22100000, 6700000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"53","c1":"TT0014","c2":"Phạm Văn Thủy","c3":"Nam","c4":"28/10/1975","c5":"034075000790","c6":"22/12/2014","c7":"SN 33A/482 Tổ 10, phường Trần Hưng Đạo, Tp Thái Bình","c8":"Thôn Xuân Lôi, Phú Xuân, TP. Thái Bình","c9":"0989304722","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Đội trưởng đội xe","c15":"L3","c16":"QLN","c17":"LĐPT","c18":"01/06/2016","c19":"01/07/2016","c20":"120","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"5,000,000","c28":"18,000,000","c29":"","c30":"-","c31":"18,000,000","c32":"5,500,000","c33":"300,000","c34":"300,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"900,000","c40":"Bậc B4","c41":"12,500,000","c42":"22,100,000","c43":"6,700,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (59, 'TT0082', 'Bùi Công Dân', 'K2', 'BCH RICO', 'Đội trưởng đội bảo vệ', 'L3', 'E3', 'C3', 5500000, 7100000, 300000, 300000, 0, 2600000, 0, 15800000, 5800000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"54","c1":"TT0082","c2":"Bùi Công Dân","c3":"Nam","c4":"07/10/1974","c5":"340740090","c6":"16/12/2024","c7":"Trang Bảo Xá, Quỳnh Phụ, Thái Bình","c8":"Trang Bảo Xá, Quỳnh Phụ, Thái Bình","c9":"0855199555","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Đội trưởng đội bảo vệ","c15":"L3","c16":"QLN","c17":"LĐPT","c18":"20/05/2025","c19":"21/06/2025","c20":"12","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"3,000,000","c28":"13,000,000","c29":"","c30":"(400,000)","c31":"12,600,000","c32":"5,500,000","c33":"300,000","c34":"300,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc C3","c41":"7,100,000","c42":"15,800,000","c43":"5,800,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (60, 'TT0003', 'Dương Công Khích', 'K2', 'BCH RICO', 'Nhân viên Vật tư', 'L2', 'E2', 'B3', 5400000, 11200000, 200000, 200000, 0, 2600000, 1000000, 20600000, 6600000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"55","c1":"TT0003","c2":"Dương Công Khích","c3":"Nam","c4":"20/09/1975","c5":"034075003732","c6":"05/07/2016","c7":"Xóm 7, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c8":"Xóm 7, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0936706268","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Nhân viên Vật tư","c15":"L2","c16":"NV","c17":"LĐPT","c18":"01/07/2011","c19":"01/07/2011","c20":"180","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"3,000,000","c28":"16,000,000","c29":"5,100,000","c30":"600,000","c31":"16,600,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"1,000,000","c40":"Bậc B3","c41":"11,200,000","c42":"20,600,000","c43":"6,600,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (61, 'TT0027', 'Nguyễn Duy Đảng', 'K2', 'BCH RICO', 'Nhân viên bảo vệ', 'L1', 'E1', 'C3', 5300000, 6900000, 100000, 100000, 0, 2600000, 500000, 15500000, 5900000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"56","c1":"TT0027","c2":"Nguyễn Duy Đảng","c3":"Nam","c4":"15/05/1959","c5":"034059000552","c6":"01/12/2014","c7":"Xóm 14, Đông Hải, Quỳnh Phụ, Thái Bình","c8":"Xóm 14, Đông Hải, Quỳnh Phụ, Thái Bình","c9":"0354851113","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Nhân viên bảo vệ","c15":"L1","c16":"NV","c17":"LĐPT","c18":"24/07/2019","c19":"24/07/2019","c20":"83","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"10,000,000","c27":"2,000,000","c28":"12,000,000","c29":"","c30":"200,000","c31":"12,200,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"500,000","c40":"Bậc C3","c41":"6,900,000","c42":"15,500,000","c43":"5,900,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (62, 'TT0060', 'Nguyễn Bá Thuấn', 'K2', 'BCH RICO', 'Nhân viên bảo vệ', 'L1', 'E1', 'D4', 5300000, 4000000, 100000, 100000, 0, 2600000, 100000, 12200000, 5500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"57","c1":"TT0060","c2":"Nguyễn Bá Thuấn","c3":"Nam","c4":"30/04/1974","c5":"034074000773","c6":"14/08/2021","c7":"Khang Ninh, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c8":"Khang Ninh, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0989624974","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Nhân viên bảo vệ","c15":"L1","c16":"NV","c17":"LĐPT","c18":"06/11/2023","c19":"06/11/2023","c20":"31","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"9,000,000","c27":"-","c28":"9,000,000","c29":"","c30":"300,000","c31":"9,300,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"100,000","c40":"Bậc D4","c41":"4,000,000","c42":"12,200,000","c43":"5,500,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (63, 'TT0089', 'Nguyễn Thị Hồng Mơ', 'K2', 'BCH RICO', 'Nhân viên cấp dưỡng', 'L1', 'E1', 'D2', 5300000, 2400000, 100000, 100000, 0, 2600000, 0, 10500000, 5400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"58","c1":"TT0089","c2":"Nguyễn Thị Hồng Mơ","c3":"Nữ","c4":"18/09/1972","c5":"034172005366","c6":"19/12/2021","c7":"Tây Lương, Tiền Hải, Thái Bình","c8":"Tây Lương, Tiền Hải, Thái Bình","c9":"0966264676","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Nhân viên cấp dưỡng","c15":"L1","c16":"NV","c17":"LĐPT","c18":"14/08/2025","c19":"14/08/2025","c20":"10","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"7,000,000","c27":"-","c28":"7,000,000","c29":"","c30":"700,000","c31":"7,700,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc D2","c41":"2,400,000","c42":"10,500,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (64, 'TT0106', 'Đỗ Xuân Nức', 'K2', 'BCH RICO', 'Nhân viên bảo vệ', 'L1', 'E1', 'D3', 5300000, 3200000, 100000, 100000, 0, 2600000, 0, 11300000, 5400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"59","c1":"TT0106","c2":"Đỗ Xuân Nức","c3":"Nam","c4":"21/12/1960","c5":"034060014319","c6":"29/09/2021","c7":"Thôn Vĩnh Ninh, xã Tây Ninh,  Tiền Hải, Thái Bình","c8":"Xã Bình Thanh, huyện Kiến Xương, tỉnh Thái Bình","c9":"0399639069","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Nhân viên bảo vệ","c15":"L1","c16":"NV","c17":"LĐPT","c18":"05/09/2025","c19":"06/10/2025","c20":"8","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"8,000,000","c27":"-","c28":"8,000,000","c29":"","c30":"500,000","c31":"8,500,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc D3","c41":"3,200,000","c42":"11,300,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (65, 'TT0072', 'Dương Xuân Như', 'K2', 'BCH RICO', 'Nhân viên Vật tư', 'L2', 'E2', 'C1', 5400000, 5100000, 200000, 200000, 0, 2600000, 0, 13500000, 5600000, 'excel_seed', 'warning', 'needs_review', '["Chức danh chưa có trong danh mục - cần bổ sung/chọn lại"]'::jsonb, '[]'::jsonb, '{"c0":"60","c1":"TT0072","c2":"Dương Xuân Như","c3":"Nam","c4":"11/10/1973","c5":"034073004462","c6":"24/04/2021","c7":"Thôn A Mễ, Trang Bảo Xá, Quỳnh Phụ, Thái Bình","c8":"Thôn A Mễ, Trang Bảo Xá, Quỳnh Phụ, Thái Bình","c9":"0382676874","c10":"BCH CT RICO","c11":"BCH CT RICO","c12":"K2","c13":"BCH RICO","c14":"Nhân viên Vật tư","c15":"L2","c16":"NV","c17":"LĐPT","c18":"03/02/2025","c19":"03/02/2025","c20":"17","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"8,000,000","c27":"2,000,000","c28":"10,000,000","c29":"","c30":"500,000","c31":"10,500,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc C1","c41":"5,100,000","c42":"13,500,000","c43":"5,600,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"Chức danh chưa có trong danh mục - cần bổ sung/chọn lại","c48":"","c49":""}'::jsonb),
  (66, 'TT0083', 'Phạm Ngọc Sơn', 'K2', 'BCH SMB', 'Chỉ huy phó BCH SMB', 'L7', 'E7', 'B4', 7600000, 17300000, 650000, 650000, 0, 2600000, 0, 28800000, 8250000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"61","c1":"TT0083","c2":"Phạm Ngọc Sơn","c3":"Nam","c4":"18/08/1986","c5":"034086009634","c6":"01/03/2022","c7":"Nam Trung, Tiền Hải, Thái Bình","c8":"Nam Trung, Tiền Hải, Thái Bình","c9":"0978330729","c10":"BCH CT Sơn miền bắc","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH SMB","c14":"Chỉ huy phó BCH SMB","c15":"L7","c16":"QLCT","c17":"Đại học","c18":"16/06/2025","c19":"17/07/2025","c20":"11","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"18,000,000","c27":"5,000,000","c28":"23,000,000","c29":"","c30":"1,900,000","c31":"24,900,000","c32":"7,600,000","c33":"650,000","c34":"650,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc B4","c41":"17,300,000","c42":"28,800,000","c43":"8,250,000","c44":"Chưa tham gia","c45":"","c46":"10/03/2026","c47":"","c48":"","c49":""}'::jsonb),
  (67, 'TT0098', 'Phạm Văn Thành', 'K2', 'BCH SMB', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'B3', 6600000, 13700000, 450000, 450000, 0, 2600000, 0, 23800000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"62","c1":"TT0098","c2":"Phạm Văn Thành","c3":"Nam","c4":"13/02/1985","c5":"034085019086","c6":"14/02/2025","c7":"Tổ 4, Đông Hưng, Hưng Yên","c8":"Tổ 4, Đông Hưng, Hưng Yên","c9":"0987215665","c10":"BCH CT Sơn miền bắc","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH SMB","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Đại học","c18":"11/09/2025","c19":"01/10/2025","c20":"9","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"18,000,000","c27":"2,000,000","c28":"20,000,000","c29":"","c30":"300,000","c31":"20,300,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc B3","c41":"13,700,000","c42":"23,800,000","c43":"7,050,000","c44":"Chưa tham gia","c45":"","c46":"01/05/2026","c47":"","c48":"","c49":""}'::jsonb),
  (68, 'TT0125', 'Trần Văn Khôi', 'K2', 'BCH SMB', 'Cán bộ Trắc đạc', 'L5', 'E5', 'A1', 6600000, 17300000, 450000, 450000, 0, 2600000, 0, 27400000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"63","c1":"TT0125","c2":"Trần Văn Khôi","c3":"Nam","c4":"09/09/1991","c5":"033091006316","c6":"14/04/2021","c7":"Xã Tiên Tiến, Tỉnh Hưng Yên","c8":"Xóm Chúc, Thôn Phù Oanh, Xã Tiên Tiến, Tỉnh Hưng Yên","c9":"0383115823","c10":"BCH CT Sơn miền bắc","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH SMB","c14":"Cán bộ Trắc đạc","c15":"L5","c16":"CV","c17":"Đại học","c18":"16/05/2026","c19":"16/07/2026","c20":"-","c21":"Thử việc","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"25,000,000","c27":"-","c28":"25,000,000","c29":"","c30":"(1,100,000)","c31":"23,900,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc A1","c41":"17,300,000","c42":"27,400,000","c43":"7,050,000","c44":"","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (69, 'TT0123', 'Nguyễn Văn Luật', 'K2', 'BCH SMB', 'Trợ lý dự án', 'L3', 'E3', 'B2', 5500000, 10300000, 300000, 300000, 0, 2600000, 0, 19000000, 5800000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"64","c1":"TT0123","c2":"Nguyễn Văn Luật","c3":"Nam","c4":"20/01/1984","c5":"033084012959","c6":"04/08/2025","c7":"Hoàn Long, Hưng Yên","c8":"Thôn Đại Hành, Hoàn Long, Hưng Yên","c9":"0394234825","c10":"BCH CT Sơn miền bắc","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH SMB","c14":"Trợ lý dự án","c15":"L3","c16":"NV","c17":"Đại học","c18":"10/04/2026","c19":"10/06/2026","c20":"-","c21":"Thử việc","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"-","c28":"15,000,000","c29":"","c30":"800,000","c31":"15,800,000","c32":"5,500,000","c33":"300,000","c34":"300,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc B2","c41":"10,300,000","c42":"19,000,000","c43":"5,800,000","c44":"","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (70, 'TT0010', 'Dương Xuân Nhung', 'K2', 'BCH SMB', 'Nhân viên Thủ kho', 'L2', 'E2', 'B2', 5400000, 10100000, 200000, 200000, 0, 2600000, 900000, 19400000, 6500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"65","c1":"TT0010","c2":"Dương Xuân Nhung","c3":"Nam","c4":"19/02/1973","c5":"034073006062","c6":"21/12/2017","c7":"Xóm 5, Khang Ninh, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c8":"Xóm 5, Khang Ninh, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0352532016","c10":"BCH CT Sơn miền bắc","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH SMB","c14":"Nhân viên Thủ kho","c15":"L2","c16":"NV","c17":"LĐPT","c18":"01/12/2015","c19":"01/12/2015","c20":"127","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"2,000,000","c28":"15,000,000","c29":"","c30":"500,000","c31":"15,500,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"900,000","c40":"Bậc B2","c41":"10,100,000","c42":"19,400,000","c43":"6,500,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (71, 'TT0085', 'Bùi Khắc Tho', 'K2', 'BCH SMB', 'Nhân viên bảo vệ', 'L1', 'E1', 'D4', 5300000, 4000000, 100000, 100000, 0, 2600000, 0, 12100000, 5400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"66","c1":"TT0085","c2":"Bùi Khắc Tho","c3":"Nam","c4":"13/06/1965","c5":"034065019865","c6":"31/12/2021","c7":"Quỳnh Trang, Quỳnh Phụ, Thái Bình","c8":"Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0397792896","c10":"BCH CT Sơn miền bắc","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH SMB","c14":"Nhân viên bảo vệ","c15":"L1","c16":"NV","c17":"LĐPT","c18":"09/06/2025","c19":"09/07/2025","c20":"11","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"8,000,000","c27":"1,000,000","c28":"9,000,000","c29":"","c30":"300,000","c31":"9,300,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc D4","c41":"4,000,000","c42":"12,100,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (72, 'TT0084', 'Dương Công Quý', 'K2', 'BCH SMB', 'Nhân viên bảo vệ', 'L1', 'E1', 'C4', 5300000, 7800000, 100000, 100000, 0, 2600000, 0, 15900000, 5400000, 'excel_seed', 'warning', 'needs_review', '["Trùng tên trong DS nghỉ việc 2026 - cần xác minh; Chức danh chưa có trong danh mục - cần bổ sung/chọn lại"]'::jsonb, '[]'::jsonb, '{"c0":"67","c1":"TT0084","c2":"Dương Công Quý","c3":"Nam","c4":"15/07/1982","c5":"034082024952","c6":"16/12/2024","c7":"Trung cấp","c8":"","c9":"0338699666","c10":"BCH CT Sơn miền bắc","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH SMB","c14":"Nhân viên bảo vệ","c15":"L1","c16":"NV","c17":"Trung cấp","c18":"16/06/2025","c19":"17/07/2025","c20":"11","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"01/04/2026-28/5/2026 nghỉ dưỡng bệnh; Sức khoẻ không đảm bảo","c26":"13,000,000","c27":"-","c28":"13,000,000","c29":"5,100,000","c30":"100,000","c31":"13,100,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc C4","c41":"7,800,000","c42":"15,900,000","c43":"5,400,000","c44":"Tham gia","c45":"","c46":"","c47":"Trùng tên trong DS nghỉ việc 2026 - cần xác minh; Chức danh chưa có trong danh mục - cần bổ sung/chọn lại","c48":"","c49":""}'::jsonb),
  (73, 'TT0117', 'Nguyễn Chấp Việt', 'K2', 'BCH SMB', 'Kĩ thuật trưởng', 'L6', 'E6', 'B4', 7100000, 16200000, 550000, 550000, 0, 2600000, 0, 27000000, 7650000, 'excel_seed', 'warning', 'needs_review', '["Chức danh chưa có trong danh mục - cần bổ sung/chọn lại; BHXH: Sẽ tham gia từ T06/2026"]'::jsonb, '[]'::jsonb, '{"c0":"68","c1":"TT0117","c2":"Nguyễn Chấp Việt","c3":"Nam","c4":"28/02/1996","c5":"034095010946","c6":"01/09/2021","c7":"Quỳnh Giao, Quỳnh Phụ, Thái Bình","c8":"Thôn Bái Long, xã Minh Thọ, tỉnh Hưng Yên","c9":"0357179962","c10":"BCH CT Sơn miền bắc","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH SMB","c14":"Kĩ thuật trưởng","c15":"L6","c16":"QLN","c17":"Đại học","c18":"01/04/2026","c19":"01/06/2026","c20":"1","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"23,000,000","c27":"-","c28":"23,000,000","c29":"","c30":"300,000","c31":"23,300,000","c32":"7,100,000","c33":"550,000","c34":"550,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc B4","c41":"16,200,000","c42":"27,000,000","c43":"7,650,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"Chức danh chưa có trong danh mục - cần bổ sung/chọn lại; BHXH: Sẽ tham gia từ T06/2026","c48":"","c49":""}'::jsonb),
  (74, 'TT0071', 'Dương Thành Thắng', 'K2', 'BCH NT', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'B1', 6600000, 11100000, 450000, 450000, 0, 2600000, 100000, 21300000, 7150000, 'excel_seed', 'error', 'needs_review', '[]'::jsonb, '["Mã nhân sự TT0071 bị trùng trong file nguồn."]'::jsonb, '{"c0":"69","c1":"TT0071","c2":"Dương Thành Thắng","c3":"Nam","c4":"06/03/1989","c5":"082089018064","c6":"19/05/2023","c7":"271 Tổ 5 Ấp 5, Đạo Thạnh, Mỹ Tho, Tiền Giang.","c8":"271 Tổ 5 Ấp 5, Đạo Thạnh, Mỹ Tho, Tiền Giang.","c9":"0938823284","c10":"BCH CT Ninh Thuận","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH NT","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Cao đẳng","c18":"29/05/2024","c19":"29/06/2024","c20":"24","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"2,000,000","c28":"17,000,000","c29":"5,100,000","c30":"700,000","c31":"17,700,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"100,000","c40":"Bậc B1","c41":"11,100,000","c42":"21,300,000","c43":"7,150,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (75, 'TT0071', 'Nguyễn Thị Mỹ Huệ', 'K2', 'BCH NT', 'Trợ lý dự án', 'L3', 'E3', 'C1', 5500000, 5200000, 300000, 300000, 0, 2600000, 0, 13900000, 5800000, 'excel_seed', 'error', 'needs_review', '[]'::jsonb, '["Mã nhân sự TT0071 bị trùng trong file nguồn."]'::jsonb, '{"c0":"70","c1":"TT0071","c2":"Nguyễn Thị Mỹ Huệ","c3":"Nữ","c4":"19/11/1997","c5":"058197000731","c6":"16/04/2021","c7":"Thôn Mỹ Nhơn, Bắc Phong, Thuận Bắc, Ninh Thuận.","c8":"Thôn Mỹ Nhơn, Bắc Phong, Thuận Bắc, Ninh Thuận.","c9":"0332715690","c10":"BCH CT Ninh Thuận","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH NT","c14":"Trợ lý dự án","c15":"L3","c16":"NV","c17":"Cao đẳng","c18":"23/12/2024","c19":"23/12/2024","c20":"18","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"9,500,000","c27":"500,000","c28":"10,000,000","c29":"5,100,000","c30":"700,000","c31":"10,700,000","c32":"5,500,000","c33":"300,000","c34":"300,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"0","c40":"Bậc C1","c41":"5,200,000","c42":"13,900,000","c43":"5,800,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (76, 'TT0065', 'Nguyễn Ngọc Đức (1)', 'K2', 'BCH NT', 'Nhân viên bảo vệ', 'L1', 'E1', 'C1', 5300000, 5000000, 100000, 100000, 0, 2600000, 100000, 13200000, 5500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"71","c1":"TT0065","c2":"Nguyễn Ngọc Đức (1)","c3":"Nam","c4":"01/01/1974","c5":"058074004452","c6":"02/07/2021","c7":"Thôn Gò Sạn, Bắc Phong, Thuận Bắc, Ninh Thuận","c8":"Thôn Gò Sạn, Bắc Phong, Thuận Bắc, Ninh Thuận","c9":"0935667770","c10":"BCH CT Ninh Thuận","c11":"BCH CT Sơn miền bắc","c12":"K2","c13":"BCH NT","c14":"Nhân viên bảo vệ","c15":"L1","c16":"NV","c17":"LĐPT","c18":"04/04/2024","c19":"04/04/2024","c20":"27","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"8,000,000","c27":"2,000,000","c28":"10,000,000","c29":"","c30":"300,000","c31":"10,300,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"100,000","c40":"Bậc C1","c41":"5,000,000","c42":"13,200,000","c43":"5,500,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (77, 'TT0057', 'Bùi Văn Thức', 'K2', 'BCH RC', 'Nhân viên bảo vệ', 'L1', 'E1', 'D4', 5300000, 4000000, 100000, 100000, 0, 2600000, 100000, 12200000, 5500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"72","c1":"TT0057","c2":"Bùi Văn Thức","c3":"Nam","c4":"20/10/1966","c5":"034066003014","c6":"01/09/2016","c7":"Quỳnh Hưng, Quỳnh Phụ, Thái Bình","c8":"Quỳnh Hưng, Quỳnh Phụ, Thái Bình","c9":"0342611597","c10":"BCH CT Richain","c11":"BCH CT RICHAIN","c12":"K2","c13":"BCH RC","c14":"Nhân viên bảo vệ","c15":"L1","c16":"NV","c17":"LĐPT","c18":"19/09/2023","c19":"19/10/2023","c20":"32","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"8,000,000","c27":"1,000,000","c28":"9,000,000","c29":"","c30":"300,000","c31":"9,300,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"2,600,000","c39":"100,000","c40":"Bậc D4","c41":"4,000,000","c42":"12,200,000","c43":"5,500,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (79, 'TT0047', 'Nguyễn Hồng Quân', 'K3', 'VPNM', 'Phó giám đốc NMSXKCT', 'L7', 'E7', 'C2', 7600000, 8500000, 650000, 650000, 0, 650000, 200000, 18250000, 8450000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"73","c1":"TT0047","c2":"Nguyễn Hồng Quân","c3":"Nam","c4":"03/02/1983","c5":"034083013754","c6":"10/04/2014","c7":"Xã Vũ Ninh, huyện Kiến Xương, Thái Bình","c8":"Xã Vũ Ninh, huyện Kiến Xương, Thái Bình","c9":"0904473161","c10":"VPNM","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Phó giám đốc NMSXKCT","c15":"L7","c16":"QLCT","c17":"Đại học","c18":"06/02/2023","c19":"06/02/2023","c20":"40","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"12,500,000","c27":"3,500,000","c28":"16,000,000","c29":"5,100,000","c30":"100,000","c31":"16,100,000","c32":"7,600,000","c33":"650,000","c34":"650,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc C2","c41":"8,500,000","c42":"18,250,000","c43":"8,450,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (80, 'TT0004', 'Vũ Văn Dân', 'K3', 'VPNM', 'Quản đốc nhà máy', 'L5', 'E5', 'B2', 6600000, 12400000, 450000, 450000, 0, 650000, 1000000, 21550000, 8050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"74","c1":"TT0004","c2":"Vũ Văn Dân","c3":"Nam","c4":"12/08/1975","c5":"034075002814","c6":"13/08/2021","c7":"Hưng Đạo Tây, Đông Quang, Đông Hưng, Thái Bình","c8":"Hưng Đạo Tây, Đông Quang, Đông Hưng, Thái Bình","c9":"0943600676","c10":"VPNM","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Quản đốc nhà máy","c15":"L5","c16":"QLN","c17":"LĐPT","c18":"01/01/2012","c19":"01/01/2012","c20":"174","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"3,000,000","c28":"18,000,000","c29":"5,100,000","c30":"1,000,000","c31":"19,000,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"1,000,000","c40":"Bậc B2","c41":"12,400,000","c42":"21,550,000","c43":"8,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (81, 'TT0058', 'Phạm Đình Dương', 'K3', 'VPNM', 'Chuyên viên Thiết kế (theo bộ môn)', 'L5', 'E5', 'C2', 6600000, 7400000, 450000, 450000, 0, 650000, 100000, 15650000, 7150000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"75","c1":"TT0058","c2":"Phạm Đình Dương","c3":"Nam","c4":"10/05/1991","c5":"034091017587","c6":"17/09/2021","c7":"Thôn Nội - Minh Khai – Vũ Thư – Thái Bình.","c8":"Thôn Nội - Minh Khai – Vũ Thư – Thái Bình.","c9":"0977123859","c10":"VPNM","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Chuyên viên Thiết kế (theo bộ môn)","c15":"L5","c16":"CV","c17":"Đại học","c18":"15/09/2023","c19":"15/10/2023","c20":"32","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"1,000,000","c28":"14,000,000","c29":"5,100,000","c30":"-","c31":"14,000,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc C2","c41":"7,400,000","c42":"15,650,000","c43":"7,150,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (82, 'TT0086', 'Hoàng Văn Tú', 'K3', 'VPNM', 'Chuyên viên kĩ thuật', 'L5', 'E5', 'C3', 6600000, 8600000, 450000, 450000, 0, 650000, 0, 16750000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"76","c1":"TT0086","c2":"Hoàng Văn Tú","c3":"Nam","c4":"18/07/1979","c5":"017079006796","c6":"25/09/2022","c7":"Ninh Sơn, Xuất Hoá, Lạc Sơn, Hoà Bình","c8":"Vũ Phúc, Thái Bình","c9":"0972534534","c10":"VPNM","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Chuyên viên kĩ thuật","c15":"L5","c16":"CV","c17":"Đại học","c18":"09/06/2025","c19":"09/07/2025","c20":"11","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"12,000,000","c27":"3,000,000","c28":"15,000,000","c29":"5,100,000","c30":"200,000","c31":"15,200,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc C3","c41":"8,600,000","c42":"16,750,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (83, 'TT0100', 'Trần Khắc Quang', 'K3', 'VPNM', 'Cán bộ KCS', 'L4', 'E4', 'B1', 6000000, 10100000, 350000, 350000, 0, 650000, 0, 17450000, 6350000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"77","c1":"TT0100","c2":"Trần Khắc Quang","c3":"Nam","c4":"10/06/1987","c5":"035087002591","c6":"14/08/2021","c7":"Tổ 4, Hoà Hậu, Lý Nhân, Hà Nam","c8":"Tổ 4, Hoà Hậu, Lý Nhân, Hà Nam","c9":"0986137371","c10":"VPNM","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Cán bộ KCS","c15":"L4","c16":"CV","c17":"Đại học","c18":"26/06/2025","c19":"15/09/2025","c20":"9","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"15,000,000","c27":"-","c28":"15,000,000","c29":"5,100,000","c30":"1,100,000","c31":"16,100,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc B1","c41":"10,100,000","c42":"17,450,000","c43":"6,350,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (84, 'TT0005', 'Bùi Gia Tằng', 'K3', 'VPNM', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 1000000, 8750000, 6400000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"78","c1":"TT0005","c2":"Bùi Gia Tằng","c3":"Nam","c4":"08/08/1968","c5":"034068007466","c6":"25/04/2021","c7":"Xóm 4 Khang Ninh, Quỳnh Trang, Quỳnh Phụ, TB","c8":"Xóm 4 Khang Ninh, Quỳnh Trang, Quỳnh Phụ, TB","c9":"0386183850","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"06/04/2014","c19":"06/04/2014","c20":"146","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"320,000","c27":"-","c28":"320,000","c29":"","c30":"6,580,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"1,000,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,750,000","c43":"6,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (85, 'TT0006', 'Bùi Văn Nặc', 'K3', 'VPNM', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 1000000, 8750000, 6400000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"79","c1":"TT0006","c2":"Bùi Văn Nặc","c3":"Nam","c4":"01/01/1970","c5":"034070022861","c6":"18/05/2023","c7":"Khang Ninh, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c8":"Khang Ninh, Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0394652879","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"01/05/2014","c19":"01/05/2014","c20":"146","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"320,000","c27":"-","c28":"320,000","c29":"","c30":"6,580,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"1,000,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,750,000","c43":"6,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (86, 'TT0026', 'Hoàng Quốc Đạt', 'K3', 'VPNM', 'Nhân viên bảo vệ', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 600000, 8350000, 6000000, 'excel_seed', 'warning', 'needs_review', '["Chức danh chưa có trong danh mục - cần bổ sung/chọn lại"]'::jsonb, '[]'::jsonb, '{"c0":"80","c1":"TT0026","c2":"Hoàng Quốc Đạt","c3":"Nam","c4":"07/06/1971","c5":"034071003870","c6":"31/10/2016","c7":"Tân Lập, Vũ Thư, Thái Bình","c8":"Tân Lập, Vũ Thư, Thái Bình","c9":"0705785909","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Nhân viên bảo vệ","c15":"L1","c16":"NV","c17":"Đại học","c18":"01/04/2019","c19":"01/04/2019","c20":"87","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"320,000","c27":"-","c28":"320,000","c29":"","c30":"6,580,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"600,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,350,000","c43":"6,000,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"Chức danh chưa có trong danh mục - cần bổ sung/chọn lại","c48":"","c49":""}'::jsonb),
  (87, 'TT0042', 'Nguyễn Văn Quân', 'K3', 'VPNM', 'Nhân viên Vật tư', 'L2', 'E2', 'C2', 5400000, 6000000, 200000, 200000, 0, 650000, 200000, 12650000, 5800000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"81","c1":"TT0042","c2":"Nguyễn Văn Quân","c3":"Nam","c4":"22/12/1987","c5":"034087015789","c6":"24/06/2021","c7":"Đồng Cừ, Đông Hải, Quỳnh Phụ, Thái Bình","c8":"Đồng Cừ, Đông Hải, Quỳnh Phụ, Thái Bình","c9":"0979649411","c10":"VPNM","c11":"Nhà máy sản xuất","c12":"K3","c13":"VPNM","c14":"Nhân viên Vật tư","c15":"L2","c16":"NV","c17":"Trung cấp","c18":"22/09/2022","c19":"22/09/2022","c20":"45","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"9,000,000","c27":"2,000,000","c28":"11,000,000","c29":"5,100,000","c30":"400,000","c31":"11,400,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc C2","c41":"6,000,000","c42":"12,650,000","c43":"5,800,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (88, 'TT0009', 'Vũ Xuân Hiếu', 'K3', 'TSX-PC', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 900000, 8650000, 6300000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"82","c1":"TT0009","c2":"Vũ Xuân Hiếu","c3":"Nam","c4":"23/02/1990","c5":"036090005243","c6":"26/05/2017","c7":"Xóm 7, Xuân Châu, Xuân Trường, Nam Định","c8":"Xóm 7, Xuân Châu, Xuân Trường, Nam Định","c9":"0976880626","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Cao đẳng","c18":"01/08/2015","c19":"01/08/2015","c20":"131","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"370,000","c27":"-","c28":"370,000","c29":"5,100,000","c30":"6,530,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"900,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,650,000","c43":"6,300,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (89, 'TT0024', 'Đinh Văn Giao', 'K3', 'TSX-PC', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 600000, 8350000, 6000000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"83","c1":"TT0024","c2":"Đinh Văn Giao","c3":"Nam","c4":"25/12/1974","c5":"034074003656","c6":"26/07/2016","c7":"Thôn 1, Vũ Thắng, Kiến Xương, Thái Bình","c8":"Thôn 1, Vũ Thắng, Kiến Xương, Thái Bình","c9":"0795365665","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"02/03/2019","c19":"02/03/2019","c20":"88","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"320,000","c27":"-","c28":"320,000","c29":"","c30":"6,580,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"600,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,350,000","c43":"6,000,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (90, 'TT0044', 'Phạm Văn Đông', 'K3', 'TSX-PC', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 200000, 7950000, 5600000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"84","c1":"TT0044","c2":"Phạm Văn Đông","c3":"Nam","c4":"05/04/1975","c5":"034075002474","c6":"12/08/2021","c7":"Phú lạc, Phú Xuân, Tp.Thái Bình.","c8":"Phú lạc, Phú Xuân, Tp.Thái Bình.","c9":"0916103019","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"05/09/2022","c19":"05/09/2022","c20":"46","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"320,000","c27":"-","c28":"320,000","c29":"5,100,000","c30":"6,580,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,950,000","c43":"5,600,000","c44":"Tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (91, 'TT0045', 'Bùi Khắc Dương', 'K3', 'TSX-PC', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 200000, 7950000, 5600000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"85","c1":"TT0045","c2":"Bùi Khắc Dương","c3":"Nam","c4":"28/10/1970","c5":"034070020178","c6":"16/09/2021","c7":"Quỳnh Trang, Quỳnh Phụ, Thái Bình","c8":"Quỳnh Trang, Quỳnh Phụ, Thái Bình","c9":"0373077171","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"07/10/2022","c19":"07/10/2022","c20":"44","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"320,000","c27":"-","c28":"320,000","c29":"","c30":"6,580,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,950,000","c43":"5,600,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (92, 'TT0049', 'Bùi Văn Bái', 'K3', 'TSX-PC', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 200000, 7950000, 5600000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"86","c1":"TT0049","c2":"Bùi Văn Bái","c3":"Nam","c4":"01/10/1977","c5":"034077017913","c6":"10/08/2021","c7":"Xã Minh Quang, huyện Vũ Thư, tỉnh Thái Bình","c8":"Xã Minh Quang, huyện Vũ Thư, tỉnh Thái Bình","c9":"0325206578","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"16/03/2023","c19":"16/03/2023","c20":"39","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"320,000","c27":"-","c28":"320,000","c29":"","c30":"6,580,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,950,000","c43":"5,600,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (93, 'TT0052', 'Hồ Sỹ Thanh', 'K3', 'TSX-PC', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 200000, 7950000, 5600000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"87","c1":"TT0052","c2":"Hồ Sỹ Thanh","c3":"Nam","c4":"01/06/1983","c5":"034083005780","c6":"04/12/2023","c7":"Việt Thuận, Vũ Thư, Thái Bình","c8":"Việt Thuận, Vũ Thư, Thái Bình","c9":"0963387865","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"03/07/2023","c19":"03/07/2023","c20":"36","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"350,000","c27":"-","c28":"350,000","c29":"5,100,000","c30":"6,550,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,950,000","c43":"5,600,000","c44":"Tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (94, 'TT0075', 'Trần Tiến Hải', 'K3', 'TSX-PC', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"88","c1":"TT0075","c2":"Trần Tiến Hải","c3":"Nam","c4":"30/06/1996","c5":"034096007523","c6":"30/03/2021","c7":"Phúc Khánh, Vũ Phúc, TP.Thái Bình","c8":"Phúc Khánh, Vũ Phúc, TP.Thái Bình","c9":"0962816596","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"10/03/2025","c19":"10/03/2025","c20":"15","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"340,000","c27":"-","c28":"340,000","c29":"5,100,000","c30":"6,560,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (95, 'TT0077', 'Lê Văn Hiếu', 'K3', 'TSX-PC', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"89","c1":"TT0077","c2":"Lê Văn Hiếu","c3":"Nam","c4":"20/04/1989","c5":"034089010224","c6":"31/12/2021","c7":"Vũ Thắng, Kiến Xương, Thái Bình","c8":"Vũ Thắng, Kiến Xương, Thái Bình","c9":"0795339004","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"17/03/2025","c19":"17/03/2025","c20":"15","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"350,000","c27":"-","c28":"350,000","c29":"5,100,000","c30":"6,550,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (96, 'TT0109', 'Bùi Học Đương', 'K3', 'TSX-PC', 'Công nhân bốc xếp', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"90","c1":"TT0109","c2":"Bùi Học Đương","c3":"Nam","c4":"30/08/1974","c5":"030074020049","c6":"02/10/2021","c7":"Tân Hoà, Vũ Thư, Thái Bình","c8":"Tân Hoà, Vũ Thư, Thái Bình","c9":"0971253867","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân bốc xếp","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"07/11/2025","c19":"07/11/2025","c20":"7","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"320,000","c27":"-","c28":"320,000","c29":"","c30":"6,580,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (97, 'TT0114', 'Nguyễn Chí Hiểu', 'K3', 'TSX-PC', 'Công nhân hàn/gá', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"91","c1":"TT0114","c2":"Nguyễn Chí Hiểu","c3":"Nam","c4":"01/03/1985","c5":"034085017704","c6":"27/05/2023","c7":"Số nhà 12, tổ 1, phường Trần Lãm, tỉnh Hưng Yên","c8":"Thôn trình Uyên, Quỳnh Nguyên, Quỳnh Phụ, Thái Bình","c9":"0392020469","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-PC","c14":"Công nhân hàn/gá","c15":"L1","c16":"CN","c17":"LĐPT","c18":"15/12/2025","c19":"15/12/2025","c20":"6","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"300,000","c27":"-","c28":"300,000","c29":"5,100,000","c30":"6,600,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (98, 'TT0107', 'Đoàn Tất Dỵ', 'K3', 'TSX-LR', 'Thợ điện', 'L2', 'E2', 'C3', 5400000, 7000000, 200000, 200000, 0, 650000, 0, 13450000, 5600000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề; Chức danh chưa có trong danh mục - cần bổ sung/chọn lại"]'::jsonb, '[]'::jsonb, '{"c0":"92","c1":"TT0107","c2":"Đoàn Tất Dỵ","c3":"Nam","c4":"16/02/1989","c5":"034089020079","c6":"16/09/2021","c7":"Việt Tiến, Vũ Vinh, Kiến Xương Thái Bình","c8":"Thư Vũ, Hưng Yên","c9":"0904315868","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-LR","c14":"Thợ điện","c15":"L2","c16":"NV","c17":"Đại học","c18":"01/10/2025","c19":"01/11/2025","c20":"8","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"11,000,000","c27":"1,000,000","c28":"12,000,000","c29":"","c30":"400,000","c31":"12,400,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc C3","c41":"7,000,000","c42":"13,450,000","c43":"5,600,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề; Chức danh chưa có trong danh mục - cần bổ sung/chọn lại","c48":"","c49":""}'::jsonb),
  (99, 'TT0015', 'Nguyễn Quốc Việt', 'K3', 'TSX-LR', 'Công nhân hàn/gá', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 800000, 8550000, 6200000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"93","c1":"TT0015","c2":"Nguyễn Quốc Việt","c3":"Nam","c4":"30/04/1980","c5":"034080003373","c6":"15/03/2016","c7":"Tổ 17, phường Phú Khánh, TP Thái Bình","c8":"Tổ 17, phường Phú Khánh, TP Thái Bình","c9":"0912461889","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-LR","c14":"Công nhân hàn/gá","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"01/08/2016","c19":"01/08/2016","c20":"119","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"370,000","c27":"-","c28":"370,000","c29":"5,100,000","c30":"6,530,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"800,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,550,000","c43":"6,200,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (100, 'TT0023', 'Vũ Quang Long', 'K3', 'TSX-LR', 'Công nhân hàn/gá', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 700000, 8450000, 6100000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"94","c1":"TT0023","c2":"Vũ Quang Long","c3":"Nam","c4":"10/04/1978","c5":"151169109","c6":"16/04/2014","c7":"thôn Duy Tân, xã Minh Tân, Đông Hưng, Thái Bình","c8":"thôn Duy Tân, xã Minh Tân, Đông Hưng, Thái Bình","c9":"0342947423","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-LR","c14":"Công nhân hàn/gá","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"11/06/2018","c19":"11/06/2018","c20":"96","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"350,000","c27":"-","c28":"350,000","c29":"","c30":"6,550,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"700,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,450,000","c43":"6,100,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (101, 'TT0053', 'Lê Hồng Quang', 'K3', 'TSX-LR', 'Công nhân hàn/hoàn thiện', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 200000, 7950000, 5600000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"95","c1":"TT0053","c2":"Lê Hồng Quang","c3":"Nam","c4":"29/12/1978","c5":"034078008822","c6":"25/08/2021","c7":"Dũng Nghĩa, Vũ Thư, Thái Bình","c8":"Dũng Nghĩa, Vũ Thư, Thái Bình","c9":"0962640289","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-LR","c14":"Công nhân hàn/hoàn thiện","c15":"L1","c16":"CN","c17":"Trung cấp","c18":"04/07/2023","c19":"04/07/2023","c20":"36","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"350,000","c27":"-","c28":"350,000","c29":"5,100,000","c30":"6,550,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,950,000","c43":"5,600,000","c44":"Tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (102, 'TT0110', 'Phan Huy Tuấn', 'K3', 'TSX-LR', 'Công nhân hàn/gá', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'warning', 'needs_review', '["NM - chưa rõ tổ SX, cần phân loại theo nghề"]'::jsonb, '[]'::jsonb, '{"c0":"96","c1":"TT0110","c2":"Phan Huy Tuấn","c3":"Nam","c4":"02/09/1974","c5":"034074023720","c6":"04/03/2022","c7":"TDP Tân An, P.Vũ Phúc, tỉnh Hưng Yên","c8":"TDP Tân An, P.Vũ Phúc, tỉnh Hưng Yên","c9":"0987924753","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-LR","c14":"Công nhân hàn/gá","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"26/11/2025","c19":"26/11/2025","c20":"7","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"330,000","c27":"-","c28":"330,000","c29":"","c30":"6,570,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"NM - chưa rõ tổ SX, cần phân loại theo nghề","c48":"","c49":""}'::jsonb),
  (103, 'TT0128', 'Trịnh Văn Cánh', 'K3', 'TSX-LR', 'Công nhân hàn/hoàn thiện', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'warning', 'needs_review', '["BHXH: Sẽ tham gia từ T07/2026"]'::jsonb, '[]'::jsonb, '{"c0":"97","c1":"TT0128","c2":"Trịnh Văn Cánh","c3":"Nam","c4":"16/01/1988","c5":"034088002233","c6":"","c7":"Bách Thuận, Vũ Thư, Thái Bình","c8":"Xóm 3, Tân Thuận, Vũ Thư, TB","c9":"395707354","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-LR","c14":"Công nhân hàn/hoàn thiện","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"11/05/2026","c19":"18/05/2026","c20":"1","c21":"12T","c22":"","c23":"Đang làm","c24":"","c25":"Chưa có dữ liệu lương trong nguồn; Ngày cấp CCCD nguồn lỗi (trùng ngày sinh)","c26":"","c27":"","c28":"-","c29":"","c30":"6,900,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"BHXH: Sẽ tham gia từ T07/2026","c48":"","c49":""}'::jsonb),
  (104, 'TT0011', 'Hoàng Thọ Thi', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 900000, 8650000, 6300000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"98","c1":"TT0011","c2":"Hoàng Thọ Thi","c3":"Nam","c4":"24/01/1983","c5":"034083011381","c6":"18/10/2018","c7":"Thôn Hội, Minh Khai, Vũ Thư, Thái Bình","c8":"Thôn Hội, Minh Khai, Vũ Thư, Thái Bình","c9":"0974399504","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"01/04/2016","c19":"01/04/2016","c20":"123","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"370,000","c27":"-","c28":"370,000","c29":"5,100,000","c30":"6,530,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"900,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,650,000","c43":"6,300,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (105, 'TT0031', 'Khổng Văn Nam', 'K3', 'TSX-HH', 'Công nhân sơn', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 400000, 8150000, 5800000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"99","c1":"TT0031","c2":"Khổng Văn Nam","c3":"Nam","c4":"06/10/1987","c5":"230737434","c6":"13/12/2004","c7":"Xóm 3 thôn Hiệp Trung, Đông Hòa, TP Thái Bình, Tỉnh Thái Bình","c8":"Xóm 3 thôn Hiệp Trung, Đông Hòa, TP Thái Bình, Tỉnh Thái Bình","c9":"0387676041","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân sơn","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"22/03/2021","c19":"22/03/2021","c20":"63","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"330,000","c27":"-","c28":"330,000","c29":"5,100,000","c30":"6,570,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"400,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,150,000","c43":"5,800,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (106, 'TT0037', 'Nguyễn Văn Hợi', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 300000, 8050000, 5700000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"100","c1":"TT0037","c2":"Nguyễn Văn Hợi","c3":"Nam","c4":"03/07/1978","c5":"034078003996","c6":"19/08/2021","c7":"thôn Tam Lạc 2, xã Vũ Lạc, thành phố Thái Bình, tỉnh Thái Bình","c8":"thôn Tam Lạc 2, xã Vũ Lạc, thành phố Thái Bình, tỉnh Thái Bình","c9":"0363642359","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"05/04/2022","c19":"05/04/2022","c20":"51","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"360,000","c27":"-","c28":"360,000","c29":"5,100,000","c30":"6,540,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"300,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,050,000","c43":"5,700,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (107, 'TT0039', 'Phạm Tô Hoài', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 300000, 8050000, 5700000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"101","c1":"TT0039","c2":"Phạm Tô Hoài","c3":"Nam","c4":"17/11/1982","c5":"034082025830","c6":"31/08/2021","c7":"Thôn Lộc Điền, xã Việt Hùng, huyện Vũ Thư, tỉnh Thái Bình","c8":"Thôn Lộc Điền, xã Việt Hùng, huyện Vũ Thư, tỉnh Thái Bình","c9":"0329764199","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"09/05/2022","c19":"09/05/2022","c20":"49","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"360,000","c27":"-","c28":"360,000","c29":"5,100,000","c30":"6,540,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"300,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,050,000","c43":"5,700,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (108, 'TT0040', 'Cao Thanh Sáng', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 300000, 8050000, 5700000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"102","c1":"TT0040","c2":"Cao Thanh Sáng","c3":"Nam","c4":"09/11/1980","c5":"034080006627","c6":"21/04/2022","c7":"thôn Kênh Đào, xã Hồng Phong, huyện Vũ Thư, tỉnh Thái Bình","c8":"thôn Kênh Đào, xã Hồng Phong, huyện Vũ Thư, tỉnh Thái Bình","c9":"0384197046","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"13/06/2022","c19":"13/06/2022","c20":"48","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"360,000","c27":"-","c28":"360,000","c29":"","c30":"6,540,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"300,000","c40":"Bậc D1","c41":"1,600,000","c42":"8,050,000","c43":"5,700,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (109, 'TT0048', 'Ngô Quốc Hảo', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 200000, 7950000, 5600000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"103","c1":"TT0048","c2":"Ngô Quốc Hảo","c3":"Nam","c4":"04/04/1981","c5":"034081000184","c6":"09/05/2021","c7":"Thôn Thanh Bản 1, xã Xuân Hòa, huyện Vũ Thư, tỉnh Thái Bình","c8":"Thôn Thanh Bản 1, xã Xuân Hòa, huyện Vũ Thư, tỉnh Thái Bình","c9":"0586618618","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"20/02/2023","c19":"20/02/2023","c20":"40","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"350,000","c27":"-","c28":"350,000","c29":"5,100,000","c30":"6,550,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"200,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,950,000","c43":"5,600,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (110, 'TT0054', 'Nguyễn Anh Ngọc', 'K3', 'TSX-HH', 'Công nhân hàn/hoàn thiện', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 100000, 7850000, 5500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"104","c1":"TT0054","c2":"Nguyễn Anh Ngọc","c3":"Nam","c4":"10/04/1982","c5":"026082005753","c6":"19/12/2021","c7":"Thôn Đông Thành, Bình Minh, Kiến Xương, Thái Bình","c8":"Thôn Đông Thành, Bình Minh, Kiến Xương, Thái Bình","c9":"0396730082","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/hoàn thiện","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"13/09/2023","c19":"13/09/2023","c20":"33","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"360,000","c27":"-","c28":"360,000","c29":"5,100,000","c30":"6,540,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,850,000","c43":"5,500,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (111, 'TT0055', 'Mai Đại Lượng', 'K3', 'TSX-HH', 'Công nhân hàn/hoàn thiện', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 100000, 7850000, 5500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"105","c1":"TT0055","c2":"Mai Đại Lượng","c3":"Nam","c4":"10/10/1985","c5":"034085013496","c6":"26/11/2018","c7":"Thôn Năng An, Vũ Hội, Vũ Thư, Thái Bình","c8":"Thôn Năng An, Vũ Hội, Vũ Thư, Thái Bình","c9":"0987269158","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/hoàn thiện","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"25/09/2023","c19":"25/09/2023","c20":"33","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"360,000","c27":"-","c28":"360,000","c29":"5,100,000","c30":"6,540,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,850,000","c43":"5,500,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (112, 'TT0061', 'Đoàn Ngọc Hoan', 'K3', 'TSX-HH', 'Công nhân hàn/hoàn thiện', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 100000, 7850000, 5500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"106","c1":"TT0061","c2":"Đoàn Ngọc Hoan","c3":"Nam","c4":"27/03/1999","c5":"034099005916","c6":"23/02/2022","c7":"Thôn Ninh Thôn, Hòa Bình, Hưng Hà, Thái Bình","c8":"Thôn Ninh Thôn, Hòa Bình, Hưng Hà, Thái Bình","c9":"0778396978","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/hoàn thiện","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"07/11/2023","c19":"07/11/2023","c20":"31","c21":"KXĐ","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"350,000","c27":"-","c28":"350,000","c29":"5,100,000","c30":"6,550,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,850,000","c43":"5,500,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (113, 'TT0064', 'Trần Anh Hùng', 'K3', 'TSX-HH', 'Công nhân hàn/hoàn thiện', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 100000, 7850000, 5500000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"107","c1":"TT0064","c2":"Trần Anh Hùng","c3":"Nam","c4":"25/06/1994","c5":"034094016331","c6":"19/08/2021","c7":"Thượng Xuân, Bách Thuận, Vũ Thư, Thái Bình","c8":"Thượng Xuân, Bách Thuận, Vũ Thư, Thái Bình","c9":"0778396978","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/hoàn thiện","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"12/03/2024","c19":"12/03/2024","c20":"27","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"360,000","c27":"-","c28":"360,000","c29":"5,100,000","c30":"6,540,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"100,000","c40":"Bậc D1","c41":"1,600,000","c42":"7,850,000","c43":"5,500,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (114, 'TT0076', 'Nguyễn Hữu Luân', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"108","c1":"TT0076","c2":"Nguyễn Hữu Luân","c3":"Nam","c4":"14/10/1998","c5":"034098005478","c6":"08/04/2024","c7":"Tống Vũ, Vũ Chính, TP.Thái Bình","c8":"Tống Vũ, Vũ Chính, TP.Thái Bình","c9":"0976918248","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"10/03/2025","c19":"10/03/2025","c20":"15","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"360,000","c27":"-","c28":"360,000","c29":"5,100,000","c30":"6,540,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (115, 'TT0080', 'Nguyễn Quốc Huy', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"109","c1":"TT0080","c2":"Nguyễn Quốc Huy","c3":"Nam","c4":"30/10/1983","c5":"034083023247","c6":"13/07/2021","c7":"Tổ 21, phường Kỳ Bá, TP.Thái Bình","c8":"Tổ 21, phường Kỳ Bá, TP.Thái Bình","c9":"0973783980","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"21/05/2025","c19":"21/05/2025","c20":"13","c21":"KXĐ","c22":"21/05/2026","c23":"Đang làm","c24":"","c25":"","c26":"340,000","c27":"-","c28":"340,000","c29":"5,100,000","c30":"6,560,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (116, 'TT0111', 'Bùi Trung Đoàn', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"110","c1":"TT0111","c2":"Bùi Trung Đoàn","c3":"Nam","c4":"05/02/1980","c5":"034080006238","c6":"25/06/2020","c7":"Xã Vũ Quý, tỉnh Hưng Yên","c8":"Tổ 26, cụm 2, Quảng An, phường Hồng Hà, Hà Nội","c9":"0862065331","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"01/12/2025","c19":"01/12/2025","c20":"7","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"350,000","c27":"-","c28":"350,000","c29":"5,100,000","c30":"6,550,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (117, 'TT0129', 'Hà Văn Tùng', 'K3', 'TSX-HH', 'Công nhân hàn/cắt', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'warning', 'needs_review', '["Thiếu nhiều thông tin định danh; BHXH: Sẽ tham gia từ T05/2026"]'::jsonb, '[]'::jsonb, '{"c0":"111","c1":"TT0129","c2":"Hà Văn Tùng","c3":"Nam","c4":"","c5":"","c6":"","c7":"","c8":"","c9":"","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HH","c14":"Công nhân hàn/cắt","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"02/04/2026","c19":"09/04/2026","c20":"2","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"Thiếu SĐT, CCCD, ngày sinh trong nguồn - cần bổ sung","c26":"","c27":"","c28":"-","c29":"","c30":"6,900,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"Thiếu nhiều thông tin định danh; BHXH: Sẽ tham gia từ T05/2026","c48":"","c49":""}'::jsonb),
  (118, 'TT0127', 'Lương Đức Thành', 'K3', 'TSX-HT', 'Công nhân sơn', 'L1', 'E1', 'D1', 5300000, 1600000, 100000, 100000, 0, 650000, 0, 7750000, 5400000, 'excel_seed', 'warning', 'needs_review', '["BHXH: Sẽ tham gia từ T07/2026"]'::jsonb, '[]'::jsonb, '{"c0":"112","c1":"TT0127","c2":"Lương Đức Thành","c3":"Nam","c4":"24/05/1973","c5":"034073007181","c6":"08/05/2022","c7":"Đồng Thanh, Vũ Thư, Thái Bình","c8":"Tổ 3, Phường Thái Bình","c9":"974191555","c10":"NMSX","c11":"Nhà máy sản xuất","c12":"K3","c13":"TSX-HT","c14":"Công nhân sơn","c15":"L1","c16":"CN","c17":"Sơ cấp","c18":"11/05/2026","c19":"18/05/2026","c20":"1","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"Chưa có dữ liệu lương trong nguồn","c26":"","c27":"","c28":"-","c29":"","c30":"6,900,000","c31":"6,900,000","c32":"5,300,000","c33":"100,000","c34":"100,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"1,600,000","c42":"7,750,000","c43":"5,400,000","c44":"Chưa tham gia","c45":"","c46":"","c47":"BHXH: Sẽ tham gia từ T07/2026","c48":"","c49":""}'::jsonb),
  (120, 'TT0120', 'Trịnh Xuân Lộc', 'K4', 'VPHN', 'Giám đốc Nhân sự', 'L9', 'E9', 'D1', 9000000, 2700000, 800000, 800000, 0, 650000, 0, 13950000, 9800000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"113","c1":"TT0120","c2":"Trịnh Xuân Lộc","c3":"Nam","c4":"30/12/1988","c5":"","c6":"","c7":"","c8":"","c9":"","c10":"VP Hà Nội","c11":"Ban Giám đốc","c12":"K4","c13":"VPHN","c14":"Giám đốc Nhân sự","c15":"L9","c16":"BoD","c17":"Đại học","c18":"01/01/2026","c19":"01/01/2026","c20":"6","c21":"Chuyên gia","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"","c27":"","c28":"-","c29":"","c30":"11,700,000","c31":"11,700,000","c32":"9,000,000","c33":"800,000","c34":"800,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc D1","c41":"2,700,000","c42":"13,950,000","c43":"9,800,000","c44":"","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (121, 'TT0112', 'Nguyễn Thị Huyền Linh', 'K1', 'TKĐT', 'Chuyên viên Thiết kế (theo bộ môn)', 'L5', 'E5', 'B4', 6600000, 15000000, 450000, 450000, 0, 650000, 0, 23150000, 7050000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"114","c1":"TT0112","c2":"Nguyễn Thị Huyền Linh","c3":"Nữ","c4":"11/11/1974","c5":"001174030140","c6":"25/04/2021","c7":"Tổ 26, cụm 2, Quảng An, phường Hồng Hà, Hà Nội","c8":"Số 1, ngõ 236 Âu Cơ, Hà Nội","c9":"988505674","c10":"VP Hà Nội","c11":"Phòng Thiết Kế Đấu thầu","c12":"K1","c13":"TKĐT","c14":"Chuyên viên Thiết kế (theo bộ môn)","c15":"L5","c16":"CV","c17":"Đại học","c18":"10/11/2025","c19":"10/12/2025","c20":"6","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"21,000,000","c27":"-","c28":"21,000,000","c29":"5,100,000","c30":"600,000","c31":"21,600,000","c32":"6,600,000","c33":"450,000","c34":"450,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc B4","c41":"15,000,000","c42":"23,150,000","c43":"7,050,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (122, 'TT0104', 'Đặng Thị Thu Hiền', 'K1', 'HCNS', 'Chuyên viên nhân sự tổng hợp', 'L4', 'E4', 'C3', 6000000, 7800000, 350000, 350000, 0, 650000, 0, 15150000, 6350000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"115","c1":"TT0104","c2":"Đặng Thị Thu Hiền","c3":"Nữ","c4":"19/08/1996","c5":"001196019382","c6":"07/04/2021","c7":"Số nhà 63, vân Hồ 3, Phường Hai Bà Trưng, Hà Nội","c8":"","c9":"0971554896","c10":"VP Hà Nội","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Chuyên viên nhân sự tổng hợp","c15":"L4","c16":"CV","c17":"Đại học","c18":"08/09/2025","c19":"09/10/2025","c20":"8","c21":"12 tháng","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"13,000,000","c27":"-","c28":"13,000,000","c29":"5,100,000","c30":"800,000","c31":"13,800,000","c32":"6,000,000","c33":"350,000","c34":"350,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc C3","c41":"7,800,000","c42":"15,150,000","c43":"6,350,000","c44":"Tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (123, 'TT0130', 'Nguyễn Thị Thu Hồng', 'K4', 'VPHN', 'Nhân viên phiên dịch', '', 'E4', 'B3', null, null, 0, 0, 0, 650000, 0, 650000, null, 'legacy_default', 'warning', 'needs_review', '["Thiếu level, mặc định E4.","Thiếu bậc P3, mặc định B3."]'::jsonb, '[]'::jsonb, '{"c0":"116","c1":"TT0130","c2":"Nguyễn Thị Thu Hồng","c3":"Nữ","c4":"11/08/2000","c5":"001300018131","c6":"05/05/2025","c7":"Xuân Mai, Chương Mỹ, Hà Nội","c8":"317 Trung Văn, Đại Mỗ, Hà Nội","c9":"333036920","c10":"VP Hà Nội","c11":"Phòng Hành chính Nhân sự","c12":"K4","c13":"VPHN","c14":"Nhân viên phiên dịch","c15":"","c16":"","c17":"Đại học","c18":"03/06/2026","c19":"03/08/2026","c20":"-","c21":"Thử việc","c22":"","c23":"Đang làm","c24":"","c25":"","c26":"18,000,000","c27":"-","c28":"18,000,000","c29":"","c30":"(18,000,000)","c31":"-","c32":"","c33":"","c34":"","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"","c41":"","c42":"650,000","c43":"-","c44":"Chưa tham gia","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb),
  (124, 'TT0078', 'Nguyễn Trọng Thắng', 'K1', 'HCNS', 'Nhân viên lái xe ô tô con văn phòng', 'L2', 'E2', 'C3', 5400000, 7000000, 200000, 200000, 0, 650000, 0, 13450000, 5600000, 'excel_seed', 'valid', 'approved', '[]'::jsonb, '[]'::jsonb, '{"c0":"117","c1":"TT0078","c2":"Nguyễn Trọng Thắng","c3":"Nam","c4":"11/09/1969","c5":"1069017993","c6":"29/04/2021","c7":"Yên Thái, Văn Yên, Yên Bái","c8":"Long Biên 1, Ngọc Lâm, Long Biên, Hà Nội","c9":"0902131869","c10":"VP Hà Nội","c11":"Phòng Hành chính Nhân sự","c12":"K1","c13":"HCNS","c14":"Nhân viên lái xe ô tô con văn phòng","c15":"L2","c16":"NV","c17":"Sơ cấp","c18":"01/04/2025","c19":"01/05/2025","c20":"14","c21":"12 tháng","c22":"01/05/2026","c23":"Đang làm","c24":"","c25":"","c26":"12,000,000","c27":"-","c28":"12,000,000","c29":"","c30":"400,000","c31":"12,400,000","c32":"5,400,000","c33":"200,000","c34":"200,000","c35":"-","c36":"0","c37":"26","c38":"650,000","c39":"0","c40":"Bậc C3","c41":"7,000,000","c42":"13,450,000","c43":"5,600,000","c44":"Hưu trí","c45":"","c46":"","c47":"","c48":"","c49":""}'::jsonb)
), matched as (
  select seed.*, coalesce(code_match.id, name_match.id) as employee_id
  from seed
  left join lateral (
    select e.id
    from public.employees e
    where upper(trim(e.employee_code::text)) = seed.employee_code
    limit 1
  ) code_match on true
  left join lateral (
    select e.id
    from public.employees e
    where lower(trim(e.full_name::text)) = lower(trim(seed.employee_name))
      and (
        select count(*)
        from public.employees unique_name
        where lower(trim(unique_name.full_name::text)) = lower(trim(seed.employee_name))
      ) = 1
    limit 1
  ) name_match on code_match.id is null
), inserted_rows as (
  insert into public.hrm_payroll_import_rows (batch_id, source_row_number, raw_payload, normalized_payload, validation_status, review_status, matched_employee_id, warning_messages, error_messages, metadata)
  select
    distinct on (upsert_batch.id, matched.source_row_number)
    upsert_batch.id,
    matched.source_row_number,
    matched.raw_payload,
    jsonb_build_object(
      'employee_code', matched.employee_code,
      'employee_name', matched.employee_name,
      'block_code', matched.block_code,
      'org_unit_code', matched.org_unit_code,
      'position_name', matched.position_name,
      'level_code', matched.level_code,
      'grade_code', matched.grade_code,
      'p3_band_code', matched.p3_band_code,
      'p1_salary_amount', matched.p1_salary_amount,
      'p3_standard_amount', matched.p3_standard_amount,
      'allowances', jsonb_build_object(
        'title', matched.title_allowance_amount,
        'phone', matched.phone_allowance_amount,
        'attraction', matched.attraction_support_amount,
        'meal', matched.meal_support_amount,
        'seniority', matched.seniority_allowance_amount
      ),
      'standard_total_income', matched.standard_total_income,
      'social_insurance_base_amount', matched.social_insurance_base_amount,
      'source', matched.source
    ),
    case when matched.employee_id is null and matched.validation_status = 'valid' then 'warning' else matched.validation_status end,
    case when matched.employee_id is null then 'needs_review' else matched.review_status end,
    matched.employee_id,
    case when matched.employee_id is null then matched.warning_messages || jsonb_build_array('Không tìm thấy nhân sự trong phần mềm theo mã Excel.') else matched.warning_messages end,
    matched.error_messages,
    jsonb_build_object('source', matched.source)
  from matched cross join upsert_batch
  order by upsert_batch.id, matched.source_row_number,
    case matched.validation_status when 'valid' then 0 when 'warning' then 1 else 2 end
  on conflict (batch_id, source_row_number) do update set
    raw_payload = excluded.raw_payload,
    normalized_payload = excluded.normalized_payload,
    validation_status = excluded.validation_status,
    review_status = excluded.review_status,
    matched_employee_id = excluded.matched_employee_id,
    warning_messages = excluded.warning_messages,
    error_messages = excluded.error_messages,
    metadata = excluded.metadata,
    updated_at = now()
  returning id, source_row_number
), assignment_seed as (
  select
    matched.*,
    plan_row.id as plan_id,
    sg.id as salary_grade_id,
    band.id as p3_band_id,
    coalesce(emp_pos.id, position_match.id) as position_id,
    ou.id as org_unit_id
  from matched
  cross join (select id from public.hrm_compensation_plans where code = '3P_2026') plan_row
  join public.salary_grades sg on sg.code = matched.grade_code
  join public.hrm_3p_bands band on band.plan_id = plan_row.id and band.code = matched.p3_band_code
  left join public.employees e on e.id = matched.employee_id
  left join public.hrm_positions emp_pos on emp_pos.id = e.position_id
  left join lateral (
    select hp.id
    from public.hrm_positions hp
    where lower(trim(hp.name)) = lower(trim(matched.position_name))
    order by
      case when hp.suggested_org_unit_code = matched.org_unit_code then 0 else 1 end,
      case when hp.suggested_org_unit_code = 'BCH CT' and matched.org_unit_code like 'BCH%' then 0 else 1 end,
      hp.sort_order nulls last
    limit 1
  ) position_match on true
  left join public.org_units ou on ou.code = matched.org_unit_code
  where matched.employee_id is not null
    and matched.validation_status <> 'error'
), inserted_assignments as (
  insert into public.hrm_employee_compensation_assignments (
    employee_id, employee_code_snapshot, employee_name_snapshot, plan_id, position_id, org_unit_id,
    salary_grade_id, p3_band_id, effective_from, effective_to, status, source, review_status, review_note, metadata
  )
  select
    distinct on (employee_id, plan_id, date '2026-07-01')
    employee_id, employee_code, employee_name, plan_id, position_id, org_unit_id,
    salary_grade_id, p3_band_id, date '2026-07-01', null, 'active', source, review_status,
    nullif(array_to_string(array(select jsonb_array_elements_text(warning_messages)), '; '), ''),
    jsonb_build_object(
      'seed_row_number', source_row_number,
      'position_name', position_name,
      'block_code', block_code,
      'org_unit_code', org_unit_code,
      'level_code', level_code,
      'p1_salary_amount', p1_salary_amount,
      'p3_standard_amount', p3_standard_amount,
      'title_allowance_amount', title_allowance_amount,
      'phone_allowance_amount', phone_allowance_amount,
      'attraction_support_amount', attraction_support_amount,
      'meal_support_amount', meal_support_amount,
      'seniority_allowance_amount', seniority_allowance_amount,
      'standard_total_income', standard_total_income,
      'social_insurance_base_amount', social_insurance_base_amount,
      'warning_messages', warning_messages
    )
  from assignment_seed
  order by employee_id, plan_id, date '2026-07-01',
    case validation_status when 'valid' then 0 when 'warning' then 1 else 2 end,
    source_row_number
  on conflict (employee_id, plan_id, effective_from) do update set
    employee_code_snapshot = excluded.employee_code_snapshot,
    employee_name_snapshot = excluded.employee_name_snapshot,
    position_id = excluded.position_id,
    org_unit_id = excluded.org_unit_id,
    salary_grade_id = excluded.salary_grade_id,
    p3_band_id = excluded.p3_band_id,
    status = excluded.status,
    source = excluded.source,
    review_status = excluded.review_status,
    review_note = excluded.review_note,
    metadata = excluded.metadata,
    updated_at = now()
  returning id, employee_code_snapshot
)
update public.hrm_payroll_import_rows row
set applied_assignment_id = ia.id, updated_at = now()
from inserted_assignments ia, upsert_batch
where row.batch_id = upsert_batch.id
  and upper(coalesce(row.normalized_payload ->> 'employee_code', '')) = ia.employee_code_snapshot;

do $$
declare
  tbl text;
  metadata_tables text[] := array[
    'hrm_compensation_plans',
    'hrm_3p_bands',
    'hrm_3p_grade_band_rates',
    'hrm_position_salary_mappings',
    'hrm_employee_compensation_assignments',
    'hrm_payroll_components',
    'hrm_payroll_import_batches',
    'hrm_payroll_import_rows'
  ];
begin
  foreach tbl in array metadata_tables loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.can_view_hrm_payroll_3p())', tbl || '_select', tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (app_private.can_manage_hrm_payroll_3p())', tbl || '_insert', tbl);
    execute format('create policy %I on public.%I for update to authenticated using (app_private.can_manage_hrm_payroll_3p()) with check (app_private.can_manage_hrm_payroll_3p())', tbl || '_update', tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (app_private.can_manage_hrm_payroll_3p())', tbl || '_delete', tbl);

    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
      begin
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      exception when duplicate_object then
        null;
      end;
    end if;
  end loop;
end $$;

-- Tighten payroll writes to HRM payroll administrators while keeping authenticated HRM reads.
alter table public.hrm_payrolls enable row level security;
grant select, insert, update, delete on public.hrm_payrolls to authenticated;
drop policy if exists payrolls_select on public.hrm_payrolls;
drop policy if exists payrolls_insert on public.hrm_payrolls;
drop policy if exists payrolls_update on public.hrm_payrolls;
drop policy if exists payrolls_delete on public.hrm_payrolls;
create policy payrolls_select on public.hrm_payrolls for select to authenticated using (app_private.can_view_hrm_payroll_3p());
create policy payrolls_insert on public.hrm_payrolls for insert to authenticated with check (app_private.can_manage_hrm_payroll_3p());
create policy payrolls_update on public.hrm_payrolls for update to authenticated using (app_private.can_manage_hrm_payroll_3p()) with check (app_private.can_manage_hrm_payroll_3p());
create policy payrolls_delete on public.hrm_payrolls for delete to authenticated using (app_private.can_manage_hrm_payroll_3p());

-- salary_grades is an existing HRM table; keep it readable only through HRM payroll access after 3P extension.
alter table public.salary_grades enable row level security;
grant select, insert, update, delete on public.salary_grades to authenticated;
drop policy if exists "Allow all for authenticated users" on public.salary_grades;
drop policy if exists salary_grades_select on public.salary_grades;
drop policy if exists salary_grades_insert on public.salary_grades;
drop policy if exists salary_grades_update on public.salary_grades;
drop policy if exists salary_grades_delete on public.salary_grades;
create policy salary_grades_select on public.salary_grades for select to authenticated using (app_private.can_view_hrm_payroll_3p());
create policy salary_grades_insert on public.salary_grades for insert to authenticated with check (app_private.can_manage_hrm_payroll_3p());
create policy salary_grades_update on public.salary_grades for update to authenticated using (app_private.can_manage_hrm_payroll_3p()) with check (app_private.can_manage_hrm_payroll_3p());
create policy salary_grades_delete on public.salary_grades for delete to authenticated using (app_private.can_manage_hrm_payroll_3p());

notify pgrst, 'reload schema';
