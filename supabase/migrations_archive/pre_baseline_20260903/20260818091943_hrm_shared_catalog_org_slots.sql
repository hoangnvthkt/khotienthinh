begin;

-- Approved HRM source normalization. P3 tables are intentionally untouched.
insert into public.hrm_position_groups (
  code, name, description, is_active, sort_order, source
) values ('CG', 'Chuyên gia', 'Chuyên gia và cố vấn chuyên môn', true, 70, 'catalog')
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    updated_at = now();

insert into public.hrm_catalog_items (
  catalog_key, code, name, description, is_active, sort_order, source
) values
  ('employment_status', 'TS', 'Thai sản', 'Đang hưởng chế độ thai sản', true, 40, 'catalog'),
  ('employment_status', 'NCD', 'Nghỉ chế độ theo luật LĐ', 'Ốm nằm viện, hiếu hỷ và các chế độ theo luật lao động', true, 50, 'catalog')
on conflict (catalog_key, code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    updated_at = now();

update public.hrm_positions
set level_code = 'E' || substring(level_code from 2)
where level_code ~ '^L(1[01]|[1-9])$';

update public.hrm_position_levels
set code = 'E' || substring(code from 2),
    salary_range = null,
    updated_at = now()
where code ~ '^L(1[01]|[1-9])$';

update public.hrm_position_levels
set salary_range = null,
    updated_at = now()
where salary_range is not null;

update public.hrm_positions
set suggested_org_unit_code = null
where suggested_org_unit_code in ('VPHN', 'BCH CT', 'CG/CV');

update public.hrm_org_blocks
set is_active = false,
    updated_at = now()
where code = 'K4';

update public.hrm_competency_levels
set is_active = false,
    updated_at = now()
where code = 'C6';

update public.org_units
set is_active = false
where code = 'VPHN' or block_code = 'K4';

-- Materialize the three approved organization blocks under the company root.
with company_root as (
  select id
  from public.org_units
  where type = 'company' and is_active
  order by created_at
  limit 1
)
insert into public.org_units (
  name, type, "customTypeLabel", parent_id, description, order_index,
  code, block_code, source, alias_names, is_active
)
select block.name,
       'custom',
       'Khối',
       company_root.id,
       'Khối tổ chức dùng chung HRM',
       case block.code when 'K1' then 10 when 'K2' then 20 else 30 end,
       block.code,
       block.code,
       'catalog',
       '{}'::text[],
       true
from public.hrm_org_blocks block
cross join company_root
where block.code in ('K1', 'K2', 'K3')
on conflict (code) where code is not null do update
set name = excluded.name,
    type = excluded.type,
    "customTypeLabel" = excluded."customTypeLabel",
    parent_id = excluded.parent_id,
    description = excluded.description,
    order_index = excluded.order_index,
    block_code = excluded.block_code,
    source = excluded.source,
    is_active = true;

update public.org_units child
set parent_id = block.id
from public.org_units block
where child.block_code in ('K1', 'K2', 'K3')
  and child.code is distinct from child.block_code
  and block.code = child.block_code
  and block.is_active;

create table if not exists public.hrm_org_position_slots (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  org_unit_id uuid not null references public.org_units(id) on delete restrict,
  position_id uuid not null references public.hrm_positions(id) on delete restrict,
  level_code text references public.hrm_position_levels(code) on update cascade on delete restrict,
  reports_to_slot_id uuid references public.hrm_org_position_slots(id) on delete set null,
  slot_type text not null default 'STANDARD'
    check (slot_type in ('STANDARD', 'RESERVE', 'TEMPORARY')),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'FROZEN', 'ARCHIVED')),
  description text,
  effective_from date not null default current_date,
  effective_to date,
  sort_order integer not null default 0,
  source text not null default 'manual',
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hrm_org_position_slots_code_not_blank check (length(trim(code)) > 0),
  constraint hrm_org_position_slots_effective_dates check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint hrm_org_position_slots_not_self_reporting check (
    reports_to_slot_id is null or reports_to_slot_id <> id
  )
);

create index if not exists hrm_org_position_slots_org_unit_idx
  on public.hrm_org_position_slots(org_unit_id, status, sort_order);
create index if not exists hrm_org_position_slots_reports_to_idx
  on public.hrm_org_position_slots(reports_to_slot_id)
  where reports_to_slot_id is not null;

create table if not exists public.hrm_employee_slot_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  slot_id uuid not null references public.hrm_org_position_slots(id) on delete restrict,
  assignment_type text not null default 'PRIMARY'
    check (assignment_type in ('PRIMARY', 'SECONDARY', 'ACTING')),
  status text not null default 'ACTIVE'
    check (status in ('PLANNED', 'ACTIVE', 'ENDED')),
  effective_from date not null default current_date,
  effective_to date,
  note text,
  source text not null default 'manual',
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hrm_employee_slot_assignments_effective_dates check (
    effective_to is null or effective_to >= effective_from
  )
);

create unique index if not exists hrm_employee_one_active_primary_slot_idx
  on public.hrm_employee_slot_assignments(employee_id)
  where status = 'ACTIVE' and assignment_type = 'PRIMARY';
create unique index if not exists hrm_slot_one_active_occupant_idx
  on public.hrm_employee_slot_assignments(slot_id)
  where status = 'ACTIVE' and assignment_type in ('PRIMARY', 'ACTING');
create index if not exists hrm_employee_slot_assignment_lookup_idx
  on public.hrm_employee_slot_assignments(employee_id, status, effective_from, effective_to);

create table if not exists public.hrm_employee_manual_allowances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  component_id uuid not null references public.hrm_payroll_components(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'ACTIVE'
    check (status in ('PLANNED', 'ACTIVE', 'ENDED')),
  effective_from date not null default current_date,
  effective_to date,
  note text,
  source text not null default 'manual',
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hrm_employee_manual_allowances_effective_dates check (
    effective_to is null or effective_to >= effective_from
  )
);

create index if not exists hrm_employee_manual_allowances_lookup_idx
  on public.hrm_employee_manual_allowances(employee_id, status, effective_from, effective_to);

alter table public.org_units
  add column if not exists manager_slot_id uuid
  references public.hrm_org_position_slots(id) on delete set null;

create or replace function app_private.hrm_validate_slot_reporting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle_found boolean;
begin
  if new.reports_to_slot_id is null then
    return new;
  end if;
  if new.reports_to_slot_id = new.id then
    raise exception using errcode = '22023', message = 'HRM_SLOT_SELF_REPORT_NOT_ALLOWED';
  end if;

  with recursive manager_chain as (
    select slot.id, slot.reports_to_slot_id
    from public.hrm_org_position_slots slot
    where slot.id = new.reports_to_slot_id
    union all
    select parent.id, parent.reports_to_slot_id
    from public.hrm_org_position_slots parent
    join manager_chain chain on parent.id = chain.reports_to_slot_id
  )
  select exists(select 1 from manager_chain where id = new.id)
  into v_cycle_found;

  if v_cycle_found then
    raise exception using errcode = '22023', message = 'HRM_SLOT_REPORTING_CYCLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hrm_validate_slot_reporting on public.hrm_org_position_slots;
create trigger trg_hrm_validate_slot_reporting
before insert or update of reports_to_slot_id on public.hrm_org_position_slots
for each row execute function app_private.hrm_validate_slot_reporting();

create or replace function app_private.hrm_validate_org_manager_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.manager_slot_id is not null and not exists (
    select 1
    from public.hrm_org_position_slots slot
    where slot.id = new.manager_slot_id
      and slot.org_unit_id = new.id
      and slot.status = 'ACTIVE'
  ) then
    raise exception using errcode = '22023', message = 'HRM_MANAGER_SLOT_MUST_BELONG_TO_UNIT';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hrm_validate_org_manager_slot on public.org_units;
create trigger trg_hrm_validate_org_manager_slot
before insert or update of manager_slot_id on public.org_units
for each row execute function app_private.hrm_validate_org_manager_slot();

create or replace function app_private.hrm_validate_manual_allowance_component()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.hrm_payroll_components component
    where component.id = new.component_id
      and component.component_type = 'allowance'
      and component.is_active
  ) then
    raise exception using errcode = '22023', message = 'HRM_MANUAL_ALLOWANCE_COMPONENT_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hrm_validate_manual_allowance_component
  on public.hrm_employee_manual_allowances;
create trigger trg_hrm_validate_manual_allowance_component
before insert or update of component_id on public.hrm_employee_manual_allowances
for each row execute function app_private.hrm_validate_manual_allowance_component();

-- Backfill one stable primary slot for every active employee with an organization and position.
with ranked_employees as (
  select employee.id as employee_id,
         employee.org_unit_id,
         employee.position_id,
         coalesce(nullif(position.level_code, ''), nullif(level.code, '')) as level_code,
         regexp_replace(upper(coalesce(org.code, 'ORG')), '[^A-Z0-9]+', '_', 'g') || '-' ||
         regexp_replace(upper(coalesce(position.code, 'POS')), '[^A-Z0-9]+', '_', 'g') || '-' ||
         lpad(row_number() over (
           partition by employee.org_unit_id, employee.position_id
           order by employee.employee_code, employee.id
         )::text, 2, '0') as slot_code,
         row_number() over (
           partition by employee.org_unit_id
           order by position.sort_order, employee.employee_code, employee.id
         )::integer as unit_sort_order
  from public.employees employee
  join public.org_units org on org.id = employee.org_unit_id
  join public.hrm_positions position on position.id = employee.position_id
  left join public.hrm_position_levels level on level.code = position.level_code
  where employee.status = 'Đang làm việc'
)
insert into public.hrm_org_position_slots (
  code, org_unit_id, position_id, level_code, slot_type, status,
  effective_from, sort_order, source, description
)
select ranked.slot_code,
       ranked.org_unit_id,
       ranked.position_id,
       ranked.level_code,
       'STANDARD',
       'ACTIVE',
       current_date,
       ranked.unit_sort_order,
       'employee_backfill',
       'Slot nền tạo từ phân bổ nhân sự hiện hành'
from ranked_employees ranked
on conflict (code) do nothing;

with ranked_employees as (
  select employee.id as employee_id,
         regexp_replace(upper(coalesce(org.code, 'ORG')), '[^A-Z0-9]+', '_', 'g') || '-' ||
         regexp_replace(upper(coalesce(position.code, 'POS')), '[^A-Z0-9]+', '_', 'g') || '-' ||
         lpad(row_number() over (
           partition by employee.org_unit_id, employee.position_id
           order by employee.employee_code, employee.id
         )::text, 2, '0') as slot_code
  from public.employees employee
  join public.org_units org on org.id = employee.org_unit_id
  join public.hrm_positions position on position.id = employee.position_id
  where employee.status = 'Đang làm việc'
)
insert into public.hrm_employee_slot_assignments (
  employee_id, slot_id, assignment_type, status, effective_from, source, note
)
select ranked.employee_id,
       slot.id,
       'PRIMARY',
       'ACTIVE',
       current_date,
       'employee_backfill',
       'Phân công nền từ hồ sơ nhân sự hiện hành'
from ranked_employees ranked
join public.hrm_org_position_slots slot on slot.code = ranked.slot_code
where not exists (
  select 1
  from public.hrm_employee_slot_assignments assignment
  where assignment.employee_id = ranked.employee_id
    and assignment.status = 'ACTIVE'
    and assignment.assignment_type = 'PRIMARY'
);

create or replace function public.assign_hrm_employee_to_slot(
  p_employee_id uuid,
  p_slot_id uuid,
  p_effective_from date default current_date,
  p_note text default null,
  p_actor_id uuid default null
)
returns public.hrm_employee_slot_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_employee public.employees%rowtype;
  v_slot public.hrm_org_position_slots%rowtype;
  v_position public.hrm_positions%rowtype;
  v_assignment public.hrm_employee_slot_assignments%rowtype;
begin
  if not (public.is_admin() or public.is_module_admin('HRM')) then
    raise exception using errcode = '42501', message = 'HRM_ADMIN_REQUIRED';
  end if;

  v_actor_id := public.current_app_user_id();
  select * into v_employee
  from public.employees
  where id = p_employee_id and status = 'Đang làm việc'
  for update;
  if v_employee.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_EMPLOYEE_NOT_FOUND';
  end if;

  select * into v_slot
  from public.hrm_org_position_slots
  where id = p_slot_id
    and status = 'ACTIVE'
    and effective_from <= p_effective_from
    and (effective_to is null or effective_to >= p_effective_from)
  for update;
  if v_slot.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_SLOT_NOT_FOUND';
  end if;

  select * into v_position
  from public.hrm_positions
  where id = v_slot.position_id and is_active;
  if v_position.id is null then
    raise exception using errcode = '22023', message = 'HRM_ACTIVE_POSITION_NOT_FOUND';
  end if;

  update public.hrm_employee_slot_assignments
  set status = 'ENDED',
      effective_to = greatest(effective_from, p_effective_from),
      updated_by = v_actor_id,
      updated_at = now(),
      note = concat_ws(E'\n', nullif(note, ''), 'Kết thúc khi chuyển sang slot ' || v_slot.code)
  where status = 'ACTIVE'
    and assignment_type = 'PRIMARY'
    and employee_id = p_employee_id;

  update public.hrm_employee_slot_assignments
  set status = 'ENDED',
      effective_to = greatest(effective_from, p_effective_from),
      updated_by = v_actor_id,
      updated_at = now(),
      note = concat_ws(E'\n', nullif(note, ''), 'Kết thúc khi slot được phân bổ lại')
  where status = 'ACTIVE'
    and assignment_type in ('PRIMARY', 'ACTING')
    and slot_id = p_slot_id;

  insert into public.hrm_employee_slot_assignments (
    employee_id, slot_id, assignment_type, status, effective_from,
    note, source, created_by, updated_by
  ) values (
    p_employee_id, p_slot_id, 'PRIMARY', 'ACTIVE', p_effective_from,
    nullif(trim(p_note), ''), 'manual', v_actor_id, v_actor_id
  ) returning * into v_assignment;

  update public.employees
  set org_unit_id = v_slot.org_unit_id,
      position_id = v_slot.position_id,
      title = v_position.name,
      updated_at = now()
  where id = p_employee_id;

  insert into public.audit_trail (
    table_name, record_id, action, new_data, user_id, module,
    description, record_label, entity_type, changed_fields, change_count, impact_level
  ) values (
    'hrm_employee_slot_assignments', v_assignment.id::text, 'INSERT',
    to_jsonb(v_assignment), v_actor_id::text, 'HRM',
    'Phân bổ nhân sự vào slot tổ chức', v_slot.code, 'HRM_SLOT_ASSIGNMENT',
    array['employee_id', 'slot_id', 'effective_from'], 3, 'high'
  );

  return v_assignment;
end;
$$;

create or replace function app_private.resolve_slot_direct_manager(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_slot_id uuid;
  v_unit_id uuid;
  v_target_slot_id uuid;
  v_manager_user_id uuid;
begin
  select employee.id
  into v_employee_id
  from public.employees employee
  where employee.user_id = p_user_id
    and employee.status = 'Đang làm việc'
  limit 1;

  if v_employee_id is null then
    return null;
  end if;

  select slot.id, slot.org_unit_id,
         coalesce(
           slot.reports_to_slot_id,
           case when org.manager_slot_id is distinct from slot.id then org.manager_slot_id end
         )
  into v_slot_id, v_unit_id, v_target_slot_id
  from public.hrm_employee_slot_assignments assignment
  join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
  join public.org_units org on org.id = slot.org_unit_id
  where assignment.employee_id = v_employee_id
    and assignment.assignment_type = 'PRIMARY'
    and assignment.status = 'ACTIVE'
    and assignment.effective_from <= current_date
    and (assignment.effective_to is null or assignment.effective_to >= current_date)
    and slot.status = 'ACTIVE'
  order by assignment.effective_from desc
  limit 1;

  if v_slot_id is null then
    return null;
  end if;

  if v_target_slot_id is null then
    with recursive ancestor_units as (
      select parent.id, parent.parent_id, parent.manager_slot_id, 1 as depth
      from public.org_units child
      join public.org_units parent on parent.id = child.parent_id
      where child.id = v_unit_id
      union all
      select parent.id, parent.parent_id, parent.manager_slot_id, ancestor.depth + 1
      from ancestor_units ancestor
      join public.org_units parent on parent.id = ancestor.parent_id
    )
    select manager_slot_id
    into v_target_slot_id
    from ancestor_units
    where manager_slot_id is not null
      and manager_slot_id <> v_slot_id
    order by depth
    limit 1;
  end if;

  if v_target_slot_id is null then
    return null;
  end if;

  select manager_user.id
  into v_manager_user_id
  from public.hrm_employee_slot_assignments assignment
  join public.employees manager_employee on manager_employee.id = assignment.employee_id
  join public.users manager_user on manager_user.id = manager_employee.user_id
  where assignment.slot_id = v_target_slot_id
    and assignment.assignment_type in ('PRIMARY', 'ACTING')
    and assignment.status = 'ACTIVE'
    and assignment.effective_from <= current_date
    and (assignment.effective_to is null or assignment.effective_to >= current_date)
    and manager_user.id <> p_user_id
    and coalesce(manager_user.is_active, true)
    and coalesce(manager_user.account_status, 'ACTIVE') = 'ACTIVE'
  order by case assignment.assignment_type when 'ACTING' then 0 else 1 end,
           assignment.effective_from desc
  limit 1;

  return v_manager_user_id;
end;
$$;

create or replace function app_private.resolve_active_direct_manager(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slot_manager_id uuid;
  v_legacy_manager_id uuid;
begin
  v_slot_manager_id := app_private.resolve_slot_direct_manager(p_user_id);

  select manager.id
  into v_legacy_manager_id
  from public.users employee
  join public.users manager on manager.id = employee.manager_id
  where employee.id = p_user_id
    and manager.id <> p_user_id
    and coalesce(manager.is_active, true)
    and coalesce(manager.account_status, 'ACTIVE') = 'ACTIVE';

  return coalesce(v_slot_manager_id, v_legacy_manager_id);
end;
$$;

revoke all on function app_private.hrm_validate_slot_reporting() from public, anon, authenticated;
revoke all on function app_private.hrm_validate_org_manager_slot() from public, anon, authenticated;
revoke all on function app_private.hrm_validate_manual_allowance_component() from public, anon, authenticated;
revoke all on function app_private.resolve_slot_direct_manager(uuid) from public, anon, authenticated;
revoke all on function app_private.resolve_active_direct_manager(uuid) from public, anon, authenticated;
revoke all on function public.assign_hrm_employee_to_slot(uuid, uuid, date, text, uuid)
  from public, anon;
grant execute on function public.assign_hrm_employee_to_slot(uuid, uuid, date, text, uuid)
  to authenticated, service_role;

alter table public.hrm_org_position_slots enable row level security;
alter table public.hrm_employee_slot_assignments enable row level security;
alter table public.hrm_employee_manual_allowances enable row level security;

create policy hrm_org_position_slots_select
on public.hrm_org_position_slots for select to authenticated
using ((select public.current_app_user_id()) is not null);
create policy hrm_org_position_slots_write
on public.hrm_org_position_slots for all to authenticated
using (public.is_admin() or public.is_module_admin('HRM'))
with check (public.is_admin() or public.is_module_admin('HRM'));

create policy hrm_employee_slot_assignments_select
on public.hrm_employee_slot_assignments for select to authenticated
using ((select public.current_app_user_id()) is not null);
create policy hrm_employee_slot_assignments_write
on public.hrm_employee_slot_assignments for all to authenticated
using (public.is_admin() or public.is_module_admin('HRM'))
with check (public.is_admin() or public.is_module_admin('HRM'));

create policy hrm_employee_manual_allowances_select
on public.hrm_employee_manual_allowances for select to authenticated
using ((select public.current_app_user_id()) is not null);
create policy hrm_employee_manual_allowances_write
on public.hrm_employee_manual_allowances for all to authenticated
using (public.is_admin() or public.is_module_admin('HRM'))
with check (public.is_admin() or public.is_module_admin('HRM'));

revoke all on table public.hrm_org_position_slots from anon;
revoke all on table public.hrm_employee_slot_assignments from anon;
revoke all on table public.hrm_employee_manual_allowances from anon;
revoke insert, update, delete on table public.hrm_org_position_slots from anon;
revoke insert, update, delete on table public.hrm_employee_slot_assignments from anon;
revoke insert, update, delete on table public.hrm_employee_manual_allowances from anon;
revoke delete on table public.hrm_org_position_slots from authenticated;
revoke delete on table public.hrm_employee_slot_assignments from authenticated;
revoke delete on table public.hrm_employee_manual_allowances from authenticated;
grant select, insert, update on table public.hrm_org_position_slots to authenticated;
grant select, insert, update on table public.hrm_employee_slot_assignments to authenticated;
grant select, insert, update on table public.hrm_employee_manual_allowances to authenticated;
grant all on table public.hrm_org_position_slots to service_role;
grant all on table public.hrm_employee_slot_assignments to service_role;
grant all on table public.hrm_employee_manual_allowances to service_role;

comment on table public.hrm_org_position_slots is
  'Approved organization seats. Occupancy is derived from effective employee slot assignments.';
comment on table public.hrm_employee_manual_allowances is
  'Effective-dated manual allowance amounts; no automatic meal, seniority, or attraction formula is applied.';

notify pgrst, 'reload schema';

commit;
