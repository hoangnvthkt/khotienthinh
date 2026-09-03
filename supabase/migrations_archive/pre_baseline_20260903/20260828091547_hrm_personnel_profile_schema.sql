begin;

create table public.hrm_employee_private_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  personal_email text,
  personal_phone text,
  nationality_code text,
  place_of_birth text,
  hometown text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hrm_employee_addresses (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  record_code text not null,
  address_type text not null check (address_type in ('PERMANENT','CURRENT','CONTACT')),
  address_line text not null,
  ward_code text,
  district_code text,
  province_code text,
  country_code text not null default 'VN',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, record_code),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.hrm_employee_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  record_code text not null,
  full_name text not null,
  relationship_code text not null,
  phone text not null,
  email text,
  address text,
  is_primary boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, record_code)
);

create table public.hrm_employee_identity_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  record_code text not null,
  document_type_code text not null,
  document_number text not null,
  issued_date date,
  issued_place text,
  expiry_date date,
  is_primary boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','EXPIRED')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, record_code)
);

create table public.hrm_employee_tax_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  tax_code text,
  tax_residency_code text,
  registration_date date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hrm_employee_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  record_code text not null,
  bank_code text not null,
  branch_name text,
  account_number text not null,
  account_holder text not null,
  is_payroll_account boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, record_code),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.hrm_employee_insurance_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  social_insurance_number text,
  health_insurance_number text,
  registered_clinic_code text,
  participation_status_code text,
  effective_from date,
  effective_to date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table public.hrm_employee_dependents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  record_code text not null,
  full_name text not null,
  relationship_code text not null,
  date_of_birth date,
  tax_code text,
  deduction_from date,
  deduction_to date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, record_code),
  check (deduction_to is null or deduction_from is null or deduction_to >= deduction_from)
);

create table public.hrm_employee_employment_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  record_code text not null,
  event_type_code text not null,
  event_date date not null,
  org_unit_id uuid references public.org_units(id) on delete set null,
  position_id uuid references public.hrm_positions(id) on delete set null,
  title_snapshot text,
  reason text,
  source_reference text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, record_code)
);

create table public.hrm_employee_qualifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  record_code text not null,
  education_level_code text,
  institution_name text not null,
  major_name text,
  degree_name text,
  graduation_year integer check (graduation_year between 1900 and 2200),
  start_date date,
  end_date date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, record_code),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.hrm_employee_certifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  record_code text not null,
  certification_type_code text,
  certification_name text not null,
  certificate_number text,
  issuer_name text,
  issued_date date,
  expiry_date date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','EXPIRED')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, record_code),
  check (expiry_date is null or issued_date is null or expiry_date >= issued_date)
);

create index hrm_employee_addresses_employee_idx on public.hrm_employee_addresses(employee_id, status);
create index hrm_employee_emergency_contacts_employee_idx on public.hrm_employee_emergency_contacts(employee_id, status);
create index hrm_employee_identity_documents_employee_idx on public.hrm_employee_identity_documents(employee_id, status);
create index hrm_employee_bank_accounts_employee_idx on public.hrm_employee_bank_accounts(employee_id, status);
create index hrm_employee_dependents_employee_idx on public.hrm_employee_dependents(employee_id, status);
create index hrm_employee_employment_events_employee_idx on public.hrm_employee_employment_events(employee_id, event_date desc);
create index hrm_employee_qualifications_employee_idx on public.hrm_employee_qualifications(employee_id, status);
create index hrm_employee_certifications_employee_idx on public.hrm_employee_certifications(employee_id, status);

do $$
begin
  if (select count(*) from public.hrm_labor_contracts) <> 0
    or (select count(*) from public.hrm_salary_history) <> 0
  then
    raise exception using errcode = '55000', message = 'HRM_EMPTY_TABLE_PRECONDITION_FAILED';
  end if;
end;
$$;

alter table public.hrm_labor_contracts rename column "employeeId" to employee_id;
alter table public.hrm_labor_contracts rename column "contractNumber" to contract_number;
alter table public.hrm_labor_contracts rename column "startDate" to effective_from;
alter table public.hrm_labor_contracts rename column "endDate" to effective_to;
alter table public.hrm_labor_contracts rename column "baseSalary" to base_salary;
alter table public.hrm_labor_contracts rename column "allowancePosition" to allowance_position;
alter table public.hrm_labor_contracts rename column "allowanceOther" to allowance_other;
alter table public.hrm_labor_contracts rename column "signedBy" to signed_by;
alter table public.hrm_labor_contracts rename column "createdAt" to created_at;
alter table public.hrm_labor_contracts alter column effective_from type date using nullif(effective_from, '')::date;
alter table public.hrm_labor_contracts alter column effective_to type date using nullif(effective_to, '')::date;
alter table public.hrm_labor_contracts add column updated_at timestamptz not null default now();
alter table public.hrm_labor_contracts add column created_by uuid references public.users(id) on delete set null;
alter table public.hrm_labor_contracts add column updated_by uuid references public.users(id) on delete set null;
alter table public.hrm_labor_contracts add constraint hrm_labor_contracts_effective_dates
  check (effective_to is null or effective_to >= effective_from);

alter table public.hrm_salary_history rename column "employeeId" to employee_id;
alter table public.hrm_salary_history rename column "contractId" to contract_id;
alter table public.hrm_salary_history rename column "changeDate" to effective_from;
alter table public.hrm_salary_history rename column "previousSalary" to previous_salary;
alter table public.hrm_salary_history rename column "newSalary" to new_salary;
alter table public.hrm_salary_history rename column "previousAllowance" to previous_allowance;
alter table public.hrm_salary_history rename column "newAllowance" to new_allowance;
alter table public.hrm_salary_history rename column "changedBy" to changed_by_legacy;
alter table public.hrm_salary_history rename column "createdAt" to created_at;
alter table public.hrm_salary_history add column effective_to date;
alter table public.hrm_salary_history add column status text not null default 'ACTIVE'
  check (status in ('ACTIVE','SUPERSEDED','VOID'));
alter table public.hrm_salary_history add column created_by uuid references public.users(id) on delete set null;
alter table public.hrm_salary_history add column updated_by uuid references public.users(id) on delete set null;
alter table public.hrm_salary_history add column updated_at timestamptz not null default now();
alter table public.hrm_salary_history add constraint hrm_salary_history_effective_dates
  check (effective_to is null or effective_to >= effective_from);

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'hrm_employee_private_profiles','hrm_employee_addresses',
    'hrm_employee_emergency_contacts','hrm_employee_identity_documents',
    'hrm_employee_tax_profiles','hrm_employee_bank_accounts',
    'hrm_employee_insurance_profiles','hrm_employee_dependents',
    'hrm_employee_employment_events','hrm_employee_qualifications',
    'hrm_employee_certifications'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$$;

comment on table public.hrm_employee_private_profiles is 'C2 private personnel profile; projection RPC only.';
comment on table public.hrm_employee_identity_documents is 'C3 legal identity data; deny-by-default.';
comment on table public.hrm_employee_tax_profiles is 'C4 tax data; deny-by-default.';
comment on table public.hrm_employee_bank_accounts is 'C4 banking data; deny-by-default.';

notify pgrst, 'reload schema';
commit;
