-- HRM metadata source of truth v1.
-- Seeded from /Users/admin/Downloads/danh-muc-goc.xlsx on 2026-07-05.
-- Legacy tables/columns are kept in place for compatibility with employees, payroll,
-- attendance, contracts and project/site dependencies.

create table if not exists public.hrm_org_blocks (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hrm_position_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hrm_position_levels (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  group_code text,
  description text,
  salary_range text,
  allowance_factor numeric(8,4),
  title_allowance_amount numeric(14,2),
  phone_allowance_amount numeric(14,2),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hrm_competency_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hrm_competency_levels (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hrm_catalog_items (
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  source text not null default 'catalog',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hrm_positions add column if not exists code text;
alter table public.hrm_positions add column if not exists group_code text;
alter table public.hrm_positions add column if not exists level_code text;
alter table public.hrm_positions add column if not exists suggested_org_unit_code text;
alter table public.hrm_positions add column if not exists is_active boolean not null default true;
alter table public.hrm_positions add column if not exists sort_order integer not null default 0;
alter table public.hrm_positions add column if not exists source text not null default 'legacy';
alter table public.hrm_positions add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.org_units add column if not exists code text;
alter table public.org_units add column if not exists block_code text;
alter table public.org_units add column if not exists source text not null default 'legacy';
alter table public.org_units add column if not exists alias_names text[] not null default '{}'::text[];
alter table public.org_units add column if not exists is_active boolean not null default true;

alter table public.employees add column if not exists employment_status_id uuid;
alter table public.employees add column if not exists education_level_id uuid;
alter table public.employees add column if not exists social_insurance_status_id uuid;

create unique index if not exists hrm_org_blocks_code_key on public.hrm_org_blocks (code);
create unique index if not exists hrm_position_groups_code_key on public.hrm_position_groups (code);
create unique index if not exists hrm_position_levels_code_key on public.hrm_position_levels (code);
create unique index if not exists hrm_competency_groups_code_key on public.hrm_competency_groups (code);
create unique index if not exists hrm_competency_levels_code_key on public.hrm_competency_levels (code);
create unique index if not exists hrm_catalog_items_catalog_key_code_key on public.hrm_catalog_items (catalog_key, code);
create unique index if not exists hrm_positions_code_key on public.hrm_positions (code) where code is not null;
create unique index if not exists org_units_code_key on public.org_units (code) where code is not null;

create index if not exists idx_hrm_catalog_items_catalog_key on public.hrm_catalog_items (catalog_key);
create index if not exists idx_hrm_positions_group_code on public.hrm_positions (group_code);
create index if not exists idx_hrm_positions_level_code on public.hrm_positions (level_code);
create index if not exists idx_org_units_block_code on public.org_units (block_code);
create index if not exists idx_employees_area_id on public.employees (area_id);
create index if not exists idx_employees_office_id on public.employees (office_id);
create index if not exists idx_employees_employee_type_id on public.employees (employee_type_id);
create index if not exists idx_employees_position_id on public.employees (position_id);
create index if not exists idx_employees_salary_policy_id on public.employees (salary_policy_id);
create index if not exists idx_employees_work_schedule_id on public.employees (work_schedule_id);
create index if not exists idx_employees_employment_status_id on public.employees (employment_status_id);
create index if not exists idx_employees_education_level_id on public.employees (education_level_id);
create index if not exists idx_employees_social_insurance_status_id on public.employees (social_insurance_status_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_employment_status_id_fkey'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_employment_status_id_fkey
      foreign key (employment_status_id) references public.hrm_catalog_items(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_education_level_id_fkey'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_education_level_id_fkey
      foreign key (education_level_id) references public.hrm_catalog_items(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_social_insurance_status_id_fkey'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_social_insurance_status_id_fkey
      foreign key (social_insurance_status_id) references public.hrm_catalog_items(id)
      on delete set null;
  end if;
end $$;

insert into public.hrm_org_blocks (code, name, sort_order, source)
values
  ('K1', 'Khối 1 - Văn phòng', 1, 'catalog'),
  ('K2', 'Khối 2 - Công trường', 2, 'catalog'),
  ('K3', 'Khối 3 - Nhà máy SX kết cấu thép', 3, 'catalog'),
  ('K4', 'Khối 4 - Văn phòng Hà Nội', 4, 'catalog')
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  source = excluded.source,
  is_active = true,
  updated_at = now();

with seed(code, name, block_code, description, sort_order) as (
  values
  ('BLĐ', 'Ban lãnh đạo', 'K1', null, 1),
  ('QLDA', 'Phòng Quản lý dự án', 'K1', null, 2),
  ('TCKT', 'Phòng Tài chính - Kế toán', 'K1', null, 3),
  ('HCNS', 'Phòng Hành chính - Nhân sự', 'K1', null, 4),
  ('TKĐT', 'Phòng Thiết kế - Đấu thầu', 'K1', null, 5),
  ('VTTB', 'Phòng Vật tư - Thiết bị', 'K1', null, 6),
  ('TKTL', 'Bộ phận Thư ký - Trợ lý', 'K1', null, 7),
  ('CGCV', 'Chuyên gia - Cố vấn', 'K1', null, 8),
  ('BCH RICO', 'Ban chỉ huy công trình RICO', 'K2', null, 9),
  ('BCH SMB', 'Ban chỉ huy công trình Sơn Miền Bắc', 'K2', null, 10),
  ('BCH NT', 'Ban chỉ huy công trình Ninh Thuận', 'K2', null, 11),
  ('BCH RC', 'Ban chỉ huy công trình Richain', 'K2', null, 12),
  ('VPNM', 'Văn phòng nhà máy', 'K3', null, 13),
  ('TSX-PC', 'Tổ sản xuất - Tổ pha, cắt', 'K3', null, 14),
  ('TSX-LR', 'Tổ sản xuất - Tổ gá, lắp ráp', 'K3', null, 15),
  ('TSX-HH', 'Tổ sản xuất - Tổ hàn hoàn thiện', 'K3', null, 16),
  ('TSX-HT', 'Tổ sản xuất - Tổ sơn, đóng gói', 'K3', null, 17),
  ('VPHN', 'Văn phòng Hà Nội', 'K4', null, 18),
  ('TTTH', 'Phòng Truyền Thông Thương Hiệu', 'K1', null, 19)
),
unique_seed_names as (
  select name from seed group by name having count(*) = 1
)
update public.org_units ou
set
  code = seed.code,
  block_code = seed.block_code,
  description = coalesce(nullif(ou.description, ''), seed.description),
  order_index = coalesce(nullif(ou.order_index, 0), seed.sort_order),
  source = 'catalog',
  is_active = true
from seed
join unique_seed_names usn on usn.name = seed.name
where ou.code is null and lower(trim(ou.name)) = lower(trim(seed.name));

with seed(code, name, block_code, description, sort_order) as (
  values
  ('BLĐ', 'Ban lãnh đạo', 'K1', null, 1),
  ('QLDA', 'Phòng Quản lý dự án', 'K1', null, 2),
  ('TCKT', 'Phòng Tài chính - Kế toán', 'K1', null, 3),
  ('HCNS', 'Phòng Hành chính - Nhân sự', 'K1', null, 4),
  ('TKĐT', 'Phòng Thiết kế - Đấu thầu', 'K1', null, 5),
  ('VTTB', 'Phòng Vật tư - Thiết bị', 'K1', null, 6),
  ('TKTL', 'Bộ phận Thư ký - Trợ lý', 'K1', null, 7),
  ('CGCV', 'Chuyên gia - Cố vấn', 'K1', null, 8),
  ('BCH RICO', 'Ban chỉ huy công trình RICO', 'K2', null, 9),
  ('BCH SMB', 'Ban chỉ huy công trình Sơn Miền Bắc', 'K2', null, 10),
  ('BCH NT', 'Ban chỉ huy công trình Ninh Thuận', 'K2', null, 11),
  ('BCH RC', 'Ban chỉ huy công trình Richain', 'K2', null, 12),
  ('VPNM', 'Văn phòng nhà máy', 'K3', null, 13),
  ('TSX-PC', 'Tổ sản xuất - Tổ pha, cắt', 'K3', null, 14),
  ('TSX-LR', 'Tổ sản xuất - Tổ gá, lắp ráp', 'K3', null, 15),
  ('TSX-HH', 'Tổ sản xuất - Tổ hàn hoàn thiện', 'K3', null, 16),
  ('TSX-HT', 'Tổ sản xuất - Tổ sơn, đóng gói', 'K3', null, 17),
  ('VPHN', 'Văn phòng Hà Nội', 'K4', null, 18),
  ('TTTH', 'Phòng Truyền Thông Thương Hiệu', 'K1', null, 19)
)
insert into public.org_units (
  id, code, name, type, parent_id, description, order_index,
  block_code, source, alias_names, is_active
)
select
  gen_random_uuid(),
  code,
  name,
  case when code = 'VPNM' then 'factory' else 'department' end,
  null,
  coalesce(description, ''),
  sort_order,
  block_code,
  'catalog',
  '{}'::text[],
  true
from seed
on conflict (code) where code is not null do update set
  name = excluded.name,
  block_code = excluded.block_code,
  description = coalesce(nullif(org_units.description, ''), excluded.description),
  order_index = excluded.order_index,
  source = 'catalog',
  is_active = true;

insert into public.hrm_catalog_items (catalog_key, code, name, description, sort_order, source)
values
  ('employment_status', 'DL', 'Đang làm', 'Đang làm việc bình thường', 1, 'catalog'),
  ('employment_status', 'NV', 'Nghỉ việc', 'Đã chấm dứt HĐLĐ', 2, 'catalog'),
  ('employment_status', 'CV', 'Chờ việc', 'Tạm hoãn HĐLĐ, chờ bố trí', 3, 'catalog'),
  ('labor_contract_type', 'TV', 'Thử việc', 'Theo quy định thử việc', 1, 'catalog'),
  ('labor_contract_type', 'HV', 'Học việc', 'Theo thỏa thuận', 2, 'catalog'),
  ('labor_contract_type', '3T', '3 tháng', '3 tháng', 3, 'catalog'),
  ('labor_contract_type', '6T', '6 tháng', '6 tháng', 4, 'catalog'),
  ('labor_contract_type', '12T', '12 tháng', '12 tháng', 5, 'catalog'),
  ('labor_contract_type', '18T', '18 tháng', '18 tháng', 6, 'catalog'),
  ('labor_contract_type', '24T', '24 tháng', '24 tháng', 7, 'catalog'),
  ('labor_contract_type', '36T', '36 tháng', '36 tháng', 8, 'catalog'),
  ('labor_contract_type', 'KXĐ', 'KXĐ', 'Không xác định', 9, 'catalog'),
  ('labor_contract_type', 'TH', 'Tạm hoãn', 'Theo quyết định', 10, 'catalog'),
  ('labor_contract_type', 'CG', 'Chuyên gia', 'Theo thỏa thuận', 11, 'catalog'),
  ('labor_contract_type', 'Khác', 'Khác', 'Loại HĐ khác', 12, 'catalog'),
  ('education_level', 'TS', 'Tiến sĩ', 'Sau đại học', 1, 'catalog'),
  ('education_level', 'Ths', 'Thạc sĩ', 'Sau đại học', 2, 'catalog'),
  ('education_level', 'ĐH', 'Đại học', 'Cử nhân/Kĩ sư/KTS', 3, 'catalog'),
  ('education_level', 'CĐ', 'Cao đẳng', 'Đào tạo từ 24-36 tháng', 4, 'catalog'),
  ('education_level', 'TC', 'Trung cấp', 'Đào tạo từ 12-24 tháng', 5, 'catalog'),
  ('education_level', 'SC', 'Sơ cấp', 'Đào tạo ngắn hạn < 12 tháng', 6, 'catalog'),
  ('education_level', 'LĐPT', 'LĐPT', 'Chưa qua đào tạo', 7, 'catalog'),
  ('social_insurance_status', 'TG', 'Tham gia', 'Đóng BHXH đầy đủ', 1, 'catalog'),
  ('social_insurance_status', '1P', '1 phần', 'Đóng một phần / không đủ mức', 2, 'catalog'),
  ('social_insurance_status', 'CTG', 'Chưa tham gia', 'Chưa đóng (thử việc / chưa đủ điều kiện)', 3, 'catalog'),
  ('social_insurance_status', 'TS', 'Thai sản', 'Đang nghỉ chế độ thai sản', 4, 'catalog'),
  ('social_insurance_status', 'ĐĐ', 'Ốm đau', 'Đang nghỉ chế độ ốm đau', 5, 'catalog'),
  ('social_insurance_status', 'HT', 'Hưu trí', 'Đang hưởng lương hưu', 6, 'catalog')
on conflict (catalog_key, code) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  source = excluded.source,
  is_active = true,
  updated_at = now();

insert into public.hrm_position_groups (code, name, description, sort_order, source)
values
  ('BoD', 'Ban lãnh đạo', 'Board of Directors - lãnh đạo cấp cao', 1, 'catalog'),
  ('QLCT', 'Quản lý cấp trung', 'Trưởng/phó phòng, quản đốc, chỉ huy trưởng', 2, 'catalog'),
  ('QLN', 'Quản lý nhóm', 'Trưởng nhóm, tổ trưởng, đội trưởng', 3, 'catalog'),
  ('CV', 'Chuyên viên', 'Cán bộ chuyên môn, kỹ thuật', 4, 'catalog'),
  ('NV', 'Nhân viên', 'Nhân viên, lao động trực tiếp', 5, 'catalog'),
  ('CN', 'Công nhân', 'Công nhân thuộc nhà máy sản xuất kết cấu thép', 6, 'catalog')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  source = excluded.source,
  is_active = true,
  updated_at = now();

insert into public.hrm_position_levels (
  code, name, group_code, description, salary_range,
  allowance_factor, title_allowance_amount, phone_allowance_amount,
  metadata, sort_order, source
)
values
  ('L1', 'Nhân viên/Công nhân', 'NV', 'LĐPT/Thừa hành theo chỉ thị', null, 0.1, 100000, 100000, '{}'::jsonb, 1, 'catalog'),
  ('L2', 'Nhân viên thừa hành qua đào tạo', 'NV', 'Lái xe/Lái cẩu/Trung cấp nghề', null, 0.2, 200000, 200000, '{}'::jsonb, 2, 'catalog'),
  ('L3', 'Nhân viên thực hiện chuyên môn', 'NV', 'Quản lý chuyên môn cơ bản (trình độ CĐ)', null, 0.3, 300000, 300000, '{}'::jsonb, 3, 'catalog'),
  ('L4', 'Chuyên viên chuyên môn KTXH', 'NV', 'Quản lý, thực hiện CM sâu kinh tế, xã hội (trình độ cử nhân)', null, 0.35, 350000, 350000, '{}'::jsonb, 4, 'catalog'),
  ('L5', 'Chuyên viên chuyên môn kĩ thuật', 'CV', 'Quản lý, thực hiện CM sâu kĩ thuật (trình độ Kĩ sư/KTS)', null, 0.45, 450000, 450000, '{}'::jsonb, 5, 'catalog'),
  ('L6', 'Quản lý nhóm', 'QLN', 'Quản lý nhóm CM sâu KTXH, KT, CNTT', null, 0.55, 550000, 550000, '{}'::jsonb, 6, 'catalog'),
  ('L7', 'Quản lý cấp trung', 'QLCT', 'Quản lý cấp trung (cấp phó phòng/bộ phận)', null, 0.65, 650000, 650000, '{}'::jsonb, 7, 'catalog'),
  ('L8', 'Quản lý cấp trung', 'QLCT', 'Quản lý cấp trung (cấp trưởng phòng/bộ phận)', null, 0.75, 750000, 750000, '{}'::jsonb, 8, 'catalog'),
  ('L9', 'Giám đốc/Phó TGĐ', 'BoD', 'Giám đốc chức năng/Phó TGĐ phụ trách mảng chức năng', null, 0.8, 800000, 800000, '{}'::jsonb, 9, 'catalog'),
  ('L10', 'Tổng giám đốc', 'BoD', 'Tổng giám đốc (chịu trách nhiệm pháp lý)', null, 0.9, 900000, 900000, '{}'::jsonb, 10, 'catalog'),
  ('L11', 'Chủ tịch HĐQT', 'BoD', 'Sáng lập công ty', null, 1, 1000000, 1000000, '{}'::jsonb, 11, 'catalog')
on conflict (code) do update set
  name = excluded.name,
  group_code = excluded.group_code,
  description = excluded.description,
  salary_range = excluded.salary_range,
  allowance_factor = excluded.allowance_factor,
  title_allowance_amount = excluded.title_allowance_amount,
  phone_allowance_amount = excluded.phone_allowance_amount,
  sort_order = excluded.sort_order,
  source = excluded.source,
  is_active = true,
  updated_at = now();

insert into public.hrm_competency_groups (code, name, description, sort_order, source)
values
  ('NLL', 'Năng lực lõi', 'Năng lực nền tảng áp dụng toàn công ty', 1, 'catalog'),
  ('NLCM', 'Năng lực chuyên môn', 'Năng lực kỹ thuật/nghiệp vụ theo vị trí', 2, 'catalog'),
  ('NLQL', 'Năng lực quản lý, lãnh đạo', 'Năng lực điều hành, dẫn dắt', 3, 'catalog')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  source = excluded.source,
  is_active = true,
  updated_at = now();

insert into public.hrm_competency_levels (code, name, description, sort_order, source)
values
  ('C1', 'Biết', 'Nhận biết, nắm khái niệm cơ bản', 1, 'catalog'),
  ('C2', 'Hiểu', 'Hiểu bản chất, giải thích được', 2, 'catalog'),
  ('C3', 'Làm được', 'Thực hiện được công việc độc lập', 3, 'catalog'),
  ('C4', 'Thành thạo', 'Làm thuần thục, xử lý tình huống phức tạp', 4, 'catalog'),
  ('C5', 'Sáng tạo, phát triển', 'Cải tiến, hướng dẫn người khác, phát triển mới', 5, 'catalog')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  source = excluded.source,
  is_active = true,
  updated_at = now();

with seed(code, name, group_code, level_code, suggested_org_unit_code, note, sort_order) as (
  values
  ('VT000', 'Chủ tịch HĐQT', 'BoD', 'L11', 'BLĐ', null, 1),
  ('VT001', 'Tổng giám đốc', 'BoD', 'L10', 'BLĐ', null, 2),
  ('VT002', 'Giám đốc điều hành', 'BoD', 'L9', 'BLĐ', null, 3),
  ('VT003', 'Giám đốc Nhân sự', 'BoD', 'L9', 'BLĐ', null, 4),
  ('VT004', 'Giám đốc đối ngoại', 'BoD', 'L9', 'BLĐ', null, 5),
  ('VT005', 'Giám đốc nội chính', 'BoD', 'L9', 'BLĐ', null, 6),
  ('VT006', 'Giám đốc tài chính', 'BoD', 'L9', 'BLĐ', null, 7),
  ('VT007', 'Kế toán trưởng', 'QLCT', 'L8', 'TCKT', null, 8),
  ('VT008', 'Trưởng phòng HCNS', 'QLCT', 'L8', 'HCNS', null, 9),
  ('VT009', 'Trưởng phòng QLDA', 'QLCT', 'L8', 'QLDA', null, 10),
  ('VT010', 'Trưởng phòng TKĐT', 'QLCT', 'L8', 'TKĐT', null, 11),
  ('VT011', 'Trưởng phòng VTTB', 'QLCT', 'L8', 'VTTB', null, 12),
  ('VT012', 'Trưởng phòng TCKT', 'QLCT', 'L8', 'TCKT', null, 13),
  ('VT013', 'Trưởng phòng Truyền thông', 'QLCT', 'L8', 'VPHN', null, 14),
  ('VT014', 'Giám đốc NMSXKCT', 'QLCT', 'L8', 'VPNM', null, 15),
  ('VT015', 'Chỉ huy trưởng BCH RICO', 'QLCT', 'L8', 'BCH CT', null, 16),
  ('VT016', 'Chỉ huy trưởng BCH SMB', 'QLCT', 'L8', 'BCH CT', null, 17),
  ('VT017', 'Phó phòng HCNS', 'QLCT', 'L7', 'HCNS', null, 18),
  ('VT018', 'Phó phòng QLDA', 'QLCT', 'L7', 'QLDA', null, 19),
  ('VT019', 'Phó phòng TKĐT', 'QLCT', 'L7', 'TKĐT', null, 20),
  ('VT020', 'Phó phòng VTTB', 'QLCT', 'L7', 'VTTB', null, 21),
  ('VT021', 'Phó phòng TCKT', 'QLCT', 'L7', 'TCKT', null, 22),
  ('VT022', 'Phó phòng Truyền thông', 'QLCT', 'L7', 'VPHN', null, 23),
  ('VT023', 'Phó giám đốc NMSXKCT', 'QLCT', 'L7', 'VPNM', null, 24),
  ('VT024', 'Chỉ huy phó BCH RICO', 'QLCT', 'L7', 'BCH CT', null, 25),
  ('VT025', 'Chỉ huy phó BCH SMB', 'QLCT', 'L7', 'BCH CT', null, 26),
  ('VT026', 'Trưởng nhóm Hành chính', 'QLN', 'L5', 'HCNS', null, 27),
  ('VT027', 'Trưởng nhóm Chất lượng', 'QLN', 'L6', 'QLDA', null, 28),
  ('VT028', 'Trưởng nhóm Kế hoạch', 'QLN', 'L6', 'QLDA', null, 29),
  ('VT029', 'Trưởng nhóm ATLĐ', 'QLN', 'L5', 'QLDA', null, 30),
  ('VT030', 'Trưởng nhóm Thiết kế', 'QLN', 'L6', 'TKĐT', null, 31),
  ('VT031', 'Trưởng nhóm Pháp lý', 'QLN', 'L6', 'TKĐT', null, 32),
  ('VT032', 'Trưởng nhóm Vật tư', 'QLN', 'L5', 'VTTB', null, 33),
  ('VT033', 'Trưởng nhóm Thiết bị', 'QLN', 'L5', 'VTTB', null, 34),
  ('VT034', 'Quản đốc nhà máy', 'QLN', 'L5', 'VPNM', null, 35),
  ('VT035', 'Đội trưởng đội xe', 'QLN', 'L3', 'HCNS', null, 36),
  ('VT036', 'Đội trưởng đội bảo vệ', 'QLN', 'L3', 'HCNS', null, 37),
  ('VT037', 'Chuyên viên hành chính tổng hợp', 'CV', 'L4', 'HCNS', null, 38),
  ('VT038', 'Chuyên viên pháp chế', 'CV', 'L4', 'HCNS', null, 39),
  ('VT039', 'Chuyên viên Công nghệ thông tin (IT)', 'CV', 'L5', 'HCNS', null, 40),
  ('VT040', 'Chuyên viên nhân sự tổng hợp', 'CV', 'L4', 'HCNS', null, 41),
  ('VT041', 'Nhân viên lễ tân', 'NV', 'L2', 'HCNS', null, 42),
  ('VT042', 'Nhân viên lái xe ô tô con văn phòng', 'NV', 'L2', 'HCNS', null, 43),
  ('VT043', 'Nhân viên bảo vệ', 'NV', 'L1', 'HCNS', null, 44),
  ('VT044', 'Nhân viên tạp vụ/vệ sinh', 'NV', 'L1', 'HCNS', null, 45),
  ('VT045', 'Nhân viên cấp dưỡng', 'NV', 'L1', 'HCNS', null, 46),
  ('VT046', 'Chuyên viên QLDA', 'CV', 'L5', 'QLDA', null, 47),
  ('VT047', 'Chuyên viên Kế hoạch', 'CV', 'L5', 'QLDA', null, 48),
  ('VT048', 'Chuyên viên ATVSLĐ', 'CV', 'L4', 'QLDA', null, 49),
  ('VT049', 'Chuyên viên kĩ thuật', 'CV', 'L5', 'QLDA', null, 50),
  ('VT050', 'Nhân viên kĩ thuật', 'NV', 'L4', 'QLDA', null, 51),
  ('VT051', 'Chuyên viên Thiết kế (theo bộ môn)', 'CV', 'L5', 'TKĐT', null, 52),
  ('VT052', 'Chuyên viên Diễn họa 3D', 'CV', 'L5', 'TKĐT', null, 53),
  ('VT053', 'Chuyên viên Dự toán', 'CV', 'L5', 'TKĐT', null, 54),
  ('VT054', 'Chuyên viên Pháp lý', 'CV', 'L5', 'TKĐT', null, 55),
  ('VT055', 'Chuyên viên Vật tư', 'CV', 'L4', 'VTTB', null, 56),
  ('VT056', 'Chuyên viên Thiết bị', 'CV', 'L4', 'VTTB', null, 57),
  ('VT057', 'Chuyên viên quản lý kho', 'NV', 'L3', 'VTTB', null, 58),
  ('VT058', 'Nhân viên Vật tư', 'NV', 'L2', 'VTTB', null, 59),
  ('VT059', 'Nhân viên Thủ kho', 'NV', 'L2', 'VTTB', null, 60),
  ('VT060', 'Chuyên viên Kế toán tổng hợp', 'CV', 'L5', 'TCKT', null, 61),
  ('VT061', 'Chuyên viên Kế toán dự án', 'CV', 'L4', 'TCKT', null, 62),
  ('VT062', 'Chuyên viên Kế toán thuế', 'CV', 'L4', 'TCKT', null, 63),
  ('VT063', 'Nhân viên Kế toán thanh toán', 'CV', 'L3', 'TCKT', null, 64),
  ('VT064', 'Chuyên viên tài chính', 'CV', 'L4', 'TCKT', null, 65),
  ('VT065', 'Cán bộ KCS', 'CV', 'L4', 'VPNM', null, 66),
  ('VT066', 'Cán bộ HSE', 'CV', 'L4', 'VPNM', null, 67),
  ('VT067', 'Cán bộ Shopdrawing', 'CV', 'L4', 'VPNM', null, 68),
  ('VT068', 'Cán bộ QS/QC', 'CV', 'L4', 'VPNM', null, 69),
  ('VT069', 'Cán bộ Thống kê', 'NV', 'L3', 'VPNM', null, 70),
  ('VT070', 'Công nhân hàn/cắt', 'CN', 'L1', 'TSX-PC', null, 71),
  ('VT071', 'Công nhân hàn/gá', 'CN', 'L1', 'TSX-LR', null, 72),
  ('VT072', 'Công nhân hàn/hoàn thiện', 'CN', 'L1', 'TSX-PC', null, 73),
  ('VT073', 'Công nhân sơn', 'CN', 'L1', 'TSX-HT', null, 74),
  ('VT074', 'Công nhân bốc xếp', 'CN', 'L1', 'TSX-HT', null, 75),
  ('VT075', 'Thợ điện', 'NV', 'L2', 'VPNM', null, 76),
  ('VT076', 'Kĩ thuật trưởng', 'QLN', 'L6', 'BCH CT', null, 77),
  ('VT077', 'Cán bộ giám sát', 'CV', 'L5', 'BCH CT', null, 78),
  ('VT078', 'Cán bộ Shopdrawing', 'NV', 'L4', 'BCH CT', null, 79),
  ('VT079', 'Cán bộ ME', 'CV', 'L5', 'BCH CT', null, 80),
  ('VT080', 'Cán bộ QS/QC', 'CV', 'L5', 'BCH CT', null, 81),
  ('VT081', 'Cán bộ ATLĐ', 'CV', 'L4', 'BCH CT', null, 82),
  ('VT082', 'Cán bộ Trắc đạc', 'CV', 'L5', 'BCH CT', null, 83),
  ('VT083', 'Trợ lý dự án', 'NV', 'L3', 'BCH CT', null, 84),
  ('VT084', 'Nhân viên Vật tư', 'NV', 'L2', 'BCH CT', null, 85),
  ('VT085', 'Nhân viên Thủ kho', 'NV', 'L2', 'BCH CT', null, 86),
  ('VT086', 'Nhân viên bảo vệ', 'NV', 'L1', 'BCH CT', null, 87),
  ('VT087', 'Nhân viên cấp dưỡng', 'NV', 'L1', 'BCH CT', null, 88),
  ('VT088', 'Nhân viên lái xe tải', 'NV', 'L2', 'VTTB', null, 89),
  ('VT089', 'Nhân viên lái cẩu tự hành', 'NV', 'L2', 'VTTB', null, 90),
  ('VT090', 'Nhân viên lái máy xúc', 'NV', 'L2', 'VTTB', null, 91),
  ('VT091', 'Chuyên viên truyền thông', 'CV', 'L4', 'VPHN', null, 92),
  ('VT092', 'Chuyên viên thiết kế đồ họa', 'CV', 'L5', 'VPHN', null, 93),
  ('VT093', 'Chuyên viên phiên dịch', 'NV', 'L4', 'VPHN', null, 94),
  ('VT094', 'Chuyên gia', 'CG', 'L8', 'CG/CV', null, 95),
  ('VT095', 'Cố vấn', 'CV', 'L4', 'CG/CV', null, 96),
  ('VT096', 'Trợ lý cao cấp (cho Chủ tịch HĐQT)', 'CV', 'L9', 'BLĐ', null, 97),
  ('VT097', 'Chuyên gia cao cấp', 'CG', 'L8', null, null, 98),
  ('VT098', 'Trợ lý TGĐ', 'CV', 'L8', 'TKTL', null, 99),
  ('VT099', 'Trợ lý Phó TGĐ/Giám đốc chức năng', 'CV', 'L7', 'TKTL', null, 100),
  ('VT100', 'Thư kí TGĐ', 'CV', 'L4', 'TKTL', null, 101)
),
unique_seed_names as (
  select name from seed group by name having count(*) = 1
)
update public.hrm_positions hp
set
  code = seed.code,
  group_code = seed.group_code,
  level_code = seed.level_code,
  suggested_org_unit_code = seed.suggested_org_unit_code,
  level = nullif(regexp_replace(seed.level_code, '\D', '', 'g'), '')::integer,
  sort_order = seed.sort_order,
  source = 'catalog',
  is_active = true,
  metadata = jsonb_strip_nulls(jsonb_build_object('note', seed.note, 'matched_from_legacy_name', true))
from seed
join unique_seed_names usn on usn.name = seed.name
where hp.code is null and lower(trim(hp.name)) = lower(trim(seed.name));

with seed(code, name, group_code, level_code, suggested_org_unit_code, note, sort_order) as (
  values
  ('VT000', 'Chủ tịch HĐQT', 'BoD', 'L11', 'BLĐ', null, 1),
  ('VT001', 'Tổng giám đốc', 'BoD', 'L10', 'BLĐ', null, 2),
  ('VT002', 'Giám đốc điều hành', 'BoD', 'L9', 'BLĐ', null, 3),
  ('VT003', 'Giám đốc Nhân sự', 'BoD', 'L9', 'BLĐ', null, 4),
  ('VT004', 'Giám đốc đối ngoại', 'BoD', 'L9', 'BLĐ', null, 5),
  ('VT005', 'Giám đốc nội chính', 'BoD', 'L9', 'BLĐ', null, 6),
  ('VT006', 'Giám đốc tài chính', 'BoD', 'L9', 'BLĐ', null, 7),
  ('VT007', 'Kế toán trưởng', 'QLCT', 'L8', 'TCKT', null, 8),
  ('VT008', 'Trưởng phòng HCNS', 'QLCT', 'L8', 'HCNS', null, 9),
  ('VT009', 'Trưởng phòng QLDA', 'QLCT', 'L8', 'QLDA', null, 10),
  ('VT010', 'Trưởng phòng TKĐT', 'QLCT', 'L8', 'TKĐT', null, 11),
  ('VT011', 'Trưởng phòng VTTB', 'QLCT', 'L8', 'VTTB', null, 12),
  ('VT012', 'Trưởng phòng TCKT', 'QLCT', 'L8', 'TCKT', null, 13),
  ('VT013', 'Trưởng phòng Truyền thông', 'QLCT', 'L8', 'VPHN', null, 14),
  ('VT014', 'Giám đốc NMSXKCT', 'QLCT', 'L8', 'VPNM', null, 15),
  ('VT015', 'Chỉ huy trưởng BCH RICO', 'QLCT', 'L8', 'BCH CT', null, 16),
  ('VT016', 'Chỉ huy trưởng BCH SMB', 'QLCT', 'L8', 'BCH CT', null, 17),
  ('VT017', 'Phó phòng HCNS', 'QLCT', 'L7', 'HCNS', null, 18),
  ('VT018', 'Phó phòng QLDA', 'QLCT', 'L7', 'QLDA', null, 19),
  ('VT019', 'Phó phòng TKĐT', 'QLCT', 'L7', 'TKĐT', null, 20),
  ('VT020', 'Phó phòng VTTB', 'QLCT', 'L7', 'VTTB', null, 21),
  ('VT021', 'Phó phòng TCKT', 'QLCT', 'L7', 'TCKT', null, 22),
  ('VT022', 'Phó phòng Truyền thông', 'QLCT', 'L7', 'VPHN', null, 23),
  ('VT023', 'Phó giám đốc NMSXKCT', 'QLCT', 'L7', 'VPNM', null, 24),
  ('VT024', 'Chỉ huy phó BCH RICO', 'QLCT', 'L7', 'BCH CT', null, 25),
  ('VT025', 'Chỉ huy phó BCH SMB', 'QLCT', 'L7', 'BCH CT', null, 26),
  ('VT026', 'Trưởng nhóm Hành chính', 'QLN', 'L5', 'HCNS', null, 27),
  ('VT027', 'Trưởng nhóm Chất lượng', 'QLN', 'L6', 'QLDA', null, 28),
  ('VT028', 'Trưởng nhóm Kế hoạch', 'QLN', 'L6', 'QLDA', null, 29),
  ('VT029', 'Trưởng nhóm ATLĐ', 'QLN', 'L5', 'QLDA', null, 30),
  ('VT030', 'Trưởng nhóm Thiết kế', 'QLN', 'L6', 'TKĐT', null, 31),
  ('VT031', 'Trưởng nhóm Pháp lý', 'QLN', 'L6', 'TKĐT', null, 32),
  ('VT032', 'Trưởng nhóm Vật tư', 'QLN', 'L5', 'VTTB', null, 33),
  ('VT033', 'Trưởng nhóm Thiết bị', 'QLN', 'L5', 'VTTB', null, 34),
  ('VT034', 'Quản đốc nhà máy', 'QLN', 'L5', 'VPNM', null, 35),
  ('VT035', 'Đội trưởng đội xe', 'QLN', 'L3', 'HCNS', null, 36),
  ('VT036', 'Đội trưởng đội bảo vệ', 'QLN', 'L3', 'HCNS', null, 37),
  ('VT037', 'Chuyên viên hành chính tổng hợp', 'CV', 'L4', 'HCNS', null, 38),
  ('VT038', 'Chuyên viên pháp chế', 'CV', 'L4', 'HCNS', null, 39),
  ('VT039', 'Chuyên viên Công nghệ thông tin (IT)', 'CV', 'L5', 'HCNS', null, 40),
  ('VT040', 'Chuyên viên nhân sự tổng hợp', 'CV', 'L4', 'HCNS', null, 41),
  ('VT041', 'Nhân viên lễ tân', 'NV', 'L2', 'HCNS', null, 42),
  ('VT042', 'Nhân viên lái xe ô tô con văn phòng', 'NV', 'L2', 'HCNS', null, 43),
  ('VT043', 'Nhân viên bảo vệ', 'NV', 'L1', 'HCNS', null, 44),
  ('VT044', 'Nhân viên tạp vụ/vệ sinh', 'NV', 'L1', 'HCNS', null, 45),
  ('VT045', 'Nhân viên cấp dưỡng', 'NV', 'L1', 'HCNS', null, 46),
  ('VT046', 'Chuyên viên QLDA', 'CV', 'L5', 'QLDA', null, 47),
  ('VT047', 'Chuyên viên Kế hoạch', 'CV', 'L5', 'QLDA', null, 48),
  ('VT048', 'Chuyên viên ATVSLĐ', 'CV', 'L4', 'QLDA', null, 49),
  ('VT049', 'Chuyên viên kĩ thuật', 'CV', 'L5', 'QLDA', null, 50),
  ('VT050', 'Nhân viên kĩ thuật', 'NV', 'L4', 'QLDA', null, 51),
  ('VT051', 'Chuyên viên Thiết kế (theo bộ môn)', 'CV', 'L5', 'TKĐT', null, 52),
  ('VT052', 'Chuyên viên Diễn họa 3D', 'CV', 'L5', 'TKĐT', null, 53),
  ('VT053', 'Chuyên viên Dự toán', 'CV', 'L5', 'TKĐT', null, 54),
  ('VT054', 'Chuyên viên Pháp lý', 'CV', 'L5', 'TKĐT', null, 55),
  ('VT055', 'Chuyên viên Vật tư', 'CV', 'L4', 'VTTB', null, 56),
  ('VT056', 'Chuyên viên Thiết bị', 'CV', 'L4', 'VTTB', null, 57),
  ('VT057', 'Chuyên viên quản lý kho', 'NV', 'L3', 'VTTB', null, 58),
  ('VT058', 'Nhân viên Vật tư', 'NV', 'L2', 'VTTB', null, 59),
  ('VT059', 'Nhân viên Thủ kho', 'NV', 'L2', 'VTTB', null, 60),
  ('VT060', 'Chuyên viên Kế toán tổng hợp', 'CV', 'L5', 'TCKT', null, 61),
  ('VT061', 'Chuyên viên Kế toán dự án', 'CV', 'L4', 'TCKT', null, 62),
  ('VT062', 'Chuyên viên Kế toán thuế', 'CV', 'L4', 'TCKT', null, 63),
  ('VT063', 'Nhân viên Kế toán thanh toán', 'CV', 'L3', 'TCKT', null, 64),
  ('VT064', 'Chuyên viên tài chính', 'CV', 'L4', 'TCKT', null, 65),
  ('VT065', 'Cán bộ KCS', 'CV', 'L4', 'VPNM', null, 66),
  ('VT066', 'Cán bộ HSE', 'CV', 'L4', 'VPNM', null, 67),
  ('VT067', 'Cán bộ Shopdrawing', 'CV', 'L4', 'VPNM', null, 68),
  ('VT068', 'Cán bộ QS/QC', 'CV', 'L4', 'VPNM', null, 69),
  ('VT069', 'Cán bộ Thống kê', 'NV', 'L3', 'VPNM', null, 70),
  ('VT070', 'Công nhân hàn/cắt', 'CN', 'L1', 'TSX-PC', null, 71),
  ('VT071', 'Công nhân hàn/gá', 'CN', 'L1', 'TSX-LR', null, 72),
  ('VT072', 'Công nhân hàn/hoàn thiện', 'CN', 'L1', 'TSX-PC', null, 73),
  ('VT073', 'Công nhân sơn', 'CN', 'L1', 'TSX-HT', null, 74),
  ('VT074', 'Công nhân bốc xếp', 'CN', 'L1', 'TSX-HT', null, 75),
  ('VT075', 'Thợ điện', 'NV', 'L2', 'VPNM', null, 76),
  ('VT076', 'Kĩ thuật trưởng', 'QLN', 'L6', 'BCH CT', null, 77),
  ('VT077', 'Cán bộ giám sát', 'CV', 'L5', 'BCH CT', null, 78),
  ('VT078', 'Cán bộ Shopdrawing', 'NV', 'L4', 'BCH CT', null, 79),
  ('VT079', 'Cán bộ ME', 'CV', 'L5', 'BCH CT', null, 80),
  ('VT080', 'Cán bộ QS/QC', 'CV', 'L5', 'BCH CT', null, 81),
  ('VT081', 'Cán bộ ATLĐ', 'CV', 'L4', 'BCH CT', null, 82),
  ('VT082', 'Cán bộ Trắc đạc', 'CV', 'L5', 'BCH CT', null, 83),
  ('VT083', 'Trợ lý dự án', 'NV', 'L3', 'BCH CT', null, 84),
  ('VT084', 'Nhân viên Vật tư', 'NV', 'L2', 'BCH CT', null, 85),
  ('VT085', 'Nhân viên Thủ kho', 'NV', 'L2', 'BCH CT', null, 86),
  ('VT086', 'Nhân viên bảo vệ', 'NV', 'L1', 'BCH CT', null, 87),
  ('VT087', 'Nhân viên cấp dưỡng', 'NV', 'L1', 'BCH CT', null, 88),
  ('VT088', 'Nhân viên lái xe tải', 'NV', 'L2', 'VTTB', null, 89),
  ('VT089', 'Nhân viên lái cẩu tự hành', 'NV', 'L2', 'VTTB', null, 90),
  ('VT090', 'Nhân viên lái máy xúc', 'NV', 'L2', 'VTTB', null, 91),
  ('VT091', 'Chuyên viên truyền thông', 'CV', 'L4', 'VPHN', null, 92),
  ('VT092', 'Chuyên viên thiết kế đồ họa', 'CV', 'L5', 'VPHN', null, 93),
  ('VT093', 'Chuyên viên phiên dịch', 'NV', 'L4', 'VPHN', null, 94),
  ('VT094', 'Chuyên gia', 'CG', 'L8', 'CG/CV', null, 95),
  ('VT095', 'Cố vấn', 'CV', 'L4', 'CG/CV', null, 96),
  ('VT096', 'Trợ lý cao cấp (cho Chủ tịch HĐQT)', 'CV', 'L9', 'BLĐ', null, 97),
  ('VT097', 'Chuyên gia cao cấp', 'CG', 'L8', null, null, 98),
  ('VT098', 'Trợ lý TGĐ', 'CV', 'L8', 'TKTL', null, 99),
  ('VT099', 'Trợ lý Phó TGĐ/Giám đốc chức năng', 'CV', 'L7', 'TKTL', null, 100),
  ('VT100', 'Thư kí TGĐ', 'CV', 'L4', 'TKTL', null, 101)
)
insert into public.hrm_positions (
  id, code, name, group_code, level_code, suggested_org_unit_code,
  level, sort_order, source, is_active, metadata
)
select
  gen_random_uuid(),
  code,
  name,
  group_code,
  level_code,
  suggested_org_unit_code,
  nullif(regexp_replace(level_code, '\D', '', 'g'), '')::integer,
  sort_order,
  'catalog',
  true,
  jsonb_strip_nulls(jsonb_build_object('note', note))
from seed
on conflict (code) where code is not null do update set
  name = excluded.name,
  group_code = excluded.group_code,
  level_code = excluded.level_code,
  suggested_org_unit_code = excluded.suggested_org_unit_code,
  level = excluded.level,
  sort_order = excluded.sort_order,
  source = 'catalog',
  is_active = true,
  metadata = excluded.metadata;

update public.hrm_positions
set
  code = 'LEGACY-' || left(replace(id::text, '-', ''), 8),
  source = coalesce(nullif(source, ''), 'legacy'),
  is_active = coalesce(is_active, true),
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('legacy_preserved', true)
where code is null;

update public.employees e
set employment_status_id = c.id
from public.hrm_catalog_items c
where e.employment_status_id is null
  and c.catalog_key = 'employment_status'
  and c.code = case when e.status = 'Đã nghỉ việc' then 'NV' else 'DL' end;

create or replace function public.sync_employee_status_from_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  status_code text;
begin
  if new.employment_status_id is null then
    return new;
  end if;

  select code into status_code
  from public.hrm_catalog_items
  where id = new.employment_status_id
    and catalog_key = 'employment_status';

  if status_code = 'NV' then
    new.status := 'Đã nghỉ việc';
  elsif status_code in ('DL', 'CV') then
    new.status := 'Đang làm việc';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_employee_status_from_metadata on public.employees;
create trigger trg_sync_employee_status_from_metadata
before insert or update of employment_status_id on public.employees
for each row
execute function public.sync_employee_status_from_metadata();

alter table public.hrm_org_blocks enable row level security;
alter table public.hrm_position_groups enable row level security;
alter table public.hrm_position_levels enable row level security;
alter table public.hrm_competency_groups enable row level security;
alter table public.hrm_competency_levels enable row level security;
alter table public.hrm_catalog_items enable row level security;

grant select on public.hrm_org_blocks to anon, authenticated;
grant select on public.hrm_position_groups to anon, authenticated;
grant select on public.hrm_position_levels to anon, authenticated;
grant select on public.hrm_competency_groups to anon, authenticated;
grant select on public.hrm_competency_levels to anon, authenticated;
grant select on public.hrm_catalog_items to anon, authenticated;

grant insert, update, delete on public.hrm_org_blocks to authenticated;
grant insert, update, delete on public.hrm_position_groups to authenticated;
grant insert, update, delete on public.hrm_position_levels to authenticated;
grant insert, update, delete on public.hrm_competency_groups to authenticated;
grant insert, update, delete on public.hrm_competency_levels to authenticated;
grant insert, update, delete on public.hrm_catalog_items to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'hrm_org_blocks',
    'hrm_position_groups',
    'hrm_position_levels',
    'hrm_competency_groups',
    'hrm_competency_levels',
    'hrm_catalog_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', table_name || '_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin() or public.is_module_admin(%L))', table_name || '_insert', table_name, 'HRM');
    execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin() or public.is_module_admin(%L)) with check (public.is_admin() or public.is_module_admin(%L))', table_name || '_update', table_name, 'HRM', 'HRM');
    execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin() or public.is_module_admin(%L))', table_name || '_delete', table_name, 'HRM');
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'hrm_org_blocks',
      'hrm_position_groups',
      'hrm_position_levels',
      'hrm_competency_groups',
      'hrm_competency_levels',
      'hrm_catalog_items'
    ] loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;
