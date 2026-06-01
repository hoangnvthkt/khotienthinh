-- Material Planning V2: value forecast, master lead time and consumption curves.

alter table public.items
  add column if not exists default_lead_time_days integer not null default 7
    check (default_lead_time_days >= 0 and default_lead_time_days <= 365);

create table if not exists public.planning_curve_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.planning_curve_points (
  id uuid primary key default gen_random_uuid(),
  curve_id uuid not null references public.planning_curve_templates(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  percentage numeric(7, 4) not null check (percentage >= 0 and percentage <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_curve_points_curve_sequence_unique unique (curve_id, sequence)
);

create index if not exists idx_planning_curve_points_curve_sequence
  on public.planning_curve_points(curve_id, sequence);

alter table public.material_planning_rules
  add column if not exists curve_template_id uuid references public.planning_curve_templates(id) on delete set null;

alter table public.material_planning_rules
  drop constraint if exists material_planning_rules_distribution_method_check;

alter table public.material_planning_rules
  add constraint material_planning_rules_distribution_method_check
  check (distribution_method in ('pre_start', 'linear', 'custom_curve'));

create or replace function public.set_planning_curve_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_planning_curve_points_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_planning_curve_templates_updated_at
  on public.planning_curve_templates;
create trigger trg_planning_curve_templates_updated_at
  before update on public.planning_curve_templates
  for each row execute function public.set_planning_curve_templates_updated_at();

drop trigger if exists trg_planning_curve_points_updated_at
  on public.planning_curve_points;
create trigger trg_planning_curve_points_updated_at
  before update on public.planning_curve_points
  for each row execute function public.set_planning_curve_points_updated_at();

alter table public.planning_curve_templates enable row level security;
alter table public.planning_curve_points enable row level security;

drop policy if exists planning_curve_templates_read
  on public.planning_curve_templates;
create policy planning_curve_templates_read
  on public.planning_curve_templates
  for select
  to authenticated
  using (true);

drop policy if exists planning_curve_points_read
  on public.planning_curve_points;
create policy planning_curve_points_read
  on public.planning_curve_points
  for select
  to authenticated
  using (true);

revoke all on table public.planning_curve_templates from anon;
revoke all on table public.planning_curve_templates from public;
revoke all on table public.planning_curve_templates from authenticated;
grant select on table public.planning_curve_templates to authenticated;

revoke all on table public.planning_curve_points from anon;
revoke all on table public.planning_curve_points from public;
revoke all on table public.planning_curve_points from authenticated;
grant select on table public.planning_curve_points to authenticated;

revoke all on function public.set_planning_curve_templates_updated_at() from public;
revoke all on function public.set_planning_curve_points_updated_at() from public;

insert into public.planning_curve_templates (code, name, description)
values
  ('foundation_curve', 'Foundation Curve', 'Nhu cầu vật tư tăng mạnh ở giữa giai đoạn móng.'),
  ('steel_structure_curve', 'Steel Structure Curve', 'Nhu cầu thép/kết cấu tập trung ở đầu và giữa giai đoạn dựng.'),
  ('roofing_curve', 'Roofing Curve', 'Nhu cầu tấm/panel mái tập trung trước và trong giai đoạn lợp.'),
  ('mep_curve', 'MEP Curve', 'Nhu cầu MEP rải theo nhiều tuần, tăng ở giai đoạn lắp đặt chính.'),
  ('front_loaded_curve', 'Front Loaded Curve', 'Nhu cầu dồn sớm để mô phỏng phương án đặt mua trước.')
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    updated_at = now();

insert into public.planning_curve_points (curve_id, sequence, percentage)
select template.id, point.sequence, point.percentage
from (
  values
    ('foundation_curve', 1, 10::numeric), ('foundation_curve', 2, 20::numeric), ('foundation_curve', 3, 40::numeric), ('foundation_curve', 4, 30::numeric),
    ('steel_structure_curve', 1, 30::numeric), ('steel_structure_curve', 2, 35::numeric), ('steel_structure_curve', 3, 25::numeric), ('steel_structure_curve', 4, 10::numeric),
    ('roofing_curve', 1, 45::numeric), ('roofing_curve', 2, 35::numeric), ('roofing_curve', 3, 15::numeric), ('roofing_curve', 4, 5::numeric),
    ('mep_curve', 1, 15::numeric), ('mep_curve', 2, 20::numeric), ('mep_curve', 3, 30::numeric), ('mep_curve', 4, 25::numeric), ('mep_curve', 5, 10::numeric),
    ('front_loaded_curve', 1, 50::numeric), ('front_loaded_curve', 2, 30::numeric), ('front_loaded_curve', 3, 15::numeric), ('front_loaded_curve', 4, 5::numeric)
) as point(code, sequence, percentage)
join public.planning_curve_templates template on template.code = point.code
on conflict (curve_id, sequence) do update
set percentage = excluded.percentage,
    updated_at = now();

notify pgrst, 'reload schema';
